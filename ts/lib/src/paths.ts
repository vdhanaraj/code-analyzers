import { isAbsolute, relative, sep } from "node:path";

/**
 * Best-effort address normalization helpers.
 *
 * Canonical addressing is deliberately deferred (see ARCHITECTURE), so these
 * keep the cheap, decidable part honest: a repo-relative POSIX path is a stable
 * key that proofs from different tools can line up on, even before we resolve
 * symbols and ranges precisely.
 */

/** Convert any OS path separators to POSIX `/`. */
export function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}

/**
 * Normalize a path emitted by a tool into a repo-relative POSIX path. Accepts
 * absolute paths (resolved against `repoRoot`) or already-relative paths.
 * Leading `./` is stripped. A path at or above the repo root collapses to "".
 */
export function normalizeRepoPath(repoRoot: string, p: string): string {
  const rel = isAbsolute(p) ? relative(repoRoot, p) : p;
  const posix = toPosix(rel).replace(/^\.\//, "");
  if (posix === "" || posix === "." || posix.startsWith("..")) return "";
  return posix;
}
