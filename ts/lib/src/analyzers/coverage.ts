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

/**
 * Coverage analyzer — the strategic primitive.
 *
 * Ingests the de-facto-standard Istanbul `coverage-final.json` (emitted by c8,
 * nyc, vitest, jest, …) rather than orchestrating a test run, so it is
 * deterministic and runner-agnostic. Per-file coverage becomes named
 * `measurements` (graphable over time); files under threshold also yield a
 * SARIF `fail` result so coverage participates in hot zones. A missing report
 * surfaces as a repo-level finding rather than silence.
 */

const VERSION = "1";
const DEFAULT_REPORT = "coverage/coverage-final.json";
const DEFAULT_THRESHOLD = 80;

interface CoverageConfig {
  readonly report: string;
  readonly threshold: number;
}

interface IstanbulEntry {
  readonly path?: string;
  readonly s?: Record<string, number>;
  readonly f?: Record<string, number>;
  readonly b?: Record<string, number[]>;
}

function parseConfig(config: Readonly<Record<string, unknown>>): CoverageConfig {
  const report = typeof config.report === "string" ? config.report : DEFAULT_REPORT;
  const threshold =
    typeof config.threshold === "number" && Number.isFinite(config.threshold)
      ? config.threshold
      : DEFAULT_THRESHOLD;
  return { report, threshold };
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

export function createCoverageAnalyzer(config: Readonly<Record<string, unknown>>): Analyzer {
  const cfg = parseConfig(config);
  return {
    id: "coverage",
    version: VERSION,
    async analyze(ctx: AnalyzerContext): Promise<AnalyzerResult> {
      const reportPath = isAbsolute(cfg.report) ? cfg.report : resolve(ctx.repoRoot, cfg.report);

      let raw: string;
      try {
        raw = await readFile(reportPath, "utf8");
      } catch {
        // No report -> we cannot prove coverage. Surface it, don't go silent.
        return {
          method: "deterministic",
          measurements: [],
          run: makeRun(
            "coverage",
            VERSION,
            [
              makeResult({
                ruleId: "coverage.report-missing",
                level: "warning",
                kind: "fail",
                message: `coverage report not found at ${cfg.report}`,
              }),
            ],
            "deterministic",
          ),
        };
      }

      const data = JSON.parse(raw) as Record<string, IstanbulEntry>;
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
          {
            name: "coverage.statements.pct",
            value: stmtPct,
            unit: "%",
            address,
            analyzer: "coverage",
          },
          {
            name: "coverage.functions.pct",
            value: pct(functions.covered, functions.total),
            unit: "%",
            address,
            analyzer: "coverage",
          },
          {
            name: "coverage.branches.pct",
            value: pct(branches.covered, branches.total),
            unit: "%",
            address,
            analyzer: "coverage",
          },
          {
            name: "coverage.statements.total",
            value: statements.total,
            address,
            analyzer: "coverage",
          },
          {
            name: "coverage.statements.covered",
            value: statements.covered,
            address,
            analyzer: "coverage",
          },
        );

        if (stmtPct < cfg.threshold) {
          results.push(
            makeResult({
              ruleId: "coverage.below-threshold",
              level: "warning",
              kind: "fail",
              message: `statement coverage ${stmtPct}% < ${cfg.threshold}% threshold`,
              uri: path,
              properties: { inputsHash: sha256(JSON.stringify(entry)) },
            }),
          );
        }
      }

      return {
        method: "deterministic",
        measurements,
        run: makeRun("coverage", VERSION, results, "deterministic"),
      };
    },
  };
}
