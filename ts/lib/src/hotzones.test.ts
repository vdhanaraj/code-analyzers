import type { Proof, ProofResult, Severity } from "@code-analyzers/core";
import { describe, expect, it } from "vitest";
import { computeHotZones } from "./hotzones.js";

function proof(
  tool: string,
  path: string,
  result: ProofResult,
  extra: { severity?: Severity; symbol?: string } = {},
): Proof {
  return {
    claim: `${tool} on ${path}`,
    result,
    scope: extra.symbol
      ? { repo: "demo", path, symbol: extra.symbol, level: "symbol" }
      : { repo: "demo", path, level: "path" },
    ...(extra.severity ? { severity: extra.severity } : {}),
    provenance: { tool, version: "1", config: {}, inputsHash: "h", method: "deterministic" },
  };
}

const finding = (rule: string, message: string): ProofResult => ({
  kind: "finding",
  rule,
  message,
});

describe("computeHotZones", () => {
  it("flags a file and lists the tools that landed on it", () => {
    const zones = computeHotZones([
      proof("lint", "src/a.ts", finding("noVar", "use let"), { severity: "warning" }),
      proof("coverage", "src/a.ts", finding("coverage.below-threshold", "40% < 80%"), {
        severity: "warning",
      }),
    ]);
    expect(zones).toHaveLength(1);
    expect(zones[0]?.scope.path).toBe("src/a.ts");
    expect(zones[0]?.signals).toEqual(["lint", "coverage"]);
    expect(zones[0]?.reasons).toHaveLength(2);
  });

  it("ranks files flagged by more distinct tools first", () => {
    const zones = computeHotZones([
      proof("lint", "single.ts", finding("noVar", "use let"), { severity: "warning" }),
      proof("lint", "both.ts", finding("noVar", "use let"), { severity: "warning" }),
      proof("coverage", "both.ts", finding("coverage.below-threshold", "x"), {
        severity: "warning",
      }),
    ]);
    expect(zones.map((z) => z.scope.path)).toEqual(["both.ts", "single.ts"]);
  });

  it("rolls symbol-level findings up to their file", () => {
    const zones = computeHotZones([
      proof("lint", "src/b.ts", finding("noExplicitAny", "avoid any"), {
        severity: "error",
        symbol: "f",
      }),
    ]);
    expect(zones).toHaveLength(1);
    expect(zones[0]?.scope).toEqual({ repo: "demo", path: "src/b.ts", level: "path" });
  });

  it("ignores pure measures and info-level findings", () => {
    const zones = computeHotZones([
      proof("coverage", "src/c.ts", { kind: "measure", value: 100, unit: "%" }),
      proof("lint", "src/c.ts", finding("style", "nit"), { severity: "info" }),
    ]);
    expect(zones).toHaveLength(0);
  });

  it("treats a failed boolean as a flag", () => {
    const zones = computeHotZones([
      proof("coverage", "", { kind: "boolean", value: false }, { severity: "warning" }),
    ]);
    expect(zones).toHaveLength(1);
    expect(zones[0]?.scope.level).toBe("repo");
  });

  it("honors minSignals to require multi-tool agreement", () => {
    const proofs = [
      proof("lint", "solo.ts", finding("noVar", "use let"), { severity: "warning" }),
      proof("lint", "pair.ts", finding("noVar", "use let"), { severity: "warning" }),
      proof("coverage", "pair.ts", finding("coverage.below-threshold", "x"), {
        severity: "warning",
      }),
    ];
    const zones = computeHotZones(proofs, { minSignals: 2 });
    expect(zones.map((z) => z.scope.path)).toEqual(["pair.ts"]);
  });
});
