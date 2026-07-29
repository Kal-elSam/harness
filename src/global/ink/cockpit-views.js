import React from "react";
import { Box, Text } from "ink";
import { COCKPIT_COLORS } from "./theme.js";
import { CockpitEmptyState } from "./cockpit/primitives.js";
import {
  formatProviderLines,
  formatRunDetailLines,
  formatRunLines,
  formatSystemHealthLines,
  formatLaunchWizardLines,
  ORCHESTRATOR_VIEWS,
  LAUNCH_WIZARD_STEPS
} from "./orchestrator-state.js";
import { windowLinesForLayout } from "./cockpit-models.js";
import { LAYOUT_MODES } from "./layout.js";
import { formatRunsHubLines, RUNS_HUB_ITEMS } from "./cockpit-runs.js";
import { formatReviewDetailLines, formatReviewListLines } from "./cockpit-reviews.js";
import { formatChangesActionLines } from "./cockpit-changes.js";
import { formatRecoveryLines } from "./cockpit-recovery.js";

export function PalettePanel({ model, colorEnabled = true }) {
  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Text, {
      bold: true,
      color: colorEnabled ? COCKPIT_COLORS.secondary : undefined
    }, model.title),
    React.createElement(Text, { color: COCKPIT_COLORS.muted }, model.hint),
    React.createElement(Text, null, ""),
    ...(model.items ?? []).map((item) => React.createElement(Text, {
      key: item.id,
      bold: item.selected,
      color: item.selected && colorEnabled ? COCKPIT_COLORS.primary : undefined
    }, `${item.marker} ${item.label}`))
  );
}

export function ControlCenterPanel({ model, colorEnabled = true }) {
  const status = model.status ?? model.health;
  const next = model.nextAction ?? model.cta;
  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Text, {
      bold: true,
      color: colorEnabled ? COCKPIT_COLORS.secondary : undefined
    }, model.title),
    React.createElement(Text, null, ""),
    React.createElement(Text, {
      bold: true,
      color: colorEnabled ? COCKPIT_COLORS.primary : undefined
    }, status?.label),
    React.createElement(Text, null, status?.summaryLine),
    React.createElement(Text, null, ""),
    React.createElement(Text, { bold: true }, next?.title ?? "NEXT"),
    React.createElement(Text, {
      bold: true,
      color: colorEnabled ? COCKPIT_COLORS.primary : undefined
    }, next?.actionTitle),
    next?.actionDetail ? React.createElement(Text, null, next.actionDetail) : null,
    React.createElement(Text, { color: COCKPIT_COLORS.muted }, next?.enterHint),
    React.createElement(Text, null, ""),
    React.createElement(Text, { bold: true }, "ACTIVITY"),
    React.createElement(Text, null, model.activity?.headline ?? "Idle"),
    React.createElement(Text, null, ""),
    React.createElement(Text, { bold: true }, "ALERTS"),
    React.createElement(Text, null, model.alerts?.headline ?? "Alert data unavailable"),
    React.createElement(Text, null, ""),
    React.createElement(Text, { bold: true }, "TOKENS"),
    React.createElement(Text, null, model.tokens?.headline ?? "Data unavailable")
  );
}

