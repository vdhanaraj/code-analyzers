import { CodeAnalyzer, defaultRegistry } from "@code-analyzers/lib";
import { HELP, parseArgs } from "./args.js";
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
    const report = await new CodeAnalyzer({
      repoRoot: options.repoRoot,
      ...(options.repo ? { repo: options.repo } : {}),
      analyzers: options.analyzers,
      registry: defaultRegistry(),
      minSignals: options.minSignals,
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
    return 0;
  } catch (e) {
    io.err(`error: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}
