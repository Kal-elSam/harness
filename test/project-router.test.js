import test from "node:test";
import assert from "node:assert/strict";
import { resolveProjectRoute, PROJECT_ROUTE_DECISION } from "../src/global/team/project-router.js";

function claudeModel(overrides = {}) {
  return { candidateKey: "claude::builder-model", adapterId: "claude", modelId: "builder-model", displayName: "Builder Model", accessMode: "automatic", ...overrides };
}

function cursorModel(overrides = {}) {
  return { candidateKey: "cursor::claude-fable-5-1", adapterId: "cursor", modelId: "claude-fable-5-1", displayName: "Fable 5.1", accessMode: "automatic", ...overrides };
}

function activeStrategy(projectTeam) {
  return { status: "active", profileFingerprint: "fp-1", projectTeam };
}

function quotaRouteFixture() {
  const models = ["claude", "codex"].map(adapterId => ({
    adapterId, modelId: `${adapterId}-qualified`, accessMode: "automatic",
    intelligenceIndex: 50, codingIndex: 90, gpqa: .8, hle: .7,
    priceInputPerMTok: 1, priceOutputPerMTok: 1
  }));
  const references = Array.from({ length: 4 }, (_, index) => ({
    ...models[0], modelId: `reference-${index}`, intelligenceIndex: 10 + index, codingIndex: 10 + index
  }));
  return {
    models: [...models, ...references],
    eligibility: { claude: { ok: true }, codex: { ok: true } },
    providerCapacity: { claude: {}, codex: { quotaRemainingPercent: 80, quotaPaceFactor: 1 } }
  };
}

test("unknown Claude quota keeps every approved Claude role despite healthy Codex quota", () => {
  const inputs = quotaRouteFixture();
  const roles = ["Technical Lead", "Explorer", "Execution Coordinator", "Builder", "Documenter", "Test Repro Runner", "Deliverer"];
  const model = inputs.models[0];
  const reviewRoles = ["Quality Lead", "Reviewer", "Security Reviewer"];
  const teams = [
    roles.map(role => ({ role, model, assignmentSource: "recommended" })),
    [{ role: "Builder", model: inputs.models[1], assignmentSource: "recommended" },
      ...reviewRoles.map(role => ({ role, model, assignmentSource: "recommended" }))]
  ];
  const roleCapabilities = Object.fromEntries([...roles, ...reviewRoles].map(role => [role, { required: ["reasoning"] }]));
  for (const team of teams) for (const { role } of team.filter(entry => entry.model.adapterId === "claude")) {
    const strategy = activeStrategy(team);
    const route = resolveProjectRoute({ ...inputs, role, strategy, roleCapabilities });
    assert.equal(route.decision, PROJECT_ROUTE_DECISION.ROUTED, role);
    assert.equal(route.provider, "claude", role);
    assert.deepEqual(route.model, model, role);
    assert.equal(route.assignmentSource, "recommended", role);
    assert.ok(!route.rerouted, role);
  }
});

test("known exhausted Claude quota still reroutes to qualified healthy Codex", () => {
  const inputs = quotaRouteFixture();
  inputs.providerCapacity.claude = { quotaRemainingPercent: 0, quotaPaceFactor: 0 };
  const model = inputs.models[0];
  const route = resolveProjectRoute({
    ...inputs, role: "Technical Lead",
    strategy: activeStrategy([{ role: "Technical Lead", model, assignmentSource: "recommended" }]),
    roleCapabilities: { "Technical Lead": { required: ["reasoning"] } }
  });
  assert.equal(route.decision, PROJECT_ROUTE_DECISION.ROUTED);
  assert.equal(route.provider, "codex");
  assert.deepEqual(route.model, inputs.models[1]);
  assert.equal(route.assignmentSource, "quota-reroute");
  assert.equal(route.rerouted, true);
  assert.deepEqual(route.reroutedFrom, model);
  assert.deepEqual(route.reroutedTo, inputs.models[1]);
});

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

