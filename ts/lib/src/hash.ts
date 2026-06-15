import { createHash } from "node:crypto";

/**
 * Stable content hash for `provenance.inputsHash`. Analyzers hash whatever they
 * actually computed over (file contents, a tool's raw output) so a proof can be
 * tied to the exact inputs that produced it — the basis for cross-version diff
 * and for trusting a cached result.
 */
export function sha256(...parts: readonly (string | Buffer)[]): string {
  const h = createHash("sha256");
  for (const part of parts) h.update(part);
  return h.digest("hex");
}
