/**
 * Live semantic Alerts inbox.
 * ActionList owns the only focus mark; windowSlice keeps full open domain navigable.
 * Enter resolve / D dismiss unchanged — adapter exposes focusedId aligned with selectAlertFromList.
 */
import React from "react";
import { Box, Text } from "ink";
import { LAYOUT_MODES } from "../layout.js";
import { ALERT_STATES } from "../../runtime/alerts/alert-types.js";
import { formatAlertsHeadline, selectAlertFromList } from "../cockpit-alerts.js";
import { ActionList, Callout, ViewTitle } from "./semantic.js";
import { windowSlice } from "./live-activity.js";

export function alertsListLimit(layoutMode = LAYOUT_MODES.COMPACT) {
  return layoutMode === LAYOUT_MODES.WIDE ? 8 : 3;
}

function formatAlertWhen(alert) {
  return String(alert.createdAt ?? "").slice(0, 16).replace("T", " ") || "unknown time";
}

function alertLabel(alert) {
  return `${alert.severity} · ${alert.title} · ${formatAlertWhen(alert)}`;
}

function openAlerts(alerts) {
  if (!Array.isArray(alerts)) return [];
  return alerts.filter((alert) => alert.state === ALERT_STATES.OPEN);
}

function unavailablePack() {
  return {
    items: [{ id: "unavailable", label: "Could not read the alert store." }],
    selectedIndex: -1,
    focusedId: null,
    total: 0,
    start: 0,
    isEmpty: true,
    isUnavailable: true
  };
}

function emptyPack() {
  return {
    items: [{ id: "empty", label: "No pending alerts." }],
    selectedIndex: -1,
    focusedId: null,
    total: 0,
    start: 0,
    isEmpty: true,
    isUnavailable: false
  };
}

function populatedPack(open, listIndex, limit) {
  const windowed = windowSlice(open, listIndex, limit);
  const safe = Math.min(Math.max(0, listIndex), open.length - 1);
  const focused = open[safe] ?? null;
  return {
    items: windowed.items.map((alert, i) => ({
      id: alert.alertId ?? `alert-${windowed.start + i}`,
      label: alertLabel(alert)
    })),
    selectedIndex: windowed.selectedIndex,
    focusedId: focused?.alertId ?? null,
    total: open.length,
    start: windowed.start,
    isEmpty: false,
    isUnavailable: false
  };
}

/** Pure adapter: unavailable · empty · pending inbox. */
export function adaptAlertsModel({
  alerts = null,
  listIndex = 0,
  layoutMode = LAYOUT_MODES.COMPACT
} = {}) {
  const limit = alertsListLimit(layoutMode);
  const headline = formatAlertsHeadline(alerts);
  let list;

  if (alerts == null) {
    list = unavailablePack();
  } else {
    const open = openAlerts(alerts);
    list = open.length === 0
      ? emptyPack()
      : populatedPack(open, listIndex, limit);
  }

  const selected = selectAlertFromList(alerts, listIndex);
  if (!list.isEmpty && selected?.alertId) {
    list.focusedId = selected.alertId;
  }

  const callout = list.isUnavailable
    ? {
      tone: "danger",
      title: headline.headline,
      body: "Esc back · / Alerts"
    }
    : list.isEmpty
      ? {
        tone: "info",
        title: headline.headline,
        body: "Esc back · / Alerts"
      }
      : {
        tone: "warn",
        title: headline.headline,
        body: "Enter resolves · D dismisses · Esc back"
      };

  return {
    title: "Alerts",
    callout,
    items: list.items,
    selectedIndex: list.selectedIndex,
    focusedId: list.focusedId,
    total: list.total,
    start: list.start,
    isEmpty: list.isEmpty,
    isUnavailable: list.isUnavailable,
    listLimit: limit
  };
}

export function SemanticAlertsPanel({
  alerts = null,
  listIndex = 0,
  layoutMode = LAYOUT_MODES.COMPACT,
  contentFocused = false,
  colorEnabled = true,
  unicode = true
}) {
  const model = adaptAlertsModel({ alerts, listIndex, layoutMode });
  const listFocused = contentFocused && !model.isEmpty && !model.isUnavailable;
  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(ViewTitle, { colorEnabled }, model.title),
    React.createElement(Callout, {
      tone: model.callout.tone,
      title: model.callout.title,
      body: model.callout.body || undefined,
      colorEnabled,
      compact: true
    }),
    React.createElement(ActionList, {
      items: model.items,
      selectedIndex: model.selectedIndex,
      focused: listFocused,
      colorEnabled,
      unicode
    })
  );
}
