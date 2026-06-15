/**
 * @code-analyzers/core — the contract.
 *
 * A wrapper *around* SARIF: findings ride in a native SARIF log, while the
 * EvidenceReport adds the dimensions SARIF lacks — numeric measurements and the
 * per-analyzer deterministic/inferred disclosure — plus normalized addressing
 * and the hot-zone rollup. Language-neutral: TypeScript is the first *analyzed*
 * language, but nothing here assumes it (polyglot is a goal).
 */
export { SCHEMA_VERSION, type SchemaVersion } from "./schema.js";
export type { Address, AddressLevel, Range } from "./address.js";
export {
  SARIF_VERSION,
  isFlaggingResult,
  type SarifArtifactLocation,
  type SarifKind,
  type SarifLevel,
  type SarifLocation,
  type SarifLog,
  type SarifMessage,
  type SarifPhysicalLocation,
  type SarifRegion,
  type SarifReportingDescriptor,
  type SarifResult,
  type SarifRun,
  type SarifTool,
  type SarifToolComponent,
  type SarifVersion,
} from "./sarif.js";
export type {
  AnalysisMethod,
  AnalyzerDiagnostic,
  AnalyzerRun,
  AnalyzerStatus,
  EvidenceReport,
  ExternalReference,
  HotZone,
  Measurement,
} from "./evidence.js";
export type { Analyzer, AnalyzerContext, AnalyzerResult } from "./analyzer.js";
export {
  EvidenceError,
  validateAddress,
  validateAnalyzerRun,
  validateEvidenceReport,
  validateMeasurement,
  validateRange,
  validateSarifLog,
} from "./validate.js";
