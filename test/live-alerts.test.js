import test from "node:test";
import assert from "node:assert/strict";
import { LAYOUT_MODES } from "../src/global/ink/layout.js";
import { ActionList } from "../src/global/ink/ux/semantic.js";
import {
  ALERT_STATES, createAlert
} from "../src/global/runtime/alerts/alert-types.js";
import { selectAlertFromList } from "../src/global/ink/cockpit-alerts.js";
import {
  adaptAlertsModel,
  alertsListLimit,
  SemanticAlertsPanel
} from "../src/global/ink/ux/live-alerts.js";

function manyOpen(n) {
  return Array.from({ length: n }, (_, i) => createAlert({
    alertId: `alt-${String(i).padStart(24, "0")}`,
    kind: "monitor.drift",
    severity: i % 3 === 0 ? "high" : i % 3 === 1 ? "medium" : "low",
    title: `Need attention ${i}`,
    source: "test",
    state: ALERT_STATES.OPEN,
    createdAt: `2026-07-31T12:${String(i).padStart(2, "0")}:00.000Z`
  }));
}

function focusCount(listNode) {
  const kids = Array.isArray(listNode.props.children)
    ? listNode.props.children
    : [listNode.props.children];
  return kids.filter((c) => /^> /.test(String(c?.props?.children))).length;
}

test("adapter: unavailable, empty, and populated headlines", () => {
  const unavailable = adaptAlertsModel({ alerts: null });
  assert.equal(unavailable.isUnavailable, true);
  assert.equal(unavailable.isEmpty, true);
  assert.equal(unavailable.selectedIndex, -1);
  assert.equal(unavailable.focusedId, null);
  assert.equal(unavailable.callout.title, "Alert data unavailable");
  assert.equal(unavailable.title, "Alerts");
  assert.notEqual(unavailable.title, unavailable.callout.title);

  const empty = adaptAlertsModel({ alerts: [] });
  assert.equal(empty.isUnavailable, false);
  assert.equal(empty.isEmpty, true);
  assert.equal(empty.selectedIndex, -1);
  assert.equal(empty.focusedId, null);
  assert.equal(empty.callout.title, "None pending");
  assert.match(empty.items[0].label, /No pending alerts/);

  const resolvedOnly = adaptAlertsModel({
    alerts: [createAlert({
      alertId: `alt-${"a".repeat(24)}`,
      kind: "x",
      title: "done",
      state: ALERT_STATES.RESOLVED
    })]
  });
  assert.equal(resolvedOnly.callout.title, "None pending");
  assert.equal(resolvedOnly.isEmpty, true);

  const filled = adaptAlertsModel({ alerts: manyOpen(2), listIndex: 1 });
  assert.equal(filled.isEmpty, false);
  assert.equal(filled.isUnavailable, false);
  assert.equal(filled.callout.title, "2 pending");
  assert.equal(filled.total, 2);
  assert.equal(filled.focusedId, manyOpen(2)[1].alertId);
});

test("window preserves domain identity beyond visual cap; no IDs in labels", () => {
  assert.equal(alertsListLimit(LAYOUT_MODES.COMPACT), 3);
  assert.equal(alertsListLimit(LAYOUT_MODES.WIDE), 8);

  const open = manyOpen(10);
  const compact = adaptAlertsModel({
    alerts: open, listIndex: 7, layoutMode: LAYOUT_MODES.COMPACT
  });
  assert.equal(compact.items.length, 3);
  assert.equal(compact.total, 10);
  assert.equal(compact.listLimit, 3);
  assert.equal(compact.focusedId, open[7].alertId);
  assert.equal(compact.items[compact.selectedIndex].id, open[7].alertId);
  assert.equal(selectAlertFromList(open, 7)?.alertId, compact.focusedId);
  assert.match(compact.items[compact.selectedIndex].label, /medium · Need attention 7/);
  assert.doesNotMatch(compact.items.map((i) => i.label).join("\n"), /alt-/);
  assert.doesNotMatch(compact.items.map((i) => i.label).join("\n"), /fingerprint|monitor\.drift/);

  const wide = adaptAlertsModel({
    alerts: open, listIndex: 9, layoutMode: LAYOUT_MODES.WIDE
  });
  assert.equal(wide.items.length, 8);
  assert.equal(wide.focusedId, open[9].alertId);
  assert.equal(selectAlertFromList(open, 9)?.alertId, wide.focusedId);
});

test("ActionList is sole focus owner; empty and unavailable never show focus mark", () => {
  const filled = adaptAlertsModel({ alerts: manyOpen(4), listIndex: 2 });
  const list = ActionList({
    items: filled.items, selectedIndex: filled.selectedIndex, focused: true, unicode: false
  });
  assert.equal(focusCount(list), 1);
  assert.equal(filled.items[filled.selectedIndex].id, filled.focusedId);

  for (const model of [
    adaptAlertsModel({ alerts: null }),
    adaptAlertsModel({ alerts: [] })
  ]) {
    assert.equal(focusCount(ActionList({
      items: model.items, selectedIndex: model.selectedIndex, focused: true, unicode: false
    })), 0);
  }

  const panel = SemanticAlertsPanel({
    alerts: manyOpen(3),
    listIndex: 1,
    contentFocused: true,
    unicode: false,
    colorEnabled: false
  });
  const listEl = (panel.props.children ?? []).find((c) => c?.type?.name === "ActionList");
  assert.equal(listEl.props.focused, true);
  assert.equal(focusCount(ActionList(listEl.props)), 1);

  const emptyPanel = SemanticAlertsPanel({
    alerts: [], contentFocused: true, unicode: false
  });
  const emptyList = (emptyPanel.props.children ?? []).find((c) => c?.type?.name === "ActionList");
  assert.equal(emptyList.props.focused, false);
  assert.equal(focusCount(ActionList(emptyList.props)), 0);

  const unavailablePanel = SemanticAlertsPanel({
    alerts: null, contentFocused: true, unicode: false
  });
  const unavailableList = (unavailablePanel.props.children ?? [])
    .find((c) => c?.type?.name === "ActionList");
  assert.equal(unavailableList.props.focused, false);
  assert.equal(focusCount(ActionList(unavailableList.props)), 0);
});
