/**
 * Normalized addressing.
 *
 * For proofs from different tools to be reasoned about *at the same level and
 * in relation to each other*, their scopes resolve to a shared hierarchical
 * coordinate: `repo -> path -> symbol/range`. Coarse tools (coverage) attach at
 * the path level; fine tools (lint) attach at symbol/range. A parent aggregates
 * its children, which is what enables rollups and same-codebase comparison.
 *
 * Canonical addressing is deceptively hard and is deliberately deferred: the
 * wrapping layer normalizes best-effort, and the downstream foundation-model
 * hop (which lives in the *consumer*, never in this tool) absorbs residual
 * imprecision. We invest in precision empirically, once real artifacts give us
 * something to compare.
 */

/** A character/line range within a file. `unit` disambiguates the two. */
export interface Range {
  readonly unit: "line" | "byte";
  readonly start: number;
  readonly end: number;
}

/** The granularity an address resolves to, coarse -> fine. */
export type AddressLevel = "repo" | "path" | "symbol" | "range";

/**
 * A normalized code coordinate. `repo` and `path` are always present; `symbol`
 * and `range` refine it. `level` is the finest populated rung — the rung this
 * address is *about* — so rollups can group by the level above it.
 */
export interface Address {
  readonly repo: string;
  /** Repo-relative POSIX path. "" denotes the repo root (repo-level address). */
  readonly path: string;
  /** Dotted symbol path, e.g. "AuthService.login". */
  readonly symbol?: string;
  readonly range?: Range;
  readonly level: AddressLevel;
}
