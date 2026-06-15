import type { Address, Range } from "./address.js";
import type {
  AnalysisMethod,
  AnalyzerRun,
  EvidenceReport,
  HotZone,
  Measurement,
} from "./evidence.js";
import {
  SARIF_VERSION,
  type SarifLevel,
  type SarifLog,
  type SarifResult,
  type SarifRun,
} from "./sarif.js";
import { SCHEMA_VERSION } from "./schema.js";

/**
 * Hand-written validators (no external schema library) so `core` depends on
 * nothing. They are the contract's gate: malformed evidence is *proven* to be
 * rejected (negative tests) rather than flowing downstream where a reasoner
 * would trust it. Our wrapper fields are validated strictly; the embedded SARIF
 * is validated structurally (enough to trust, not a full 2.1.0 conformance
 * check) since runs may originate from arbitrary external tools.
 *
 * Each validator returns the value typed on success, or throws `EvidenceError`
 * with a path-qualified message on the first violation.
 */
export class EvidenceError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "EvidenceError";
  }
}

const ADDRESS_LEVELS = ["repo", "path", "symbol", "range"] as const;
const ANALYSIS_METHODS = ["deterministic", "inferred"] as const;
const SARIF_LEVELS = ["none", "note", "warning", "error"] as const;
const SARIF_KINDS = ["notApplicable", "pass", "fail", "open", "review", "informational"] as const;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function reqString(v: unknown, path: string): string {
  if (typeof v !== "string") throw new EvidenceError("expected string", path);
  return v;
}

function reqNonEmpty(v: unknown, path: string): string {
  const s = reqString(v, path);
  if (s === "") throw new EvidenceError("must be non-empty", path);
  return s;
}

function reqFiniteNumber(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new EvidenceError("expected finite number", path);
  }
  return v;
}

function reqArray(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new EvidenceError("expected array", path);
  return v;
}

function reqEnum<T extends string>(v: unknown, allowed: readonly T[], path: string): T {
  if (typeof v !== "string" || !allowed.includes(v as T)) {
    throw new EvidenceError(`expected one of ${allowed.join(" | ")}`, path);
  }
  return v as T;
}

function optEnum<T extends string>(v: unknown, allowed: readonly T[], path: string): T | undefined {
  return v === undefined ? undefined : reqEnum(v, allowed, path);
}

export function validateRange(v: unknown, path = "range"): Range {
  if (!isObject(v)) throw new EvidenceError("expected object", path);
  const unit = reqEnum(v.unit, ["line", "byte"] as const, `${path}.unit`);
  const start = reqFiniteNumber(v.start, `${path}.start`);
  const end = reqFiniteNumber(v.end, `${path}.end`);
  if (start < 0) throw new EvidenceError("must be >= 0", `${path}.start`);
  if (end < start) throw new EvidenceError("end must be >= start", `${path}.end`);
  return { unit, start, end };
}

export function validateAddress(v: unknown, path = "address"): Address {
  if (!isObject(v)) throw new EvidenceError("expected object", path);
  const repo = reqNonEmpty(v.repo, `${path}.repo`);
  const pathField = reqString(v.path, `${path}.path`);
  const level = reqEnum(v.level, ADDRESS_LEVELS, `${path}.level`);
  const out: { -readonly [K in keyof Address]: Address[K] } = { repo, path: pathField, level };
  if (v.symbol !== undefined) out.symbol = reqString(v.symbol, `${path}.symbol`);
  if (v.range !== undefined) out.range = validateRange(v.range, `${path}.range`);

  if ((level === "path" || level === "symbol" || level === "range") && pathField === "") {
    throw new EvidenceError(`level "${level}" requires a non-empty path`, `${path}.path`);
  }
  if (level === "symbol" && out.symbol === undefined) {
    throw new EvidenceError('level "symbol" requires a symbol', `${path}.symbol`);
  }
  if (level === "range" && out.range === undefined) {
    throw new EvidenceError('level "range" requires a range', `${path}.range`);
  }
  return out;
}

export function validateMeasurement(v: unknown, path = "measurement"): Measurement {
  if (!isObject(v)) throw new EvidenceError("expected object", path);
  const out: { -readonly [K in keyof Measurement]: Measurement[K] } = {
    name: reqNonEmpty(v.name, `${path}.name`),
    value: reqFiniteNumber(v.value, `${path}.value`),
    address: validateAddress(v.address, `${path}.address`),
    analyzer: reqNonEmpty(v.analyzer, `${path}.analyzer`),
  };
  if (v.unit !== undefined) out.unit = reqString(v.unit, `${path}.unit`);
  return out;
}

export function validateAnalyzerRun(v: unknown, path = "analyzer"): AnalyzerRun {
  if (!isObject(v)) throw new EvidenceError("expected object", path);
  return {
    tool: reqNonEmpty(v.tool, `${path}.tool`),
    version: reqString(v.version, `${path}.version`),
    method: reqEnum<AnalysisMethod>(v.method, ANALYSIS_METHODS, `${path}.method`),
  };
}

