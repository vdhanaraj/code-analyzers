import { mkdtemp, readFile, rm } from "node:fs/promises";
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

interface SecretsConfig {
  readonly bin: string;
  readonly cwd: string;
  readonly path: string;
}

function parseConfig(
  ctx: AnalyzerContext,
  config: Readonly<Record<string, unknown>>,
): SecretsConfig {
  return {
    bin: typeof config.bin === "string" ? config.bin : DEFAULT_BIN,
    cwd: typeof config.cwd === "string" ? config.cwd : ctx.repoRoot,
    path: typeof config.path === "string" ? config.path : ".",
  };
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
        let execResult: Awaited<ReturnType<typeof exec>>;
        try {
          execResult = await exec(
            cfg.bin,
            [
              "dir",
              cfg.path,
              "--report-format",
              "sarif",
              "--report-path",
              outFile,
              "--redact",
              "--no-banner",
            ],
            { cwd: cfg.cwd },
          );
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
          // No report + non-zero exit is a broken run. stderr is suppressed for
          // secrets — it could echo a matched secret.
          if (execResult.code !== 0) {
            return erroredResult(
              ID,
              VERSION,
              `gitleaks exited with code ${execResult.code} and wrote no report`,
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
