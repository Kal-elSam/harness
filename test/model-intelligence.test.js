import test from "node:test";
import assert from "node:assert/strict";
import { bestModelPerRole, matchArtificialAnalysisScore, scoreAvailableModels, summarizeCatalogCoverage } from "../src/global/intelligence/model-intelligence.js";

const AA_MODELS = [
  { slug: "gpt-6-astra", name: "GPT-6 Astra (max)", intelligenceIndex: 52.8, codingIndex: 76.9, mathIndex: null },
  { slug: "claude-opus-5", name: "Claude Opus 5", intelligenceIndex: 50.7, codingIndex: 78, mathIndex: null },
  { slug: "claude-4-5-haiku", name: "Claude 4.5 Haiku (Non-reasoning)", intelligenceIndex: 15.4, codingIndex: null, mathIndex: null }
];

test("matchArtificialAnalysisScore finds an exact normalized match", () => {
  const score = matchArtificialAnalysisScore("gpt-6-astra", AA_MODELS);
  assert.equal(score.slug, "gpt-6-astra");
});

test("matchArtificialAnalysisScore matches ids whose words are ordered differently, via sorted tokens", () => {
  const score = matchArtificialAnalysisScore("claude-haiku-4-5", AA_MODELS);
  assert.equal(score.slug, "claude-4-5-haiku");
});

test("matchArtificialAnalysisScore returns null instead of guessing when there's no confident match", () => {
  assert.equal(matchArtificialAnalysisScore("some-unreleased-model-nobody-tracks", AA_MODELS), null);
  assert.equal(matchArtificialAnalysisScore("", AA_MODELS), null);
});

test("scoreAvailableModels only includes models Kairo actually has access to, with real matched scores", () => {
  const providerCatalogs = [
    { adapterId: "codex", models: [{ id: "gpt-6-astra", displayName: "GPT-6 Astra" }, { id: "totally-unmatched-model" }] },
    { adapterId: "claude", models: [{ id: "claude-opus-5" }] }
  ];
  const results = scoreAvailableModels(providerCatalogs, AA_MODELS);
  assert.equal(results.length, 2);
  assert.deepEqual(results.map((r) => r.modelId), ["gpt-6-astra", "claude-opus-5"]);
  assert.equal(results[0].codingIndex, 76.9);
  assert.equal(results[1].intelligenceIndex, 50.7);
});

test("scoreAvailableModels handles Cursor's real catalog shape (plain model name strings), not just {id} objects", () => {
  const results = scoreAvailableModels(
    [{ adapterId: "cursor", models: ["claude-opus-5", "totally-unmatched"] }], AA_MODELS
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].adapterId, "cursor");
  assert.equal(results[0].modelId, "claude-opus-5");
});

test("scoreAvailableModels tags each model with the real, unweighted metrics it actually wins — never a blended composite score", () => {
  const aa = [
    { slug: "model-a", name: "Model A", intelligenceIndex: 90, codingIndex: 60, mathIndex: null, priceInputPerMTok: 10, outputTokensPerSecond: 50 },
    { slug: "model-b", name: "Model B", intelligenceIndex: 50, codingIndex: 95, mathIndex: null, priceInputPerMTok: 2, outputTokensPerSecond: 200 }
  ];
  const results = scoreAvailableModels(
    [{ adapterId: "codex", models: [{ id: "model-a" }, { id: "model-b" }] }], aa
  );
  const a = results.find((r) => r.modelId === "model-a");
  const b = results.find((r) => r.modelId === "model-b");
  assert.deepEqual(a.bestFor, ["best reasoning"]);
  assert.deepEqual(b.bestFor, ["best coding", "fastest", "cheapest"]);
});

test("scoreAvailableModels never tags a model as best on a metric it doesn't actually report", () => {
  const aa = [{ slug: "model-a", name: "Model A", intelligenceIndex: null, codingIndex: null, mathIndex: null, priceInputPerMTok: null, outputTokensPerSecond: null }];
  const results = scoreAvailableModels([{ adapterId: "codex", models: [{ id: "model-a" }] }], aa);
  assert.deepEqual(results[0].bestFor, []);
});

test("scoreAvailableModels returns an empty list, never a fabricated entry, when nothing matches", () => {
  const results = scoreAvailableModels([{ adapterId: "codex", models: [{ id: "unknown-model" }] }], AA_MODELS);
  assert.deepEqual(results, []);
});

test("bestModelPerRole names a real winner for all seven roles, each derived from real metrics — no weights, no blend", () => {
  const aa = [
    { slug: "model-a", name: "Model A", intelligenceIndex: 90, codingIndex: 60, mathIndex: null, priceInputPerMTok: 10, outputTokensPerSecond: 50 },
    { slug: "model-b", name: "Model B", intelligenceIndex: 50, codingIndex: 95, mathIndex: null, priceInputPerMTok: 2, outputTokensPerSecond: 200 }
  ];
  const scored = scoreAvailableModels(
    [{ adapterId: "claude", models: [{ id: "model-a" }] }, { adapterId: "codex", models: [{ id: "model-b" }] }], aa
  );
  const roles = bestModelPerRole(scored);
  assert.deepEqual(roles, [
    { role: "Explorer", adapterId: "claude", modelId: "model-a", displayName: null },
    { role: "Architect / Planner", adapterId: "claude", modelId: "model-a", displayName: null },
    { role: "Implementer", adapterId: "codex", modelId: "model-b", displayName: null },
    // Debugger/Reviewer = min(intelligence, coding): model-a min(90,60)=60 beats model-b min(50,95)=50.
    { role: "Debugger", adapterId: "claude", modelId: "model-a", displayName: null },
    { role: "Test Author", adapterId: "codex", modelId: "model-b", displayName: null },
    { role: "Reviewer", adapterId: "claude", modelId: "model-a", displayName: null },
    { role: "Economy", adapterId: "codex", modelId: "model-b", displayName: null }
  ]);
});

