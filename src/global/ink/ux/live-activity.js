/** Live semantic Activity/Recovery. Callout=status · Confirm=action · footer=keys · snapshots=focus. */
import React from "react";
import { Box, Text } from "ink";
import { COCKPIT_COLORS } from "../theme.js";
import { formatConfirmPath } from "../cockpit-path-label.js";
import {
  RECOVERY_PHASE, listRecoverySnapshots, formatWhen, formatResult, shortName
} from "../cockpit-recovery.js";
import { LAYOUT_MODES } from "../layout.js";
import { ActionList, Callout, Confirm, Details } from "./semantic.js";
import { detailsPathLimit } from "./live-governance.js";

export function activityContentLimits(layoutMode = LAYOUT_MODES.COMPACT) {
  return layoutMode === LAYOUT_MODES.WIDE
    ? { events: 4, snapshots: 8 }
    : { events: 3, snapshots: 3 };
}

export function activitySnapshotLimit(layoutMode = LAYOUT_MODES.COMPACT) {
  return activityContentLimits(layoutMode).snapshots;
}

/** Visible window over full list; keeps `index` focused without truncating navigation. */
export function windowSlice(items = [], index = 0, limit = 3) {
  const total = items.length;
  if (total === 0) return { items: [], selectedIndex: -1, start: 0 };
  const size = Math.max(1, Math.min(limit, total));
  const safeIndex = Math.min(Math.max(0, index), total - 1);
  const start = Math.min(Math.max(0, safeIndex - Math.floor((size - 1) / 2)), total - size);
  return { items: items.slice(start, start + size), selectedIndex: safeIndex - start, start };
}

function collectRecentItems(snapshot, dashboard, eventLimit) {
  const items = [];
  for (const event of (snapshot?.history?.events ?? []).slice(0, 3)) {
    items.push({
      id: `e-${items.length}`,
      label: `${formatWhen(event.timestamp)} · ${event.command ?? event.type ?? "event"} · ${formatResult(event.action)}`
    });
  }
  for (const run of (dashboard?.recentRuns ?? []).slice(0, 2)) {
    items.push({
      id: `r-${items.length}`,
      label: `${formatWhen(run.updatedAt ?? run.endedAt ?? run.startedAt)} · ${run.agentId ?? "agent"} · ${formatResult(run.state)}`
    });
  }
  return items.slice(0, eventLimit);
}

function phaseTone(phase) {
  if (phase === RECOVERY_PHASE.FAILED) return "danger";
  if (phase === RECOVERY_PHASE.COMPLETED) return "ready";
  if (phase === RECOVERY_PHASE.CONFIRMING || phase === RECOVERY_PHASE.PREVIEWING || phase === RECOVERY_PHASE.APPLYING) {
    return "warn";
  }
  return "info";
}

function phaseTitle(phase, snapCount, eventCount) {
  if (phase === RECOVERY_PHASE.PREVIEWING) return "Previewing restore";
  if (phase === RECOVERY_PHASE.CONFIRMING) return "Confirm restore";
  if (phase === RECOVERY_PHASE.APPLYING) return "Restoring";
  if (phase === RECOVERY_PHASE.COMPLETED) return "Restore complete";
  if (phase === RECOVERY_PHASE.FAILED) return "Restore failed";
  return `${snapCount} snapshot(s) · ${eventCount} recent`;
}

function calloutBody(phase, recoveryAction) {
  const msg = recoveryAction?.message ?? "";
  if (/Y restore|N\/Esc/i.test(msg)) return "";
  if (phase === RECOVERY_PHASE.FAILED) {
    return msg || (recoveryAction?.error ? `Error · ${recoveryAction.error}` : "");
  }
  return phase === RECOVERY_PHASE.IDLE ? msg : "";
}

function buildDetailsLines(preview, receipt, showPaths, homeDir, pathLimit) {
  if (!showPaths) return [];
  const files = preview?.files ?? [];
  if (files.length > 0) {
    const lines = files.slice(0, pathLimit).map((f) => formatConfirmPath(f.displayPath ?? f.path, homeDir));
    if (files.length > pathLimit) lines.push(`… ${files.length - pathLimit} more`);
    return lines;
  }
  if (receipt?.safetyBackup) return ["Safety backup retained"];
  if (receipt) return [`Result · ${receipt.action ?? "rollback"} · ${receipt.restored?.length ?? 0} restored`];
  return ["No path evidence in this preview."];
}

