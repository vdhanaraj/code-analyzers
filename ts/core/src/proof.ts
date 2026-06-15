import type { Address } from "./address.js";
import type { DialectVersion } from "./dialect.js";

/**
 * How a result was produced.
 *
 * `deterministic` — a fact: the same inputs always yield the same result.
 * `inferred`      — produced (in whole or part) by a non-deterministic model.
 *
 * v1 analyzers always emit `deterministic`. The `inferred` value is reserved
 * now so a future LLM-backed analyzer slots in without a dialect-breaking
 * change, and so a downstream reasoner can *never* mistake an inferred result
 * for hard fact. This honesty is the property the whole thesis rests on.
 */
export type ProofMethod = "deterministic" | "inferred";

/** Where a proof came from and how — enough to trust and combine it. */
export interface Provenance {
  /** Stable analyzer id, e.g. "coverage", "lint". */
  readonly tool: string;
  /** Version of the wrapped tool (and/or wrapper), for cross-version diffing. */
  readonly version: string;
  /** The configuration the tool ran under (serializable). */
  readonly config: Readonly<Record<string, unknown>>;
  /** Hash of the inputs the result was computed over. */
  readonly inputsHash: string;
  readonly method: ProofMethod;
}

/**
 * A named numeric measure attached to a proof. First-class time-series citizen:
 * graphable over time and diffable across versions of the code. `unit` is free
 * text for display ("%", "count", "ms"); `name` is the normalized key compared
 * across versions and (where comparable) across tools.
 */
export interface Metric {
  readonly name: string;
  readonly value: number;
  readonly unit?: string;
}

/** Severity of a finding-style result, coarse -> fine. Ordered for rollups. */
export const SEVERITIES = ["info", "warning", "error"] as const;
export type Severity = (typeof SEVERITIES)[number];

/**
 * The irreducible artifact: a claim plus a deterministic measurement against
 * it, addressed to a sub-object of the codebase, carrying provenance and
 * (optionally) named metrics.
 *
 * Note v1 deliberately does NOT carry an absolute score or better/worse
 * verdict. It guides attention; it does not grade. Comparability comes from
 * same-codebase-same-time, not from a universal scale.
 */
export interface Proof {
  /** What was asserted, in plain language. */
  readonly claim: string;
  /** The deterministic outcome of the claim. */
  readonly result: ProofResult;
  /** The sub-object addressed. */
  readonly scope: Address;
  /** Optional severity for finding-style proofs; absent for pure measures. */
  readonly severity?: Severity;
  /** Named numeric measures, e.g. coverage percentage. */
  readonly metrics?: readonly Metric[];
  readonly provenance: Provenance;
}

/**
 * The deterministic outcome. A discriminated union so a boolean-ish lint pass,
 * a coverage measure, and a finding all share one envelope while staying
 * honestly typed. The set is open-by-version — new kinds arrive with a dialect
 * bump, and consumers branch on `kind`.
 */
export type ProofResult =
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "measure"; readonly value: number; readonly unit?: string }
  | { readonly kind: "finding"; readonly rule: string; readonly message: string };

/** A complete, self-describing report: the dialect-stamped set of proofs. */
export interface Report {
  readonly dialect: DialectVersion;
  /** The repo the report covers (matches every proof's `scope.repo`). */
  readonly repo: string;
  readonly proofs: readonly Proof[];
  /** Attention-guiding rollup — deterministic, never a grade. */
  readonly hotZones: readonly HotZone[];
}

/**
 * A sub-object that warrants attention because multiple deterministic signals
 * land on it. Not a score — a "look here", ordered by how many independent
 * tools flagged the same address.
 */
export interface HotZone {
  readonly scope: Address;
  /** Tool ids that produced a flagging proof here, e.g. ["coverage", "lint"]. */
  readonly signals: readonly string[];
  /** Human-readable reasons, one per contributing signal. */
  readonly reasons: readonly string[];
}
