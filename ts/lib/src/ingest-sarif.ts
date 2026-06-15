import { isAbsolute, resolve } from "node:path";
import type {
  AnalysisMethod,
  ExternalReference,
  SarifKind,
  SarifLevel,
  SarifLocation,
  SarifResult,
  SarifRun,
} from "@code-analyzers/core";
import { normalizeRepoPath } from "./paths.js";

/**
 * Generic SARIF ingest — the leverage point for the security ecosystem.
 *
 * Many tools (gitleaks, osv-scanner, semgrep, …) already emit SARIF. Rather than
 * write a bespoke parser per tool, we normalize their SARIF once: collapse the
 * tool's run(s) into a single run under our analyzer id (so hot-zone signals are
 * clean), **project every result onto our modeled subset** (so unmodeled,
 * possibly-sensitive fields like fingerprints/snippets/codeFlows are dropped by
 * construction), rewrite artifact URIs to repo-relative, and optionally
 * transform each result. Tools whose output is sensitive (gitleaks) additionally
 * supply a `transformResult` that strips even the modeled `properties`.
 */

export interface IngestOptions {
  /** Our analyzer id — becomes the run's tool.driver.name (the signal). */
  readonly toolId: string;
  readonly version: string;
  /** Directory the tool ran in, used to resolve relative artifact URIs. */
  readonly cwd: string;
  /** Repo root, to make URIs repo-relative. */
  readonly repoRoot: string;
  readonly method: AnalysisMethod;
  readonly externalReferences?: readonly ExternalReference[];
  /**
   * Per-result hook applied after projection. Return a (possibly rewritten)
   * result to keep it, or `null` to drop it. A redactor reconstructs minimal
   * safe results here.
   */
  readonly transformResult?: (result: SarifResult) => SarifResult | null;
}

interface RawLog {
  readonly runs?: ReadonlyArray<{ readonly results?: readonly unknown[] }>;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** URI resolved to repo-relative; "" when outside the repo. */
function repoUri(uri: string, cwd: string, repoRoot: string): string {
  return normalizeRepoPath(repoRoot, isAbsolute(uri) ? uri : resolve(cwd, uri));
}

function projectLocations(
  raw: unknown,
  cwd: string,
  repoRoot: string,
): SarifLocation[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: SarifLocation[] = [];
  for (const loc of raw) {
    const phys = isObject(loc) ? loc.physicalLocation : undefined;
    if (!isObject(phys) || !isObject(phys.artifactLocation)) {
      out.push({});
      continue;
    }
    const uri = phys.artifactLocation.uri;
    if (typeof uri !== "string") {
      out.push({});
      continue;
    }
    out.push({
      physicalLocation: {
        artifactLocation: { uri: repoUri(uri, cwd, repoRoot) },
        ...(isObject(phys.region) ? { region: phys.region } : {}),
      },
    });
  }
  return out;
}

/** Build a clean SarifResult from a raw one — unmodeled fields are dropped. */
function projectResult(raw: unknown, cwd: string, repoRoot: string): SarifResult | null {
  if (!isObject(raw)) return null;
  const message =
    isObject(raw.message) && typeof raw.message.text === "string"
      ? { text: raw.message.text }
      : { text: "(no message)" };
  const locations = projectLocations(raw.locations, cwd, repoRoot);
  return {
    message,
    ...(typeof raw.ruleId === "string" ? { ruleId: raw.ruleId } : {}),
    ...(typeof raw.level === "string" ? { level: raw.level as SarifLevel } : {}),
    ...(typeof raw.kind === "string" ? { kind: raw.kind as SarifKind } : {}),
    ...(locations ? { locations } : {}),
    ...(isObject(raw.properties) ? { properties: raw.properties } : {}),
  };
}

export function ingestSarifRun(raw: string | RawLog, options: IngestOptions): SarifRun {
  const log: RawLog = typeof raw === "string" ? (JSON.parse(raw) as RawLog) : raw;
  const results: SarifResult[] = [];

  for (const run of log.runs ?? []) {
    for (const rawResult of run.results ?? []) {
      const projected = projectResult(rawResult, options.cwd, options.repoRoot);
      if (projected === null) continue;
      const transformed = options.transformResult ? options.transformResult(projected) : projected;
      if (transformed === null) continue;
      results.push(transformed);
    }
  }

  return {
    tool: { driver: { name: options.toolId, version: options.version } },
    results,
    properties: {
      method: options.method,
      ...(options.externalReferences ? { externalReferences: options.externalReferences } : {}),
    },
  };
}
