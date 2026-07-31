/**
 * Live semantic Settings. Browse → preview → confirm → receipt (no filesystem install).
 * Ownership: ActionList=browse focus · Callout=status · Confirm=intent · footer/KeyBar=keys · Receipt=result.
 */
import React from "react";
import { Box, Text } from "ink";
import { LAYOUT_MODES } from "../layout.js";
import {
  SETTINGS_PHASE, getCuratedIntegration, listCuratedIntegrations
} from "../cockpit-settings.js";
import { ActionList, Callout, Confirm, Details, Receipt, SectionLabel, ViewTitle } from "./semantic.js";
import { windowSlice } from "./live-activity.js";

export function settingsListLimit(layoutMode = LAYOUT_MODES.COMPACT) {
  return layoutMode === LAYOUT_MODES.WIDE ? 8 : 3;
}

/** Key ownership lives in shell KeyBar/footer — Confirm never owns Y/N/Esc. */
export function settingsKeyHints(phase = SETTINGS_PHASE.BROWSE) {
  if (phase === SETTINGS_PHASE.PREVIEW) {
    return [{ keys: "Enter", label: "Confirm" }, { keys: "Esc", label: "Back" }];
  }
  if (phase === SETTINGS_PHASE.CONFIRMING) {
    return [
      { keys: "Y", label: "Confirm" }, { keys: "N", label: "Cancel" },
      { keys: "Esc", label: "Cancel" }
    ];
  }
  if (phase === SETTINGS_PHASE.COMPLETED) {
    return [{ keys: "Esc", label: "Back" }, { keys: "/", label: "Actions" }];
  }
  return [
    { keys: "↑↓", label: "Select" }, { keys: "Enter", label: "Preview" },
    { keys: "Esc", label: "Nav" }, { keys: "/", label: "Actions" }
  ];
}

function entryLabel(entry) {
  return `${entry.status} · ${entry.name} · ${entry.version} · ${entry.license}`;
}

function resolveEntry(integrations, selectedId) {
  if (!selectedId) return null;
  return integrations.find((e) => e.id === selectedId) ?? getCuratedIntegration(selectedId);
}

function phaseTone(phase) {
  if (phase === SETTINGS_PHASE.COMPLETED) return "ready";
  if (phase === SETTINGS_PHASE.CONFIRMING || phase === SETTINGS_PHASE.PREVIEW) return "warn";
  return "info";
}

function phaseTitle(phase, total) {
  if (phase === SETTINGS_PHASE.PREVIEW) return "Preview integration";
  if (phase === SETTINGS_PHASE.CONFIRMING) return "Confirm intent";
  if (phase === SETTINGS_PHASE.COMPLETED) return "Intent recorded";
  return total === 0 ? "No curated integrations" : `${total} curated integration${total === 1 ? "" : "s"}`;
}

function buildDetailsLines(entry) {
  if (!entry) return ["Integration not found."];
  return [
    `License · ${entry.license}`, `Audit · ${entry.audit}`,
    `Capabilities · ${entry.capabilities?.join(" · ") || "none"}`,
    `Permissions · ${entry.permissions?.join(" · ") || "none"}`,
    entry.summary, entry.notes
  ].filter(Boolean);
}

function receiptLines(receipt, entry) {
  if (!receipt) return [];
  return [
    `Id · ${receipt.id} · wroteFiles · ${receipt.wroteFiles}`,
    `Confirmed · ${receipt.confirmedAt}`,
    entry ? `${entry.name} · ${entry.version} · ${entry.license}` : null,
    "Confirm records intent — does not install packages."
  ].filter(Boolean);
}

/** Browse-only: profile · apply · preflight · sources. */
function profilePolicyItems(snapshot = null, diagnostics = null) {
  const p = snapshot?.policy, s = diagnostics?.profile?.sources;
  const src = [s?.global && "global", s?.project && "project"].filter(Boolean).join(", ") || "none";
  return [
    { id: "policy", label: `Policy · ${p?.profile ?? "none"} · apply ${p?.applyMode ?? "n/a"}` },
    { id: "preflight", label: `Preflight · ${p?.preflight ?? "n/a"} · sources · ${src}` }
  ];
}

