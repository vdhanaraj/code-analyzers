import { basename, resolve } from "node:path";
import {
  type AnalyzerContext,
  type AnalyzerRun,
  EvidenceError,
  type EvidenceReport,
  type Measurement,
  SARIF_VERSION,
  SCHEMA_VERSION,
  type SarifRun,
  validateEvidenceReport,
  validateMeasurement,
  validateSarifLog,
} from "@code-analyzers/core";
import { computeHotZones } from "./hotzones.js";
import { AnalyzerRegistry } from "./registry.js";

/** One analyzer to run, by id, with its configuration. */
export interface AnalyzerSpec {
  readonly id: string;
  readonly config?: Readonly<Record<string, unknown>>;
}

export interface CodeAnalyzerOptions {
  /** Path to the repository working tree. Resolved to absolute. */
  readonly repoRoot: string;
  /** Logical repo identity. Defaults to the basename of `repoRoot`. */
  readonly repo?: string;
  /** Analyzers to run, in order. Selected from the registry by id. */
  readonly analyzers: readonly AnalyzerSpec[];
  /** Defaults to an empty registry. Inject to override the wiring point. */
  readonly registry?: AnalyzerRegistry;
  /** Minimum distinct tools that must flag a file to make it a hot zone. */
  readonly minSignals?: number;
}

/** Thrown when an analyzer emits evidence that violates the contract. */
export class AnalyzerContractError extends Error {
  constructor(
    readonly analyzerId: string,
    override readonly cause: EvidenceError,
  ) {
    super(`analyzer "${analyzerId}" emitted invalid evidence — ${cause.message}`);
    this.name = "AnalyzerContractError";
  }
}

/**
 * The exported orchestration class — the durable artifact (the CLI is a thin
 * wrapper over this). Runs each analyzer behind the universal interface,
 * validates its output at the seam (a buggy analyzer fails closed rather than
 * poisoning the report), aggregates the SARIF runs and measurements, derives
 * the hot-zone rollup, and returns a schema-versioned {@link EvidenceReport}.
 *
 * No LLM hop: it produces evidence artifacts *for* downstream inference.
 */
export class CodeAnalyzer {
  private readonly repoRoot: string;
  private readonly repo: string;
  private readonly specs: readonly AnalyzerSpec[];
  private readonly registry: AnalyzerRegistry;
  private readonly minSignals: number;

  constructor(options: CodeAnalyzerOptions) {
    this.repoRoot = resolve(options.repoRoot);
    this.repo = options.repo ?? basename(this.repoRoot);
    this.specs = options.analyzers;
    this.registry = options.registry ?? new AnalyzerRegistry();
    this.minSignals = options.minSignals ?? 1;
  }

  async run(): Promise<EvidenceReport> {
    const ctx: AnalyzerContext = { repoRoot: this.repoRoot, repo: this.repo };
    const runs: SarifRun[] = [];
    const measurements: Measurement[] = [];
    const analyzers: AnalyzerRun[] = [];

    for (const spec of this.specs) {
      const analyzer = this.registry.create(spec.id, spec.config ?? {});
      try {
        const result = await analyzer.analyze(ctx);
        this.validateAtSeam(analyzer.id, result.run, result.measurements);
        runs.push(result.run);
        measurements.push(...result.measurements);
        analyzers.push({
          tool: analyzer.id,
          version: analyzer.version,
          method: result.method,
          status: result.status ?? "ok",
          ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
          ...(result.externalReferences ? { externalReferences: result.externalReferences } : {}),
        });
      } catch (e) {
        // A buggy analyzer (invalid evidence) is our bug — fail loud.
        if (e instanceof AnalyzerContractError) throw e;
        // A tool/runtime failure must not crash the whole run, and must not look
        // like a clean pass: keep the other analyzers, emit an errored null state.
        runs.push({
          tool: { driver: { name: analyzer.id, version: analyzer.version } },
          results: [],
          properties: { method: "deterministic", status: "errored" },
        });
        analyzers.push({
          tool: analyzer.id,
          version: analyzer.version,
          method: "deterministic",
          status: "errored",
          diagnostic: { message: e instanceof Error ? e.message : String(e) },
        });
      }
    }

    const sarif = { version: SARIF_VERSION, runs };
    const report: EvidenceReport = {
      schemaVersion: SCHEMA_VERSION,
      repo: this.repo,
      sarif,
      measurements,
      analyzers,
      hotZones: computeHotZones(sarif, this.repo, { minSignals: this.minSignals }),
    };
    // Final gate: the assembled report must itself satisfy the contract.
    return validateEvidenceReport(report);
  }

  private validateAtSeam(
    analyzerId: string,
    run: SarifRun,
    runMeasurements: readonly Measurement[],
  ): void {
    try {
      validateSarifLog({ version: SARIF_VERSION, runs: [run] }, `analyzer[${analyzerId}].sarif`);
      runMeasurements.forEach((m, i) =>
        validateMeasurement(m, `analyzer[${analyzerId}].measurements[${i}]`),
      );
    } catch (e) {
      if (e instanceof EvidenceError) throw new AnalyzerContractError(analyzerId, e);
      throw e;
    }
  }
}
