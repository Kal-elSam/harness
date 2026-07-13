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

export function HomeMissionPanel({ model, colorEnabled = true }) {
  const readiness = model.readiness;
  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Text, {
      bold: true,
      color: colorEnabled ? COCKPIT_COLORS.secondary : undefined
    }, model.title),
    React.createElement(Text, null, model.purpose),
    React.createElement(Text, null, ""),
    React.createElement(Box, { flexDirection: "column" },
      React.createElement(Text, {
        bold: true,
        color: colorEnabled ? COCKPIT_COLORS.primary : undefined
      }, readiness.headline),
      React.createElement(Text, null, readiness.summaryLine),
      ...(readiness.capabilityLines ?? []).map((line) =>
        React.createElement(Text, { key: line, color: COCKPIT_COLORS.muted }, line)
      ),
      React.createElement(Text, null, "")
    ),
    React.createElement(Text, { bold: true }, model.next.title),
    React.createElement(Text, {
      bold: true,
      color: colorEnabled ? COCKPIT_COLORS.primary : undefined
    }, model.next.actionTitle),
    React.createElement(Text, null, model.next.actionDetail),
    React.createElement(Text, { color: COCKPIT_COLORS.muted }, model.next.enterHint),
    React.createElement(Text, null, ""),
    React.createElement(Text, { bold: true }, model.recent.title),
    model.recent.emptyHint
      ? React.createElement(CockpitEmptyState, {
        message: model.recent.emptyHint,
        hint: "Enter opens the recommended next step."
      })
      : React.createElement(Box, { flexDirection: "column" },
        React.createElement(Text, null, model.recent.headline),
        React.createElement(Text, { color: COCKPIT_COLORS.muted }, model.recent.hint)
      ),
    React.createElement(Text, null, ""),
    React.createElement(Text, { bold: true }, model.explore.title),
    model.explore.lines.map((line) =>
      React.createElement(Text, { key: line, color: COCKPIT_COLORS.muted }, line)
    )
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
  layoutMode = LAYOUT_MODES.COMPACT,
  colorEnabled = true
}) {
  switch (view) {
    case ORCHESTRATOR_VIEWS.HOME:
      return React.createElement(HomeMissionPanel, { model: homeMission, colorEnabled });
    case ORCHESTRATOR_VIEWS.ACTIVE_RUNS:
      return listBlock(
        "Running now",
        formatRunLines(dashboard?.activeRuns ?? [], {
          emptyMessage: "No runs are executing. Open New run to start one.",
          readable: true
        }),
        listIndex,
        colorEnabled,
        "Nothing is running yet — that means Kairo is idle, not broken."
      );
    case ORCHESTRATOR_VIEWS.RECENT_RUNS:
      return listBlock(
        "History",
        formatRunLines(dashboard?.recentRuns ?? [], {
          emptyMessage: "No completed runs yet. Create a new run to build history.",
          readable: true
        }),
        listIndex,
        colorEnabled,
        "History fills after supervised runs finish."
      );
    case ORCHESTRATOR_VIEWS.PROVIDERS: {
      const lines = formatProviderLines(dashboard?.providers ?? []);
      const windowed = windowLinesForLayout(lines, layoutMode);
      return React.createElement(Box, { flexDirection: "column" },
        React.createElement(Text, { bold: true }, "Agents"),
        lines.length === 0
          ? React.createElement(CockpitEmptyState, {
            message: "No agents detected yet.",
            hint: "Open System health or finish setup, then return here."
          })
          : windowed.items.map((line) => React.createElement(Text, { key: line }, line)),
        windowed.moreLine && React.createElement(Text, {
          color: COCKPIT_COLORS.muted
        }, windowed.moreLine)
      );
    }
    case ORCHESTRATOR_VIEWS.LAUNCH:
      if (launchableAgents.length === 0) {
        return React.createElement(CockpitEmptyState, {
          title: "New run",
          message: "No executable agents are ready. Kairo cannot start a run yet.",
          hint: "Esc to return · open System health or Agents"
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
    case ORCHESTRATOR_VIEWS.DIAGNOSTICS: {
      const lines = formatSystemHealthLines(diagnostics);
      const windowed = windowLinesForLayout(lines, layoutMode);
      return React.createElement(Box, { flexDirection: "column" },
        React.createElement(Text, { bold: true }, "System health"),
        windowed.items.map((line) => React.createElement(Text, { key: line }, line)),
        windowed.moreLine && React.createElement(Text, {
          color: COCKPIT_COLORS.muted
        }, windowed.moreLine)
      );
    }
    case ORCHESTRATOR_VIEWS.HELP:
      return React.createElement(Box, { flexDirection: "column" },
        React.createElement(Text, { bold: true }, "Help"),
        React.createElement(Text, null, "Kairo coordinates installed AI agents with controlled, auditable runs."),
        React.createElement(Text, null, "↑↓ navigate · Enter open recommended or selected section · Esc back/exit"),
        React.createElement(Text, null, "Tab region (lists / New run) · R refresh/retry · C cancel · ? help"),
        React.createElement(Text, null, "CLI: kairo run --agent <id> --task \"...\""),
        React.createElement(Text, null, "Audit trail: ~/.harness/runs/<runId>/")
      );
    default: {
      const _exhaustive = view;
      return React.createElement(Text, null, `Unknown view: ${_exhaustive}`);
    }
  }
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
