import test from "node:test";
import assert from "node:assert/strict";
import { buildAiTeam, buildEfficientTeam, ROLE_CAPABILITIES } from "../src/global/intelligence/model-intelligence.js";
import { buildProjectStrategy } from "../src/global/team/project-strategy.js";
import { buildProviderCapacity } from "../src/global/intelligence/subscription-pressure-source.js";
import { withQuotaCosts } from "../src/global/intelligence/model-cost.js";
import { ROLE_TRADEOFF_WEIGHTS, roleTradeoffWeights, projectDemand } from "../src/global/intelligence/role-demand.js";

// S19 live reference 2026-10-15 (score = normalized role gap x100; price = AA input/output USD per MTok).
const eligibility = { claude: { ok: true }, codex: { ok: true } };
const m = (adapterId, modelId, score, input, output) => ({ adapterId, modelId, intelligenceIndex: score, codingIndex: score, priceInputPerMTok: input, priceOutputPerMTok: output, accessMode: "automatic" });
const terra = m("codex", "terra", 61.35, 2, 12);
const opus = m("claude", "opus", 64.15, 4, 20);
const astra = m("codex", "astra", 65.95, 10, 50);
const haiku = m("claude", "haiku", 40, 1, 5);
const caps = role => ({ [role]: { required: ["reasoning"] } });
const builders = {
  quality: (rows, role, options = {}) => buildAiTeam(rows, eligibility, null, caps(role), options),
  efficient: (rows, role, options = {}) => buildEfficientTeam(rows, eligibility, null, { ...options, roleCapabilities: caps(role) })
};

test("weights: demanding favors capability, light favors cost, Builder in between", () => {
  const { demanding, standard, light } = ROLE_TRADEOFF_WEIGHTS;
  assert.ok(demanding.capability > standard.capability && standard.capability > light.capability);
  assert.ok(demanding.cost < standard.cost && standard.cost < light.cost);
  assert.deepEqual(roleTradeoffWeights("Architect"), demanding);
  assert.ok(roleTradeoffWeights("Test Runner").cost >= light.cost);
  assert.ok(roleTradeoffWeights("Builder").cost > standard.cost);
});

test("project profile shifts weight toward capability only for roles it raised", () => {
  const demand = projectDemand({ architecture: { pattern: "Layered or Clean Architecture" }, risks: [] });
  assert.ok(roleTradeoffWeights("Architect", demand).capability > ROLE_TRADEOFF_WEIGHTS.demanding.capability);
  assert.deepEqual(roleTradeoffWeights("Explorer", demand), roleTradeoffWeights("Explorer"));
});

for (const [name, build] of Object.entries(builders)) {
  test(`${name}: floor-miss Architect retains strongest capability outside cheaper candidates' band`, () => {
    const rows = [m("codex", "gpt-6-astra", 59, 10, 50),
      m("codex", "gpt-5.6-terra", 55, 2, 12),
      { ...m("codex", "gpt-6.1-sol", 54, 2, 10), costPerTask: .39 }];
    const entry = build(rows, "Architect")[0];
    assert.equal(entry.primary.modelId, "gpt-6-astra");
    assert.match(entry.reason, /No candidate meets the Architect absolute demand floor \(0\.6\)/);
    assert.match(entry.reason, /capability\/cost trade-off.*capability weight 0\.90.*cost weight 0\.10.*near-equivalence band/i);
  });
  test(`${name}: Architect prefers the stronger model over the cheapest qualified one`, () => {
    const pick = build([terra, opus, astra], "Architect")[0].primary;
    assert.notEqual(pick.modelId, "terra");
  });
  test(`${name}: an extreme cost gap still lets the cheaper Architect win`, () => {
    const pick = build([terra, m("claude", "opus-xl", 62, 400, 2000)], "Architect")[0].primary;
    assert.equal(pick.modelId, "terra");
  });
  test(`${name}: Explorer and Test Runner stay on the cheap model`, () => {
    for (const role of ["Explorer", "Test Runner"]) {
      assert.equal(build([haiku, opus, terra], role)[0].primary.modelId, "haiku");
    }
  });
  test(`${name}: floors still bind - a cheap model below the demanding floor never wins Architect`, () => {
    assert.equal(build([haiku, terra], "Architect")[0].primary.modelId, "terra");
  });
}


