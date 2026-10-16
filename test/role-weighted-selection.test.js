import test from "node:test";
import assert from "node:assert/strict";
import { buildAiTeam, buildEfficientTeam, ROLE_CAPABILITIES } from "../src/global/intelligence/model-intelligence.js";
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
    // S31: thin-but-real Luna evidence (HLE + SciCode, floor-clearing) now competes for the light
    // Explorer role and wins it on cost; the quota balance then sends Tester to the cheap Haiku
    // (before S31 Luna was dropped as provisional for Explorer and took Tester instead).
    assert.equal(pickOf(team, "Explorer"), "gpt-6-luna");
    assert.match(pickOf(team, "Tester"), /^claude-haiku-4-5/);
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
  test(`S30 ${name}: Tester prefers the lower end-to-end latency at equal capability and price`, () => {
    const rows = (slow, fast) => [
      row("claude", "slow-model", { sciCode: .6, terminalBenchV2: .6, endToEndSeconds: slow }),
      row("codex", "fast-model", { sciCode: .6, terminalBenchV2: .6, endToEndSeconds: fast })
    ];
    assert.equal(pick(build, rows(60, 20), "Tester").primary.modelId, "fast-model");
    assert.equal(pick(build, rows(20, 60), "Tester").primary.modelId, "slow-model");
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
for (const [name, build] of Object.entries({
  quality: () => buildAiTeam(LIVE_MODELS, liveEligibility, null, undefined, {}),
  efficient: () => buildEfficientTeam(LIVE_MODELS, liveEligibility, null, {})
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
