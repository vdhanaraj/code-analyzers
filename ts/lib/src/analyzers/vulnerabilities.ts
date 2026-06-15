import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  Analyzer,
  AnalyzerContext,
  AnalyzerResult,
  ExternalReference,
} from "@code-analyzers/core";
import { ingestSarifRun } from "../ingest-sarif.js";
import { exec } from "./exec.js";

/**
 * Vulnerabilities analyzer — wraps osv-scanner (id `vulnerabilities`).
 *
 * Flags dependencies with known CVEs via the OSV database. Deterministic (no
 * inference) but **not reproducible**: it queries a live, evolving database, so
 * the same lockfile can yield different results later. We do not force
 * reproducibility — we *account* for it, stamping an `externalReference`
 * ("OSV queried at <now>") on the run. Pin the offline DB and record its
 * revision in `version` if reproducibility is needed.
 */

const VERSION = "1";
const DEFAULT_BIN = "osv-scanner";
const ID = "vulnerabilities";

interface VulnConfig {
  readonly bin: string;
  readonly cwd: string;
  readonly path: string;
  /** Optional leading subcommand (e.g. "scan" for osv-scanner v2). */
  readonly subcommand?: string;
}

function parseConfig(ctx: AnalyzerContext, config: Readonly<Record<string, unknown>>): VulnConfig {
  return {
    bin: typeof config.bin === "string" ? config.bin : DEFAULT_BIN,
    cwd: typeof config.cwd === "string" ? config.cwd : ctx.repoRoot,
    path: typeof config.path === "string" ? config.path : ".",
    ...(typeof config.subcommand === "string" ? { subcommand: config.subcommand } : {}),
  };
}

/** Pure: osv-scanner SARIF text -> an AnalyzerResult with the OSV reference. */
export function buildVulnerabilitiesResult(
  sarifText: string,
  ctx: AnalyzerContext,
  cwd: string,
  queriedAt: string,
): AnalyzerResult {
  const externalReferences: ExternalReference[] = [{ source: "OSV (osv.dev)", queriedAt }];
  const run = ingestSarifRun(sarifText, {
    toolId: ID,
    version: VERSION,
    cwd,
    repoRoot: ctx.repoRoot,
    method: "deterministic",
    externalReferences,
  });
  return {
    method: "deterministic",
    externalReferences,
    run,
    measurements: [
      {
        name: "vulnerabilities.count",
        value: run.results.length,
        address: { repo: ctx.repo, path: "", level: "repo" },
        analyzer: ID,
      },
    ],
  };
}

function emptyResult(ctx: AnalyzerContext, queriedAt: string): AnalyzerResult {
  const externalReferences: ExternalReference[] = [{ source: "OSV (osv.dev)", queriedAt }];
  return {
    method: "deterministic",
    externalReferences,
    run: {
      tool: { driver: { name: ID, version: VERSION } },
      results: [],
      properties: { method: "deterministic", externalReferences },
    },
    measurements: [
      {
        name: "vulnerabilities.count",
        value: 0,
        address: { repo: ctx.repo, path: "", level: "repo" },
        analyzer: ID,
      },
    ],
  };
}

export function createVulnerabilitiesAnalyzer(config: Readonly<Record<string, unknown>>): Analyzer {
  return {
    id: ID,
    version: VERSION,
    async analyze(ctx: AnalyzerContext): Promise<AnalyzerResult> {
      const cfg = parseConfig(ctx, config);
      const outDir = await mkdtemp(join(tmpdir(), "ca-osv-"));
      const outFile = join(outDir, "osv.sarif");
      const queriedAt = new Date().toISOString();
      try {
        await exec(
          cfg.bin,
          [
            ...(cfg.subcommand ? [cfg.subcommand] : []),
            "--format",
            "sarif",
            "--output",
            outFile,
            "-r",
            cfg.path,
          ],
          { cwd: cfg.cwd },
        );
        let raw: string | undefined;
        try {
          raw = await readFile(outFile, "utf8");
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
        return raw === undefined
          ? emptyResult(ctx, queriedAt)
          : buildVulnerabilitiesResult(raw, ctx, cfg.cwd, queriedAt);
      } finally {
        await rm(outDir, { recursive: true, force: true });
      }
    },
  };
}
