import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProjectStrategy, computeBootstrapAnalystCatalog, BOOTSTRAP_ANALYST_PROFILE, isStrategyStale,
  computeProjectTeamEditCatalog, applyProjectTeamOverride, resetProjectTeamAssignment
} from "../src/global/conversation/project-strategy.js";
import { scoreAvailableModels } from "../src/global/intelligence/model-intelligence.js";
import { createCapabilityRegistry } from "../src/global/intelligence/model-capability-registry.js";
import { ENTITLEMENT } from "../src/global/observability/claude-model-entitlement.js";

function profile(overrides = {}) {
  return {
    fingerprint: "fp-1",
    roleRequirements: [
      { role: "Explorer", capabilities: ["reasoning", "instructionFollowing"], reason: "" },
      { role: "Architect", capabilities: ["reasoning", "coding", "instructionFollowing"], reason: "" }
    ],
    ...overrides
  };
}

// Two real candidates: claude leads reasoning, codex leads coding —
// deliberately opposite strengths, so which capability a role's real
// roleRequirements ask for actually decides who wins it.
const aa = [
  { slug: "claude-model", name: "Claude Model", intelligenceIndex: 90, codingIndex: 40, mathIndex: null },
  { slug: "codex-model", name: "Codex Model", intelligenceIndex: 40, codingIndex: 90, mathIndex: null }
];

function realCandidates() {
  const scoredAll = scoreAvailableModels([
    { adapterId: "claude", models: [{ id: "claude-model" }] },
    { adapterId: "codex", models: [{ id: "codex-model" }] }
  ], aa);
  const eligibility = { claude: { ok: true }, codex: { ok: true } };
  const registry = createCapabilityRegistry();
  return { scoredAll, eligibility, registry, providerCapacity: null };
}

function analystChoice(choice, model) {
  return { choice, model };
}

test("BOOTSTRAP_ANALYST_PROFILE is a workflow shape, not a registered team role — reasoning required, instructionFollowing optional", () => {
  assert.equal(BOOTSTRAP_ANALYST_PROFILE.role, "BootstrapAnalyst");
  assert.deepEqual(BOOTSTRAP_ANALYST_PROFILE.capabilities, { required: ["reasoning"], optional: ["instructionFollowing"] });
  assert.deepEqual(BOOTSTRAP_ANALYST_PROFILE.allowedActionIds, ["repo.read", "repo.search", "repo.inspect_history"]);
});

test("computeBootstrapAnalystCatalog includes every real ask-supported scored candidate, not just the Quality/Efficient winners", () => {
  const catalog = computeBootstrapAnalystCatalog(realCandidates());
  assert.equal(catalog.models.length, 2, "both real claude and codex candidates must appear in the full catalog");
  assert.ok(catalog.models.every((model) => ["claude", "codex"].includes(model.adapterId)));
});

test("computeBootstrapAnalystCatalog's recommendedModel is the real Quality pick, tagged; Efficient is a separate comparative tag on whichever real candidate wins it", () => {
  const catalog = computeBootstrapAnalystCatalog(realCandidates());
  assert.ok(catalog.recommendedModel);
  assert.ok(catalog.recommendedModel.recommendationTags.includes("quality"));
  const qualityEntry = catalog.models.find((model) => model.recommendationTags.includes("quality"));
  assert.equal(catalog.recommendedModel.candidateKey, qualityEntry.candidateKey);
});

test("computeBootstrapAnalystCatalog includes real unscored candidates (no AA match), honestly marked, never silently dropped", () => {
  const candidates = realCandidates();
  const catalog = computeBootstrapAnalystCatalog({
    ...candidates,
    unscoredModels: [
      { adapterId: "codex", modelId: "gpt-6-experimental", displayName: "GPT-6 Experimental" },
      { adapterId: "future-adapter", modelId: "some-future-model", displayName: "Should Be Excluded" }
    ]
  });
  const unscored = catalog.models.filter((model) => model.evidenceStatus === "unscored");
  assert.equal(unscored.length, 1, "only the real ask-supported unscored model belongs in the analyst catalog");
  assert.equal(unscored[0].modelId, "gpt-6-experimental");
  assert.deepEqual(unscored[0].recommendationTags, []);
});

