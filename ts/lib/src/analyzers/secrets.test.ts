import type { AnalyzerContext } from "@code-analyzers/core";
import { describe, expect, it } from "vitest";
import { buildSecretsResult, gitleaksConfig, redactSecretResult } from "./secrets.js";

const ctx: AnalyzerContext = { repoRoot: "/repo", repo: "demo" };

// A gitleaks-shaped SARIF result carrying the secret in multiple places.
const gitleaksSarif = JSON.stringify({
  version: "2.1.0",
  runs: [
    {
      tool: { driver: { name: "gitleaks", version: "8.x" } },
      results: [
        {
          ruleId: "aws-access-token",
          level: "error",
          message: { text: "AWS Access Token: AKIAIOSFODNN7EXAMPLE" },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: "/repo/src/config.ts" },
                region: { startLine: 7 },
              },
            },
          ],
          partialFingerprints: { "commit:src/config.ts": "AKIAIOSFODNN7EXAMPLE" },
          properties: { match: "AKIAIOSFODNN7EXAMPLE" },
        },
      ],
    },
  ],
});

describe("secrets analyzer (gitleaks)", () => {
  it("redacts to minimal safe results — no secret survives anywhere", () => {
    const out = buildSecretsResult(gitleaksSarif, ctx, "/repo");
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("AKIAIOSFODNN7EXAMPLE");

    const result = out.run.results[0];
    expect(result?.ruleId).toBe("aws-access-token");
    expect(result?.kind).toBe("fail");
    expect(result?.message.text).toBe("potential secret (aws-access-token)");
    expect(result?.properties).toBeUndefined();
    // Location (file + line) is preserved — that's the attention signal.
    expect(result?.locations?.[0]?.physicalLocation?.artifactLocation.uri).toBe("src/config.ts");
    expect(result?.locations?.[0]?.physicalLocation?.region).toEqual({ startLine: 7 });
  });

  it("reports a secrets.findings count and deterministic method (bundled rules)", () => {
    const out = buildSecretsResult(gitleaksSarif, ctx, "/repo");
    expect(out.method).toBe("deterministic");
    expect(out.externalReferences).toBeUndefined();
    expect(out.measurements.find((m) => m.name === "secrets.findings")?.value).toBe(1);
  });

  it("gitleaksConfig keeps the default ruleset and allowlists generated dirs", () => {
    const toml = gitleaksConfig(["(^|/)dist/", "(^|/)coverage/"]);
    expect(toml).toContain("useDefault = true"); // keeps all secret rules
    expect(toml).toContain("[allowlist]");
    expect(toml).toContain("'(^|/)dist/'");
    expect(toml).toContain("'(^|/)coverage/'");
  });

  it("redactSecretResult never copies the message or properties verbatim", () => {
    const redacted = redactSecretResult({
      ruleId: "generic",
      level: "error",
      message: { text: "secret = hunter2" },
      properties: { match: "hunter2" },
    });
    expect(JSON.stringify(redacted)).not.toContain("hunter2");
  });
});
