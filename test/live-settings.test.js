import test from "node:test";
import assert from "node:assert/strict";
import { LAYOUT_MODES } from "../src/global/ink/layout.js";
import { ActionList, Confirm, KeyBar } from "../src/global/ink/ux/semantic.js";
import {
  SETTINGS_PHASE, buildSettingsFooterParts, createSettingsActionState,
  listCuratedIntegrations, reduceSettingsAction
} from "../src/global/ink/cockpit-settings.js";
import {
  adaptSettingsModel, settingsKeyHints, settingsListLimit, SemanticSettingsPanel
} from "../src/global/ink/ux/live-settings.js";

function manyIntegrations(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `integration-${i}`, name: `Integration ${i}`, version: `0.${i}.0`,
    license: "MIT", status: "available", capabilities: ["cap-a"],
    permissions: ["full-local-access-on-install"], audit: "pending-security-review",
    summary: `Summary ${i}`, notes: "Explicit install only."
  }));
}

function kids(node) {
  return Array.isArray(node.props.children) ? node.props.children : [node.props.children];
}

function focusCount(listNode) {
  return kids(listNode).filter((c) => /^> /.test(String(c?.props?.children))).length;
}

function panelChild(panel, typeName) {
  return kids(panel).find((c) => c?.type?.name === typeName) ?? null;
}

function phaseState(steps) {
  return steps.reduce(
    (state, action) => reduceSettingsAction(state, action),
    createSettingsActionState()
  );
}

const preview = () => phaseState([{ type: "preview", id: "pi-usage-widget" }]);
const confirming = () => phaseState([
  { type: "preview", id: "pi-usage-widget" }, { type: "confirm-prompt" }
]);
const completed = () => phaseState([
  { type: "preview", id: "pi-usage-widget" },
  { type: "confirm-prompt" }, { type: "confirm" }
]);

test("adapter covers browse → preview → confirm → receipt; wroteFiles false", () => {
  const browse = adaptSettingsModel({ listIndex: 0 });
  assert.equal(browse.phase, SETTINGS_PHASE.BROWSE);
  assert.equal(browse.title, "Settings");
  assert.equal(browse.listFocused, true);
  assert.equal(browse.focusedId, "pi-usage-widget");
  assert.equal(browse.confirm, null);
  assert.equal(browse.receipt, null);
  assert.match(browse.callout.body, /does not install packages/i);
  assert.equal(browse.detailsOpen, false);

  const previewModel = adaptSettingsModel({ settingsAction: preview() });
  assert.equal(previewModel.phase, SETTINGS_PHASE.PREVIEW);
  assert.equal(previewModel.selectedIndex, -1);
  assert.equal(previewModel.listFocused, false);
  assert.equal(previewModel.detailsOpen, true);
  for (const re of [/License · MIT/, /Audit ·/, /Capabilities ·/, /Permissions ·/]) {
    assert.ok(previewModel.details.some((l) => re.test(l)));
  }
  assert.match(previewModel.callout.body, /No filesystem changes/i);

  const confirmModel = adaptSettingsModel({ settingsAction: confirming() });
  assert.equal(confirmModel.confirm.primaryLabel, "Confirm intent");
  assert.match(confirmModel.confirm.summary, /Does not install packages/i);
  assert.doesNotMatch(
    [confirmModel.callout.title, confirmModel.callout.body, confirmModel.confirm.summary].join("\n"),
    /Y Confirm|N\/Esc/i
  );

  const done = adaptSettingsModel({ settingsAction: completed() });
  assert.equal(done.phase, SETTINGS_PHASE.COMPLETED);
  assert.match(done.receipt.lines.join("\n"), /wroteFiles · false/);
  assert.match(done.receipt.lines.join("\n"), /does not install packages/i);
  assert.equal(done.detailsOpen, false);
  assert.equal(completed().receipt.wroteFiles, false);
});

test("window preserves catalog identity beyond visual cap; selection aligned", () => {
  assert.equal(settingsListLimit(LAYOUT_MODES.COMPACT), 3);
  assert.equal(settingsListLimit(LAYOUT_MODES.WIDE), 8);
  const catalog = manyIntegrations(10);
  const compact = adaptSettingsModel({
    integrations: catalog, listIndex: 7, layoutMode: LAYOUT_MODES.COMPACT
  });
  assert.equal(compact.items.length, 3);
  assert.equal(compact.total, 10);
  assert.equal(compact.focusedId, catalog[7].id);
  assert.equal(compact.items[compact.selectedIndex].id, catalog[7].id);
  assert.match(compact.items[compact.selectedIndex].label, /Integration 7/);

  const wide = adaptSettingsModel({
    integrations: catalog, listIndex: 9, layoutMode: LAYOUT_MODES.WIDE
  });
  assert.equal(wide.items.length, 8);
  assert.equal(wide.focusedId, catalog[9].id);
  assert.equal(wide.items[wide.selectedIndex].id, catalog[9].id);
});

