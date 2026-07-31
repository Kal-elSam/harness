import test from "node:test";
import assert from "node:assert/strict";
import { LAYOUT_MODES } from "../src/global/ink/layout.js";
import { SETUP_STEPS } from "../src/global/ink/setup-state.js";
import { ActionList, Confirm } from "../src/global/ink/ux/semantic.js";
import {
  SETUP_STEPPER_STEPS, adaptSetupModel, setupKeyHints, setupStepperIndex, SemanticSetupPanel
} from "../src/global/ink/ux/live-setup.js";

const adapters = [{ id: "cursor" }, { id: "codex" }, { id: "claude" }];
const agentOptions = [
  { id: "cursor", label: "Cursor", hint: "ready" },
  { id: "codex", label: "Codex", hint: "managed later" }
];
const componentOptions = [
  { id: "orchestrator", label: "Orchestrator", hint: "recommended" },
  { id: "__none__", label: "Core only (no components)" }
];
const catalog = [{ id: "orchestrator", label: "Orchestrator" }];

function base(overrides = {}) {
  return adaptSetupModel({
    step: SETUP_STEPS.DETECT, adapters, detected: ["cursor"], agentOptions, componentOptions,
    componentCatalog: catalog, selectedAgents: ["cursor"], selectedComponents: ["orchestrator"],
    ...overrides
  });
}

function focusCount(listNode) {
  const kids = Array.isArray(listNode.props.children)
    ? listNode.props.children
    : [listNode.props.children];
  return kids.filter((c) => /^> /.test(String(c?.props?.children))).length;
}

function childByName(panel, name) {
  return (panel.props.children ?? []).find((c) => c?.type?.name === name) ?? null;
}

test("adapter covers five phases; single focus surface; checkboxes intact", () => {
  assert.deepEqual(SETUP_STEPPER_STEPS.map((s) => s.id), [
    SETUP_STEPS.DETECT, SETUP_STEPS.AGENTS, SETUP_STEPS.COMPONENTS,
    SETUP_STEPS.PREVIEW, SETUP_STEPS.CONFIRM
  ]);
  assert.equal(setupStepperIndex(SETUP_STEPS.SPLASH), -1);
  assert.equal(setupStepperIndex(SETUP_STEPS.CONFIRM), 4);

  const detect = base();
  assert.equal(detect.focusSurface, "none");
  assert.match(detect.callout.body, /1\/3 roots found/);
  assert.ok(detect.listItems.some((i) => /Cursor · ready/.test(i.label)));

  const agents = base({ step: SETUP_STEPS.AGENTS, activeIndex: 1 });
  assert.equal(agents.focusSurface, "list");
  assert.equal(agents.listSelectedIndex, 1);
  assert.match(agents.listItems[0].label, /^\[x\] Cursor/);
  assert.match(agents.listItems[1].label, /^\[ \] Codex/);
  assert.equal(focusCount(ActionList({
    items: agents.listItems, selectedIndex: 1, focused: true, unicode: false
  })), 1);

  const loading = base({ step: SETUP_STEPS.PREVIEW, previewLoading: true });
  assert.equal(loading.callout.tone, "warn");
  assert.match(loading.callout.body, /Building preview/);
  assert.equal(base({ step: SETUP_STEPS.PREVIEW, previewError: "boom" }).callout.tone, "danger");

  const confirming = base({ step: SETUP_STEPS.CONFIRM });
  assert.equal(confirming.focusSurface, "none");
  assert.equal(confirming.confirm.primaryLabel, "Apply plan");
  const decision = [confirming.callout.title, confirming.callout.body,
    confirming.confirm.summary, confirming.confirm.primaryLabel].join("\n");
  assert.doesNotMatch(decision, /\bY\b|\bN\b|Esc/);
  assert.deepEqual(
    setupKeyHints(SETUP_STEPS.CONFIRM).map((h) => `${h.keys} ${h.label}`),
    ["Y Apply", "N Cancel", "Esc Cancel"]
  );
  assert.deepEqual(
    setupKeyHints(SETUP_STEPS.CONFIRM, { dryRun: true }).map((h) => `${h.keys} ${h.label}`),
    ["Y Continue", "N Cancel", "Esc Cancel"]
  );
  const dry = base({ step: SETUP_STEPS.CONFIRM, dryRun: true });
  assert.equal(dry.confirm.primaryLabel, "Continue dry run");
  assert.equal(dry.keyHints[0].label, "Continue");
  assert.doesNotMatch(dry.keyHints.map((h) => h.label).join(" "), /Apply/i);
});

test("preview caps + KeyBar ownership; list owns sole focus mark", () => {
  const preview = {
    agents: ["cursor"], components: ["orchestrator"],
    preflight: {
      changes: Array.from({ length: 20 }, (_, i) => ({ action: "create", target: `f-${i}` })),
      preserved: []
    }
  };
  const compact = base({ step: SETUP_STEPS.PREVIEW, preview, layoutMode: LAYOUT_MODES.COMPACT });
  assert.equal(compact.previewLines.length, 9);
  assert.match(compact.previewLines.at(-1), /^… \d+ more$/);
  const wide = base({ step: SETUP_STEPS.PREVIEW, preview, layoutMode: LAYOUT_MODES.WIDE });
  assert.equal(wide.previewLines.length, 13);
  assert.deepEqual(setupKeyHints(SETUP_STEPS.AGENTS).map((h) => `${h.keys} ${h.label}`), [
    "↑↓ Move", "Space Toggle", "Enter Continue", "Esc Cancel"
  ]);

  const agentsPanel = SemanticSetupPanel({
    step: SETUP_STEPS.AGENTS, activeIndex: 1, agentOptions, componentOptions,
    selectedAgents: ["cursor"], selectedComponents: ["orchestrator"],
    adapters, detected: ["cursor"], unicode: false, colorEnabled: false
  });
  const listEl = childByName(agentsPanel, "ActionList");
  assert.equal(listEl.props.focused, true);
  assert.equal(focusCount(ActionList(listEl.props)), 1);
  assert.equal(childByName(agentsPanel, "Confirm"), null);

  const confirmPanel = SemanticSetupPanel({
    step: SETUP_STEPS.CONFIRM, dryRun: false, unicode: false, colorEnabled: false,
    adapters, detected: ["cursor"]
  });
  assert.equal(childByName(confirmPanel, "ActionList"), null);
  const confirmEl = childByName(confirmPanel, "Confirm");
  assert.equal(confirmEl.props.focused, false);
  assert.equal(confirmEl.props.mark, " ");
  assert.match(String(Confirm(confirmEl.props).props.children[1].props.children), /^  Apply plan$/);

  function colors(node, into = []) {
    if (!node?.props) return into;
    if ("color" in node.props) into.push(node.props.color);
    if ("borderColor" in node.props) into.push(node.props.borderColor);
    const kids = node.props.children;
    if (Array.isArray(kids)) kids.forEach((k) => colors(k, into));
    else if (kids) colors(kids, into);
    return into;
  }
  for (const value of colors(confirmPanel)) assert.equal(value, undefined);
});