test("Cursor assigned to a role is ROUTED, not a manual handoff — Cursor's own execution adapter makes it a real automatic candidate now", () => {
  const model = { candidateKey: "cursor::sol", adapterId: "cursor", modelId: "sol", displayName: "GPT-5.6 Sol", accessMode: "automatic" };
  const strategy = activeStrategy([{ role: "Builder", model, assignmentSource: "recommended" }]);
  const route = resolveProjectRoute({ role: "Builder", strategy, eligibility: { cursor: { ok: true } } });
  assert.equal(route.decision, PROJECT_ROUTE_DECISION.ROUTED);
  assert.equal(route.provider, "cursor");
  assert.equal(route.model.displayName, "GPT-5.6 Sol");
});

test("OpenCode Go assigned to a role is also MANUAL_HANDOFF (launchable:false today)", () => {
  const model = { candidateKey: "opencode-go::glm", adapterId: "opencode-go", modelId: "glm-5-3", displayName: "GLM-5.3", accessMode: "manual" };
  const strategy = activeStrategy([{ role: "Test Runner", model, assignmentSource: "recommended" }]);
  const route = resolveProjectRoute({ role: "Test Runner", strategy, eligibility: { "opencode-go": { ok: true } } });
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
  assert.equal(route.provider, null, "the top-level provider/model fields stay null — the blocked assignment moves to its own field");
  assert.equal(route.model, null);
  assert.equal(route.blockedAssignment.provider, "claude", "the real blocked assignment must still be named");
  assert.equal(route.blockedAssignment.model.modelId, "builder-model");
  assert.match(route.why, /not currently eligible/);
  assert.match(route.why, /quota nearly exhausted/);
});