test("ActionList sole browse focus; Confirm never focused; Receipt first on completed", () => {
  const filled = adaptSettingsModel({ integrations: manyIntegrations(4), listIndex: 2 });
  assert.equal(focusCount(ActionList({
    items: filled.items, selectedIndex: filled.selectedIndex, focused: true, unicode: false
  })), 1);

  const empty = adaptSettingsModel({ integrations: [] });
  assert.equal(empty.selectedIndex, -1);
  assert.equal(focusCount(ActionList({
    items: empty.items, selectedIndex: empty.selectedIndex, focused: true, unicode: false
  })), 0);

  const browsePanel = SemanticSettingsPanel({
    integrations: listCuratedIntegrations(), listIndex: 0,
    contentFocused: true, unicode: false, colorEnabled: false
  });
  const listEl = panelChild(browsePanel, "ActionList");
  assert.equal(listEl.props.focused, true);
  assert.equal(focusCount(ActionList(listEl.props)), 1);

  const confirmPanel = SemanticSettingsPanel({
    settingsAction: confirming(), contentFocused: true, unicode: false, colorEnabled: false
  });
  assert.equal(panelChild(confirmPanel, "ActionList"), null);
  const confirmEl = panelChild(confirmPanel, "Confirm");
  assert.equal(confirmEl.props.focused, false);
  assert.equal(confirmEl.props.mark, " ");
  assert.equal(Confirm(confirmEl.props).props.children[1].props.children.startsWith("  "), true);

  const doneKids = kids(SemanticSettingsPanel({
    settingsAction: completed(), contentFocused: true, unicode: false, colorEnabled: false
  })).filter(Boolean);
  assert.equal(doneKids[0]?.type?.name, "Receipt");
  assert.match(doneKids[0].props.lines.join("\n"), /wroteFiles · false/);
  assert.equal(doneKids[0].props.title, "Receipt");
});

test("key ownership: KeyBar/footer keeps Y/N/Esc; reduceSettingsAction intact", () => {
  const model = adaptSettingsModel({ settingsAction: confirming() });
  assert.deepEqual(settingsKeyHints(SETTINGS_PHASE.CONFIRMING), [
    { keys: "Y", label: "Confirm" }, { keys: "N", label: "Cancel" },
    { keys: "Esc", label: "Cancel" }
  ]);
  assert.deepEqual(buildSettingsFooterParts(SETTINGS_PHASE.CONFIRMING), [
    "Y Confirm", "N/Esc Cancel"
  ]);
  const bar = KeyBar({ hints: model.keyHints, colorEnabled: false, columns: 80 });
  assert.match(String(bar.props.children.props.children), /Y Confirm · N Cancel · Esc Cancel/);

  const cancel = reduceSettingsAction(confirming(), { type: "cancel" });
  assert.equal(cancel.phase, SETTINGS_PHASE.BROWSE);
  assert.equal(cancel.receipt, null);
  assert.match(cancel.message ?? "", /no files written/i);
  assert.equal(completed().receipt.wroteFiles, false);
});

test("browse keeps Profile & Policy from snapshot/diagnostics; non-browse hides it", () => {
  const snap = { policy: { profile: "local", applyMode: "confirm", preflight: "strict" } };
  const diag = { profile: { sources: { global: true, project: true } } };
  const labels = adaptSettingsModel({ snapshot: snap, diagnostics: diag }).profilePolicy.map((i) => i.label).join("\n");
  assert.match(labels, /Policy · local · apply confirm/);
  assert.match(labels, /Preflight · strict · sources · global, project/);
  assert.equal(adaptSettingsModel({ settingsAction: preview(), snapshot: snap }).profilePolicy.length, 0);
});

test("NO_COLOR and ASCII: panel renders without requiring color or unicode focus glyph", () => {
  const panel = SemanticSettingsPanel({
    integrations: listCuratedIntegrations(), listIndex: 0,
    contentFocused: true, colorEnabled: false, unicode: false
  });
  const listEl = panelChild(panel, "ActionList");
  const row = kids(ActionList(listEl.props))[listEl.props.selectedIndex];
  assert.match(String(row.props.children), /^> /);
  assert.equal(row.props.color, undefined);

  const details = panelChild(SemanticSettingsPanel({
    settingsAction: preview(), colorEnabled: false, unicode: false
  }), "Details");
  assert.equal(details.props.focused, false);
  assert.ok(details.props.lines.some((l) => /License · MIT/.test(l)));
});