// Real snapshot 2026-10-15 (claude/codex scored rows with AA prices, and Sam's live quotas).
const LIVE_MODELS = [{"adapterId":"codex","modelId":"gpt-6.1-sol","displayName":"GPT-6.1-Sol","slug":"gpt-6-1-sol","name":"GPT-6.1 Sol (Max)","intelligenceIndex":51.8,"codingIndex":null,"mathIndex":null,"priceInputPerMTok":2,"priceOutputPerMTok":10,"gpqa":null,"hle":0.529,"sciCode":0.542,"mmluPro":null,"liveCodeBench":null,"ifBench":null,"terminalBenchHard":null,"terminalBenchV2":null,"tau2":null,"tauBanking":null,"evidenceStatus":"scored","candidateKey":"codex::gpt-6.1-sol","accessMode":"automatic"},{"adapterId":"codex","modelId":"gpt-6-astra","displayName":"GPT-6-Astra","slug":"gpt-6-astra","name":"GPT-6 Astra (Max)","intelligenceIndex":52.7,"codingIndex":76.9,"mathIndex":null,"priceInputPerMTok":10,"priceOutputPerMTok":50,"gpqa":0.961,"hle":0.547,"sciCode":0.565,"mmluPro":null,"liveCodeBench":null,"ifBench":null,"terminalBenchHard":null,"terminalBenchV2":0.883895131086142,"tau2":null,"tauBanking":0.414432989690722,"evidenceStatus":"scored","candidateKey":"codex::gpt-6-astra","accessMode":"automatic"},{"adapterId":"codex","modelId":"gpt-6-luna","displayName":"GPT-6-Luna","slug":"gpt-6-luna","name":"GPT-6 Luna (Max)","intelligenceIndex":38.1,"codingIndex":null,"mathIndex":null,"priceInputPerMTok":0.1,"priceOutputPerMTok":0.5,"gpqa":null,"hle":0.385,"sciCode":0.546,"mmluPro":null,"liveCodeBench":null,"ifBench":null,"terminalBenchHard":null,"terminalBenchV2":null,"tau2":null,"tauBanking":null,"evidenceStatus":"scored","candidateKey":"codex::gpt-6-luna","accessMode":"automatic"},{"adapterId":"codex","modelId":"gpt-5.6-terra","displayName":"GPT-5.6-Terra","slug":"gpt-5-6-terra","name":"GPT-5.6 Terra (Max)","intelligenceIndex":42.1,"codingIndex":76.7,"mathIndex":null,"priceInputPerMTok":2,"priceOutputPerMTok":12,"gpqa":0.925,"hle":0.429,"sciCode":0.55,"mmluPro":null,"liveCodeBench":null,"ifBench":0.712244897959184,"terminalBenchHard":0.575757575757576,"terminalBenchV2":0.880149812734082,"tau2":0.862573099415205,"tauBanking":0.402061855670103,"evidenceStatus":"scored","candidateKey":"codex::gpt-5.6-terra","accessMode":"automatic"},{"adapterId":"claude","modelId":"claude-opus-5-5","displayName":"Claude Opus 5.5","slug":"claude-opus-5-5","name":"Claude Opus 5.5 (Max, Default Fallback)","intelligenceIndex":57.6,"codingIndex":null,"mathIndex":null,"priceInputPerMTok":4,"priceOutputPerMTok":20,"gpqa":null,"hle":0.614,"sciCode":0.669,"mmluPro":null,"liveCodeBench":null,"ifBench":null,"terminalBenchHard":null,"terminalBenchV2":null,"tau2":null,"tauBanking":null,"evidenceStatus":"scored","candidateKey":"claude::claude-opus-5-5","accessMode":"automatic"},{"adapterId":"claude","modelId":"claude-sonnet-5-5","displayName":"Claude Sonnet 5.5","slug":"claude-sonnet-5-5","name":"Claude Sonnet 5.5 (Max, Default Fallback)","intelligenceIndex":56,"codingIndex":null,"mathIndex":null,"priceInputPerMTok":2,"priceOutputPerMTok":10,"gpqa":null,"hle":0.55,"sciCode":0.61,"mmluPro":null,"liveCodeBench":null,"ifBench":null,"terminalBenchHard":null,"terminalBenchV2":null,"tau2":null,"tauBanking":null,"evidenceStatus":"scored","candidateKey":"claude::claude-sonnet-5-5","accessMode":"automatic"},{"adapterId":"claude","modelId":"claude-haiku-4-5","displayName":"Claude Haiku 4.5","slug":"claude-4-5-haiku","name":"Claude 4.5 Haiku (Non-reasoning)","intelligenceIndex":15.4,"codingIndex":null,"mathIndex":39,"priceInputPerMTok":1,"priceOutputPerMTok":5,"gpqa":0.646,"hle":0.042,"sciCode":null,"mmluPro":0.8,"liveCodeBench":0.511,"ifBench":0.420408163265306,"terminalBenchHard":0.272727272727273,"terminalBenchV2":null,"tau2":0.324561403508772,"tauBanking":null,"evidenceStatus":"scored","candidateKey":"claude::claude-haiku-4-5","accessMode":"automatic"},{"adapterId":"claude","modelId":"claude-haiku-4-5-20251001","displayName":"Claude Haiku 4.5","slug":"claude-4-5-haiku","name":"Claude 4.5 Haiku (Non-reasoning)","intelligenceIndex":15.4,"codingIndex":null,"mathIndex":39,"priceInputPerMTok":1,"priceOutputPerMTok":5,"gpqa":0.646,"hle":0.042,"sciCode":null,"mmluPro":0.8,"liveCodeBench":0.511,"ifBench":0.420408163265306,"terminalBenchHard":0.272727272727273,"terminalBenchV2":null,"tau2":0.324561403508772,"tauBanking":null,"evidenceStatus":"scored","candidateKey":"claude::claude-haiku-4-5-20251001","accessMode":"automatic"}];
const LIVE_CAPACITY = {"codex":{"adapterId":"codex","quotaRemainingPercent":29,"quotaPaceFactor":0.8317900798267229},"claude":{"adapterId":"claude","quotaRemainingPercent":36,"quotaPaceFactor":0.9715005446307157}};
const liveEligibility = { claude: { ok: true }, codex: { ok: true } };
const pickOf = (team, role) => team.find(entry => entry.role === role)?.primary?.modelId;

for (const [name, build] of Object.entries({
  quality: () => buildAiTeam(LIVE_MODELS, liveEligibility, null, undefined, { providerCapacity: LIVE_CAPACITY }),
  efficient: () => buildEfficientTeam(LIVE_MODELS, liveEligibility, null, { providerCapacity: LIVE_CAPACITY })
})) {
  test(`${name}: live snapshot - projected deficit downshifts demanding roles, light roles stay qualified and cheap, Reviewer is independent`, () => {
    const team = build();
    assert.equal(pickOf(team, "Architect"), "gpt-5.6-terra");
    assert.equal(pickOf(team, "Debugger (fix)"), "gpt-5.6-terra");
    // S1: Test Runner (a build role) lost its frontier pre-pass volume, so the quota balance now swaps the
    // light picks: Explorer takes the cheap Haiku and Test Runner takes Luna (both still cheap and qualified).
    // S31: thin-but-real Luna evidence (HLE + SciCode, floor-clearing) now competes for the light
    // Explorer role and wins it on cost; the quota balance then sends Test Runner to the cheap Haiku
    // (before S31 Luna was dropped as provisional for Explorer and took Test Runner instead).
    assert.match(pickOf(team, "Explorer"), /^claude-haiku-4-5/);
    assert.equal(pickOf(team, "Test Runner"), "gpt-6-luna");
    const builder = team.find(entry => entry.role === "Builder").primary;
    const reviewer = team.find(entry => entry.role === "Reviewer").primary;
    assert.notEqual(reviewer.adapterId, builder.adapterId);
    assert.match(team.find(entry => entry.role === "Architect").reason, /Quota reserve/);
  });
}