test("computeBootstrapAnalystCatalog never offers a real adapter askProvider can't actually invoke, scored or unscored", () => {
  // "future-adapter" stands in for whatever real adapter Kairo might add
  // next but hasn't wired into askProvider yet — every adapter Kairo can
  // actually launch automatically today (Codex, Claude, Cursor, OpenCode
  // Go, OpenCode Zen) is already ask-capable (ASK_SUPPORTED_ADAPTERS), so
  // this proves the real filter logic itself, not a specific exclusion.
  const scoredAll = scoreAvailableModels([
    { adapterId: "future-adapter", models: [{ id: "future-model" }] },
    { adapterId: "codex", models: [{ id: "codex-model" }] }
  ], [
    { slug: "future-model", name: "Future Model", intelligenceIndex: 99, codingIndex: 10, mathIndex: null },
    { slug: "codex-model", name: "Codex Model", intelligenceIndex: 10, codingIndex: 99, mathIndex: null }
  ]);
  const catalog = computeBootstrapAnalystCatalog({
    scoredAll, eligibility: { "future-adapter": { ok: true }, codex: { ok: true } }, registry: createCapabilityRegistry(), providerCapacity: null,
    unscoredModels: [{ adapterId: "future-adapter", modelId: "another-future-model", displayName: "Another Future Model" }]
  });
  assert.ok(catalog.models.every((model) => model.adapterId !== "future-adapter"), "an unsupported adapter must never appear, scored or unscored — ASK doesn't support it");
});

test("computeBootstrapAnalystCatalog reports real availability and quota per candidate, never fabricated", () => {
  const providerCapacity = { claude: { adapterId: "claude", quotaRemainingPercent: 42 } };
  const catalog = computeBootstrapAnalystCatalog({ ...realCandidates(), eligibility: { claude: { ok: true }, codex: { ok: false, reason: "quota" } }, providerCapacity });
  const claude = catalog.models.find((model) => model.adapterId === "claude");
  const codex = catalog.models.find((model) => model.adapterId === "codex");
  assert.equal(claude.available, true);
  assert.equal(claude.quota, 42);
  assert.equal(codex.available, false);
  assert.equal(codex.quota, null, "no real quota data for codex here — must stay honestly null, never invented");
});

test("unverified Claude is visible only in the explicit analyst catalog, with entitlement metadata and no recommendation tag", () => {
  const candidates = realCandidates();
  const unverifiedClaude = {
    ...candidates.scoredAll.find((model) => model.adapterId === "claude"),
    candidateKey: "claude::claude-model", entitlement: ENTITLEMENT.UNVERIFIED,
    entitlementReason: "Access has not been verified"
  };
  const safeCodex = candidates.scoredAll.find((model) => model.adapterId === "codex");
  const input = {
    ...candidates, scoredAll: [safeCodex],
    manualSelectionScoredPool: [safeCodex, unverifiedClaude]
  };
  const catalog = computeBootstrapAnalystCatalog(input);
  const claude = catalog.models.find((model) => model.adapterId === "claude");
  assert.equal(claude.entitlement, ENTITLEMENT.UNVERIFIED);
  assert.equal(claude.entitlementReason, "Access has not been verified");
  assert.deepEqual(claude.recommendationTags, []);
  assert.equal(catalog.recommendedModel.adapterId, "codex");
});

test("buildProjectStrategy only activates roles the real profile asked for AND that have a real pick", () => {
  const strategy = buildProjectStrategy(profile({
    roleRequirements: [
      { role: "Explorer", capabilities: ["reasoning"], reason: "" },
      { role: "Architect", capabilities: ["reasoning", "coding"], reason: "" }
      // Builder was never required by this project's real evidence.
    ]
  }), realCandidates(), analystChoice("quality", { adapterId: "claude", modelId: "claude-model" }));
  assert.deepEqual(strategy.activeRoles, ["Explorer", "Architect"]);
  assert.equal(strategy.status, "suggested");
});

