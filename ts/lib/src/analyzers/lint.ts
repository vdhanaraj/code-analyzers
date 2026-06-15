import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type {
  Analyzer,
  AnalyzerContext,
  AnalyzerResult,
  Measurement,
  SarifLevel,
  SarifRegion,
  SarifResult,
} from "@code-analyzers/core";
import { resolveBin } from "../bin-resolve.js";
import { normalizeRepoPath } from "../paths.js";
import { makeResult, makeRun } from "../sarif-build.js";
import { CommandNotFoundError, exec } from "./exec.js";
import { erroredResult, unavailableResult } from "./null-state.js";

/**
 * Lint analyzer — wraps the project's linter, **Biome or ESLint**.
 *
 * The two have different CLIs and output shapes (Biome: `check --reporter=json`;
 * ESLint: `--format json`), so we detect which the repo uses (by config file,
 * overridable with `tool`) and run/parse accordingly. The binary defaults to the
 * project-local `node_modules/.bin` copy. Diagnostics map to SARIF results
 * addressed repo-relative.
 */

const VERSION = "1";
type Linter = "biome" | "eslint";

const HELP_URL: Record<Linter, string> = {
  biome: "https://biomejs.dev/guides/getting-started/",
  eslint: "https://eslint.org/docs/latest/use/getting-started",
};

const BIOME_CONFIGS = ["biome.json", "biome.jsonc"];
const ESLINT_CONFIGS = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  ".eslintrc.yaml",
  ".eslintrc.yml",
];

interface LintConfig {
  readonly tool?: Linter;
  readonly bin?: string;
  readonly cwd: string;
  readonly paths: readonly string[];
}

function parseConfig(ctx: AnalyzerContext, config: Readonly<Record<string, unknown>>): LintConfig {
  return {
    ...(config.tool === "biome" || config.tool === "eslint" ? { tool: config.tool } : {}),
    ...(typeof config.bin === "string" ? { bin: config.bin } : {}),
    cwd: typeof config.cwd === "string" ? config.cwd : ctx.repoRoot,
    paths:
      Array.isArray(config.paths) && config.paths.every((p) => typeof p === "string")
        ? (config.paths as string[])
        : ["."],
  };
}

/** Detect the linter by config files (cwd then repoRoot). Defaults to biome. */
export function detectLinter(cwd: string, repoRoot: string): Linter {
  const present = (names: string[]) =>
    names.some((n) => existsSync(join(cwd, n)) || existsSync(join(repoRoot, n)));
  if (present(BIOME_CONFIGS)) return "biome";
  if (present(ESLINT_CONFIGS)) return "eslint";
  return "biome";
}

// ---- Biome ----------------------------------------------------------------

function biomeLevel(s: unknown): SarifLevel {
  if (s === "error" || s === "fatal") return "error";
  if (s === "warning") return "warning";
  return "note";
}

function biomeMessage(diagnostic: Record<string, unknown>): string {
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

function parseBiome(stdout: string, toUri: (p: string) => string): SarifResult[] {
  const parsed = JSON.parse(stdout) as { diagnostics?: unknown };
  const diagnostics = Array.isArray(parsed.diagnostics) ? parsed.diagnostics : [];
  const out: SarifResult[] = [];
  for (const d of diagnostics) {
    if (typeof d !== "object" || d === null) continue;
    const diagnostic = d as Record<string, unknown>;
    const location = diagnostic.location as Record<string, unknown> | undefined;
    const rawPath =
      typeof location?.path === "string"
        ? location.path
        : typeof (location?.path as { file?: unknown })?.file === "string"
          ? (location?.path as { file: string }).file
          : undefined;
    if (!rawPath) continue;
    const uri = toUri(rawPath);
    if (uri === "") continue;
    const span = location?.span;
    const region: SarifRegion | undefined =
      Array.isArray(span) && span.length === 2 && span.every((n) => typeof n === "number")
        ? {
            byteOffset: span[0] as number,
            byteLength: Math.max(0, (span[1] as number) - (span[0] as number)),
          }
        : undefined;
    out.push(
      makeResult({
        ruleId: typeof diagnostic.category === "string" ? diagnostic.category : "lint",
        level: biomeLevel(diagnostic.severity),
        kind: "fail",
        message: biomeMessage(diagnostic),
        uri,
        ...(region ? { region } : {}),
      }),
    );
  }
  return out;
}

// ---- ESLint ---------------------------------------------------------------

interface EslintMessage {
  ruleId?: string | null;
  severity?: number;
  message?: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}
interface EslintFileResult {
  filePath?: string;
  messages?: EslintMessage[];
}

export function parseEslint(stdout: string, toUri: (p: string) => string): SarifResult[] {
  const files = JSON.parse(stdout) as EslintFileResult[];
  const out: SarifResult[] = [];
  for (const file of Array.isArray(files) ? files : []) {
    if (!file.filePath) continue;
    const uri = toUri(file.filePath);
    if (uri === "") continue;
    for (const m of file.messages ?? []) {
      const region: SarifRegion | undefined =
        typeof m.line === "number"
          ? {
              startLine: m.line,
              ...(typeof m.column === "number" ? { startColumn: m.column } : {}),
              ...(typeof m.endLine === "number" ? { endLine: m.endLine } : {}),
              ...(typeof m.endColumn === "number" ? { endColumn: m.endColumn } : {}),
            }
          : undefined;
      out.push(
        makeResult({
          ruleId: m.ruleId ?? "eslint",
          level: m.severity === 2 ? "error" : "warning",
          kind: "fail",
          message: m.message ?? "(no message)",
          uri,
          ...(region ? { region } : {}),
        }),
      );
    }
  }
  return out;
}

// ---- Analyzer -------------------------------------------------------------

export function createLintAnalyzer(config: Readonly<Record<string, unknown>>): Analyzer {
  return {
    id: "lint",
    version: VERSION,
    async analyze(ctx: AnalyzerContext): Promise<AnalyzerResult> {
      const cfg = parseConfig(ctx, config);
      const tool = cfg.tool ?? detectLinter(cfg.cwd, ctx.repoRoot);
      const bin = cfg.bin ?? resolveBin(tool, cfg.cwd, ctx.repoRoot);
      const args =
        tool === "biome"
          ? ["check", "--reporter=json", "--no-errors-on-unmatched", ...cfg.paths]
          : ["--format", "json", ...cfg.paths];

      let result: Awaited<ReturnType<typeof exec>>;
      try {
        result = await exec(bin, args, { cwd: cfg.cwd });
      } catch (e) {
        if (e instanceof CommandNotFoundError) {
          return unavailableResult("lint", VERSION, bin, HELP_URL[tool]);
        }
        throw e;
      }

      const toUri = (raw: string): string =>
        normalizeRepoPath(ctx.repoRoot, isAbsolute(raw) ? raw : resolve(cfg.cwd, raw));

      let results: SarifResult[];
      try {
        results =
          tool === "biome" ? parseBiome(result.stdout, toUri) : parseEslint(result.stdout, toUri);
      } catch {
        return erroredResult("lint", VERSION, `could not parse ${tool} JSON output`, {
          stderr: result.stderr,
        });
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
