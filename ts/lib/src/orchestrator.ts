import { resolve } from "node:path";
import { basename } from "node:path";
import {
  type AnalyzerContext,
  DIALECT_VERSION,
  type Proof,
  ProofError,
  type Report,
  validateProof,
  validateReport,
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
  /**
   * Logical repo identity stamped into every address. Stable across checkouts
   * so proofs line up. Defaults to the basename of `repoRoot`.
   */
  readonly repo?: string;
  /** Analyzers to run, in order. Selected from the registry by id. */
  readonly analyzers: readonly AnalyzerSpec[];
  /** Defaults to the built-in registry. Inject to override the wiring point. */
  readonly registry?: AnalyzerRegistry;
  /** Minimum distinct tools that must flag a file to make it a hot zone. */
  readonly minSignals?: number;
}

/** Thrown when an analyzer emits a proof that violates the dialect contract. */
export class AnalyzerContractError extends Error {
  constructor(
    readonly analyzerId: string,
    override readonly cause: ProofError,
  ) {
    super(`analyzer "${analyzerId}" emitted an invalid proof — ${cause.message}`);
    this.name = "AnalyzerContractError";
  }
}

/**
 * The exported orchestration class — the durable artifact (the CLI is a thin
 * wrapper over this). Give it a repo and a set of analyzers; it runs each behind
 * the universal `Analyzer` interface, validates every emitted proof at the seam
 * (so a buggy analyzer fails closed rather than poisoning the report), derives
 * the deterministic hot-zone rollup, and returns a dialect-stamped {@link Report}.
 *
 * It contains no LLM hop: it produces evidence artifacts *for* downstream
 * inference. The single short inference hop lives in the consumer, never here.
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

  /** Run every configured analyzer and assemble the report. */
  async run(): Promise<Report> {
    const ctx: AnalyzerContext = { repoRoot: this.repoRoot, repo: this.repo };
    const proofs: Proof[] = [];

    for (const spec of this.specs) {
      const analyzer = this.registry.create(spec.id, spec.config ?? {});
      const emitted = await analyzer.analyze(ctx);
      for (const raw of emitted) {
        proofs.push(this.validateAtSeam(analyzer.id, raw));
      }
    }

    const report: Report = {
      dialect: DIALECT_VERSION,
      repo: this.repo,
      proofs,
      hotZones: computeHotZones(proofs, { minSignals: this.minSignals }),
    };
    // Final gate: the assembled report must itself satisfy the contract.
    return validateReport(report);
  }

  private validateAtSeam(analyzerId: string, raw: Proof): Proof {
    try {
      return validateProof(raw);
    } catch (e) {
      if (e instanceof ProofError) throw new AnalyzerContractError(analyzerId, e);
      throw e;
    }
  }
}
