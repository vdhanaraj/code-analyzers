import type { AnalyzerSpec } from "@code-analyzers/lib";

/** Parsed CLI invocation, or a request for help, or a usage error. */
export type ParsedArgs =
  | { readonly kind: "help" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "run"; readonly options: RunOptions };

export interface RunOptions {
  readonly repoRoot: string;
  readonly repo?: string;
  readonly analyzers: readonly AnalyzerSpec[];
  readonly minSignals: number;
  readonly json: boolean;
}

const KNOWN_ANALYZERS = new Set(["coverage", "lint"]);

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Tiny hand-rolled argv parser — the CLI is a thin wrapper, so it carries no
 * argument-parsing dependency. Recognizes `--flag value`, `--flag=value`, and
 * boolean flags; the first positional is the repo path.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags = new Map<string, string>();
  const booleans = new Set<string>();
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string;
    if (token === "--help" || token === "-h") return { kind: "help" };
    if (token === "--json") {
      booleans.add("json");
      continue;
    }
    if (token.startsWith("--")) {
      const body = token.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) {
        flags.set(body.slice(0, eq), body.slice(eq + 1));
        continue;
      }
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        return { kind: "error", message: `flag --${body} expects a value` };
      }
      flags.set(body, next);
      i++;
      continue;
    }
    positionals.push(token);
  }

  const repoRoot = positionals[0] ?? ".";

  const requested = flags.has("analyzers")
    ? splitList(flags.get("analyzers") as string)
    : ["coverage", "lint"];
  const unknown = requested.filter((id) => !KNOWN_ANALYZERS.has(id));
  if (unknown.length > 0) {
    return {
      kind: "error",
      message: `unknown analyzer(s): ${unknown.join(", ")}. Known: coverage, lint`,
    };
  }

  const minSignalsRaw = flags.get("min-signals");
  const minSignals = minSignalsRaw === undefined ? 1 : Number(minSignalsRaw);
  if (!Number.isInteger(minSignals) || minSignals < 1) {
    return { kind: "error", message: "--min-signals must be a positive integer" };
  }

  const analyzers: AnalyzerSpec[] = requested.map((id) => {
    if (id === "coverage") {
      const config: Record<string, unknown> = {};
      if (flags.has("coverage-report")) config.report = flags.get("coverage-report");
      if (flags.has("threshold")) config.threshold = Number(flags.get("threshold"));
      return { id, config };
    }
    // lint
    const config: Record<string, unknown> = {};
    if (flags.has("lint-bin")) config.bin = flags.get("lint-bin");
    if (flags.has("lint-cwd")) config.cwd = flags.get("lint-cwd");
    if (flags.has("lint-paths")) config.paths = splitList(flags.get("lint-paths") as string);
    return { id, config };
  });

  return {
    kind: "run",
    options: {
      repoRoot,
      ...(flags.has("repo") ? { repo: flags.get("repo") } : {}),
      analyzers,
      minSignals,
      json: booleans.has("json"),
    },
  };
}

export const HELP = `code-analyzers — a universal interface around code-analysis tools.

Runs analyzers behind one shape and emits dialect-versioned proofs plus an
attention-guiding "hot zones" report. It produces evidence FOR downstream
inference; it contains no LLM hop of its own.

USAGE
  code-analyzers [path] [options]

ARGUMENTS
  path                      repo working tree to analyze (default: ".")

OPTIONS
  -a, --analyzers <list>    comma list: coverage,lint (default: both)
      --repo <name>         logical repo id stamped into addresses
      --min-signals <n>     min distinct tools to flag a hot zone (default: 1)
      --json                emit the full proof report as JSON
  -h, --help                show this help

  coverage:  --coverage-report <path>   Istanbul coverage-final.json
             --threshold <pct>          flag files below this (default: 80)
  lint:      --lint-bin <path>          Biome binary (default: "biome")
             --lint-cwd <path>          working dir for Biome (default: repo)
             --lint-paths <list>        comma list of paths (default: ".")

EXAMPLES
  code-analyzers . --analyzers lint --lint-cwd ts
  code-analyzers . --coverage-report ts/coverage/coverage-final.json --json
`;
