import test from "node:test";
import assert from "node:assert/strict";
import {
  countFindingsBySeverity,
  formatReviewDetailLines,
  formatReviewListLines,
  selectReviewFromList
} from "../src/global/ink/cockpit-reviews.js";
import {
  createCockpitUiState,
  reduceCockpitUi,
  isContentInteractiveView,
  canTabBetweenRegions
} from "../src/global/ink/cockpit-controller.js";
import { COCKPIT_REGIONS, buildFooterModel } from "../src/global/ink/cockpit-models.js";
import { LAYOUT_MODES } from "../src/global/ink/layout.js";
import { ORCHESTRATOR_VIEWS } from "../src/global/ink/orchestrator-state.js";
import { resolveRunsHubItem, RUNS_HUB_ITEMS } from "../src/global/ink/cockpit-runs.js";
import {
  inspectExecutionAdapters,
  resolveExecutionAdapter
} from "../src/global/runtime/execution-adapters/index.js";

const sampleReceipt = {
  reviewId: "rev-aaaaaaaaaaaaaaaaaaaaaaaa",
  agentId: "codex",
  model: "gpt-5",
  state: "completed",
  createdAt: "2026-07-27T12:00:00.000Z",
  findings: [
    { severity: "high", path: "src/a.js", line: 10, title: "Leak" },
    { severity: "low", path: "src/b.js", title: "Nit" }
  ],
  warnings: ["note"],
  snapshot: {
    mode: "working-tree",
    fingerprint: "abcdef0123456789",
    totals: { fileCount: 2 }
  }
};

test("review list and detail formatters stay secret-free and readable", () => {
  assert.deepEqual(countFindingsBySeverity(sampleReceipt.findings), {
    high: 1, medium: 0, low: 1
  });
  const empty = formatReviewListLines([]);
  assert.match(empty[0], /No review receipts/);

  const lines = formatReviewListLines([sampleReceipt]);
  assert.match(lines[0], /codex · completed/);
  assert.match(lines[0], /2 findings \(h1\/m0\/l1\)/);
  assert.doesNotMatch(lines[0], /rev-aaaaaaaaaaaaaaaaaaaaaaaa/);
  assert.doesNotMatch(lines.join("\n"), /prompt|diff|transcript|api[_-]?key/i);

  const detail = formatReviewDetailLines(sampleReceipt);
  assert.match(detail.join("\n"), /SUMMARY/);
  assert.match(detail.join("\n"), /DETAILS/);
  assert.match(detail.join("\n"), /Id · rev-aaaaaaaaaaaaaaaaaaaaaaaa/);
  assert.match(detail.join("\n"), /Findings · 2/);
  assert.match(detail.join("\n"), /\[HIGH\] src\/a\.js:10 — Leak/);
  assert.equal(selectReviewFromList([sampleReceipt], 0), sampleReceipt);
  assert.equal(selectReviewFromList([], 0), null);
});

test("Runs hub exposes Reviews and Esc returns from review detail", () => {
  assert.ok(RUNS_HUB_ITEMS.some((item) => item.id === "reviews"));
  assert.equal(resolveRunsHubItem(2)?.view, ORCHESTRATOR_VIEWS.REVIEWS);
  assert.equal(isContentInteractiveView(ORCHESTRATOR_VIEWS.REVIEWS), true);
  assert.equal(isContentInteractiveView(ORCHESTRATOR_VIEWS.REVIEW_DETAIL), true);

  let state = createCockpitUiState({
    layoutMode: LAYOUT_MODES.COMPACT,
    view: ORCHESTRATOR_VIEWS.REVIEWS,
    region: COCKPIT_REGIONS.CONTENT,
    navIndex: 5
  });
  assert.equal(canTabBetweenRegions(state), true);

  state = reduceCockpitUi(state, {
    type: "set-view",
    view: ORCHESTRATOR_VIEWS.REVIEW_DETAIL,
    returnView: ORCHESTRATOR_VIEWS.REVIEWS
  });
  assert.equal(canTabBetweenRegions(state), false);
  state = reduceCockpitUi(state, { type: "escape" });
  assert.equal(state.view, ORCHESTRATOR_VIEWS.REVIEWS);
  state = reduceCockpitUi(state, { type: "escape" });
  assert.equal(state.view, ORCHESTRATOR_VIEWS.RUNS);

  const footer = buildFooterModel({
    view: ORCHESTRATOR_VIEWS.REVIEWS,
    region: COCKPIT_REGIONS.CONTENT,
    unicode: false
  });
  assert.match(footer.text, /Tab/);
  assert.match(footer.text, /Enter Open/);
});

test("public adapter contract exposes reviewCompatible only for Codex and Pi", () => {
  assert.equal(resolveExecutionAdapter("codex").capabilities.reviewCompatible, true);
  assert.equal(resolveExecutionAdapter("pi").capabilities.reviewCompatible, true);
  assert.equal(resolveExecutionAdapter("cursor").capabilities.reviewCompatible, false);
  assert.equal(resolveExecutionAdapter("claude").capabilities.reviewCompatible, false);
  assert.equal(resolveExecutionAdapter("opencode").capabilities.reviewCompatible, false);

  const inspected = inspectExecutionAdapters();
  const byId = Object.fromEntries(inspected.map((entry) => [entry.id, entry]));
  assert.equal(byId.codex.reviewCompatible, true);
  assert.equal(byId.pi.reviewCompatible, true);
  assert.equal(byId.cursor.reviewCompatible, false);
  assert.equal(byId.claude.reviewCompatible, false);
  assert.equal(byId.opencode.reviewCompatible, false);
});
