import { CONTROL_PLANE_HEALTH } from "../control-plane-snapshot.js";

export function buildControlCenterModel({
  projectName = "project",
  snapshot = null,
  dashboard = null,
  layoutMode = "compact"
} = {}) {
  if (!snapshot) {
    return {
      title: `OVERVIEW — ${projectName}`,
      purpose: "",
      health: {
        kind: CONTROL_PLANE_HEALTH.CHECK_FAILED,
        label: "CHECK FAILED",
        summaryLine: "Control-plane scan not available yet."
      },
      status: {
        kind: CONTROL_PLANE_HEALTH.CHECK_FAILED,
        label: "CHECK FAILED",
        summaryLine: "Control-plane scan not available yet."
      },
      coverageLines: [],
      cta: {
        title: "NEXT",
        actionTitle: "Retry scan",
        actionDetail: "Press R to reload the read-only governance scan.",
        enterHint: "R Retry",
        kind: "verify",
        destination: null
      },
      nextAction: {
        title: "NEXT",
        actionTitle: "Retry scan",
        actionDetail: "Press R to reload the read-only governance scan.",
        enterHint: "R Retry",
        kind: "verify",
        destination: null
      },
      notes: [],
      proposalLines: [],
      activity: { headline: "No activity yet" },
      alerts: { count: null, headline: "Alert data unavailable" },
      tokens: { headline: "Data unavailable" },
      includeEmbeddedStatus: layoutMode !== "wide",
      runsSecondaryHint: "Detail via Enter · / actions"
    };
  }

  const healthLabel = formatHealthLabel(snapshot.health);
  const coverage = snapshot.coverage ?? {};
  const active = dashboard?.activeRuns?.length ?? snapshot.runtime?.activeRuns ?? 0;
  const recent = dashboard?.recentRuns?.[0] ?? null;
  const health = {
    kind: snapshot.health,
    label: healthLabel,
    summaryLine: [
      `${coverage.governedAgents ?? 0}/${coverage.detectedAgents ?? 0} agents governed`,
      snapshot.diff?.hasChanges ? "drift pending" : "drift clean"
    ].join(" · ")
  };
  const cta = {
    title: "NEXT",
    actionTitle: snapshot.cta?.title ?? "Review control plane",
    actionDetail: snapshot.cta?.detail ?? "",
    enterHint: "Enter again →",
    kind: snapshot.cta?.kind ?? null,
    destination: snapshot.cta?.destination ?? null
  };

  return {
    title: `OVERVIEW — ${projectName}`,
    purpose: "",
    health,
    status: health,
    coverageLines: [],
    cta,
    nextAction: cta,
    notes: [],
    proposalLines: [],
    activity: {
      headline: active > 0
        ? `${active} active run${active === 1 ? "" : "s"}`
        : recent?.agentId
          ? `Last · ${recent.agentId} · ${recent.state ?? "done"}`
          : "Idle"
    },
    alerts: { count: null, headline: "Alert data unavailable" },
    tokens: { headline: formatTokenHeadline(snapshot.budgets) },
    includeEmbeddedStatus: layoutMode !== "wide",
    runsSecondaryHint: "Detail via Enter · / actions"
  };
}

function formatHealthLabel(kind) {
  switch (kind) {
    case CONTROL_PLANE_HEALTH.NOT_CONFIGURED:
      return "NOT CONFIGURED";
    case CONTROL_PLANE_HEALTH.ACTION_REQUIRED:
      return "ACTION REQUIRED";
    case CONTROL_PLANE_HEALTH.HEALTHY_WITH_NOTES:
      return "HEALTHY WITH NOTES";
    case CONTROL_PLANE_HEALTH.HEALTHY:
      return "HEALTHY";
    case CONTROL_PLANE_HEALTH.CHECK_FAILED:
      return "CHECK FAILED";
    default:
      return String(kind ?? "UNKNOWN");
  }
}

function formatTokenHeadline(budgets) {
  if (!budgets || typeof budgets !== "object") return "Data unavailable";
  const parts = [];
  if (Number.isFinite(budgets.stableUsedTokens) && Number.isFinite(budgets.stableBudgetTokens)) {
    parts.push(`stable ${budgets.stableUsedTokens}/${budgets.stableBudgetTokens}`);
  }
  if (Number.isFinite(budgets.requestUsedTokens) && Number.isFinite(budgets.requestBudgetTokens)) {
    parts.push(`request ${budgets.requestUsedTokens}/${budgets.requestBudgetTokens}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "Data unavailable";
}

/**
 * Usage surface: measured budgets when present, configured profile limits,
 * and auditable run tokenUsage — never invent totals.
 */
export function formatUsageLines({ snapshot = null, dashboard = null } = {}) {
  const lines = ["MEASURED"];
  const measured = formatTokenHeadline(snapshot?.budgets);
  lines.push(measured === "Data unavailable" ? "Data unavailable" : measured);

  const profile = dashboard?.profile ?? {};
  const configured = [];
  if (Number.isFinite(profile.tokenBudget)) configured.push(`token ${profile.tokenBudget}`);
  if (Number.isFinite(profile.stableContextBudget)) configured.push(`stable ${profile.stableContextBudget}`);
  if (Number.isFinite(profile.requestContextBudget)) configured.push(`request ${profile.requestContextBudget}`);
  lines.push("", "CONFIGURED LIMITS");
  lines.push(configured.length > 0 ? configured.join(" · ") : "No profile token budgets configured.");

  const runs = [...(dashboard?.activeRuns ?? []), ...(dashboard?.recentRuns ?? [])]
    .filter((run) => run?.tokenUsage && typeof run.tokenUsage === "object");
  lines.push("", "RUN USAGE");
  if (runs.length === 0) {
    lines.push("No auditable run tokenUsage yet.");
  } else {
    for (const run of runs.slice(0, 3)) {
      const usage = run.tokenUsage;
      const total = Number.isFinite(usage.total)
        ? usage.total
        : (Number(usage.input) || 0) + (Number(usage.output) || 0);
      lines.push(`${run.agentId ?? "agent"} · ${total} tokens`);
    }
  }

  lines.push("", "Auditable budgets only — no invented token savings.");
  return lines;
}

export function hasAuditableUsage({ snapshot = null, dashboard = null } = {}) {
  if (formatTokenHeadline(snapshot?.budgets) !== "Data unavailable") return true;
  const profile = dashboard?.profile ?? {};
  if (Number.isFinite(profile.tokenBudget)
    || Number.isFinite(profile.stableContextBudget)
    || Number.isFinite(profile.requestContextBudget)) {
    return true;
  }
  return [...(dashboard?.activeRuns ?? []), ...(dashboard?.recentRuns ?? [])]
    .some((run) => run?.tokenUsage && typeof run.tokenUsage === "object");
}
