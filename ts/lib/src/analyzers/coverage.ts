import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type {
  Analyzer,
  AnalyzerContext,
  AnalyzerResult,
  Measurement,
  SarifResult,
} from "@code-analyzers/core";
import { resolveBin } from "../bin-resolve.js";
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
const DEFAULT_REPORT = "coverage/coverage-final.json";
const DEFAULT_THRESHOLD = 80;
const HELP_URL = "https://vitest.dev/guide/coverage";

interface CoverageConfig {
  readonly bin: string;
  readonly cwd: string;
  readonly threshold: number;
  readonly skipRun: boolean;
  /** User-supplied test command args (with `{reportsDir}` placeholder), if any. */
  readonly argsProvided: boolean;
  readonly args: readonly string[];
  /** User-supplied report path, if any (else we force JSON into a temp dir). */
  readonly reportProvided: boolean;
  readonly report: string;
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
  const cwd = typeof config.cwd === "string" ? config.cwd : ctx.repoRoot;
  const argsProvided =
    Array.isArray(config.args) && config.args.every((a) => typeof a === "string");
  const reportProvided = typeof config.report === "string";
  return {
    // Prefer the project's local node_modules/.bin/vitest over a global install.
    bin: typeof config.bin === "string" ? config.bin : resolveBin(DEFAULT_BIN, cwd, ctx.repoRoot),
    cwd,
    threshold:
      typeof config.threshold === "number" && Number.isFinite(config.threshold)
        ? config.threshold
        : DEFAULT_THRESHOLD,
    skipRun: config.skipRun === true,
    argsProvided,
    args: argsProvided ? (config.args as string[]) : [],
    reportProvided,
    report: reportProvided ? (config.report as string) : DEFAULT_REPORT,
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

/** Read + parse an Istanbul report into proofs, or an errored null state. */
async function ingest(
  ctx: AnalyzerContext,
  threshold: number,
  reportPath: string,
  missingDetail: string,
  stderr?: string,
): Promise<AnalyzerResult> {
  let raw: string;
  try {
    raw = await readFile(reportPath, "utf8");
  } catch {
    return erroredResult(ID, VERSION, missingDetail, stderr !== undefined ? { stderr } : {});
  }
  try {
    return buildResult(ctx, threshold, JSON.parse(raw) as Record<string, IstanbulEntry>);
  } catch {
    return erroredResult(ID, VERSION, `coverage report at ${reportPath} is not valid JSON`);
  }
}

export function createCoverageAnalyzer(config: Readonly<Record<string, unknown>>): Analyzer {
  return {
    id: ID,
    version: VERSION,
    async analyze(ctx: AnalyzerContext): Promise<AnalyzerResult> {
      const cfg = parseConfig(ctx, config);
      const resolveReport = (p: string) => (isAbsolute(p) ? p : resolve(cfg.cwd, p));

      // Ingest mode: read an already-produced report; don't run the suite.
      if (cfg.skipRun) {
        return ingest(
          ctx,
          cfg.threshold,
          resolveReport(cfg.report),
          `no coverage report at ${cfg.report} (skipRun set; run coverage first)`,
        );
      }

      // Run mode. By default we FORCE vitest's json reporter into a temp dir, so
      // it works regardless of the repo's coverage config. A custom --coverage-args
      // (with {reportsDir}) or --coverage-report opts out and controls output.
      const reportsDir = await mkdtemp(join(tmpdir(), "ca-cov-"));
      try {
        let args: string[];
        let reportPath: string;
        if (cfg.argsProvided) {
          args = cfg.args.map((a) => a.replaceAll("{reportsDir}", reportsDir));
          reportPath = cfg.reportProvided
            ? resolveReport(cfg.report)
            : join(reportsDir, "coverage-final.json");
        } else if (cfg.reportProvided) {
          args = ["run", "--coverage"];
          reportPath = resolveReport(cfg.report);
        } else {
          args = [
            "run",
            "--coverage",
            "--coverage.reporter=json",
            `--coverage.reportsDirectory=${reportsDir}`,
          ];
          reportPath = join(reportsDir, "coverage-final.json");
        }

        let run: Awaited<ReturnType<typeof exec>>;
        try {
          run = await exec(cfg.bin, args, { cwd: cfg.cwd });
        } catch (e) {
          if (e instanceof CommandNotFoundError)
            return unavailableResult(ID, VERSION, cfg.bin, HELP_URL);
          throw e;
        }
        return ingest(
          ctx,
          cfg.threshold,
          reportPath,
          `"${cfg.bin} ${args.join(" ")}" exited with code ${run.code} and produced no coverage report at ${reportPath} — ensure a coverage provider is installed`,
          run.stderr,
        );
      } finally {
        await rm(reportsDir, { recursive: true, force: true });
      }
    },
  };
}