for (const [name, build] of Object.entries(builders)) {
  test(`S21 ${name}: task cost overrides conflicting token price and records variant`, () => {
    const rows = [
      { ...m("codex", "fixture-a", 60, 1, 1), costPerTask: 10, costPerTaskVariant: "fixture-a-high" },
      { ...m("claude", "fixture-b", 60, 10, 10), costPerTask: .1, costPerTaskVariant: "fixture-b-medium" }
    ];
    const team = build(rows, "Explorer");
    assert.equal(team[0].primary.modelId, "fixture-b");
    const evaluated = team[0].selection.evaluated.find(row => row.modelId === "fixture-b");
    assert.equal(evaluated.costPerTaskVariant, "fixture-b-medium");
    assert.equal(evaluated.costPerTask, .1);
    assert.ok(!JSON.stringify(team).includes("aa_fixture_secret"));
  });
  test(`S21 ${name}: absent documented data preserves price-only team`, () => {
    const rows = [m("codex", "fixture-a", 60, 1, 1), m("claude", "fixture-b", 60, 10, 10)];
    assert.equal(build(rows, "Explorer")[0].primary.modelId, "fixture-a");
    assert.deepEqual(build(rows.map(row => ({ ...row, costPerTask: null })), "Explorer"), build(rows, "Explorer"));
  });
}

// S22/S23 policy fixtures: task cost, absolute capability and quota are independent.
const capacity = (remaining, pace = 1) => ({ quotaRemainingPercent: remaining, quotaPaceFactor: pace });
const policyRows = [
  { ...m("claude", "claude-opus-5-5", 80, 4, 20), costPerTask: 5 },
  { ...m("claude", "claude-sonnet-5-5", 64, 2, 10), costPerTask: .5 },
  { ...m("codex", "gpt-6-astra", 72, 10, 50), costPerTask: 6 },
  { ...m("codex", "gpt-5.6-terra", 64, 2, 12), costPerTask: .6 },
  { ...m("codex", "below-floor", 40, .1, .1), costPerTask: .01 }
];

test("S22 volume raises Builder cost weight without changing deciding-role dominance", () => {
  assert.ok(roleTradeoffWeights("Builder").cost > ROLE_TRADEOFF_WEIGHTS.standard.cost);
  assert.ok(roleTradeoffWeights("Debugger (fix)").cost > roleTradeoffWeights("Architect").cost);
  assert.ok(roleTradeoffWeights("Architect").capability > roleTradeoffWeights("Builder").capability);
});

for (const [name, build] of Object.entries(builders)) {
  test(`S22 ${name}: Opus is not Builder at Claude 80 / Codex 10`, () => {
    const team = build(policyRows, "Builder", { providerCapacity: { claude: capacity(80), codex: capacity(10, .1) } });
    assert.equal(team[0].primary.modelId, "claude-sonnet-5-5");
  });
  test(`S23 ${name}: pressure continuously shifts demanding-role cost weights`, () => {
    const read = pace => build(policyRows.filter(row => row.adapterId === "codex"), "Architect", {
      providerCapacity: { codex: capacity(50, pace) }
    })[0].selection.evaluated.find(row => row.modelId === "gpt-6-astra").tradeoffWeights;
    assert.ok(read(.8).cost > read(1).cost);
    assert.ok(read(.4).cost > read(.8).cost);
  });
  test(`S23 ${name}: reserve downshifts within provider and respects floor`, () => {
    for (const role of ["Architect", "Debugger (fix)", "Reviewer"]) {
      const pick = build(policyRows.filter(row => row.adapterId === "codex"), role, {
        providerCapacity: { codex: capacity(10, .1) }
      })[0];
      assert.equal(pick.primary.modelId, "gpt-5.6-terra");
      assert.match(pick.reason, /reserve/i);
    }
  });
  test(`S23 ${name}: reserve moves to another provider with headroom`, () => {
    const team = build(policyRows, "Architect", { providerCapacity: { claude: capacity(80), codex: capacity(10, .1) } });
    assert.equal(team[0].primary.adapterId, "claude");
    assert.match(team[0].reason, /headroom/i);
  });
  test(`S23 ${name}: healthy quota preserves demanding capability picks`, () => {
    for (const role of ["Architect", "Debugger (fix)", "Reviewer"]) {
      const options = { providerCapacity: { claude: capacity(80), codex: capacity(80) } };
      assert.equal(build(policyRows, role, options)[0].primary.modelId, build(policyRows, role)[0].primary.modelId);
    }
  });
  test(`S23 ${name}: explanation exposes volume, pressure and no cheaper qualified option`, () => {
    const team = build([policyRows[0]], "Architect", { providerCapacity: { claude: capacity(10, .1) } });
    assert.match(team[0].reason, /volume weight 0.2/i);
    assert.match(team[0].reason, /pressure shift/i);
    assert.match(team[0].reason, /no qualified cheaper model/i);
    assert.equal(team[0].selection.volumeWeight, .2);
    assert.ok(team[0].selection.evaluated[0].pressureShift > 0);
  });
}

for (const [name, build] of Object.entries({
  quality: (rows, options) => buildAiTeam(rows, eligibility, null, undefined, options),
  efficient: (rows, options) => buildEfficientTeam(rows, eligibility, null, options)
})) {
  test(`S22 ${name}: provider balancing accounts for role volume rather than count`, () => {
    const rows = ["claude", "codex"].flatMap(provider => [0, 1, 2].map(i => ({
      ...m(provider, `${provider}-${i}`, 70, 1, 1), terminalBenchV2: .8
    })));
    const team = build(rows, { providerCapacity: { claude: capacity(80), codex: capacity(80) } });
    const volumes = { "Debugger (diagnosis)": .3, "Test Designer": .6, Builder: 1, "Test Runner": .6, Explorer: .5, "Debugger (fix)": .3, Architect: .2, Reviewer: .2 };
    const loads = { claude: 0, codex: 0 };
    for (const entry of team) {
      assert.equal(entry.selection.volumeWeight, volumes[entry.role]);
      if (entry.primary) loads[entry.primary.adapterId] += volumes[entry.role];
    }
    assert.ok(Math.abs(loads.claude - loads.codex) <= .6, JSON.stringify(loads));
    assert.equal(team.find(entry => entry.role === "Reviewer").selection.totalVolume, 3.7);
  });
  test(`S23 ${name}: single-provider pressure keeps full team except Reviewer hard gate`, () => {
    const rows = policyRows.filter(row => row.adapterId === "codex").map(row => ({ ...row, terminalBenchV2: row.modelId === "below-floor" ? .4 : .8 }));
    const team = build(rows, { providerCapacity: { codex: capacity(10, .1) } });
    assert.equal(team.length, 8);
    for (const entry of team) {
      if (entry.role === "Reviewer") assert.equal(entry.primary, null);
      else assert.equal(entry.primary.modelId, ["Explorer", "Test Runner"].includes(entry.role) ? "below-floor" : "gpt-5.6-terra");
    }
  });
}

