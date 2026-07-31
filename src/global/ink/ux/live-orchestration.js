/**
 * Live semantic Orchestration lists (Hub / Active / History / Reviews).
 * ActionList owns the only focus mark; windowSlice keeps full domain navigable.
 * Enter destinations unchanged — adapter exposes focused identity for listIndex.
 */
import React from "react";
import { Box, Text } from "ink";
import { LAYOUT_MODES } from "../layout.js";
import { ORCHESTRATOR_VIEWS, formatRunLines } from "../orchestrator-state.js";
import {
  RUNS_HUB_ITEMS, formatOrchestrationStatus, formatRunsHubLines
} from "../cockpit-runs.js";
import { formatReviewListLines } from "../cockpit-reviews.js";
import { ActionList, Callout, ViewTitle } from "./semantic.js";
import { windowSlice } from "./live-activity.js";

export function orchestrationListLimit(layoutMode = LAYOUT_MODES.COMPACT) {
  return layoutMode === LAYOUT_MODES.WIDE ? 8 : 3;
}

function emptyPack(label) {
  return {
    items: [{ id: "empty", label }],
    selectedIndex: -1,
    focusedId: null,
    total: 0,
    start: 0,
    isEmpty: true
  };
}

function windowDomain(domain, listIndex, limit, toItem, emptyLabel) {
  const windowed = windowSlice(domain, listIndex, limit);
  if (windowed.items.length === 0) return emptyPack(emptyLabel);
  const safe = Math.min(Math.max(0, listIndex), domain.length - 1);
  return {
    items: windowed.items.map((entry, i) => toItem(entry, windowed.start + i)),
    selectedIndex: windowed.selectedIndex,
    focusedId: toItem(domain[safe], safe).id,
    total: domain.length,
    start: windowed.start,
    isEmpty: false
  };
}

function hubPack(listIndex) {
  const labels = formatRunsHubLines(RUNS_HUB_ITEMS);
  const items = RUNS_HUB_ITEMS.map((item, i) => ({
    id: item.id,
    label: labels[i] ?? item.label
  }));
  const safe = Math.min(Math.max(0, listIndex), items.length - 1);
  return {
    items,
    selectedIndex: safe,
    focusedId: items[safe]?.id ?? null,
    total: items.length,
    start: 0,
    isEmpty: false
  };
}

function runPack(runs, listIndex, limit, emptyLabel) {
  return windowDomain(runs, listIndex, limit, (run, absoluteIndex) => ({
    id: run.runId ?? `run-${absoluteIndex}`,
    label: formatRunLines([run], { readable: true })[0]
  }), emptyLabel);
}

function reviewPack(reviews, listIndex, limit) {
  const empty = "No review receipts yet. Run kairo review --agent codex|pi.";
  return windowDomain(reviews, listIndex, limit, (receipt, absoluteIndex) => ({
    id: receipt.reviewId ?? `review-${absoluteIndex}`,
    label: formatReviewListLines([receipt])[0]
  }), empty);
}

/** Pure adapter: Hub · Active · History · Reviews. */
export function adaptOrchestrationModel({
  view = ORCHESTRATOR_VIEWS.RUNS,
  dashboard = null,
  reviews = [],
  listIndex = 0,
  layoutMode = LAYOUT_MODES.COMPACT
} = {}) {
  const limit = orchestrationListLimit(layoutMode);
  const active = dashboard?.activeRuns ?? [];
  const recent = dashboard?.recentRuns ?? [];
  const reviewList = Array.isArray(reviews) ? reviews : [];
  const status = formatOrchestrationStatus({
    active: active.length, recent: recent.length, reviews: reviewList.length
  });

  let title = "Orchestration";
  let callout = { tone: active.length > 0 ? "warn" : "info", title: status, body: "" };
  let list = hubPack(listIndex);

  if (view === ORCHESTRATOR_VIEWS.RUNS) {
    callout = {
      tone: active.length > 0 ? "warn" : "info",
      title: status,
      body: "Choose Active runs, History, Reviews, or New run."
    };
    list = hubPack(listIndex);
  } else if (view === ORCHESTRATOR_VIEWS.ACTIVE_RUNS) {
    title = "Active runs";
    list = runPack(
      active, listIndex, limit,
      "No runs executing. Governance first — launch only after setup/repairs."
    );
    callout = {
      tone: list.isEmpty ? "info" : "warn",
      title: list.isEmpty ? "None active" : `${list.total} active`,
      body: list.isEmpty
        ? "Esc back to Orchestration"
        : "Enter opens detail"
    };
  } else if (view === ORCHESTRATOR_VIEWS.RECENT_RUNS) {
    title = "Run history";
    list = runPack(recent, listIndex, limit, "No completed runs yet.");
    callout = {
      tone: "info",
      title: list.isEmpty ? "None completed" : `${list.total} completed`,
      body: list.isEmpty
        ? "Esc back to Orchestration"
        : "Enter opens detail"
    };
  } else if (view === ORCHESTRATOR_VIEWS.REVIEWS) {
    title = "Reviews";
    list = reviewPack(reviewList, listIndex, limit);
    callout = {
      tone: "info",
      title: list.isEmpty ? "None yet" : `${list.total} receipts`,
      body: list.isEmpty
        ? "Launch via kairo review --agent codex|pi."
        : "Read-only · Enter opens detail"
    };
  }

  return {
    title,
    view,
    callout,
    items: list.items,
    selectedIndex: list.selectedIndex,
    focusedId: list.focusedId,
    total: list.total,
    start: list.start,
    isEmpty: list.isEmpty,
    listLimit: limit
  };
}

export function SemanticOrchestrationPanel({
  view = ORCHESTRATOR_VIEWS.RUNS,
  dashboard = null,
  reviews = [],
  listIndex = 0,
  layoutMode = LAYOUT_MODES.COMPACT,
  contentFocused = false,
  colorEnabled = true,
  unicode = true
}) {
  const model = adaptOrchestrationModel({
    view, dashboard, reviews, listIndex, layoutMode
  });
  const listFocused = contentFocused && !model.isEmpty;
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
