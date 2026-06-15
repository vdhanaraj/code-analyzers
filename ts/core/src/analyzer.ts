import type { Proof } from "./proof.js";

/** Immutable context handed to every analyzer at run time. */
export interface AnalyzerContext {
  /** Absolute path to the repository working tree. */
  readonly repoRoot: string;
  /**
   * Logical repo identity stamped into every `Address.repo`. Stable across
   * checkouts so proofs from different machines line up. Often the repo name.
   */
  readonly repo: string;
}

/**
 * The universal interface every wrapped tool wears. This is the whole premise:
 * give every tool the same shape, and humans, agents, and harnesses invoke them
 * identically and get back commensurable evidence.
 *
 * An analyzer is selected at a single wiring point (the registry) via its `id`;
 * external drivers/SDKs live only inside the implementation and are never
 * imported elsewhere. Adding a tool = a module plus a registry entry.
 */
export interface Analyzer {
  /** Stable id, also stamped as `provenance.tool`. e.g. "coverage". */
  readonly id: string;
  /** Version of the wrapper (and/or the wrapped tool), for cross-version diff. */
  readonly version: string;
  /**
   * Run the tool against the context and emit a set of proofs, each addressed
   * to a sub-object. Returns `[]` (not throw) when the tool finds nothing.
   */
  analyze(ctx: AnalyzerContext): Promise<readonly Proof[]>;
}
