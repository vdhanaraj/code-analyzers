import type {
  AnalysisMethod,
  SarifKind,
  SarifLevel,
  SarifRegion,
  SarifResult,
  SarifRun,
} from "@code-analyzers/core";

/**
 * Helpers for analyzers to construct SARIF (the native findings format). An
 * analyzer maps its tool's output to results here; tools that already emit
 * SARIF (e.g. semgrep) can pass their runs through instead.
 */

export interface ResultInput {
  readonly ruleId: string;
  readonly level: SarifLevel;
  readonly kind?: SarifKind;
  readonly message: string;
  /** Repo-relative POSIX path. Omit for a repo-level result (no location). */
  readonly uri?: string;
  readonly region?: SarifRegion;
  readonly properties?: Readonly<Record<string, unknown>>;
}

export function makeResult(input: ResultInput): SarifResult {
  const location =
    input.uri !== undefined
      ? [
          {
            physicalLocation: {
              artifactLocation: { uri: input.uri },
              ...(input.region ? { region: input.region } : {}),
            },
          },
        ]
      : undefined;
  return {
    ruleId: input.ruleId,
    level: input.level,
    message: { text: input.message },
    ...(input.kind ? { kind: input.kind } : {}),
    ...(location ? { locations: location } : {}),
    ...(input.properties ? { properties: input.properties } : {}),
  };
}

/**
 * Build a run for one analyzer. `tool` is the analyzer id (the hot-zone signal).
 * The determinism `method` is mirrored into `run.properties` so emitted SARIF is
 * self-describing for standalone consumers, while staying typed on the
 * EvidenceReport's `analyzers[]`.
 */
export function makeRun(
  tool: string,
  version: string,
  results: readonly SarifResult[],
  method: AnalysisMethod,
): SarifRun {
  return {
    tool: { driver: { name: tool, version } },
    results,
    properties: { method },
  };
}