test("buildProjectStrategy attaches the ALREADY-confirmed real Bootstrap Analyst choice — it never decides the analyst itself", () => {
  const strategy = buildProjectStrategy(profile({
    roleRequirements: [{ role: "Architect", capabilities: ["coding"], reason: "" }]
  }), realCandidates(), analystChoice("efficient", { adapterId: "codex", modelId: "codex-model" }));
  assert.equal(strategy.bootstrapAnalyst.adapterId, "codex");
  assert.equal(strategy.bootstrapAnalystChoice, "efficient");
  assert.equal(strategy.orchestrator.adapterId, "codex", "coding-only Architect must pick the real coding leader — a separate decision from the given analyst");
});

test("buildProjectStrategy defaults selectionSource/recommendationTags for the legacy {choice, model} shape — backward-compatible, never breaking the plain-text subcommand", () => {
  const strategy = buildProjectStrategy(profile({
    roleRequirements: [{ role: "Explorer", capabilities: ["reasoning"], reason: "" }]
  }), realCandidates(), analystChoice("quality", { adapterId: "claude", modelId: "claude-model" }));
  assert.equal(strategy.bootstrapAnalystSelectionSource, "recommended");
  assert.deepEqual(strategy.bootstrapAnalystRecommendationTags, ["quality"]);
});

test("buildProjectStrategy honestly persists a manual, untagged catalog pick — real selectionSource/recommendationTags, no fabricated quality/efficient choice", () => {
  const strategy = buildProjectStrategy(profile({
    roleRequirements: [{ role: "Explorer", capabilities: ["reasoning"], reason: "" }]
  }), realCandidates(), {
    model: { adapterId: "codex", modelId: "codex-model" }, choice: null, selectionSource: "manual", recommendationTags: []
  });
  assert.equal(strategy.bootstrapAnalystChoice, null);
  assert.equal(strategy.bootstrapAnalystSelectionSource, "manual");
  assert.deepEqual(strategy.bootstrapAnalystRecommendationTags, []);
});

test("DECISIVE: the same real candidate pool produces a genuinely different model for the same role when two projects' real roleRequirements ask for different capabilities — this is real per-project re-scoring, not global-team filtering by role name", () => {
  const candidates = realCandidates();
  const analyst = analystChoice("quality", { adapterId: "claude", modelId: "claude-model" });
  const reasoningHeavyProject = profile({ roleRequirements: [{ role: "Architect", capabilities: ["reasoning"], reason: "" }] });
  const codingHeavyProject = profile({ roleRequirements: [{ role: "Architect", capabilities: ["coding"], reason: "" }] });

  const reasoningStrategy = buildProjectStrategy(reasoningHeavyProject, candidates, analyst);
  const codingStrategy = buildProjectStrategy(codingHeavyProject, candidates, analyst);

  assert.equal(reasoningStrategy.qualityTeam[0].model.adapterId, "claude");
  assert.equal(codingStrategy.qualityTeam[0].model.adapterId, "codex");
  assert.notEqual(
    reasoningStrategy.qualityTeam[0].model.adapterId,
    codingStrategy.qualityTeam[0].model.adapterId,
    "identical candidate pool, different real project profiles, different real winning model"
  );
});

