import test from "node:test";
import assert from "node:assert/strict";
import { ProjectOverlay, PROJECT_OVERLAY_STATE as S, openProjectOverlay } from "../src/global/cockpit/project-overlay.js";

const ENTER = "\r";
const ESCAPE = "\x1b";

function makeFakeView(snapshot = {}) {
  return {
    snapshot,
    aiTeamLabel: (model) => model.displayName ?? model.modelId,
    aiTeamLabelWithProvider: (model) => `${model.adapterId} · ${model.displayName ?? model.modelId}`
  };
}

const QUALITY_MODEL = { candidateKey: "codex::gpt-6-astra", adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra", evidenceStatus: "scored", available: true, quota: 40, recommendationTags: ["quality"] };
const EFFICIENT_MODEL = { candidateKey: "claude::claude-opus-5", adapterId: "claude", modelId: "claude-opus-5", displayName: "Claude Opus 5", evidenceStatus: "scored", available: true, quota: 60, recommendationTags: ["efficient"] };
const UNSCORED_MODEL = { candidateKey: "codex::gpt-6-experimental", adapterId: "codex", modelId: "gpt-6-experimental", displayName: "GPT-6 Experimental", evidenceStatus: "unscored", available: true, quota: 40, recommendationTags: [] };

function makeAnalystCatalog(models = [QUALITY_MODEL, EFFICIENT_MODEL, UNSCORED_MODEL]) {
  return { recommendedModel: models.find((m) => m.recommendationTags.includes("quality")) ?? null, models };
}

function makePreflightService({ analystCatalog = makeAnalystCatalog(), preflightError = null } = {}) {
  const calls = { preflight: [], runBootstrap: [], approve: [], refresh: [] };
  return {
    calls,
    async preflightProject(args) {
      calls.preflight.push(args);
      if (preflightError) throw preflightError;
      return { profile: { fingerprint: "fp-1" }, candidates: { scoredAll: [] }, analystCatalog };
    },
    async runBootstrapAnalysis(args) {
      calls.runBootstrap.push(args);
      return {
        status: "suggested", bootstrapAnalystChoice: args.analyst.choice, bootstrapAnalyst: args.analyst.model,
        bootstrapAnalystSelectionSource: args.analyst.selectionSource, bootstrapAnalystRecommendationTags: args.analyst.recommendationTags,
        qualityTeam: [{ role: "Explorer", model: { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra" }, reason: null }],
        efficientTeam: [{ role: "Explorer", model: { adapterId: "claude", modelId: "claude-opus-5", displayName: "Claude Opus 5" }, reason: null }]
      };
    },
    async approveProjectStrategy(args) {
      calls.approve.push(args);
      return { status: "active", approvedAt: "2026-09-16T00:00:00.000Z", qualityTeam: [] };
    },
    async refreshProjectStrategy(args) {
      calls.refresh.push(args);
      return { status: "stale", qualityTeam: [] };
    }
  };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

function selectByKey(overlay, candidateKey) {
  overlay.selectList.onSelect({ value: candidateKey });
}

test("with no real strategy yet, opening the overlay runs a real LOCAL_PREFLIGHT and consumes no quota — the analyst never runs before an explicit confirm", async () => {
  const service = makePreflightService();
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  await flush();
  assert.deepEqual(service.calls.preflight, [{ cwd: "/repo" }]);
  assert.equal(service.calls.runBootstrap.length, 0, "no real quota-consuming analyst call before confirmation");
  assert.equal(overlay.state, S.SELECT_ANALYST);
});

test("the real recommended model is listed first in the picker, matching the catalog's own recommendedModel", async () => {
  const service = makePreflightService();
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  await flush();
  const firstItem = overlay.selectList.getSelectedItem();
  assert.equal(firstItem.value, QUALITY_MODEL.candidateKey);
});

test("selecting the real recommended model marks selectionSource:\"recommended\" and carries its own real tags — never fabricated", async () => {
  const service = makePreflightService();
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  await flush();
  selectByKey(overlay, QUALITY_MODEL.candidateKey);
  assert.equal(overlay.state, S.CONFIRM_ANALYST);
  assert.equal(overlay.selectedAnalyst.selectionSource, "recommended");
  assert.deepEqual(overlay.selectedAnalyst.recommendationTags, ["quality"]);
  assert.equal(overlay.selectedAnalyst.choice, "quality", "kept only for the legacy plain-text subcommand's own persisted field");
  assert.equal(service.calls.runBootstrap.length, 0, "still no real analyst call — confirmation is a separate, explicit step");
});

test("manually picking a different real, tagged model (Efficient) is honestly selectionSource:\"manual\" — the UI never claims the user picked the recommendation", async () => {
  const service = makePreflightService();
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  await flush();
  selectByKey(overlay, EFFICIENT_MODEL.candidateKey);
  assert.equal(overlay.selectedAnalyst.selectionSource, "manual");
  assert.deepEqual(overlay.selectedAnalyst.recommendationTags, ["efficient"]);
  assert.equal(overlay.selectedAnalyst.choice, "efficient");
});

test("manually picking a real UNSCORED model is honestly selectionSource:\"manual\" with NO fabricated quality/efficient tag or choice", async () => {
  const service = makePreflightService();
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  await flush();
  selectByKey(overlay, UNSCORED_MODEL.candidateKey);
  assert.equal(overlay.selectedAnalyst.selectionSource, "manual");
  assert.deepEqual(overlay.selectedAnalyst.recommendationTags, []);
  assert.equal(overlay.selectedAnalyst.choice, null, "an unscored pick fits neither quality nor efficient — never forced into one");
  assert.equal(overlay.selectedAnalyst.evidenceStatus, "unscored");
  const lines = overlay.render(76).join("\n");
  assert.match(lines, /no real benchmark evidence/, "the confirm screen must honestly warn about the real unscored state");
});

test("Escape from the confirm step goes back to selection instead of closing the overlay", async () => {
  const service = makePreflightService();
  let closed = false;
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => { closed = true; } });
  await flush();
  selectByKey(overlay, QUALITY_MODEL.candidateKey);
  overlay.handleInput(ESCAPE);
  assert.equal(overlay.state, S.SELECT_ANALYST);
  assert.equal(closed, false);
});

test("Escape from selection closes the overlay and restores focus (onClose called)", async () => {
  const service = makePreflightService();
  let closed = false;
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => { closed = true; } });
  await flush();
  overlay.handleInput(ESCAPE);
  assert.equal(closed, true);
});

test("confirming with Enter runs the real analyst exactly once, passing the real selectionSource/recommendationTags through, and shows the SUGGESTED result", async () => {
  const service = makePreflightService();
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  await flush();
  selectByKey(overlay, QUALITY_MODEL.candidateKey);
  overlay.handleInput(ENTER);
  assert.equal(overlay.state, S.ANALYZING, "must show ANALYZING immediately, before the real call resolves");
  await flush();
  assert.equal(service.calls.runBootstrap.length, 1);
  assert.equal(service.calls.runBootstrap[0].analyst.selectionSource, "recommended");
  assert.equal(overlay.state, S.RESULT);
  assert.equal(overlay.suggestedStrategy.qualityTeam[0].model.displayName, "GPT-6 Astra");
  assert.equal(overlay.suggestedStrategy.efficientTeam[0].model.displayName, "Claude Opus 5");
});

test("approving with Enter on the RESULT view calls the real approveProjectStrategy once and moves to ACTIVE", async () => {
  const service = makePreflightService();
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  await flush();
  selectByKey(overlay, QUALITY_MODEL.candidateKey);
  overlay.handleInput(ENTER);
  await flush();
  overlay.handleInput(ENTER);
  assert.equal(overlay.state, S.APPROVING);
  await flush();
  assert.equal(service.calls.approve.length, 1);
  assert.equal(overlay.state, S.ACTIVE);
  assert.equal(overlay.activeStrategy.status, "active");
});

test("Escape on the RESULT view closes without approving — the strategy stays suggested, never silently approved", async () => {
  const service = makePreflightService();
  let closed = false;
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => { closed = true; } });
  await flush();
  selectByKey(overlay, QUALITY_MODEL.candidateKey);
  overlay.handleInput(ENTER);
  await flush();
  overlay.handleInput(ESCAPE);
  assert.equal(closed, true);
  assert.equal(service.calls.approve.length, 0);
});

