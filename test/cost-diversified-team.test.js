// Synthetic provider-price fixtures; no real prices or model capabilities are asserted.
import test from "node:test";
import assert from "node:assert/strict";
import { buildAiTeam, buildEfficientTeam, scoreAvailableModels } from "../src/global/intelligence/model-intelligence.js";
import { createRoleAptitudeEvidenceStore } from "../src/global/intelligence/role-aptitude-evidence.js";
import { currentProbeForRole } from "../src/global/intelligence/role-aptitude-selection.js";
import { buildProjectStrategy } from "../src/global/conversation/project-strategy.js";

const roles = { Explorer: { required: ["reasoning"] }, Architect: { required: ["coding"] } };
const eligibility = { codex: { ok: true }, claude: { ok: true } };
function models(cheapId = "alpha", expensiveId = "beta") {
  return [
    { adapterId: "codex", modelId: cheapId, displayName: cheapId, intelligenceIndex: 98, codingIndex: 59, priceInputPerMTok: 1, priceOutputPerMTok: 1 },
    { adapterId: "claude", modelId: expensiveId, displayName: expensiveId, intelligenceIndex: 100, codingIndex: 100, priceInputPerMTok: 2, priceOutputPerMTok: 2 }
  ];
}
const builders = {
  quality: (rows, options = {}, capabilities = roles) => buildAiTeam(rows, eligibility, null, capabilities, options),
  efficient: (rows, options = {}, capabilities = roles) => buildEfficientTeam(rows, eligibility, null, { ...options, roleCapabilities: capabilities })
};
for (const [label, build] of Object.entries(builders)) {
  test(`${label}: cheapest qualified model takes low-floor role; only qualified expensive model keeps demanding role`, () => {
    const team = build(models());
    assert.equal(team.find(r => r.role === "Explorer").primary.modelId, "alpha");
    assert.equal(team.find(r => r.role === "Architect").primary.modelId, "beta");
  });
  test(`${label}: quota exhaustion flips qualified choice; missing quota changes nothing`, () => {
    const rows = models();
    const role = { Explorer: roles.Explorer };
    assert.equal(build(rows, {}, role)[0].primary.modelId, "alpha");
    assert.equal(build(rows, { providerCapacity: { codex: { quotaRemainingPercent: 1 }, claude: { quotaRemainingPercent: 100 } } }, role)[0].primary.modelId, "beta");
    assert.equal(build(rows, { providerCapacity: {} }, role)[0].primary.modelId, "alpha");
  });
  test(`${label}: unknown cost never beats known cheaper qualified model`, () => {
    const rows = models();
    delete rows[1].priceInputPerMTok;
    delete rows[1].priceOutputPerMTok;
    assert.equal(build(rows, {}, { Explorer: roles.Explorer })[0].primary.modelId, "alpha");
  });
  test(`${label}: swapping names does not swap cost-based assignments`, () => {
    const first = build(models("haiku", "astra"));
    const swapped = build(models("astra", "haiku"));
    assert.deepEqual(first.map(r => r.primary.adapterId), swapped.map(r => r.primary.adapterId));
    assert.equal(swapped.find(r => r.role === "Explorer").primary.adapterId, "codex");
  });
  test(`${label}: concentration cannot promote a more expensive candidate on cost-weighted roles; S19 lets the demanding Architect take the stronger one`, () => {
    const capabilities = Object.fromEntries(["Explorer", "Architect", "Tester"].map(role => [role, { required: ["reasoning"] }]));
    const team = build(models(), {}, capabilities);
    for (const role of ["Explorer", "Tester"]) assert.equal(team.find(row => row.role === role).primary.adapterId, "codex");
    assert.equal(team.find(row => row.role === "Architect").primary.adapterId, "claude");
  });
  test(`${label}: equal or entirely unknown costs preserve previous quality tiebreak`, () => {
    const rows = models();
    rows[0].priceInputPerMTok = 2;
    rows[0].priceOutputPerMTok = 2;
    assert.equal(build(rows, {}, { Explorer: roles.Explorer })[0].primary.adapterId, "claude");
    for (const row of rows) { delete row.priceInputPerMTok; delete row.priceOutputPerMTok; }
    assert.equal(build(rows, {}, { Explorer: roles.Explorer })[0].primary.adapterId, "claude");
  });
}

