import { SARIF_VERSION, type SarifLog, type SarifResult } from "@code-analyzers/core";
import { describe, expect, it } from "vitest";
import { computeHotZones } from "./hotzones.js";
import { makeResult, makeRun } from "./sarif-build.js";

function log(...runs: SarifLog["runs"]): SarifLog {
  return { version: SARIF_VERSION, runs };
}

const fail = (ruleId: string, message: string, uri: string): SarifResult =>
  makeResult({ ruleId, level: "warning", kind: "fail", message, uri });

describe("computeHotZones", () => {
  it("flags a file and lists the tools that landed on it", () => {
    const sarif = log(
      makeRun("lint", "1", [fail("noVar", "use let", "src/a.ts")], "deterministic"),
      makeRun(
        "coverage",
        "1",
        [fail("coverage.below-threshold", "40% < 80%", "src/a.ts")],
        "deterministic",
      ),
    );
    const zones = computeHotZones(sarif, "demo");
    expect(zones).toHaveLength(1);
    expect(zones[0]?.scope.path).toBe("src/a.ts");
    expect(zones[0]?.signals).toEqual(["lint", "coverage"]);
    expect(zones[0]?.reasons).toHaveLength(2);
  });

  it("ranks files flagged by more distinct tools first", () => {
    const sarif = log(
      makeRun(
        "lint",
        "1",
        [fail("noVar", "x", "single.ts"), fail("noVar", "y", "both.ts")],
        "deterministic",
      ),
      makeRun("coverage", "1", [fail("coverage.below-threshold", "z", "both.ts")], "deterministic"),
    );
    const zones = computeHotZones(sarif, "demo");
    expect(zones.map((z) => z.scope.path)).toEqual(["both.ts", "single.ts"]);
  });

  it("ignores pass / informational / note results", () => {
    const sarif = log(
      makeRun(
        "coverage",
        "1",
        [
          makeResult({
            ruleId: "ok",
            level: "none",
            kind: "pass",
            message: "covered",
            uri: "c.ts",
          }),
        ],
        "deterministic",
      ),
      makeRun(
        "lint",
        "1",
        [makeResult({ ruleId: "style", level: "note", message: "nit", uri: "c.ts" })],
        "deterministic",
      ),
    );
    expect(computeHotZones(sarif, "demo")).toHaveLength(0);
  });

  it("treats a repo-level result (no location) as a repo-scope zone", () => {
    const sarif = log(
      makeRun(
        "coverage",
        "1",
        [
          makeResult({
            ruleId: "coverage.report-missing",
            level: "warning",
            kind: "fail",
            message: "no report",
          }),
        ],
        "deterministic",
      ),
    );
    const zones = computeHotZones(sarif, "demo");
    expect(zones).toHaveLength(1);
    expect(zones[0]?.scope.level).toBe("repo");
  });

  it("honors minSignals to require multi-tool agreement", () => {
    const sarif = log(
      makeRun(
        "lint",
        "1",
        [fail("noVar", "x", "solo.ts"), fail("noVar", "y", "pair.ts")],
        "deterministic",
      ),
      makeRun("coverage", "1", [fail("coverage.below-threshold", "z", "pair.ts")], "deterministic"),
    );
    const zones = computeHotZones(sarif, "demo", { minSignals: 2 });
    expect(zones.map((z) => z.scope.path)).toEqual(["pair.ts"]);
  });
});
