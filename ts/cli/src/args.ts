import type { AnalyzerSpec } from "@code-analyzers/lib";

/** Parsed CLI invocation, or a request for help, or a usage error. */
export type ParsedArgs =
  | { readonly kind: "help" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "run"; readonly options: RunOptions };

/** How the one canonical report is projected for output. */
export type OutputFormat = "human" | "report" | "simple" | "sarif";

export interface RunOptions {
  readonly repoRoot: string;
  readonly repo?: string;
  readonly analyzers: readonly AnalyzerSpec[];
  readonly minSignals: number;
  readonly output: OutputFormat;
}

const KNOWN_ANALYZERS = new Set(["coverage", "lint", "duplication"]);
const OUTPUT_FORMATS = new Set<OutputFormat>(["human", "report", "simple", "sarif"]);

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
    : ["coverage", "lint", "duplication"];
  const unknown = requested.filter((id) => !KNOWN_ANALYZERS.has(id));
  if (unknown.length > 0) {
    return {
      kind: "error",
      message: `unknown analyzer(s): ${unknown.join(", ")}. Known: coverage, lint, duplication`,
    };
  }

  const minSignalsRaw = flags.get("min-signals");
  const minSignals = minSignalsRaw === undefined ? 1 : Number(minSignalsRaw);
  if (!Number.isInteger(minSignals) || minSignals < 1) {
    return { kind: "error", message: "--min-signals must be a positive integer" };
  }

  const analyzers: AnalyzerSpec[] = requested.map((id) => {
    const config: Record<string, unknown> = {};
    if (id === "coverage") {
      if (flags.has("coverage-report")) config.report = flags.get("coverage-report");
      if (flags.has("threshold")) config.threshold = Number(flags.get("threshold"));
    } else if (id === "lint") {
      if (flags.has("lint-bin")) config.bin = flags.get("lint-bin");
      if (flags.has("lint-cwd")) config.cwd = flags.get("lint-cwd");
      if (flags.has("lint-paths")) config.paths = splitList(flags.get("lint-paths") as string);
    } else {
      // duplication
      if (flags.has("dup-bin")) config.bin = flags.get("dup-bin");
      if (flags.has("dup-cwd")) config.cwd = flags.get("dup-cwd");
      if (flags.has("dup-paths")) config.paths = splitList(flags.get("dup-paths") as string);
      if (flags.has("dup-min-tokens")) config.minTokens = Number(flags.get("dup-min-tokens"));
      if (flags.has("dup-min-lines")) config.minLines = Number(flags.get("dup-min-lines"));
    }
    return { id, config };
  });

  // Output format: --output <fmt>, with --json kept as an alias for `report`.
  let output: OutputFormat = booleans.has("json") ? "report" : "human";
  if (flags.has("output")) {
    const requested = flags.get("output") as string;
    if (!OUTPUT_FORMATS.has(requested as OutputFormat)) {
      return {
        kind: "error",
        message: `unknown --output "${requested}". Known: human, report, simple, sarif`,
      };
    }
    output = requested as OutputFormat;
  }

  return {
    kind: "run",
    options: {
      repoRoot,
      ...(flags.has("repo") ? { repo: flags.get("repo") } : {}),
      analyzers,
      minSignals,
      output,
    },
  };
}

export const HELP = `code-analyzers — a universal interface around code-analysis tools.

Runs analyzers behind one shape and emits schema-versioned proofs plus an
attention-guiding "hot zones" report. It produces evidence FOR downstream
inference; it contains no LLM hop of its own.

USAGE
  code-analyzers [path] [options]

ARGUMENTS
  path                      repo working tree to analyze (default: ".")

OPTIONS
  -a, --analyzers <list>    comma list: coverage,lint,duplication (default: all)
      --repo <name>         logical repo id stamped into addresses
      --min-signals <n>     min distinct tools to flag a hot zone (default: 1)
      --output <fmt>        human (default) | report | simple | sarif
                              report = full EvidenceReport JSON (foundation models)
                              simple = flattened low-token JSON (small local models)
                              sarif  = embedded SARIF log (GitHub code scanning, viewers)
      --json                alias for --output report
  -h, --help                show this help

  coverage:    --coverage-report <path>  Istanbul coverage-final.json
               --threshold <pct>         flag files below this (default: 80)
  lint:        --lint-bin <path>         Biome binary (default: "biome")
               --lint-cwd <path>         working dir for Biome (default: repo)
               --lint-paths <list>       comma list of paths (default: ".")
  duplication: --dup-bin <path>          jscpd binary (default: "jscpd")
               --dup-cwd <path>          working dir for jscpd (default: repo)
               --dup-paths <list>        comma list of paths (default: ".")
               --dup-min-tokens <n>      min token run to call a clone (def: 50)
               --dup-min-lines <n>       min line run to call a clone (def: 5)

EXAMPLES
  code-analyzers . --analyzers lint --lint-cwd ts
  code-analyzers . --coverage-report ts/coverage/coverage-final.json --json
`;
