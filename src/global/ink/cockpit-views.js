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

export function ControlCenterPanel({ model, colorEnabled = true }) {
  const health = model.health;
  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Text, {
      bold: true,
      color: colorEnabled ? COCKPIT_COLORS.secondary : undefined
    }, model.title),
    React.createElement(Text, null, model.purpose),
    React.createElement(Text, null, ""),
    React.createElement(Text, {
      bold: true,
      color: colorEnabled ? COCKPIT_COLORS.primary : undefined
    }, health.label),
    React.createElement(Text, null, health.summaryLine),
    ...(model.coverageLines ?? []).map((line) =>
      React.createElement(Text, { key: line, color: COCKPIT_COLORS.muted }, line)
    ),
    React.createElement(Text, null, ""),
    React.createElement(Text, { bold: true }, model.cta.title),
    React.createElement(Text, {
      bold: true,
      color: colorEnabled ? COCKPIT_COLORS.primary : undefined
    }, model.cta.actionTitle),
    React.createElement(Text, null, model.cta.actionDetail),
    React.createElement(Text, { color: COCKPIT_COLORS.muted }, model.cta.enterHint),
    model.notes?.length > 0 && React.createElement(Box, { flexDirection: "column", marginTop: 1 },
      React.createElement(Text, { bold: true }, "NOTES"),
      model.notes.map((line) =>
        React.createElement(Text, { key: line, color: COCKPIT_COLORS.muted }, line)
      )
    ),
    React.createElement(Text, null, ""),
    React.createElement(Text, { color: COCKPIT_COLORS.muted }, model.runsSecondaryHint)
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
  layoutMode = LAYOUT_MODES.COMPACT,
  selectedRun,
  selectedEvents,
  colorEnabled = true
}) {
  switch (view) {
    case ORCHESTRATOR_VIEWS.HOME:
      return React.createElement(ControlCenterPanel, { model: controlCenter, colorEnabled });
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
      return governanceList("Changes", formatChangeLines(snapshot), layoutMode, colorEnabled);
    case ORCHESTRATOR_VIEWS.ACTIVITY:
      return governanceList("Activity & recovery", formatActivityLines(snapshot), layoutMode, colorEnabled);
    case ORCHESTRATOR_VIEWS.PROFILE:
      return governanceList("Profile & policy", formatProfileLines(snapshot, diagnostics), layoutMode, colorEnabled);
    case ORCHESTRATOR_VIEWS.ACTIVE_RUNS:
      return listBlock(
        "Runs",
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
        React.createElement(Text, null, "↑↓ navigate · Enter open · Esc back/exit · R refresh/retry · ? help"),
        React.createElement(Text, null, "Runs are secondary after setup and repairs.")
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

function formatChangeLines(snapshot) {
  const diff = snapshot?.diff;
  if (!diff) return ["Scan did not include diff yet. Press R to reload."];
  if (!diff.installed) {
    return [diff.summary ?? "Setup required before changes can be previewed."];
  }
  if (!diff.hasChanges) {
    return [diff.summary ?? "No pending governance changes.", "Cancel never writes. Confirm is required before apply (slice 3)."];
  }
  const changes = (diff.changes ?? []).map((change) =>
    `${change.action ?? change.kind} · ${change.target} · ${change.status}`
  );
  return [
    diff.summary ?? "Pending changes",
    ...changes,
    "",
    "Preview is exact and read-only until you confirm apply."
  ];
}

function formatActivityLines(snapshot) {
  const events = snapshot?.history?.events ?? [];
  const backups = snapshot?.backups?.snapshots ?? [];
  return [
    `History: ${events.length} recent event(s)`,
    ...events.slice(0, 5).map((event) => `${event.type ?? "event"} · ${event.at ?? event.timestamp ?? ""}`),
    "",
    `Backups: ${snapshot?.backups?.count ?? 0}`,
    ...backups.slice(0, 5).map((entry) => `${entry.name} · ${entry.fileCount ?? "?"} files`),
    "",
    "Rollback remains available through existing CLI recovery paths."
  ];
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
