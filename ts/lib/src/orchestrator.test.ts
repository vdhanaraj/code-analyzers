import type { Analyzer, AnalyzerResult, SarifResult } from "@code-analyzers/core";
import { describe, expect, it } from "vitest";
import { AnalyzerContractError, CodeAnalyzer } from "./orchestrator.js";
import { AnalyzerRegistry } from "./registry.js";
import { makeResult, makeRun } from "./sarif-build.js";

function fakeAnalyzer(id: string, build: (repo: string) => AnalyzerResult): Analyzer {
  return { id, version: "test", analyze: async (ctx) => build(ctx.repo) };
}

function registryWith(...analyzers: Analyzer[]): AnalyzerRegistry {
  const registry = new AnalyzerRegistry();
  for (const a of analyzers) registry.register(a.id, () => a);
  return registry;
}

const failResult = (uri: string): SarifResult =>
  makeResult({ ruleId: "demo", level: "warning", kind: "fail", message: "bad", uri });

describe("CodeAnalyzer", () => {
  it("assembles a schema-versioned report and defaults repo from repoRoot basename", async () => {
    const registry = registryWith(
      fakeAnalyzer("stub", () => ({
        method: "deterministic",
        measurements: [],
        run: makeRun("stub", "1", [failResult("src/a.ts")], "deterministic"),
      })),
    );
    const report = await new CodeAnalyzer({
      repoRoot: "/tmp/my-repo",
      analyzers: [{ id: "stub" }],
      registry,
    }).run();

    expect(report.schemaVersion).toBe("2");
    expect(report.repo).toBe("my-repo");
    expect(report.sarif.runs).toHaveLength(1);
    expect(report.analyzers).toEqual([{ tool: "stub", version: "test", method: "deterministic" }]);
    expect(report.hotZones).toHaveLength(1);
    expect(report.hotZones[0]?.signals).toEqual(["stub"]);
  });

  it("aggregates runs and measurements across analyzers in order", async () => {
    const registry = registryWith(
      fakeAnalyzer("a", (repo) => ({
        method: "deterministic",
        measurements: [
          {
            name: "a.metric",
            value: 1,
            address: { repo, path: "a.ts", level: "path" },
            analyzer: "a",
          },
        ],
        run: makeRun("a", "1", [], "deterministic"),
      })),
      fakeAnalyzer("b", () => ({
        method: "deterministic",
        measurements: [],
        run: makeRun("b", "1", [], "deterministic"),
      })),
    );
    const report = await new CodeAnalyzer({
      repoRoot: "/tmp/r",
      repo: "r",
      analyzers: [{ id: "b" }, { id: "a" }],
      registry,
    }).run();
    expect(report.sarif.runs.map((r) => r.tool.driver.name)).toEqual(["b", "a"]);
    expect(report.measurements.map((m) => m.name)).toEqual(["a.metric"]);
  });

  it("fails closed when an analyzer emits an invalid measurement", async () => {
    const bad = fakeAnalyzer("rogue", (repo) => ({
      method: "deterministic",
      measurements: [
        { name: "", value: 1, address: { repo, path: "x.ts", level: "path" }, analyzer: "rogue" },
      ],
      run: makeRun("rogue", "1", [], "deterministic"),
    }));
    const run = new CodeAnalyzer({
      repoRoot: "/tmp/r",
      repo: "r",
      analyzers: [{ id: "rogue" }],
      registry: registryWith(bad),
    }).run();
    await expect(run).rejects.toBeInstanceOf(AnalyzerContractError);
    await expect(run).rejects.toThrow(/rogue/);
  });

  it("rejects an unknown analyzer id at the wiring point", async () => {
    const run = new CodeAnalyzer({
      repoRoot: "/tmp/r",
      repo: "r",
      analyzers: [{ id: "ghost" }],
      registry: new AnalyzerRegistry(),
    }).run();
    await expect(run).rejects.toThrow(/unknown analyzer "ghost"/);
  });
});
