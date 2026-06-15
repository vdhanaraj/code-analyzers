/**
 * @code-analyzers/lib — the orchestration layer.
 *
 * The exported {@link CodeAnalyzer} class runs analyzers behind the universal
 * interface, validates at the seam, and assembles a schema-versioned report with
 * a deterministic hot-zone rollup. {@link defaultRegistry} is the built-in
 * wiring point (coverage + lint).
 */
export { CodeAnalyzer, AnalyzerContractError } from "./orchestrator.js";
export type { AnalyzerSpec, CodeAnalyzerOptions } from "./orchestrator.js";
export { AnalyzerRegistry } from "./registry.js";
export type { AnalyzerFactory } from "./registry.js";
export { computeHotZones } from "./hotzones.js";
export type { HotZoneOptions } from "./hotzones.js";
export { defaultRegistry } from "./builtins.js";
export { sha256 } from "./hash.js";
export { normalizeRepoPath, toPosix } from "./paths.js";
