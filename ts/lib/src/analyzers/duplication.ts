import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
  Analyzer,
  AnalyzerContext,
  AnalyzerResult,
  Measurement,
  SarifResult,
} from "@code-analyzers/core";
import { resolveBin } from "../bin-resolve.js";
import { normalizeRepoPath } from "../paths.js";
import { makeResult, makeRun } from "../sarif-build.js";
import { CommandNotFoundError, exec } from "./exec.js";
import { erroredResult, unavailableResult } from "./null-state.js";

/**
 * Duplication analyzer — wraps jscpd (token-based copy/paste detection).
 *
 * Deterministic and language-agnostic. Each clone becomes a SARIF `fail` result
 * on BOTH files at line-range scope, pointing at its counterpart, so duplicated
 * files join the hot-zone rollup as a second flagging signal. Overall
 * duplication percentage rides as a repo-level measurement.
 */

const VERSION = "1";
const DEFAULT_BIN = "jscpd";
const HELP_URL = "https://github.com/kucherenko/jscpd#installation";
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

interface JscpdFile {
  readonly name: string;
  readonly start: number;
  readonly end: number;
}

interface JscpdClone {
  readonly lines?: number;
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
  const cwd = typeof config.cwd === "string" ? config.cwd : ctx.repoRoot;
  return {
    // Prefer the project's local node_modules/.bin/jscpd over a global install.
    bin: typeof config.bin === "string" ? config.bin : resolveBin(DEFAULT_BIN, cwd, ctx.repoRoot),
    cwd,
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
    async analyze(ctx: AnalyzerContext): Promise<AnalyzerResult> {
      const cfg = parseConfig(ctx, config);
      const outDir = await mkdtemp(join(tmpdir(), "ca-jscpd-"));

      let report: JscpdReport = {};
      try {
        let execResult: Awaited<ReturnType<typeof exec>>;
        try {
          execResult = await exec(
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
        } catch (e) {
          if (e instanceof CommandNotFoundError) {
            return unavailableResult("duplication", VERSION, cfg.bin, HELP_URL);
          }
          throw e;
        }
        let raw: string | undefined;
        try {
          raw = await readFile(join(outDir, "jscpd-report.json"), "utf8");
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
        if (raw === undefined) {
          // No report: fine when jscpd exited cleanly (nothing to analyze), but a
          // non-zero exit with no output is a broken run, not zero duplication.
          if (execResult.code !== 0) {
            return erroredResult(
              "duplication",
              VERSION,
              `jscpd exited with code ${execResult.code} and wrote no report`,
              { stderr: execResult.stderr },
            );
          }
        } else {
          try {
            report = JSON.parse(raw) as JscpdReport;
          } catch {
            return erroredResult("duplication", VERSION, "could not parse jscpd report", {
              stderr: execResult.stderr,
            });
          }
        }
      } finally {
        await rm(outDir, { recursive: true, force: true });
      }

      const percentage = asNumber(report.statistics?.total?.percentage, 0);
      const clones = asNumber(report.statistics?.total?.clones, 0);
      const repoAddress = { repo: ctx.repo, path: "", level: "repo" as const };
      const measurements: Measurement[] = [
        {
          name: "duplication.percentage",
          value: percentage,
          unit: "%",
          address: repoAddress,
          analyzer: "duplication",
        },
        {
          name: "duplication.clones",
          value: clones,
          address: repoAddress,
          analyzer: "duplication",
        },
      ];

      const toRepoPath = (name: string): string =>
        normalizeRepoPath(ctx.repoRoot, resolve(cfg.cwd, name));

      const results: SarifResult[] = [];
      for (const clone of report.duplicates ?? []) {
        const first = clone.firstFile;
        const second = clone.secondFile;
        const firstPath = toRepoPath(first.name);
        const secondPath = toRepoPath(second.name);
        const lines = asNumber(clone.lines, 0);

        for (const [self, other, selfPath, otherPath] of [
          [first, second, firstPath, secondPath] as const,
          [second, first, secondPath, firstPath] as const,
        ]) {
          if (selfPath === "") continue;
          const counterpart = otherPath === "" ? "another location" : otherPath;
          results.push(
            makeResult({
              ruleId: "duplication.clone",
              level: "warning",
              kind: "fail",
              message: `${lines} duplicated lines shared with ${counterpart}:${other.start}-${other.end}`,
              uri: selfPath,
              region: { startLine: self.start, endLine: self.end },
            }),
          );
        }
      }

      return {
        method: "deterministic",
        measurements,
        run: makeRun("duplication", VERSION, results, "deterministic"),
      };
    },
  };
}
