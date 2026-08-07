import { CONTROL_PLANE_HEALTH } from "../control-plane-snapshot.js";
import { formatAlertsHeadline } from "./cockpit-alerts.js";
import {
  adaptUsageModel,
  formatMeasuredBudgets,
  formatUsageLinesFromModel
} from "./cockpit-usage.js";
import { LAYOUT_MODES } from "./layout.js";
import {
  formatSystemResourcesLines,
  formatResourceAdviceLines
} from "./system-resources-display.js";
import { formatEcosystemUpdateLines } from "./ecosystem-updates-display.js";
import { formatObsidianVaultLines } from "./obsidian-vault-display.js";

const HERMES_WIDE_SESSION_LIMIT = 3;
const HERMES_TITLE_MAX = 48;

export {
  diskFreeTone,
  formatSystemResourcesLines,
  formatResourceAdviceLines
} from "./system-resources-display.js";
export { formatEcosystemUpdateLines } from "./ecosystem-updates-display.js";
export { formatObsidianVaultLines } from "./obsidian-vault-display.js";

export function buildControlCenterModel({
  projectName = "project",
  snapshot = null,
  dashboard = null,
  layoutMode = LAYOUT_MODES.COMPACT,
  alerts = null,
  companion = null
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
      companion: null,
      companionNextAction: null,
      includeEmbeddedStatus: layoutMode !== LAYOUT_MODES.WIDE,
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
    companion: formatCompanionOverlay(companion, layoutMode),
    companionNextAction: companion?.nextSafeAction ?? null,
    includeEmbeddedStatus: layoutMode !== LAYOUT_MODES.WIDE,
    runsSecondaryHint: "Detail via Enter · / actions"
  };
}

/**
 * Observe-only Hermes activity lines for Cockpit overlay.
 * Never includes session ids, baseUrl, diagnostics dumps, or control affordances.
 */
export function formatHermesActivityLines(activity, layoutMode = LAYOUT_MODES.COMPACT) {
  if (activity == null || typeof activity !== "object") {
    return ["Hermes · unavailable"];
  }
  const state = typeof activity.state === "string" && activity.state.length > 0
    ? activity.state
    : "error";
  if (state !== "available" && state !== "partial") {
    return [`Hermes · ${state}`];
  }

  const agg = activity.aggregates && typeof activity.aggregates === "object"
    ? activity.aggregates
    : {};
  const active = Number.isInteger(agg.activeCount) ? agg.activeCount : null;
  const ended = Number.isInteger(agg.endedCount) ? agg.endedCount : null;
  const bits = [`Hermes · ${state}`];
  if (active != null) bits.push(`${active} active`);
  if (layoutMode !== LAYOUT_MODES.MINIMAL && ended != null) {
    bits.push(`${ended} ended`);
  }
  const lines = [bits.join(" · ")];

  if (layoutMode !== LAYOUT_MODES.WIDE) return lines;

  const sessions = Array.isArray(activity.sessions) ? activity.sessions : [];
  for (const session of sessions.slice(0, HERMES_WIDE_SESSION_LIMIT)) {
    const label = hermesSessionLabel(session);
    if (label) lines.push(`  · ${label}`);
  }
  if (agg.hasMore === true || sessions.length > HERMES_WIDE_SESSION_LIMIT) {
    lines.push("  · … more sessions");
  }
  return lines;
}

function hermesSessionLabel(session) {
  if (session == null || typeof session !== "object" || Array.isArray(session)) return null;
  const title = typeof session.title === "string" && session.title.trim()
    ? session.title.trim()
    : null;
  const source = typeof session.source === "string" && session.source.trim()
    ? session.source.trim()
    : null;
  const head = (title ?? source ?? "untitled")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, HERMES_TITLE_MAX);
  const flag = session.active === true ? "active" : "ended";
  return `${head} · ${flag}`;
}

function formatCompanionOverlay(companion, layoutMode = LAYOUT_MODES.COMPACT) {
  if (!companion) return null;
  const g = companion.signals?.gentle?.state ?? "unknown";
  const gy = companion.signals?.graphify;
  const graphBit = gy?.graphStatus ? `/${gy.graphStatus}` : "";
  const en = companion.engram?.status ?? "unknown";
  const links = companion.links?.length ?? 0;
  return {
    ok: companion.ok !== false,
    lines: [
      `Gentle · ${g}`,
      `Graphify · ${gy?.state ?? "unknown"}${graphBit}`,
      `Engram · ${en}`,
      `Soft links · ${links}`,
      ...formatHermesActivityLines(companion.signals?.hermes?.activity, layoutMode),
      ...formatSystemResourcesLines(companion.signals?.system?.resources, layoutMode),
      ...formatResourceAdviceLines(companion.signals?.system?.advice, layoutMode),
      ...formatEcosystemUpdateLines(companion.signals?.ecosystem?.updates, layoutMode),
      ...formatObsidianVaultLines(companion.signals?.obsidian?.vault, layoutMode)
    ],
    links: companion.links ?? [],
    error: companion.error ?? null
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
