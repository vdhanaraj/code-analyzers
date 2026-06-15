import { describe, expect, it } from "vitest";
import type { Address, Proof, Report } from "./index.js";
import {
  DIALECT_VERSION,
  ProofError,
  validateAddress,
  validateProof,
  validateReport,
} from "./index.js";

const goodAddress: Address = {
  repo: "demo",
  path: "src/a.ts",
  range: { unit: "line", start: 1, end: 9 },
  level: "range",
};

const goodProof: Proof = {
  claim: "lib/a.ts is fully covered",
  result: { kind: "measure", value: 100, unit: "%" },
  scope: { repo: "demo", path: "src/a.ts", level: "path" },
  metrics: [{ name: "coverage.lines.pct", value: 100, unit: "%" }],
  provenance: {
    tool: "coverage",
    version: "1",
    config: {},
    inputsHash: "abc",
    method: "deterministic",
  },
};

const goodReport: Report = {
  dialect: DIALECT_VERSION,
  repo: "demo",
  proofs: [goodProof],
  hotZones: [],
};

/** Walk to a nested object key and replace it, returning a deep-ish clone. */
function withOverride<T>(base: T, mutate: (clone: Record<string, unknown>) => void): unknown {
  const clone = structuredClone(base) as Record<string, unknown>;
  mutate(clone);
  return clone;
}

describe("validateProof — accepts well-formed proofs", () => {
  it("round-trips a valid measure proof", () => {
    expect(validateProof(goodProof)).toEqual(goodProof);
  });

  it("accepts each result kind", () => {
    for (const result of [
      { kind: "boolean", value: false },
      { kind: "measure", value: 3.2 },
      { kind: "finding", rule: "noExplicitAny", message: "avoid any" },
    ] as const) {
      expect(() => validateProof({ ...goodProof, result })).not.toThrow();
    }
  });
});

describe("validateProof — rejects malformed proofs (negative cases)", () => {
  const cases: Array<[string, unknown, string]> = [
    ["non-object", 42, "proof"],
    [
      "empty claim",
      withOverride(goodProof, (c) => {
        c.claim = "";
      }),
      "proof.claim",
    ],
    [
      "missing claim",
      withOverride(goodProof, (c) => {
        c.claim = undefined;
      }),
      "proof.claim",
    ],
    [
      "unknown result kind",
      withOverride(goodProof, (c) => {
        c.result = { kind: "vibes", value: 1 };
      }),
      "proof.result.kind",
    ],
    [
      "measure with NaN",
      withOverride(goodProof, (c) => {
        c.result = { kind: "measure", value: Number.NaN };
      }),
      "proof.result.value",
    ],
    [
      "boolean with non-boolean value",
      withOverride(goodProof, (c) => {
        c.result = { kind: "boolean", value: "yes" };
      }),
      "proof.result.value",
    ],
    [
      "finding missing message",
      withOverride(goodProof, (c) => {
        c.result = { kind: "finding", rule: "r" };
      }),
      "proof.result.message",
    ],
    [
      "bad provenance.method",
      withOverride(goodProof, (c) => {
        (c.provenance as Record<string, unknown>).method = "guessed";
      }),
      "proof.provenance.method",
    ],
    [
      "missing inputsHash",
      withOverride(goodProof, (c) => {
        (c.provenance as Record<string, unknown>).inputsHash = undefined;
      }),
      "proof.provenance.inputsHash",
    ],
    [
      "bad severity",
      withOverride(goodProof, (c) => {
        c.severity = "fatal";
      }),
      "proof.severity",
    ],
    [
      "metric with empty name",
      withOverride(goodProof, (c) => {
        c.metrics = [{ name: "", value: 1 }];
      }),
      "proof.metrics[0].name",
    ],
    [
      "metric with non-number value",
      withOverride(goodProof, (c) => {
        c.metrics = [{ name: "x", value: "1" }];
      }),
      "proof.metrics[0].value",
    ],
  ];

  for (const [name, input, expectedPath] of cases) {
    it(`rejects ${name}`, () => {
      expect(() => validateProof(input)).toThrow(ProofError);
      try {
        validateProof(input);
      } catch (e) {
        expect((e as ProofError).path).toBe(expectedPath);
      }
    });
  }
});

describe("validateAddress — level/rung consistency", () => {
  it("accepts a well-formed range address", () => {
    expect(validateAddress(goodAddress)).toEqual(goodAddress);
  });

  it("rejects empty repo", () => {
    expect(() => validateAddress({ repo: "", path: "a", level: "path" })).toThrow(/scope\.repo/);
  });

  it("rejects symbol-level address without a symbol", () => {
    expect(() => validateAddress({ repo: "r", path: "a.ts", level: "symbol" })).toThrow(
      /scope\.symbol/,
    );
  });

  it("rejects range-level address without a range", () => {
    expect(() => validateAddress({ repo: "r", path: "a.ts", level: "range" })).toThrow(
      /scope\.range/,
    );
  });

  it("rejects path-level address with empty path", () => {
    expect(() => validateAddress({ repo: "r", path: "", level: "path" })).toThrow(/scope\.path/);
  });

  it("rejects a range whose end precedes start", () => {
    expect(() =>
      validateAddress({
        repo: "r",
        path: "a",
        level: "range",
        range: { unit: "line", start: 9, end: 1 },
      }),
    ).toThrow(/range\.end/);
  });
});

describe("validateReport — dialect + cross-field invariants", () => {
  it("accepts a well-formed report", () => {
    expect(validateReport(goodReport)).toEqual(goodReport);
  });

  it("rejects an unsupported dialect", () => {
    expect(() => validateReport({ ...goodReport, dialect: "0" })).toThrow(/dialect/);
  });

  it("rejects a proof whose scope.repo disagrees with the report repo", () => {
    const mismatched = withOverride(goodReport, (c) => {
      (c.proofs as Proof[])[0] = { ...goodProof, scope: { ...goodProof.scope, repo: "other" } };
    });
    expect(() => validateReport(mismatched)).toThrow(/does not match report repo/);
  });
});
