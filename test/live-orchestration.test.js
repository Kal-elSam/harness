import test from "node:test";
import assert from "node:assert/strict";
import { LAYOUT_MODES } from "../src/global/ink/layout.js";
import { ORCHESTRATOR_VIEWS } from "../src/global/ink/orchestrator-state.js";
import { ActionList } from "../src/global/ink/ux/semantic.js";
import { selectRunFromList } from "../src/global/ink/orchestrator-state.js";
import { selectReviewFromList } from "../src/global/ink/cockpit-reviews.js";
import { resolveRunsHubItem } from "../src/global/ink/cockpit-runs.js";
import {
  adaptOrchestrationModel,
  orchestrationListLimit,
  SemanticOrchestrationPanel
} from "../src/global/ink/ux/live-orchestration.js";

function manyRuns(n, prefix = "run") {
  return Array.from({ length: n }, (_, i) => ({
    runId: `${prefix}-${i}`,
    state: i % 2 === 0 ? "running" : "completed",
    agentId: i % 2 === 0 ? "cursor" : "codex",
    taskDigest: `d${i}`,
    taskLength: 8
  }));
}

function manyReviews(n) {
  return Array.from({ length: n }, (_, i) => ({
    reviewId: `rev-${i}`,
    agentId: "codex",
    state: "completed",
    createdAt: `2026-07-31T12:${String(i).padStart(2, "0")}:00.000Z`,
    findings: [{ severity: "low" }]
  }));
}

function focusCount(listNode) {
  const kids = Array.isArray(listNode.props.children)
    ? listNode.props.children
    : [listNode.props.children];
  return kids.filter((c) => /^> /.test(String(c?.props?.children))).length;
}

test("adapter covers hub, active, history, reviews with honest empties", () => {
  const hub = adaptOrchestrationModel({ view: ORCHESTRATOR_VIEWS.RUNS, listIndex: 3 });
  assert.equal(hub.focusedId, "launch");
  assert.equal(hub.isEmpty, false);
  assert.equal(hub.items.length, 4);
  assert.match(hub.callout.title, /active · .* recent · .* reviews/);
  assert.notEqual(hub.title, hub.callout.title);

  const emptyActive = adaptOrchestrationModel({
    view: ORCHESTRATOR_VIEWS.ACTIVE_RUNS, dashboard: { activeRuns: [] }
  });
  assert.equal(emptyActive.isEmpty, true);
  assert.equal(emptyActive.selectedIndex, -1);
  assert.equal(emptyActive.focusedId, null);
  assert.equal(emptyActive.callout.title, "None active");
  assert.match(emptyActive.items[0].label, /No runs executing/);

  const emptyHistory = adaptOrchestrationModel({
    view: ORCHESTRATOR_VIEWS.RECENT_RUNS, dashboard: { recentRuns: [] }
  });
  assert.equal(emptyHistory.selectedIndex, -1);
  assert.equal(emptyHistory.callout.title, "None completed");
  assert.match(emptyHistory.items[0].label, /No completed runs/);

  const emptyReviews = adaptOrchestrationModel({
    view: ORCHESTRATOR_VIEWS.REVIEWS, reviews: []
  });
  assert.equal(emptyReviews.selectedIndex, -1);
  assert.equal(emptyReviews.callout.title, "None yet");
  assert.match(emptyReviews.items[0].label, /No review receipts/);
});

test("panel title is destination; Callout is status — never identical", () => {
  const cases = [
    adaptOrchestrationModel({ view: ORCHESTRATOR_VIEWS.RUNS }),
    adaptOrchestrationModel({
      view: ORCHESTRATOR_VIEWS.ACTIVE_RUNS, dashboard: { activeRuns: [] }
    }),
    adaptOrchestrationModel({
      view: ORCHESTRATOR_VIEWS.ACTIVE_RUNS, dashboard: { activeRuns: manyRuns(10) }
    }),
    adaptOrchestrationModel({
      view: ORCHESTRATOR_VIEWS.RECENT_RUNS, dashboard: { recentRuns: [] }
    }),
    adaptOrchestrationModel({
      view: ORCHESTRATOR_VIEWS.RECENT_RUNS, dashboard: { recentRuns: manyRuns(4, "hist") }
    }),
    adaptOrchestrationModel({ view: ORCHESTRATOR_VIEWS.REVIEWS, reviews: [] }),
    adaptOrchestrationModel({ view: ORCHESTRATOR_VIEWS.REVIEWS, reviews: manyReviews(3) })
  ];
  for (const model of cases) {
    assert.notEqual(
      model.title,
      model.callout.title,
      `duplicate heading for ${model.view}: ${model.title}`
    );
  }
  const filled = adaptOrchestrationModel({
    view: ORCHESTRATOR_VIEWS.ACTIVE_RUNS, dashboard: { activeRuns: manyRuns(10) }
  });
  assert.equal(filled.title, "Active runs");
  assert.equal(filled.callout.title, "10 active");
  assert.equal(
    adaptOrchestrationModel({
      view: ORCHESTRATOR_VIEWS.RECENT_RUNS, dashboard: { recentRuns: manyRuns(4, "hist") }
    }).callout.title,
    "4 completed"
  );
  assert.equal(
    adaptOrchestrationModel({ view: ORCHESTRATOR_VIEWS.REVIEWS, reviews: manyReviews(3) })
      .callout.title,
    "3 receipts"
  );
});

