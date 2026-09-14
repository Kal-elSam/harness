import test from "node:test";
import assert from "node:assert/strict";
import { buildProjectStrategy, isStrategyStale } from "../src/global/conversation/project-strategy.js";

function teamModel(adapterId, modelId, displayName) {
  return { adapterId, modelId, displayName, available: true };
}

function profile(overrides = {}) {
  return {
    fingerprint: "fp-1",
    roleRequirements: [
      { role: "Explorer", capabilities: [], reason: "" },
      { role: "Architect", capabilities: [], reason: "" },
      { role: "Builder", capabilities: [], reason: "" }
    ],
    ...overrides
  };
}

test("buildProjectStrategy only activates roles the real profile asked for AND that have a real global pick", () => {
  const aiTeam = [
    { role: "Explorer", primary: teamModel("codex", "gpt-6-astra", "GPT-6 Astra"), reason: null },
    { role: "Architect", primary: teamModel("claude", "claude-fable-5-1", "Fable 5.1"), reason: null },
    // Tester exists globally but the profile never asked for it (no test command detected)
    { role: "Tester", primary: teamModel("claude", "claude-fable-5-1", "Fable 5.1"), reason: null }
  ];
  const strategy = buildProjectStrategy(profile(), aiTeam, []);
  assert.deepEqual(strategy.activeRoles, ["Explorer", "Architect"], "Builder was required but has no real global pick; Tester has a pick but was never required");
  assert.equal(strategy.status, "suggested");
});

test("buildProjectStrategy's bootstrapAnalyst is the real Explorer pick, and orchestrator is a SEPARATE real Architect pick — never self-appointed", () => {
  const aiTeam = [
    { role: "Explorer", primary: teamModel("codex", "gpt-6-astra", "GPT-6 Astra"), reason: null },
    { role: "Architect", primary: teamModel("claude", "claude-fable-5-1", "Fable 5.1"), reason: null }
  ];
  const strategy = buildProjectStrategy(profile({ roleRequirements: [{ role: "Explorer" }, { role: "Architect" }] }), aiTeam, []);
  assert.equal(strategy.bootstrapAnalyst.adapterId, "codex");
  assert.equal(strategy.orchestrator.adapterId, "claude");
});

test("buildProjectStrategy's qualityTeam/efficientTeam only ever include real picks for active roles, real model refs, never invented ones", () => {
  const aiTeam = [{ role: "Explorer", primary: teamModel("codex", "gpt-6-astra", "GPT-6 Astra"), reason: "decisive" }];
  const efficientTeam = [{ role: "Explorer", primary: teamModel("opencode-go", "kimi-k3", "Kimi K3"), reason: "cheaper" }];
  const strategy = buildProjectStrategy(profile({ roleRequirements: [{ role: "Explorer" }] }), aiTeam, efficientTeam);
  assert.deepEqual(strategy.qualityTeam, [{ role: "Explorer", model: { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra" }, reason: "decisive" }]);
  assert.deepEqual(strategy.efficientTeam, [{ role: "Explorer", model: { adapterId: "opencode-go", modelId: "kimi-k3", displayName: "Kimi K3" }, reason: "cheaper" }]);
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