for (const [name, build] of Object.entries(builders)) {
  test(`S23 ${name}: project floor remains binding under reserve pressure`, () => {
    const team = build(policyRows.filter(row => row.adapterId === "claude"), "Architect", {
      providerCapacity: { claude: capacity(10, .1) }, projectDemand: { floors: { Architect: .75 }, reasons: {} }
    });
    assert.equal(team[0].primary.modelId, "claude-opus-5-5");
    assert.match(team[0].reason, /no qualified cheaper model/);
  });
}

for (const [name, build] of Object.entries({
  quality: (roles, options) => buildAiTeam(policyRows, eligibility, null, roles, options),
  efficient: (roles, options) => buildEfficientTeam(policyRows, eligibility, null, { ...options, roleCapabilities: roles })
})) {
  test(`S23 ${name}: Claude Reviewer downshifts without violating independence`, () => {
    const team = build({ Builder: { required: ["reasoning"] }, Reviewer: { required: ["reasoning"] } }, {
      providerCapacity: { claude: capacity(10, .1), codex: capacity(80) }
    });
    assert.equal(team.find(entry => entry.role === "Builder").primary.adapterId, "codex");
    const reviewer = team.find(entry => entry.role === "Reviewer");
    assert.equal(reviewer.primary.modelId, "claude-sonnet-5-5");
    assert.match(reviewer.reason, /reserve/);
  });
}

// S29-S31 fixtures: synthetic, shaped after the 2026-10-16 live AA values but not a data snapshot.
// One role per build keeps cross-role diversity out of the comparison under test.
const full = {
  quality: (rows, role) => buildAiTeam(rows, eligibility, null, { [role]: ROLE_CAPABILITIES[role] }),
  efficient: (rows, role) => buildEfficientTeam(rows, eligibility, null, { roleCapabilities: { [role]: ROLE_CAPABILITIES[role] } })
};
const pick = (build, rows, role) => build(rows, role)[0];
const row = (adapterId, modelId, fields) => ({ adapterId, modelId, priceInputPerMTok: 2, priceOutputPerMTok: 10, accessMode: "automatic", ...fields });
// Opposite strengths on coding vs terminal, so only the agentic signal can separate them.
const agenticPair = (agenticA, agenticB) => [
  row("claude", "agent-a", { sciCode: .70, terminalBenchV2: .60, agenticIndex: agenticA }),
  row("codex", "agent-b", { sciCode: .69, terminalBenchV2: .62, agenticIndex: agenticB })
];

for (const [name, build] of Object.entries(full)) {
  test(`S29 ${name}: agentic index decides a Builder near-tie between equally priced models`, () => {
    assert.equal(pick(build, agenticPair(70, 40), "Builder").primary.modelId, "agent-a");
    assert.equal(pick(build, agenticPair(40, 70), "Builder").primary.modelId, "agent-b");
  });
  test(`S29 ${name}: a missing agentic index is penalized with a named reason, never excluded`, () => {
    const rows = [
      row("claude", "no-agentic", { sciCode: .80, terminalBenchV2: .80 }),
      row("codex", "with-agentic", { sciCode: .60, terminalBenchV2: .60, agenticIndex: 60 })
    ];
    const builder = pick(build, rows, "Builder");
    assert.equal(builder.primary.modelId, "no-agentic");
    assert.match(builder.reason, /Missing agenticExecution evidence.*penalty/);
  });
  test(`S29 ${name}: no candidate reporting agentic data is not a per-model deficit`, () => {
    const rows = agenticPair(null, null);
    assert.doesNotMatch(pick(build, rows, "Builder").reason ?? "", /agenticExecution/);
  });
  test(`S30 ${name}: Test Runner prefers the lower end-to-end latency at equal capability and price`, () => {
    const rows = (slow, fast) => [
      row("claude", "slow-model", { sciCode: .6, terminalBenchV2: .6, endToEndSeconds: slow }),
      row("codex", "fast-model", { sciCode: .6, terminalBenchV2: .6, endToEndSeconds: fast })
    ];
    assert.equal(pick(build, rows(60, 20), "Test Runner").primary.modelId, "fast-model");
    assert.equal(pick(build, rows(20, 60), "Test Runner").primary.modelId, "slow-model");
  });
  test(`S30 ${name}: Architect ignores latency`, () => {
    const rows = latency => [
      row("claude", "slow-model", { gpqa: .8, hle: .6, sciCode: .7, agenticIndex: 60, endToEndSeconds: latency ? 90 : null }),
      row("codex", "fast-model", { gpqa: .8, hle: .6, sciCode: .7, agenticIndex: 60, endToEndSeconds: latency ? 10 : null })
    ];
    assert.equal(pick(build, rows(true), "Architect").primary.modelId, pick(build, rows(false), "Architect").primary.modelId);
    assert.equal(pick(build, rows(true), "Architect").primary.modelId, "slow-model");
  });
}

// S31: Luna-shaped thin evidence (HLE + SciCode only, very cheap) against broader, pricier candidates.
const lunaShaped = fields => row("codex", "luna-shaped", { intelligenceIndex: 38.1, hle: .385, sciCode: .546, priceInputPerMTok: .1, priceOutputPerMTok: .5, ...fields });
const haiku45Shaped = row("claude", "haiku-shaped", { intelligenceIndex: 15.4, gpqa: .646, hle: .042, mmluPro: .80, liveCodeBench: .511, ifBench: .42, priceInputPerMTok: 1, priceOutputPerMTok: 5 });
const terraShaped = row("codex", "terra-shaped", { intelligenceIndex: 42.1, gpqa: .925, hle: .429, sciCode: .55, ifBench: .712, priceInputPerMTok: 2, priceOutputPerMTok: 12 });
for (const [name, build] of Object.entries(full)) {
  test(`S31 ${name}: thin-but-real evidence wins Explorer when cost dominates and the floor is cleared`, () => {
    const explorer = pick(build, [lunaShaped(), haiku45Shaped, terraShaped], "Explorer");
    assert.equal(explorer.primary.modelId, "luna-shaped");
  });
  test(`S31 ${name}: thin evidence below the light floor (.35) never wins Explorer`, () => {
    const explorer = pick(build, [lunaShaped({ hle: .2 }), haiku45Shaped, terraShaped], "Explorer");
    assert.notEqual(explorer.primary.modelId, "luna-shaped");
  });
  test(`S31 ${name}: demanding roles still prefer broad comparable evidence over thin cheap evidence`, () => {
    const architect = pick(build, [lunaShaped(), terraShaped], "Architect");
    assert.equal(architect.primary.modelId, "terra-shaped");
  });
}

