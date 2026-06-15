/**
 * A minimal, hand-rolled subset of the SARIF 2.1.0 schema — the fields we
 * produce and read. SARIF (OASIS Static Analysis Results Interchange Format) is
 * the industry interchange format for analysis *findings*; we adopt it as our
 * native findings representation rather than inventing one (see ARCHITECTURE).
 *
 * We keep a subset (not a dependency on full SARIF typings) so `core` stays
 * dependency-free and we control exactly what the contract guarantees. Ingested
 * external SARIF is read defensively; emitted SARIF conforms to this subset.
 */

export const SARIF_VERSION = "2.1.0" as const;
export type SarifVersion = typeof SARIF_VERSION;

/** Diagnostic severity. Maps to our hot-zone flagging. */
export type SarifLevel = "none" | "note" | "warning" | "error";

/**
 * The nature of a result. Crucially broader than "defect": `pass` lets a check
 * report success, `informational` a neutral note — so SARIF expresses more than
 * problems. Numeric *measurements*, however, are not results (see Measurement).
 */
export type SarifKind = "notApplicable" | "pass" | "fail" | "open" | "review" | "informational";

export interface SarifRegion {
  readonly startLine?: number;
  readonly startColumn?: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  /** Byte-offset addressing, used when a tool reports spans rather than lines. */
  readonly byteOffset?: number;
  readonly byteLength?: number;
}

export interface SarifArtifactLocation {
  /** Repo-relative POSIX path. Our normalized address coordinate for findings. */
  readonly uri: string;
}

export interface SarifPhysicalLocation {
  readonly artifactLocation: SarifArtifactLocation;
  readonly region?: SarifRegion;
}

export interface SarifLocation {
  readonly physicalLocation?: SarifPhysicalLocation;
}

export interface SarifMessage {
  readonly text: string;
}

export interface SarifResult {
  readonly ruleId?: string;
  readonly level?: SarifLevel;
  readonly kind?: SarifKind;
  readonly message: SarifMessage;
  readonly locations?: readonly SarifLocation[];
  /** Extension point: carries data SARIF lacks (e.g. our determinism method). */
  readonly properties?: Readonly<Record<string, unknown>>;
}

export interface SarifReportingDescriptor {
  readonly id: string;
  readonly name?: string;
}

export interface SarifToolComponent {
  readonly name: string;
  readonly version?: string;
  readonly rules?: readonly SarifReportingDescriptor[];
}

export interface SarifTool {
  readonly driver: SarifToolComponent;
}

/** One analyzer's contribution: a tool plus the results it produced. */
export interface SarifRun {
  readonly tool: SarifTool;
  readonly results: readonly SarifResult[];
  readonly properties?: Readonly<Record<string, unknown>>;
}

export interface SarifLog {
  readonly version: SarifVersion;
  readonly $schema?: string;
  readonly runs: readonly SarifRun[];
}

/** Does a SARIF result warrant attention (i.e. contribute a hot-zone flag)? */
export function isFlaggingResult(result: SarifResult): boolean {
  if (
    result.kind === "pass" ||
    result.kind === "informational" ||
    result.kind === "notApplicable"
  ) {
    return false;
  }
  return result.level === "warning" || result.level === "error";
}
