import test from "node:test";
import assert from "node:assert/strict";
import { ProjectOverlay, PROJECT_OVERLAY_STATE as S, openProjectOverlay } from "../src/global/cockpit/project-overlay.js";
import { CockpitView, explainTeamDecision } from "../src/global/cockpit/view.js";

const ENTER = "\r";
const ESCAPE = "\x1b";

/** Mirrors CockpitView's own real beginAction/endAction/actionStatusLine contract (view.js) — a minimal real implementation, not a stub that just records calls, so overlay tests exercise the exact same live-indicator behavior the real cockpit does. */
function makeFakeView(snapshot = {}) {
  return {
    snapshot,
    aiTeamLabel: (model) => model.displayName ?? model.modelId,
    aiTeamLabelWithProvider: (model) => `${model.adapterId} · ${model.displayName ?? model.modelId}`,
    teamRoleLabel: (model, modelColumnWidth = 0) => `${(model.displayName ?? model.modelId).padEnd(modelColumnWidth)}  ·  ${model.adapterId.charAt(0).toUpperCase() + model.adapterId.slice(1)}`,
    teamModelColumnWidth: (models) => models.reduce((max, model) => (model ? Math.max(max, (model.displayName ?? model.modelId).length) : max), 0),
    actionLabel: null,
    beginAction(label) { this.actionLabel = label; },
    endAction() { this.actionLabel = null; },
    actionStatusLine() { return this.actionLabel ? `⠋ ${this.actionLabel}… (0s)` : null; }
  };
}