// Regression: a healthy two-provider pool without agentic or latency data keeps its Architect pick.
for (const [name, build] of Object.entries({
  quality: () => buildAiTeam(LIVE_MODELS, liveEligibility, null, undefined, {}),
  efficient: () => buildEfficientTeam(LIVE_MODELS, liveEligibility, null, {})
})) {
  test(`S29 ${name}: healthy two-provider Architect pick is unchanged by the new signals`, () => {
    assert.equal(pickOf(build(), "Architect"), "gpt-6-astra");
  });
}

// S33: applied per-role weights are exposed in decisionEvidence and the reason; the S20 penalty is applied once.
// Codex-only: under S34 (.55 Builder floor) the full pool's Builder is Sonnet, whose only
// comparable signal is coding (a single weight); Codex Builders carry coding + terminal evidence.
const codexModels = LIVE_MODELS.filter(model => model.adapterId === "codex");
for (const [name, build] of Object.entries({
  quality: () => buildAiTeam(codexModels, liveEligibility, null, undefined, {}),
  efficient: () => buildEfficientTeam(codexModels, liveEligibility, null, {})
})) {
  test(`S33 ${name}: decisionEvidence and reason expose the applied role weights`, () => {
    const builder = build().find(entry => entry.role === "Builder");
    const weights = builder.decisionEvidence.weights;
    assert.ok(weights && Object.keys(weights).length >= 2);
    assert.ok(Math.abs(Object.values(weights).reduce((a, b) => a + b, 0) - 1) < 1e-4);
    assert.match(builder.reason, /Role weights: /);
  });
}

test("S33 quality: a model missing a required signal is penalized once, with weights renormalized over the rest", () => {
  const weak = row("codex", "agentic-weak", { intelligenceIndex: 40, sciCode: .4, terminalBenchV2: .5, agenticIndex: 40, priceInputPerMTok: 1, priceOutputPerMTok: 1 });
  const strong = row("claude", "no-agentic-strong", { intelligenceIndex: 70, sciCode: .7, terminalBenchV2: .9, priceInputPerMTok: 1, priceOutputPerMTok: 1 });
  const builder = buildAiTeam([weak, strong], liveEligibility, null, { Builder: { required: ["coding", "terminalExecution", "agenticExecution"] } }, {}).find(e => e.role === "Builder");
  assert.equal(builder.primary.modelId, "no-agentic-strong");
  assert.equal(builder.decisionEvidence.weights.agenticExecution, undefined);
  assert.ok(Math.abs(builder.decisionEvidence.weights.coding - 0.45 / 0.70) < 1e-4);
  assert.equal(builder.reason.match(/penalty/g).length, 1);
});


// S39: live-shaped normalized demanding scores; extra close qualified Terra
// isolates capability dominance from the .65 floor (actual live Terra is .6135).
const criticalRows = [
  { ...m("codex", "gpt-6-astra", 65.95, 10, 50), codingIndex: 40 },
  { ...m("codex", "gpt-5.6-terra", 61.35, 2, 12), codingIndex: 40 },
  { ...m("codex", "gpt-6.1-sol", 54, 2, 10), codingIndex: 40 },
  { ...m("claude", "claude-opus-5-5", 64.15, 4, 20), codingIndex: 90 },
  { ...m("claude", "claude-sonnet-5-5", 58, 2, 10), codingIndex: 80 }
];
const assessedDemand = level => projectDemand({ demandAssessment: {
  categories: { domainComplexity: { level } }
} });
const criticalCaps = {
  Architect: { required: ["reasoning"] },
  Builder: { required: ["coding"] },
  Reviewer: { required: ["reasoning"] },
  "Debugger (fix)": { required: ["reasoning"] }
};
const criticalBuilders = {
  quality: (rows, options) => buildAiTeam(rows, eligibility, null, criticalCaps, options),
  efficient: (rows, options) => buildEfficientTeam(rows, eligibility, null, { ...options, roleCapabilities: criticalCaps })
};
test("S39 critical weights dominate capability only for demanding roles; high and low preserve existing weights", () => {
  for (const role of ["Architect", "Reviewer", "Debugger (fix)"]) {
    assert.deepEqual(roleTradeoffWeights(role, assessedDemand(5)), { capability: 1, cost: 0 });
    assert.deepEqual(roleTradeoffWeights(role, assessedDemand(4)),
      role === "Debugger (fix)" ? { capability: .855, cost: .145 } : { capability: .95, cost: .05 });
    assert.deepEqual(roleTradeoffWeights(role, assessedDemand(2)), roleTradeoffWeights(role));
    assert.ok(roleTradeoffWeights(role, assessedDemand(5), .8).cost >= .8);
  }
  for (const role of ["Builder", "Explorer", "Test Runner"]) {
    assert.deepEqual(roleTradeoffWeights(role, assessedDemand(5)), roleTradeoffWeights(role));
  }
});
for (const [name, build] of Object.entries(criticalBuilders)) {
  test(`S39 ${name}: critical live-shaped team uses Astra demanding roles and independent Reviewer`, () => {
    const demand = assessedDemand(5);
    const team = build(criticalRows, { projectDemand: demand });
    const builder = team.find(entry => entry.role === "Builder");
    assert.equal(builder.primary.adapterId, "claude");
    for (const role of ["Architect", "Debugger (fix)", "Reviewer"]) {
      assert.equal(demand.floors[role], .65);
      const entry = team.find(entry => entry.role === role);
      assert.equal(entry.primary.modelId, "gpt-6-astra");
      assert.doesNotMatch(entry.reason, /No candidate meets/);
      assert.match(entry.reason, /critical demand.*strongest available/i);
    }
    assert.notEqual(team.find(entry => entry.role === "Reviewer").primary.adapterId, builder.primary.adapterId);
  });
  test(`S39 ${name}: critical strongest qualified model beats a near-identical cheaper model`, () => {
    const rows = criticalRows.map(row => row.modelId === "gpt-5.6-terra" ? { ...row, intelligenceIndex: 65.5 } : row);
    const team = build(rows, { projectDemand: assessedDemand(5) });
    assert.equal(pickOf(team, "Architect"), "gpt-6-astra");
    assert.equal(pickOf(team, "Reviewer"), "gpt-6-astra");
  });
  test(`S39 ${name}: low demand leaves team selection unchanged`, () => {
    const low = build(criticalRows, { projectDemand: assessedDemand(2) });
    const base = build(criticalRows, {});
    assert.deepEqual(low.map(e => [e.role, e.primary, e.reason]), base.map(e => [e.role, e.primary, e.reason]));
  });
  test(`S39 ${name}: critical demand retains S23 quota reserve downshift`, () => {
    const rows = criticalRows.filter(row => row.adapterId === "codex")
      .map(row => row.modelId === "gpt-5.6-terra" ? { ...row, intelligenceIndex: 65.5 } : row);
    const team = build(rows, { projectDemand: assessedDemand(5),
      providerCapacity: { codex: { quotaRemainingPercent: 5, quotaPaceFactor: .5 } } });
    assert.equal(pickOf(team, "Architect"), "gpt-5.6-terra");
    assert.match(team.find(e => e.role === "Architect").reason, /Quota reserve/);
    assert.equal(team.find(e => e.role === "Reviewer").primary, null);
  });
}

