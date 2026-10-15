import test from "node:test";
import assert from "node:assert/strict";
import { computeRoleGapValue } from "../src/global/intelligence/capability-scoring.js";
import { ensureRegistry, buildAiTeam, buildEfficientTeam } from "../src/global/intelligence/model-intelligence.js";
import { buildProjectStrategy } from "../src/global/conversation/project-strategy.js";

// Synthetic magnitudes on the existing AA composite fallback (0–100).
const eligibility = { claude: { ok: true }, codex: { ok: true }, other: { ok: true } };
const row = (adapterId, score, price) => ({ adapterId, modelId: `${adapterId}-${score}`, intelligenceIndex: score, codingIndex: score, priceInputPerMTok: price, priceOutputPerMTok: price, accessMode: "automatic" });
const capabilities = role => ({ [role]: { required: ["reasoning"] } });
const builders = {
  quality: (rows, role, options = {}) => buildAiTeam(rows, eligibility, null, capabilities(role), options),
  efficient: (rows, role, options = {}) => buildEfficientTeam(rows, eligibility, null, { ...options, roleCapabilities: capabilities(role) })
};
for (const [name, build] of Object.entries(builders)) {
  test(`${name}: absolute demand tiers separate strong, standard and cheap roles`, () => {
    const rows = [row("codex", 58, .1), row("claude", 70, 2)];
    for (const role of ["Architect", "Debugger", "Reviewer"]) assert.equal(build(rows, role)[0].primary.adapterId, "claude");
    for (const role of ["Explorer", "Tester"]) assert.equal(build(rows, role)[0].primary.adapterId, "codex");
    assert.equal(build([row("codex", 62, .1), row("claude", 70, 2)], "Builder")[0].primary.adapterId, "codex");
    assert.equal(build([row("codex", 40, .1), row("claude", 70, 2)], "Builder")[0].primary.adapterId, "claude");
  });
  test(`${name}: floor miss keeps best model and explains fallback`, () => {
    const entry = build([row("codex", 52, .1), row("claude", 55, 2)], "Architect")[0];
    assert.equal(entry.primary.adapterId, "claude");
    assert.match(entry.reason, /no candidate meets.*absolute.*floor.*best.scor/i);
  });
  test(`${name}: floor-miss Reviewer keeps the best independent candidate`, () => {
    const roles = { Builder: { required: ["reasoning"] }, Reviewer: { required: ["reasoning"] } };
    const rows = [row("codex", 55, 2), row("claude", 53, 1)];
    const team = name === "quality" ? buildAiTeam(rows, eligibility, null, roles)
      : buildEfficientTeam(rows, eligibility, null, { roleCapabilities: roles });
    assert.equal(team.find(entry => entry.role === "Builder").primary.adapterId, "codex");
    const reviewer = team.find(entry => entry.role === "Reviewer");
    assert.equal(reviewer.primary?.adapterId, "claude");
    assert.match(reviewer.reason, /no candidate meets.*absolute.*floor.*best.scor/i);
  });
  test(`${name}: unknown quota is last resort only after role qualification`, () => {
    const providerCapacity = { claude: { quotaRemainingPercent: 90, quotaPaceFactor: 1 }, codex: { status: "unknown" } };
    assert.equal(build([row("codex", 80, .1), row("claude", 70, 2)], "Architect", { providerCapacity })[0].primary.adapterId, "claude");
    assert.equal(build([row("codex", 80, .1), row("claude", 59, 2)], "Architect", { providerCapacity })[0].primary.adapterId, "codex");
  });
  test(`${name}: default provider allowlist excludes other providers; explicit list enables them`, () => {
    const rows = [row("other", 95, .01), row("claude", 70, 2)];
    assert.equal(build(rows, "Explorer")[0].primary.adapterId, "claude");
    assert.equal(build(rows, "Explorer", { teamProviders: ["other", "claude"] })[0].primary.adapterId, "other");
  });
}
test("project team uses the same configurable allowlist without replacing manual analyst", () => {
  const profile = { fingerprint: "tiers", roleRequirements: [{ role: "Explorer", capabilities: ["reasoning"] }] };
  const analyst = { adapterId: "codex", modelId: "manual" };
  const context = { scoredAll: [row("other", 95, .01), row("claude", 70, 2)], eligibility };
  assert.equal(buildProjectStrategy(profile, context, { model: analyst }).projectTeam[0].model.adapterId, "claude");
  const custom = buildProjectStrategy(profile, { ...context, teamProviders: ["other", "claude"] }, { model: analyst });
  assert.equal(custom.projectTeam[0].model.adapterId, "other");
  assert.deepEqual(custom.bootstrapAnalyst, analyst);
});