test("an existing ACTIVE strategy renders directly, with no real preflight/quota call at all", async () => {
  const service = makePreflightService();
  const view = makeFakeView({ projectStrategy: { status: "active", approvedAt: "2026-09-01", qualityTeam: [] } });
  const overlay = new ProjectOverlay({ service, view, cwd: "/repo", onClose: () => {} });
  await flush();
  assert.equal(overlay.state, S.ACTIVE);
  assert.equal(service.calls.preflight.length, 0);
});

test("an existing STALE strategy shows a refresh option, and Enter calls the real refreshProjectStrategy", async () => {
  const service = makePreflightService();
  const view = makeFakeView({ projectStrategy: { status: "stale", qualityTeam: [] } });
  const overlay = new ProjectOverlay({ service, view, cwd: "/repo", onClose: () => {} });
  await flush();
  assert.equal(overlay.state, S.STALE);
  overlay.handleInput(ENTER);
  assert.equal(overlay.state, S.REFRESHING);
  await flush();
  assert.equal(service.calls.refresh.length, 1);
});

test("an existing SUGGESTED strategy renders the RESULT view directly, with no real preflight call", async () => {
  const service = makePreflightService();
  const view = makeFakeView({
    projectStrategy: {
      status: "suggested", bootstrapAnalystChoice: "quality", bootstrapAnalystSelectionSource: "recommended", bootstrapAnalystRecommendationTags: ["quality"],
      bootstrapAnalyst: { adapterId: "codex", modelId: "gpt-6-astra" }, qualityTeam: [], efficientTeam: []
    }
  });
  const overlay = new ProjectOverlay({ service, view, cwd: "/repo", onClose: () => {} });
  await flush();
  assert.equal(overlay.state, S.RESULT);
  assert.equal(service.calls.preflight.length, 0);
});

