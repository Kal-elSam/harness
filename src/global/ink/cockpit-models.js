import { LAYOUT_MODES, resolveListLimit } from "./layout.js";
import { ORCHESTRATOR_VIEWS } from "./orchestrator-state.js";
import { resolveProjectReadiness } from "../dashboard-guidance.js";
import { STATUS_LABELS, resolveGlyphs } from "./theme.js";
import { windowList } from "./list-window.js";
import { buildHomeMissionModel, formatHomeRecentRun } from "./cockpit-home.js";

export const COCKPIT_REGIONS = {
  NAV: "nav",
  CONTENT: "content",
  SYSTEM: "system"
};

export const COCKPIT_NAV = [
  {
    id: "overview",
    label: "Control center",
    view: ORCHESTRATOR_VIEWS.HOME,
    description: "Coverage, integrity, and the next governance action."
  },
  {
    id: "ides",
    label: "IDEs & models",
    view: ORCHESTRATOR_VIEWS.IDES,
    description: "Detected agents, auth signals, capabilities, and recommended policy."
  },
  {
    id: "modules",
    label: "Harness modules",
    view: ORCHESTRATOR_VIEWS.MODULES,
    description: "Orchestrator, SDD/TDD, and external Engram/Graphify integrations."
  },
  {
    id: "changes",
    label: "Changes",
    view: ORCHESTRATOR_VIEWS.CHANGES,
    description: "Findings, drift, and exact preview before any write."
  },
  {
    id: "activity",
    label: "Activity & recovery",
    view: ORCHESTRATOR_VIEWS.ACTIVITY,
    description: "Kairo operations, backups, and rollback readiness."
  },
  {
    id: "profile",
    label: "Profile & policy",
    view: ORCHESTRATOR_VIEWS.PROFILE,
    description: "Defaults, scopes, consent, and precedence."
  },
  {
    id: "runs",
    label: "Runs",
    view: ORCHESTRATOR_VIEWS.ACTIVE_RUNS,
    description: "Optional supervised execution — secondary to governance."
  }
];

export function regionsForLayout(layoutMode) {
  if (layoutMode === LAYOUT_MODES.WIDE) {
    return [COCKPIT_REGIONS.NAV, COCKPIT_REGIONS.CONTENT, COCKPIT_REGIONS.SYSTEM];
  }
  if (layoutMode === LAYOUT_MODES.COMPACT) {
    return [COCKPIT_REGIONS.NAV, COCKPIT_REGIONS.CONTENT];
  }
  return [COCKPIT_REGIONS.CONTENT];
}

export function navIndexForView(view, items = COCKPIT_NAV) {
  const index = items.findIndex((item) => item.view === view);
  return index >= 0 ? index : 0;
}

export function buildTopBarModel({
  projectName = "project",
  systemOnline = true,
  unicode = true
} = {}) {
  const glyphs = resolveGlyphs(unicode);
  const status = systemOnline ? STATUS_LABELS.online : STATUS_LABELS.offline;
  return {
    brand: "KAIRO",
    status,
    statusKind: systemOnline ? "online" : "offline",
    projectLabel: `Project: ${projectName}`,
    separator: glyphs.bullet
  };
}

export function resolveNavStatusSummary(item, {
  dashboard = null,
  diagnostics = null,
  snapshot = null
} = {}) {
  const active = dashboard?.activeRuns?.length ?? snapshot?.runtime?.activeRuns ?? 0;
  const providers = dashboard?.providers ?? snapshot?.runtime?.providers ?? [];
  const launchable = providers.filter((entry) => entry.launchable).length;
  const detected = snapshot?.coverage?.detectedAgents
    ?? diagnostics?.diagnostics?.detected
    ?? providers.filter((p) => p.available).length;
  const governed = snapshot?.coverage?.governedAgents ?? 0;
  const changes = snapshot?.diff?.hasChanges
    ? (snapshot.diff.changeCount ?? snapshot.diff.changes?.length ?? 0)
    : 0;
  const backups = snapshot?.backups?.count ?? 0;

  switch (item.id) {
    case "overview":
      return snapshot?.health?.replaceAll("_", " ")
        ?? resolveProjectReadiness({
          hasGlobalState: true,
          diagnostics,
          dashboard
        }).label;
    case "ides":
      return `${governed}/${detected} governed`;
    case "modules":
      return `${snapshot?.coverage?.components ?? 0} modules`;
    case "changes":
      return changes > 0 ? `${changes} pending` : "Clean";
    case "activity":
      return backups > 0 ? `${backups} backups` : "No backups";
    case "profile":
      return snapshot?.policy?.profile ?? "defaults";
    case "runs":
      return active === 0 ? "Idle" : `${active} active`;
    case "active":
      return active === 0 ? "Idle" : `${active} active`;
    case "providers":
      return `${launchable}/${providers.length || detected} ready`;
    case "launch":
      return launchable > 0 ? "Ready" : "Unavailable";
    case "diagnostics":
      return changes > 0 ? `${changes} pending` : "Checked";
    default:
      return "";
  }
}

