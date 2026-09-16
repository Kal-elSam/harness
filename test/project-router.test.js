import test from "node:test";
import assert from "node:assert/strict";
import { resolveProjectRoute, PROJECT_ROUTE_DECISION } from "../src/global/conversation/project-router.js";

function claudeModel(overrides = {}) {
  return { candidateKey: "claude::builder-model", adapterId: "claude", modelId: "builder-model", displayName: "Builder Model", accessMode: "subscription", ...overrides };
}

function activeStrategy(projectTeam) {
  return { status: "active", profileFingerprint: "fp-1", projectTeam };
}

test("no strategy at all -> WAIT_FOR_PROJECT_TEAM, honest about why", () => {
  const route = resolveProjectRoute({ role: "Builder", strategy: null });
  assert.equal(route.decision, PROJECT_ROUTE_DECISION.WAIT_FOR_PROJECT_TEAM);
  assert.equal(route.provider, null);
  assert.equal(route.model, null);
  assert.match(route.why, /No project strategy exists yet/);
});

test("a SUGGESTED (not yet approved) strategy blocks execution", () => {
  const route = resolveProjectRoute({
    role: "Builder", strategy: { status: "suggested", profileFingerprint: "fp-1", projectTeam: [{ role: "Builder", model: claudeModel(), assignmentSource: "recommended" }] }
  });
  assert.equal(route.decision, PROJECT_ROUTE_DECISION.WAIT_FOR_PROJECT_TEAM);
  assert.match(route.why, /SUGGESTED, not ACTIVE/);
});

test("a STALE strategy blocks execution", () => {
  const route = resolveProjectRoute({
    role: "Builder", strategy: { status: "stale", profileFingerprint: "fp-1", projectTeam: [{ role: "Builder", model: claudeModel(), assignmentSource: "recommended" }] }
  });
  assert.equal(route.decision, PROJECT_ROUTE_DECISION.WAIT_FOR_PROJECT_TEAM);
  assert.match(route.why, /STALE, not ACTIVE/);
});

test("a legacy ACTIVE strategy with no projectTeam field blocks execution — no silent migration", () => {
  const route = resolveProjectRoute({ role: "Builder", strategy: { status: "active", profileFingerprint: "fp-1", qualityTeam: [] } });
  assert.equal(route.decision, PROJECT_ROUTE_DECISION.WAIT_FOR_PROJECT_TEAM);
  assert.match(route.why, /before projectTeam existed/);
});

test("a role with no real projectTeam entry blocks execution", () => {
  const strategy = activeStrategy([{ role: "Explorer", model: claudeModel(), assignmentSource: "recommended" }]);
  const route = resolveProjectRoute({ role: "Builder", strategy, eligibility: { claude: { ok: true } } });
  assert.equal(route.decision, PROJECT_ROUTE_DECISION.WAIT_FOR_PROJECT_TEAM);
  assert.match(route.why, /No real eligible model was assigned to Builder/);
});

test("a role whose real entry has a null model (no real candidate ever covered it) blocks execution", () => {
  const strategy = activeStrategy([{ role: "Builder", model: null, assignmentSource: "recommended" }]);
  const route = resolveProjectRoute({ role: "Builder", strategy, eligibility: { claude: { ok: true } } });
  assert.equal(route.decision, PROJECT_ROUTE_DECISION.WAIT_FOR_PROJECT_TEAM);
});

test("Cursor assigned to a role is a real MANUAL_HANDOFF, never a silent fallback or a fake automatic run", () => {
  const model = { candidateKey: "cursor::sol", adapterId: "cursor", modelId: "sol", displayName: "GPT-5.6 Sol", accessMode: "subscription" };
  const strategy = activeStrategy([{ role: "Builder", model, assignmentSource: "recommended" }]);
  const route = resolveProjectRoute({ role: "Builder", strategy, eligibility: { cursor: { ok: true } } });
  assert.equal(route.decision, PROJECT_ROUTE_DECISION.MANUAL_HANDOFF);
  assert.equal(route.provider, "cursor");
  assert.equal(route.model.displayName, "GPT-5.6 Sol");
  assert.match(route.why, /continue manually/);
});

test("OpenCode Go assigned to a role is also MANUAL_HANDOFF (launchable:false today)", () => {
  const model = { candidateKey: "opencode-go::glm", adapterId: "opencode-go", modelId: "glm-5-3", displayName: "GLM-5.3", accessMode: "subscription" };
  const strategy = activeStrategy([{ role: "Tester", model, assignmentSource: "recommended" }]);
  const route = resolveProjectRoute({ role: "Tester", strategy, eligibility: { "opencode-go": { ok: true } } });
  assert.equal(route.decision, PROJECT_ROUTE_DECISION.MANUAL_HANDOFF);
});

test("a real, currently-eligible Claude/Codex assignment is ROUTED", () => {
  const strategy = activeStrategy([{ role: "Builder", model: claudeModel(), assignmentSource: "recommended" }]);
  const route = resolveProjectRoute({ role: "Builder", strategy, eligibility: { claude: { ok: true } } });
  assert.equal(route.decision, PROJECT_ROUTE_DECISION.ROUTED);
  assert.equal(route.provider, "claude");
  assert.equal(route.model.modelId, "builder-model");
  assert.equal(route.assignmentSource, "recommended");
  assert.equal(route.strategyFingerprint, "fp-1");
});

test("lost quota/availability on the assigned provider blocks execution instead of silently substituting another model", () => {
  const strategy = activeStrategy([{ role: "Builder", model: claudeModel(), assignmentSource: "recommended" }]);
  const route = resolveProjectRoute({ role: "Builder", strategy, eligibility: { claude: { ok: false, reason: "Claude quota nearly exhausted (1% left)" } } });
  assert.equal(route.decision, PROJECT_ROUTE_DECISION.WAIT_FOR_PROJECT_TEAM);
  assert.equal(route.provider, "claude", "the real assigned model/provider must still be named, even though it's currently blocked");
  assert.match(route.why, /not currently eligible/);
  assert.match(route.why, /quota nearly exhausted/);
});

test("an override assignmentSource passes through untouched — the router never rewrites who decided the pick", () => {
  const model = claudeModel({ modelId: "human-chosen-model" });
  const strategy = activeStrategy([{ role: "Builder", model, assignmentSource: "override" }]);
  const route = resolveProjectRoute({ role: "Builder", strategy, eligibility: { claude: { ok: true } } });
  assert.equal(route.decision, PROJECT_ROUTE_DECISION.ROUTED);
  assert.equal(route.assignmentSource, "override");
});

test("missing eligibility argument defaults to blocking every provider, never assuming eligibility", () => {
  const strategy = activeStrategy([{ role: "Builder", model: claudeModel(), assignmentSource: "recommended" }]);
  const route = resolveProjectRoute({ role: "Builder", strategy });
  assert.equal(route.decision, PROJECT_ROUTE_DECISION.WAIT_FOR_PROJECT_TEAM);
});
