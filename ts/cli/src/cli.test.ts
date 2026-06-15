import type { Report } from "@code-analyzers/core";
import { describe, expect, it } from "vitest";
import { parseArgs } from "./args.js";
import { renderReport } from "./render.js";

describe("parseArgs", () => {
  it("defaults to both analyzers, minSignals 1, current dir", () => {
    const parsed = parseArgs([]);
    expect(parsed).toMatchObject({
      kind: "run",
      options: { repoRoot: ".", minSignals: 1, json: false },
    });
    if (parsed.kind === "run") {
      expect(parsed.options.analyzers.map((a) => a.id)).toEqual(["coverage", "lint"]);
    }
  });

  it("returns help for --help", () => {
    expect(parseArgs(["--help"]).kind).toBe("help");
  });

  it("threads analyzer config (lint cwd, coverage threshold)", () => {
    const parsed = parseArgs([
      ".",
      "--analyzers",
      "coverage,lint",
      "--threshold",
      "50",
      "--lint-cwd",
      "ts",
      "--lint-paths",
      "src,test",
    ]);
    if (parsed.kind !== "run") throw new Error("expected run");
    const coverage = parsed.options.analyzers.find((a) => a.id === "coverage");
    const lint = parsed.options.analyzers.find((a) => a.id === "lint");
    expect(coverage?.config).toMatchObject({ threshold: 50 });
    expect(lint?.config).toMatchObject({ cwd: "ts", paths: ["src", "test"] });
  });

  it("accepts --flag=value form", () => {
    const parsed = parseArgs(["--analyzers=lint", "--min-signals=2"]);
    if (parsed.kind !== "run") throw new Error("expected run");
    expect(parsed.options.analyzers.map((a) => a.id)).toEqual(["lint"]);
    expect(parsed.options.minSignals).toBe(2);
  });

  it("rejects unknown analyzers", () => {
    expect(parseArgs(["--analyzers", "magic"])).toMatchObject({ kind: "error" });
  });

  it("rejects a non-positive --min-signals", () => {
    expect(parseArgs(["--min-signals", "0"])).toMatchObject({ kind: "error" });
  });

  it("rejects a flag missing its value", () => {
    expect(parseArgs(["--threshold"])).toMatchObject({ kind: "error" });
  });
});

const report: Report = {
  schemaVersion: "1",
  repo: "demo",
  proofs: [
    {
      claim: "x",
      result: { kind: "finding", rule: "noVar", message: "use let" },
      scope: { repo: "demo", path: "src/a.ts", level: "path" },
      severity: "warning",
      provenance: {
        tool: "lint",
        version: "1",
        config: {},
        inputsHash: "h",
        method: "deterministic",
      },
    },
  ],
  hotZones: [
    {
      scope: { repo: "demo", path: "src/a.ts", level: "path" },
      signals: ["lint", "coverage"],
      reasons: ["lint: noVar"],
    },
  ],
};

describe("renderReport", () => {
  it("renders ranked hot zones with their signals", () => {
    const text = renderReport(report);
    expect(text).toContain('repo "demo"');
    expect(text).toContain("Hot zones (1)");
    expect(text).toContain("src/a.ts");
    expect(text).toContain("[lint + coverage]");
  });

  it("says so when there are no hot zones", () => {
    const text = renderReport({ ...report, hotZones: [] });
    expect(text).toContain("Hot zones: none");
  });
});
