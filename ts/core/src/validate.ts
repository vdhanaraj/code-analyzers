import type { Address, Range } from "./address.js";
import { DIALECT_VERSION } from "./dialect.js";
import {
  type Metric,
  type Proof,
  type ProofResult,
  type Provenance,
  type Report,
  SEVERITIES,
  type Severity,
} from "./proof.js";

/**
 * Hand-written validators (no external schema library) so `core` depends on
 * nothing. They are the contract's gate: security-/correctness-critical paths
 * get explicit negative tests, so malformed proofs are *proven* to be rejected
 * rather than silently flowing downstream where a reasoner would trust them.
 *
 * Each validator returns the value typed on success, or throws `ProofError`
 * with a path-qualified message on the first violation.
 */
export class ProofError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "ProofError";
  }
}

const ADDRESS_LEVELS = ["repo", "path", "symbol", "range"] as const;
const PROOF_METHODS = ["deterministic", "inferred"] as const;
const RESULT_KINDS = ["boolean", "measure", "finding"] as const;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function reqString(v: unknown, path: string): string {
  if (typeof v !== "string") throw new ProofError("expected string", path);
  return v;
}

function reqFiniteNumber(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new ProofError("expected finite number", path);
  }
  return v;
}

function reqEnum<T extends string>(v: unknown, allowed: readonly T[], path: string): T {
  if (typeof v !== "string" || !allowed.includes(v as T)) {
    throw new ProofError(`expected one of ${allowed.join(" | ")}`, path);
  }
  return v as T;
}

export function validateRange(v: unknown, path = "range"): Range {
  if (!isObject(v)) throw new ProofError("expected object", path);
  const unit = reqEnum(v.unit, ["line", "byte"] as const, `${path}.unit`);
  const start = reqFiniteNumber(v.start, `${path}.start`);
  const end = reqFiniteNumber(v.end, `${path}.end`);
  if (start < 0) throw new ProofError("must be >= 0", `${path}.start`);
  if (end < start) throw new ProofError("end must be >= start", `${path}.end`);
  return { unit, start, end };
}

export function validateAddress(v: unknown, path = "scope"): Address {
  if (!isObject(v)) throw new ProofError("expected object", path);
  const repo = reqString(v.repo, `${path}.repo`);
  if (repo === "") throw new ProofError("must be non-empty", `${path}.repo`);
  const pathField = reqString(v.path, `${path}.path`);
  const level = reqEnum(v.level, ADDRESS_LEVELS, `${path}.level`);
  const out: { -readonly [K in keyof Address]: Address[K] } = { repo, path: pathField, level };
  if (v.symbol !== undefined) out.symbol = reqString(v.symbol, `${path}.symbol`);
  if (v.range !== undefined) out.range = validateRange(v.range, `${path}.range`);

  // Level must be consistent with the populated rungs.
  if ((level === "path" || level === "symbol" || level === "range") && pathField === "") {
    throw new ProofError(`level "${level}" requires a non-empty path`, `${path}.path`);
  }
  if (level === "symbol" && out.symbol === undefined) {
    throw new ProofError('level "symbol" requires a symbol', `${path}.symbol`);
  }
  if (level === "range" && out.range === undefined) {
    throw new ProofError('level "range" requires a range', `${path}.range`);
  }
  return out;
}

function validateProvenance(v: unknown, path = "provenance"): Provenance {
  if (!isObject(v)) throw new ProofError("expected object", path);
  if (!isObject(v.config)) throw new ProofError("expected object", `${path}.config`);
  return {
    tool: reqString(v.tool, `${path}.tool`),
    version: reqString(v.version, `${path}.version`),
    config: v.config,
    inputsHash: reqString(v.inputsHash, `${path}.inputsHash`),
    method: reqEnum(v.method, PROOF_METHODS, `${path}.method`),
  };
}