export function renderCockpitView({
  view,
  dashboard,
  diagnostics,
  snapshot,
  listIndex,
  launchStep,
  launchDraft,
  launchAgentIndex,
  launchPermissionIndex,
  launchableAgents,
  controlCenter,
  palette = null,
  layoutMode = LAYOUT_MODES.COMPACT,
  selectedRun,
  selectedEvents,
  reviews = [],
  selectedReview = null,
  changesAction = null,
  recoveryAction = null,
  colorEnabled = true
}) {
  if (palette) {
    return React.createElement(PalettePanel, { model: palette, colorEnabled });
  }
  switch (view) {
    case ORCHESTRATOR_VIEWS.HOME:
      return React.createElement(ControlCenterPanel, { model: controlCenter, colorEnabled });
    case ORCHESTRATOR_VIEWS.USAGE:
      return governanceList("Usage", [
        controlCenter?.tokens?.headline ?? "Data unavailable",
        "",
        "Auditable budgets only — no invented token savings."
      ], layoutMode, colorEnabled);
    case ORCHESTRATOR_VIEWS.IDES:
    case ORCHESTRATOR_VIEWS.PROVIDERS:
      return governanceList("IDEs & models", [
        ...formatProviderLines(dashboard?.providers ?? snapshot?.runtime?.providers ?? []),
        "",
        "Engram / Graphify appear as external integrations when detected; Kairo does not claim to install them."
      ], layoutMode, colorEnabled);
    case ORCHESTRATOR_VIEWS.MODULES:
      return governanceList("Harness modules", formatModuleLines(snapshot), layoutMode, colorEnabled);
    case ORCHESTRATOR_VIEWS.CHANGES:
      return governanceList(
        "Governance",
        formatChangeLines(snapshot, changesAction, layoutMode),
        layoutMode,
        colorEnabled
      );
    case ORCHESTRATOR_VIEWS.ACTIVITY:
      return governanceList(
        "Activity",
        formatRecoveryLines({ snapshot, recoveryAction, listIndex, dashboard }),
        layoutMode,
        colorEnabled
      );
    case ORCHESTRATOR_VIEWS.PROFILE:
      return governanceList("Profile & policy", formatProfileLines(snapshot, diagnostics), layoutMode, colorEnabled);
    case ORCHESTRATOR_VIEWS.RUNS:
      return listBlock(
        "Runs",
        formatRunsHubLines(RUNS_HUB_ITEMS),
        listIndex,
        colorEnabled,
        "Choose Active runs, History, Reviews, or New run."
      );
    case ORCHESTRATOR_VIEWS.ACTIVE_RUNS:
      return listBlock(
        "Active runs",
        formatRunLines(dashboard?.activeRuns ?? [], {
          emptyMessage: "No runs executing. Governance first — launch only after setup/repairs.",
          readable: true
        }),
        listIndex,
        colorEnabled,
        "Runs are secondary. Prefer Control center Actions when drift or setup remains."
      );
    case ORCHESTRATOR_VIEWS.RECENT_RUNS:
      return listBlock(
        "Run history",
        formatRunLines(dashboard?.recentRuns ?? [], {
          emptyMessage: "No completed runs yet.",
          readable: true
        }),
        listIndex,
        colorEnabled,
        "Open Runs after governance is healthy."
      );
    case ORCHESTRATOR_VIEWS.REVIEWS:
      return listBlock(
        "Reviews",
        formatReviewListLines(reviews),
        listIndex,
        colorEnabled,
        "Receipts are read-only. Launch reviews via kairo review --agent codex|pi."
      );
    case ORCHESTRATOR_VIEWS.LAUNCH:
      if (launchableAgents.length === 0) {
        return React.createElement(CockpitEmptyState, {
          title: "Runs",
          message: "No executable agents are ready.",
          hint: "Return to IDEs & models or Changes first."
        });
      }
      return React.createElement(Box, { flexDirection: "column" },
        React.createElement(Text, { bold: true }, "New run"),
        formatLaunchWizardLines({
          step: launchStep,
          draft: launchDraft,
          launchableAgents,
          agentIndex: launchAgentIndex,
          permissionIndex: launchPermissionIndex
        }).map((line) => React.createElement(Text, {
          key: line,
          color: line.startsWith("›") || line.startsWith(">")
            ? (colorEnabled ? COCKPIT_COLORS.primary : undefined)
            : undefined
        }, line))
      );
    case ORCHESTRATOR_VIEWS.RUN_DETAIL:
      return React.createElement(Box, { flexDirection: "column" },
        React.createElement(Text, { bold: true }, "Run detail"),
        formatRunDetailLines(selectedRun, selectedEvents)
          .map((line) => React.createElement(Text, { key: line }, line))
      );
    case ORCHESTRATOR_VIEWS.REVIEW_DETAIL:
      return React.createElement(Box, { flexDirection: "column" },
        React.createElement(Text, { bold: true }, "Review detail"),
        formatReviewDetailLines(selectedReview)
          .map((line) => React.createElement(Text, { key: line }, line))
      );
    case ORCHESTRATOR_VIEWS.DIAGNOSTICS:
      return governanceList(
        "System health",
        formatSystemHealthLines(diagnostics),
        layoutMode,
        colorEnabled
      );
    case ORCHESTRATOR_VIEWS.HELP:
      return React.createElement(Box, { flexDirection: "column" },
        React.createElement(Text, { bold: true }, "Help"),
        React.createElement(Text, null, "Kairo keeps IDEs and agents aligned with project architecture and workflows."),
        React.createElement(Text, null, "Primary flow: scan → findings → preview → confirm → apply → re-scan."),
        React.createElement(Text, null, "↑↓ navigate · Enter open/activate · / actions · Esc back · R refresh · ? help"),
        React.createElement(Text, null, "Overview hides raw diagnostics — Enter opens detail destinations.")
      );
    default: {
      const _exhaustive = view;
      return React.createElement(Text, null, `Unknown view: ${_exhaustive}`);
    }
  }
}

