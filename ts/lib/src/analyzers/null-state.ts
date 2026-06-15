import type { AnalyzerResult } from "@code-analyzers/core";

function emptyRun(id: string, version: string, status: "unavailable" | "errored") {
  return {
    tool: { driver: { name: id, version } },
    results: [],
    properties: { method: "deterministic", status },
  };
}

/**
 * The null state for a **missing** tool (`unavailable`). NOT a clean pass: empty
 * findings, plus an OS-agnostic **install pointer** (`helpUrl`) — the remedy is
 * "install it". The orchestrator surfaces this so a consumer fails closed.
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
    run: emptyRun(id, version, "unavailable"),
    diagnostic: {
      message: `"${command}" is not installed or not on PATH — the "${id}" analyzer did not run. Install it: ${helpUrl}`,
      helpUrl,
    },
  };
}

function truncate(s: string, max = 500): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max)}… (truncated)` : t;
}

/**
 * The null state for a tool that **is installed but the run failed** (`errored`)
 * — a *different* case from `unavailable`: installing won't help, so there is no
 * install pointer. It carries the failure detail and (when safe) the tool's
 * stderr for debuggability. Callers handling sensitive tools (secrets) omit
 * `stderr` so a matched secret can't leak via diagnostics.
 */
export function erroredResult(
  id: string,
  version: string,
  detail: string,
  opts: { readonly stderr?: string } = {},
): AnalyzerResult {
  const stderr = opts.stderr ? truncate(opts.stderr) : "";
  return {
    status: "errored",
    method: "deterministic",
    measurements: [],
    run: emptyRun(id, version, "errored"),
    diagnostic: {
      message: `the "${id}" analyzer's tool is installed but the run failed: ${detail}${
        stderr ? ` — stderr: ${stderr}` : ""
      }`,
    },
  };
}