export function adaptActivityModel({
  snapshot = null, recoveryAction = null, dashboard = null, listIndex = 0,
  homeDir = null, detailsOpen = false, layoutMode = LAYOUT_MODES.COMPACT
} = {}) {
  const phase = recoveryAction?.phase ?? RECOVERY_PHASE.IDLE;
  const limits = activityContentLimits(layoutMode);
  const allSnapshots = listRecoverySnapshots(snapshot);
  const windowed = windowSlice(allSnapshots, listIndex, limits.snapshots);
  const preview = recoveryAction?.preview ?? null;
  const receipt = recoveryAction?.receipt ?? null;
  const hasPreview = Boolean(preview);
  const confirming = phase === RECOVERY_PHASE.CONFIRMING;
  const working = phase === RECOVERY_PHASE.PREVIEWING || phase === RECOVERY_PHASE.APPLYING;
  const showPaths = (detailsOpen && hasPreview) || confirming;
  const recentItems = collectRecentItems(snapshot, dashboard, limits.events);
  const recent = recentItems.length > 0
    ? recentItems
    : [{ id: "empty-recent", label: "No recent agent activity." }];
  const snapshotItems = windowed.items.length === 0
    ? [{ id: "empty-snap", label: "No global snapshots yet." }]
    : windowed.items.map((entry, index) => ({
      id: entry.name ?? `s-${windowed.start + index}`,
      label: `${shortName(entry.name)} · ${entry.fileCount ?? "?"} files`
    }));
  const focused = allSnapshots[Math.min(Math.max(0, listIndex), Math.max(0, allSnapshots.length - 1))] ?? null;
  const fileCount = preview?.files?.length ?? 0;

  return {
    title: "Activity",
    phase,
    hasPreview,
    callout: {
      tone: phaseTone(phase),
      title: phaseTitle(phase, allSnapshots.length, recentItems.length),
      body: calloutBody(phase, recoveryAction)
    },
    primary: confirming || working ? null : {
      label: hasPreview
        ? `Restore preview · ${fileCount} file(s)`
        : (allSnapshots.length > 0 ? "Select a snapshot to preview" : "No snapshots to restore"),
      detail: receipt
        ? `Result · ${receipt.action ?? "rollback"} · ${receipt.restored?.length ?? 0} restored`
        : null
    },
    confirm: confirming ? {
      summary: fileCount > 0
        ? `Restore ${fileCount} file(s) from ${shortName(preview?.snapshot)}.`
        : "Restore confirmed snapshot preview.",
      primaryLabel: "Restore"
    } : null,
    recent,
    snapshots: snapshotItems,
    selectedIndex: windowed.items.length === 0 ? -1 : windowed.selectedIndex,
    focusedSnapshot: focused?.name ?? null,
    snapshotTotal: allSnapshots.length,
    details: buildDetailsLines(preview, receipt, showPaths, homeDir, detailsPathLimit(layoutMode)),
    detailsOpen: showPaths,
    showDetails: hasPreview || confirming || Boolean(receipt)
  };
}

export function SemanticActivityPanel({
  snapshot = null, recoveryAction = null, dashboard = null, listIndex = 0,
  homeDir = null, detailsOpen = false, layoutMode = LAYOUT_MODES.COMPACT,
  contentFocused = false, colorEnabled = true, unicode = true
}) {
  const view = adaptActivityModel({
    snapshot, recoveryAction, dashboard, listIndex, homeDir, detailsOpen, layoutMode
  });
  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Text, {
      bold: true, color: colorEnabled ? COCKPIT_COLORS.secondary : undefined
    }, view.title),
    React.createElement(Callout, {
      tone: view.callout.tone, title: view.callout.title,
      body: view.callout.body || undefined, colorEnabled, compact: true
    }),
    view.confirm
      ? React.createElement(Confirm, {
        summary: view.confirm.summary, primaryLabel: view.confirm.primaryLabel,
        focused: false, colorEnabled, mark: " "
      })
      : view.primary
        ? React.createElement(Text, { bold: true }, `  ${view.primary.label}`)
        : null,
    view.primary?.detail && !view.confirm
      ? React.createElement(Text, null, view.primary.detail) : null,
    React.createElement(Text, { bold: true }, "Recent"),
    React.createElement(ActionList, {
      items: view.recent, selectedIndex: -1, focused: false, colorEnabled, unicode
    }),
    React.createElement(Text, { bold: true }, "Snapshots"),
    React.createElement(ActionList, {
      items: view.snapshots, selectedIndex: view.selectedIndex,
      focused: contentFocused, colorEnabled, unicode
    }),
    view.showDetails
      ? React.createElement(Details, {
        open: view.detailsOpen, summary: "Details",
        lines: view.details.length > 0 ? view.details : ["No path evidence in this preview."],
        colorEnabled, focused: false, mark: " "
      })
      : null
  );
}
