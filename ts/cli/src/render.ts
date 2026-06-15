import type { Proof, Report } from "@code-analyzers/core";

/**
 * Render a report as a human-readable attention guide. This is deliberately not
 * a score or a grade — it points at where deterministic signals land so a human
 * (or agent) knows where to look first.
 */
export function renderReport(report: Report): string {
  const lines: string[] = [];
  lines.push(`code-analyzers · repo "${report.repo}" · schema v${report.schemaVersion}`);

  const byTool = new Map<string, number>();
  for (const p of report.proofs) {
    byTool.set(p.provenance.tool, (byTool.get(p.provenance.tool) ?? 0) + 1);
  }
  const toolSummary =
    [...byTool.entries()].map(([t, n]) => `${t}: ${n}`).join(", ") || "no analyzers run";
  lines.push(`${report.proofs.length} proofs (${toolSummary})`);
  lines.push("");

  if (report.hotZones.length === 0) {
    lines.push("Hot zones: none — no deterministic signals flagged a sub-object.");
    return lines.join("\n");
  }

  lines.push(`Hot zones (${report.hotZones.length}) — attention guide, not a score:`);
  report.hotZones.forEach((zone, i) => {
    const where = zone.scope.path === "" ? "(repo)" : zone.scope.path;
    lines.push(`  ${i + 1}. ${where}  [${zone.signals.join(" + ")}]`);
    for (const reason of zone.reasons) {
      lines.push(`       - ${reason}`);
    }
  });

  return lines.join("\n");
}

/** A compact one-line provenance tag, handy when scanning raw proofs. */
export function describeProof(proof: Proof): string {
  const { scope, provenance } = proof;
  const where = scope.path === "" ? "(repo)" : scope.path;
  return `[${provenance.tool}/${provenance.method}] ${where}: ${proof.claim}`;
}