test("a project-derived capability matching the role's global-optional set stays optional — never excludes a real candidate with no evidence for it, the exact scarce-evidence regression the global required/optional split already fixed once", () => {
  // Builder's global table: required = coding + terminalExecution,
  // optional = softwareExecution + instructionFollowing. This project's
  // own roleRequirements cites all three (mechanical floor + a real
  // Bootstrap Analyst addition) — a flat array with no required/optional
  // distinction of its own, exactly like project-analysis.js's
  // deriveRoleRequirements always produces.
  const softwareExecutionAa = [
    { slug: "builder-model", name: "Builder Model", intelligenceIndex: null, codingIndex: 85, mathIndex: null, terminalBenchV2: 0.85 }
  ];
  const scoredAll = scoreAvailableModels([
    { adapterId: "claude", models: [{ id: "builder-model" }] }
  ], softwareExecutionAa);
  const strategy = buildProjectStrategy(
    profile({ roleRequirements: [{ role: "Builder", capabilities: ["coding", "terminalExecution", "softwareExecution"], reason: "" }] }),
    { scoredAll, eligibility: { claude: { ok: true } }, registry: createCapabilityRegistry(), providerCapacity: null },
    analystChoice("quality", { adapterId: "claude", modelId: "builder-model" })
  );
  // If softwareExecution had wrongly stayed required (the legacy plain-
  // array behavior projectRoleCapabilities used to fall into), this real
  // candidate — coding+terminalExecution evidence, but no
  // softwareExecution evidence at all — would be excluded entirely and
  // Builder would have no real pick.
  assert.equal(strategy.qualityTeam.length, 1);
  assert.equal(strategy.qualityTeam[0].role, "Builder");
  assert.equal(strategy.qualityTeam[0].model.adapterId, "claude");
});

test("buildProjectStrategy's qualityTeam/efficientTeam only ever include real picks for active roles, real model refs, never invented ones", () => {
  const strategy = buildProjectStrategy(profile({
    roleRequirements: [{ role: "Explorer", capabilities: ["reasoning"], reason: "" }]
  }), realCandidates(), analystChoice("quality", { adapterId: "claude", modelId: "claude-model" }));
  assert.equal(strategy.qualityTeam.length, 1);
  assert.equal(strategy.qualityTeam[0].role, "Explorer");
  assert.equal(strategy.qualityTeam[0].model.adapterId, "claude");
  assert.ok(strategy.efficientTeam.length === 1 && strategy.efficientTeam[0].role === "Explorer");
});

test("buildProjectStrategy's projectTeam reuses the exact same real Pareto/risk-floor pick as efficientTeam, never a third formula", () => {
  const strategy = buildProjectStrategy(profile({
    roleRequirements: [{ role: "Explorer", capabilities: ["reasoning"], reason: "" }]
  }), realCandidates(), analystChoice("quality", { adapterId: "claude", modelId: "claude-model" }));
  assert.equal(strategy.projectTeam.length, 1);
  const [entry] = strategy.projectTeam;
  assert.equal(entry.role, "Explorer");
  assert.equal(entry.model.adapterId, strategy.efficientTeam[0].model.adapterId, "projectTeam must pick the same real model efficientTeam already computed for this role");
  assert.equal(entry.model.modelId, strategy.efficientTeam[0].model.modelId);
});

test("buildProjectStrategy's projectTeam carries the richer model reference (candidateKey, accessMode) plus assignmentSource and decisionEvidence", () => {
  const strategy = buildProjectStrategy(profile({
    roleRequirements: [{ role: "Explorer", capabilities: ["reasoning"], reason: "" }]
  }), realCandidates(), analystChoice("quality", { adapterId: "claude", modelId: "claude-model" }));
  const [entry] = strategy.projectTeam;
  assert.deepEqual(Object.keys(entry.model), ["candidateKey", "adapterId", "modelId", "displayName", "accessMode"]);
  assert.equal(entry.assignmentSource, "recommended", "nothing overrides yet — every real pick starts as the recommended one");
  assert.ok(entry.decisionEvidence, "the real decision receipt from EFFICIENT's selection must carry through to projectTeam");
});

test("REGRESSION: buildProjectStrategy's projectTeam carries the same real human-readable reason efficientTeam already computed — the overlay's own missing-explanation gap", () => {
  const strategy = buildProjectStrategy(profile({
    roleRequirements: [{ role: "Explorer", capabilities: ["reasoning"], reason: "" }]
  }), realCandidates(), analystChoice("quality", { adapterId: "claude", modelId: "claude-model" }));
  const [entry] = strategy.projectTeam;
  assert.equal(entry.reason, strategy.efficientTeam[0].reason, "projectTeam must expose the exact same real decision reason efficientTeam already computed for this role, never a fabricated one");
  assert.equal(entry.recommendedAssignment.reason, entry.reason, "the frozen original recommendation must carry its own real reason too");
});

