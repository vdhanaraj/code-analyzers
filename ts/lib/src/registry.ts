import type { Analyzer } from "@code-analyzers/core";

/** Builds an analyzer instance from its (already-validated) configuration. */
export type AnalyzerFactory = (config: Readonly<Record<string, unknown>>) => Analyzer;

/**
 * The single wiring point.
 *
 * Every analyzer hides behind the stable `Analyzer` interface and is selected
 * here by `id` via configuration — never chosen ad-hoc elsewhere. External
 * drivers/SDKs live only inside the analyzer modules; nothing outside imports
 * them. Adding an analyzer is: write the module, register a factory here.
 */
export class AnalyzerRegistry {
  private readonly factories = new Map<string, AnalyzerFactory>();

  register(id: string, factory: AnalyzerFactory): this {
    if (this.factories.has(id)) {
      throw new Error(`analyzer "${id}" is already registered`);
    }
    this.factories.set(id, factory);
    return this;
  }

  has(id: string): boolean {
    return this.factories.has(id);
  }

  /** Registered analyzer ids, in registration order. */
  ids(): string[] {
    return [...this.factories.keys()];
  }

  create(id: string, config: Readonly<Record<string, unknown>> = {}): Analyzer {
    const factory = this.factories.get(id);
    if (!factory) {
      const known = this.ids().join(", ") || "(none)";
      throw new Error(`unknown analyzer "${id}". Registered: ${known}`);
    }
    return factory(config);
  }
}