test("Debugger and Reviewer use the bottleneck (minimum) of intelligence and coding, never an average or invented weight", () => {
  const aa = [
    // High intelligence but weak coding — the bottleneck should punish this for Debugger/Reviewer.
    { slug: "model-lopsided", name: "Lopsided", intelligenceIndex: 99, codingIndex: 10, mathIndex: null },
    // Balanced, lower peak but higher minimum.
    { slug: "model-balanced", name: "Balanced", intelligenceIndex: 60, codingIndex: 60, mathIndex: null }
  ];
  const scored = scoreAvailableModels(
    [{ adapterId: "claude", models: [{ id: "model-lopsided" }, { id: "model-balanced" }] }], aa
  );
  const roles = bestModelPerRole(scored);
  const debugger_ = roles.find((r) => r.role === "Debugger");
  const reviewer = roles.find((r) => r.role === "Reviewer");
  assert.equal(debugger_.modelId, "model-balanced"); // min(60,60)=60 beats min(99,10)=10
  assert.equal(reviewer.modelId, "model-balanced");
  // But Architect/Planner (pure intelligence) still favors the lopsided model.
  assert.equal(roles.find((r) => r.role === "Architect / Planner").modelId, "model-lopsided");
});

test("Debugger/Reviewer are omitted, never guessed, when a model reports only one of the two required real metrics", () => {
  const aa = [{ slug: "model-a", name: "Model A", intelligenceIndex: 90, codingIndex: null, mathIndex: null }];
  const scored = scoreAvailableModels([{ adapterId: "claude", models: [{ id: "model-a" }] }], aa);
  const roles = bestModelPerRole(scored);
  assert.ok(!roles.some((r) => r.role === "Debugger"));
  assert.ok(!roles.some((r) => r.role === "Reviewer"));
  assert.ok(!roles.some((r) => r.role === "Implementer")); // no coding index either
  assert.ok(roles.some((r) => r.role === "Explorer"));
});

test("bestModelPerRole omits a role entirely when no available model reports that metric, never guessing a winner", () => {
  const aa = [{ slug: "model-a", name: "Model A", intelligenceIndex: 90, codingIndex: null, mathIndex: null, priceInputPerMTok: null, outputTokensPerSecond: null }];
  const scored = scoreAvailableModels([{ adapterId: "claude", models: [{ id: "model-a" }] }], aa);
  const roles = bestModelPerRole(scored);
  assert.deepEqual(roles.map((r) => r.role), ["Explorer", "Architect / Planner"]);
});

test("bestModelPerRole never invents an Orchestrator role — that's Kairo itself, never a ranked model", () => {
  const scored = scoreAvailableModels([{ adapterId: "claude", models: [{ id: "gpt-6-astra" }] }], AA_MODELS);
  const roles = bestModelPerRole(scored).map((r) => r.role);
  assert.ok(!roles.includes("Orchestrator"));
  assert.ok(!roles.includes("Tests"));
});

test("summarizeCatalogCoverage reports real total/matched counts per provider, independent of runtime eligibility", () => {
  const aa = [
    { slug: "gpt-6-astra", name: "GPT-6 Astra", intelligenceIndex: 52.8, codingIndex: 76.9, mathIndex: null },
    { slug: "claude-opus-5", name: "Claude Opus 5", intelligenceIndex: 50.7, codingIndex: 78, mathIndex: null }
  ];
  const coverage = summarizeCatalogCoverage([
    { adapterId: "codex", catalogStatus: "measured", models: [{ id: "gpt-6-astra" }, { id: "some-unreleased-model" }] },
    { adapterId: "claude", catalogStatus: "documented", models: [{ id: "claude-opus-5" }] },
    { adapterId: "cursor", catalogStatus: "measured", models: [] }
  ], aa);
  assert.deepEqual(coverage, [
    { adapterId: "codex", catalogStatus: "measured", totalModels: 2, matchedModels: 1 },
    { adapterId: "claude", catalogStatus: "documented", totalModels: 1, matchedModels: 1 },
    { adapterId: "cursor", catalogStatus: "measured", totalModels: 0, matchedModels: 0 }
  ]);
});

test("summarizeCatalogCoverage handles Cursor's plain-string catalog shape too", () => {
  const aa = [{ slug: "claude-opus-5", name: "Claude Opus 5", intelligenceIndex: 50.7, codingIndex: 78, mathIndex: null }];
  const coverage = summarizeCatalogCoverage(
    [{ adapterId: "cursor", catalogStatus: "measured", models: ["claude-opus-5", "unmatched-model"] }], aa
  );
  assert.deepEqual(coverage, [{ adapterId: "cursor", catalogStatus: "measured", totalModels: 2, matchedModels: 1 }]);
});