test("REGRESSION: applyProjectTeamOverride clears the operational reason (it describes a different model now) but recommendedAssignment keeps the real original one", () => {
  const strategy = buildProjectStrategy(profile({
    roleRequirements: [{ role: "Explorer", capabilities: ["reasoning"], reason: "" }]
  }), realCandidates(), analystChoice("quality", { adapterId: "claude", modelId: "claude-model" }));
  const originalReason = strategy.projectTeam[0].reason;
  const candidate = { candidateKey: "manual::pick", adapterId: "manual", modelId: "manual-model", displayName: "Manual Pick", accessMode: "automatic", available: true, evidenceStatus: "scored" };
  const updated = applyProjectTeamOverride(strategy, "Explorer", candidate);
  const entry = updated.projectTeam.find((e) => e.role === "Explorer");
  assert.equal(entry.reason, null, "an override was never chosen by the ranking — it has no real reason of its own, and must never keep the old model's reason");
  assert.equal(entry.recommendedAssignment.reason, originalReason, "the real original recommendation's reason must survive an override completely unchanged");
});

test("buildProjectStrategy's projectTeam only includes roles the project actually requires, honestly null when no real candidate covers one", () => {
  const strategy = buildProjectStrategy(profile({
    roleRequirements: [
      { role: "Explorer", capabilities: ["reasoning"], reason: "" },
      { role: "Architect", capabilities: ["reasoning", "coding"], reason: "" }
    ]
  }), realCandidates(), analystChoice("quality", { adapterId: "claude", modelId: "claude-model" }));
  assert.deepEqual(strategy.projectTeam.map((e) => e.role), strategy.activeRoles);
  for (const entry of strategy.projectTeam) assert.notEqual(entry.model, undefined);
});

test("buildProjectStrategy's projectTeam persists the same real fallback buildEfficientTeam already computed — the router's future suggestedAlternative source, never a new alternative formula", () => {
  const strategy = buildProjectStrategy(profile({
    roleRequirements: [{ role: "Explorer", capabilities: ["reasoning"], reason: "" }]
  }), realCandidates(), analystChoice("quality", { adapterId: "claude", modelId: "claude-model" }));
  const [entry] = strategy.projectTeam;
  // Two real candidates (claude, codex) — codex is the real fallback for
  // Explorer once claude wins it.
  assert.equal(entry.fallback.adapterId, "codex");
  assert.deepEqual(Object.keys(entry.fallback), ["candidateKey", "adapterId", "modelId", "displayName", "accessMode"]);
});

test("isStrategyStale is false for a NOT_ANALYZED project (no strategy yet)", () => {
  assert.equal(isStrategyStale(null, profile()), false);
});

test("isStrategyStale is false for a merely SUGGESTED strategy — it was never a real commitment", () => {
  const strategy = { status: "suggested", profileFingerprint: "old-fp" };
  assert.equal(isStrategyStale(strategy, profile({ fingerprint: "new-fp" })), false);
});

test("isStrategyStale is true only when an ACTIVE strategy's real fingerprint no longer matches the current profile", () => {
  const strategy = { status: "active", profileFingerprint: "old-fp" };
  assert.equal(isStrategyStale(strategy, profile({ fingerprint: "old-fp" })), false);
  assert.equal(isStrategyStale(strategy, profile({ fingerprint: "new-fp" })), true);
});

// Section 4: persisted projectTeam editing.

