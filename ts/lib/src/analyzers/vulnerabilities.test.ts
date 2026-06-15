import type { AnalyzerContext } from "@code-analyzers/core";
import { describe, expect, it } from "vitest";
import { buildVulnerabilitiesResult } from "./vulnerabilities.js";

const ctx: AnalyzerContext = { repoRoot: "/repo", repo: "demo" };

// An osv-scanner-shaped SARIF result (vuln located on a lockfile).
const osvSarif = JSON.stringify({
  version: "2.1.0",
  runs: [
    {
      tool: { driver: { name: "osv-scanner", version: "1.x" } },
      results: [
        {
          ruleId: "CVE-2023-0001",
          level: "warning",
          kind: "fail",
          message: { text: "lodash 4.17.20 is vulnerable to prototype pollution" },
          locations: [{ physicalLocation: { artifactLocation: { uri: "/repo/pnpm-lock.yaml" } } }],
        },
      ],
    },
  ],
});

describe("vulnerabilities analyzer (osv-scanner)", () => {
  const queriedAt = "2026-06-15T21:00:00Z";

  it("ingests OSV findings and stamps the external reference (deterministic, not reproducible)", () => {
    const out = buildVulnerabilitiesResult(osvSarif, ctx, "/repo", queriedAt);

    expect(out.method).toBe("deterministic");
    expect(out.externalReferences).toEqual([{ source: "OSV (osv.dev)", queriedAt }]);
    // Mirrored into run.properties so the emitted SARIF self-describes.
    expect(out.run.properties?.externalReferences).toEqual([
      { source: "OSV (osv.dev)", queriedAt },
    ]);

    const result = out.run.results[0];
    expect(result?.ruleId).toBe("CVE-2023-0001");
    expect(result?.locations?.[0]?.physicalLocation?.artifactLocation.uri).toBe("pnpm-lock.yaml");
    expect(out.measurements.find((m) => m.name === "vulnerabilities.count")?.value).toBe(1);
  });
});