function governanceList(title, lines, layoutMode, colorEnabled) {
  const windowed = windowLinesForLayout(lines, layoutMode);
  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Text, { bold: true }, title),
    lines.length === 0
      ? React.createElement(CockpitEmptyState, {
        message: "No data yet from the read-only scan.",
        hint: "Press R to rescan."
      })
      : windowed.items.map((line) => React.createElement(Text, {
        key: line,
        color: colorEnabled ? undefined : undefined
      }, line)),
    windowed.moreLine && React.createElement(Text, {
      color: COCKPIT_COLORS.muted
    }, windowed.moreLine)
  );
}

function formatModuleLines(snapshot) {
  const components = snapshot?.status?.components ?? [];
  if (components.length === 0) {
    return [
      "No harness modules installed yet.",
      "Orchestrator / SDD-TDD appear after setup.",
      "Engram and Graphify are external integrations Kairo can verify, not install."
    ];
  }
  return [
    ...components.map((entry) => `${entry.id} · ${entry.status} · ${entry.source} · v${entry.version}`),
    "",
    "External integrations are reported only when detectable on this machine."
  ];
}

function formatChangeLines(snapshot, changesAction, layoutMode = LAYOUT_MODES.COMPACT) {
  return formatChangesActionLines({ snapshot, changesAction, layoutMode });
}

function formatProfileLines(snapshot, diagnostics) {
  const policy = snapshot?.policy;
  const sources = diagnostics?.profile?.sources;
  const sourceLabel = sources?.global || sources?.project
    ? [sources.global ? "global" : null, sources.project ? "project" : null].filter(Boolean).join(", ")
    : "none";
  return [
    `Policy profile: ${policy?.profile ?? "none"}`,
    `Apply mode: ${policy?.applyMode ?? "n/a"}`,
    `Preflight: ${policy?.preflight ?? "n/a"}`,
    `Policy source: ${policy?.source ?? "none"}`,
    `Kairo profile sources: ${sourceLabel}`,
    "",
    "Project overrides global overrides defaults. Consent remains explicit for writes."
  ];
}

function listBlock(title, lines, listIndex, colorEnabled, emptyHint) {
  const isEmpty = lines.length === 1 && /no |nothing |empty/i.test(lines[0]);
  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Text, { bold: true }, title),
    isEmpty
      ? React.createElement(CockpitEmptyState, {
        message: lines[0],
        hint: emptyHint
      })
      : lines.map((line, index) => React.createElement(Text, {
        key: `${index}-${line}`,
        bold: index === listIndex,
        color: index === listIndex && colorEnabled ? COCKPIT_COLORS.primary : undefined
      }, `${index === listIndex ? "› " : "  "}${line}`))
  );
}

export { LAUNCH_WIZARD_STEPS };
