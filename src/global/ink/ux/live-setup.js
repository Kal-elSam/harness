/**
 * Live semantic Setup. Splash stays separate.
 * Ownership: Callout=status · list/Confirm=decision · KeyBar=keys.
 * Focus mark only on ActionList (Enter/Space executable); Confirm is Y/N/Esc via KeyBar.
 */
import React from "react";
import { Box, Text } from "ink";
import { AGENT_HINTS, WIZARD_COPY, getAgentLabel } from "../../brand/index.js";
import { LAYOUT_MODES } from "../layout.js";
import { COCKPIT_COLORS } from "../theme.js";
import {
  SETUP_STEPS, formatInkPreviewLines, setupPreviewLineLimit, windowSetupLines
} from "../setup-state.js";
import { ActionList, Callout, Confirm, KeyBar, Stepper } from "./semantic.js";

export const SETUP_STEPPER_STEPS = [
  { id: SETUP_STEPS.DETECT, label: "Detect" },
  { id: SETUP_STEPS.AGENTS, label: "Agents" },
  { id: SETUP_STEPS.COMPONENTS, label: "Components" },
  { id: SETUP_STEPS.PREVIEW, label: "Preview" },
  { id: SETUP_STEPS.CONFIRM, label: "Confirm" }
];

export function setupStepperIndex(step) {
  return SETUP_STEPPER_STEPS.findIndex((entry) => entry.id === step);
}

export function setupKeyHints(step, { previewReady = false, dryRun = false } = {}) {
  if (step === SETUP_STEPS.AGENTS || step === SETUP_STEPS.COMPONENTS) {
    return [
      { keys: "↑↓", label: "Move" }, { keys: "Space", label: "Toggle" },
      { keys: "Enter", label: "Continue" }, { keys: "Esc", label: "Cancel" }
    ];
  }
  if (step === SETUP_STEPS.CONFIRM) {
    return [
      { keys: "Y", label: dryRun ? "Continue" : "Apply" },
      { keys: "N", label: "Cancel" },
      { keys: "Esc", label: "Cancel" }
    ];
  }
  if (step === SETUP_STEPS.PREVIEW && !previewReady) return [{ keys: "Esc", label: "Cancel" }];
  if (step === SETUP_STEPS.DETECT || step === SETUP_STEPS.PREVIEW) {
    return [{ keys: "Enter", label: "Continue" }, { keys: "Esc", label: "Cancel" }];
  }
  return [{ keys: "Esc", label: "Cancel" }];
}

function buildCallout(step, { adapters = [], detected = [], previewLoading = false, previewError = null } = {}) {
  if (step === SETUP_STEPS.DETECT) {
    return {
      tone: "info", title: WIZARD_COPY.detectTitle,
      body: `Your agents · ${detected.length}/${adapters.length} roots found`
    };
  }
  if (step === SETUP_STEPS.AGENTS) {
    return { tone: "info", title: "Agents", body: WIZARD_COPY.agentsPrompt };
  }
  if (step === SETUP_STEPS.COMPONENTS) {
    return { tone: "info", title: "Components", body: WIZARD_COPY.componentsPrompt };
  }
  if (step === SETUP_STEPS.PREVIEW) {
    if (previewLoading) return { tone: "warn", title: WIZARD_COPY.previewTitle, body: "Building preview…" };
    if (previewError) return { tone: "danger", title: WIZARD_COPY.previewTitle, body: String(previewError) };
    return { tone: "info", title: WIZARD_COPY.previewTitle, body: "" };
  }
  if (step === SETUP_STEPS.CONFIRM) return { tone: "warn", title: "Confirm", body: "" };
  return { tone: "info", title: "Setup", body: "" };
}