/** Pure adapter: browse window · preview Details · confirm intent · receipt first. */
export function adaptSettingsModel({
  integrations = listCuratedIntegrations(), listIndex = 0, settingsAction = null,
  layoutMode = LAYOUT_MODES.COMPACT, snapshot = null, diagnostics = null
} = {}) {
  const phase = settingsAction?.phase ?? SETTINGS_PHASE.BROWSE;
  const catalog = Array.isArray(integrations) ? integrations : [];
  const limit = settingsListLimit(layoutMode);
  const windowed = windowSlice(catalog, listIndex, limit);
  const browsing = phase === SETTINGS_PHASE.BROWSE;
  const safe = catalog.length > 0
    ? Math.min(Math.max(0, listIndex), catalog.length - 1) : -1;
  const focused = browsing && safe >= 0 ? catalog[safe] : null;
  const entry = resolveEntry(catalog, settingsAction?.selectedId)
    ?? (browsing ? focused : null);
  const detailing = phase === SETTINGS_PHASE.PREVIEW || phase === SETTINGS_PHASE.CONFIRMING;
  const items = catalog.length === 0
    ? [{ id: "empty", label: "No curated integrations available." }]
    : windowed.items.map((item, i) => ({
      id: item.id ?? `integration-${windowed.start + i}`,
      label: entryLabel(item)
    }));

  return {
    title: "Settings",
    phase,
    callout: {
      tone: phaseTone(phase),
      title: phaseTitle(phase, catalog.length),
      body: browsing
        ? "Browse → preview → confirm. Confirm records intent — does not install packages."
        : (phase === SETTINGS_PHASE.PREVIEW ? "No filesystem changes. Enter opens confirm." : "")
    },
    items,
    selectedIndex: browsing && catalog.length > 0 ? windowed.selectedIndex : -1,
    focusedId: focused?.id ?? null,
    total: catalog.length,
    start: windowed.start,
    listLimit: limit,
    listFocused: browsing && catalog.length > 0,
    entry,
    details: detailing ? buildDetailsLines(entry) : [],
    detailsOpen: detailing,
    confirm: phase === SETTINGS_PHASE.CONFIRMING
      ? {
        summary: entry
          ? `Record install intent for ${entry.name}. Does not install packages.`
          : "Record install intent. Does not install packages.",
        primaryLabel: "Confirm intent"
      }
      : null,
    receipt: phase === SETTINGS_PHASE.COMPLETED && settingsAction?.receipt
      ? { title: "Receipt", lines: receiptLines(settingsAction.receipt, entry) }
      : null,
    profilePolicy: browsing ? profilePolicyItems(snapshot, diagnostics) : [],
    keyHints: settingsKeyHints(phase)
  };
}

export function SemanticSettingsPanel({
  integrations = listCuratedIntegrations(), listIndex = 0, settingsAction = null,
  layoutMode = LAYOUT_MODES.COMPACT, contentFocused = false, colorEnabled = true, unicode = true,
  snapshot = null, diagnostics = null
}) {
  const model = adaptSettingsModel({
    integrations, listIndex, settingsAction, layoutMode, snapshot, diagnostics
  });
  const listFocused = contentFocused && model.listFocused;
  return React.createElement(Box, { flexDirection: "column" },
    model.receipt && React.createElement(Receipt, {
      title: model.receipt.title, lines: model.receipt.lines, colorEnabled
    }),
    React.createElement(ViewTitle, { colorEnabled }, model.title),
    React.createElement(Callout, {
      tone: model.callout.tone, title: model.callout.title,
      body: model.callout.body || undefined, colorEnabled, compact: true
    }),
    model.confirm && React.createElement(Confirm, {
      summary: model.confirm.summary, primaryLabel: model.confirm.primaryLabel,
      focused: false, colorEnabled, mark: " "
    }),
    model.phase === SETTINGS_PHASE.BROWSE && React.createElement(ActionList, {
      items: model.items, selectedIndex: model.selectedIndex,
      focused: listFocused, colorEnabled, unicode
    }),
    model.profilePolicy.length > 0 && React.createElement(Box, { flexDirection: "column" },
      React.createElement(SectionLabel, { colorEnabled }, "Profile & Policy"),
      React.createElement(ActionList, {
        items: model.profilePolicy, selectedIndex: -1, focused: false, colorEnabled, unicode
      })
    ),
    model.detailsOpen && React.createElement(Details, {
      open: true, summary: "Details", lines: model.details,
      colorEnabled, focused: false, mark: " "
    })
  );
}
