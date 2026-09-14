import test from "node:test";
import assert from "node:assert/strict";
import { buildProjectStrategy, isStrategyStale, selectBootstrapAnalyst } from "../src/global/conversation/project-strategy.js";
import { scoreAvailableModels } from "../src/global/intelligence/model-intelligence.js";
import { createCapabilityRegistry } from "../src/global/intelligence/model-capability-registry.js";

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

test("buildProjectStrategy only activates roles the real profile asked for AND that have a real pick", () => {
  const strategy = buildProjectStrategy(profile({
    roleRequirements: [
      { role: "Explorer", capabilities: ["reasoning"], reason: "" },
      { role: "Architect", capabilities: ["reasoning", "coding"], reason: "" }
      // Builder was never required by this project's real evidence.
    ]
  }), realCandidates());
  assert.deepEqual(strategy.activeRoles, ["Explorer", "Architect"]);
  assert.equal(strategy.status, "suggested");
});

test("buildProjectStrategy's bootstrapAnalyst is the real Explorer pick, and orchestrator is a SEPARATE real Architect pick — never self-appointed", () => {
  const strategy = buildProjectStrategy(profile({
    roleRequirements: [
      { role: "Explorer", capabilities: ["reasoning"], reason: "" },
      { role: "Architect", capabilities: ["coding"], reason: "" }
    ]
  }), realCandidates());
  assert.equal(strategy.bootstrapAnalyst.adapterId, "claude", "reasoning-only Explorer must pick claude, the real reasoning leader");
  assert.equal(strategy.orchestrator.adapterId, "codex", "coding-only Architect must pick codex, the real coding leader — a genuinely separate decision");
});

test("DECISIVE: the same real candidate pool produces a genuinely different model for the same role when two projects' real roleRequirements ask for different capabilities — this is real per-project re-scoring, not global-team filtering by role name", () => {
  const candidates = realCandidates();
  const reasoningHeavyProject = profile({ roleRequirements: [{ role: "Architect", capabilities: ["reasoning"], reason: "" }] });
  const codingHeavyProject = profile({ roleRequirements: [{ role: "Architect", capabilities: ["coding"], reason: "" }] });

  const reasoningStrategy = buildProjectStrategy(reasoningHeavyProject, candidates);
  const codingStrategy = buildProjectStrategy(codingHeavyProject, candidates);

  assert.equal(reasoningStrategy.qualityTeam[0].model.adapterId, "claude");
  assert.equal(codingStrategy.qualityTeam[0].model.adapterId, "codex");
  assert.notEqual(
    reasoningStrategy.qualityTeam[0].model.adapterId,
    codingStrategy.qualityTeam[0].model.adapterId,
    "identical candidate pool, different real project profiles, different real winning model"
  );
});

test("buildProjectStrategy's qualityTeam/efficientTeam only ever include real picks for active roles, real model refs, never invented ones", () => {
  const strategy = buildProjectStrategy(profile({
    roleRequirements: [{ role: "Explorer", capabilities: ["reasoning"], reason: "" }]
  }), realCandidates());
  assert.equal(strategy.qualityTeam.length, 1);
  assert.equal(strategy.qualityTeam[0].role, "Explorer");
  assert.equal(strategy.qualityTeam[0].model.adapterId, "claude");
  assert.ok(strategy.efficientTeam.length === 1 && strategy.efficientTeam[0].role === "Explorer");
});

test("buildProjectStrategy exposes real quality/efficiency Bootstrap Analyst alternatives, defaulting to the quality pick unconfirmed", () => {
  const strategy = buildProjectStrategy(profile({
    roleRequirements: [{ role: "Explorer", capabilities: ["reasoning"], reason: "" }]
  }), realCandidates());
  assert.equal(strategy.bootstrapAnalyst.adapterId, "claude");
  assert.equal(strategy.bootstrapAnalystChoice, null, "the default recommendation is not yet a confirmed human choice");
  const choices = strategy.bootstrapAnalystAlternatives.map((a) => a.choice);
  assert.ok(choices.includes("quality"));
});

test("selectBootstrapAnalyst lets the human pick between the two REAL alternatives already computed, never inventing a new one", () => {
  const strategy = buildProjectStrategy(profile({
    roleRequirements: [{ role: "Explorer", capabilities: ["reasoning"], reason: "" }]
  }), realCandidates());
  const updated = selectBootstrapAnalyst(strategy, "quality");
  assert.equal(updated.bootstrapAnalystChoice, "quality");
  assert.equal(updated.bootstrapAnalyst.adapterId, "claude");
});

test("selectBootstrapAnalyst rejects a choice that isn't a real computed alternative, and rejects changing an already-approved strategy", () => {
  const strategy = buildProjectStrategy(profile({
    roleRequirements: [{ role: "Explorer", capabilities: ["reasoning"], reason: "" }]
  }), realCandidates());
  assert.throws(() => selectBootstrapAnalyst(strategy, "made-up"));
  assert.throws(() => selectBootstrapAnalyst({ ...strategy, status: "active" }, "quality"));
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