function editCandidates() {
  const scoredAll = scoreAvailableModels([
    { adapterId: "claude", models: [{ id: "claude-model" }] },
    { adapterId: "codex", models: [{ id: "codex-model" }] },
    { adapterId: "cursor", models: [{ id: "cursor-model" }] }
  ], [
    { slug: "claude-model", name: "Claude Model", intelligenceIndex: 90, codingIndex: 40, mathIndex: null },
    { slug: "codex-model", name: "Codex Model", intelligenceIndex: 40, codingIndex: 90, mathIndex: null },
    { slug: "cursor-model", name: "Cursor Model", intelligenceIndex: 70, codingIndex: 70, mathIndex: null }
  ]);
  const eligibility = { claude: { ok: true }, codex: { ok: true }, cursor: { ok: true } };
  return { scoredAll, eligibility, registry: createCapabilityRegistry(), unscoredModels: [] };
}

function suggestedStrategyWithProjectTeam() {
  return buildProjectStrategy(profile({
    roleRequirements: [{ role: "Explorer", capabilities: ["reasoning"], reason: "" }]
  }), editCandidates(), analystChoice("quality", { adapterId: "claude", modelId: "claude-model" }));
}

test("computeProjectTeamEditCatalog includes every real candidate from all four team-executable adapters (Codex/Claude/Cursor/OpenCode Go), unlike the Bootstrap Analyst's ask-only catalog", () => {
  const catalog = computeProjectTeamEditCatalog("Explorer", editCandidates());
  assert.deepEqual(new Set(catalog.models.map((m) => m.adapterId)), new Set(["claude", "codex", "cursor"]));
});

test("project role editing retains unverified Claude with access metadata while denied Claude stays excluded", () => {
  const candidates = editCandidates();
  const claude = candidates.scoredAll.find((model) => model.adapterId === "claude");
  const codex = candidates.scoredAll.find((model) => model.adapterId === "codex");
  const unverified = {
    ...claude, candidateKey: "claude::claude-model", entitlement: ENTITLEMENT.UNVERIFIED,
    entitlementReason: "May require credits"
  };
  const denied = {
    ...claude, modelId: "claude-denied", candidateKey: "claude::claude-denied",
    entitlement: ENTITLEMENT.DENIED, entitlementReason: "Credits required"
  };
  const catalog = computeProjectTeamEditCatalog("Explorer", {
    ...candidates, scoredAll: [codex], manualSelectionScoredPool: [codex, unverified, denied]
  });
  const manualClaude = catalog.models.find((model) => model.candidateKey === "claude::claude-model");
  assert.equal(manualClaude.entitlement, ENTITLEMENT.UNVERIFIED);
  assert.equal(manualClaude.entitlementReason, "May require credits");
  assert.ok(!catalog.models.some((model) => model.candidateKey === "claude::claude-denied"));
});

test("computeProjectTeamEditCatalog attaches a real per-role evaluation (reused from capability-scoring.js, never a new formula) when the registry has real evidence", () => {
  const catalog = computeProjectTeamEditCatalog("Explorer", editCandidates());
  const claude = catalog.models.find((m) => m.adapterId === "claude");
  assert.ok(claude.roleEvaluation, "claude has real intelligenceIndex evidence for Explorer's reasoning capability");
});

test("computeProjectTeamEditCatalog includes real unscored candidates, honestly marked, from any of the four team adapters", () => {
  const candidates = { ...editCandidates(), unscoredModels: [{ adapterId: "cursor", modelId: "cursor-unscored", displayName: "Cursor Unscored" }] };
  const catalog = computeProjectTeamEditCatalog("Explorer", candidates);
  const unscored = catalog.models.find((m) => m.modelId === "cursor-unscored");
  assert.equal(unscored.evidenceStatus, "unscored");
  assert.equal(unscored.roleEvaluation, null);
});

test("REGRESSION: computeProjectTeamEditCatalog preserves a real unscored candidate's own candidateKey/accessMode, never defaulting them to null when the real identity data is present", () => {
  const candidates = {
    ...editCandidates(),
    unscoredModels: [{ adapterId: "cursor", modelId: "cursor-unscored", displayName: "Cursor Unscored", candidateKey: "cursor::cursor-unscored", accessMode: "manual", lifecycle: "current" }]
  };
  const catalog = computeProjectTeamEditCatalog("Explorer", candidates);
  const unscored = catalog.models.find((m) => m.modelId === "cursor-unscored");
  assert.equal(unscored.candidateKey, "cursor::cursor-unscored");
  assert.equal(unscored.accessMode, "manual", "a real unscored Cursor candidate's real manual accessMode must survive, never default to null");
});

