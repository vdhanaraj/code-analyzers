import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnalyzerContext } from "@code-analyzers/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCoverageAnalyzer } from "./coverage.js";

const ctx: AnalyzerContext = { repoRoot: "", repo: "demo" };

/** Minimal Istanbul entry: `s` = statement hit counts, `f` = function hits. */
function entry(absPath: string, hits: number[], fns: number[] = []) {
  const s: Record<string, number> = {};
  hits.forEach((h, i) => {
    s[i] = h;
  });
  const f: Record<string, number> = {};
  fns.forEach((h, i) => {
    f[i] = h;
  });
  return { path: absPath, s, f, b: {} };
}

describe("coverage analyzer", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ca-cov-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("emits a measure proof with metrics per file and flags below-threshold files", async () => {
    const report = join(dir, "coverage-final.json");
    await writeFile(
      report,
      JSON.stringify({
        a: entry(join(dir, "src/full.ts"), [1, 1, 1, 1]),
        b: entry(join(dir, "src/low.ts"), [1, 0, 0, 0]),
      }),
    );

    const proofs = await createCoverageAnalyzer({ report, threshold: 80 }).analyze({
      ...ctx,
      repoRoot: dir,
    });

    const full = proofs.find((p) => p.scope.path === "src/full.ts" && p.result.kind === "measure");
    expect(full?.result).toEqual({ kind: "measure", value: 100, unit: "%" });
    expect(full?.metrics?.find((m) => m.name === "coverage.statements.pct")?.value).toBe(100);

    const lowMeasure = proofs.find(
      (p) => p.scope.path === "src/low.ts" && p.result.kind === "measure",
    );
    expect(lowMeasure?.result).toEqual({ kind: "measure", value: 25, unit: "%" });

    const lowFinding = proofs.find(
      (p) => p.scope.path === "src/low.ts" && p.result.kind === "finding",
    );
    expect(lowFinding?.result).toMatchObject({ kind: "finding", rule: "coverage.below-threshold" });
    expect(lowFinding?.severity).toBe("warning");

    // The full file is not flagged.
    expect(proofs.some((p) => p.scope.path === "src/full.ts" && p.result.kind === "finding")).toBe(
      false,
    );
  });

  it("surfaces a missing report as a repo-level failed boolean (not silence)", async () => {
    const proofs = await createCoverageAnalyzer({ report: "nope/coverage-final.json" }).analyze({
      ...ctx,
      repoRoot: dir,
    });
    expect(proofs).toHaveLength(1);
    expect(proofs[0]?.result).toEqual({ kind: "boolean", value: false });
    expect(proofs[0]?.scope.level).toBe("repo");
    expect(proofs[0]?.provenance.method).toBe("deterministic");
  });
});
