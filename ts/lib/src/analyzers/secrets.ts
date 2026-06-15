import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Analyzer, AnalyzerContext, AnalyzerResult, SarifResult } from "@code-analyzers/core";
import { ingestSarifRun } from "../ingest-sarif.js";
import { CommandNotFoundError, exec } from "./exec.js";
import { erroredResult, unavailableResult } from "./null-state.js";

/**
 * Secrets analyzer — wraps gitleaks (id `secrets`, per role-based naming).
 *
 * Secret findings are sensitive: the report is *meant* to be fed to LLMs, so a
 * report that echoed a matched secret would be a leak. We therefore
 * **reconstruct minimal, safe results** — rule id, severity, and location only —
 * and never carry gitleaks' match/snippet/fingerprint fields. (gitleaks is also
 * invoked with `--redact` as defense in depth.) Bundled rules → no external
 * reference; deterministic and reproducible.
 */

const VERSION = "1";
const DEFAULT_BIN = "gitleaks";
const ID = "secrets";
const HELP_URL = "https://github.com/gitleaks/gitleaks#installing";

// Generated/vendored paths we skip by default. gitleaks `--no-git` ignores
// .gitignore, so without this it scans dist/, coverage/, node_modules/ — noise,
// not source. Regexes matched against the file path (gitleaks allowlist.paths).
const DEFAULT_IGNORE = [
  "(^|/)node_modules/",
  "(^|/)dist/",
  "(^|/)build/",
  "(^|/)coverage/",
  "(^|/)_local/",
  "(^|/)\\.git/",
];
const REPO_CONFIGS = ["gitleaks.toml", ".gitleaks.toml"];

interface SecretsConfig {
  readonly bin: string;
  readonly cwd: string;
  readonly path: string;
  readonly ignore: readonly string[];
  /** Full arg override; `{report}` is replaced with our temp report path. */
  readonly args?: readonly string[];
}

function parseConfig(
  ctx: AnalyzerContext,
  config: Readonly<Record<string, unknown>>,
): SecretsConfig {
  return {
    bin: typeof config.bin === "string" ? config.bin : DEFAULT_BIN,
    cwd: typeof config.cwd === "string" ? config.cwd : ctx.repoRoot,
    path: typeof config.path === "string" ? config.path : ".",
    ignore:
      Array.isArray(config.ignore) && config.ignore.every((p) => typeof p === "string")
        ? (config.ignore as string[])
        : DEFAULT_IGNORE,
    ...(Array.isArray(config.args) && config.args.every((a) => typeof a === "string")
      ? { args: config.args as string[] }
      : {}),
  };
}

/** Does the repo ship its own gitleaks config (which we then respect)? */
function repoHasGitleaksConfig(cwd: string, repoRoot: string): boolean {
  return REPO_CONFIGS.some((n) => existsSync(join(cwd, n)) || existsSync(join(repoRoot, n)));
}

/**
 * A gitleaks config that keeps the full default ruleset (`extend.useDefault`)
 * and adds our path allowlist. Injected only when the repo has no config of its
 * own. TOML literal strings ('') so regex backslashes aren't escaped.
 */
export function gitleaksConfig(ignore: readonly string[]): string {
  const paths = ignore.map((r) => `  '${r}',`).join("\n");
  return `[extend]\nuseDefault = true\n\n[allowlist]\npaths = [\n${paths}\n]\n`;
}

/**
 * Default gitleaks invocation. Uses `detect --source … --no-git`, the portable
 * filesystem-scan form (the newer `dir` subcommand doesn't exist in older
 * gitleaks). `configPath` injects our default-extending allowlist. Override the
 * whole thing with `args` (config `{report}` placeholder) for other versions.
 */
function gitleaksArgs(cfg: SecretsConfig, reportPath: string, configPath?: string): string[] {
  if (cfg.args) return cfg.args.map((a) => a.replaceAll("{report}", reportPath));
  return [
    "detect",
    "--source",
    cfg.path,
    "--no-git",
    ...(configPath ? ["--config", configPath] : []),
    "--report-format",
    "sarif",
    "--report-path",
    reportPath,
    "--redact",
  ];
}

