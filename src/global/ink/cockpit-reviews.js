/** Read-only Cockpit helpers for review receipts under ~/.harness/reviews/. */

export function countFindingsBySeverity(findings = []) {
  const counts = { high: 0, medium: 0, low: 0 };
  for (const finding of findings) {
    const severity = String(finding?.severity ?? "").toLowerCase();
    if (counts[severity] != null) counts[severity] += 1;
  }
  return counts;
}

export function selectReviewFromList(receipts = [], listIndex = 0) {
  if (!Array.isArray(receipts) || receipts.length === 0) return null;
  const index = Math.min(Math.max(0, listIndex), receipts.length - 1);
  return receipts[index] ?? null;
}

export function formatReviewListLines(receipts = []) {
  if (!Array.isArray(receipts) || receipts.length === 0) {
    return ["No review receipts yet. Run kairo review --agent codex|pi."];
  }
  return receipts.map((receipt) => {
    const counts = countFindingsBySeverity(receipt.findings);
    const findingTotal = (receipt.findings ?? []).length;
    const created = String(receipt.createdAt ?? "").slice(0, 16).replace("T", " ");
    const agent = String(receipt.agentId ?? "agent");
    const state = String(receipt.state ?? "unknown");
    return `${agent} · ${state} · ${findingTotal} findings (h${counts.high}/m${counts.medium}/l${counts.low}) · ${created || "unknown time"}`;
  });
}

export function formatReviewDetailLines(receipt) {
  if (!receipt) return ["Review receipt not found."];
  const counts = countFindingsBySeverity(receipt.findings);
  const snapshot = receipt.snapshot ?? {};
  const totals = snapshot.totals ?? {};
  const lines = [
    "SUMMARY",
    `${receipt.agentId}${receipt.model ? ` · ${receipt.model}` : ""} · ${receipt.state}`,
    `Findings · ${(receipt.findings ?? []).length} (high ${counts.high}, medium ${counts.medium}, low ${counts.low})`,
    `Created · ${receipt.createdAt ?? "n/a"}`,
    "",
    "DETAILS",
    `Id · ${receipt.reviewId}`,
    `Snapshot · ${snapshot.mode ?? "n/a"} · ${totals.fileCount ?? 0} files`
  ];
  if ((receipt.warnings ?? []).length > 0) {
    lines.push(`Warnings · ${receipt.warnings.length}`);
  }
  const findings = receipt.findings ?? [];
  if (findings.length === 0) {
    lines.push("", "No findings recorded.");
    return lines;
  }
  lines.push("", "Findings (read-only):");
  for (const finding of findings.slice(0, 20)) {
    const loc = finding.line != null ? `:${finding.line}` : "";
    lines.push(
      `  [${String(finding.severity).toUpperCase()}] ${finding.path ?? "?"}${loc} — ${finding.title ?? "untitled"}`
    );
  }
  if (findings.length > 20) {
    lines.push(`  … ${findings.length - 20} more`);
  }
  return lines;
}
