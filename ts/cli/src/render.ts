import type { EvidenceReport, SarifResult } from "@code-analyzers/core";

/**
 * Renderers project the one canonical {@link EvidenceReport} for different
 * consumers:
 *  - `human`  — an attention guide for a person at a terminal.
 *  - `report` — the full report JSON (robust; for foundation models).
 *  - `simple` — a flattened, low-token JSON (for small local models).
 *  - `sarif`  — the embedded SARIF log verbatim (for existing SARIF tooling).
 */

/** repo-relative path a result addresses (+ line if known), or "(repo)". */
function resultLocation(result: SarifResult): string {
  const phys = result.locations?.[0]?.physicalLocation;
  const uri = phys?.artifactLocation.uri;
  if (!uri) return "(repo)";
  const line = phys?.region?.startLine;
  return line ? `${uri}:${line}` : uri;
}

interface FlatFinding {
  readonly at: string;
  readonly sev: string;
  readonly rule: string;
  readonly msg: string;
  readonly by: string;
}

function flattenFindings(report: EvidenceReport): FlatFinding[] {
  const findings: FlatFinding[] = [];
  for (const run of report.sarif.runs) {
    for (const result of run.results) {
      findings.push({
        at: resultLocation(result),
        sev: result.level ?? "none",
        rule: result.ruleId ?? "finding",
        msg: result.message.text,
        by: run.tool.driver.name,
      });
    }
  }
  return findings;
}

export function renderHuman(report: EvidenceReport): string {
  const lines: string[] = [];
  lines.push(`code-analyzers · repo "${report.repo}" · schema v${report.schemaVersion}`);

  const byTool = new Map<string, number>();
  let total = 0;
  for (const run of report.sarif.runs) {
    byTool.set(run.tool.driver.name, run.results.length);
    total += run.results.length;
  }
  const toolSummary =
    [...byTool.entries()].map(([t, n]) => `${t}: ${n}`).join(", ") || "no analyzers run";
  lines.push(`${total} findings (${toolSummary}) · ${report.measurements.length} measurements`);
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

/** Full canonical report — robust form for foundation models. */
export function renderReport(report: EvidenceReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Flattened, low-token projection for small local models: findings and
 * measurements as flat rows (no SARIF nesting), plus the hot-zone summary.
 * Emitted compact (no indentation) to minimize tokens.
 */
export function renderSimple(report: EvidenceReport): string {
  return JSON.stringify({
    repo: report.repo,
    schemaVersion: report.schemaVersion,
    findings: flattenFindings(report),
    metrics: report.measurements.map((m) => ({
      k: m.name,
      v: m.value,
      at: m.address.path === "" ? "(repo)" : m.address.path,
    })),
    hot: report.hotZones.map((z) => ({
      at: z.scope.path === "" ? "(repo)" : z.scope.path,
      by: z.signals,
    })),
  });
}

/** The embedded SARIF log verbatim — for GitHub code scanning, viewers, etc. */
export function renderSarif(report: EvidenceReport): string {
  return JSON.stringify(report.sarif, null, 2);
}