// C20b correction: live-shaped sparse AA agentic evidence, not provider-name policy.
const correctionRows = () => [
  { ...m("codex", "gpt-6-astra", 66, 10, 50), codingIndex: 58, terminalBenchV2: .58, agenticIndex: 70, costPerTask: 6 },
  { ...m("codex", "gpt-5.6-terra", 64, 2, 12), codingIndex: 56, terminalBenchV2: .56, costPerTask: .6 },
  { ...m("codex", "gpt-6.1-sol", 63, 2, 10), codingIndex: 55.5, terminalBenchV2: .555, costPerTask: .4 },
  { ...m("claude", "claude-opus-5-5", 64, 4, 20), costPerTask: 4.88 },
  { ...m("claude", "claude-sonnet-5-5", 58, 2, 10), costPerTask: .48 }
];
const correctionCapacity = { codex: capacity(61), claude: capacity(24) };
const correctionDemand = projectDemand({ demandAssessment: { categories: { aiIntegration: { level: 4 } } } });
const correctionBuild = (name, rows, roleCapabilities, options = {}) => name === "quality"
  ? buildAiTeam(rows, eligibility, null, roleCapabilities, { providerCapacity: correctionCapacity, ...options })
  : buildEfficientTeam(rows, eligibility, null, { roleCapabilities, providerCapacity: correctionCapacity, ...options });

for (const name of ["quality", "efficient"]) {
  for (const role of ["Builder", "Refactorer", "DevOps"]) {
    test(`C20b ${name}: sparse added agentic signal cannot force Astra into ${role}`, () => {
      const team = correctionBuild(name, correctionRows(), { [role]: ROLE_CAPABILITIES[role] }, { projectDemand: correctionDemand });
      const entry = team[0];
      assert.notEqual(entry.primary.modelId, "gpt-6-astra");
      const terra = entry.selection.evaluated.find(row => row.modelId === "gpt-5.6-terra");
      assert.ok(terra.gapValue >= .55, "Terra qualifies on base coding and terminal capabilities");
      assert.doesNotMatch(entry.reason, /missing.*agenticExecution/i);
      assert.ok(!Object.hasOwn(entry.decisionEvidence.coverage, "agenticExecution"));
      assert.ok(!Object.hasOwn(entry.decisionEvidence.weights, "agenticExecution"));
      assert.ok(Math.abs(Object.values(entry.decisionEvidence.weights).reduce((sum, value) => sum + value, 0) - 1) < 1e-9);
    });
  }
  test(`C20b ${name}: agentic remains required and decisive with majority coverage`, () => {
    const rows = correctionRows().slice(0, 3).map((row, i) => ({ ...row, agenticIndex: i === 0 ? 90 : 10 }));
    const entry = correctionBuild(name, rows, { DevOps: ROLE_CAPABILITIES.DevOps })[0];
    assert.equal(entry.primary.modelId, "gpt-6-astra");
    assert.ok(Object.hasOwn(entry.decisionEvidence.coverage, "agenticExecution"));
    assert.ok(entry.selection.evaluated.find(row => row.modelId === "gpt-5.6-terra").gapValue < .55);
  });
  test(`C20b ${name}: Emma reviewers use Opus floor-miss fallback independently of both Builders`, () => {
    const roleCapabilities = {
      "Frontend Builder": { required: ["terminalExecution"] },
      "Backend Builder": { required: ["terminalExecution"] },
      Reviewer: { required: ["reasoning"] },
      "Security Reviewer": { required: ["reasoning"] }
    };
    const team = correctionBuild(name, correctionRows(), roleCapabilities, {
      projectDemand: projectDemand({ demandAssessment: { categories: { actionsAndSecurity: { level: 4 } } } })
    });
    for (const role of ["Frontend Builder", "Backend Builder"]) assert.equal(team.find(row => row.role === role).primary.adapterId, "codex");
    for (const role of ["Reviewer", "Security Reviewer"]) {
      const entry = team.find(row => row.role === role);
      assert.equal(entry.primary?.modelId, "claude-opus-5-5");
      assert.match(entry.reason, /below.*floor.*0\.65.*independen/i);
      assert.equal(entry.decisionEvidence.decisionType, "fallback");
    }
  });
  // S10/L18: the independence rule degrades down a ladder with a warning instead of blocking.
  test(`C20b ${name}: decisively worse independent reviewers degrade with a not-independent warning`, () => {
    const rows = correctionRows().filter(row => row.modelId !== "claude-opus-5-5");
    const team = correctionBuild(name, rows, {
      Builder: { required: ["terminalExecution"] }, Reviewer: { required: ["reasoning"] },
      "Security Reviewer": { required: ["reasoning"] }
    }, { projectDemand: correctionDemand });
    const builder = team.find(row => row.role === "Builder");
    for (const role of ["Reviewer", "Security Reviewer"]) {
      const entry = team.find(row => row.role === role);
      assert.notEqual(entry.primary, null);
      assert.notEqual(entry.primary.modelId, builder.primary.modelId);
      assert.equal(entry.assignmentState, "degraded");
      assert.match(entry.reason, /not provider-independent/);
    }
  });
  test(`C20b ${name}: catalog roles respect the model cap before narrowing by cost`, () => {
    const rows = correctionRows().slice(0, 3).map(row => ({ ...row, intelligenceIndex: 66, codingIndex: 66, terminalBenchV2: .66, agenticIndex: 66 }));
    const roles = Object.fromEntries(["Planner", "DevOps", "Refactorer"].map(role => [role, { required: ["coding"] }]));
    const team = correctionBuild(name, rows, roles);
    const usage = new Map();
    for (const entry of team) usage.set(entry.primary.modelId, (usage.get(entry.primary.modelId) ?? 0) + 1);
    assert.ok([...usage.values()].every(count => count <= 2), "qualified alternatives must prevent a third catalog assignment");
    assert.ok(team.some(entry => entry.selection.evaluated.some(row => row.blockedBy === "model_cap")));
  });
}

