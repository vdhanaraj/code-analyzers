import type { Analyzer, AnalyzerContext, Proof } from "@code-analyzers/core";
import { describe, expect, it } from "vitest";
import { AnalyzerContractError, CodeAnalyzer } from "./orchestrator.js";
import { AnalyzerRegistry } from "./registry.js";

function fakeAnalyzer(id: string, proofs: (ctx: AnalyzerContext) => Proof[]): Analyzer {
  return { id, version: "test", analyze: async (ctx) => proofs(ctx) };
}

function registryWith(...analyzers: Analyzer[]): AnalyzerRegistry {
  const registry = new AnalyzerRegistry();
  for (const a of analyzers) registry.register(a.id, () => a);
  return registry;
}

const validProof = (repo: string, path: string): Proof => ({
  claim: `${path} fails`,
  result: { kind: "finding", rule: "demo", message: "bad" },
  scope: { repo, path, level: "path" },
  severity: "warning",
  provenance: { tool: "stub", version: "1", config: {}, inputsHash: "h", method: "deterministic" },
});

describe("CodeAnalyzer", () => {
  it("assembles a schema-version-stamped report and defaults repo from repoRoot basename", async () => {
    const registry = registryWith(
      fakeAnalyzer("stub", (ctx) => [validProof(ctx.repo, "src/a.ts")]),
    );
    const report = await new CodeAnalyzer({
      repoRoot: "/tmp/my-repo",
      analyzers: [{ id: "stub" }],
      registry,
    }).run();

    expect(report.schemaVersion).toBe("1");
    expect(report.repo).toBe("my-repo");
    expect(report.proofs).toHaveLength(1);
    expect(report.hotZones).toHaveLength(1);
    expect(report.hotZones[0]?.signals).toEqual(["stub"]);
  });

  it("runs analyzers in order and concatenates their proofs", async () => {
    const registry = registryWith(
      fakeAnalyzer("a", (ctx) => [validProof(ctx.repo, "a.ts")]),
      fakeAnalyzer("b", (ctx) => [validProof(ctx.repo, "b.ts")]),
    );
    const report = await new CodeAnalyzer({
      repoRoot: "/tmp/r",
      repo: "r",
      analyzers: [{ id: "b" }, { id: "a" }],
      registry,
    }).run();
    expect(report.proofs.map((p) => p.provenance.tool)).toEqual(["stub", "stub"]);
    expect(report.proofs.map((p) => p.scope.path)).toEqual(["b.ts", "a.ts"]);
  });

  it("fails closed when an analyzer emits an invalid proof", async () => {
    const bad = fakeAnalyzer("rogue", (ctx) => [
      { ...validProof(ctx.repo, "x.ts"), claim: "" } as Proof,
    ]);
    const registry = registryWith(bad);
    const run = new CodeAnalyzer({
      repoRoot: "/tmp/r",
      repo: "r",
      analyzers: [{ id: "rogue" }],
      registry,
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
