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

const EXPLORER_RECOMMENDED = { candidateKey: "codex::gpt-6-astra", adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra", accessMode: "automatic" };
const EXPLORER_ALTERNATIVE = { candidateKey: "claude::claude-opus-5", adapterId: "claude", modelId: "claude-opus-5", displayName: "Claude Opus 5", evidenceStatus: "scored", available: true, accessMode: "automatic", roleEvaluation: null };
const EXPLORER_UNSCORED = { candidateKey: "cursor::cursor-x", adapterId: "cursor", modelId: "cursor-x", displayName: "Cursor X", evidenceStatus: "unscored", available: true, accessMode: "manual", roleEvaluation: null };

function makeProjectTeam() {
  return [{
    role: "Explorer", model: EXPLORER_RECOMMENDED, fallback: null, decisionEvidence: { decisionType: "leader" }, assignmentSource: "recommended",
    recommendedAssignment: { model: EXPLORER_RECOMMENDED, fallback: null, decisionEvidence: { decisionType: "leader" } }, overrideEvidence: null
  }];
}

function makeEditCatalog() {
  return { role: "Explorer", models: [{ ...EXPLORER_RECOMMENDED, evidenceStatus: "scored", available: true, roleEvaluation: null }, EXPLORER_ALTERNATIVE, EXPLORER_UNSCORED] };
}

function makePreflightService({ analystCatalog = makeAnalystCatalog(), preflightError = null, editCatalog = makeEditCatalog() } = {}) {
  const calls = { preflight: [], runBootstrap: [], approve: [], refresh: [], editCatalog: [], setAssignment: [] };
  let strategy = null;
  return {
    calls,
    async preflightProject(args) {
      calls.preflight.push(args);
      if (preflightError) throw preflightError;
      return { profile: { fingerprint: "fp-1" }, candidates: { scoredAll: [] }, analystCatalog };
    },
    async runBootstrapAnalysis(args) {
      calls.runBootstrap.push(args);
      strategy = {
        status: "suggested", bootstrapAnalystChoice: args.analyst.choice, bootstrapAnalyst: args.analyst.model,
        bootstrapAnalystSelectionSource: args.analyst.selectionSource, bootstrapAnalystRecommendationTags: args.analyst.recommendationTags,
        qualityTeam: [{ role: "Explorer", model: { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra" }, reason: null }],
        efficientTeam: [{ role: "Explorer", model: { adapterId: "claude", modelId: "claude-opus-5", displayName: "Claude Opus 5" }, reason: null }],
        projectTeam: makeProjectTeam()
      };
      return strategy;
    },
    async approveProjectStrategy(args) {
      calls.approve.push(args);
      return { status: "active", approvedAt: "2026-09-16T00:00:00.000Z", qualityTeam: [], projectTeam: strategy?.projectTeam ?? [] };
    },
    async refreshProjectStrategy(args) {
      calls.refresh.push(args);
      return { status: "stale", qualityTeam: [] };
    },
    async getProjectTeamEditCatalog(args) {
      calls.editCatalog.push(args);
      return editCatalog;
    },
    async setProjectTeamAssignment(args) {
      calls.setAssignment.push(args);
      const candidate = editCatalog.models.find((m) => m.candidateKey === args.candidateKey);
      const entry = strategy.projectTeam.find((e) => e.role === args.role);
      const isRecommended = candidate.candidateKey === entry.recommendedAssignment.model.candidateKey;
      const updatedEntry = isRecommended
        ? { ...entry, model: entry.recommendedAssignment.model, fallback: entry.recommendedAssignment.fallback, decisionEvidence: entry.recommendedAssignment.decisionEvidence, assignmentSource: "recommended", overrideEvidence: null }
        : {
          ...entry,
          model: { candidateKey: candidate.candidateKey, adapterId: candidate.adapterId, modelId: candidate.modelId, displayName: candidate.displayName, accessMode: candidate.accessMode },
          fallback: null, decisionEvidence: null, assignmentSource: "override",
          overrideEvidence: { accessMode: candidate.accessMode, available: candidate.available, evidenceStatus: candidate.evidenceStatus, roleEvaluation: candidate.roleEvaluation }
        };
      strategy = { ...strategy, projectTeam: strategy.projectTeam.map((e) => (e.role === args.role ? updatedEntry : e)) };
      return strategy;
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

test("pressing 'a' on the RESULT view calls the real approveProjectStrategy once and moves to ACTIVE — Enter on a role row edits it instead, never silently approves", async () => {
  const service = makePreflightService();
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  await flush();
  selectByKey(overlay, QUALITY_MODEL.candidateKey);
  overlay.handleInput(ENTER);
  await flush();
  overlay.handleInput("a");
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

test("Enter on the RESULT view's PROJECT TEAM opens the real, read-only edit catalog for the highlighted role, consuming no quota", async () => {
  const service = makePreflightService();
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  await flush();
  selectByKey(overlay, QUALITY_MODEL.candidateKey);
  overlay.handleInput(ENTER);
  await flush();
  assert.equal(overlay.state, S.RESULT);
  overlay.handleInput(ENTER);
  await flush();
  assert.equal(overlay.state, S.EDIT_MODEL_SEARCH);
  assert.equal(overlay.editingRole, "Explorer");
  assert.deepEqual(service.calls.editCatalog, [{ cwd: "/repo", role: "Explorer" }]);
  assert.equal(service.calls.setAssignment.length, 0, "opening the picker must never write anything");
});

test("the edit picker orders the real catalog current -> recommended -> other scored -> unscored", async () => {
  const service = makePreflightService();
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  await flush();
  selectByKey(overlay, QUALITY_MODEL.candidateKey);
  overlay.handleInput(ENTER);
  await flush();
  overlay.handleInput(ENTER);
  await flush();
  const ordered = overlay.orderedEditModels();
  assert.deepEqual(ordered.map((m) => m.candidateKey), [EXPLORER_RECOMMENDED.candidateKey, EXPLORER_ALTERNATIVE.candidateKey, EXPLORER_UNSCORED.candidateKey]);
});

test("picking a real different scored candidate and confirming persists a real override, clearing fallback/decisionEvidence", async () => {
  const service = makePreflightService();
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  await flush();
  selectByKey(overlay, QUALITY_MODEL.candidateKey);
  overlay.handleInput(ENTER);
  await flush();
  overlay.handleInput(ENTER);
  await flush();
  overlay.beginConfirmEdit(EXPLORER_ALTERNATIVE.candidateKey);
  assert.equal(overlay.state, S.EDIT_CONFIRM);
  const lines = overlay.render(76).join("\n");
  assert.match(lines, /manual override/);
  overlay.handleInput(ENTER);
  await flush();
  assert.deepEqual(service.calls.setAssignment, [{ cwd: "/repo", role: "Explorer", candidateKey: EXPLORER_ALTERNATIVE.candidateKey }]);
  assert.equal(overlay.state, S.RESULT);
  const entry = overlay.suggestedStrategy.projectTeam.find((e) => e.role === "Explorer");
  assert.equal(entry.assignmentSource, "override");
  assert.equal(entry.model.adapterId, "claude");
  assert.equal(entry.fallback, null);
  assert.equal(entry.decisionEvidence, null);
});

test("picking a real unscored/manual candidate shows both honest warnings before confirming", async () => {
  const service = makePreflightService();
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  await flush();
  selectByKey(overlay, QUALITY_MODEL.candidateKey);
  overlay.handleInput(ENTER);
  await flush();
  overlay.handleInput(ENTER);
  await flush();
  overlay.beginConfirmEdit(EXPLORER_UNSCORED.candidateKey);
  const lines = overlay.render(76).join("\n");
  assert.match(lines, /no real benchmark evidence/);
  assert.match(lines, /manual handoff/);
});

test("choosing the real recommended candidate again in the picker is honestly labeled a restore, not an override", async () => {
  const service = makePreflightService();
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  await flush();
  selectByKey(overlay, QUALITY_MODEL.candidateKey);
  overlay.handleInput(ENTER);
  await flush();
  overlay.handleInput(ENTER);
  await flush();
  overlay.beginConfirmEdit(EXPLORER_RECOMMENDED.candidateKey);
  const lines = overlay.render(76).join("\n");
  assert.match(lines, /restores the real recommendation/);
  assert.doesNotMatch(lines, /manual override/);
});

test("Escape from EDIT_MODEL_SEARCH cancels without writing, returning to RESULT", async () => {
  const service = makePreflightService();
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  await flush();
  selectByKey(overlay, QUALITY_MODEL.candidateKey);
  overlay.handleInput(ENTER);
  await flush();
  overlay.handleInput(ENTER);
  await flush();
  overlay.handleInput(ESCAPE);
  assert.equal(overlay.state, S.RESULT);
  assert.equal(service.calls.setAssignment.length, 0);
});

test("Escape from EDIT_CONFIRM cancels without writing, returning to the search picker", async () => {
  const service = makePreflightService();
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  await flush();
  selectByKey(overlay, QUALITY_MODEL.candidateKey);
  overlay.handleInput(ENTER);
  await flush();
  overlay.handleInput(ENTER);
  await flush();
  overlay.beginConfirmEdit(EXPLORER_ALTERNATIVE.candidateKey);
  overlay.handleInput(ESCAPE);
  assert.equal(overlay.state, S.EDIT_MODEL_SEARCH);
  assert.equal(service.calls.setAssignment.length, 0);
});

test("typing in the edit picker filters via real fuzzy matching on display name/provider, never SelectList's own value-prefix filter", async () => {
  const service = makePreflightService();
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  await flush();
  selectByKey(overlay, QUALITY_MODEL.candidateKey);
  overlay.handleInput(ENTER);
  await flush();
  overlay.handleInput(ENTER);
  await flush();
  for (const ch of "opus") overlay.handleInput(ch);
  assert.equal(overlay.editQuery, "opus");
  const lines = overlay.render(76).join("\n");
  assert.match(lines, /Claude Opus 5/);
  assert.doesNotMatch(lines, /GPT-6 Astra/, "a real fuzzy filter for \"opus\" must exclude a non-matching real candidate");
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
  assert.ok(overlay.render(76).length > 0, "RESULT");
  overlay.handleInput(ENTER);
  await flush();
  assert.ok(overlay.render(76).length > 0, "EDIT_MODEL_SEARCH");
  overlay.beginConfirmEdit(EXPLORER_ALTERNATIVE.candidateKey);
  assert.ok(overlay.render(76).length > 0, "EDIT_CONFIRM");
  overlay.handleInput(ENTER);
  await flush();
  assert.ok(overlay.render(76).length > 0, "back to RESULT after saving");
  overlay.handleInput("a");
  await flush();
  assert.ok(overlay.render(76).length > 0, "ACTIVE");
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

test("REGRESSION: the picker's model+provider row is explicitly colored with the real, readable 'text' role — never left to a terminal's own default or to muted", async () => {
  const service = makePreflightService();
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  await flush();
  const lines = overlay.render(76).join("\n");
  // theme.text's real RGB (243,246,249) — an explicit fg escape right
  // before the model's own display name confirms it's not left plain.
  assert.match(lines, /\x1b\[38;2;243;246;249m[^\x1b]*GPT-6 Astra/);
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