test("C20b S35: aiIntegration 4 project Builder keeps cheaper base-qualified candidates", () => {
  const profile = { fingerprint: "sparse", demandAssessment: { categories: { aiIntegration: { level: 4 } } },
    roleRequirements: [{ role: "Builder", capabilities: ["coding", "terminalExecution", "agenticExecution"] }] };
  const strategy = buildProjectStrategy(profile, { scoredAll: correctionRows(), eligibility, providerCapacity: correctionCapacity }, {});
  const entry = strategy.projectTeam.find(row => row.role === "Builder");
  assert.notEqual(entry.model.modelId, "gpt-6-astra");
});
for (const name of ["quality", "efficient"]) test(`C20b ${name}: floor-miss independence chooses strongest, not cheapest inside the band`, () => {
  const rows = correctionRows().map(row => row.modelId === "claude-sonnet-5-5" ? { ...row, intelligenceIndex: 63.99 } : row);
  const team = correctionBuild(name, rows, { Builder: { required: ["terminalExecution"] }, Reviewer: { required: ["reasoning"] } }, { projectDemand: correctionDemand });
  assert.equal(team.find(row => row.role === "Reviewer").primary?.modelId, "claude-opus-5-5");
});

for (const name of ["quality", "efficient"]) {
  test(`C20b ${name}: exactly half reporting keeps catalog agentic required`, () => {
    const rows = correctionRows().slice(0, 4).map((row, i) => i === 1 ? { ...row, agenticIndex: 50 } : row);
    const entry = correctionBuild(name, rows, { DevOps: ROLE_CAPABILITIES.DevOps })[0];
    assert.ok(Object.hasOwn(entry.decisionEvidence.coverage, "agenticExecution"));
  });
  test(`C20b ${name}: unavailable reporting candidates do not inflate role coverage`, () => {
    const rows = correctionRows().map(row => row.adapterId === "claude" ? { ...row, agenticIndex: 70 } : row);
    const availability = { codex: { ok: true }, claude: { ok: false } };
    const roles = { DevOps: ROLE_CAPABILITIES.DevOps };
    const entry = (name === "quality"
      ? buildAiTeam(rows, availability, null, roles, { providerCapacity: correctionCapacity })
      : buildEfficientTeam(rows, availability, null, { roleCapabilities: roles, providerCapacity: correctionCapacity }))[0];
    assert.ok(!Object.hasOwn(entry.decisionEvidence.coverage, "agenticExecution"));
    assert.notEqual(entry.primary.modelId, "gpt-6-astra");
  });
}

// S23 live-shaped (2026-10-16): Codex 5h 8% / weekly 51%; Claude 5h 47% / weekly 21% (reset 3 days).
// Both providers are projected to exhaust, so the binary "headroom" test finds none. Codex is already
// below the 10% reserve of its tightest window, so its roles must move to the provider still above it.
const liveNow = Date.parse("2026-10-16T20:00:00Z");
const liveWindow = (name, remainingPercent, hours) => ({ name, remainingPercent, resetsAt: (liveNow + hours * 3600000) / 1000 });
const liveCapacity = codexResetHours => buildProviderCapacity({ codex: 8, claude: 21 }, {
  codex: { windows: [liveWindow("5h", 8, codexResetHours), liveWindow("weekly", 51, 100)] },
  claude: { windows: [liveWindow("Current session", 47, 3), liveWindow("Current week (all models)", 21, 72)] }
}, liveNow);
const liveRows = [
  { ...m("claude", "claude-opus-5-5", 80, 4, 20), costPerTask: 6 },
  { ...m("claude", "claude-sonnet-5-5", 64, 2, 10), costPerTask: 5.4 },
  { ...m("claude", "claude-haiku-4-5", 45, 1, 5), costPerTask: 1 },
  { ...m("codex", "gpt-6-astra", 72, 10, 50), costPerTask: 3.2 },
  { ...m("codex", "gpt-6-luna", 40, .1, .5), costPerTask: .07 }
];
for (const [name, build] of Object.entries(builders)) {
  for (const hours of [.75, 2, 4]) {
    test(`S23 live ${name}: Codex below the 10% reserve (reset in ${hours}h) hands Planner/Refactorer to Claude`, () => {
      const providerCapacity = liveCapacity(hours);
      for (const role of ["Planner", "Refactorer", "Architect"]) {
        const pick = build(liveRows, role, { providerCapacity })[0];
        assert.equal(pick.primary.adapterId, "claude", `${role} stayed on ${pick.primary.modelId}`);
        // S1: Refactorer is a build role and never held Codex's frontier astra, so it lands on Claude
        // without a reserve handoff; the handoff reason applies to the analysis roles only.
        if (role !== "Refactorer") assert.match(pick.reason, /above the 10% reserve/);
      }
    });
  }
  test(`S23 live ${name}: a reset under 15 minutes keeps Codex usable`, () => {
    const pick = build(liveRows, "Planner", { providerCapacity: liveCapacity(.2) })[0];
    assert.equal(pick.primary.modelId, "gpt-6-astra");
  });
  test(`S23 live ${name}: healthy quota leaves assignments unchanged`, () => {
    const providerCapacity = { claude: capacity(80), codex: capacity(80) };
    for (const role of ["Planner", "Refactorer", "Architect"]) {
      assert.equal(build(liveRows, role, { providerCapacity })[0].primary.modelId, build(liveRows, role)[0].primary.modelId);
    }
  });
}