test("an availability block with a real, currently-eligible persisted fallback routes to it automatically, naming what it replaced", () => {
  const codexFallback = { candidateKey: "codex::astra", adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra", accessMode: "automatic" };
  const strategy = activeStrategy([{ role: "Builder", model: claudeModel(), fallback: codexFallback, assignmentSource: "recommended" }]);
  const route = resolveProjectRoute({
    role: "Builder", strategy,
    eligibility: { claude: { ok: false, reason: "Claude Current session window is limited (1% left)" }, codex: { ok: true } }
  });
  assert.equal(route.decision, PROJECT_ROUTE_DECISION.ROUTED);
  assert.equal(route.provider, "codex");
  assert.deepEqual(route.model, codexFallback);
  assert.equal(route.assignmentSource, "availability-fallback");
  assert.equal(route.blockedAssignment.provider, "claude", "the replaced assignment stays visible");
  assert.equal(route.blockedAssignment.model.modelId, "builder-model");
  assert.equal(route.suggestedAlternative, null, "nothing left to confirm");
  assert.match(route.why, /temporarily unavailable/);
  assert.match(route.why, /window is limited/);
  assert.match(route.why, /GPT-6 Astra/);
  assert.match(route.why, /until the team is recovered/);
});

test("an entitlement block routes an entitled qualified fallback before waiting", () => {
  const codexFallback = { candidateKey: "codex::astra", adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra", accessMode: "automatic" };
  const strategy = activeStrategy([{ role: "Builder", model: claudeModel(), fallback: codexFallback, assignmentSource: "recommended" }]);
  const route = resolveProjectRoute({
    role: "Builder", strategy,
    eligibility: { claude: { ok: true }, codex: { ok: true } },
    modelEntitlement: { claude: { "builder-model": { status: "unverified", reason: "probe timed out" } } }
  });
  // S1/S6: a rejected entitlement cannot force WAIT while an entitled fallback exists.
  assert.equal(route.decision, PROJECT_ROUTE_DECISION.ROUTED);
  assert.deepEqual(route.model, codexFallback);
  assert.equal(route.suggestedAlternative, null);
  assert.match(route.why, /not currently entitled.*probe timed out/);
});

test("a human override whose provider is unavailable keeps waiting — overrides carry no fallback, so nothing replaces the human's pick", () => {
  const strategy = activeStrategy([{ role: "Builder", model: claudeModel({ modelId: "human-chosen" }), fallback: null, assignmentSource: "override" }]);
  const route = resolveProjectRoute({ role: "Builder", strategy, eligibility: { claude: { ok: false, reason: "quota" }, codex: { ok: true } } });
  assert.equal(route.decision, PROJECT_ROUTE_DECISION.WAIT_FOR_PROJECT_TEAM);
  assert.equal(route.blockedAssignment.assignmentSource, "override");
});

test("a persisted fallback that is itself currently ineligible is never suggested — no fabricated alternative", () => {
  const codexFallback = { candidateKey: "codex::astra", adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra", accessMode: "automatic" };
  const strategy = activeStrategy([{ role: "Builder", model: claudeModel(), fallback: codexFallback, assignmentSource: "recommended" }]);
  const route = resolveProjectRoute({
    role: "Builder", strategy,
    eligibility: { claude: { ok: false, reason: "quota" }, codex: { ok: false, reason: "also unavailable" } }
  });
  assert.equal(route.suggestedAlternative, null);
});

test("a persisted fallback assigned to a manual-only provider (OpenCode Go) is never suggested as an automatic alternative", () => {
  const goFallback = { candidateKey: "opencode-go::glm", adapterId: "opencode-go", modelId: "glm-5-3", displayName: "GLM-5.3", accessMode: "manual" };
  const strategy = activeStrategy([{ role: "Builder", model: claudeModel(), fallback: goFallback, assignmentSource: "recommended" }]);
  const route = resolveProjectRoute({ role: "Builder", strategy, eligibility: { claude: { ok: false, reason: "quota" }, "opencode-go": { ok: true } } });
  assert.equal(route.suggestedAlternative, null, "a manual-only fallback would just trade one blocked automatic run for another — never suggested as if it were automatic");
});

test("no persisted fallback at all means an honest null suggestedAlternative, never invented", () => {
  const strategy = activeStrategy([{ role: "Builder", model: claudeModel(), fallback: null, assignmentSource: "recommended" }]);
  const route = resolveProjectRoute({ role: "Builder", strategy, eligibility: { claude: { ok: false, reason: "quota" } } });
  assert.equal(route.suggestedAlternative, null);
});

test("a normal ROUTED result and MANUAL_HANDOFF never carry a blockedAssignment or suggestedAlternative — those only apply to a block or an availability substitution", () => {
  const routed = resolveProjectRoute({ role: "Builder", strategy: activeStrategy([{ role: "Builder", model: claudeModel(), assignmentSource: "recommended" }]), eligibility: { claude: { ok: true } } });
  assert.equal(routed.blockedAssignment, null);
  assert.equal(routed.suggestedAlternative, null);

  const goModel = { candidateKey: "opencode-go::glm", adapterId: "opencode-go", modelId: "glm-5-3", displayName: "GLM-5.3", accessMode: "manual" };
  const manual = resolveProjectRoute({ role: "Builder", strategy: activeStrategy([{ role: "Builder", model: goModel, assignmentSource: "recommended" }]), eligibility: { "opencode-go": { ok: true } } });
  assert.equal(manual.blockedAssignment, null);
  assert.equal(manual.suggestedAlternative, null);
});

test("REGRESSION: routing depends on the real model.accessMode, never a hardcoded adapterId list — a manual-mode Claude/Codex model is MANUAL_HANDOFF too", () => {
  const model = claudeModel({ accessMode: "manual" });
  const strategy = activeStrategy([{ role: "Builder", model, assignmentSource: "recommended" }]);
  const route = resolveProjectRoute({ role: "Builder", strategy, eligibility: { claude: { ok: true } } });
  assert.equal(route.decision, PROJECT_ROUTE_DECISION.MANUAL_HANDOFF, "accessMode says manual, so this must be a handoff even though claude isn't in any hardcoded manual-only list");
});

test("REGRESSION: an opencode-go model with a real accessMode of 'automatic' would be ROUTED, not MANUAL_HANDOFF — proving the check reads accessMode, not the adapter's name", () => {
  const model = { candidateKey: "opencode-go::glm", adapterId: "opencode-go", modelId: "glm-5-3", displayName: "GLM-5.3", accessMode: "automatic" };
  const strategy = activeStrategy([{ role: "Test Runner", model, assignmentSource: "recommended" }]);
  const route = resolveProjectRoute({ role: "Test Runner", strategy, eligibility: { "opencode-go": { ok: true } } });
  assert.equal(route.decision, PROJECT_ROUTE_DECISION.ROUTED, "once resolveAccessMode ever marks opencode-go automatic, the router must pick that up with no code change here");
});

test("REGRESSION: with no real automatic alternative available, the why message says so honestly instead of promising a confirmation step that doesn't exist", () => {
  const strategy = activeStrategy([{ role: "Builder", model: claudeModel(), fallback: null, assignmentSource: "recommended" }]);
  const route = resolveProjectRoute({ role: "Builder", strategy, eligibility: { claude: { ok: false, reason: "quota" } } });
  assert.equal(route.suggestedAlternative, null);
  assert.match(route.why, /no automatic alternative is available/);
  assert.doesNotMatch(route.why, /confirm the suggested alternative/, "must never promise a confirmation step when there is nothing to confirm");
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

test("REGRESSION: resolveProjectRoute blocks ACTIVE strategy when live modelEntitlement says denied, naming the real CLI reason", () => {
  const strategy = activeStrategy([{ role: "Builder", model: claudeModel({ modelId: "claude-fable-5-1", displayName: "Claude Fable 5.1" }), assignmentSource: "recommended" }]);
  const route = resolveProjectRoute({
    role: "Builder",
    strategy,
    eligibility: { claude: { ok: true } },
    modelEntitlement: {
      claude: {
        "claude-fable-5-1": {
          status: "denied",
          reason: "Credits required to use this model — upgrade your plan"
        }
      }
    }
  });
  assert.equal(route.decision, PROJECT_ROUTE_DECISION.WAIT_FOR_PROJECT_TEAM);
  assert.equal(route.blockedAssignment.model.modelId, "claude-fable-5-1");
  assert.match(route.why, /Credits required to use this model/);
  assert.match(route.why, /not currently entitled/);
});

test("REGRESSION: resolveProjectRoute also blocks when live modelEntitlement says unverified, even if provider eligibility is ok", () => {
  const strategy = activeStrategy([{ role: "Builder", model: claudeModel(), assignmentSource: "recommended" }]);
  const route = resolveProjectRoute({
    role: "Builder",
    strategy,
    eligibility: { claude: { ok: true } },
    modelEntitlement: { claude: { "builder-model": { status: "unverified", reason: null } } }
  });
  assert.equal(route.decision, PROJECT_ROUTE_DECISION.WAIT_FOR_PROJECT_TEAM);
  assert.match(route.why, /not currently entitled/);
});

test("REGRESSION: resolveProjectRoute blocks a real, active Cursor (Fable-via-Cursor) assignment when the real per-pool probe projects it as denied — the exact same generic modelEntitlement gate Claude already used, now also fed by Cursor's real access", () => {
  const strategy = activeStrategy([{ role: "Builder", model: cursorModel(), assignmentSource: "recommended" }]);
  const route = resolveProjectRoute({
    role: "Builder",
    strategy,
    eligibility: { cursor: { ok: true } },
    // The exact real projection service.js builds from a real Cursor pool
    // probe (cursorStatusToEntitlement: EXHAUSTED -> DENIED).
    modelEntitlement: { cursor: { "claude-fable-5-1": { status: "denied", reason: "Other Models quota exhausted" } } }
  });
  assert.equal(route.decision, PROJECT_ROUTE_DECISION.WAIT_FOR_PROJECT_TEAM);
  assert.equal(route.blockedAssignment.model.modelId, "claude-fable-5-1");
  assert.match(route.why, /Other Models quota exhausted/);
});

test("empty modelEntitlement {} does not gate — keeps pre-entitlement callers green", () => {
  const strategy = activeStrategy([{ role: "Builder", model: claudeModel(), assignmentSource: "recommended" }]);
  const route = resolveProjectRoute({
    role: "Builder", strategy, eligibility: { claude: { ok: true } }, modelEntitlement: {}
  });
  assert.equal(route.decision, PROJECT_ROUTE_DECISION.ROUTED);
});

test("REGRESSION: a Claude model and a Cursor-proxied model sharing the same raw modelId never collide — each adapter's entitlement is independent", () => {
  // Cursor can proxy a model under the exact same id string Claude itself
  // uses (e.g. "claude-fable-5-1"). A flat modelId -> entitlement map would
  // let one adapter's entry silently overwrite the other's.
  const strategy = activeStrategy([{ role: "Builder", model: claudeModel({ modelId: "claude-fable-5-1", displayName: "Claude Fable 5.1" }), assignmentSource: "recommended" }]);
  const route = resolveProjectRoute({
    role: "Builder",
    strategy,
    eligibility: { claude: { ok: true } },
    modelEntitlement: {
      claude: { "claude-fable-5-1": { status: "allowed", reason: null } },
      cursor: { "claude-fable-5-1": { status: "denied", reason: "Other Models quota exhausted" } }
    }
  });
  assert.equal(route.decision, PROJECT_ROUTE_DECISION.ROUTED, "Cursor's denied entry for the same raw modelId must never block the real Claude assignment");
});

test("entitlement replacement requires fallback entitlement allowed/not_applicable (or missing key)", () => {
  const codexFallback = { candidateKey: "codex::astra", adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra", accessMode: "automatic" };
  const deniedClaudeFallback = claudeModel({ modelId: "claude-haiku-4-5", displayName: "Haiku" });
  const strategyDeniedFallback = activeStrategy([{
    role: "Builder",
    model: claudeModel({ modelId: "claude-fable-5-1", displayName: "Fable" }),
    fallback: deniedClaudeFallback,
    assignmentSource: "recommended"
  }]);
  const blockedFallback = resolveProjectRoute({
    role: "Builder",
    strategy: strategyDeniedFallback,
    eligibility: { claude: { ok: true } },
    modelEntitlement: {
      claude: {
        "claude-fable-5-1": { status: "denied", reason: "Credits required" },
        "claude-haiku-4-5": { status: "denied", reason: "also denied" }
      }
    }
  });
  assert.equal(blockedFallback.suggestedAlternative, null);

  const strategyCodexFallback = activeStrategy([{
    role: "Builder",
    model: claudeModel({ modelId: "claude-fable-5-1", displayName: "Fable" }),
    fallback: codexFallback,
    assignmentSource: "recommended"
  }]);
  const withCodex = resolveProjectRoute({
    role: "Builder",
    strategy: strategyCodexFallback,
    eligibility: { claude: { ok: true }, codex: { ok: true } },
    modelEntitlement: {
      claude: { "claude-fable-5-1": { status: "denied", reason: "Credits required" } }
    }
  });
  // S1: an entitled cross-provider alternative executes instead of an avoidable WAIT.
  assert.equal(withCodex.decision, PROJECT_ROUTE_DECISION.ROUTED);
  assert.equal(withCodex.model.modelId, "gpt-6-astra");
});

test("S4 legacy-keyed roleCapabilities passed to the router are normalized without mutating the caller", () => {
  const roleCapabilities = { Architect: { required: ["reasoning"] } };
  const snapshot = JSON.stringify(roleCapabilities);
  const strategy = activeStrategy([{ role: "Technical Lead", model: claudeModel(), assignmentSource: "recommended" }]);
  const route = resolveProjectRoute({ role: "Architect", strategy, roleCapabilities, eligibility: { claude: { ok: true } } });
  assert.equal(route.role, "Technical Lead");
  assert.equal(route.decision, PROJECT_ROUTE_DECISION.ROUTED);
  assert.equal(JSON.stringify(roleCapabilities), snapshot);
});
