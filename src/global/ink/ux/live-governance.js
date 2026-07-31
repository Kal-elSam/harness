/** Live semantic Governance. Ownership: Callout=status · Confirm/primary=action · footer=keys. */
import React from "react";
import { Box, Text } from "ink";
import { formatConfirmPath } from "../cockpit-path-label.js";
import { CHANGES_PHASE } from "../cockpit-changes.js";
import { LAYOUT_MODES } from "../layout.js";
import { ActionList, Callout, Confirm, Details, ViewTitle } from "./semantic.js";
import { mapHealthTone } from "./live-overview.js";

function healthLabel(kind) {
  return String(kind ?? "unknown").replaceAll("_", " ");
}

function plannedChanges(snapshot, changesAction) {
  const preview = changesAction?.preview;
  const diff = snapshot?.diff;
  if (preview?.hasChanges) return preview.changes ?? [];
  if (diff?.hasChanges && !preview) return diff.changes ?? [];
  return [];
}

function phaseTone(phase, healthKind) {
  if (phase === CHANGES_PHASE.FAILED) return "danger";
  if (phase === CHANGES_PHASE.COMPLETED) return "ready";
  if (phase === CHANGES_PHASE.CONFIRMING || phase === CHANGES_PHASE.PREVIEWING || phase === CHANGES_PHASE.APPLYING) {
    return "warn";
  }
  return mapHealthTone(healthKind);
}

function phaseTitle(phase, snapshot, changesAction) {
  if (phase === CHANGES_PHASE.PREVIEWING) return "Previewing";
  if (phase === CHANGES_PHASE.CONFIRMING) return "Confirm apply";
  if (phase === CHANGES_PHASE.APPLYING) return "Applying";
  if (phase === CHANGES_PHASE.COMPLETED) return "Apply complete";
  if (phase === CHANGES_PHASE.FAILED) {
    return changesAction?.error === "setup-required" ? "Setup required" : "Governance failed";
  }
  const pending = snapshot?.diff?.hasChanges
    ? (snapshot.diff.changeCount ?? snapshot.diff.changes?.length ?? 0)
    : 0;
  return `${healthLabel(snapshot?.health)}${pending > 0 ? ` · ${pending} pending` : " · drift clean"}`;
}

/** Compact/minimal: 3 paths; wide: 12. */
export function detailsPathLimit(layoutMode = LAYOUT_MODES.COMPACT) {
  return layoutMode === LAYOUT_MODES.WIDE ? 12 : 3;
}

function calloutBody(phase, changesAction) {
  if (phase !== CHANGES_PHASE.FAILED) return "";
  if (changesAction?.error === "setup-required") return "Not configured — open Overview and run setup.";
  if (changesAction?.error) return `Error · ${changesAction.error}`;
  return changesAction?.message ?? "";
}

function buildDetailsLines(planned, showPaths, changesAction, homeDir, pathLimit) {
  if (!showPaths) return [];
  if (planned.length > 0) {
    const lines = planned.slice(0, pathLimit).map((c) =>
      `${c.action ?? c.kind} · ${formatConfirmPath(c.target, homeDir)}`
    );
    if (planned.length > pathLimit) lines.push(`… ${planned.length - pathLimit} more`);
    return lines;
  }
  const receipt = changesAction?.receipt;
  if (receipt?.checksBefore && receipt?.checksAfter) {
    return [`Checks · before ok=${receipt.checksBefore.ok} → after ok=${receipt.checksAfter.ok}`];
  }
  return ["No path evidence on this scan."];
}

/** Pure adapter: paths only in detailsLines (confirming or Details open). */
export function adaptGovernanceModel({
  snapshot = null,
  changesAction = null,
  homeDir = null,
  detailsOpen = false,
  layoutMode = LAYOUT_MODES.COMPACT
} = {}) {
  const phase = changesAction?.phase ?? CHANGES_PHASE.IDLE;
  const coverage = snapshot?.coverage ?? {};
  const cta = snapshot?.cta;
  const planned = plannedChanges(snapshot, changesAction);
  const showPaths = detailsOpen || phase === CHANGES_PHASE.CONFIRMING;
  const confirming = phase === CHANGES_PHASE.CONFIRMING;
  const working = phase === CHANGES_PHASE.PREVIEWING || phase === CHANGES_PHASE.APPLYING;
  const actionable = phase === CHANGES_PHASE.IDLE
    || phase === CHANGES_PHASE.COMPLETED
    || phase === CHANGES_PHASE.FAILED;

  const metrics = [
    {
      id: "coverage",
      label: `Coverage · ${coverage.governedAgents ?? 0}/${coverage.detectedAgents ?? 0} agents · ${coverage.components ?? 0} components`
    },
    {
      id: "planned",
      label: planned.length > 0
        ? `Planned · ${planned.length} change(s)`
        : (snapshot?.diff?.summary ?? "No pending governance changes.")
    }
  ];
  if (changesAction?.receipt) {
    const r = changesAction.receipt;
    metrics.push({
      id: "receipt",
      label: `Result · ${r.action}${r.partial ? " (partial)" : ""}${r.backups?.length ? ` · ${r.backups.length} backup(s)` : ""}`
    });
  }

  return {
    title: "Governance",
    phase,
    callout: {
      tone: phaseTone(phase, snapshot?.health),
      title: phaseTitle(phase, snapshot, changesAction),
      body: calloutBody(phase, changesAction)
    },
    primary: confirming || working
      ? null
      : {
        label: cta?.title ?? "Review governance when ready",
        detail: actionable ? (cta?.detail ?? null) : null
      },
    confirm: confirming
      ? {
        summary: planned.length > 0
          ? `Apply ${planned.length} planned change(s).`
          : "Apply confirmed governance preview.",
        primaryLabel: "Apply"
      }
      : null,
    metrics,
    details: buildDetailsLines(planned, showPaths, changesAction, homeDir, detailsPathLimit(layoutMode)),
    detailsOpen: showPaths
  };
}

export function SemanticGovernancePanel({
  snapshot = null,
  changesAction = null,
  homeDir = null,
  detailsOpen = false,
  layoutMode = LAYOUT_MODES.COMPACT,
  colorEnabled = true,
  unicode = true
}) {
  const view = adaptGovernanceModel({
    snapshot, changesAction, homeDir, detailsOpen, layoutMode
  });
  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(ViewTitle, { colorEnabled }, view.title),
    React.createElement(Callout, {
      tone: view.callout.tone,
      title: view.callout.title,
      body: view.callout.body || undefined,
      colorEnabled,
      compact: true
    }),
    view.confirm
      ? React.createElement(Confirm, {
        summary: view.confirm.summary,
        primaryLabel: view.confirm.primaryLabel,
        focused: false,
        colorEnabled,
        mark: " "
      })
      : view.primary
        ? React.createElement(Box, { flexDirection: "column" },
          React.createElement(Text, { bold: true }, `  ${view.primary.label}`),
          view.primary.detail ? React.createElement(Text, null, view.primary.detail) : null
        )
        : null,
    React.createElement(ActionList, {
      items: view.metrics,
      selectedIndex: -1,
      focused: false,
      colorEnabled,
      unicode
    }),
    React.createElement(Details, {
      open: view.detailsOpen,
      summary: "Details",
      lines: view.details.length > 0 ? view.details : ["No path evidence on this scan."],
      colorEnabled,
      focused: false,
      mark: " "
    })
  );
}
