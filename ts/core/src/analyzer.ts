import type { AnalysisMethod, Measurement } from "./evidence.js";
import type { SarifRun } from "./sarif.js";

/** Immutable context handed to every analyzer at run time. */
export interface AnalyzerContext {
  /** Absolute path to the repository working tree. */
  readonly repoRoot: string;
  /**
   * Logical repo identity. Stable across checkouts so evidence lines up.
   * Often the repo name. (Findings address files via repo-relative SARIF URIs.)
   */
  readonly repo: string;
}

/**
 * What an analyzer emits: findings as a native SARIF run, the numeric
 * measurements SARIF can't express, and its determinism disclosure. The SARIF
 * run's `tool.driver.name` should equal the analyzer's `id` so signals line up.
 */
export interface AnalyzerResult {
  readonly run: SarifRun;
  readonly measurements: readonly Measurement[];
  readonly method: AnalysisMethod;
}

/**
 * The universal interface every wrapped tool wears. Give every tool the same
 * shape, and humans, agents, and harnesses invoke them identically and get back
 * commensurable evidence. Selected at a single wiring point (the registry) by
 * `id`; external drivers/SDKs live only inside the implementation.
 */
export interface Analyzer {
  /** Stable id, also used as the SARIF `tool.driver.name`. e.g. "coverage". */
  readonly id: string;
  /** Version of the wrapper (and/or wrapped tool), for cross-version diff. */
  readonly version: string;
  analyze(ctx: AnalyzerContext): Promise<AnalyzerResult>;
}
