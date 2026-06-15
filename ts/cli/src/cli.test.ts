import type { EvidenceReport } from "@code-analyzers/core";
import { describe, expect, it } from "vitest";
import { parseArgs } from "./args.js";
import { renderHuman, renderSarif, renderSimple } from "./render.js";

describe("parseArgs", () => {
  it("defaults to all analyzers, minSignals 1, human output, current dir", () => {
    const parsed = parseArgs([]);
    expect(parsed).toMatchObject({
      kind: "run",
      options: { repoRoot: ".", minSignals: 1, output: "human" },
    });
    if (parsed.kind === "run") {
      expect(parsed.options.analyzers.map((a) => a.id)).toEqual([
        "coverage",
        "lint",
        "duplication",
      ]);
    }
  });

  it("maps --json to --output report and accepts --output values", () => {
    expect(parseArgs(["--json"])).toMatchObject({ options: { output: "report" } });
    expect(parseArgs(["--output", "simple"])).toMatchObject({ options: { output: "simple" } });
    expect(parseArgs(["--output=sarif"])).toMatchObject({ options: { output: "sarif" } });
  });

  it("rejects an unknown --output", () => {
    expect(parseArgs(["--output", "yaml"])).toMatchObject({ kind: "error" });
  });

  it("threads analyzer config across coverage/lint/duplication", () => {
    const parsed = parseArgs(["--threshold", "50", "--lint-cwd", "ts", "--dup-min-tokens", "30"]);
    if (parsed.kind !== "run") throw new Error("expected run");
    expect(parsed.options.analyzers.find((a) => a.id === "coverage")?.config).toMatchObject({
      threshold: 50,
    });
    expect(parsed.options.analyzers.find((a) => a.id === "lint")?.config).toMatchObject({
      cwd: "ts",
    });
    expect(parsed.options.analyzers.find((a) => a.id === "duplication")?.config).toMatchObject({
      minTokens: 30,
    });
  });

  it("supports opt-in security analyzers and threads their config", () => {
    const parsed = parseArgs([
      "--analyzers",
      "secrets,vulnerabilities",
      "--secrets-bin",
      "/usr/bin/gitleaks",
      "--vuln-subcommand",
      "scan",
    ]);
    if (parsed.kind !== "run") throw new Error("expected run");
    expect(parsed.options.analyzers.map((a) => a.id)).toEqual(["secrets", "vulnerabilities"]);
    expect(parsed.options.analyzers.find((a) => a.id === "secrets")?.config).toMatchObject({
      bin: "/usr/bin/gitleaks",
    });
    expect(parsed.options.analyzers.find((a) => a.id === "vulnerabilities")?.config).toMatchObject({
      subcommand: "scan",
    });
  });

  it("rejects unknown analyzers and non-positive min-signals", () => {
    expect(parseArgs(["--analyzers", "magic"])).toMatchObject({ kind: "error" });
    expect(parseArgs(["--min-signals", "0"])).toMatchObject({ kind: "error" });
  });

  it("returns help for --help", () => {
    expect(parseArgs(["--help"]).kind).toBe("help");
  });
});

const report: EvidenceReport = {
  schemaVersion: "2",
  repo: "demo",
  sarif: {
    version: "2.1.0",
    runs: [
      {
        tool: { driver: { name: "lint", version: "1" } },
        results: [
          {
            ruleId: "noVar",
            level: "error",
            kind: "fail",
            message: { text: "use let" },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: "src/a.ts" },
                  region: { startLine: 3 },
                },
              },
            ],
          },
        ],
      },
    ],
  },
  measurements: [
    {
      name: "coverage.statements.pct",
      value: 80,
      unit: "%",
      address: { repo: "demo", path: "src/a.ts", level: "path" },
      analyzer: "coverage",
    },
  ],
  analyzers: [{ tool: "lint", version: "1", method: "deterministic" }],
  hotZones: [
    {
      scope: { repo: "demo", path: "src/a.ts", level: "path" },
      signals: ["lint", "coverage"],
      reasons: ["lint: noVar: use let"],
    },
  ],
};

describe("renderers", () => {
  it("human: ranked hot zones with signals", () => {
    const text = renderHuman(report);
    expect(text).toContain('repo "demo"');
    expect(text).toContain("schema v2");
    expect(text).toContain("Hot zones (1)");
    expect(text).toContain("[lint + coverage]");
  });

  it("simple: compact JSON with flattened findings, metrics, hot zones", () => {
    const parsed = JSON.parse(renderSimple(report));
    expect(parsed.repo).toBe("demo");
    expect(parsed.findings).toEqual([
      { at: "src/a.ts:3", sev: "error", rule: "noVar", msg: "use let", by: "lint" },
    ]);
    expect(parsed.metrics).toEqual([{ k: "coverage.statements.pct", v: 80, at: "src/a.ts" }]);
    expect(parsed.hot).toEqual([{ at: "src/a.ts", by: ["lint", "coverage"] }]);
  });

  it("sarif: emits the embedded SARIF log verbatim", () => {
    const parsed = JSON.parse(renderSarif(report));
    expect(parsed.version).toBe("2.1.0");
    expect(parsed.runs[0].tool.driver.name).toBe("lint");
    expect(parsed.runs[0].results[0].ruleId).toBe("noVar");
  });
});
