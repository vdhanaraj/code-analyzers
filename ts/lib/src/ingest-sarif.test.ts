import type { SarifResult } from "@code-analyzers/core";
import { describe, expect, it } from "vitest";
import { ingestSarifRun } from "./ingest-sarif.js";

// A fixture shaped like a real tool's SARIF (absolute URIs, extra fields).
const rawLog = JSON.stringify({
  version: "2.1.0",
  runs: [
    {
      tool: { driver: { name: "gitleaks", version: "8.x" } },
      results: [
        {
          ruleId: "aws-access-token",
          level: "error",
          message: { text: "AWS Access Token detected" },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: "/repo/src/config.ts" },
                region: { startLine: 10 },
              },
            },
          ],
          // Sensitive extras a tool might include — must NOT survive untouched.
          partialFingerprints: { secret: "AKIAIOSFODNN7EXAMPLE" },
          properties: { match: "AKIAIOSFODNN7EXAMPLE" },
        },
      ],
    },
  ],
});

describe("ingestSarifRun", () => {
  it("collapses to one run under our toolId and normalizes URIs to repo-relative", () => {
    const run = ingestSarifRun(rawLog, {
      toolId: "secrets",
      version: "1",
      cwd: "/repo",
      repoRoot: "/repo",
      method: "deterministic",
    });
    expect(run.tool.driver.name).toBe("secrets");
    expect(run.results).toHaveLength(1);
    expect(run.results[0]?.locations?.[0]?.physicalLocation?.artifactLocation.uri).toBe(
      "src/config.ts",
    );
    expect(run.properties?.method).toBe("deterministic");
  });

  it("stamps externalReferences into run.properties when provided", () => {
    const run = ingestSarifRun(rawLog, {
      toolId: "osv",
      version: "1",
      cwd: "/repo",
      repoRoot: "/repo",
      method: "deterministic",
      externalReferences: [{ source: "OSV (osv.dev)", queriedAt: "2026-06-15T00:00:00Z" }],
    });
    expect(run.properties?.externalReferences).toEqual([
      { source: "OSV (osv.dev)", queriedAt: "2026-06-15T00:00:00Z" },
    ]);
  });

  it("lets transformResult reconstruct minimal safe results (redaction) and drop others", () => {
    const redact = (r: SarifResult): SarifResult => ({
      ruleId: r.ruleId,
      level: r.level,
      kind: "fail",
      message: { text: `potential secret (${r.ruleId})` },
      locations: r.locations,
      // Note: properties / fingerprints deliberately NOT carried over.
    });
    const run = ingestSarifRun(rawLog, {
      toolId: "secrets",
      version: "1",
      cwd: "/repo",
      repoRoot: "/repo",
      method: "deterministic",
      transformResult: redact,
    });
    const result = run.results[0];
    expect(result?.message.text).toBe("potential secret (aws-access-token)");
    expect(result?.properties).toBeUndefined();
    // The raw secret appears nowhere in the serialized run.
    expect(JSON.stringify(run)).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("drops results when transformResult returns null", () => {
    const run = ingestSarifRun(rawLog, {
      toolId: "secrets",
      version: "1",
      cwd: "/repo",
      repoRoot: "/repo",
      method: "deterministic",
      transformResult: () => null,
    });
    expect(run.results).toHaveLength(0);
  });
});
