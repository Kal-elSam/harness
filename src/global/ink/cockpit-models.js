import { LAYOUT_MODES, resolveListLimit } from "./layout.js";
import { ORCHESTRATOR_VIEWS } from "./orchestrator-state.js";
import { resolveProjectReadiness } from "../dashboard-guidance.js";
import { STATUS_LABELS, resolveGlyphs } from "./theme.js";
import { windowList } from "./list-window.js";
import { buildHomeMissionModel, formatHomeRecentRun } from "./cockpit-home.js";
import { isRunsBranchView } from "./cockpit-runs.js";
import { buildChangesFooterParts } from "./cockpit-changes.js";
import { buildRecoveryFooterParts } from "./cockpit-recovery.js";
import { buildSettingsFooterParts, SETTINGS_PHASE } from "./cockpit-settings.js";

export const COCKPIT_REGIONS = {
  NAV: "nav",
  CONTENT: "content",
  SYSTEM: "system"
};

export const COCKPIT_NAV = [
  {
    id: "home",
    label: "Home",
    view: ORCHESTRATOR_VIEWS.HOME,
    description: "What needs you, and what to do about it."
  },
  {
    id: "settings",
    label: "Settings",
    view: ORCHESTRATOR_VIEWS.PROFILE,
    description: "Choose agents, connect Obsidian, add integrations."
  },
  {
    id: "history",
    label: "History",
    view: ORCHESTRATOR_VIEWS.ACTIVITY,
    description: "What Kairo changed, and how to undo it."
  }
];

/** Destinations reachable via the action palette, not the top nav. */
export const COCKPIT_SECONDARY = [
  {
    id: "governance",
    label: "Governance",
    view: ORCHESTRATOR_VIEWS.CHANGES,
    description: "Repair drift and apply governed changes."
  },
  {
    id: "orchestration",
    label: "Orchestration",
    view: ORCHESTRATOR_VIEWS.RUNS,
    description: "Runs, reviews, and supervised execution."
  },
  {
    id: "usage",
    label: "Usage",
    view: ORCHESTRATOR_VIEWS.USAGE,
    description: "Token and context pressure when auditable."
  }
];

export function regionsForLayout(layoutMode) {
  // Single main panel: nav strip + content. SYSTEM column retired from the shell.
  if (layoutMode === LAYOUT_MODES.WIDE || layoutMode === LAYOUT_MODES.COMPACT) {
    return [COCKPIT_REGIONS.NAV, COCKPIT_REGIONS.CONTENT];
  }
  return [COCKPIT_REGIONS.CONTENT];
}

