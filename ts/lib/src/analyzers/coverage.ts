import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type {
  Analyzer,
  AnalyzerContext,
  AnalyzerResult,
  Measurement,
  SarifResult,
} from "@code-analyzers/core";
import { sha256 } from "../hash.js";
import { normalizeRepoPath } from "../paths.js";
import { makeResult, makeRun } from "../sarif-build.js";
import { CommandNotFoundError, exec } from "./exec.js";
import { erroredResult, unavailableResult } from "./null-state.js";

/**
 * Coverage analyzer — the strategic primitive.
 *
 * Owns the whole pipeline with no pre-step: it **runs the test suite with
 * coverage** (a configurable command) and then ingests the Istanbul
 * `coverage-final.json` it produced. Per-file coverage becomes named
 * `measurements` (graphable over time); files under threshold also yield a SARIF
 * `fail` result so coverage participates in hot zones.
 *
 * Resilience: a missing runner → `unavailable` (with an install pointer); a run
 * that produces no report → `errored` (not a silent pass). `skipRun` ingests a
 * pre-existing report instead (e.g. CI already ran coverage).
 */

const VERSION = "1";
const ID = "coverage";
const DEFAULT_BIN = "vitest";
const DEFAULT_ARGS = ["run", "--coverage"];
const DEFAULT_REPORT = "coverage/coverage-final.json";
const DEFAULT_THRESHOLD = 80;
const HELP_URL = "https://vitest.dev/guide/coverage";

interface CoverageConfig {
  readonly bin: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly report: string;
  readonly threshold: number;
  readonly skipRun: boolean;
}

interface IstanbulEntry {
  readonly path?: string;
  readonly s?: Record<string, number>;
  readonly f?: Record<string, number>;
  readonly b?: Record<string, number[]>;
}

function parseConfig(
  ctx: AnalyzerContext,
  config: Readonly<Record<string, unknown>>,
): CoverageConfig {
  return {
    bin: typeof config.bin === "string" ? config.bin : DEFAULT_BIN,
    args:
      Array.isArray(config.args) && config.args.every((a) => typeof a === "string")
        ? (config.args as string[])
        : DEFAULT_ARGS,
    cwd: typeof config.cwd === "string" ? config.cwd : ctx.repoRoot,
    report: typeof config.report === "string" ? config.report : DEFAULT_REPORT,
    threshold:
      typeof config.threshold === "number" && Number.isFinite(config.threshold)
        ? config.threshold
        : DEFAULT_THRESHOLD,
    skipRun: config.skipRun === true,
  };
}

function pct(covered: number, total: number): number {
  if (total === 0) return 100;
  return Math.round((covered / total) * 10000) / 100;
}

function countHits(hits: Record<string, number> | undefined): { covered: number; total: number } {
  const values = Object.values(hits ?? {});
  return { total: values.length, covered: values.filter((v) => v > 0).length };
}

function countBranches(b: Record<string, number[]> | undefined): {
  covered: number;
  total: number;
} {
  let total = 0;
  let covered = 0;
  for (const arm of Object.values(b ?? {})) {
    for (const hit of arm) {
      total += 1;
      if (hit > 0) covered += 1;
    }
  }
  return { covered, total };
}

/** Compute coverage proofs from a parsed Istanbul report. */
function buildResult(
  ctx: AnalyzerContext,
  threshold: number,
  data: Record<string, IstanbulEntry>,
): AnalyzerResult {
  const measurements: Measurement[] = [];
  const results: SarifResult[] = [];

  for (const [key, entry] of Object.entries(data)) {
    const path = normalizeRepoPath(ctx.repoRoot, entry.path ?? key);
    if (path === "") continue;

    const statements = countHits(entry.s);
    const functions = countHits(entry.f);
    const branches = countBranches(entry.b);
    const stmtPct = pct(statements.covered, statements.total);
    const address = { repo: ctx.repo, path, level: "path" as const };

    measurements.push(
      { name: "coverage.statements.pct", value: stmtPct, unit: "%", address, analyzer: ID },
      {
        name: "coverage.functions.pct",
        value: pct(functions.covered, functions.total),
        unit: "%",
        address,
        analyzer: ID,
      },
      {
        name: "coverage.branches.pct",
        value: pct(branches.covered, branches.total),
        unit: "%",
        address,
        analyzer: ID,
      },
      { name: "coverage.statements.total", value: statements.total, address, analyzer: ID },
      { name: "coverage.statements.covered", value: statements.covered, address, analyzer: ID },
    );

    if (stmtPct < threshold) {
      results.push(
        makeResult({
          ruleId: "coverage.below-threshold",
          level: "warning",
          kind: "fail",
          message: `statement coverage ${stmtPct}% < ${threshold}% threshold`,
          uri: path,
          properties: { inputsHash: sha256(JSON.stringify(entry)) },
        }),
      );
    }
  }

  return {
    method: "deterministic",
    measurements,
    run: makeRun(ID, VERSION, results, "deterministic"),
  };
}

export function createCoverageAnalyzer(config: Readonly<Record<string, unknown>>): Analyzer {
  return {
    id: ID,
    version: VERSION,
    async analyze(ctx: AnalyzerContext): Promise<AnalyzerResult> {
      const cfg = parseConfig(ctx, config);
      const reportPath = isAbsolute(cfg.report) ? cfg.report : resolve(cfg.cwd, cfg.report);

      // Run the test suite with coverage (unless asked to ingest an existing report).
      let exitCode = 0;
      let stderr = "";
      if (!cfg.skipRun) {
        try {
          const run = await exec(cfg.bin, cfg.args, { cwd: cfg.cwd });
          exitCode = run.code;
          stderr = run.stderr;
        } catch (e) {
          if (e instanceof CommandNotFoundError)
            return unavailableResult(ID, VERSION, cfg.bin, HELP_URL);
          throw e;
        }
      }

      let raw: string;
      try {
        raw = await readFile(reportPath, "utf8");
      } catch {
        const detail = cfg.skipRun
          ? `no coverage report at ${cfg.report} (skipRun set; run coverage first)`
          : `"${cfg.bin} ${cfg.args.join(" ")}" exited with code ${exitCode} and produced no coverage report at ${cfg.report}`;
        return erroredResult(ID, VERSION, detail, cfg.skipRun ? {} : { stderr });
      }

      let data: Record<string, IstanbulEntry>;
      try {
        data = JSON.parse(raw) as Record<string, IstanbulEntry>;
      } catch {
        return erroredResult(ID, VERSION, `coverage report at ${cfg.report} is not valid JSON`);
      }

      return buildResult(ctx, cfg.threshold, data);
    },
  };
}
