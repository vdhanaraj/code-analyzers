import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLintAnalyzer } from "./lint.js";

// Integration: spawns the real Biome binary against a temp file. Biome is a
// dev dependency, so the suite stays offline and deterministic.
const require = createRequire(import.meta.url);
const biomeBin = join(dirname(require.resolve("@biomejs/biome/package.json")), "bin", "biome");

describe("lint analyzer (integration: real Biome)", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ca-lint-"));
    await writeFile(
      join(dir, "probe.ts"),
      "export function f(a) {\n  var x = a == 1;\n  return x;\n}\n",
    );
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("maps Biome diagnostics to SARIF fail results with byte-range locations", async () => {
    const out = await createLintAnalyzer({ bin: biomeBin, cwd: dir, paths: ["."] }).analyze({
      repoRoot: dir,
      repo: "demo",
    });

    expect(out.method).toBe("deterministic");
    expect(out.run.tool.driver.name).toBe("lint");
    expect(out.run.results.length).toBeGreaterThan(0);

    const rules = new Set(out.run.results.map((r) => r.ruleId));
    expect([...rules]).toContain("lint/style/noVar");
    expect([...rules]).toContain("lint/suspicious/noDoubleEquals");

    for (const r of out.run.results) {
      expect(r.kind).toBe("fail");
      expect(r.locations?.[0]?.physicalLocation?.artifactLocation.uri).toBe("probe.ts");
    }

    const doubleEquals = out.run.results.find((r) => r.ruleId === "lint/suspicious/noDoubleEquals");
    expect(doubleEquals?.level).toBe("error");
    expect(doubleEquals?.locations?.[0]?.physicalLocation?.region?.byteLength).toBeGreaterThan(0);

    // Repo-level findings-count measurement, for trending.
    const count = out.measurements.find((m) => m.name === "lint.findings");
    expect(count?.value).toBe(out.run.results.length);
  });
});
