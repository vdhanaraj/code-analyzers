import type { AnalyzerResult } from "@code-analyzers/core";

/**
 * The null state an analyzer emits when its underlying tool is missing. It is
 * NOT a clean pass: empty findings, but `status: "unavailable"` and a diagnostic
 * pointing at an OS-agnostic install resource. The orchestrator surfaces this on
 * the report so a consumer fails closed instead of mistaking "didn't run" for
 * "nothing wrong".
 */
export function unavailableResult(
  id: string,
  version: string,
  command: string,
  helpUrl: string,
): AnalyzerResult {
  return {
    status: "unavailable",
    method: "deterministic",
    measurements: [],
    run: {
      tool: { driver: { name: id, version } },
      results: [],
      properties: { method: "deterministic", status: "unavailable" },
    },
    diagnostic: {
      message: `"${command}" is not installed or not on PATH — the "${id}" analyzer did not run. Install it: ${helpUrl}`,
      helpUrl,
    },
  };
}
