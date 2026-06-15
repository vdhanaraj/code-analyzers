import type { Address } from "./address.js";
import type { SarifLog } from "./sarif.js";
import type { SchemaVersion } from "./schema.js";

/**
 * How an analyzer's results were produced.
 *
 * `deterministic` — a fact: same inputs always yield the same output.
 * `inferred`      — produced (in whole or part) by a non-deterministic model.
 *
 * v1/v2 analyzers are all `deterministic`. The value is per-analyzer (a tool is
 * uniformly one or the other), and `inferred` is reserved so a future
 * LLM-backed analyzer slots in without a schema-breaking change — and so a
 * downstream reasoner never mistakes an inferred result for hard fact. This
 * disclosure, and named metrics below, are exactly what SARIF cannot carry and
 * thus why this wrapper exists.
 */
export type AnalysisMethod = "deterministic" | "inferred";

/**
 * A named numeric measurement — the dimension SARIF has no first-class field
 * for. First-class time-series citizen: graphable over time, diffable across
 * versions of the code. `name` is the normalized key compared across versions
 * and (where comparable) across tools.
 */
export interface Measurement {
  readonly name: string;
  readonly value: number;
  readonly unit?: string;
  /** The sub-object the measurement applies to. */
  readonly address: Address;
  /** The analyzer id that produced it (matches an {@link AnalyzerRun}). */
  readonly analyzer: string;
}

/** Per-analyzer provenance + the determinism disclosure for one run. */
/**
 * An outside, evolving source an analyzer consulted (a CVE database, a remote
 * ruleset). Its presence means the run is **deterministic but not necessarily
 * reproducible**: the same code can yield different results later because the
 * *source* changed, not the code. Determinism (`method`) and reproducibility
 * are orthogonal — this records the latter honestly rather than forcing it.
 */
export interface ExternalReference {
  /** Human-readable source, e.g. "OSV (osv.dev)". */
  readonly source: string;
  /** ISO-8601 instant the source was consulted. Accounting, not an input. */
  readonly queriedAt: string;
  /** DB/ruleset revision, if the tool exposes a pinnable one. */
  readonly version?: string;
}

export interface AnalyzerRun {
  readonly tool: string;
  readonly version: string;
  readonly method: AnalysisMethod;
  /** Outside sources consulted, if any (see {@link ExternalReference}). */
  readonly externalReferences?: readonly ExternalReference[];
}

/**
 * A sub-object that warrants attention because deterministic signals land on
 * it. Not a score — a "look here", ranked by how many distinct tools agree.
 */
export interface HotZone {
  readonly scope: Address;
  /** Tool ids whose findings landed here, e.g. ["coverage", "duplication"]. */
  readonly signals: readonly string[];
  readonly reasons: readonly string[];
}

/**
 * The canonical artifact — a wrapper *around* SARIF, not a replacement for it.
 *
 * - `sarif` holds findings natively (one run per analyzer) — the industry
 *   format, so egress is lossless and SARIF-emitting tools ingest directly.
 * - `measurements` and `analyzers[].method` carry what SARIF structurally
 *   cannot (numeric metrics, the deterministic/inferred disclosure).
 * - `hotZones` is the attention rollup computed over both.
 *
 * Different renderers project this one report for different consumers (a robust
 * form for foundation models, a compact form for small local models, raw SARIF
 * for existing tooling).
 */
export interface EvidenceReport {
  readonly schemaVersion: SchemaVersion;
  readonly repo: string;
  readonly sarif: SarifLog;
  readonly measurements: readonly Measurement[];
  readonly analyzers: readonly AnalyzerRun[];
  readonly hotZones: readonly HotZone[];
}
