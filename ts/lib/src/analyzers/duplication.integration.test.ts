import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDuplicationAnalyzer } from "./duplication.js";

// Integration: spawns the real jscpd binary against temp files with a planted
// clone. jscpd is a dev dependency, so the suite stays offline and deterministic.
// jscpd's `exports` hides package.json, so locate the package root by cutting
// the resolved main entry at its node_modules/jscpd segment.
const require = createRequire(import.meta.url);
const jscpdMain = require.resolve("jscpd");
const pkgMarker = `${sep}jscpd${sep}`;
const jscpdRoot = jscpdMain.slice(0, jscpdMain.lastIndexOf(pkgMarker) + pkgMarker.length - 1);
const jscpdBin = join(jscpdRoot, "bin", "jscpd");

// A block large enough (>5 lines, >50 tokens) to register as a clone.
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

  it("emits a clone finding on both files plus a repo-level percentage metric", async () => {
    const proofs = await createDuplicationAnalyzer({
      bin: jscpdBin,
      cwd: dir,
      paths: ["."],
      minTokens: 30,
    }).analyze({ repoRoot: dir, repo: "demo" });

    // Repo-level measure with the duplication.percentage metric.
    const summary = proofs.find((p) => p.scope.level === "repo");
    expect(summary?.result.kind).toBe("measure");
    expect(summary?.metrics?.some((m) => m.name === "duplication.percentage")).toBe(true);
    expect(summary?.provenance.method).toBe("deterministic");

    // A clone finding on each of the two files, at line-range scope.
    const findings = proofs.filter(
      (p) => p.result.kind === "finding" && p.result.rule === "duplication.clone",
    );
    const flaggedPaths = new Set(findings.map((p) => p.scope.path));
    expect(flaggedPaths).toEqual(new Set(["a.ts", "b.ts"]));

    for (const f of findings) {
      expect(f.scope.level).toBe("range");
      expect(f.scope.range?.unit).toBe("line");
      expect(f.severity).toBe("warning");
      expect(f.provenance.tool).toBe("duplication");
    }
  });

  it("emits only the summary measure when there are no clones", async () => {
    const clean = await mkdtemp(join(tmpdir(), "ca-dup-clean-"));
    try {
      await writeFile(join(clean, "solo.ts"), "export const x = 1;\nexport const y = 2;\n");
      const proofs = await createDuplicationAnalyzer({
        bin: jscpdBin,
        cwd: clean,
        paths: ["."],
      }).analyze({ repoRoot: clean, repo: "demo" });
      expect(proofs).toHaveLength(1);
      expect(proofs[0]?.scope.level).toBe("repo");
      expect(proofs[0]?.result).toMatchObject({ kind: "measure", value: 0 });
    } finally {
      await rm(clean, { recursive: true, force: true });
    }
  });
});
