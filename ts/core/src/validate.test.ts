import { describe, expect, it } from "vitest";
import type { EvidenceReport, Measurement, SarifLog } from "./index.js";
import {
  EvidenceError,
  SARIF_VERSION,
  SCHEMA_VERSION,
  isFlaggingResult,
  validateAddress,
  validateEvidenceReport,
  validateMeasurement,
  validateSarifLog,
} from "./index.js";

const sarif: SarifLog = {
  version: SARIF_VERSION,
  runs: [
    {
      tool: { driver: { name: "lint", version: "1" } },
      results: [
        {
          ruleId: "lint/style/noVar",
          level: "error",
          kind: "fail",
          message: { text: "Use let or const instead of var." },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: "src/a.ts" },
                region: { byteOffset: 12, byteLength: 3 },
              },
            },
          ],
          properties: { method: "deterministic" },
        },
      ],
    },
  ],
};

const measurement: Measurement = {
  name: "coverage.statements.pct",
  value: 84,
  unit: "%",
  address: { repo: "demo", path: "src/a.ts", level: "path" },
  analyzer: "coverage",
};

const goodReport: EvidenceReport = {
  schemaVersion: SCHEMA_VERSION,
  repo: "demo",
  sarif,
  measurements: [measurement],
  analyzers: [{ tool: "lint", version: "1", method: "deterministic", status: "ok" }],
  hotZones: [],
};

function withOverride<T>(base: T, mutate: (clone: Record<string, unknown>) => void): unknown {
  const clone = structuredClone(base) as Record<string, unknown>;
  mutate(clone);
  return clone;
}

describe("validateEvidenceReport — accepts well-formed reports", () => {
  it("round-trips a valid report", () => {
    expect(validateEvidenceReport(goodReport)).toEqual(goodReport);
  });
});

describe("validateEvidenceReport — rejects malformed reports (negative cases)", () => {
  const cases: Array<[string, unknown, string]> = [
    ["non-object", 7, "report"],
    [
      "wrong schemaVersion",
      withOverride(goodReport, (c) => {
        c.schemaVersion = "1";
      }),
      "report.schemaVersion",
    ],
    [
      "empty repo",
      withOverride(goodReport, (c) => {
        c.repo = "";
      }),
      "report.repo",
    ],
    [
      "wrong SARIF version",
      withOverride(goodReport, (c) => {
        (c.sarif as SarifLog as Record<string, unknown>).version = "2.0.0";
      }),
      "report.sarif.version",
    ],
    [
      "run missing tool.driver.name",
      withOverride(goodReport, (c) => {
        ((c.sarif as Record<string, unknown>).runs as unknown[])[0] = {
          tool: { driver: {} },
          results: [],
        };
      }),
      "report.sarif.runs[0].tool.driver.name",
    ],
    [
      "result missing message.text",
      withOverride(goodReport, (c) => {
        (
          ((c.sarif as Record<string, unknown>).runs as Record<string, unknown>[])[0] as Record<
            string,
            unknown
          >
        ).results = [{ message: {} }];
      }),
      "report.sarif.runs[0].results[0].message.text",
    ],
    [
      "bad result level",
      withOverride(goodReport, (c) => {
        (
          ((c.sarif as Record<string, unknown>).runs as Record<string, unknown>[])[0] as Record<
            string,
            unknown
          >
        ).results = [{ message: { text: "x" }, level: "boom" }];
      }),
      "report.sarif.runs[0].results[0].level",
    ],
    [
      "measurement NaN value",
      withOverride(goodReport, (c) => {
        (c.measurements as Measurement[])[0] = { ...measurement, value: Number.NaN };
      }),
      "report.measurements[0].value",
    ],
    [
      "measurement empty name",
      withOverride(goodReport, (c) => {
        (c.measurements as Measurement[])[0] = { ...measurement, name: "" };
      }),
      "report.measurements[0].name",
    ],
    [
      "bad analyzer method",
      withOverride(goodReport, (c) => {
        (c.analyzers as Record<string, unknown>[])[0] = {
          tool: "x",
          version: "1",
          method: "guessed",
        };
      }),
      "report.analyzers[0].method",
    ],
    [
      "measurements not array",
      withOverride(goodReport, (c) => {
        c.measurements = {};
      }),
      "report.measurements",
    ],
  ];

  for (const [name, input, expectedPath] of cases) {
    it(`rejects ${name}`, () => {
      expect(() => validateEvidenceReport(input)).toThrow(EvidenceError);
      try {
        validateEvidenceReport(input);
      } catch (e) {
        expect((e as EvidenceError).path).toBe(expectedPath);
      }
    });
  }

  it("rejects a measurement whose address.repo disagrees with the report repo", () => {
    const mismatched = withOverride(goodReport, (c) => {
      (c.measurements as Measurement[])[0] = {
        ...measurement,
        address: { ...measurement.address, repo: "other" },
      };
    });
    expect(() => validateEvidenceReport(mismatched)).toThrow(/does not match report repo/);
  });
});

describe("validateSarifLog — light structural validation of arbitrary SARIF", () => {
  it("accepts a minimal log and preserves property bags", () => {
    const log = validateSarifLog(sarif);
    expect(log.runs[0]?.results[0]?.properties).toEqual({ method: "deterministic" });
  });
});

describe("validateMeasurement + validateAddress", () => {
  it("round-trips a measurement", () => {
    expect(validateMeasurement(measurement)).toEqual(measurement);
  });

  it("rejects a symbol-level address without a symbol", () => {
    expect(() => validateAddress({ repo: "r", path: "a.ts", level: "symbol" })).toThrow(/symbol/);
  });
});

describe("isFlaggingResult", () => {
  it("flags warning/error fail results, not pass/informational", () => {
    expect(isFlaggingResult({ message: { text: "x" }, level: "error", kind: "fail" })).toBe(true);
    expect(isFlaggingResult({ message: { text: "x" }, level: "warning" })).toBe(true);
    expect(isFlaggingResult({ message: { text: "x" }, level: "error", kind: "pass" })).toBe(false);
    expect(isFlaggingResult({ message: { text: "x" }, level: "note" })).toBe(false);
    expect(isFlaggingResult({ message: { text: "x" }, kind: "informational" })).toBe(false);
  });
});
