/**
 * Live semantic Overview for Cockpit HOME — product cover.
 * Content owns the button focus mark when region=content.
 * ASCII wordmark only here (wide/compact); minimal is textual.
 *
 * Rule: show purpose + two buttons + a few plain-language needs.
 * Machine/system noise stays out of the first screen (Details only).
 */
import React from "react";
import { Box, Text } from "ink";
import { DASHBOARD_PURPOSE } from "../../dashboard-guidance.js";
import { LAYOUT_MODES } from "../layout.js";
import { COCKPIT_COLORS, resolveGlyphs } from "../theme.js";
import {
  overviewBrandTitle,
  shouldShowWordmark,
  wordmarkLines
} from "../brand/wordmark.js";
import { ActionList, Callout, Details } from "./semantic.js";
import {
  humanizeDestination,
  humanizeHealthTitle,
  humanizePrimary,
  mapHealthTone,
  partitionCompanionLines
} from "./overview-needs.js";
import { buildOverviewButtons, OVERVIEW_BUTTON_COUNT } from "./overview-actions.js";

export {
  humanizeCompanionNeed,
  humanizeHealthTitle,
  humanizePrimary,
  mapHealthTone,
  partitionCompanionLines
} from "./overview-needs.js";

export { buildOverviewButtons, OVERVIEW_BUTTON_COUNT } from "./overview-actions.js";

/** Safe Details lines — leftovers + raw signals; never invent paths/IDs. */
export function buildOverviewDetails(model = {}, companionRest = []) {
  const lines = [];
  const next = model.nextAction ?? model.cta ?? {};
  const dest = humanizeDestination(next.destination);
  if (dest) lines.push(`Opens · ${dest}`);
  if (typeof model.alerts?.count === "number" && model.alerts.count > 0) {
    lines.push(`Open alerts · ${model.alerts.count}`);
  }
  const tokens = model.tokens?.headline;
  if (typeof tokens === "string" && tokens && !/unavailable/i.test(tokens)) {
    lines.push(`Tokens · ${tokens}`);
  }
  const secondary = model.companionNextAction;
  if (secondary?.title && secondary.kind !== "idle") {
    lines.push(`Companion · ${secondary.title}`);
  }
  for (const line of companionRest) {
    if (typeof line === "string" && line.trim()) lines.push(line);
  }
  if (lines.length === 0) return ["Nothing else to show right now."];
  return lines;
}

/**
 * Pure adapter: buildControlCenterModel → semantic overview props.
 * First screen = purpose + two buttons + plain needs. Machine noise → Details.
 */
export function adaptControlCenterToOverview(model = {}, options = {}) {
  const status = model.status ?? model.health ?? {};
  const next = model.nextAction ?? model.cta ?? {};
  const { needs, rest } = partitionCompanionLines(model.companion?.lines ?? []);
  const primary = humanizePrimary(next);
  const buttons = buildOverviewButtons({
    hasGlobalState: options.hasGlobalState,
    snapshot: options.snapshot,
    diagnostics: options.diagnostics,
    dashboard: options.dashboard
  });

  const activity = model.activity?.headline;
  const metrics = [];
  const hasUsefulActivity = typeof activity === "string"
    && activity
    && activity !== "Idle"
    && activity !== "No activity yet";
  if (hasUsefulActivity) {
    metrics.push({ id: "activity", label: `Last activity · ${activity.replace(/^Last ·\s*/, "")}` });
  }
  for (let i = 0; i < needs.length; i += 1) {
    metrics.push({ id: `need-${i}`, label: needs[i] });
  }
  if ((model.alerts?.count ?? 0) > 0) {
    metrics.push({
      id: "alerts",
      label: `Alerts · ${model.alerts.headline ?? `${model.alerts.count} open`}`
    });
  }
  if (rest.length > 0) {
    metrics.push({
      id: "more",
      label: `${rest.length} more in Details · Space`
    });
  }
  if (metrics.length === 0) {
    metrics.push({ id: "quiet", label: "Nothing else needs you right now" });
  }

  return {
    title: model.title ?? "Overview",
    purpose: DASHBOARD_PURPOSE,
    callout: {
      tone: mapHealthTone(status.kind),
      title: humanizeHealthTitle(status.kind, status.label),
      body: status.summaryLine ?? ""
    },
    primary,
    buttons,
    metrics,
    details: buildOverviewDetails(model, rest)
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
  layoutMode = LAYOUT_MODES.COMPACT,
  selectedIndex = 0,
  contentFocused = false,
  hasGlobalState = false,
  snapshot = null,
  diagnostics = null,
  dashboard = null
}) {
  const view = adaptControlCenterToOverview(model, {
    hasGlobalState,
    snapshot,
    diagnostics,
    dashboard
  });
  const showArt = shouldShowWordmark(layoutMode);
  const brandTitle = overviewBrandTitle(layoutMode);
  const isWide = layoutMode === LAYOUT_MODES.WIDE;
  const mark = renderWordmark({ layoutMode, colorEnabled, unicode });
  const status = renderCallout(view, colorEnabled);
  const safeIndex = Math.min(
    Math.max(0, selectedIndex),
    Math.max(0, view.buttons.length - 1)
  );
  const glyphs = resolveGlyphs(unicode);

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
    React.createElement(Text, {
      color: colorEnabled ? COCKPIT_COLORS.muted : undefined
    }, view.purpose),
    React.createElement(Box, { marginTop: 1, flexDirection: "column" },
      ...view.buttons.map((button, index) => {
        const selected = index === safeIndex;
        const focused = contentFocused && selected;
        return React.createElement(Box, {
          key: button.id,
          flexDirection: "column",
          marginBottom: index === view.buttons.length - 1 ? 0 : 1
        },
          React.createElement(Text, {
            bold: true,
            color: focused && colorEnabled ? COCKPIT_COLORS.interactive : undefined
          }, `${focused ? glyphs.focus : " "} ${button.label}`),
          button.detail
            ? React.createElement(Text, {
              color: colorEnabled ? COCKPIT_COLORS.muted : undefined
            }, `  ${button.detail}`)
            : null
        );
      })
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
      summary: "More info",
      lines: view.details,
      colorEnabled,
      focused: false,
      mark: " "
    })
  );
}
