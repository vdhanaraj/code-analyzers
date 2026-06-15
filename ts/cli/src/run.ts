import { CodeAnalyzer, defaultRegistry, resolveSelection } from "@code-analyzers/lib";
import { HELP, KNOWN_ANALYZER_IDS, parseArgs } from "./args.js";
import { renderHuman, renderReport, renderSarif, renderSimple } from "./render.js";

export interface CliIO {
  readonly argv: readonly string[];
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

/**
 * The CLI body — a thin wrapper over the CodeAnalyzer library. IO is injected
 * (`out`/`err`) so it is testable without spawning a process. Returns the exit
 * code. The same canonical report is projected by the chosen output format.
 */
export async function run(io: CliIO): Promise<number> {
  const parsed = parseArgs(io.argv);

  if (parsed.kind === "help") {
    io.out(HELP);
    return 0;
  }
  if (parsed.kind === "error") {
    io.err(`error: ${parsed.message}`);
    io.err('run "code-analyzers --help" for usage.');
    return 2;
  }

  const { options } = parsed;
  try {
    const resolved = resolveSelection({
      repoRoot: options.repoRoot,
      ...(options.requested ? { requested: options.requested } : {}),
      configs: options.configs,
      knownIds: KNOWN_ANALYZER_IDS,
    });
    const requiredIds = new Set(resolved.specs.filter((s) => s.required).map((s) => s.id));

    const report = await new CodeAnalyzer({
      repoRoot: options.repoRoot,
      ...(options.repo ? { repo: options.repo } : {}),
      analyzers: resolved.specs,
      registry: defaultRegistry(),
      minSignals: options.minSignals,
      selection: resolved.selection,
    }).run();

    switch (options.output) {
      case "report":
        io.out(renderReport(report));
        break;
      case "simple":
        io.out(renderSimple(report));
        break;
      case "sarif":
        io.out(renderSarif(report));
        break;
      default:
        io.out(renderHuman(report));
    }

    // Fail closed only for analyzers that were *explicitly required* (CLI
    // selection). Config/auto-detected analyzers that didn't run are reported
    // (with install guidance) but skip-with-note — they don't fail the run.
    const failed = report.analyzers.filter((a) => a.status !== "ok" && requiredIds.has(a.tool));
    if (failed.length > 0 && !options.allowDegraded) {
      io.err(
        `error: ${failed.length} required analyzer(s) did not run (${failed
          .map((a) => `${a.tool}: ${a.status}`)
          .join(", ")}). Failing closed; pass --allow-degraded to override.`,
      );
      return 3;
    }
    return 0;
  } catch (e) {
    io.err(`error: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}