test("project strategy forwards quota to both team builders without changing manual analyst", () => {
  const analyst = { adapterId: "codex", modelId: "manual" };
  const profile = { fingerprint: "synthetic", roleRequirements: [{ role: "Explorer", capabilities: ["reasoning"] }] };
  const strategy = buildProjectStrategy(profile, { scoredAll: models(), eligibility, providerCapacity: { codex: { quotaRemainingPercent: 1 }, claude: { quotaRemainingPercent: 100 } } }, { model: analyst, selectionSource: "manual" });
  assert.equal(strategy.qualityTeam[0].model.adapterId, "claude");
  assert.equal(strategy.efficientTeam[0].model.adapterId, "claude");
  assert.deepEqual(strategy.bootstrapAnalyst, analyst);
});

test("public scorer retains provider catalog prices without AA prices", () => {
  const rows = scoreAvailableModels([{ adapterId: "codex", models: [{ id: "alpha", costInputPerMTok: 1, costOutputPerMTok: 2 }] }], [{ slug: "alpha", intelligenceIndex: 98, codingIndex: 90 }]);
  assert.deepEqual(rows[0].resourceCost, { inputPerMTok: 1, outputPerMTok: 2 });
});

test("quality: wider search cannot promote costlier model after cheapest reaches concentration cap", () => {
  const rows = models();
  rows[0].intelligenceIndex = 100;
  rows[1].intelligenceIndex = 90;
  const capabilities = Object.fromEntries(["Explorer", "Architect", "Tester"].map(role => [role, { required: ["reasoning"] }]));
  assert.ok(builders.quality(rows, {}, capabilities).every(row => row.primary.adapterId === "codex"));
});

for (const [label, build] of Object.entries(builders)) {
  test(`${label}: cheapest independent Reviewer remains assigned when model concentration is full`, () => {
    for (const alternateScore of [100, 90]) {
      const rows = [
        { adapterId: "codex", modelId: "reader", intelligenceIndex: 100, codingIndex: null, priceInputPerMTok: 1, priceOutputPerMTok: 1 },
        { adapterId: "claude", modelId: "checker", intelligenceIndex: 50, codingIndex: 100, priceInputPerMTok: 2, priceOutputPerMTok: 2 },
        { adapterId: "claude", modelId: "other", intelligenceIndex: 50, codingIndex: alternateScore, priceInputPerMTok: 4, priceOutputPerMTok: 4 }
      ];
      const capabilities = { Explorer: { required: ["coding"] }, Architect: { required: ["coding"] }, Tester: { required: ["reasoning"] }, Builder: { required: ["reasoning"] }, Reviewer: { required: ["coding"] } };
      const team = build(rows, {}, capabilities);
      assert.equal(team.find(row => row.role === "Reviewer").primary?.modelId, "checker");
      assert.equal(team.find(row => row.role === "Builder").primary.adapterId, "codex");
    }
  });
}

for (const [label, build] of Object.entries(builders)) {
  test(`${label}: owned passes use real prices, with known quota ahead of unknown quota`, () => {
    const store = createRoleAptitudeEvidenceStore();
    const rows = models();
    const probe = currentProbeForRole("Explorer");
    for (const model of rows) {
      store.recordAttempt({
        adapterId: model.adapterId, modelId: model.modelId, accountKey: "default",
        role: "Explorer", probeId: probe.probeId, probeVersion: probe.probeVersion,
        verdict: "pass", origin: "operational", executionKind: "real-bridge",
        cost: null, validatorId: probe.validatorId, validatorVersion: probe.validatorVersion
      });
    }
    const capabilities = { Explorer: roles.Explorer };
    assert.equal(build(rows, { ownedEvidenceStore: store }, capabilities)[0].primary.adapterId, "codex");
    assert.equal(build(rows, { ownedEvidenceStore: store, providerCapacity: { codex: { quotaRemainingPercent: 1 } } }, capabilities)[0].primary.adapterId, "codex");
  });
}
