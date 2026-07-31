/**
 * Live semantic Overview for Cockpit HOME.
 * Nav owns the sole focus mark — this panel never renders `>`.
 */
import React from "react";
import { Box, Text } from "ink";
import { CONTROL_PLANE_HEALTH } from "../../control-plane-snapshot.js";
import { COCKPIT_COLORS } from "../theme.js";
import { ActionList, Callout, Details } from "./semantic.js";

const DESTINATION_LABELS = {
  setup: "Setup",
  changes: "Governance",
  ides: "Agents",
  runs: "Orchestration",
  "control-center": "Overview",
  activity: "Activity",
  usage: "Usage",
  profile: "Settings"
};

export function mapHealthTone(kind) {
  switch (kind) {
    case CONTROL_PLANE_HEALTH.CHECK_FAILED:
      return "danger";
    case CONTROL_PLANE_HEALTH.ACTION_REQUIRED:
    case CONTROL_PLANE_HEALTH.NOT_CONFIGURED:
    case CONTROL_PLANE_HEALTH.HEALTHY_WITH_NOTES:
      return "warn";
    case CONTROL_PLANE_HEALTH.HEALTHY:
      return "ready";
    default:
      return "warn";
  }
}

function humanizeDestination(destination) {
  if (!destination) return null;
  return DESTINATION_LABELS[destination] ?? null;
}

/** Safe Details lines only — never invent paths/IDs; honest empty when none. */
export function buildOverviewDetails(model = {}) {
  const lines = [];
  const next = model.nextAction ?? model.cta ?? {};
  const dest = humanizeDestination(next.destination);
  if (dest) lines.push(`Next destination · ${dest}`);
  if (typeof model.alerts?.count === "number") {
    lines.push(`Open alerts · ${model.alerts.count}`);
  }
  if (lines.length === 0) return ["No extra evidence beyond the metrics above."];
  return lines;
}

/**
 * Pure adapter: buildControlCenterModel → semantic overview props.
 * Callout / CTA / metrics never include paths or IDs.
 */
export function adaptControlCenterToOverview(model = {}) {
  const status = model.status ?? model.health ?? {};
  const next = model.nextAction ?? model.cta ?? {};
  return {
    title: model.title ?? "Overview",
    callout: {
      tone: mapHealthTone(status.kind),
      title: status.label ?? "Unknown",
      body: status.summaryLine ?? ""
    },
    primary: {
      label: next.actionTitle ?? "Review control plane",
      detail: next.actionDetail || null,
      hint: next.enterHint ?? null
    },
    metrics: [
      { id: "activity", label: `Activity · ${model.activity?.headline ?? "Idle"}` },
      { id: "alerts", label: `Alerts · ${model.alerts?.headline ?? "Alert data unavailable"}` },
      { id: "tokens", label: `Tokens · ${model.tokens?.headline ?? "Data unavailable"}` }
    ],
    details: buildOverviewDetails(model)
  };
}

export function SemanticOverviewPanel({
  model,
  detailsOpen = false,
  colorEnabled = true,
  unicode = true
}) {
  const view = adaptControlCenterToOverview(model);
  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Text, {
      bold: true,
      color: colorEnabled ? COCKPIT_COLORS.secondary : undefined
    }, view.title),
    React.createElement(Callout, {
      tone: view.callout.tone,
      title: view.callout.title,
      body: view.callout.body,
      colorEnabled,
      compact: true
    }),
    React.createElement(Text, { bold: true }, `  ${view.primary.label}`),
    view.primary.detail
      ? React.createElement(Text, null, view.primary.detail)
      : null,
    view.primary.hint
      ? React.createElement(Text, { color: colorEnabled ? COCKPIT_COLORS.muted : undefined }, view.primary.hint)
      : null,
    React.createElement(ActionList, {
      items: view.metrics,
      selectedIndex: -1,
      focused: false,
      colorEnabled,
      unicode
    }),
    React.createElement(Details, {
      open: detailsOpen,
      summary: "Details",
      lines: view.details,
      colorEnabled,
      focused: false,
      mark: " "
    })
  );
}
