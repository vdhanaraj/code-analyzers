import { createCoverageAnalyzer } from "./analyzers/coverage.js";
import { createDuplicationAnalyzer } from "./analyzers/duplication.js";
import { createLintAnalyzer } from "./analyzers/lint.js";
import { createSecretsAnalyzer } from "./analyzers/secrets.js";
import { createVulnerabilitiesAnalyzer } from "./analyzers/vulnerabilities.js";
import { AnalyzerRegistry } from "./registry.js";

/**
 * The built-in wiring point: every analyzer this tool ships, registered by id.
 * `coverage`, `lint`, `duplication` use binaries provided as npm dev-deps.
 * `secrets` (gitleaks) and `vulnerabilities` (osv-scanner) wrap external
 * binaries that must be installed separately, so callers opt into them. Adding
 * an analyzer is one line here plus its module — nothing else changes.
 */
export function defaultRegistry(): AnalyzerRegistry {
  return new AnalyzerRegistry()
    .register("coverage", createCoverageAnalyzer)
    .register("lint", createLintAnalyzer)
    .register("duplication", createDuplicationAnalyzer)
    .register("secrets", createSecretsAnalyzer)
    .register("vulnerabilities", createVulnerabilitiesAnalyzer);
}