/** Reconstruct a minimal, secret-free result. Drops properties entirely. */
export function redactSecretResult(result: SarifResult): SarifResult {
  return {
    ...(result.ruleId ? { ruleId: result.ruleId } : {}),
    level: result.level ?? "error",
    kind: "fail",
    message: { text: `potential secret (${result.ruleId ?? "rule"})` },
    ...(result.locations ? { locations: result.locations } : {}),
  };
}

/** Pure: gitleaks SARIF text -> a redacted AnalyzerResult. Testable offline. */
export function buildSecretsResult(
  sarifText: string,
  ctx: AnalyzerContext,
  cwd: string,
): AnalyzerResult {
  const run = ingestSarifRun(sarifText, {
    toolId: ID,
    version: VERSION,
    cwd,
    repoRoot: ctx.repoRoot,
    method: "deterministic",
    transformResult: redactSecretResult,
  });
  return {
    method: "deterministic",
    run,
    measurements: [
      {
        name: "secrets.findings",
        value: run.results.length,
        address: { repo: ctx.repo, path: "", level: "repo" },
        analyzer: ID,
      },
    ],
  };
}

const EMPTY_RESULT = (ctx: AnalyzerContext): AnalyzerResult => ({
  method: "deterministic",
  run: {
    tool: { driver: { name: ID, version: VERSION } },
    results: [],
    properties: { method: "deterministic" },
  },
  measurements: [
    {
      name: "secrets.findings",
      value: 0,
      address: { repo: ctx.repo, path: "", level: "repo" },
      analyzer: ID,
    },
  ],
});

export function createSecretsAnalyzer(config: Readonly<Record<string, unknown>>): Analyzer {
  return {
    id: ID,
    version: VERSION,
    async analyze(ctx: AnalyzerContext): Promise<AnalyzerResult> {
      const cfg = parseConfig(ctx, config);
      const outDir = await mkdtemp(join(tmpdir(), "ca-gitleaks-"));
      const outFile = join(outDir, "gitleaks.sarif");
      try {
        // Inject our default-extending allowlist only when the repo has no
        // gitleaks config of its own and the user hasn't fully overridden args.
        let configPath: string | undefined;
        if (!cfg.args && !repoHasGitleaksConfig(cfg.cwd, ctx.repoRoot)) {
          configPath = join(outDir, "gitleaks.toml");
          await writeFile(configPath, gitleaksConfig(cfg.ignore));
        }
        let execResult: Awaited<ReturnType<typeof exec>>;
        try {
          execResult = await exec(cfg.bin, gitleaksArgs(cfg, outFile, configPath), {
            cwd: cfg.cwd,
          });
        } catch (e) {
          if (e instanceof CommandNotFoundError)
            return unavailableResult(ID, VERSION, cfg.bin, HELP_URL);
          throw e;
        }
        let raw: string | undefined;
        try {
          raw = await readFile(outFile, "utf8");
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
        if (raw === undefined) {
          // No report + non-zero exit is a broken run (gitleaks didn't scan —
          // bad subcommand/flag/version). Since nothing was scanned, stderr holds
          // a usage/error message, not matched secrets, so it's safe to surface
          // here (and it's what's needed to debug). The redacted findings path
          // below never exposes stderr.
          if (execResult.code !== 0) {
            return erroredResult(
              ID,
              VERSION,
              `gitleaks exited with code ${execResult.code} and wrote no report — check the gitleaks version/CLI, or set --secrets-args`,
              { stderr: execResult.stderr },
            );
          }
          return EMPTY_RESULT(ctx);
        }
        return buildSecretsResult(raw, ctx, cfg.cwd);
      } finally {
        await rm(outDir, { recursive: true, force: true });
      }
    },
  };
}
