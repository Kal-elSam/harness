import React from "react";
import { Box, Text } from "ink";
import { COCKPIT_COLORS } from "./theme.js";
import { CockpitEmptyState } from "./cockpit/primitives.js";
import {
  formatDiagnosticsLines,
  formatLaunchWizardLines,
  formatProviderLines,
  formatRunDetailLines,
  formatRunLines,
  ORCHESTRATOR_VIEWS,
  LAUNCH_WIZARD_STEPS
} from "./orchestrator-state.js";

export function HomeMissionPanel({ model, colorEnabled = true }) {
  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Text, {
      bold: true,
      color: colorEnabled ? COCKPIT_COLORS.secondary : undefined
    }, model.title),
    React.createElement(Text, { bold: true }, model.recommendedTitle),
    React.createElement(Text, {
      color: colorEnabled ? COCKPIT_COLORS.primary : undefined
    }, model.recommendedAction),
    React.createElement(Text, null, ""),
    React.createElement(Text, { bold: true }, model.activityTitle),
    model.emptyHint
      ? React.createElement(CockpitEmptyState, {
        message: model.emptyHint,
        hint: "Enter on Launch run when ready."
      })
      : model.activityLines.map((line) =>
        React.createElement(Text, { key: line }, line)
      ),
    model.moreLine && React.createElement(Text, {
      color: COCKPIT_COLORS.muted
    }, model.moreLine)
  );
}

export function renderCockpitView({
  view,
  dashboard,
  diagnostics,
  listIndex,
  launchStep,
  launchDraft,
  launchAgentIndex,
  launchPermissionIndex,
  launchableAgents,
  selectedRun,
  selectedEvents,
  homeMission,
  colorEnabled = true
}) {
  switch (view) {
    case ORCHESTRATOR_VIEWS.HOME:
      return React.createElement(HomeMissionPanel, { model: homeMission, colorEnabled });
    case ORCHESTRATOR_VIEWS.ACTIVE_RUNS:
      return listBlock(
        "Active runs",
        formatRunLines(dashboard?.activeRuns ?? [], { emptyMessage: "No active runs." }),
        listIndex,
        colorEnabled
      );
    case ORCHESTRATOR_VIEWS.RECENT_RUNS:
      return listBlock(
        "Recent runs",
        formatRunLines(dashboard?.recentRuns ?? [], { emptyMessage: "No completed runs yet." }),
        listIndex,
        colorEnabled
      );
    case ORCHESTRATOR_VIEWS.PROVIDERS:
      return React.createElement(Box, { flexDirection: "column" },
        React.createElement(Text, { bold: true }, "Providers"),
        formatProviderLines(dashboard?.providers ?? [])
          .map((line) => React.createElement(Text, { key: line }, line))
      );
    case ORCHESTRATOR_VIEWS.LAUNCH:
      if (launchableAgents.length === 0) {
        return React.createElement(CockpitEmptyState, {
          title: "Launch run",
          message: "No launchable agents detected.",
          hint: "Esc to return · check Diagnostics"
        });
      }
      return React.createElement(Box, { flexDirection: "column" },
        React.createElement(Text, { bold: true }, "Launch run"),
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
    case ORCHESTRATOR_VIEWS.DIAGNOSTICS:
      return React.createElement(Box, { flexDirection: "column" },
        React.createElement(Text, { bold: true }, "Diagnostics"),
        formatDiagnosticsLines(diagnostics)
          .map((line) => React.createElement(Text, { key: line }, line))
      );
    case ORCHESTRATOR_VIEWS.HELP:
      return React.createElement(Box, { flexDirection: "column" },
        React.createElement(Text, { bold: true }, "Help"),
        React.createElement(Text, null, "Kairo runtime launches and audits agent CLIs you manage."),
        React.createElement(Text, null, "↑↓ navigate · Tab region · Enter open · Esc back/exit"),
        React.createElement(Text, null, "R refresh · C cancel active run · ? toggle help"),
        React.createElement(Text, null, "CLI: kairo run --agent <id> --task \"...\""),
        React.createElement(Text, null, "Audit trail: ~/.harness/runs/<runId>/")
      );
    default: {
      const _exhaustive = view;
      return React.createElement(Text, null, `Unknown view: ${_exhaustive}`);
    }
  }
}

function listBlock(title, lines, listIndex, colorEnabled) {
  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Text, { bold: true }, title),
    lines.map((line, index) => React.createElement(Text, {
      key: `${index}-${line}`,
      bold: index === listIndex,
      color: index === listIndex && colorEnabled ? COCKPIT_COLORS.primary : undefined
    }, `${index === listIndex ? "› " : "  "}${line}`))
  );
}

export { LAUNCH_WIZARD_STEPS };