function validateSarifResult(v: unknown, path: string): SarifResult {
  if (!isObject(v)) throw new EvidenceError("expected object", path);
  if (!isObject(v.message)) throw new EvidenceError("expected object", `${path}.message`);
  const result: { -readonly [K in keyof SarifResult]: SarifResult[K] } = {
    message: { text: reqString(v.message.text, `${path}.message.text`) },
  };
  if (v.ruleId !== undefined) result.ruleId = reqString(v.ruleId, `${path}.ruleId`);
  const level = optEnum<SarifLevel>(v.level, SARIF_LEVELS, `${path}.level`);
  if (level !== undefined) result.level = level;
  const kind = optEnum(v.kind, SARIF_KINDS, `${path}.kind`);
  if (kind !== undefined) result.kind = kind;
  if (v.locations !== undefined) {
    const locs = reqArray(v.locations, `${path}.locations`);
    result.locations = locs.map((loc, i) => {
      if (!isObject(loc)) throw new EvidenceError("expected object", `${path}.locations[${i}]`);
      const phys = loc.physicalLocation;
      if (phys === undefined) return {};
      if (!isObject(phys))
        throw new EvidenceError("expected object", `${path}.locations[${i}].physicalLocation`);
      const artifact = phys.artifactLocation;
      if (!isObject(artifact)) {
        throw new EvidenceError(
          "expected object",
          `${path}.locations[${i}].physicalLocation.artifactLocation`,
        );
      }
      return {
        physicalLocation: {
          artifactLocation: {
            uri: reqString(
              artifact.uri,
              `${path}.locations[${i}].physicalLocation.artifactLocation.uri`,
            ),
          },
          ...(phys.region !== undefined && isObject(phys.region) ? { region: phys.region } : {}),
        },
      };
    });
  }
  if (isObject(v.properties)) result.properties = v.properties;
  return result;
}

function validateSarifRun(v: unknown, path: string): SarifRun {
  if (!isObject(v)) throw new EvidenceError("expected object", path);
  if (!isObject(v.tool) || !isObject(v.tool.driver)) {
    throw new EvidenceError("expected tool.driver object", `${path}.tool.driver`);
  }
  const driverName = reqNonEmpty(v.tool.driver.name, `${path}.tool.driver.name`);
  const results = reqArray(v.results, `${path}.results`).map((r, i) =>
    validateSarifResult(r, `${path}.results[${i}]`),
  );
  const run: { -readonly [K in keyof SarifRun]: SarifRun[K] } = {
    tool: { driver: { name: driverName } },
    results,
  };
  if (typeof v.tool.driver.version === "string") {
    run.tool = { driver: { name: driverName, version: v.tool.driver.version } };
  }
  if (isObject(v.properties)) run.properties = v.properties;
  return run;
}

export function validateSarifLog(v: unknown, path = "sarif"): SarifLog {
  if (!isObject(v)) throw new EvidenceError("expected object", path);
  if (v.version !== SARIF_VERSION) {
    throw new EvidenceError(
      `unsupported SARIF version (expected "${SARIF_VERSION}")`,
      `${path}.version`,
    );
  }
  const runs = reqArray(v.runs, `${path}.runs`).map((r, i) =>
    validateSarifRun(r, `${path}.runs[${i}]`),
  );
  return { version: SARIF_VERSION, runs };
}

function validateHotZone(v: unknown, path: string): HotZone {
  if (!isObject(v)) throw new EvidenceError("expected object", path);
  return {
    scope: validateAddress(v.scope, `${path}.scope`),
    signals: reqArray(v.signals, `${path}.signals`).map((s, j) =>
      reqString(s, `${path}.signals[${j}]`),
    ),
    reasons: reqArray(v.reasons, `${path}.reasons`).map((r, j) =>
      reqString(r, `${path}.reasons[${j}]`),
    ),
  };
}

export function validateEvidenceReport(v: unknown, path = "report"): EvidenceReport {
  if (!isObject(v)) throw new EvidenceError("expected object", path);
  if (v.schemaVersion !== SCHEMA_VERSION) {
    throw new EvidenceError(
      `unsupported schemaVersion (expected "${SCHEMA_VERSION}")`,
      `${path}.schemaVersion`,
    );
  }
  const repo = reqNonEmpty(v.repo, `${path}.repo`);
  const sarif = validateSarifLog(v.sarif, `${path}.sarif`);
  const measurements = reqArray(v.measurements, `${path}.measurements`).map((m, i) => {
    const measurement = validateMeasurement(m, `${path}.measurements[${i}]`);
    if (measurement.address.repo !== repo) {
      throw new EvidenceError(
        `address.repo "${measurement.address.repo}" does not match report repo "${repo}"`,
        `${path}.measurements[${i}].address.repo`,
      );
    }
    return measurement;
  });
  const analyzers = reqArray(v.analyzers, `${path}.analyzers`).map((a, i) =>
    validateAnalyzerRun(a, `${path}.analyzers[${i}]`),
  );
  const hotZones = reqArray(v.hotZones, `${path}.hotZones`).map((z, i) =>
    validateHotZone(z, `${path}.hotZones[${i}]`),
  );
  return { schemaVersion: SCHEMA_VERSION, repo, sarif, measurements, analyzers, hotZones };
}
