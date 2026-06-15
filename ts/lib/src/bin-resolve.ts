import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Resolve a tool to the project's local `node_modules/.bin/<name>` if present,
 * else fall back to the bare name (PATH lookup).
 *
 * npm-delivered analysis tools (vitest, biome, eslint, jscpd) are almost always
 * project devDeps in `node_modules/.bin`, not global installs — so defaulting to
 * the bare name made the tool look "not installed" when it was right there. We
 * check each candidate dir (the analyzer's cwd, then the repo root) before
 * giving up to PATH. An explicit `--*-bin` always wins over this.
 */
export function resolveBin(name: string, ...dirs: readonly string[]): string {
  for (const dir of dirs) {
    if (!dir) continue;
    // Absolute, so exec resolves it regardless of the child's cwd.
    const candidate = resolve(dir, "node_modules", ".bin", name);
    if (existsSync(candidate)) return candidate;
  }
  return name;
}
