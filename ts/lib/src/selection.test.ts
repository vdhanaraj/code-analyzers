import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveSelection } from "./selection.js";

const KNOWN = ["coverage", "lint", "duplication", "secrets", "vulnerabilities"];
const resolve = (repoRoot: string, extra: Partial<Parameters<typeof resolveSelection>[0]> = {}) =>
  resolveSelection({ repoRoot, configs: {}, knownIds: KNOWN, ...extra });

describe("resolveSelection — the four-tier cascade", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ca-sel-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("1. CLI wins and is required (fails closed)", async () => {
    const { specs, selection } = resolve(dir, {
      requested: ["lint", "secrets"],
      configs: { lint: { cwd: "x" } },
    });
    expect(selection.source).toBe("cli");
    expect(specs.map((s) => s.id)).toEqual(["lint", "secrets"]);
    expect(specs.every((s) => s.required)).toBe(true);
    expect(specs.find((s) => s.id === "lint")?.config).toMatchObject({ cwd: "x" });
  });

  it("2. config file (code-analyzers.json) when no CLI selection; soft by default", async () => {
    await writeFile(
      join(dir, "code-analyzers.json"),
      JSON.stringify({ analyzers: { lint: { cwd: "ts" }, vulnerabilities: { required: true } } }),
    );
    const { specs, selection } = resolve(dir);
    expect(selection.source).toBe("config");
    expect(specs.map((s) => s.id).sort()).toEqual(["lint", "vulnerabilities"]);
    expect(specs.find((s) => s.id === "lint")?.required).toBe(false);
    // an entry may pin required:true to enforce even from config
    expect(specs.find((s) => s.id === "vulnerabilities")?.required).toBe(true);
  });

  it("2b. config via a package.json key, with CLI flag config overriding the file", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ "code-analyzers": { analyzers: { lint: { cwd: "fromfile" } } } }),
    );
    const { specs, selection } = resolve(dir, { configs: { lint: { cwd: "fromflag" } } });
    expect(selection.source).toBe("config");
    expect(specs.find((s) => s.id === "lint")?.config).toMatchObject({ cwd: "fromflag" });
  });

  it("dedicated code-analyzers.json wins over the package.json key", async () => {
    await writeFile(
      join(dir, "code-analyzers.json"),
      JSON.stringify({ analyzers: { duplication: {} } }),
    );
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ "code-analyzers": { analyzers: { lint: {} } } }),
    );
    const { specs } = resolve(dir);
    expect(specs.map((s) => s.id)).toEqual(["duplication"]);
  });

  it("3. auto-detect from repo contents when no CLI/config; all soft", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
    await writeFile(join(dir, "pnpm-lock.yaml"), "");
    await mkdir(join(dir, ".git"));
    const { specs, selection } = resolve(dir);
    expect(selection.source).toBe("auto-detect");
    const ids = specs.map((s) => s.id).sort();
    expect(ids).toEqual(["coverage", "duplication", "lint", "secrets", "vulnerabilities"]);
    expect(specs.every((s) => !s.required)).toBe(true);
    expect(selection.reasons?.secrets).toMatch(/git/);
  });

  it("4. built-in default floor when nothing is detectable", async () => {
    const { specs, selection } = resolve(dir);
    expect(selection.source).toBe("default");
    expect(specs.map((s) => s.id)).toEqual(["coverage", "lint", "duplication"]);
  });

  it("rejects a config that selects an unknown analyzer", async () => {
    await writeFile(join(dir, "code-analyzers.json"), JSON.stringify({ analyzers: { bogus: {} } }));
    expect(() => resolve(dir)).toThrow(/unknown analyzer "bogus"/);
  });
});