const QUALITY_MODEL = { candidateKey: "codex::gpt-6-astra", adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra", evidenceStatus: "scored", available: true, quota: 40, recommendationTags: ["quality"] };
const EFFICIENT_MODEL = { candidateKey: "claude::claude-opus-5", adapterId: "claude", modelId: "claude-opus-5", displayName: "Claude Opus 5", evidenceStatus: "scored", available: true, quota: 60, recommendationTags: ["efficient"] };
const UNSCORED_MODEL = { candidateKey: "codex::gpt-6-experimental", adapterId: "codex", modelId: "gpt-6-experimental", displayName: "GPT-6 Experimental", evidenceStatus: "unscored", available: true, quota: 40, recommendationTags: [] };
const UNVERIFIED_CLAUDE_MODEL = {
  candidateKey: "claude::claude-fable-5-1", adapterId: "claude", modelId: "claude-fable-5-1", displayName: "Claude Fable 5.1",
  evidenceStatus: "scored", available: true, quota: 60, recommendationTags: [], entitlement: "unverified",
  entitlementReason: "Access has not been verified and may require extra credits"
};

function makeAnalystCatalog(models = [QUALITY_MODEL, EFFICIENT_MODEL, UNSCORED_MODEL]) {
  return { recommendedModel: models.find((m) => m.recommendationTags.includes("quality")) ?? null, models };
}

const EXPLORER_RECOMMENDED = { candidateKey: "codex::gpt-6-astra", adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra", accessMode: "automatic" };
const EXPLORER_ALTERNATIVE = { candidateKey: "claude::claude-opus-5", adapterId: "claude", modelId: "claude-opus-5", displayName: "Claude Opus 5", evidenceStatus: "scored", available: true, accessMode: "automatic", roleEvaluation: null };
const EXPLORER_UNSCORED = { candidateKey: "cursor::cursor-x", adapterId: "cursor", modelId: "cursor-x", displayName: "Cursor X", evidenceStatus: "unscored", available: true, accessMode: "manual", roleEvaluation: null };
const EXPLORER_UNVERIFIED_CLAUDE = { ...UNVERIFIED_CLAUDE_MODEL, accessMode: "automatic", roleEvaluation: null };

function makeProjectTeam() {
  return [{
    role: "Explorer", model: EXPLORER_RECOMMENDED, fallback: null, decisionEvidence: { decisionType: "leader" },
    reason: "Real capability leader for this role.", assignmentSource: "recommended",
    recommendedAssignment: { model: EXPLORER_RECOMMENDED, fallback: null, decisionEvidence: { decisionType: "leader" }, reason: "Real capability leader for this role." },
    overrideEvidence: null
  }];
}

function makeEditCatalog() {
  return { role: "Explorer", models: [{ ...EXPLORER_RECOMMENDED, evidenceStatus: "scored", available: true, roleEvaluation: null }, EXPLORER_ALTERNATIVE, EXPLORER_UNVERIFIED_CLAUDE, EXPLORER_UNSCORED] };
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

/** Real word-wrapping (pi-tui's Text component) can split a phrase across
 * physical rows, and every content row also carries the real panel's own
 * left/right border — this strips both (ANSI codes + the border's own
 * "│") and collapses rendered lines into one plain string, so an
 * assertion checks the real content, not accidental wrap/border points. */
function joinPlain(lines) {
  return lines
    .map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""))
    .map((line) => line.replace(/^│\s?/, "").replace(/\s?│$/, ""))
    .join(" ")
    .replace(/\s+/g, " ");
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

test("unverified Claude stays explicitly selectable but is tagged and warned as possible extra-credit access", async () => {
  const service = makePreflightService({ analystCatalog: makeAnalystCatalog([QUALITY_MODEL, UNVERIFIED_CLAUDE_MODEL]) });
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  await flush();
  const pickerLines = overlay.render(76).join("\n");
  assert.match(pickerLines, /Unverified · extra credits/);

  selectByKey(overlay, UNVERIFIED_CLAUDE_MODEL.candidateKey);
  const confirmLines = overlay.render(76).join("\n");
  assert.match(confirmLines, /access is unverified and may require extra credits/i);
  assert.equal(overlay.selectedAnalyst.entitlement, "unverified");
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

test("onNarrate mirrors the real analysis milestones (starting, result ready) into the conversation transcript — the interactive overlay's own process shown in chat, like a real CLI narrates its steps", async () => {
  const service = makePreflightService();
  const narrated = [];
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {}, onNarrate: (text) => narrated.push(text) });
  await flush();
  assert.deepEqual(narrated, [], "narration only starts once a real action runs, never for opening the picker");
  selectByKey(overlay, QUALITY_MODEL.candidateKey);
  overlay.handleInput(ENTER);
  assert.equal(narrated.length, 1);
  assert.match(narrated[0], /is investigating this project \(read-only\)/);
  await flush();
  assert.equal(narrated.length, 2);
  assert.match(narrated[1], /Suggested project team ready \(\d+ real role/);
});

test("onNarrate reports approval and refresh milestones, and real failures, never silently", async () => {
  const service = makePreflightService();
  const narrated = [];
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {}, onNarrate: (text) => narrated.push(text) });
  await flush();
  selectByKey(overlay, QUALITY_MODEL.candidateKey);
  overlay.handleInput(ENTER);
  await flush();
  overlay.handleInput("a");
  await flush();
  assert.match(narrated.at(-1), /Project team is now ACTIVE\./);

  const failingService = makePreflightService();
  failingService.approveProjectStrategy = async () => { throw new Error("real approval error"); };
  const failingNarrated = [];
  const failingOverlay = new ProjectOverlay({ service: failingService, view: makeFakeView(), cwd: "/repo", onClose: () => {}, onNarrate: (text) => failingNarrated.push(text) });
  await flush();
  selectByKey(failingOverlay, QUALITY_MODEL.candidateKey);
  failingOverlay.handleInput(ENTER);
  await flush();
  failingOverlay.handleInput("a");
  await flush();
  assert.match(failingNarrated.at(-1), /Approval failed: real approval error/);
});

test("onNarrate reports a STALE->refresh transition's real resulting status", async () => {
  const service = makePreflightService();
  const view = makeFakeView({ projectStrategy: { status: "stale", qualityTeam: [] } });
  const narrated = [];
  const overlay = new ProjectOverlay({ service, view, cwd: "/repo", onClose: () => {}, onNarrate: (text) => narrated.push(text) });
  await flush();
  overlay.handleInput(ENTER);
  await flush();
  assert.match(narrated.at(-1), /Project strategy is now (ACTIVE|STALE)\./);
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
  assert.deepEqual(ordered.map((m) => m.candidateKey), [
    EXPLORER_RECOMMENDED.candidateKey, EXPLORER_ALTERNATIVE.candidateKey,
    EXPLORER_UNVERIFIED_CLAUDE.candidateKey, EXPLORER_UNSCORED.candidateKey
  ]);
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

test("an unverified Claude role override is tagged in the picker and warned before saving", async () => {
  const service = makePreflightService();
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  await flush();
  selectByKey(overlay, QUALITY_MODEL.candidateKey);
  overlay.handleInput(ENTER);
  await flush();
  overlay.handleInput(ENTER);
  await flush();
  const pickerLines = overlay.render(76).join("\n");
  assert.match(pickerLines, /unverified · extra credits/i);
  overlay.beginConfirmEdit(EXPLORER_UNVERIFIED_CLAUDE.candidateKey);
  const confirmLines = overlay.render(76).join("\n");
  assert.match(confirmLines, /access is unverified and may require extra credits/i);
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

test("REGRESSION: pressing 'r' on an existing RESULT/ACTIVE/STALE strategy forces a genuinely fresh preflight — the only way back to the real interactive analyst picker once a strategy already exists", async () => {
  const service = makePreflightService();
  const suggested = {
    status: "suggested", bootstrapAnalystChoice: "quality", bootstrapAnalystSelectionSource: "recommended", bootstrapAnalystRecommendationTags: ["quality"],
    bootstrapAnalyst: { adapterId: "codex", modelId: "gpt-6-astra" }, qualityTeam: [], efficientTeam: []
  };
  const overlay = new ProjectOverlay({ service, view: makeFakeView({ projectStrategy: suggested }), cwd: "/repo", onClose: () => {} });
  await flush();
  assert.equal(overlay.state, S.RESULT);
  assert.equal(service.calls.preflight.length, 0, "no real preflight call yet — the existing suggestion is shown as-is");

  overlay.handleInput("r");
  await flush();
  assert.equal(service.calls.preflight.length, 1, "'r' must trigger a genuinely fresh, real preflight call");
  assert.equal(overlay.state, S.SELECT_ANALYST, "must land back on the real interactive analyst picker, not a text dump");
  assert.equal(overlay.suggestedStrategy, null, "the stale in-memory suggestion must be cleared, never shown alongside the fresh picker");
});

test("REGRESSION: 'r' also forces a fresh preflight from ACTIVE and STALE, not only RESULT", async () => {
  const service = makePreflightService();
  const active = { status: "active", approvedAt: "t0", projectTeam: [] };
  const stale = { status: "stale", approvedAt: "t0", projectTeam: [] };

  const overlayActive = new ProjectOverlay({ service, view: makeFakeView({ projectStrategy: active }), cwd: "/repo", onClose: () => {} });
  await flush();
  assert.equal(overlayActive.state, S.ACTIVE);
  overlayActive.handleInput("r");
  await flush();
  assert.equal(overlayActive.state, S.SELECT_ANALYST);

  const overlayStale = new ProjectOverlay({ service, view: makeFakeView({ projectStrategy: stale }), cwd: "/repo", onClose: () => {} });
  await flush();
  assert.equal(overlayStale.state, S.STALE);
  overlayStale.handleInput("r");
  await flush();
  assert.equal(overlayStale.state, S.SELECT_ANALYST, "'r' (fresh re-analysis) must work from STALE too, distinct from Enter's own refresh()");
});

test("REGRESSION: a persisted ACTIVE strategy naming an unverified Cursor model shows BLOCKED in the overlay — the fail-closed Cursor eligibility fix flows through the existing check with no new wiring needed", async () => {
  const fable = { adapterId: "cursor", modelId: "fable", displayName: "Fable" };
  const active = {
    status: "active", approvedAt: "t0",
    projectTeam: [{ role: "Builder", model: fable, fallback: null, reason: null, assignmentSource: "recommended" }]
  };
  // resolveAssignmentAvailability reads eligibility.cursor.ok exactly the
  // way checkCandidate now computes it (fail-closed, unverified by
  // default) — this proves the fix propagates without any new overlay code.
  const view = makeFakeView({
    projectStrategy: active,
    modelIntelligence: { eligibility: { cursor: { ok: false, reason: "Cursor access unverified — run /project cursor available once you've confirmed real quota, or /project cursor exhausted if you don't have any." } }, claudeEntitlement: {} }
  });
  const overlay = new ProjectOverlay({ service: makePreflightService(), view, cwd: "/repo", onClose: () => {} });
  await flush();
  assert.equal(overlay.state, S.ACTIVE);

  const lines = overlay.render(100).join("\n");
  assert.match(lines, /BLOCKED/);
  assert.match(lines, /Fable/);
});

test("REGRESSION: a persisted suggestion whose bootstrap analyst is no longer entitled shows NEEDS REANALYSIS — never presented as if it were still a clean, current recommendation", async () => {
  const fable = { adapterId: "claude", modelId: "claude-fable-5-1", displayName: "Fable 5.1" };
  const suggested = {
    status: "suggested", bootstrapAnalystChoice: "quality", bootstrapAnalystSelectionSource: "recommended",
    bootstrapAnalyst: fable, qualityTeam: [], efficientTeam: [], projectTeam: []
  };
  const view = makeFakeView({
    projectStrategy: suggested,
    modelIntelligence: { eligibility: { claude: { ok: true } }, claudeEntitlement: { "claude-fable-5-1": { status: "unverified", reason: null } } }
  });
  const overlay = new ProjectOverlay({ service: makePreflightService(), view, cwd: "/repo", onClose: () => {} });
  await flush();
  assert.equal(overlay.state, S.RESULT);

  const lines = overlay.render(100).join("\n");
  assert.match(lines, /NEEDS REANALYSIS/);
  assert.doesNotMatch(lines, /Suggested Project Team/);
  assert.match(lines, /needs reanalysis/);
});

test("REGRESSION: a persisted suggestion where ONLY the Orchestrator (not the analyst or any projectTeam role) is blocked still shows NEEDS REANALYSIS — Orchestrator lives outside projectTeam and is never assumed covered by scanning it alone", async () => {
  const fable = { adapterId: "claude", modelId: "claude-fable-5-1", displayName: "Fable 5.1" };
  const availableAnalyst = { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra" };
  const suggested = {
    status: "suggested", bootstrapAnalystChoice: "quality", bootstrapAnalystSelectionSource: "recommended",
    bootstrapAnalyst: availableAnalyst, orchestrator: fable, qualityTeam: [], efficientTeam: [], projectTeam: []
  };
  const view = makeFakeView({
    projectStrategy: suggested,
    modelIntelligence: { eligibility: { claude: { ok: true }, codex: { ok: true } }, claudeEntitlement: { "claude-fable-5-1": { status: "unverified", reason: null } } }
  });
  const overlay = new ProjectOverlay({ service: makePreflightService(), view, cwd: "/repo", onClose: () => {} });
  await flush();
  assert.equal(overlay.state, S.RESULT);

  const lines = overlay.render(100).join("\n");
  assert.match(lines, /NEEDS REANALYSIS/, "a blocked Orchestrator alone must still trigger NEEDS REANALYSIS — it lives outside projectTeam and is easy to miss");
});

test("REGRESSION: a persisted suggestion whose picks are all still available shows the ordinary 'Suggested Project Team' header, never a false NEEDS REANALYSIS", async () => {
  const suggested = {
    status: "suggested", bootstrapAnalystChoice: "quality", bootstrapAnalystSelectionSource: "recommended",
    bootstrapAnalyst: { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra" },
    qualityTeam: [], efficientTeam: [], projectTeam: []
  };
  const view = makeFakeView({ projectStrategy: suggested, modelIntelligence: { eligibility: {}, claudeEntitlement: {} } });
  const overlay = new ProjectOverlay({ service: makePreflightService(), view, cwd: "/repo", onClose: () => {} });
  await flush();
  assert.equal(overlay.state, S.RESULT);

  const lines = overlay.render(100).join("\n");
  assert.match(lines, /Suggested Project Team/);
  assert.doesNotMatch(lines, /NEEDS REANALYSIS/);
  assert.doesNotMatch(lines, /needs reanalysis/);
});

test("REGRESSION: an ACTIVE strategy's overlay view shows a currently-blocked assignment as BLOCKED — the same live check the dashboard panel already applies, now also in the overlay itself", async () => {
  const fable = { adapterId: "claude", modelId: "claude-fable-5-1", displayName: "Fable 5.1" };
  const active = {
    status: "active", approvedAt: "t0",
    projectTeam: [{ role: "Builder", model: fable, fallback: null, reason: null, assignmentSource: "recommended" }]
  };
  const view = makeFakeView({
    projectStrategy: active,
    modelIntelligence: { eligibility: { claude: { ok: true } }, claudeEntitlement: { "claude-fable-5-1": { status: "unverified", reason: null } } }
  });
  const overlay = new ProjectOverlay({ service: makePreflightService(), view, cwd: "/repo", onClose: () => {} });
  await flush();
  assert.equal(overlay.state, S.ACTIVE);

  const lines = overlay.render(100).join("\n");
  assert.match(lines, /BLOCKED/);
  assert.match(lines, /Fable 5\.1/, "the blocked assignment's real model name stays visible — hiding it would misrepresent the approved configuration");
});

test("REGRESSION: pressing 'r' transitions to LOADING_PREFLIGHT synchronously, before the async preflight call even starts — never leaves the modal looking dead while it's actually working", async () => {
  const service = makePreflightService();
  const suggested = {
    status: "suggested", bootstrapAnalystChoice: "quality", bootstrapAnalystSelectionSource: "recommended", bootstrapAnalystRecommendationTags: ["quality"],
    bootstrapAnalyst: { adapterId: "codex", modelId: "gpt-6-astra" }, qualityTeam: [], efficientTeam: []
  };
  const overlay = new ProjectOverlay({ service, view: makeFakeView({ projectStrategy: suggested }), cwd: "/repo", onClose: () => {} });
  await flush();
  assert.equal(overlay.state, S.RESULT);

  overlay.handleInput("r");
  // Synchronously, before any await — the real preflight call hasn't even
  // resolved yet.
  assert.equal(overlay.state, S.LOADING_PREFLIGHT);
  await flush();
  assert.equal(overlay.state, S.SELECT_ANALYST);
});

test("REGRESSION: a second 'r' press while a preflight is already in flight is a real no-op, never a second concurrent preflight call", async () => {
  let resolvePreflight;
  const gate = new Promise((resolve) => { resolvePreflight = resolve; });
  const calls = [];
  const service = {
    async preflightProject(args) {
      calls.push(args);
      await gate;
      return { profile: {}, candidates: {}, analystCatalog: makeAnalystCatalog(), projectRoot: "/repo" };
    }
  };
  const suggested = { status: "suggested", bootstrapAnalyst: { adapterId: "codex", modelId: "gpt-6-astra" }, qualityTeam: [], efficientTeam: [] };
  const overlay = new ProjectOverlay({ service, view: makeFakeView({ projectStrategy: suggested }), cwd: "/repo", onClose: () => {} });
  await flush();
  assert.equal(overlay.state, S.RESULT);

  overlay.handleInput("r");
  assert.equal(overlay.state, S.LOADING_PREFLIGHT);
  overlay.handleInput("r");
  overlay.handleInput("r");
  resolvePreflight();
  await flush();

  assert.equal(calls.length, 1, "three 'r' presses while one preflight is in flight must trigger exactly one real call, never three");
});

test("REGRESSION: Quality/Efficient reference teams are hidden by default on the RESULT screen and only appear via the same 'e' toggle as Evidence", async () => {
  const service = makePreflightService();
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  await flush();
  selectByKey(overlay, QUALITY_MODEL.candidateKey);
  overlay.handleInput(ENTER);
  await flush();
  assert.equal(overlay.state, S.RESULT);

  const defaultLines = overlay.render(100).join("\n");
  assert.doesNotMatch(defaultLines, /Quality \(reference\)/);
  assert.doesNotMatch(defaultLines, /Efficient \(reference\)/);

  overlay.handleInput("e");
  const withEvidence = overlay.render(100).join("\n");
  assert.match(withEvidence, /Quality \(reference\)/);
  assert.match(withEvidence, /Efficient \(reference\)/);
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
  // Checked on a real UNSELECTED row (Claude Opus 5, not the pre-selected
  // recommendation) — the selected row's own composition (which combines
  // this same label with bold+bg into one escape) is covered separately
  // in cockpit-theme.test.js.
  assert.match(lines, /\x1b\[38;2;243;246;249m[^\x1b]*Claude Opus 5/);
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

test("openProjectOverlay forceReanalyze bypasses an existing strategy and runs exactly one fresh preflight", async () => {
  let shown = null;
  const tui = {
    requestRender() {},
    showOverlay(component) {
      shown = component;
      return { hide() {}, setHidden() {}, isHidden: () => false, focus() {}, unfocus() {}, isFocused: () => true, getBounds: () => undefined };
    }
  };
  const service = makePreflightService();
  const view = makeFakeView({ projectStrategy: { status: "active", approvedAt: "t0", projectTeam: [] } });
  openProjectOverlay({ tui, service, view, cwd: "/repo", forceReanalyze: true });
  await flush();
  assert.equal(shown.state, S.SELECT_ANALYST);
  assert.deepEqual(service.calls.preflight, [{ cwd: "/repo" }], "forced analysis must run one preflight, never constructor + reanalyze twice");
});

// --- Four real reported UX bugs: missing decision evidence, no visible
// modal boundary, no live progress indicator, and mouse clicks never
// reaching the real SelectList.

test("REGRESSION: the RESULT view's own PROJECT TEAM row shows the real decision reason, not just role and model", async () => {
  const service = makePreflightService();
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  await flush();
  selectByKey(overlay, QUALITY_MODEL.candidateKey);
  overlay.handleInput(ENTER);
  await flush();
  const lines = overlay.render(76).join("\n");
  // The panel's own real width leaves the description column narrower
  // than the raw sentence — this checks the real reason text actually
  // made it into the row at all, not an exact full-sentence match.
  assert.match(lines, /Real capability leader/, "the real decisionEvidence/reason already computed for this role must actually be shown, not just role+model");
});

test("REGRESSION: an overridden role shows an honest 'manual override' explanation, never the stale reason for a different model", async () => {
  const service = makePreflightService();
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  await flush();
  selectByKey(overlay, QUALITY_MODEL.candidateKey);
  overlay.handleInput(ENTER);
  await flush();
  overlay.handleInput(ENTER); // opens the edit picker for the already-selected (only) Explorer role
  await flush();
  overlay.beginConfirmEdit(EXPLORER_ALTERNATIVE.candidateKey);
  overlay.handleInput(ENTER);
  await flush();
  const lines = overlay.render(76).join("\n");
  assert.match(lines, /Manual override/);
  assert.doesNotMatch(lines, /Real capability leader/, "the old recommendation's reason must never be shown for a role that's now overridden");
});

test("REGRESSION: render() output is a real bordered panel — never loses itself against the dashboard behind it", async () => {
  const service = makePreflightService();
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  await flush();
  const lines = overlay.render(76);
  assert.match(lines[0], /╭/, "a real top border must open the panel");
  assert.match(lines.at(-1), /╯/, "a real bottom border must close the panel");
  assert.match(lines[0], /\x1b\[38;2;127;180;202m/, "the modal outline must use the high-contrast info color, not the shared low-contrast dashboard border");
  assert.match(lines.at(-1), /\x1b\[38;2;127;180;202m/, "the bottom outline must use the same distinct modal color");
  const contentLines = lines.slice(1, -1);
  assert.ok(contentLines.length > 0);
  assert.ok(contentLines.every((line) => /│/.test(line)), "every real content line (between the top/bottom rule) must carry the panel's own left/right border");
});

test("REGRESSION: compact modal spacing keeps the bottom frame visible for a full six-role team", async () => {
  const team = ["Explorer", "Architect", "Builder", "Tester", "Debugger", "Reviewer"].map((role) => ({
    role,
    model: { adapterId: "codex", modelId: `model-${role.toLowerCase()}`, displayName: `Model ${role}` },
    reason: `Evidence-backed ${role} recommendation.`
  }));
  const strategy = {
    status: "suggested",
    bootstrapAnalystChoice: "efficient",
    bootstrapAnalystSelectionSource: "recommended",
    bootstrapAnalyst: { adapterId: "claude", modelId: "claude-opus-5", displayName: "Claude Opus 5" },
    projectTeam: team,
    qualityTeam: team,
    efficientTeam: team
  };
  const overlay = new ProjectOverlay({
    service: makePreflightService(),
    view: makeFakeView({ projectStrategy: strategy }),
    cwd: "/repo",
    onClose: () => {}
  });
  const lines = overlay.render(76);
  assert.ok(lines.length <= 32, `the six-role result should stay compact enough for the overlay height budget; got ${lines.length} rows`);
  assert.match(lines.at(-1), /╯/, "the rendered result must retain its bottom frame after compaction");
});

test("REGRESSION: a real in-flight action (analyzing, saving, approving, refreshing) shows the cockpit's own live ticking spinner, not a static string", async () => {
  const service = makePreflightService();
  const view = makeFakeView();
  const overlay = new ProjectOverlay({ service, view, cwd: "/repo", onClose: () => {} });
  await flush();
  selectByKey(overlay, QUALITY_MODEL.candidateKey);
  const confirmPromise = overlay.confirmAnalyst();
  assert.equal(overlay.state, S.ANALYZING);
  assert.equal(view.actionLabel, "codex · GPT-6 Astra is investigating this project", "beginAction must have been called with a real label before the async call even resolves");
  const lines = overlay.render(76).join("\n");
  assert.match(lines, /⠋ .*is investigating this project… \(0s\)/, "must render the real live spinner+elapsed-time line, not a static string");
  await confirmPromise;
  assert.equal(view.actionLabel, null, "endAction must run once the real analysis settles, live or not");
});

test("REGRESSION: a real mouse click on a PROJECT TEAM row only selects it and updates the detail block — it must never silently open the edit picker, indistinguishable from just browsing", async () => {
  const team = ["Explorer", "Architect"].map((role, i) => ({
    role, model: { adapterId: "codex", modelId: `model-${i}`, displayName: `Model ${role}` },
    fallback: null, reason: `${role}-specific reason.`, assignmentSource: "recommended"
  }));
  const suggested = {
    status: "suggested", bootstrapAnalystChoice: "quality", bootstrapAnalystSelectionSource: "recommended",
    bootstrapAnalyst: { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra" },
    qualityTeam: [], efficientTeam: [], projectTeam: team
  };
  const service = makePreflightService();
  const overlay = new ProjectOverlay({ service, view: makeFakeView({ projectStrategy: suggested }), cwd: "/repo", onClose: () => {} });
  await flush();
  assert.equal(overlay.state, S.RESULT);
  const width = 76;
  overlay.render(width);
  // The RESULT screen's real layout: title, analyst line, blank, "PROJECT
  // TEAM" heading, then the real resultSelectList's own rows — exactly
  // where the earlier render() calls (see buildResultRoleList's own
  // box.addChild order) place it inside the Box.
  const rows = overlay.box.mouseLayout.children;
  let rowY = 0;
  for (const { component, height } of rows) {
    if (component === overlay.resultSelectList) break;
    rowY += height;
  }
  // Two real layers of offset stack between the panel's own absolute
  // (0,0) and a child row inside the Box: the real frame's own top
  // border row + left border/padding column (see ProjectOverlay's own
  // handleMouse), THEN the Box's own paddingY/paddingX (2,1) on top of
  // that — both real, both have to be crossed to land inside a child.
  // "+3" (one row below the SelectList's own first row, at +2) lands the
  // click on the SECOND real row (Architect), proving a click actually
  // moves selection, not just re-clicks whatever was already selected.
  const clickEvent = {
    type: "click", button: "left", x: 4, y: rowY + 3, screenX: 4, screenY: rowY + 3,
    width, height: 1, shift: false, alt: false, ctrl: false
  };
  const result = overlay.handleMouse(clickEvent);
  assert.ok(result?.handled, "a real click on the real PROJECT TEAM row must be handled, not silently dropped");
  assert.equal(overlay.state, S.RESULT, "a click must never leave RESULT on its own — only Enter opens the edit picker");
  assert.equal(overlay.resultSelectList.getSelectedItem()?.value, "Architect", "the click must have moved the real selection to the clicked row");
  assert.equal(service.calls.editCatalog.length, 0, "a click must never itself request the edit catalog — that's Enter's own explicit job");
  assert.match(overlay.render(width).join("\n"), /Architect-specific reason\./, "the detail block must already reflect the newly clicked row");

  overlay.handleInput(ENTER);
  await flush();
  assert.equal(overlay.state, S.EDIT_MODEL_SEARCH, "Enter on the now-selected row must explicitly open its edit picker");
  assert.deepEqual(service.calls.editCatalog.at(-1), { cwd: "/repo", role: "Architect" });
});

test("ProjectOverlay.handleMouse returns undefined harmlessly before any real render() has happened", () => {
  const overlay = new ProjectOverlay({ service: makePreflightService(), view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  assert.equal(overlay.handleMouse({ type: "click", button: "left", x: 4, y: 4, screenX: 4, screenY: 4, width: 76, height: 1, shift: false, alt: false, ctrl: false }), undefined);
});

// --- Increment 4: non-empty descriptions + quality leader + evidence toggle ---

function makeInc4View(snapshot = {}) {
  const view = new CockpitView({
    actions: {
      onShowPlan() {}, onApprove() {}, onReject() {}, onRequestExecute() {},
      onExecute() {}, onCancel() {}, onRefresh() {}, onQuit() {}
    },
    requestRender: () => {}
  });
  view.setSnapshot(snapshot);
  return view;
}

test("INC4: RESULT row with reason:null + decisionType:leader shows a non-empty role-specific description", async () => {
  const projectTeam = [{
    role: "Builder",
    model: { candidateKey: "codex::gpt-6-astra", adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra", accessMode: "automatic" },
    fallback: null,
    reason: null,
    assignmentSource: "recommended",
    decisionEvidence: { decisionType: "leader", requiredFloor: 0.8, riskLevel: "medium", retention: 1 },
    recommendedAssignment: { model: { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra" }, fallback: null, decisionEvidence: { decisionType: "leader" }, reason: null },
    overrideEvidence: null
  }];
  const service = makePreflightService();
  const originalRun = service.runBootstrapAnalysis.bind(service);
  service.runBootstrapAnalysis = async (args) => {
    const strategy = await originalRun(args);
    strategy.projectTeam = projectTeam;
    strategy.qualityTeam = [{ role: "Builder", model: { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra" }, reason: null }];
    return strategy;
  };
  const overlay = new ProjectOverlay({ service, view: makeInc4View(), cwd: "/repo", onClose: () => {} });
  await flush();
  selectByKey(overlay, QUALITY_MODEL.candidateKey);
  overlay.handleInput(ENTER);
  await flush();
  const description = explainTeamDecision(projectTeam[0]);
  assert.ok(description.trim().length > 0);
  assert.match(description, /Ranked first for coding capability/);
  const lines = overlay.render(76).join("\n");
  // SelectList descriptions are width-clipped in the modal — match the
  // distinctive prefix that still proves explainTeamDecision was wired in.
  assert.match(lines, /Ranked first for coding/);
});

test("INC4: when pick differs from quality leader, overlay names the leader and real retention%", async () => {
  const qualityModel = { adapterId: "claude", modelId: "claude-fable-5-1", displayName: "Fable 5.1" };
  const operationalModel = { candidateKey: "codex::gpt-6-astra", adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra", accessMode: "automatic" };
  const projectTeam = [{
    role: "Builder",
    model: operationalModel,
    fallback: null,
    reason: "Retains ~93% of QUALITY's real capability — chosen for lower real price.",
    assignmentSource: "recommended",
    decisionEvidence: { decisionType: "pareto", retention: 0.93, requiredFloor: 0.8, riskLevel: "medium", coverage: {}, confidence: "medium", isProvisional: false, savings: null },
    recommendedAssignment: { model: operationalModel, fallback: null, decisionEvidence: { decisionType: "pareto", retention: 0.93 }, reason: "Retains ~93% of QUALITY's real capability — chosen for lower real price." },
    overrideEvidence: null
  }];
  const service = makePreflightService();
  const originalRun = service.runBootstrapAnalysis.bind(service);
  service.runBootstrapAnalysis = async (args) => {
    const strategy = await originalRun(args);
    strategy.projectTeam = projectTeam;
    strategy.qualityTeam = [{ role: "Builder", model: qualityModel, reason: null }];
    return strategy;
  };
  const view = makeInc4View({
    modelIntelligence: { status: "live", eligibility: { claude: { ok: true }, codex: { ok: true } }, claudeEntitlement: {} }
  });
  const overlay = new ProjectOverlay({ service, view, cwd: "/repo", onClose: () => {} });
  await flush();
  selectByKey(overlay, QUALITY_MODEL.candidateKey);
  overlay.handleInput(ENTER);
  await flush();
  overlay.handleInput("e");
  const lines = overlay.render(76).join("\n");
  assert.match(lines, /Quality leader: Fable 5\.1/);
  assert.match(lines, /retains 93%/);
  assert.match(lines, /Operational picks: the efficient model among eligible candidates/);
});

test("INC4: unverified projectTeam entry shows its availability warning in evidence", async () => {
  const model = { candidateKey: "claude::claude-fable-5-1", adapterId: "claude", modelId: "claude-fable-5-1", displayName: "Fable 5.1", accessMode: "automatic" };
  const projectTeam = [{
    role: "Builder", model, fallback: null, reason: null, assignmentSource: "recommended",
    decisionEvidence: { decisionType: "leader", requiredFloor: 0.8, riskLevel: "medium", retention: 1 },
    recommendedAssignment: { model, fallback: null, decisionEvidence: { decisionType: "leader" }, reason: null },
    overrideEvidence: null
  }];
  const service = makePreflightService();
  const originalRun = service.runBootstrapAnalysis.bind(service);
  service.runBootstrapAnalysis = async (args) => {
    const strategy = await originalRun(args);
    strategy.projectTeam = projectTeam;
    strategy.qualityTeam = [{ role: "Builder", model, reason: null }];
    return strategy;
  };
  const view = makeInc4View({
    modelIntelligence: {
      status: "live",
      eligibility: { claude: { ok: true } },
      claudeEntitlement: { "claude-fable-5-1": { status: "unverified", reason: null } }
    }
  });
  const overlay = new ProjectOverlay({ service, view, cwd: "/repo", onClose: () => {} });
  await flush();
  selectByKey(overlay, QUALITY_MODEL.candidateKey);
  overlay.handleInput(ENTER);
  await flush();
  overlay.handleInput("e");
  const lines = overlay.render(76).join("\n");
  // Modal width wraps the warning across lines — match the distinctive parts.
  assert.match(lines, /model entitlement not verified/);
  assert.match(lines, /verify-access/);
});

test("INC4: legacy strategy without qualityTeam does not break RESULT evidence toggle", async () => {
  const model = { candidateKey: "codex::gpt-6-astra", adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra", accessMode: "automatic" };
  const projectTeam = [{
    role: "Architect", model, fallback: null, reason: null, assignmentSource: "recommended",
    decisionEvidence: { decisionType: "leader", requiredFloor: null, riskLevel: null },
    recommendedAssignment: { model, fallback: null, decisionEvidence: { decisionType: "leader" }, reason: null },
    overrideEvidence: null
  }];
  const service = makePreflightService();
  const originalRun = service.runBootstrapAnalysis.bind(service);
  service.runBootstrapAnalysis = async (args) => {
    const strategy = await originalRun(args);
    strategy.projectTeam = projectTeam;
    delete strategy.qualityTeam;
    return strategy;
  };
  const overlay = new ProjectOverlay({ service, view: makeInc4View(), cwd: "/repo", onClose: () => {} });
  await flush();
  selectByKey(overlay, QUALITY_MODEL.candidateKey);
  overlay.handleInput(ENTER);
  await flush();
  assert.doesNotThrow(() => overlay.handleInput("e"));
  const lines = overlay.render(76).join("\n");
  assert.match(lines, /Architect/);
  assert.doesNotMatch(lines, /Quality leader/);
});

// --- Scope 4: PROJECT TEAM readable detail — compact rows (role + model
// only) plus a full, readable detail block for whichever assignment is
// currently selected, reusing resolveAssignmentAvailability() and
// explainTeamDecision() (no second availability/explanation formula).

test("REGRESSION: RESULT rows are role + model only — no inline description, no provider", async () => {
  const service = makePreflightService();
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  await flush();
  selectByKey(overlay, QUALITY_MODEL.candidateKey);
  overlay.handleInput(ENTER);
  await flush();
  const rowLines = overlay.resultSelectList.render(60).join("\n");
  assert.match(rowLines, /Explorer/);
  assert.match(rowLines, /GPT-6 Astra/);
  assert.doesNotMatch(rowLines, /Codex/i, "the compact row must not show the provider — it belongs in the detail block below");
  assert.doesNotMatch(rowLines, /Real capability leader/, "the compact row must not show the inline WHY description — it belongs in the detail block below");
});

test("REGRESSION: available, blocked, and overridden rows are all strictly role + model — override and reanalysis status live only in the detail block", async () => {
  const available = { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra" };
  const blockedFable = { adapterId: "claude", modelId: "claude-fable-5-1", displayName: "Claude Fable 5.1" };
  const overridden = { adapterId: "claude", modelId: "claude-opus-5", displayName: "Claude Opus 5" };
  const suggested = {
    status: "suggested", bootstrapAnalystChoice: "quality", bootstrapAnalystSelectionSource: "recommended",
    bootstrapAnalyst: available, qualityTeam: [], efficientTeam: [],
    projectTeam: [
      { role: "Architect", model: available, fallback: null, reason: "Ranked first.", assignmentSource: "recommended" },
      { role: "Builder", model: blockedFable, fallback: null, reason: "Ranked first.", assignmentSource: "recommended" },
      { role: "Debugger", model: overridden, fallback: null, reason: null, assignmentSource: "override" }
    ]
  };
  const view = makeFakeView({
    projectStrategy: suggested,
    modelIntelligence: {
      eligibility: { codex: { ok: true }, claude: { ok: true } },
      claudeEntitlement: { "claude-fable-5-1": { status: "unverified", reason: null } }
    }
  });
  const overlay = new ProjectOverlay({ service: makePreflightService(), view, cwd: "/repo", onClose: () => {} });
  await flush();
  assert.equal(overlay.state, S.RESULT);

  const rowLines = overlay.resultSelectList.render(76).join("\n");
  assert.match(rowLines, /Architect\s+GPT-6 Astra/);
  assert.match(rowLines, /Builder\s+Claude Fable 5\.1/);
  assert.match(rowLines, /Debugger\s+Claude Opus 5/);
  assert.doesNotMatch(rowLines, /override/i, "no row may show an override marker — that belongs in the detail block");
  assert.doesNotMatch(rowLines, /needs reanalysis/i, "no row may show a reanalysis marker — that belongs in the detail block");

  overlay.resultSelectList.setSelectedIndex(1);
  assert.match(joinPlain(overlay.render(76)), /needs reanalysis/, "the blocked role's own detail block must still show the real marker");

  overlay.resultSelectList.setSelectedIndex(2);
  assert.match(joinPlain(overlay.render(76)), /Debugger \(override\)/, "the overridden role's own detail block must still show the real override note");
});

test("the first role is selected by default and shows a full readable detail block below the compact list", async () => {
  const service = makePreflightService();
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  await flush();
  selectByKey(overlay, QUALITY_MODEL.candidateKey);
  overlay.handleInput(ENTER);
  await flush();
  const lines = joinPlain(overlay.render(76));
  assert.match(lines, /Model: GPT-6 Astra/);
  assert.match(lines, /Via: Codex/);
  assert.match(lines, /Access: Available/);
  assert.match(lines, /Why: Real capability leader for this role\./);
});

test("REGRESSION: moving the RESULT selection (the same selectedIndex both arrow keys and mouse clicks drive) updates the readable detail block below", async () => {
  const team = ["Explorer", "Architect"].map((role, i) => ({
    role, model: { adapterId: "codex", modelId: `model-${i}`, displayName: `Model ${role}` },
    fallback: null, reason: `${role}-specific reason.`, assignmentSource: "recommended"
  }));
  const suggested = {
    status: "suggested", bootstrapAnalystChoice: "quality", bootstrapAnalystSelectionSource: "recommended",
    bootstrapAnalyst: { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra" },
    qualityTeam: [], efficientTeam: [], projectTeam: team
  };
  const overlay = new ProjectOverlay({ service: makePreflightService(), view: makeFakeView({ projectStrategy: suggested }), cwd: "/repo", onClose: () => {} });
  await flush();
  assert.equal(overlay.state, S.RESULT);

  let lines = overlay.render(76).join("\n");
  assert.match(lines, /Explorer-specific reason\./, "the first role is selected by default");
  assert.doesNotMatch(lines, /Architect-specific reason\./);

  overlay.resultSelectList.setSelectedIndex(1);
  lines = overlay.render(76).join("\n");
  assert.match(lines, /Architect-specific reason\./, "moving the selection must swap the detail block to the newly selected role");
  assert.doesNotMatch(lines, /Explorer-specific reason\./);
});

test("REGRESSION: the detail block shows the real Access text for an exhausted Cursor pool, an unverified Claude model, and an available model — never one coarse status", async () => {
  const cursorFable = { adapterId: "cursor", modelId: "fable", displayName: "Fable" };
  const claudeFable = { adapterId: "claude", modelId: "claude-fable-5-1", displayName: "Claude Fable 5.1" };
  const codexAstra = { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra" };
  const suggested = {
    status: "suggested", bootstrapAnalystChoice: "quality", bootstrapAnalystSelectionSource: "recommended",
    bootstrapAnalyst: codexAstra, qualityTeam: [], efficientTeam: [],
    projectTeam: [
      { role: "Architect", model: codexAstra, fallback: null, reason: "Ranked first.", assignmentSource: "recommended" },
      { role: "Builder", model: cursorFable, fallback: null, reason: "Ranked first.", assignmentSource: "recommended" },
      { role: "Debugger", model: claudeFable, fallback: null, reason: "Ranked first.", assignmentSource: "recommended" }
    ]
  };
  const view = makeFakeView({
    projectStrategy: suggested,
    modelIntelligence: {
      eligibility: { codex: { ok: true }, cursor: { ok: true }, claude: { ok: true } },
      claudeEntitlement: { "claude-fable-5-1": { status: "unverified", reason: null } },
      cursorAccess: { other_models: { status: "exhausted", reason: "monthly limit" } }
    }
  });
  const overlay = new ProjectOverlay({ service: makePreflightService(), view, cwd: "/repo", onClose: () => {} });
  await flush();
  assert.equal(overlay.state, S.RESULT);

  overlay.resultSelectList.setSelectedIndex(0);
  assert.match(joinPlain(overlay.render(100)), /Access: Available/, "Architect's real Codex assignment must show as Available");

  overlay.resultSelectList.setSelectedIndex(1);
  assert.match(joinPlain(overlay.render(100)), /Cursor Other Models quota exhausted/, "Builder's exhausted Cursor pool must show its own real reason");

  overlay.resultSelectList.setSelectedIndex(2);
  assert.match(joinPlain(overlay.render(100)), /model entitlement not verified/, "Debugger's unverified Claude model must show the real entitlement warning");
});

test("REGRESSION: Analyst and Orchestrator render as full context assignments but are never reachable through the editable PROJECT TEAM list", async () => {
  const suggested = {
    status: "suggested", bootstrapAnalystChoice: "quality", bootstrapAnalystSelectionSource: "recommended",
    bootstrapAnalyst: { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra" },
    orchestrator: { adapterId: "claude", modelId: "claude-opus-5", displayName: "Claude Opus 5" },
    qualityTeam: [], efficientTeam: [],
    projectTeam: [{
      role: "Explorer", model: { adapterId: "codex", modelId: "gpt-6-experimental", displayName: "GPT-6 Experimental" },
      fallback: null, reason: "Real reason.", assignmentSource: "recommended"
    }]
  };
  const overlay = new ProjectOverlay({ service: makePreflightService(), view: makeFakeView({ projectStrategy: suggested }), cwd: "/repo", onClose: () => {} });
  await flush();
  assert.equal(overlay.state, S.RESULT);

  const lines = overlay.render(76).join("\n");
  assert.match(lines, /Project Analyst/);
  assert.match(lines, /Orchestrator/);
  assert.match(lines, /GPT-6 Astra/);
  assert.match(lines, /Claude Opus 5/);

  const rowLines = overlay.resultSelectList.render(60).join("\n");
  assert.doesNotMatch(rowLines, /Claude Opus 5/, "Orchestrator's own model must never appear as a selectable/editable row");
});

test("REGRESSION: a long WHY reason wraps across multiple lines instead of being truncated", async () => {
  const longReason = "Ranked first for general reasoning capability among eligible candidates — nothing cheaper or faster displaced it at the 92% capability floor for this genuinely high-risk, safety-critical role, and no real alternative came close on real benchmark evidence.";
  const suggested = {
    status: "suggested", bootstrapAnalystChoice: "quality", bootstrapAnalystSelectionSource: "recommended",
    bootstrapAnalyst: { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra" },
    qualityTeam: [], efficientTeam: [],
    projectTeam: [{
      role: "Explorer", model: { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra" },
      fallback: null, reason: longReason, assignmentSource: "recommended"
    }]
  };
  const overlay = new ProjectOverlay({ service: makePreflightService(), view: makeFakeView({ projectStrategy: suggested }), cwd: "/repo", onClose: () => {} });
  await flush();
  const joined = joinPlain(overlay.render(76));
  assert.ok(joined.includes(longReason.replace(/\s+/g, " ")), "the full real reason must survive wrapping, word for word, never truncated");
  assert.doesNotMatch(joined, /…/, "wrapping must never fall back to an ellipsis truncation");
});

test("REGRESSION: a narrow RESULT render still keeps its border, footer, and real content", async () => {
  const service = makePreflightService();
  const overlay = new ProjectOverlay({ service, view: makeFakeView(), cwd: "/repo", onClose: () => {} });
  await flush();
  selectByKey(overlay, QUALITY_MODEL.candidateKey);
  overlay.handleInput(ENTER);
  await flush();
  const lines = overlay.render(20);
  assert.match(lines[0], /╭/);
  assert.match(lines.at(-1), /╯/);
  const joined = joinPlain(lines);
  assert.match(joined, /PROJECT TEAM/);
  assert.match(joined, /Enter edit role/);
});
