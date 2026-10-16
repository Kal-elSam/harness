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
  assert.deepEqual(roleTradeoffWeights("Tester"), light);
  assert.deepEqual(roleTradeoffWeights("Builder"), standard);
});

test("project profile shifts weight toward capability only for roles it raised", () => {
  const demand = projectDemand({ architecture: { pattern: "Layered or Clean Architecture" }, risks: [] });
  assert.ok(roleTradeoffWeights("Architect", demand).capability > ROLE_TRADEOFF_WEIGHTS.demanding.capability);
  assert.deepEqual(roleTradeoffWeights("Explorer", demand), ROLE_TRADEOFF_WEIGHTS.light);
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
  test(`${name}: live snapshot - demanding roles take the stronger model, light roles stay on haiku, Reviewer is independent`, () => {
    const team = build();
    assert.equal(pickOf(team, "Architect"), "gpt-6-astra");
    assert.equal(pickOf(team, "Debugger"), "gpt-6-astra");
    assert.match(pickOf(team, "Explorer"), /^claude-haiku-4-5/);
    assert.match(pickOf(team, "Tester"), /^claude-haiku-4-5/);
    const builder = team.find(entry => entry.role === "Builder").primary;
    const reviewer = team.find(entry => entry.role === "Reviewer").primary;
    assert.notEqual(reviewer.adapterId, builder.adapterId);
    assert.match(team.find(entry => entry.role === "Architect").reason, /Best capability\/cost trade-off for a demanding role \(capability weight 0\.90/);
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