test("REGRESSION: computeProjectTeamEditCatalog filters out a real superseded unscored candidate — it must never appear in the picker as if it were still current", () => {
  const candidates = {
    ...editCandidates(),
    unscoredModels: [
      { adapterId: "cursor", modelId: "cursor-old", displayName: "Cursor Old", candidateKey: "cursor::cursor-old", accessMode: "manual", lifecycle: "superseded" },
      { adapterId: "cursor", modelId: "cursor-current", displayName: "Cursor Current", candidateKey: "cursor::cursor-current", accessMode: "manual", lifecycle: "current" }
    ]
  };
  const catalog = computeProjectTeamEditCatalog("Explorer", candidates);
  assert.ok(!catalog.models.some((m) => m.modelId === "cursor-old"), "a real superseded unscored candidate must never appear in the edit catalog");
  assert.ok(catalog.models.some((m) => m.modelId === "cursor-current"), "a real current unscored candidate must still appear");
});

test("applyProjectTeamOverride preserves the real original recommendedAssignment untouched while the operational model changes", () => {
  const strategy = suggestedStrategyWithProjectTeam();
  const original = strategy.projectTeam.find((e) => e.role === "Explorer").recommendedAssignment;
  const catalog = computeProjectTeamEditCatalog("Explorer", editCandidates());
  const cursorCandidate = catalog.models.find((m) => m.adapterId === "cursor");
  const updated = applyProjectTeamOverride(strategy, "Explorer", cursorCandidate);
  const entry = updated.projectTeam.find((e) => e.role === "Explorer");
  assert.equal(entry.model.adapterId, "cursor");
  assert.equal(entry.assignmentSource, "override");
  assert.deepEqual(entry.recommendedAssignment, original, "the real original recommendation must survive an override completely unchanged");
});

test("applyProjectTeamOverride records real overrideEvidence (access, availability, evidenceStatus, role evaluation) for the override — never reusing the recommendation's own evidence", () => {
  const strategy = suggestedStrategyWithProjectTeam();
  const catalog = computeProjectTeamEditCatalog("Explorer", editCandidates());
  const cursorCandidate = catalog.models.find((m) => m.adapterId === "cursor");
  const updated = applyProjectTeamOverride(strategy, "Explorer", cursorCandidate);
  const entry = updated.projectTeam.find((e) => e.role === "Explorer");
  assert.equal(entry.overrideEvidence.accessMode, cursorCandidate.accessMode);
  assert.equal(entry.overrideEvidence.available, cursorCandidate.available);
  assert.equal(entry.overrideEvidence.evidenceStatus, cursorCandidate.evidenceStatus);
});

test("REGRESSION: applyProjectTeamOverride clears the real operational fallback/decisionEvidence instead of leaving the ORIGINAL recommendation's — those describe a different model, and left in place would misrepresent evidence for the override", () => {
  const strategy = suggestedStrategyWithProjectTeam();
  const originalEntry = strategy.projectTeam.find((e) => e.role === "Explorer");
  assert.ok(originalEntry.decisionEvidence, "the fixture's real recommendation must actually have decisionEvidence, or this regression can't be checked");
  const catalog = computeProjectTeamEditCatalog("Explorer", editCandidates());
  const cursorCandidate = catalog.models.find((m) => m.adapterId === "cursor");
  const updated = applyProjectTeamOverride(strategy, "Explorer", cursorCandidate);
  const entry = updated.projectTeam.find((e) => e.role === "Explorer");
  assert.equal(entry.fallback, null, "an override has no real computed fallback of its own — must never keep the recommendation's");
  assert.equal(entry.decisionEvidence, null, "an override has no real decision receipt of its own — must never keep the recommendation's");
});

