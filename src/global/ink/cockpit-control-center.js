import { CONTROL_PLANE_HEALTH } from "../control-plane-snapshot.js";
import { formatAlertsHeadline } from "./cockpit-alerts.js";
import {
  adaptUsageModel,
  formatMeasuredBudgets,
  formatUsageLinesFromModel
} from "./ux/live-usage.js";

export function buildControlCenterModel({
  projectName = "project",
  snapshot = null,
  dashboard = null,
  layoutMode = "compact",
  alerts = null
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
      alerts: formatAlertsHeadline(alerts),
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
    alerts: formatAlertsHeadline(alerts),
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
  return formatMeasuredBudgets(budgets) ?? "Data unavailable";
}

/** Usage surface via shared auditable model — never invent totals. */
export function formatUsageLines({
  snapshot = null, dashboard = null, layoutMode = undefined
} = {}) {
  return formatUsageLinesFromModel(adaptUsageModel({ snapshot, dashboard, layoutMode }));
}

export function hasAuditableUsage({ snapshot = null, dashboard = null } = {}) {
  return adaptUsageModel({ snapshot, dashboard }).hasEvidence;
}
