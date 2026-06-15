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
    expect(report.analyzers).toEqual([
      { tool: "stub", version: "test", method: "deterministic", status: "ok" },
    ]);
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

  it("keeps the run alive and marks errored when an analyzer throws at runtime", async () => {
    const boom: Analyzer = {
      id: "boom",
      version: "1",
      analyze: async () => {
        throw new Error("kaboom");
      },
    };
    const ok = fakeAnalyzer("ok", () => ({
      method: "deterministic",
      measurements: [],
      run: makeRun("ok", "1", [], "deterministic"),
    }));
    const report = await new CodeAnalyzer({
      repoRoot: "/tmp/r",
      repo: "r",
      analyzers: [{ id: "boom" }, { id: "ok" }],
      registry: registryWith(boom, ok),
    }).run();

    expect(report.sarif.runs).toHaveLength(2); // both runs present
    const boomRun = report.analyzers.find((a) => a.tool === "boom");
    expect(boomRun?.status).toBe("errored");
    expect(boomRun?.diagnostic?.message).toContain("kaboom");
    expect(report.analyzers.find((a) => a.tool === "ok")?.status).toBe("ok");
  });

  it("carries an analyzer's unavailable null-state (with help) onto the report", async () => {
    const missing = fakeAnalyzer("missing", () => ({
      status: "unavailable",
      method: "deterministic",
      measurements: [],
      run: makeRun("missing", "1", [], "deterministic"),
      diagnostic: { message: "tool X not installed", helpUrl: "https://example.com/install" },
    }));
    const report = await new CodeAnalyzer({
      repoRoot: "/tmp/r",
      repo: "r",
      analyzers: [{ id: "missing" }],
      registry: registryWith(missing),
    }).run();
    const run = report.analyzers[0];
    expect(run?.status).toBe("unavailable");
    expect(run?.diagnostic?.helpUrl).toBe("https://example.com/install");
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
