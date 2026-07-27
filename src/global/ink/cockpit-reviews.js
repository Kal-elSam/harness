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
    const created = String(receipt.createdAt ?? "").slice(0, 19).replace("T", " ");
    return `${receipt.reviewId}  ${String(receipt.state).padEnd(10)}  ${String(receipt.agentId).padEnd(6)}  ${findingTotal}f (h${counts.high}/m${counts.medium}/l${counts.low})  ${created}`;
  });
}

export function formatReviewDetailLines(receipt) {
  if (!receipt) return ["Review receipt not found."];
  const counts = countFindingsBySeverity(receipt.findings);
  const snapshot = receipt.snapshot ?? {};
  const totals = snapshot.totals ?? {};
  const lines = [
    `Id: ${receipt.reviewId}`,
    `Agent: ${receipt.agentId}${receipt.model ? ` · model ${receipt.model}` : ""}`,
    `State: ${receipt.state}`,
    `Created: ${receipt.createdAt ?? "n/a"}`,
    `Findings: ${(receipt.findings ?? []).length} (high ${counts.high}, medium ${counts.medium}, low ${counts.low})`,
    `Snapshot: ${snapshot.mode ?? "n/a"} · files ${totals.fileCount ?? 0} · fingerprint ${String(snapshot.fingerprint ?? "").slice(0, 12) || "n/a"}`
  ];
  if ((receipt.warnings ?? []).length > 0) {
    lines.push(`Warnings: ${receipt.warnings.length}`);
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
    lines.push(`  … ${findings.length - 20} more (use kairo reviews show ${receipt.reviewId})`);
  }
  return lines;
}
