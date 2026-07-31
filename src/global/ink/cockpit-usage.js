/**
 * Pure Usage / Tokens model — no React/Ink.
 * Shared by formatUsageLines and SemanticUsagePanel.
 */
import { LAYOUT_MODES } from "./layout.js";

export function usageRunLimit(layoutMode = LAYOUT_MODES.COMPACT) {
  return layoutMode === LAYOUT_MODES.WIDE ? 8 : 3;
}

export function formatMeasuredBudgets(budgets) {
  if (!budgets || typeof budgets !== "object") return null;
  const parts = [];
  if (Number.isFinite(budgets.stableUsedTokens) && Number.isFinite(budgets.stableBudgetTokens)) {
    parts.push(`stable ${budgets.stableUsedTokens}/${budgets.stableBudgetTokens}`);
  }
  if (Number.isFinite(budgets.requestUsedTokens) && Number.isFinite(budgets.requestBudgetTokens)) {
    parts.push(`request ${budgets.requestUsedTokens}/${budgets.requestBudgetTokens}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function resolveConfiguredLimits(dashboard) {
  const resolved = dashboard?.profile?.profile ?? {};
  const configured = [];
  if (Number.isFinite(resolved.tokenBudget)) configured.push(`token ${resolved.tokenBudget}`);
  if (Number.isFinite(resolved.stableContextBudget)) configured.push(`stable ${resolved.stableContextBudget}`);
  if (Number.isFinite(resolved.requestContextBudget)) configured.push(`request ${resolved.requestContextBudget}`);
  return configured;
}

export function hasFiniteUsage(usage) {
  if (!usage || typeof usage !== "object") return false;
  return Number.isFinite(usage.total)
    || Number.isFinite(usage.input)
    || Number.isFinite(usage.output);
}

export function formatRunUsageLabel(run) {
  const usage = run?.tokenUsage;
  if (!hasFiniteUsage(usage)) return null;
  const parts = [];
  if (Number.isFinite(usage.input)) parts.push(`in ${usage.input}`);
  if (Number.isFinite(usage.output)) parts.push(`out ${usage.output}`);
  if (Number.isFinite(usage.total)) parts.push(`total ${usage.total}`);
  return `${run.agentId ?? "agent"} · ${parts.join(" · ")}`;
}

function collectAuditableRuns(dashboard) {
  return [...(dashboard?.activeRuns ?? []), ...(dashboard?.recentRuns ?? [])]
    .filter((run) => hasFiniteUsage(run?.tokenUsage));
}

/** Pure adapter: Callout=status · Measured section owns the value. */
export function adaptUsageModel({
  snapshot = null,
  dashboard = null,
  layoutMode = LAYOUT_MODES.COMPACT
} = {}) {
  const measured = formatMeasuredBudgets(snapshot?.budgets);
  const configured = resolveConfiguredLimits(dashboard);
  const allRuns = collectAuditableRuns(dashboard);
  const limit = usageRunLimit(layoutMode);
  const visible = allRuns.slice(0, limit);
  const hidden = Math.max(0, allRuns.length - visible.length);
  const hasEvidence = Boolean(measured) || configured.length > 0 || allRuns.length > 0;

  return {
    title: "Usage",
    callout: hasEvidence
      ? {
        tone: "info",
        title: "Usage evidence available",
        body: "Budgets and run tokenUsage only — no invented totals."
      }
      : {
        tone: "info",
        title: "Data unavailable",
        body: "No measured budgets, profile limits, or auditable run tokenUsage."
      },
    measured: measured ?? "Data unavailable",
    configured: configured.length > 0
      ? configured.join(" · ")
      : "No profile token budgets configured.",
    runs: visible.map((run, i) => ({
      id: `usage-run-${i}`,
      label: formatRunUsageLabel(run)
    })),
    runTotal: allRuns.length,
    runLimit: limit,
    moreLine: hidden > 0 ? `… ${hidden} more` : null,
    hasEvidence,
    footnote: "Auditable budgets only — no invented token savings."
  };
}

export function formatUsageLinesFromModel(model) {
  const lines = [
    "MEASURED", model.measured, "",
    "CONFIGURED LIMITS", model.configured, "",
    "RUN USAGE"
  ];
  if (model.runs.length === 0) {
    lines.push("No auditable run tokenUsage yet.");
  } else {
    for (const item of model.runs) lines.push(item.label);
    if (model.moreLine) lines.push(model.moreLine);
  }
  lines.push("", model.footnote);
  return lines;
}
