import { createCoverageAnalyzer } from "./analyzers/coverage.js";
import { createLintAnalyzer } from "./analyzers/lint.js";
import { AnalyzerRegistry } from "./registry.js";

/**
 * The built-in wiring point: every analyzer this tool ships, registered by id.
 * v1 wires `coverage` and `lint`. Adding an analyzer is one line here plus its
 * module — nothing else in the orchestration path changes.
 */
export function defaultRegistry(): AnalyzerRegistry {
  return new AnalyzerRegistry()
    .register("coverage", createCoverageAnalyzer)
    .register("lint", createLintAnalyzer);
}