export function navIndexForView(view, items = COCKPIT_NAV) {
  if (isRunsBranchView(view)) {
    const historyIndex = items.findIndex((item) => item.id === "history");
    return historyIndex >= 0 ? historyIndex : 0;
  }
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
    case "home":
    case "overview":
      return snapshot?.health?.replaceAll("_", " ")
        ?? resolveProjectReadiness({
          hasGlobalState: true,
          diagnostics,
          dashboard
        }).label;
    case "governance":
      return changes > 0 ? `${changes} pending` : "Clean";
    case "history":
    case "activity":
      return backups > 0 ? `${backups} backups` : "No backups";
    case "orchestration":
      return active === 0 ? "Idle" : `${active} active`;
    case "usage": {
      if (Number.isFinite(snapshot?.budgets?.stableUsedTokens)) return "Auditable";
      const resolved = dashboard?.profile?.profile ?? {};
      if (Number.isFinite(resolved.tokenBudget)
        || Number.isFinite(resolved.stableContextBudget)
        || Number.isFinite(resolved.requestContextBudget)) {
        return "Auditable";
      }
      const runs = [...(dashboard?.activeRuns ?? []), ...(dashboard?.recentRuns ?? [])];
      return runs.some((run) => {
        const u = run?.tokenUsage;
        return u && typeof u === "object"
          && (Number.isFinite(u.total) || Number.isFinite(u.input) || Number.isFinite(u.output));
      })
        ? "Auditable"
        : "n/a";
    }
    case "settings":
      return snapshot?.policy?.profile ?? "defaults";
    case "ides":
      return `${governed}/${detected} governed`;
    case "modules":
      return `${snapshot?.coverage?.components ?? 0} modules`;
    case "changes":
      return changes > 0 ? `${changes} pending` : "Clean";
    case "profile":
      return snapshot?.policy?.profile ?? "defaults";
    case "runs":
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
    const isCurrent = item.view === currentView
      || (item.id === "history" && isRunsBranchView(currentView))
      || (item.id === "orchestration" && isRunsBranchView(currentView));
    return {
      ...item,
      marker: isSelected ? glyphs.focus : (isCurrent ? glyphs.bullet : " "),
      selected: isSelected,
      current: isCurrent,
      focused: focused && isSelected,
      statusSummary: resolveNavStatusSummary(item, { dashboard, diagnostics, snapshot })
    };
  });

  const explanation = !selected || selected.id === "home" || selected.id === "overview"
    ? ""
    : (selected.description ?? "");

  return {
    title: "NAVIGATION",
    explanation,
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
  navIndex = 0,
  helpOpen = false,
  paletteOpen = false,
  canCancel = false,
  unicode = true,
  hasError = false,
  changesPhase = null,
  recoveryPhase = null,
  recoveryHasPreview = false,
  settingsPhase = null,
  columns = 80
} = {}) {
  const glyphs = resolveGlyphs(unicode);
  const parts = [];
  const footerColumns = Math.max(24, Math.min(Number(columns) || 80, 120));

  if (hasError) {
    parts.push("R Retry");
    parts.push("Esc Exit");
    return { text: parts.join(` ${glyphs.bullet} `), columns: footerColumns };
  }

  if (paletteOpen) {
    return {
      text: ["↑↓ Select", "Enter Run", "Esc Close"].join(` ${glyphs.bullet} `),
      columns: footerColumns
    };
  }

  if (helpOpen || view === ORCHESTRATOR_VIEWS.HELP) {
    parts.push("Esc close help");
    parts.push("? Help");
    return { text: parts.join(` ${glyphs.bullet} `), columns: footerColumns };
  }

  if (view === ORCHESTRATOR_VIEWS.RUN_DETAIL) {
    parts.push("R refresh");
    if (canCancel) parts.push("C cancel");
    parts.push("Esc Back");
    return { text: parts.join(` ${glyphs.bullet} `), columns: footerColumns };
  }

  if (view === ORCHESTRATOR_VIEWS.REVIEW_DETAIL) {
    parts.push("Esc Back");
    return { text: parts.join(` ${glyphs.bullet} `), columns: footerColumns };
  }

  if (view === ORCHESTRATOR_VIEWS.CHANGES) {
    return {
      text: buildChangesFooterParts(changesPhase).join(` ${glyphs.bullet} `),
      columns: footerColumns
    };
  }

  if (view === ORCHESTRATOR_VIEWS.ACTIVITY) {
    return {
      text: buildRecoveryFooterParts(recoveryPhase, { hasPreview: recoveryHasPreview })
        .join(` ${glyphs.bullet} `),
      columns: footerColumns
    };
  }

  if (view === ORCHESTRATOR_VIEWS.PROFILE) {
    return {
      text: buildSettingsFooterParts(settingsPhase ?? SETTINGS_PHASE.BROWSE)
        .join(` ${glyphs.bullet} `),
      columns: footerColumns
    };
  }

  parts.push("↑↓ Navigate");

  const showTab = view === ORCHESTRATOR_VIEWS.RUNS
    || view === ORCHESTRATOR_VIEWS.ACTIVE_RUNS
    || view === ORCHESTRATOR_VIEWS.RECENT_RUNS
    || view === ORCHESTRATOR_VIEWS.REVIEWS
    || view === ORCHESTRATOR_VIEWS.LAUNCH
    || view === ORCHESTRATOR_VIEWS.ACTIVITY;
  if (showTab) {
    parts.push("Tab Region");
  }

  // HOME footer must stay on one line at 80 cols (frame already near 24 rows).
  if (view === ORCHESTRATOR_VIEWS.HOME) {
    return {
      text: ["↑↓", "Enter", "Tab", "Space", "R", "?", "/", "Esc"].join(` ${glyphs.bullet} `),
      columns: footerColumns
    };
  }

  if (region === COCKPIT_REGIONS.NAV
    || view === ORCHESTRATOR_VIEWS.IDES
    || view === ORCHESTRATOR_VIEWS.MODULES
    || view === ORCHESTRATOR_VIEWS.PROFILE
    || view === ORCHESTRATOR_VIEWS.PROVIDERS
    || view === ORCHESTRATOR_VIEWS.DIAGNOSTICS
    || view === ORCHESTRATOR_VIEWS.USAGE
    || view === ORCHESTRATOR_VIEWS.RUNS
    || view === ORCHESTRATOR_VIEWS.ACTIVE_RUNS
    || view === ORCHESTRATOR_VIEWS.RECENT_RUNS
    || view === ORCHESTRATOR_VIEWS.REVIEWS) {
    parts.push("Enter Open");
  }
  if (view !== ORCHESTRATOR_VIEWS.LAUNCH) {
    parts.push("R refresh");
  }

  parts.push("? Help");
  parts.push("/ Actions");
  parts.push("Esc Back");

  return { text: parts.join(` ${glyphs.bullet} `), columns: footerColumns };
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
