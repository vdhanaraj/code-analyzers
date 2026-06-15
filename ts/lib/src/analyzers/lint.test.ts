import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectLinter, parseEslint } from "./lint.js";

describe("detectLinter", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ca-lint-detect-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("picks biome when biome.json is present", async () => {
    await writeFile(join(dir, "biome.json"), "{}");
    expect(detectLinter(dir, dir)).toBe("biome");
  });

  it("picks eslint when an eslint config is present", async () => {
    await writeFile(join(dir, "eslint.config.js"), "export default [];");
    expect(detectLinter(dir, dir)).toBe("eslint");
  });

  it("defaults to biome when nothing is detectable", () => {
    expect(detectLinter(dir, dir)).toBe("biome");
  });
});

describe("parseEslint", () => {
  const toUri = (p: string) => p.replace("/repo/", "");
  const fixture = JSON.stringify([
    {
      filePath: "/repo/src/a.js",
      messages: [
        {
          ruleId: "no-unused-vars",
          severity: 2,
          message: "x is unused",
          line: 3,
          column: 7,
          endLine: 3,
          endColumn: 8,
        },
        { ruleId: null, severity: 1, message: "be careful", line: 1, column: 1 },
      ],
    },
    { filePath: "/repo/src/clean.js", messages: [] },
  ]);

  it("maps ESLint JSON to SARIF fail results with line/column regions", () => {
    const results = parseEslint(fixture, toUri);
    expect(results).toHaveLength(2);

    const [err, warn] = results;
    expect(err?.ruleId).toBe("no-unused-vars");
    expect(err?.level).toBe("error"); // severity 2
    expect(err?.locations?.[0]?.physicalLocation?.artifactLocation.uri).toBe("src/a.js");
    expect(err?.locations?.[0]?.physicalLocation?.region).toMatchObject({
      startLine: 3,
      startColumn: 7,
    });

    expect(warn?.level).toBe("warning"); // severity 1
    expect(warn?.ruleId).toBe("eslint"); // null ruleId -> fallback
  });
});
