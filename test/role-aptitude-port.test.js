import test from "node:test";
import assert from "node:assert/strict";
import { buildAiTeam, buildEfficientTeam } from "../src/global/intelligence/model-intelligence.js";
import { createCapabilityRegistry } from "../src/global/intelligence/model-capability-registry.js";
import { createRoleAptitudeEvidenceStore } from "../src/global/intelligence/role-aptitude-evidence.js";
import { createConversationService } from "../src/global/team/service.js";

test("no-evidence public snapshot preserves baseline f3ae58659 keys before and after serialization", async () => {
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    enableProviderProbes: true,
    listPlans: async () => [],
    listRunRecords: async () => [],
    readProjectStrategy: async () => null,
    inspectExecutionAdapters: () => [],
    inspectEngramIntegration: () => ({ status: "unconfigured" }),
    readCodexUsage: async () => null,
    readClaudeUsage: async () => null,
    readOpenCodeUsage: async () => null,
    readCodexModels: async () => ({ models: [] }),
    readClaudeModels: () => ({ models: [] }),
    readOpenCodeModels: async () => ({ models: [] }),
    readCursorModels: async () => ({ models: [] }),
    readClaudeEntitlementCache: async () => null,
    readCursorEntitlementCache: async () => null,
    verifyClaudeSubscriptionAuth: async () => null,
    readArtificialAnalysisModels: async () => ({ status: "live", source: "fixture", age: null, models: [] }),
    readHuggingFaceLeaderboard: async () => ({ entries: [] }),
    ownedEvidenceStore: createRoleAptitudeEvidenceStore(),
    ownedEvidenceAccountKey: "private-account"
  });
  // Fixed key sets from the successful snapshot in f3ae58659, not another
  // projection of the current implementation.
  const snapshotKeys = ["schema", "projectRoot", "providers", "integrations", "usage", "modelIntelligence", "governance", "capabilities", "timeline", "projectStrategy"].sort();
  const intelligenceKeys = [
    "status", "source", "age", "models", "roles", "eligibility", "coverage",
    "unscoredModels", "analystUnscoredModels", "claudeEntitlement", "cursorAccess",
    "modelEntitlement", "verificationPlan", "globalGuide", "aiTeam", "efficientTeam",
    "scoredAll", "manualSelectionScoredPool", "deniedScoredPool", "registry",
    "providerCapacity", "automaticExecutionPool"
  ].sort();
  const snapshot = await service.snapshot({ cwd: "/repo" });
  assert.equal(snapshot.modelIntelligence.status, "live");
  for (const value of [snapshot, JSON.parse(JSON.stringify(snapshot))]) {
    assert.deepEqual(Object.keys(value).sort(), snapshotKeys);
    assert.deepEqual(Object.keys(value.modelIntelligence).sort(), intelligenceKeys);
  }
  assert.ok(!JSON.stringify(snapshot).includes("private-account"));
});

for (const builder of [buildAiTeam, buildEfficientTeam]) {
  test(`${builder.name} empty owned evidence equals absent options with a catalog-only identity`, () => {
    const scored = [{ adapterId: "codex", modelId: "public-model", intelligenceIndex: 80, codingIndex: 80, mathIndex: null }];
    const pool = [...scored, { adapterId: "codex", modelId: "catalog-only", evidenceStatus: "unscored", intelligenceIndex: null, codingIndex: null, mathIndex: null }];
    const eligibility = { codex: { ok: true } };
    const registry = createCapabilityRegistry();
    const options = { ownedEvidenceStore: createRoleAptitudeEvidenceStore(), accountKey: "test-account" };
    const baseline = builder(scored, eligibility, registry);
    assert.ok(baseline.length > 0);
    assert.deepEqual(builder(pool, eligibility, registry), baseline);
    const withEmptyEvidence = builder === buildAiTeam
      ? builder(pool, eligibility, registry, undefined, options)
      : builder(pool, eligibility, registry, options);
    assert.deepEqual(withEmptyEvidence, baseline);
  });
}

for (const builder of [buildAiTeam, buildEfficientTeam]) {
  test(`${builder.name} retains registry-only public candidates without owned evidence`, () => {
    const models = [
      { adapterId: "codex", modelId: "composite-model", intelligenceIndex: 20, codingIndex: 20, mathIndex: null },
      { adapterId: "claude", modelId: "benchmark-model", intelligenceIndex: null, codingIndex: null, mathIndex: null }
    ];
    const registry = createCapabilityRegistry();
    for (const [index, model] of models.entries()) {
      const identity = registry.registerIdentity(model.adapterId, model.modelId);
      for (const metric of ["gpqa", "hle"]) {
        registry.addEvidence(identity, { metric, value: index ? 0.9 : 0.2, source: "huggingface-leaderboard", scale: "unit", verified: false });
      }
    }
    const eligibility = { codex: { ok: true }, claude: { ok: true } };
    const roleCapabilities = { Explorer: { required: ["reasoning"], optional: [] } };
    const build = (ownedEvidenceStore) => builder === buildAiTeam
      ? builder(models, eligibility, registry, roleCapabilities, { ownedEvidenceStore })
      : builder(models, eligibility, registry, { roleCapabilities, ownedEvidenceStore });
    // Both providers are allowed; only the registry-only model clears Explorer's
    // absolute .35 floor (.9 benchmark evidence versus .2 for the composite).
    const withoutStore = build();
    assert.equal(withoutStore.find((entry) => entry.role === "Explorer").primary.modelId, "benchmark-model");
    assert.deepEqual(build(createRoleAptitudeEvidenceStore()), withoutStore);
  });
}
