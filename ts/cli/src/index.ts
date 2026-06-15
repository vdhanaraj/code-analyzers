#!/usr/bin/env node
import { run } from "./run.js";

/**
 * @code-analyzers/cli — thin entrypoint. All logic lives in {@link run} and the
 * library it wraps; this file only binds process IO and the exit code.
 */
const code = await run({
  argv: process.argv.slice(2),
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
});

process.exitCode = code;
