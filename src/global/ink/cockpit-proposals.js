/**
 * Read-only proposal presentation for Control Center / Changes.
 * Links to existing views only — never executes actions.
 */

export function formatProposalLines(proposals = [], {
  limit = 6,
  destinationFilter = null,
  budgets = null
} = {}) {
  const filtered = (proposals ?? []).filter((entry) => {
    if (!entry?.id || !entry?.title) return false;
    if (!destinationFilter) return true;
    return entry.destination === destinationFilter;
  });

  if (filtered.length === 0) {
    return destinationFilter
      ? ["No proposals targeting this view."]
      : ["No evidence-backed proposals."];
  }

  const shown = filtered.slice(0, Math.max(1, limit));
  const lines = [
    `Proposals · ${shown.length}/${filtered.length} evidence-backed`
  ];

  const budgetLine = formatProposalBudgetLine(budgets);
  if (budgetLine) lines.push(budgetLine);

  for (const proposal of shown) {
    const severity = String(proposal.severity ?? "info").toUpperCase();
    const destination = proposal.destination ?? "control-center";
    lines.push(`[${severity}] ${proposal.title} → ${destination}`);
    const evidence = formatProposalEvidenceSource(proposal.evidence);
    if (evidence) lines.push(`  evidence: ${evidence}`);
  }

  if (filtered.length > shown.length) {
    lines.push(`… ${filtered.length - shown.length} more (open destination views)`);
  }

  return lines;
}

export function formatProposalEvidenceSource(evidence = []) {
  const sources = [];
  const seen = new Set();
  for (const item of evidence ?? []) {
    const source = String(item?.source ?? "").trim();
    if (!source || seen.has(source)) continue;
    seen.add(source);
    sources.push(source);
    if (sources.length >= 3) break;
  }
  return sources.join(" · ") || null;
}

export function formatProposalBudgetLine(budgets) {
  if (!budgets || typeof budgets !== "object") return null;
  const parts = [];
  if (Number.isFinite(budgets.stableUsedTokens) && Number.isFinite(budgets.stableBudgetTokens)) {
    parts.push(`stable ${budgets.stableUsedTokens}/${budgets.stableBudgetTokens}`);
  }
  if (Number.isFinite(budgets.requestUsedTokens) && Number.isFinite(budgets.requestBudgetTokens)) {
    parts.push(`request ${budgets.requestUsedTokens}/${budgets.requestBudgetTokens}`);
  }
  if (parts.length === 0) return null;
  return `Budget · ${parts.join(" · ")}`;
}

export function proposalLimitForLayout(layoutMode = "compact") {
  switch (layoutMode) {
    case "wide":
      return 6;
    case "minimal":
      return 3;
    case "compact":
    default:
      return 4;
  }
}
