import type { Analyzer, AnalyzerContext } from "@code-analyzers/core";
import { describe, expect, it } from "vitest";
import { createDuplicationAnalyzer } from "./duplication.js";
import { createLintAnalyzer } from "./lint.js";
import { createSecretsAnalyzer } from "./secrets.js";
import { createVulnerabilitiesAnalyzer } from "./vulnerabilities.js";

// `false` is installed everywhere and exits non-zero while producing nothing —
// a stand-in for "the tool is present but the run is broken" (the errored case,
// distinct from unavailable). No real analysis tools needed.
const ctx: AnalyzerContext = { repoRoot: process.cwd(), repo: "demo" };

const cases: Array<[string, Analyzer]> = [
  ["lint", createLintAnalyzer({ bin: "false", cwd: process.cwd() })],
  ["duplication", createDuplicationAnalyzer({ bin: "false", cwd: process.cwd() })],
  ["secrets", createSecretsAnalyzer({ bin: "false", cwd: process.cwd() })],
  ["vulnerabilities", createVulnerabilitiesAnalyzer({ bin: "false", cwd: process.cwd() })],
];

describe("errored: tool present but run fails (≠ unavailable, ≠ clean pass)", () => {
  for (const [name, analyzer] of cases) {
    it(`${name} reports status=errored with no install pointer`, async () => {
      const out = await analyzer.analyze(ctx);
      expect(out.status).toBe("errored");
      expect(out.run.results).toHaveLength(0);
      // errored is NOT an install problem — no helpUrl.
      expect(out.diagnostic?.helpUrl).toBeUndefined();
      expect(out.diagnostic?.message).toContain("run failed");
    });
  }
});