test("window preserves domain identity beyond visual cap; human labels only", () => {
  assert.equal(orchestrationListLimit(LAYOUT_MODES.COMPACT), 3);
  assert.equal(orchestrationListLimit(LAYOUT_MODES.WIDE), 8);
  const active = manyRuns(10);
  const compact = adaptOrchestrationModel({
    view: ORCHESTRATOR_VIEWS.ACTIVE_RUNS,
    dashboard: { activeRuns: active },
    listIndex: 7,
    layoutMode: LAYOUT_MODES.COMPACT
  });
  assert.equal(compact.items.length, 3);
  assert.equal(compact.total, 10);
  assert.equal(compact.focusedId, "run-7");
  assert.equal(compact.items[compact.selectedIndex].id, "run-7");
  assert.equal(selectRunFromList(active, 7)?.runId, compact.focusedId);
  assert.doesNotMatch(compact.items.map((i) => i.label).join("\n"), /run-\d+/);
  assert.match(compact.items[compact.selectedIndex].label, /Cursor|Codex/);

  const wide = adaptOrchestrationModel({
    view: ORCHESTRATOR_VIEWS.ACTIVE_RUNS,
    dashboard: { activeRuns: active },
    listIndex: 9,
    layoutMode: LAYOUT_MODES.WIDE
  });
  assert.equal(wide.items.length, 8);
  assert.equal(wide.focusedId, "run-9");

  const reviews = manyReviews(12);
  const rev = adaptOrchestrationModel({
    view: ORCHESTRATOR_VIEWS.REVIEWS, reviews, listIndex: 10,
    layoutMode: LAYOUT_MODES.COMPACT
  });
  assert.equal(rev.focusedId, "rev-10");
  assert.equal(selectReviewFromList(reviews, 10)?.reviewId, rev.focusedId);
  assert.doesNotMatch(rev.items.map((i) => i.label).join("\n"), /rev-\d+/);
});

test("ActionList is sole focus owner; empty never shows focus mark", () => {
  const hubItem = resolveRunsHubItem(0);
  assert.equal(hubItem.id, "active");

  const filled = adaptOrchestrationModel({
    view: ORCHESTRATOR_VIEWS.RECENT_RUNS,
    dashboard: { recentRuns: manyRuns(5, "hist") },
    listIndex: 2
  });
  const list = ActionList({
    items: filled.items, selectedIndex: filled.selectedIndex, focused: true, unicode: false
  });
  assert.equal(focusCount(list), 1);
  assert.equal(filled.items[filled.selectedIndex].id, filled.focusedId);

  const empty = adaptOrchestrationModel({
    view: ORCHESTRATOR_VIEWS.ACTIVE_RUNS, dashboard: { activeRuns: [] }
  });
  assert.equal(focusCount(ActionList({
    items: empty.items, selectedIndex: empty.selectedIndex, focused: true, unicode: false
  })), 0);

  const panel = SemanticOrchestrationPanel({
    view: ORCHESTRATOR_VIEWS.ACTIVE_RUNS,
    dashboard: { activeRuns: manyRuns(4) },
    listIndex: 1,
    contentFocused: true,
    unicode: false,
    colorEnabled: false
  });
  const listEl = (panel.props.children ?? []).find((c) => c?.type?.name === "ActionList");
  assert.equal(listEl.props.focused, true);
  assert.equal(focusCount(ActionList(listEl.props)), 1);

  const emptyPanel = SemanticOrchestrationPanel({
    view: ORCHESTRATOR_VIEWS.REVIEWS, reviews: [], contentFocused: true, unicode: false
  });
  const emptyList = (emptyPanel.props.children ?? []).find((c) => c?.type?.name === "ActionList");
  assert.equal(emptyList.props.focused, false);
  assert.equal(focusCount(ActionList(emptyList.props)), 0);
});
