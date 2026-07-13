import { ORCHESTRATOR_VIEWS } from "./orchestrator-state.js";
import {
  DASHBOARD_PURPOSE,
  resolveDashboardRecommendation,
  resolveProjectReadiness
} from "../dashboard-guidance.js";
import { LAYOUT_MODES } from "./layout.js";

export function formatHomeRecentRun(run) {
  if (!run) return null;
  const agent = humanizeId(run.agentId);
  const result = humanizeRunState(run.state);
  return {
    headline: `Last run · ${agent} · ${result}`,
    hint: "Open History to inspect the result."
  };
}

export function buildHomeMissionModel({
  projectName = "project",
  hasGlobalState = false,
  diagnostics = null,
  dashboard = null,
  layoutMode = LAYOUT_MODES.COMPACT,
  recentRuns = null
} = {}) {
  const readiness = resolveProjectReadiness({ hasGlobalState, diagnostics, dashboard });
  const recommendation = resolveDashboardRecommendation({
    hasGlobalState,
    diagnostics,
    dashboard
  });
  const runs = recentRuns ?? dashboard?.recentRuns ?? [];
  const lastRun = formatHomeRecentRun(runs[0] ?? null);
  const includeEmbeddedStatus = layoutMode !== LAYOUT_MODES.WIDE;

  return {
    title: `HOME — ${projectName}`,
    purpose: DASHBOARD_PURPOSE,
    readiness,
    includeEmbeddedStatus,
    next: {
      title: "NEXT",
      actionTitle: recommendation.title,
      actionDetail: recommendation.detail ?? recommendation.message,
      enterHint: "Enter →",
      kind: recommendation.kind,
      targetView: recommendation.targetView,
      targetAction: recommendation.targetAction,
      message: recommendation.message
    },
    recent: lastRun
      ? {
        title: "RECENT",
        headline: lastRun.headline,
        hint: lastRun.hint,
        emptyHint: null
      }
      : {
        title: "RECENT",
        headline: null,
        hint: null,
        emptyHint: "No runs yet. Create a new run when an agent is ready."
      },
    explore: {
      title: "EXPLORE",
      lines: [
        "Agents — See which installed tools Kairo can launch and audit.",
        "System health — Inspect intelligence, authentication, and configuration."
      ]
    },
    recommendedTitle: recommendation.title,
    recommendedAction: recommendation.message,
    recommendedKind: recommendation.kind,
    recommendedTargetView: recommendation.targetView,
    recommendedTargetAction: recommendation.targetAction,
    emptyHint: lastRun ? null : "No runs yet. Create a new run when an agent is ready."
  };
}

export function openRecommendedDestination(recommendation, { navItems } = {}) {
  if (!recommendation?.targetView) return null;
  const index = (navItems ?? []).findIndex((item) => item.view === recommendation.targetView
    || (recommendation.targetAction && item.action === recommendation.targetAction));
  return {
    view: recommendation.targetView,
    action: recommendation.targetAction ?? null,
    navIndex: index >= 0 ? index : null
  };
}

function humanizeId(value) {
  const raw = String(value ?? "agent");
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function humanizeRunState(state) {
  switch (state) {
    case "succeeded":
    case "completed":
      return "Succeeded";
    case "failed":
      return "Failed";
    case "cancelled":
    case "canceled":
      return "Cancelled";
    case "running":
    case "starting":
      return "Running";
    default:
      return humanizeId(state);
  }
}

export { ORCHESTRATOR_VIEWS };
