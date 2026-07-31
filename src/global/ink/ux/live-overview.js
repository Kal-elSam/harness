/**
 * Live semantic Overview for Cockpit HOME — product cover.
 * Nav owns the sole focus mark — this panel never renders `>`.
 * ASCII wordmark only here (wide/compact); minimal is textual.
 */
import React from "react";
import { Box, Text } from "ink";
import { CONTROL_PLANE_HEALTH } from "../../control-plane-snapshot.js";
import { LAYOUT_MODES } from "../layout.js";
import { COCKPIT_COLORS } from "../theme.js";
import {
  overviewBrandTitle,
  shouldShowWordmark,
  wordmarkLines
} from "../brand/wordmark.js";
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

function renderWordmark({ layoutMode, colorEnabled = true, unicode = true }) {
  const lines = wordmarkLines(layoutMode, { unicode });
  if (lines.length === 0) return null;
  return React.createElement(Box, { flexDirection: "column", marginBottom: 1 },
    ...lines.map((line, i) => React.createElement(Text, {
      key: `wm-${i}`,
      bold: i === 0,
      color: colorEnabled ? COCKPIT_COLORS.brand : undefined
    }, line))
  );
}

function renderCallout(view, colorEnabled) {
  return React.createElement(Callout, {
    tone: view.callout.tone,
    title: view.callout.title,
    body: view.callout.body,
    colorEnabled,
    compact: true
  });
}

export function SemanticOverviewPanel({
  model,
  detailsOpen = false,
  colorEnabled = true,
  unicode = true,
  layoutMode = LAYOUT_MODES.COMPACT
}) {
  const view = adaptControlCenterToOverview(model);
  const showArt = shouldShowWordmark(layoutMode);
  const brandTitle = overviewBrandTitle(layoutMode);
  const isWide = layoutMode === LAYOUT_MODES.WIDE;
  const mark = renderWordmark({ layoutMode, colorEnabled, unicode });
  const status = renderCallout(view, colorEnabled);

  const hero = showArt
    ? (isWide
      ? React.createElement(Box, { flexDirection: "row", marginBottom: 1 },
        React.createElement(Box, { marginRight: 2 }, mark),
        React.createElement(Box, { flexDirection: "column", flexGrow: 1 }, status)
      )
      : React.createElement(Box, { flexDirection: "column" }, mark, status))
    : React.createElement(Box, { flexDirection: "column" },
      React.createElement(Text, {
        bold: true,
        color: colorEnabled ? COCKPIT_COLORS.brand : undefined
      }, brandTitle),
      status
    );

  return React.createElement(Box, { flexDirection: "column" },
    hero,
    React.createElement(Box, { marginTop: 1, flexDirection: "column" },
      React.createElement(Text, {
        bold: true,
        color: colorEnabled ? COCKPIT_COLORS.interactive : undefined
      }, view.primary.label),
      view.primary.detail
        ? React.createElement(Text, null, view.primary.detail)
        : null,
      view.primary.hint
        ? React.createElement(Text, {
          color: colorEnabled ? COCKPIT_COLORS.muted : undefined
        }, view.primary.hint)
        : null
    ),
    React.createElement(Box, { marginTop: 1, flexDirection: "column" },
      React.createElement(ActionList, {
        items: view.metrics,
        selectedIndex: -1,
        focused: false,
        colorEnabled,
        unicode
      })
    ),
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