for (const [name] of Object.entries(builders)) {
  const roles = { Builder: { required: ["coding"] }, Reviewer: { required: ["reasoning", "coding"] } };
  const build = rows => name === "quality" ? buildAiTeam(rows, eligibility, null, roles)
    : buildEfficientTeam(rows, eligibility, null, { roleCapabilities: roles });
  test(`${name}: live-shaped Reviewer prefers below-floor independent evidence over qualified Builder provider`, () => {
    const rows = [row("codex", 61.5, .1), row("claude", 59.5, 2), row("claude", 58, 1)];
    const team = build(rows);
    assert.equal(team.find(entry => entry.role === "Builder").primary.adapterId, "codex");
    const reviewer = team.find(entry => entry.role === "Reviewer");
    assert.equal(reviewer.primary?.modelId, "claude-59.5");
    assert.match(reviewer.reason, /below.*demanding.*floor.*0\.6.*independen/i);
  });
  test(`${name}: Reviewer retains eligible provisional independent evidence`, () => {
    const rows = [
      { ...row("codex", 80, .1), gpqa: .961, hle: .547, sciCode: .7 },
      { ...row("claude", 64, 2), hle: .614, sciCode: .669 }
    ];
    const reviewer = build(rows).find(entry => entry.role === "Reviewer");
    assert.equal(reviewer.primary?.adapterId, "claude");
    assert.ok(reviewer.selection.evaluated.some(entry => entry.modelId === reviewer.primary.modelId),
      "the independent provisional winner must appear in selection evidence");
    assert.match(reviewer.reason, /independent/i);
  });
  test(`${name}: Reviewer blocks when no eligible other-provider candidate exists`, () => {
    const reviewer = build([row("codex", 80, .1)]).find(entry => entry.role === "Reviewer");
    assert.equal(reviewer.primary, null);
    assert.equal(reviewer.fallback, null);
    assert.equal(reviewer.selection.reasonKind, "reviewer_independence");
    assert.match(reviewer.reason, /needs a different provider/i);
  });
}

// Diagnosis guard: absent benchmark signals are omitted, never scored as zero.
test("role gap uses available evidence when one benchmark signal is missing", () => {
  const models = [
    { ...row("claude", 64, 2), hle: .614, sciCode: .669, codingIndex: null },
    { ...row("codex", 80, 1), gpqa: .961, hle: .547, sciCode: .565 }
  ];
  const gaps = computeRoleGapValue(ensureRegistry(models), models, ["reasoning", "coding"]);
  assert.ok(Math.abs(gaps.get("claude::claude-64") - .6415) < 1e-12);
  assert.ok(Math.abs(gaps.get("codex::codex-80") - .6595) < 1e-12);
});

for (const [name, build] of Object.entries(builders)) {
  test(`${name}: demanding floor admits .60 and live .6415 evidence`, () => {
    for (const score of [60, 64.15]) {
      // S19: a stronger rival would win the weighted trade-off, so pair with a below-floor one to isolate floor admission.
      const result = build([row("codex", 55, .1), row("claude", score, 1)], "Architect")[0];
      assert.equal(result.primary.adapterId, "claude");
      assert.doesNotMatch(result.reason ?? "", /no candidate meets/i);
    }
  });
  test(`${name}: Reviewer blocks a decisively worse below-floor independent candidate`, () => {
    const roles = { Builder: { required: ["reasoning"] }, Reviewer: { required: ["reasoning"] } };
    const rows = [row("codex", 90, 1), row("claude", 59, 2)];
    const team = name === "quality" ? buildAiTeam(rows, eligibility, null, roles)
      : buildEfficientTeam(rows, eligibility, null, { roleCapabilities: roles });
    assert.equal(team.find(entry => entry.role === "Reviewer").primary, null);
  });
}
