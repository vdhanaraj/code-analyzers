import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { Analyzer, AnalyzerContext, Metric, Proof } from "@code-analyzers/core";
import { sha256 } from "../hash.js";
import { normalizeRepoPath } from "../paths.js";

/**
 * Coverage analyzer — the strategic primitive.
 *
 * Ingests the de-facto-standard Istanbul `coverage-final.json` (emitted by c8,
 * nyc, vitest, jest, …) rather than orchestrating a test run, so it is
 * deterministic and runner-agnostic: feed it the artifact, get back per-file
 * coverage proofs. Each file yields a `measure` proof carrying coverage as
 * first-class named metrics (graphable over time, diffable across versions),
 * plus a `finding` when statement coverage is under threshold so coverage
 * participates in hot zones.
 */

const VERSION = "1";
const DEFAULT_REPORT = "coverage/coverage-final.json";
const DEFAULT_THRESHOLD = 80;

interface CoverageConfig {
  readonly report: string;
  readonly threshold: number;
}

/** An Istanbul per-file coverage entry (only the fields we read). */
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

/** covered / total as a percentage; 100 when there is nothing to cover. */
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
    async analyze(ctx: AnalyzerContext): Promise<readonly Proof[]> {
      const reportPath = isAbsolute(cfg.report) ? cfg.report : resolve(ctx.repoRoot, cfg.report);
      const provenanceBase = {
        tool: "coverage" as const,
        version: VERSION,
        config: { report: cfg.report, threshold: cfg.threshold },
        method: "deterministic" as const,
      };

      let raw: string;
      try {
        raw = await readFile(reportPath, "utf8");
      } catch {
        // No report -> we cannot prove coverage. Surface it as an attention
        // signal rather than silently emitting nothing.
        return [
          {
            claim: `coverage report present at ${cfg.report}`,
            result: { kind: "boolean", value: false },
            scope: { repo: ctx.repo, path: "", level: "repo" },
            severity: "warning",
            provenance: { ...provenanceBase, inputsHash: sha256(cfg.report) },
          },
        ];
      }

      const data = JSON.parse(raw) as Record<string, IstanbulEntry>;
      const proofs: Proof[] = [];

      for (const [key, entry] of Object.entries(data)) {
        const path = normalizeRepoPath(ctx.repoRoot, entry.path ?? key);
        if (path === "") continue;

        const statements = countHits(entry.s);
        const functions = countHits(entry.f);
        const branches = countBranches(entry.b);
        const stmtPct = pct(statements.covered, statements.total);

        const metrics: Metric[] = [
          { name: "coverage.statements.pct", value: stmtPct, unit: "%" },
          {
            name: "coverage.functions.pct",
            value: pct(functions.covered, functions.total),
            unit: "%",
          },
          {
            name: "coverage.branches.pct",
            value: pct(branches.covered, branches.total),
            unit: "%",
          },
          { name: "coverage.statements.total", value: statements.total },
          { name: "coverage.statements.covered", value: statements.covered },
        ];
        const inputsHash = sha256(JSON.stringify(entry));

        proofs.push({
          claim: `${path} statement coverage is ${stmtPct}%`,
          result: { kind: "measure", value: stmtPct, unit: "%" },
          scope: { repo: ctx.repo, path, level: "path" },
          metrics,
          provenance: { ...provenanceBase, inputsHash },
        });

        if (stmtPct < cfg.threshold) {
          proofs.push({
            claim: `${path} statement coverage is below the ${cfg.threshold}% threshold`,
            result: {
              kind: "finding",
              rule: "coverage.below-threshold",
              message: `statement coverage ${stmtPct}% < ${cfg.threshold}%`,
            },
            scope: { repo: ctx.repo, path, level: "path" },
            severity: "warning",
            provenance: { ...provenanceBase, inputsHash },
          });
        }
      }

      return proofs;
    },
  };
}