test("choosing the real recommended model again removes the override and restores the original assignment — never stays flagged as an override", () => {
  const strategy = suggestedStrategyWithProjectTeam();
  const catalog = computeProjectTeamEditCatalog("Explorer", editCandidates());
  const cursorCandidate = catalog.models.find((m) => m.adapterId === "cursor");
  const overridden = applyProjectTeamOverride(strategy, "Explorer", cursorCandidate);
  const recommendedModel = strategy.projectTeam.find((e) => e.role === "Explorer").recommendedAssignment.model;
  const recommendedCandidate = catalog.models.find((m) => m.adapterId === recommendedModel.adapterId && m.modelId === recommendedModel.modelId);
  const restored = applyProjectTeamOverride(overridden, "Explorer", recommendedCandidate);
  const entry = restored.projectTeam.find((e) => e.role === "Explorer");
  assert.equal(entry.assignmentSource, "recommended");
  assert.equal(entry.overrideEvidence, null);
  assert.deepEqual(entry.model, entry.recommendedAssignment.model);
});

test("resetProjectTeamAssignment explicitly restores model/fallback/decisionEvidence to the real original recommendation", () => {
  const strategy = suggestedStrategyWithProjectTeam();
  const catalog = computeProjectTeamEditCatalog("Explorer", editCandidates());
  const cursorCandidate = catalog.models.find((m) => m.adapterId === "cursor");
  const overridden = applyProjectTeamOverride(strategy, "Explorer", cursorCandidate);
  const reset = resetProjectTeamAssignment(overridden, "Explorer");
  const entry = reset.projectTeam.find((e) => e.role === "Explorer");
  assert.equal(entry.assignmentSource, "recommended");
  assert.equal(entry.overrideEvidence, null);
  assert.deepEqual(entry.model, entry.recommendedAssignment.model);
  assert.deepEqual(entry.fallback, entry.recommendedAssignment.fallback);
});

test("applyProjectTeamOverride/resetProjectTeamAssignment reject a role not part of this project's team", () => {
  const strategy = suggestedStrategyWithProjectTeam();
  assert.throws(() => applyProjectTeamOverride(strategy, "Debugger", { candidateKey: "codex::codex-model", adapterId: "codex", modelId: "codex-model" }), /not part of this project's team/);
  assert.throws(() => resetProjectTeamAssignment(strategy, "Debugger"), /not part of this project's team/);
});

test("applyProjectTeamOverride/resetProjectTeamAssignment refuse to edit an ACTIVE or STALE strategy", () => {
  const strategy = { ...suggestedStrategyWithProjectTeam(), status: "active" };
  assert.throws(() => applyProjectTeamOverride(strategy, "Explorer", { candidateKey: "codex::codex-model", adapterId: "codex", modelId: "codex-model" }), /ACTIVE/);
  const staleStrategy = { ...suggestedStrategyWithProjectTeam(), status: "stale" };
  assert.throws(() => resetProjectTeamAssignment(staleStrategy, "Explorer"), /STALE/);
});

test("applyProjectTeamOverride on a legacy entry with no recommendedAssignment field lazily captures its own real current model as the recommendation, never losing it", () => {
  const strategy = suggestedStrategyWithProjectTeam();
  const legacyEntry = { ...strategy.projectTeam.find((e) => e.role === "Explorer") };
  delete legacyEntry.recommendedAssignment;
  const legacyStrategy = { ...strategy, projectTeam: [legacyEntry] };
  const originalModel = legacyEntry.model;
  const catalog = computeProjectTeamEditCatalog("Explorer", editCandidates());
  const cursorCandidate = catalog.models.find((m) => m.adapterId === "cursor");
  const updated = applyProjectTeamOverride(legacyStrategy, "Explorer", cursorCandidate);
  const entry = updated.projectTeam.find((e) => e.role === "Explorer");
  assert.deepEqual(entry.recommendedAssignment.model, originalModel, "the legacy entry's own current model was its real recommendation — must be captured, not lost");
});
