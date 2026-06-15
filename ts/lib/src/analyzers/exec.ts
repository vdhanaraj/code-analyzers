import { execFile } from "node:child_process";

export interface ExecResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Run an external tool and capture its output. Lives in the analyzer
 * implementation layer — external drivers/process spawning never leak above it.
 * Resolves (rather than rejects) on a non-zero exit, because analysis tools
 * routinely exit non-zero precisely when they have findings to report.
 */
export function exec(
  command: string,
  args: readonly string[],
  options: { cwd?: string; maxBuffer?: number } = {},
): Promise<ExecResult> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      command,
      args,
      { cwd: options.cwd, maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const code = error.code;
          if (typeof code !== "number") {
            // Spawn failure (e.g. command not found) — not a tool-reported result.
            reject(error);
            return;
          }
          resolvePromise({ code, stdout, stderr });
          return;
        }
        resolvePromise({ code: 0, stdout, stderr });
      },
    );
  });
}