export function buildNavModel({
  navIndex = 0,
  currentView = ORCHESTRATOR_VIEWS.HOME,
  focused = false,
  unicode = true,
  items = COCKPIT_NAV,
  dashboard = null,
  diagnostics = null,
  snapshot = null
} = {}) {
  const glyphs = resolveGlyphs(unicode);
  const selected = items[navIndex] ?? items[0];
  const mapped = items.map((item, index) => {
    const isSelected = index === navIndex;
    const isCurrent = item.view === currentView;
    return {
      ...item,
      marker: isSelected ? glyphs.focus : (isCurrent ? glyphs.bullet : " "),
      selected: isSelected,
      current: isCurrent,
      focused: focused && isSelected,
      statusSummary: resolveNavStatusSummary(item, { dashboard, diagnostics, snapshot })
    };
  });

  return {
    title: "NAVIGATION",
    explanation: selected
      ? `${selected.description} (${resolveNavStatusSummary(selected, { dashboard, diagnostics, snapshot })})`
      : "",
    items: mapped
  };
}

export function buildSystemStripModel({
  dashboard = null,
  diagnostics = null,
  readiness = null
} = {}) {
  const agentsDetected = diagnostics?.diagnostics?.detected
    ?? (dashboard?.providers ?? []).filter((p) => p.available).length;
  const agentsTotal = diagnostics?.capabilities?.length
    ?? dashboard?.providers?.length
    ?? 0;
  const activeRuns = dashboard?.activeRuns?.length ?? 0;
  const intelligence = diagnostics?.intelligence?.summary;
  const intelLabel = intelligence?.localAvailable
    ? STATUS_LABELS.local
    : intelligence?.cloudAuthenticated
      ? "Cloud"
      : "None";
  const resolved = readiness ?? resolveProjectReadiness({
    hasGlobalState: agentsDetected > 0,
    diagnostics,
    dashboard
  });

  return {
    title: "SYSTEM",
    rows: [
      { key: "Agents", value: `${agentsDetected}/${agentsTotal}`, kind: agentsDetected > 0 ? "ready" : "warn" },
      { key: "Runs", value: String(activeRuns), kind: activeRuns > 0 ? "ready" : "muted" },
      { key: "Intel", value: intelLabel, kind: intelLabel === "None" ? "warn" : "ready" },
      {
        key: "Health",
        value: STATUS_LABELS[resolved.kind] ?? resolved.label ?? resolved.kind,
        kind: resolved.healthKind ?? "warn"
      }
    ]
  };
}

export function buildFooterModel({
  view = ORCHESTRATOR_VIEWS.HOME,
  region = COCKPIT_REGIONS.NAV,
  helpOpen = false,
  canCancel = false,
  unicode = true,
  hasError = false
} = {}) {
  const glyphs = resolveGlyphs(unicode);
  const parts = [];

  if (hasError) {
    parts.push("R Retry");
    parts.push("Esc Exit");
    return { text: parts.join(` ${glyphs.bullet} `) };
  }

  if (helpOpen || view === ORCHESTRATOR_VIEWS.HELP) {
    parts.push("Esc close help");
    parts.push("? Help");
    return { text: parts.join(` ${glyphs.bullet} `) };
  }

  if (view === ORCHESTRATOR_VIEWS.RUN_DETAIL) {
    parts.push("R refresh");
    if (canCancel) parts.push("C cancel");
    parts.push("Esc Back");
    return { text: parts.join(` ${glyphs.bullet} `) };
  }

  parts.push("↑↓ Navigate");

  const showTab = view === ORCHESTRATOR_VIEWS.ACTIVE_RUNS
    || view === ORCHESTRATOR_VIEWS.RECENT_RUNS
    || view === ORCHESTRATOR_VIEWS.LAUNCH;
  if (showTab) {
    parts.push("Tab Region");
  }

  if (view === ORCHESTRATOR_VIEWS.HOME
    || view === ORCHESTRATOR_VIEWS.IDES
    || view === ORCHESTRATOR_VIEWS.MODULES
    || view === ORCHESTRATOR_VIEWS.CHANGES
    || view === ORCHESTRATOR_VIEWS.ACTIVITY
    || view === ORCHESTRATOR_VIEWS.PROFILE
    || view === ORCHESTRATOR_VIEWS.PROVIDERS
    || view === ORCHESTRATOR_VIEWS.DIAGNOSTICS
    || region === COCKPIT_REGIONS.NAV
    || view === ORCHESTRATOR_VIEWS.ACTIVE_RUNS
    || view === ORCHESTRATOR_VIEWS.RECENT_RUNS) {
    parts.push("Enter Open");
  }

  if (view !== ORCHESTRATOR_VIEWS.LAUNCH) {
    parts.push("R refresh");
  }

  parts.push("? Help");
  parts.push(view === ORCHESTRATOR_VIEWS.HOME ? "Esc Exit" : "Esc Back");

  return { text: parts.join(` ${glyphs.bullet} `) };
}

export function windowLinesForLayout(lines = [], layoutMode = LAYOUT_MODES.COMPACT, contentRows = 12) {
  const limit = resolveListLimit(layoutMode, { contentRows });
  return windowList(lines, limit);
}

export function resolveProjectName(workspaceRoot = "") {
  if (!workspaceRoot) return "project";
  const parts = String(workspaceRoot).split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || "project";
}

export { buildHomeMissionModel, formatHomeRecentRun };
