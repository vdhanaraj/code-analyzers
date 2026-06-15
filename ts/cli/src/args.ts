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
  /** Ids from `--analyzers`, if given. Undefined → resolve via config/auto-detect. */
  readonly requested?: readonly string[];
  /** Per-analyzer config gathered from flags, applied to whatever is selected. */
  readonly configs: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly minSignals: number;
  readonly output: OutputFormat;
  /** When false (default), exit non-zero if a required analyzer did not run. */
  readonly allowDegraded: boolean;
}

export const KNOWN_ANALYZER_IDS = ["coverage", "lint", "duplication", "secrets", "vulnerabilities"];
const KNOWN_ANALYZERS = new Set(KNOWN_ANALYZER_IDS);
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
    if (token === "--allow-degraded") {
      booleans.add("allow-degraded");
      continue;
    }
    if (token === "--coverage-skip-run") {
      booleans.add("coverage-skip-run");
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

  let requested: string[] | undefined;
  if (flags.has("analyzers")) {
    requested = splitList(flags.get("analyzers") as string);
    const unknown = requested.filter((id) => !KNOWN_ANALYZERS.has(id));
    if (unknown.length > 0) {
      return {
        kind: "error",
        message: `unknown analyzer(s): ${unknown.join(", ")}. Known: ${KNOWN_ANALYZER_IDS.join(", ")}`,
      };
    }
  }

  const minSignalsRaw = flags.get("min-signals");
  const minSignals = minSignalsRaw === undefined ? 1 : Number(minSignalsRaw);
  if (!Number.isInteger(minSignals) || minSignals < 1) {
    return { kind: "error", message: "--min-signals must be a positive integer" };
  }

  // Per-analyzer config from flags, applied to whatever the cascade selects.
  const set = (config: Record<string, unknown>, key: string, flag: string, list = false) => {
    if (flags.has(flag))
      config[key] = list ? splitList(flags.get(flag) as string) : flags.get(flag);
  };
  const coverage: Record<string, unknown> = {};
  set(coverage, "bin", "coverage-bin");
  set(coverage, "args", "coverage-args", true);
  set(coverage, "cwd", "coverage-cwd");
  set(coverage, "report", "coverage-report");
  if (flags.has("threshold")) coverage.threshold = Number(flags.get("threshold"));
  if (booleans.has("coverage-skip-run")) coverage.skipRun = true;
  const lint: Record<string, unknown> = {};
  set(lint, "tool", "lint-tool");
  set(lint, "bin", "lint-bin");
  set(lint, "cwd", "lint-cwd");
  set(lint, "paths", "lint-paths", true);
  const duplication: Record<string, unknown> = {};
  set(duplication, "bin", "dup-bin");
  set(duplication, "cwd", "dup-cwd");
  set(duplication, "paths", "dup-paths", true);
  if (flags.has("dup-min-tokens")) duplication.minTokens = Number(flags.get("dup-min-tokens"));
  if (flags.has("dup-min-lines")) duplication.minLines = Number(flags.get("dup-min-lines"));
  const secrets: Record<string, unknown> = {};
  set(secrets, "bin", "secrets-bin");
  set(secrets, "cwd", "secrets-cwd");
  set(secrets, "path", "secrets-path");
  const vulnerabilities: Record<string, unknown> = {};
  set(vulnerabilities, "bin", "vuln-bin");
  set(vulnerabilities, "cwd", "vuln-cwd");
  set(vulnerabilities, "path", "vuln-path");
  set(vulnerabilities, "subcommand", "vuln-subcommand");
  const configs = { coverage, lint, duplication, secrets, vulnerabilities };

  // Output format: --output <fmt>, with --json kept as an alias for `report`.
  let output: OutputFormat = booleans.has("json") ? "report" : "human";
  if (flags.has("output")) {
    const fmt = flags.get("output") as string;
    if (!OUTPUT_FORMATS.has(fmt as OutputFormat)) {
      return {
        kind: "error",
        message: `unknown --output "${fmt}". Known: human, report, simple, sarif`,
      };
    }
    output = fmt as OutputFormat;
  }

  return {
    kind: "run",
    options: {
      repoRoot,
      ...(flags.has("repo") ? { repo: flags.get("repo") } : {}),
      ...(requested ? { requested } : {}),
      configs,
      minSignals,
      output,
      allowDegraded: booleans.has("allow-degraded"),
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

SELECTION (which analyzers run) resolves in four tiers:
  1. --analyzers <list>     explicit; required (fails closed if a tool is missing)
  2. code-analyzers.json    or a "code-analyzers" key in package.json; soft
  3. auto-detect            inferred from repo contents; soft (skip-with-note)
  4. built-in default       coverage, lint, duplication
  "soft" = a missing tool is reported with an install pointer but does NOT fail.

OPTIONS
  -a, --analyzers <list>    comma list: coverage,lint,duplication,secrets,vulnerabilities
      --repo <name>         logical repo id stamped into addresses
      --min-signals <n>     min distinct tools to flag a hot zone (default: 1)
      --output <fmt>        human (default) | report | simple | sarif
                              report = full EvidenceReport JSON (foundation models)
                              simple = flattened low-token JSON (small local models)
                              sarif  = embedded SARIF log (GitHub code scanning, viewers)
      --json                alias for --output report
      --allow-degraded      exit 0 even if an analyzer did not run (default:
                              fail closed with exit 3)
  -h, --help                show this help

  coverage:    runs your tests with coverage, then ingests the report
               --coverage-bin <path>     test runner (default: "vitest")
               --coverage-args <list>    comma list (default: "run,--coverage")
               --coverage-cwd <path>     working dir for the run (default: repo)
               --coverage-report <path>  Istanbul coverage-final.json it emits
                                           (default: "coverage/coverage-final.json")
               --coverage-skip-run       ingest an existing report; don't run tests
               --threshold <pct>         flag files below this (default: 80)
  lint:        --lint-tool <biome|eslint>  default: detect by config file
               --lint-bin <path>         linter binary (default: local node_modules/.bin)
               --lint-cwd <path>         working dir for the linter (default: repo)
               --lint-paths <list>       comma list of paths (default: ".")
  duplication: --dup-bin <path>          jscpd binary (default: "jscpd")
               --dup-cwd <path>          working dir for jscpd (default: repo)
               --dup-paths <list>        comma list of paths (default: ".")
               --dup-min-tokens <n>      min token run to call a clone (def: 50)
               --dup-min-lines <n>       min line run to call a clone (def: 5)

  Opt-in (wrap external binaries you install yourself; redacted/accounted):
  secrets:         --secrets-bin <path>  gitleaks binary (default: "gitleaks")
  (gitleaks)       --secrets-cwd <path>  working dir (default: repo)
                   --secrets-path <p>    path to scan (default: ".")
  vulnerabilities: --vuln-bin <path>     osv-scanner binary (default: "osv-scanner")
  (osv-scanner)    --vuln-cwd <path>     working dir (default: repo)
                   --vuln-path <p>       path to scan (default: ".")
                   --vuln-subcommand <s> leading subcommand, e.g. "scan" (osv v2)

EXAMPLES
  code-analyzers . --analyzers lint --lint-cwd ts
  code-analyzers . --coverage-report ts/coverage/coverage-final.json --json
  code-analyzers . --analyzers secrets,vulnerabilities --output sarif
`;
