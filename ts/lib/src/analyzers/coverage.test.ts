import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnalyzerContext } from "@code-analyzers/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCoverageAnalyzer } from "./coverage.js";

const ctx: AnalyzerContext = { repoRoot: "", repo: "demo" };

function entry(absPath: string, hits: number[]) {
  const s: Record<string, number> = {};
  hits.forEach((h, i) => {
    s[i] = h;
  });
  return { path: absPath, s, f: {}, b: {} };
}

describe("coverage analyzer", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ca-cov-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("emits per-file measurements and a SARIF fail result for below-threshold files", async () => {
    const report = join(dir, "coverage-final.json");
    await writeFile(
      report,
      JSON.stringify({
        a: entry(join(dir, "src/full.ts"), [1, 1, 1, 1]),
        b: entry(join(dir, "src/low.ts"), [1, 0, 0, 0]),
      }),
    );

    // skipRun: ingest the fixture report instead of running a test suite.
    const out = await createCoverageAnalyzer({ report, threshold: 80, skipRun: true }).analyze({
      ...ctx,
      repoRoot: dir,
    });

    expect(out.method).toBe("deterministic");

    // Measurements for both files.
    const fullPct = out.measurements.find(
      (m) => m.name === "coverage.statements.pct" && m.address.path === "src/full.ts",
    );
    const lowPct = out.measurements.find(
      (m) => m.name === "coverage.statements.pct" && m.address.path === "src/low.ts",
    );
    expect(fullPct?.value).toBe(100);
    expect(lowPct?.value).toBe(25);

    // Only the low file produces a flagging result.
    const flagged = out.run.results.map(
      (r) => r.locations?.[0]?.physicalLocation?.artifactLocation.uri,
    );
    expect(flagged).toEqual(["src/low.ts"]);
    expect(out.run.results[0]?.ruleId).toBe("coverage.below-threshold");
    expect(out.run.results[0]?.kind).toBe("fail");
  });

  it("errors (not silence) when skipRun is set but no report exists", async () => {
    const out = await createCoverageAnalyzer({
      report: "nope/coverage-final.json",
      skipRun: true,
    }).analyze({ ...ctx, repoRoot: dir });
    expect(out.status).toBe("errored");
    expect(out.measurements).toHaveLength(0);
    expect(out.diagnostic?.helpUrl).toBeUndefined();
  });

  it("is unavailable (with install pointer) when the test runner is missing", async () => {
    const out = await createCoverageAnalyzer({
      bin: "/nonexistent/vitest-xyz",
      cwd: dir,
    }).analyze({ ...ctx, repoRoot: dir });
    expect(out.status).toBe("unavailable");
    expect(out.diagnostic?.helpUrl).toContain("vitest");
  });
});
