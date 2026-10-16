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
// Relative work volume per role (S22): balance is measured in work, not role count.
const VOLUME = { Builder: 1, Tester: .6, Explorer: .5, Debugger: .3, Architect: .2, Reviewer: .2 };
const volumes = team => team.reduce((result, entry) => {
  if (entry.primary) result[entry.primary.adapterId] = (result[entry.primary.adapterId] ?? 0) + VOLUME[entry.role];
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
    assert.ok(team.some(entry => /codex holds 1\.50\/2\.80 relative work volume/i.test(entry.reason ?? "")));
    assert.deepEqual(rows.map(row => row.intelligenceIndex), [80, 79], "input models stay unchanged");
  });
  test(`${name}: larger remaining headroom receives more work volume`, () => {
    const team = build(rows, capacity(20, 90));
    assert.ok(volumes(team).claude > volumes(team).codex);
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
    // 54 sits below every non-light floor (S34 Builder .55, demanding .60), so
    // quota headroom cannot promote it into Builder or a demanding role.
    const team = build([rows[0], { ...rows[1], intelligenceIndex: 54 }], capacity(20, 90));
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

const splitRows = [
  ["codex", "gpt-6-astra", 81, 10, 50],
  ["codex", "gpt-5.6-terra", 80, 2, 12],
  ["codex", "gpt-6.1-sol", 79, 2, 10],
  ["claude", "claude-opus-5-5", 81, 4, 20],
  ["claude", "claude-sonnet-5-5", 80, 2, 10],
  ["claude", "claude-haiku-4-5", 40, 1, 5]
].map(([adapterId, modelId, intelligenceIndex, priceInputPerMTok, priceOutputPerMTok]) =>
  ({ adapterId, modelId, intelligenceIndex, priceInputPerMTok, priceOutputPerMTok }));
const splitBuild = (name, roles, providerCapacity, eligible = eligibility, models = splitRows) => name === "quality"
  ? buildAiTeam(models, eligible, null, roles, { providerCapacity })
  : buildEfficientTeam(models, eligible, null, { roleCapabilities: roles, providerCapacity });
const splitRoles = reviews => Object.fromEntries(["Frontend Builder", "Backend Builder", ...reviews]
  .map(role => [role, { required: ["reasoning"] }]));

for (const name of ["quality", "efficient"]) {
  for (const reviews of [["Reviewer"], ["Security Reviewer"], ["Reviewer", "Security Reviewer"]]) {
    for (const preferred of ["codex", "claude"]) {
      test(`split Builders ${name}: reserve independent provider for ${reviews.join('+')} with ${preferred} paced headroom`, () => {
        const providerCapacity = capacity();
        providerCapacity[preferred].quotaPaceFactor = 4;
        const team = splitBuild(name, splitRoles(reviews), providerCapacity);
        for (const role of ["Frontend Builder", "Backend Builder"]) {
          const entry = team.find(row => row.role === role);
          assert.equal(entry.primary?.adapterId, preferred);
          assert.notEqual(entry.primary.modelId, "gpt-6-astra");
          assert.match(entry.reason, /Builder.*provider.*independen.*paced quota headroom/i);
        }
        for (const role of reviews) assert.equal(team.find(row => row.role === role).primary?.adapterId,
          preferred === "codex" ? "claude" : "codex");
      });
    }
  }
  test(`split Builders ${name}: without reviewers balancing may use both providers`, () => {
    const team = splitBuild(name, splitRoles([]), capacity());
    assert.equal(new Set(team.map(row => row.primary?.adapterId)).size, 2);
  });
  test(`split Builders ${name}: one enabled provider retains blocked independent reviewers`, () => {
    const team = splitBuild(name, splitRoles(["Reviewer", "Security Reviewer"]), capacity(), { codex: { ok: true }, claude: { ok: false } }, splitRows.filter(row => row.adapterId === "codex"));
    for (const role of ["Reviewer", "Security Reviewer"]) assert.equal(team.find(row => row.role === role).primary, null);
    for (const role of ["Frontend Builder", "Backend Builder"]) assert.doesNotMatch(team.find(row => row.role === role).reason, /Builder provider reservation/);
  });
  test(`split Builders ${name}: single Builder retains its existing assignment`, () => {
    const team = splitBuild(name, { Builder: { required: ["reasoning"] }, Reviewer: { required: ["reasoning"] } }, capacity());
    assert.equal(team.find(row => row.role === "Builder").primary.modelId, "claude-sonnet-5-5");
    assert.equal(team.find(row => row.role === "Reviewer").primary.adapterId, "codex");
  });
}

for (const name of ["quality", "efficient"]) {
  test(`split Builders ${name}: equal quotas leave both reviewers an independent provider`, () => {
    const team = splitBuild(name, splitRoles(["Reviewer", "Security Reviewer"]), capacity());
    const builders = team.filter(row => row.role.endsWith("Builder"));
    assert.equal(new Set(builders.map(row => row.primary?.adapterId)).size, 1);
    for (const role of ["Reviewer", "Security Reviewer"]) {
      const entry = team.find(row => row.role === role);
      assert.ok(entry.primary, `${role} must not be blocked`);
      assert.notEqual(entry.primary.adapterId, builders[0].primary.adapterId);
    }
  });
}

for (const name of ["quality", "efficient"]) {
  test(`split Builders ${name}: unknown prices cannot empty a reserved qualified pool`, () => {
    const models = [
      { adapterId: "codex", modelId: "gpt-6-astra", intelligenceIndex: 81 },
      { adapterId: "claude", modelId: "claude-sonnet-5-5", intelligenceIndex: 65 }
    ];
    const providerCapacity = capacity();
    providerCapacity.claude.quotaPaceFactor = 4;
    const team = splitBuild(name, splitRoles(["Reviewer", "Security Reviewer"]), providerCapacity, eligibility, models);
    for (const role of ["Frontend Builder", "Backend Builder"]) {
      const entry = team.find(row => row.role === role);
      assert.equal(entry.primary?.adapterId, "claude");
      assert.equal(entry.primary.available, true);
    }
    for (const role of ["Reviewer", "Security Reviewer"]) assert.equal(team.find(row => row.role === role).primary?.adapterId, "codex");
  });
}
