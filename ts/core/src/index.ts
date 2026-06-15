/**
 * @code-analyzers/core — the contract.
 *
 * The dialect-versioned proof schema, normalized addressing, named metrics, and
 * the universal `Analyzer` interface. Language-neutral: TypeScript is the first
 * *analyzed* language, but nothing here assumes it (polyglot is a goal).
 */
export { DIALECT_VERSION, type DialectVersion } from "./dialect.js";
export type { Address, AddressLevel, Range } from "./address.js";
export {
  SEVERITIES,
  type HotZone,
  type Metric,
  type Proof,
  type ProofMethod,
  type ProofResult,
  type Provenance,
  type Report,
  type Severity,
} from "./proof.js";
export type { Analyzer, AnalyzerContext } from "./analyzer.js";
export {
  ProofError,
  validateAddress,
  validateProof,
  validateRange,
  validateReport,
} from "./validate.js";
