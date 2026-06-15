import type {
  Analyzer,
  AnalyzerContext,
  AnalyzerResult,
  Measurement,
  SarifLevel,
  SarifRegion,
  SarifResult,
} from "@code-analyzers/core";
import { normalizeRepoPath } from "../paths.js";
import { makeResult, makeRun } from "../sarif-build.js";
import { CommandNotFoundError, exec } from "./exec.js";
import { erroredResult, unavailableResult } from "./null-state.js";

/**
 * Lint analyzer — wraps Biome's JSON reporter.
 *
 * Runs `biome check --reporter=json` and maps each diagnostic to a SARIF result
 * (best-effort byte-range location), plus a repo-level `lint.findings` count
 * measurement for trending. The external driver (process spawn, Biome's JSON
 * shape) lives only here.
 */

const VERSION = "1";
const DEFAULT_BIN = "biome";
const HELP_URL = "https://biomejs.dev/guides/getting-started/";

interface LintConfig {
  readonly bin: string;
  readonly cwd?: string;
  readonly paths: readonly string[];
}

function parseConfig(ctx: AnalyzerContext, config: Readonly<Record<string, unknown>>): LintConfig {
  const bin = typeof config.bin === "string" ? config.bin : DEFAULT_BIN;
  const cwd = typeof config.cwd === "string" ? config.cwd : undefined;
  const paths =
    Array.isArray(config.paths) && config.paths.every((p) => typeof p === "string")
      ? (config.paths as string[])
      : ["."];
  return { bin, cwd: cwd ?? ctx.repoRoot, paths };
}

/** Biome severities -> SARIF level. note-level findings do not flag hot zones. */
function mapLevel(s: unknown): SarifLevel {
  switch (s) {
    case "error":
    case "fatal":
      return "error";
    case "warning":
      return "warning";
    default:
      return "note";
  }
}

function extractMessage(diagnostic: Record<string, unknown>): string {
  if (typeof diagnostic.description === "string" && diagnostic.description.length > 0) {
    return diagnostic.description;
  }
  const message = diagnostic.message;
  if (typeof message === "string") return message;
  if (Array.isArray(message)) {
    const text = message
      .map((node) =>
        typeof node === "string"
          ? node
          : typeof (node as { content?: unknown })?.content === "string"
            ? (node as { content: string }).content
            : "",
      )
      .join("");
    if (text.length > 0) return text;
  }
  return "(no message)";
}

function extractPath(location: Record<string, unknown> | undefined): string | undefined {
  const path = location?.path;
  if (typeof path === "string") return path;
  if (path && typeof path === "object" && typeof (path as { file?: unknown }).file === "string") {
    return (path as { file: string }).file;
  }
  return undefined;
}

function extractRegion(location: Record<string, unknown> | undefined): SarifRegion | undefined {
  const span = location?.span;
  if (Array.isArray(span) && span.length === 2 && span.every((n) => typeof n === "number")) {
    const [start, end] = span as [number, number];
    return { byteOffset: start, byteLength: Math.max(0, end - start) };
  }
  return undefined;
}

export function createLintAnalyzer(config: Readonly<Record<string, unknown>>): Analyzer {
  return {
    id: "lint",
    version: VERSION,
    async analyze(ctx: AnalyzerContext): Promise<AnalyzerResult> {
      const cfg = parseConfig(ctx, config);
      let result: Awaited<ReturnType<typeof exec>>;
      try {
        result = await exec(
          cfg.bin,
          ["check", "--reporter=json", "--no-errors-on-unmatched", ...cfg.paths],
          { cwd: cfg.cwd },
        );
      } catch (e) {
        if (e instanceof CommandNotFoundError)
          return unavailableResult("lint", VERSION, cfg.bin, HELP_URL);
        throw e;
      }

      // A failed run with no parseable output is errored, not a clean pass.
      let parsed: { diagnostics?: unknown };
      try {
        parsed = JSON.parse(result.stdout) as { diagnostics?: unknown };
      } catch {
        return erroredResult("lint", VERSION, "could not parse Biome JSON output", {
          stderr: result.stderr,
        });
      }
      const diagnostics = Array.isArray(parsed.diagnostics) ? parsed.diagnostics : [];

      const results: SarifResult[] = [];
      for (const d of diagnostics) {
        if (typeof d !== "object" || d === null) continue;
        const diagnostic = d as Record<string, unknown>;
        const location = diagnostic.location as Record<string, unknown> | undefined;

        const rawPath = extractPath(location);
        if (!rawPath) continue;
        const path = normalizeRepoPath(cfg.cwd ?? ctx.repoRoot, rawPath);
        if (path === "") continue;

        const ruleId = typeof diagnostic.category === "string" ? diagnostic.category : "lint";
        const region = extractRegion(location);
        results.push(
          makeResult({
            ruleId,
            level: mapLevel(diagnostic.severity),
            kind: "fail",
            message: extractMessage(diagnostic),
            uri: path,
            ...(region ? { region } : {}),
          }),
        );
      }

      const measurements: Measurement[] = [
        {
          name: "lint.findings",
          value: results.length,
          address: { repo: ctx.repo, path: "", level: "repo" },
          analyzer: "lint",
        },
      ];

      return {
        method: "deterministic",
        measurements,
        run: makeRun("lint", VERSION, results, "deterministic"),
      };
    },
  };
}