function buildListItems(step, {
  agentOptions, componentOptions, selectedAgents, selectedComponents, adapters, detected
}) {
  if (step === SETUP_STEPS.AGENTS || step === SETUP_STEPS.COMPONENTS) {
    const options = step === SETUP_STEPS.AGENTS ? agentOptions : componentOptions;
    const selected = step === SETUP_STEPS.AGENTS ? selectedAgents : selectedComponents;
    return options.map((option) => ({
      id: option.id,
      label: `${selected.includes(option.id) ? "[x]" : "[ ]"} ${option.label}`,
      hint: option.hint
    }));
  }
  if (step !== SETUP_STEPS.DETECT) return [];
  return adapters.map((adapter) => ({
    id: adapter.id,
    label: `${getAgentLabel(adapter.id)} · ${
      detected.includes(adapter.id) ? AGENT_HINTS.ready : AGENT_HINTS.notDetected
    }`
  }));
}

/** Pure adapter for Detect→Agents→Components→Preview→Confirm (no splash). */
export function adaptSetupModel({
  step = SETUP_STEPS.DETECT, activeIndex = 0, agentOptions = [], componentOptions = [],
  componentCatalog = [], selectedAgents = [], selectedComponents = [], adapters = [],
  detected = [], preview = null, previewLoading = false, previewError = null,
  dryRun = false, layoutMode = LAYOUT_MODES.COMPACT
} = {}) {
  const listFocused = step === SETUP_STEPS.AGENTS || step === SETUP_STEPS.COMPONENTS;
  const previewReady = Boolean(preview) && !previewLoading && !previewError;
  const catalog = componentCatalog.length > 0 ? componentCatalog : componentOptions;
  return {
    steps: SETUP_STEPPER_STEPS,
    stepIndex: Math.max(0, setupStepperIndex(step)),
    callout: buildCallout(step, { adapters, detected, previewLoading, previewError }),
    listItems: buildListItems(step, {
      agentOptions, componentOptions, selectedAgents, selectedComponents, adapters, detected
    }),
    listSelectedIndex: listFocused ? activeIndex : -1,
    listFocused,
    previewLines: previewReady
      ? windowSetupLines(
        formatInkPreviewLines({ preview, componentCatalog: catalog }),
        setupPreviewLineLimit(layoutMode)
      )
      : [],
    confirm: step === SETUP_STEPS.CONFIRM
      ? {
        summary: dryRun ? WIZARD_COPY.confirmDryRun : WIZARD_COPY.confirmApply,
        primaryLabel: dryRun ? "Continue dry run" : "Apply plan"
      }
      : null,
    keyHints: setupKeyHints(step, { previewReady, dryRun }),
    // Confirm is Y/N/Esc only — no focus mark (Enter is not executable here).
    focusSurface: listFocused ? "list" : "none"
  };
}

export function SemanticSetupPanel(props) {
  const {
    colorEnabled = true, unicode = true, columns = 80, layoutMode = LAYOUT_MODES.COMPACT, ...rest
  } = props;
  const view = adaptSetupModel({ ...rest, layoutMode });
  const muted = colorEnabled ? COCKPIT_COLORS.muted : undefined;
  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Stepper, {
      steps: view.steps, currentIndex: view.stepIndex, colorEnabled, unicode
    }),
    React.createElement(Callout, {
      tone: view.callout.tone, title: view.callout.title,
      body: view.callout.body || undefined, colorEnabled, compact: true
    }),
    view.listItems.length > 0
      ? React.createElement(ActionList, {
        items: view.listItems, selectedIndex: view.listSelectedIndex,
        focused: view.listFocused, colorEnabled, unicode
      })
      : null,
    ...view.previewLines.map((line, index) =>
      React.createElement(Text, { key: `p${index}`, color: muted }, line || " ")
    ),
    view.confirm
      ? React.createElement(Confirm, {
        summary: view.confirm.summary, primaryLabel: view.confirm.primaryLabel,
        focused: false, colorEnabled, mark: " "
      })
      : null,
    React.createElement(KeyBar, { hints: view.keyHints, colorEnabled, columns })
  );
}
