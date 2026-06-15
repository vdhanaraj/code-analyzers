import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDuplicationAnalyzer } from "./duplication.js";

// Integration: spawns the real jscpd binary against temp files with a planted
// clone. jscpd's `exports` hides package.json, so locate the package root by
// cutting the resolved main entry at its node_modules/jscpd segment.
const require = createRequire(import.meta.url);
const jscpdMain = require.resolve("jscpd");
const pkgMarker = `${sep}jscpd${sep}`;
const jscpdRoot = jscpdMain.slice(0, jscpdMain.lastIndexOf(pkgMarker) + pkgMarker.length - 1);
const jscpdBin = join(jscpdRoot, "bin", "jscpd");

const SHARED_BLOCK = `  let sum = 0;
  let count = 0;
  let max = Number.NEGATIVE_INFINITY;
  let min = Number.POSITIVE_INFINITY;
  for (const item of items) {
    sum += item;
    count += 1;
    if (item > max) max = item;
    if (item < min) min = item;
  }
  return { sum, count, max, min, average: sum / count };`;

describe("duplication analyzer (integration: real jscpd)", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ca-dup-"));
    await writeFile(
      join(dir, "a.ts"),
      `export function computeTotals(items: number[]) {\n${SHARED_BLOCK}\n}\n`,
    );
    await writeFile(
      join(dir, "b.ts"),
      `export function aggregate(items: number[]) {\n${SHARED_BLOCK}\n}\n`,
    );
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("emits a clone fail result on both files plus a percentage measurement", async () => {
    const out = await createDuplicationAnalyzer({
      bin: jscpdBin,
      cwd: dir,
      paths: ["."],
      minTokens: 30,
    }).analyze({ repoRoot: dir, repo: "demo" });

    expect(out.method).toBe("deterministic");

    const pctMetric = out.measurements.find((m) => m.name === "duplication.percentage");
    expect(pctMetric).toBeDefined();
    expect(pctMetric?.unit).toBe("%");

    const flaggedPaths = new Set(
      out.run.results.map((r) => r.locations?.[0]?.physicalLocation?.artifactLocation.uri),
    );
    expect(flaggedPaths).toEqual(new Set(["a.ts", "b.ts"]));

    for (const r of out.run.results) {
      expect(r.ruleId).toBe("duplication.clone");
      expect(r.kind).toBe("fail");
      expect(r.locations?.[0]?.physicalLocation?.region?.startLine).toBeGreaterThan(0);
    }
  });

  it("emits only the percentage measurements (0%) when there are no clones", async () => {
    const clean = await mkdtemp(join(tmpdir(), "ca-dup-clean-"));
    try {
      await writeFile(join(clean, "solo.ts"), "export const x = 1;\nexport const y = 2;\n");
      const out = await createDuplicationAnalyzer({
        bin: jscpdBin,
        cwd: clean,
        paths: ["."],
      }).analyze({
        repoRoot: clean,
        repo: "demo",
      });
      expect(out.run.results).toHaveLength(0);
      const pctMetric = out.measurements.find((m) => m.name === "duplication.percentage");
      expect(pctMetric?.value).toBe(0);
    } finally {
      await rm(clean, { recursive: true, force: true });
    }
  });
});
