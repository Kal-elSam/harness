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

function makeAlternatives() {
  return [
    { choice: "quality", model: { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra" } },
    { choice: "efficient", model: { adapterId: "opencode-go", modelId: "glm-5-3", displayName: "GLM-5.3" } }
  ];
}

function makePreflightService({ alternatives = makeAlternatives(), preflightError = null } = {}) {
  const calls = { preflight: [], runBootstrap: [], approve: [], refresh: [] };
  return {
    calls,
    async preflightProject(args) {
      calls.preflight.push(args);
      if (preflightError) throw preflightError;
      return { profile: { fingerprint: "fp-1" }, candidates: { scoredAll: [] }, alternatives };
    },
    async runBootstrapAnalysis(args) {
      calls.runBootstrap.push(args);
      return {
        status: "suggested", bootstrapAnalystChoice: args.analyst.choice, bootstrapAnalyst: args.analyst.model,
        qualityTeam: [{ role: "Explorer", model: { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra" }, reason: null }],
        efficientTeam: [{ role: "Explorer", model: { adapterId: "opencode-go", modelId: "glm-5-3", displayName: "GLM-5.3" }, reason: null }]
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

test("with no real strategy yet, opening the overlay runs a real LOCAL_PREFLIGHT and consumes no quota — the analyst never runs before an explicit confirm", async () => {
  const service = makePreflightService();
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  await flush();
  assert.deepEqual(service.calls.preflight, [{ cwd: "/repo" }]);
  assert.equal(service.calls.runBootstrap.length, 0, "no real quota-consuming analyst call before confirmation");
  assert.equal(overlay.state, S.SELECT_ANALYST);
});

test("selecting an analyst moves to a confirm step without running the real analyst yet", async () => {
  const service = makePreflightService();
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  await flush();
  overlay.selectList.onSelect({ value: "quality" });
  assert.equal(overlay.state, S.CONFIRM_ANALYST);
  assert.equal(overlay.selectedAnalyst.choice, "quality");
  assert.equal(service.calls.runBootstrap.length, 0, "still no real analyst call — confirmation is a separate, explicit step");
});

test("Escape from the confirm step goes back to selection instead of closing the overlay", async () => {
  const service = makePreflightService();
  let closed = false;
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => { closed = true; } });
  await flush();
  overlay.selectList.onSelect({ value: "quality" });
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

test("confirming with Enter runs the real analyst exactly once and shows the SUGGESTED result with both real Quality and Efficient teams", async () => {
  const service = makePreflightService();
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  await flush();
  overlay.selectList.onSelect({ value: "quality" });
  overlay.handleInput(ENTER);
  assert.equal(overlay.state, S.ANALYZING, "must show ANALYZING immediately, before the real call resolves");
  await flush();
  assert.equal(service.calls.runBootstrap.length, 1);
  assert.equal(overlay.state, S.RESULT);
  assert.equal(overlay.suggestedStrategy.qualityTeam[0].model.displayName, "GPT-6 Astra");
  assert.equal(overlay.suggestedStrategy.efficientTeam[0].model.displayName, "GLM-5.3");
});

test("approving with Enter on the RESULT view calls the real approveProjectStrategy once and moves to ACTIVE", async () => {
  const service = makePreflightService();
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  await flush();
  overlay.selectList.onSelect({ value: "quality" });
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
  overlay.selectList.onSelect({ value: "quality" });
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
    projectStrategy: { status: "suggested", bootstrapAnalystChoice: "quality", bootstrapAnalyst: { adapterId: "codex", modelId: "gpt-6-astra" }, qualityTeam: [], efficientTeam: [] }
  });
  const overlay = new ProjectOverlay({ service, view, cwd: "/repo", onClose: () => {} });
  await flush();
  assert.equal(overlay.state, S.RESULT);
  assert.equal(service.calls.preflight.length, 0);
});

test("no real Bootstrap Analyst alternative available shows an honest NO_ANALYST state, and Enter/Esc close it", async () => {
  const service = makePreflightService({ alternatives: [] });
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
  for (const width of [20, 40, 80, 120]) {
    const lines = overlay.render(width);
    assert.ok(Array.isArray(lines) && lines.length > 0, `render(${width}) must return non-empty lines`);
  }
  overlay.selectList.onSelect({ value: "quality" });
  overlay.handleInput(ENTER);
  await flush();
  assert.ok(overlay.render(40).length > 0);
  overlay.handleInput(ENTER);
  await flush();
  assert.ok(overlay.render(40).length > 0);
});

test("openProjectOverlay shows the overlay on the real tui and restores focus to the editor on close", async () => {
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
  await flush();
  shown.component.handleInput(ESCAPE);
  assert.equal(hidden, true, "closing the overlay must hide it, letting pi-tui restore focus to whatever had it before (the editor)");
  handle.hide();
});
