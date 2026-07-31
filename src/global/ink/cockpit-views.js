import React from "react";
import { Box, Text } from "ink";
import { COCKPIT_COLORS } from "./theme.js";
import { CockpitEmptyState } from "./cockpit/primitives.js";
import {
  formatProviderLines,
  formatRunDetailLines,
  formatSystemHealthLines,
  formatLaunchWizardLines,
  ORCHESTRATOR_VIEWS,
  LAUNCH_WIZARD_STEPS
} from "./orchestrator-state.js";
import { windowLinesForLayout } from "./cockpit-models.js";
import { LAYOUT_MODES } from "./layout.js";
import { SemanticOverviewPanel } from "./ux/live-overview.js";
import { SemanticGovernancePanel } from "./ux/live-governance.js";
import { SemanticActivityPanel } from "./ux/live-activity.js";
import { SemanticOrchestrationPanel } from "./ux/live-orchestration.js";
import { SemanticAlertsPanel } from "./ux/live-alerts.js";
import { formatReviewDetailLines } from "./cockpit-reviews.js";
import { formatUsageLines } from "./cockpit-control-center.js";
import { formatSettingsLines } from "./cockpit-settings.js";

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
  alerts = [],
  changesAction = null,
  recoveryAction = null,
  settingsAction = null,
  colorEnabled = true,
  unicode = true,
  overviewDetailsOpen = false,
  governanceDetailsOpen = false,
  activityDetailsOpen = false,
  contentFocused = false,
  homeDir = null
}) {
  if (palette) {
    return React.createElement(PalettePanel, { model: palette, colorEnabled });
  }
  switch (view) {
    case ORCHESTRATOR_VIEWS.HOME:
      return React.createElement(SemanticOverviewPanel, {
        model: controlCenter,
        detailsOpen: overviewDetailsOpen,
        colorEnabled,
        unicode
      });
    case ORCHESTRATOR_VIEWS.USAGE:
      return governanceList(
        "Usage",
        formatUsageLines({ snapshot, dashboard }),
        layoutMode,
        colorEnabled
      );
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
      return React.createElement(SemanticGovernancePanel, {
        snapshot,
        changesAction,
        homeDir,
        detailsOpen: governanceDetailsOpen,
        layoutMode,
        colorEnabled,
        unicode
      });
    case ORCHESTRATOR_VIEWS.ACTIVITY:
      return React.createElement(SemanticActivityPanel, {
        snapshot,
        recoveryAction,
        dashboard,
        listIndex,
        homeDir,
        detailsOpen: activityDetailsOpen,
        layoutMode,
        contentFocused,
        colorEnabled,
        unicode
      });
    case ORCHESTRATOR_VIEWS.PROFILE:
      return governanceList(
        "Settings",
        formatSettingsLines({
          listIndex,
          settingsAction,
          snapshot,
          diagnostics
        }),
        layoutMode,
        colorEnabled
      );
    case ORCHESTRATOR_VIEWS.RUNS:
    case ORCHESTRATOR_VIEWS.ACTIVE_RUNS:
    case ORCHESTRATOR_VIEWS.RECENT_RUNS:
    case ORCHESTRATOR_VIEWS.REVIEWS:
      return React.createElement(SemanticOrchestrationPanel, {
        view,
        dashboard,
        reviews,
        listIndex,
        layoutMode,
        contentFocused,
        colorEnabled,
        unicode
      });
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
        formatRunDetailLines(selectedRun, selectedEvents, { homeDir })
          .map((line) => React.createElement(Text, { key: line }, line))
      );
    case ORCHESTRATOR_VIEWS.REVIEW_DETAIL:
      return React.createElement(Box, { flexDirection: "column" },
        React.createElement(Text, { bold: true }, "Review detail"),
        formatReviewDetailLines(selectedReview)
          .map((line) => React.createElement(Text, { key: line }, line))
      );
    case ORCHESTRATOR_VIEWS.ALERTS:
      return React.createElement(SemanticAlertsPanel, {
        alerts,
        listIndex,
        layoutMode,
        contentFocused,
        colorEnabled,
        unicode
      });
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
      : windowed.items.map((line, index) => React.createElement(Text, {
        key: `${index}-${line}`,
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

export { LAUNCH_WIZARD_STEPS };
