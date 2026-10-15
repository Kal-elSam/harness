import test from "node:test";
import assert from "node:assert/strict";
import { buildAiTeam, buildEfficientTeam } from "../src/global/intelligence/model-intelligence.js";
import { buildProviderCapacity } from "../src/global/intelligence/subscription-pressure-source.js";
import { buildProjectStrategy } from "../src/global/conversation/project-strategy.js";

// Synthetic scores/prices, deliberately far apart in cost but close in aptitude.
const roles = Object.fromEntries(["Explorer", "Tester", "Builder", "Reviewer", "Debugger", "Architect"]
  .map(role => [role, { required: ["reasoning"] }]));
const rows = [
  { adapterId: "codex", modelId: "cheap", intelligenceIndex: 80, priceInputPerMTok: .01, priceOutputPerMTok: .01 },
  { adapterId: "claude", modelId: "costly", intelligenceIndex: 79, priceInputPerMTok: 10, priceOutputPerMTok: 10 }
];
const eligibility = { codex: { ok: true }, claude: { ok: true } };
const capacity = (codex = 80, claude = 80) => ({
  codex: { quotaRemainingPercent: codex, quotaPaceFactor: 1 },
  claude: { quotaRemainingPercent: claude, quotaPaceFactor: 1 }
});
const builders = {
  quality: (models, providerCapacity) => buildAiTeam(models, eligibility, null, roles, { providerCapacity }),
  efficient: (models, providerCapacity) => buildEfficientTeam(models, eligibility, null, { roleCapabilities: roles, providerCapacity })
};
const counts = team => team.reduce((result, entry) => {
  if (entry.primary) result[entry.primary.adapterId] = (result[entry.primary.adapterId] ?? 0) + 1;
  return result;
}, {});
const independent = team => assert.notEqual(team.find(row => row.role === "Reviewer").primary?.adapterId,
  team.find(row => row.role === "Builder").primary?.adapterId);

for (const [name, build] of Object.entries(builders)) {
  test(`${name}: equal quota spreads six qualified roles 3/3 despite price disparity`, () => {
    const team = build(rows, capacity());
    assert.deepEqual(counts(team), { codex: 3, claude: 3 });
    independent(team);
    assert.ok(team.every(entry => entry.primary && entry.selection.evaluated
      .find(candidate => candidate.modelId === entry.primary.modelId).gapValue >= .60));
    assert.ok(team.some(entry => /codex already holds 3\/6 roles.*50% quota share/i.test(entry.reason ?? "")));
    assert.deepEqual(rows.map(row => row.intelligenceIndex), [80, 79], "input models stay unchanged");
  });
  test(`${name}: larger remaining headroom receives more roles`, () => {
    const team = build(rows, capacity(20, 90));
    assert.ok(counts(team).claude > counts(team).codex);
    assert.equal(team.filter(entry => entry.primary).length, 6);
    independent(team);
  });
  test(`${name}: reset pace changes share even with equal remaining quota`, () => {
    const now = Date.UTC(2026, 9, 15, 12);
    const usage = resetsAt => ({ windows: [{ name: "5h", remainingPercent: 80, resetsAt: new Date(resetsAt).toISOString() }] });
    const providerCapacity = buildProviderCapacity({ codex: 80, claude: 80 }, {
      codex: usage(now + 4 * 3600000), claude: usage(now + 3600000)
    }, now);
    assert.equal(providerCapacity.codex.quotaPaceFactor, 1);
    assert.equal(providerCapacity.claude.quotaPaceFactor, 4);
    const team = build(rows, providerCapacity);
    assert.ok(counts(team).claude > (counts(team).codex ?? 0));
  });
  test(`${name}: balancing never sacrifices a demanding floor`, () => {
    const team = build([rows[0], { ...rows[1], intelligenceIndex: 59 }], capacity(20, 90));
    for (const role of ["Architect", "Debugger"]) {
      assert.equal(team.find(entry => entry.role === role).primary.adapterId, "codex");
    }
    assert.equal(team.find(entry => entry.role === "Reviewer").primary, null);
  });
  test(`${name}: exhausted quota receives no roles when qualified alternatives exist`, () => {
    const team = build(rows, capacity(0, 90));
    assert.deepEqual(counts(team), { claude: 5 });
    assert.equal(team.find(entry => entry.role === "Reviewer").primary, null);
  });
  test(`${name}: balancing does not promote unknown quota over known healthy quota`, () => {
    const team = build(rows, { claude: capacity().claude });
    for (const entry of team.filter(entry => entry.role !== "Reviewer")) assert.equal(entry.primary.adapterId, "claude");
    independent(team);
  });
}

test("project teams inherit quota-proportional assignments without replacing the analyst", () => {
  const analyst = { adapterId: "codex", modelId: "manual" };
  const profile = { fingerprint: "balanced", roleRequirements: Object.keys(roles).map(role => ({ role, capabilities: ["reasoning"] })) };
  const strategy = buildProjectStrategy(profile, { scoredAll: rows, eligibility, providerCapacity: capacity() }, { model: analyst });
  for (const team of [strategy.qualityTeam, strategy.efficientTeam]) {
    assert.deepEqual(counts(team.map(entry => ({ primary: entry.model }))), { codex: 3, claude: 3 });
  }
  assert.deepEqual(strategy.bootstrapAnalyst, analyst);
});
