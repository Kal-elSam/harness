import test from "node:test";
import assert from "node:assert/strict";
import { buildAiTeam, buildEfficientTeam } from "../src/global/intelligence/model-intelligence.js";
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
  assert.ok(roleTradeoffWeights("Tester").cost >= light.cost);
  assert.ok(roleTradeoffWeights("Builder").cost > standard.cost);
});

test("project profile shifts weight toward capability only for roles it raised", () => {
  const demand = projectDemand({ architecture: { pattern: "Layered or Clean Architecture" }, risks: [] });
  assert.ok(roleTradeoffWeights("Architect", demand).capability > ROLE_TRADEOFF_WEIGHTS.demanding.capability);
  assert.deepEqual(roleTradeoffWeights("Explorer", demand), roleTradeoffWeights("Explorer"));
});

for (const [name, build] of Object.entries(builders)) {
  test(`${name}: Architect prefers the stronger model over the cheapest qualified one`, () => {
    const pick = build([terra, opus, astra], "Architect")[0].primary;
    assert.notEqual(pick.modelId, "terra");
  });
  test(`${name}: an extreme cost gap still lets the cheaper Architect win`, () => {
    const pick = build([terra, m("claude", "opus-xl", 62, 400, 2000)], "Architect")[0].primary;
    assert.equal(pick.modelId, "terra");
  });
  test(`${name}: Explorer and Tester stay on the cheap model`, () => {
    for (const role of ["Explorer", "Tester"]) {
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
    assert.equal(pickOf(team, "Debugger"), "gpt-5.6-terra");
    assert.match(pickOf(team, "Explorer"), /^claude-haiku-4-5/);
    assert.equal(pickOf(team, "Tester"), "gpt-6-luna");
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
  assert.ok(roleTradeoffWeights("Debugger").cost > roleTradeoffWeights("Architect").cost);
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
    for (const role of ["Architect", "Debugger", "Reviewer"]) {
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
    for (const role of ["Architect", "Debugger", "Reviewer"]) {
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
    const volumes = { Builder: 1, Tester: .6, Explorer: .5, Debugger: .3, Architect: .2, Reviewer: .2 };
    const loads = { claude: 0, codex: 0 };
    for (const entry of team) {
      assert.equal(entry.selection.volumeWeight, volumes[entry.role]);
      if (entry.primary) loads[entry.primary.adapterId] += volumes[entry.role];
    }
    assert.ok(Math.abs(loads.claude - loads.codex) <= .6, JSON.stringify(loads));
    assert.equal(team.find(entry => entry.role === "Reviewer").selection.totalVolume, 2.8);
  });
  test(`S23 ${name}: single-provider pressure keeps full team except Reviewer hard gate`, () => {
    const rows = policyRows.filter(row => row.adapterId === "codex").map(row => ({ ...row, terminalBenchV2: row.modelId === "below-floor" ? .4 : .8 }));
    const team = build(rows, { providerCapacity: { codex: capacity(10, .1) } });
    assert.equal(team.length, 6);
    for (const entry of team) {
      if (entry.role === "Reviewer") assert.equal(entry.primary, null);
      else assert.equal(entry.primary.modelId, ["Explorer", "Tester"].includes(entry.role) ? "below-floor" : "gpt-5.6-terra");
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
