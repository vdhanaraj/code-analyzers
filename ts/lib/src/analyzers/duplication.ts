import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Analyzer, AnalyzerContext, Proof } from "@code-analyzers/core";
import { sha256 } from "../hash.js";
import { normalizeRepoPath } from "../paths.js";
import { exec } from "./exec.js";

/**
 * Duplication analyzer — wraps jscpd (token-based copy/paste detection).
 *
 * Deterministic and language-agnostic (fits the polyglot goal). Each detected
 * clone becomes a `finding` proof on BOTH files at line-range scope, each
 * pointing at its counterpart, so a duplicated file shows up in the hot-zone
 * rollup alongside other signals (the "low coverage ∩ duplicated code" overlap
 * the ranking is built for). A repo-level `measure` carries overall duplication
 * percentage as a named metric, graphable over time like coverage.
 *
 * The external driver (process spawn, jscpd's JSON shape) lives only here.
 */

const VERSION = "1";
const DEFAULT_BIN = "jscpd";
const DEFAULT_MIN_TOKENS = 50;
const DEFAULT_MIN_LINES = 5;
const DEFAULT_IGNORE = ["**/node_modules/**", "**/dist/**", "**/coverage/**", "**/_local/**"];

interface DuplicationConfig {
  readonly bin: string;
  readonly cwd: string;
  readonly paths: readonly string[];
  readonly minTokens: number;
  readonly minLines: number;
  readonly ignore: readonly string[];
}

/** A jscpd clone-fragment location (only the fields we read). */
interface JscpdFile {
  readonly name: string;
  readonly start: number;
  readonly end: number;
}

interface JscpdClone {
  readonly lines?: number;
  readonly tokens?: number;
  readonly firstFile: JscpdFile;
  readonly secondFile: JscpdFile;
}

interface JscpdReport {
  readonly statistics?: {
    readonly total?: { readonly percentage?: number; readonly clones?: number };
  };
  readonly duplicates?: readonly JscpdClone[];
}

function asStringArray(value: unknown, fallback: readonly string[]): readonly string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string")
    ? (value as string[])
    : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseConfig(
  ctx: AnalyzerContext,
  config: Readonly<Record<string, unknown>>,
): DuplicationConfig {
  return {
    bin: typeof config.bin === "string" ? config.bin : DEFAULT_BIN,
    cwd: typeof config.cwd === "string" ? config.cwd : ctx.repoRoot,
    paths: asStringArray(config.paths, ["."]),
    minTokens: asNumber(config.minTokens, DEFAULT_MIN_TOKENS),
    minLines: asNumber(config.minLines, DEFAULT_MIN_LINES),
    ignore: asStringArray(config.ignore, DEFAULT_IGNORE),
  };
}

export function createDuplicationAnalyzer(config: Readonly<Record<string, unknown>>): Analyzer {
  return {
    id: "duplication",
    version: VERSION,
    async analyze(ctx: AnalyzerContext): Promise<readonly Proof[]> {
      const cfg = parseConfig(ctx, config);
      const outDir = await mkdtemp(join(tmpdir(), "ca-jscpd-"));

      let report: JscpdReport = {};
      try {
        // exec rejects only on a spawn failure (e.g. jscpd not found) — let that
        // propagate. jscpd itself exits 0 even with clones.
        await exec(
          cfg.bin,
          [
            ...cfg.paths,
            "--reporters",
            "json",
            "--output",
            outDir,
            "--silent",
            "--min-tokens",
            String(cfg.minTokens),
            "--min-lines",
            String(cfg.minLines),
            "--ignore",
            cfg.ignore.join(","),
          ],
          { cwd: cfg.cwd },
        );
        let raw: string | undefined;
        try {
          raw = await readFile(join(outDir, "jscpd-report.json"), "utf8");
        } catch (e) {
          // jscpd writes no report when it finds nothing to analyze — treat as
          // zero duplication. Any other read error is real.
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
        if (raw !== undefined) report = JSON.parse(raw) as JscpdReport;
      } finally {
        await rm(outDir, { recursive: true, force: true });
      }
      const provenanceBase = {
        tool: "duplication" as const,
        version: VERSION,
        config: { minTokens: cfg.minTokens, minLines: cfg.minLines, paths: cfg.paths },
        method: "deterministic" as const,
      };

      const proofs: Proof[] = [];

      // Repo-level duplication percentage — a pure measure (not a flag), so it
      // trends over time without by itself creating a hot zone.
      const percentage = asNumber(report.statistics?.total?.percentage, 0);
      const clones = asNumber(report.statistics?.total?.clones, 0);
      proofs.push({
        claim: `repo duplication is ${percentage}%`,
        result: { kind: "measure", value: percentage, unit: "%" },
        scope: { repo: ctx.repo, path: "", level: "repo" },
        metrics: [
          { name: "duplication.percentage", value: percentage, unit: "%" },
          { name: "duplication.clones", value: clones },
        ],
        provenance: {
          ...provenanceBase,
          inputsHash: sha256("duplication-summary", String(percentage), String(clones)),
        },
      });

      // Resolve a jscpd file name (relative to its cwd) to a repo-relative path.
      const toRepoPath = (name: string): string =>
        normalizeRepoPath(ctx.repoRoot, resolve(cfg.cwd, name));

      for (const clone of report.duplicates ?? []) {
        const first = clone.firstFile;
        const second = clone.secondFile;
        const firstPath = toRepoPath(first.name);
        const secondPath = toRepoPath(second.name);
        const lines = asNumber(clone.lines, 0);

        // Emit a finding on each side, pointing at its counterpart.
        for (const [self, other, selfPath, otherPath] of [
          [first, second, firstPath, secondPath] as const,
          [second, first, secondPath, firstPath] as const,
        ]) {
          if (selfPath === "") continue;
          const counterpart = otherPath === "" ? "another location" : otherPath;
          proofs.push({
            claim: `${selfPath}:${self.start}-${self.end} duplicates ${counterpart}:${other.start}-${other.end}`,
            result: {
              kind: "finding",
              rule: "duplication.clone",
              message: `${lines} duplicated lines shared with ${counterpart}:${other.start}-${other.end}`,
            },
            scope: {
              repo: ctx.repo,
              path: selfPath,
              range: { unit: "line", start: self.start, end: self.end },
              level: "range",
            },
            severity: "warning",
            provenance: {
              ...provenanceBase,
              inputsHash: sha256(
                "clone",
                selfPath,
                String(self.start),
                String(self.end),
                otherPath,
                String(other.start),
              ),
            },
          });
        }
      }

      return proofs;
    },
  };
}
