import type { Analyzer, AnalyzerContext, Proof, Range, Severity } from "@code-analyzers/core";
import { sha256 } from "../hash.js";
import { normalizeRepoPath } from "../paths.js";
import { exec } from "./exec.js";

/**
 * Lint analyzer — wraps Biome's JSON reporter.
 *
 * Runs `biome check --reporter=json` against the target and maps each
 * diagnostic to a `finding` proof addressed (best-effort) to a byte range, so
 * fine-grained lint findings roll up to their file alongside coarse signals
 * like coverage. The Biome binary and the paths to check are configurable; the
 * external driver (process spawn, Biome's JSON shape) lives only here.
 */

const VERSION = "1";
const DEFAULT_BIN = "biome";

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

/** Biome severities -> our ordered Severity. Unknown -> "warning". */
function mapSeverity(s: unknown): Severity {
  switch (s) {
    case "error":
    case "fatal":
      return "error";
    case "information":
    case "hint":
      return "info";
    default:
      return "warning";
  }
}

/** Pull a plain string out of Biome's description/message (string or markup). */
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

function extractRange(location: Record<string, unknown> | undefined): Range | undefined {
  const span = location?.span;
  if (Array.isArray(span) && span.length === 2 && span.every((n) => typeof n === "number")) {
    return { unit: "byte", start: span[0] as number, end: span[1] as number };
  }
  return undefined;
}

export function createLintAnalyzer(config: Readonly<Record<string, unknown>>): Analyzer {
  return {
    id: "lint",
    version: VERSION,
    async analyze(ctx: AnalyzerContext): Promise<readonly Proof[]> {
      const cfg = parseConfig(ctx, config);
      const result = await exec(
        cfg.bin,
        ["check", "--reporter=json", "--no-errors-on-unmatched", ...cfg.paths],
        { cwd: cfg.cwd },
      );

      const parsed = JSON.parse(result.stdout) as { diagnostics?: unknown };
      const diagnostics = Array.isArray(parsed.diagnostics) ? parsed.diagnostics : [];

      const provenanceBase = {
        tool: "lint" as const,
        version: VERSION,
        config: { bin: cfg.bin, paths: cfg.paths },
        method: "deterministic" as const,
      };

      const proofs: Proof[] = [];
      for (const d of diagnostics) {
        if (typeof d !== "object" || d === null) continue;
        const diagnostic = d as Record<string, unknown>;
        const location = diagnostic.location as Record<string, unknown> | undefined;

        const rawPath = extractPath(location);
        if (!rawPath) continue;
        const path = normalizeRepoPath(cfg.cwd ?? ctx.repoRoot, rawPath);
        if (path === "") continue;

        const rule = typeof diagnostic.category === "string" ? diagnostic.category : "lint";
        const message = extractMessage(diagnostic);
        const severity = mapSeverity(diagnostic.severity);
        const range = extractRange(location);

        proofs.push({
          claim: `${path}: ${rule}`,
          result: { kind: "finding", rule, message },
          scope: range
            ? { repo: ctx.repo, path, range, level: "range" }
            : { repo: ctx.repo, path, level: "path" },
          severity,
          provenance: {
            ...provenanceBase,
            inputsHash: sha256(rule, message, path, JSON.stringify(range ?? null)),
          },
        });
      }

      return proofs;
    },
  };
}