function validateMetric(v: unknown, path: string): Metric {
  if (!isObject(v)) throw new ProofError("expected object", path);
  const metric: { -readonly [K in keyof Metric]: Metric[K] } = {
    name: reqString(v.name, `${path}.name`),
    value: reqFiniteNumber(v.value, `${path}.value`),
  };
  if (metric.name === "") throw new ProofError("must be non-empty", `${path}.name`);
  if (v.unit !== undefined) metric.unit = reqString(v.unit, `${path}.unit`);
  return metric;
}

function validateResult(v: unknown, path = "result"): ProofResult {
  if (!isObject(v)) throw new ProofError("expected object", path);
  const kind = reqEnum(v.kind, RESULT_KINDS, `${path}.kind`);
  switch (kind) {
    case "boolean": {
      if (typeof v.value !== "boolean") throw new ProofError("expected boolean", `${path}.value`);
      return { kind, value: v.value };
    }
    case "measure": {
      const out: Extract<ProofResult, { kind: "measure" }> = {
        kind,
        value: reqFiniteNumber(v.value, `${path}.value`),
        ...(v.unit !== undefined ? { unit: reqString(v.unit, `${path}.unit`) } : {}),
      };
      return out;
    }
    case "finding": {
      return {
        kind,
        rule: reqString(v.rule, `${path}.rule`),
        message: reqString(v.message, `${path}.message`),
      };
    }
  }
}

export function validateProof(v: unknown, path = "proof"): Proof {
  if (!isObject(v)) throw new ProofError("expected object", path);
  const proof: { -readonly [K in keyof Proof]: Proof[K] } = {
    claim: reqString(v.claim, `${path}.claim`),
    result: validateResult(v.result, `${path}.result`),
    scope: validateAddress(v.scope, `${path}.scope`),
    provenance: validateProvenance(v.provenance, `${path}.provenance`),
  };
  if (proof.claim === "") throw new ProofError("must be non-empty", `${path}.claim`);
  if (v.severity !== undefined) {
    proof.severity = reqEnum<Severity>(v.severity, SEVERITIES, `${path}.severity`);
  }
  if (v.metrics !== undefined) {
    if (!Array.isArray(v.metrics)) throw new ProofError("expected array", `${path}.metrics`);
    proof.metrics = v.metrics.map((m, i) => validateMetric(m, `${path}.metrics[${i}]`));
  }
  return proof;
}

export function validateReport(v: unknown, path = "report"): Report {
  if (!isObject(v)) throw new ProofError("expected object", path);
  if (v.dialect !== DIALECT_VERSION) {
    throw new ProofError(`unsupported dialect (expected "${DIALECT_VERSION}")`, `${path}.dialect`);
  }
  const repo = reqString(v.repo, `${path}.repo`);
  if (!Array.isArray(v.proofs)) throw new ProofError("expected array", `${path}.proofs`);
  const proofs = v.proofs.map((p, i) => {
    const proof = validateProof(p, `${path}.proofs[${i}]`);
    if (proof.scope.repo !== repo) {
      throw new ProofError(
        `scope.repo "${proof.scope.repo}" does not match report repo "${repo}"`,
        `${path}.proofs[${i}].scope.repo`,
      );
    }
    return proof;
  });
  if (!Array.isArray(v.hotZones)) throw new ProofError("expected array", `${path}.hotZones`);
  // Hot zones are derived; validate their scope shape but trust assembly otherwise.
  const hotZones = v.hotZones.map((z, i) => {
    if (!isObject(z)) throw new ProofError("expected object", `${path}.hotZones[${i}]`);
    const scope = validateAddress(z.scope, `${path}.hotZones[${i}].scope`);
    if (!Array.isArray(z.signals)) {
      throw new ProofError("expected array", `${path}.hotZones[${i}].signals`);
    }
    if (!Array.isArray(z.reasons)) {
      throw new ProofError("expected array", `${path}.hotZones[${i}].reasons`);
    }
    return {
      scope,
      signals: z.signals.map((s, j) => reqString(s, `${path}.hotZones[${i}].signals[${j}]`)),
      reasons: z.reasons.map((r, j) => reqString(r, `${path}.hotZones[${i}].reasons[${j}]`)),
    };
  });
  return { dialect: DIALECT_VERSION, repo, proofs, hotZones };
}
