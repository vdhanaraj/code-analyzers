import { CodeAnalyzer, defaultRegistry } from "@code-analyzers/lib";
import { HELP, parseArgs } from "./args.js";
import { renderReport } from "./render.js";

export interface CliIO {
  readonly argv: readonly string[];
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

/**
 * The CLI body — a thin wrapper over the CodeAnalyzer library. Kept pure in its
 * IO (injected `out`/`err`) so it is testable without spawning a process.
 * Returns the process exit code.
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

    io.out(options.json ? JSON.stringify(report, null, 2) : renderReport(report));
    return 0;
  } catch (e) {
    io.err(`error: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}
