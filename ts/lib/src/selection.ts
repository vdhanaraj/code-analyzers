import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SelectionInfo } from "@code-analyzers/core";
import type { AnalyzerSpec } from "./orchestrator.js";

/**
 * Analyzer selection is a four-tier cascade — CLI › config file › auto-detect ›
 * built-in default. The first tier that yields a set wins; the floor (default)
 * guarantees a novice always gets a sensible run with zero flags. Source-based
 * strictness: only an *explicit CLI* selection is `required` (fails closed if a
 * tool is missing); config/auto-detected analyzers skip-with-note instead.
 */

const DEFAULT_SET = ["coverage", "lint", "duplication"];

type Config = { readonly analyzers?: Record<string, Record<string, unknown>> };

export interface ResolvedSelection {
  readonly specs: readonly AnalyzerSpec[];
  readonly selection: SelectionInfo;
}

/** Read config from `code-analyzers.json` (preferred) or a package.json key. */
export function loadConfig(repoRoot: string): Config | null {
  const dedicated = join(repoRoot, "code-analyzers.json");
  if (existsSync(dedicated)) {
    try {
      return JSON.parse(readFileSync(dedicated, "utf8")) as Config;
    } catch (e) {
      throw new Error(
        `code-analyzers.json is not valid JSON: ${e instanceof Error ? e.message : e}`,
      );
    }
  }
  const pkgPath = join(repoRoot, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
      const key = pkg["code-analyzers"];
      if (key && typeof key === "object" && !Array.isArray(key)) return key as Config;
    } catch {
      // A broken package.json is the project's problem, not ours — ignore here.
    }
  }
  return null;
}

/** Infer applicable analyzers from repo contents. Each carries a reason. */
export function autoDetect(repoRoot: string): Array<{ id: string; reason: string }> {
  const has = (p: string): boolean => existsSync(join(repoRoot, p));
  let pkg: { scripts?: Record<string, unknown> } | null = null;
  if (has("package.json")) {
    try {
      pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
    } catch {
      pkg = null;
    }
  }
  const out: Array<{ id: string; reason: string }> = [];
  if (pkg !== null || has("tsconfig.json")) {
    out.push({ id: "lint", reason: "JS/TS project (package.json or tsconfig present)" });
    out.push({ id: "duplication", reason: "JS/TS project" });
  }
  const hasTests =
    Boolean(pkg?.scripts?.test || pkg?.scripts?.coverage) ||
    has("vitest.config.ts") ||
    has("vitest.config.js") ||
    has("jest.config.js") ||
    has("jest.config.ts");
  if (hasTests) out.push({ id: "coverage", reason: "test script / runner config present" });
  if (has("pnpm-lock.yaml") || has("package-lock.json") || has("yarn.lock")) {
    out.push({ id: "vulnerabilities", reason: "dependency lockfile present" });
  }
  if (has(".git")) out.push({ id: "secrets", reason: "git repository" });
  return out;
}

export interface ResolveOptions {
  readonly repoRoot: string;
  /** Ids from `--analyzers`, if given. Presence means CLI selection wins. */
  readonly requested?: readonly string[];
  /** Per-analyzer config gathered from CLI flags, applied regardless of source. */
  readonly configs: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** Known analyzer ids, to reject typos in a config file. */
  readonly knownIds: readonly string[];
}

export function resolveSelection(opts: ResolveOptions): ResolvedSelection {
  const { repoRoot, requested, configs, knownIds } = opts;
  const cfgOf = (id: string): Record<string, unknown> => configs[id] ?? {};

  // 1. CLI — explicit and strict (required).
  if (requested && requested.length > 0) {
    return {
      specs: requested.map((id) => ({ id, config: cfgOf(id), required: true })),
      selection: {
        source: "cli",
        reasons: Object.fromEntries(requested.map((id) => [id, "requested via --analyzers"])),
      },
    };
  }

  // 2. Config file — the repo's declared standard. Soft unless an entry pins
  //    `required: true`.
  const config = loadConfig(repoRoot);
  const declared = config?.analyzers;
  if (declared && Object.keys(declared).length > 0) {
    const reasons: Record<string, string> = {};
    const specs: AnalyzerSpec[] = Object.entries(declared).map(([id, fileCfg]) => {
      if (!knownIds.includes(id)) {
        throw new Error(`config selects unknown analyzer "${id}". Known: ${knownIds.join(", ")}`);
      }
      reasons[id] = "declared in config file";
      return {
        id,
        config: { ...fileCfg, ...cfgOf(id) }, // CLI flag config overrides the file
        required: (fileCfg as { required?: unknown })?.required === true,
      };
    });
    return { specs, selection: { source: "config", reasons } };
  }

  // 3. Auto-detect — turnkey for novices; soft.
  const detected = autoDetect(repoRoot);
  if (detected.length > 0) {
    const reasons: Record<string, string> = {};
    const specs = detected.map(({ id, reason }) => {
      reasons[id] = reason;
      return { id, config: cfgOf(id), required: false };
    });
    return { specs, selection: { source: "auto-detect", reasons } };
  }

  // 4. Built-in default floor — always a sensible run.
  const reasons: Record<string, string> = {};
  const specs = DEFAULT_SET.map((id) => {
    reasons[id] = "built-in default";
    return { id, config: cfgOf(id), required: false };
  });
  return { specs, selection: { source: "default", reasons } };
}