// S47 (C7c): measured role cost and measured work volume.
const priced = (adapterId, modelId, costPerTask) => ({ ...m(adapterId, modelId, 62, costPerTask, costPerTask * 5), costPerTask });
const measuredOf = entries => new Map(Object.entries(entries).map(([key, medianCostUsd]) => [key, { runs: 5, medianCostUsd, medianTokens: 1000 }]));
const telemetryFor = (role, entries, volumes = null) => ({ roles: { [role]: measuredOf(entries) }, volumes });

for (const [name, build] of Object.entries(builders)) {
  test(`${name}: measured role cost flips a Builder pick the AA cost favored and says so`, () => {
    const rows = [priced("claude", "cheap", 1), priced("codex", "pricey", 2)];
    assert.equal(build(rows, "Builder")[0].primary.modelId, "cheap");
    const entry = build(rows, "Builder", { roleTelemetry: telemetryFor("Builder", { "claude::cheap": 10, "codex::pricey": 1 }) })[0];
    assert.equal(entry.primary.modelId, "pricey");
    assert.match(entry.reason, /Measured role cost from 5 runs\./);
  });
  test(`${name}: measured data with no overlap with the pool leaves the team identical`, () => {
    const rows = [priced("claude", "cheap", 1), priced("codex", "pricey", 2)];
    const baseline = build(rows, "Builder");
    assert.deepEqual(build(rows, "Builder", { roleTelemetry: telemetryFor("Builder", { "claude::ghost": 99 }) }), baseline);
  });
  test(`${name}: absent or empty roleTelemetry leaves the team identical`, () => {
    const rows = [priced("claude", "cheap", 1), priced("codex", "pricey", 2), terra, opus];
    const baseline = build(rows, "Builder");
    assert.deepEqual(build(rows, "Builder", { roleTelemetry: null }), baseline);
    assert.deepEqual(build(rows, "Builder", { roleTelemetry: { roles: {}, volumes: null } }), baseline);
  });
  test(`${name}: measured volumes replace the assumed ones only for the roles measured`, () => {
    const rows = [priced("claude", "cheap", 1), priced("codex", "pricey", 2)];
    const roleCapabilities = { Builder: { required: ["reasoning"] }, "Test Runner": { required: ["reasoning"] } };
    const run = options => (name === "quality"
      ? buildAiTeam(rows, eligibility, null, roleCapabilities, options)
      : buildEfficientTeam(rows, eligibility, null, { ...options, roleCapabilities }));
    const assumed = Object.fromEntries(run({}).map(entry => [entry.role, entry.selection]));
    assert.equal(assumed["Test Runner"].volumeWeight, .6);
    const measured = Object.fromEntries(run({ roleTelemetry: { roles: {}, volumes: { Builder: 1, "Test Runner": 2 } } }).map(entry => [entry.role, entry.selection]));
    assert.equal(measured["Test Runner"].volumeWeight, 2);
    assert.equal(measured.Builder.volumeWeight, 1);
    assert.equal(measured["Test Runner"].totalVolume, 3);
  });
}

test("withQuotaCosts: models without measured data are scaled by the median measured/AA ratio", () => {
  const entries = [priced("claude", "a", 1), priced("codex", "b", 2), priced("codex", "c", 3)].map(model => ({ model }));
  const weights = withQuotaCosts(entries, null, undefined, new Map([["claude::a", 10], ["codex::b", 4]]));
  assert.deepEqual(weights.map(entry => entry.quotaCostWeight), [10, 4, 18]);
  assert.deepEqual(weights.map(entry => entry.costSource), ["measured-role-cost", "measured-role-cost", "aa-cost-per-task"]);
});

test("withQuotaCosts: measured costs with no model in common with the pool are ignored", () => {
  const entries = [priced("claude", "a", 1), priced("codex", "b", 2)].map(model => ({ model }));
  assert.deepEqual(withQuotaCosts(entries, null, undefined, new Map([["codex::ghost", 50]])), withQuotaCosts(entries, null));
  assert.deepEqual(withQuotaCosts(entries, null, undefined, new Map()), withQuotaCosts(entries, null));
});

test("buildProjectStrategy forwards roleTelemetry to both team builders", () => {
  const rows = [priced("claude", "cheap", 1), priced("codex", "pricey", 2)];
  const profile = { fingerprint: "synthetic", roleRequirements: [{ role: "Builder", capabilities: ["reasoning"] }] };
  const analyst = { model: { adapterId: "codex", modelId: "manual" }, selectionSource: "manual" };
  const base = { scoredAll: rows, eligibility };
  const plain = buildProjectStrategy(profile, base, analyst);
  const measured = buildProjectStrategy(profile, { ...base, roleTelemetry: telemetryFor("Builder", { "claude::cheap": 10, "codex::pricey": 1 }) }, analyst);
  for (const key of ["qualityTeam", "efficientTeam"]) {
    assert.equal(plain[key].find(entry => entry.role === "Builder").model.modelId, "cheap");
    assert.equal(measured[key].find(entry => entry.role === "Builder").model.modelId, "pricey");
  }
});


test("C7c correction: above-Builder measured volume keeps all role weights bounded", () => {
  const volumes = { Builder: 1, "Test Runner": 2 };
  for (const role of Object.keys(ROLE_CAPABILITIES)) {
    for (const pressure of [0, .5, 1]) {
      const weights = roleTradeoffWeights(role, null, pressure, volumes);
      assert.ok(weights.capability >= 0 && weights.capability <= 1, `${role} capability ${weights.capability}`);
      assert.ok(weights.cost >= 0 && weights.cost <= 1, `${role} cost ${weights.cost}`);
      assert.equal(weights.capability + weights.cost, 1);
      assert.deepEqual(weights, roleTradeoffWeights(role, null, pressure, { Builder: 1, "Test Runner": 1 }));
    }
  }
});

test("C7c correction: stronger equal-cost Test Runner wins above Builder volume in both selectors", () => {
  const rows = [m("codex", "weaker", 60, 2, 10), m("codex", "stronger", 70, 2, 10)];
  for (const name of ["efficient", "quality"]) {
    assert.equal(builders[name](rows, "Test Runner", { roleTelemetry: { roles: {}, volumes: { Builder: 1, "Test Runner": 2 } } })[0].primary.modelId, "stronger", name);
  }
});
