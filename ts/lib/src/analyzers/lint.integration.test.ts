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
    // `var` (noVar) and `==` (noDoubleEquals) are recommended-rule violations.
    await writeFile(
      join(dir, "probe.ts"),
      "export function f(a) {\n  var x = a == 1;\n  return x;\n}\n",
    );
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("maps Biome diagnostics to finding proofs with byte-range scope", async () => {
    const proofs = await createLintAnalyzer({ bin: biomeBin, cwd: dir, paths: ["."] }).analyze({
      repoRoot: dir,
      repo: "demo",
    });

    expect(proofs.length).toBeGreaterThan(0);

    const rules = new Set(proofs.map((p) => (p.result.kind === "finding" ? p.result.rule : "")));
    expect([...rules]).toContain("lint/style/noVar");
    expect([...rules]).toContain("lint/suspicious/noDoubleEquals");

    for (const proof of proofs) {
      expect(proof.scope.repo).toBe("demo");
      expect(proof.scope.path).toBe("probe.ts");
      expect(proof.provenance.tool).toBe("lint");
      expect(proof.provenance.method).toBe("deterministic");
      expect(proof.result.kind).toBe("finding");
    }

    const doubleEquals = proofs.find(
      (p) => p.result.kind === "finding" && p.result.rule === "lint/suspicious/noDoubleEquals",
    );
    expect(doubleEquals?.severity).toBe("error");
    expect(doubleEquals?.scope.level).toBe("range");
    expect(doubleEquals?.scope.range?.unit).toBe("byte");
  });
});