test("no real Bootstrap Analyst candidate available shows an honest NO_ANALYST state, and Enter/Esc close it", async () => {
  const service = makePreflightService({ analystCatalog: makeAnalystCatalog([]) });
  let closed = false;
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => { closed = true; } });
  await flush();
  assert.equal(overlay.state, S.NO_ANALYST);
  overlay.handleInput(ENTER);
  assert.equal(closed, true);
});

test("a real preflight failure surfaces as an honest ERROR state, not a silent crash", async () => {
  const service = makePreflightService({ preflightError: new Error("crm unreadable") });
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  await flush();
  assert.equal(overlay.state, S.ERROR);
  assert.match(overlay.errorMessage, /crm unreadable/);
});

test("render() never throws across every state, including a narrow terminal width, and returns real lines", async () => {
  const service = makePreflightService();
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  await flush();
  for (const width of [20, 40, 76, 120]) {
    const lines = overlay.render(width);
    assert.ok(Array.isArray(lines) && lines.length > 0, `render(${width}) must return non-empty lines`);
  }
  selectByKey(overlay, QUALITY_MODEL.candidateKey);
  overlay.handleInput(ENTER);
  await flush();
  assert.ok(overlay.render(76).length > 0);
  overlay.handleInput(ENTER);
  await flush();
  assert.ok(overlay.render(76).length > 0);
});

test("the picker's own rows are model-first (display name before provider), never provider-first", async () => {
  const service = makePreflightService();
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  await flush();
  const lines = overlay.render(76).join("\n");
  const nameIndex = lines.indexOf("GPT-6 Astra");
  const providerIndex = lines.indexOf("codex", nameIndex);
  assert.ok(nameIndex >= 0 && providerIndex > nameIndex, "the model's own display name must render before its provider on the same row");
});

test("the overlay's own Box never applies a full-panel background — only SelectList's own active-row highlight does", async () => {
  const service = makePreflightService();
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  await flush();
  const lines = overlay.render(76);
  // A full-box background would apply the same background escape code to
  // EVERY rendered line; with no box-level bgFn, at most the SelectList's
  // own highlighted row (not every line) carries a background sequence.
  const bgLines = lines.filter((line) => /\x1b\[48;/.test(line));
  assert.ok(bgLines.length < lines.length, "not every rendered line should carry a background escape sequence");
});

test("openProjectOverlay shows the overlay on the real tui, sized ~76 columns / 70% max height, and restores focus to the editor on close", async () => {
  let shown = null;
  let hidden = false;
  const tui = {
    requestRender() {},
    showOverlay(component, options) {
      shown = { component, options };
      return { hide: () => { hidden = true; }, setHidden: () => {}, isHidden: () => hidden, focus: () => {}, unfocus: () => {}, isFocused: () => !hidden, getBounds: () => undefined };
    }
  };
  const service = makePreflightService();
  const handle = openProjectOverlay({ tui, service, view: makeFakeView(), cwd: "/repo" });
  assert.ok(shown, "showOverlay must actually be called");
  assert.equal(shown.component.constructor, ProjectOverlay);
  assert.equal(shown.options.width, 76);
  assert.equal(shown.options.maxHeight, "70%");
  await flush();
  shown.component.handleInput(ESCAPE);
  assert.equal(hidden, true, "closing the overlay must hide it, letting pi-tui restore focus to whatever had it before (the editor)");
  handle.hide();
});
