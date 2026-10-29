import test from "node:test";
import assert from "node:assert/strict";
import {
  annotateWithRegistryEvidence, bestEfficientModelPerRoleGlobal, bestModelPerRole, bestModelPerRoleGlobal, buildAiTeam as buildAiTeamPolicy,
  buildEfficientTeam as buildEfficientTeamPolicy, matchArtificialAnalysisScore, scoreAvailableModels, summarizeCatalogCoverage
} from "../src/global/intelligence/model-intelligence.js";
import { createCapabilityRegistry } from "../src/global/intelligence/model-capability-registry.js";
import { ingestArtificialAnalysisEvidence, ingestHuggingFaceLeaderboardEvidence } from "../src/global/intelligence/model-capability-registry-sources.js";
import { ingestOfficialSnapshotEvidence } from "../src/global/intelligence/official-benchmark-snapshots.js";

// Existing cross-provider fixtures explicitly opt in their providers. Default
// Claude/Codex restriction is exercised through public builders in role-demand-tiers.
function buildAiTeam(models, eligibility, registry, capabilities, options = {}) {
  return buildAiTeamPolicy(models, eligibility, registry, capabilities, { teamProviders: [...new Set(models.map(model => model.adapterId))], ...options });
}
function buildEfficientTeam(models, eligibility, registry, options = {}) {
  return buildEfficientTeamPolicy(models, eligibility, registry, { teamProviders: [...new Set(models.map(model => model.adapterId))], ...options });
}

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

test("scoreAvailableModels handles Cursor's real catalog shape — {id, displayName} objects, same as every other real provider catalog", () => {
  const results = scoreAvailableModels(
    [{ adapterId: "cursor", models: [{ id: "claude-opus-5", displayName: "Claude Opus 5" }, { id: "totally-unmatched" }] }], AA_MODELS
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
    // Debugger \(fix\)/Reviewer = min(intelligence, coding): model-a min(90,60)=60 beats model-b min(50,95)=50.
    { role: "Debugger (fix)", adapterId: "claude", modelId: "model-a", displayName: null },
    { role: "Test Author", adapterId: "codex", modelId: "model-b", displayName: null },
    { role: "Reviewer", adapterId: "claude", modelId: "model-a", displayName: null },
    { role: "Economy", adapterId: "codex", modelId: "model-b", displayName: null }
  ]);
});

test("Debugger (fix) and Reviewer use the bottleneck (minimum) of intelligence and coding, never an average or invented weight", () => {
  const aa = [
    // High intelligence but weak coding — the bottleneck should punish this for Debugger \(fix\)/Reviewer.
    { slug: "model-lopsided", name: "Lopsided", intelligenceIndex: 99, codingIndex: 10, mathIndex: null },
    // Balanced, lower peak but higher minimum.
    { slug: "model-balanced", name: "Balanced", intelligenceIndex: 60, codingIndex: 60, mathIndex: null }
  ];
  const scored = scoreAvailableModels(
    [{ adapterId: "claude", models: [{ id: "model-lopsided" }, { id: "model-balanced" }] }], aa
  );
  const roles = bestModelPerRole(scored);
  const debugger_ = roles.find((r) => r.role === "Debugger (fix)");
  const reviewer = roles.find((r) => r.role === "Reviewer");
  assert.equal(debugger_.modelId, "model-balanced"); // min(60,60)=60 beats min(99,10)=10
  assert.equal(reviewer.modelId, "model-balanced");
  // But Architect/Planner (pure intelligence) still favors the lopsided model.
  assert.equal(roles.find((r) => r.role === "Architect / Planner").modelId, "model-lopsided");
});

test("Debugger (fix)/Reviewer are omitted, never guessed, when a model reports only one of the two required real metrics", () => {
  const aa = [{ slug: "model-a", name: "Model A", intelligenceIndex: 90, codingIndex: null, mathIndex: null }];
  const scored = scoreAvailableModels([{ adapterId: "claude", models: [{ id: "model-a" }] }], aa);
  const roles = bestModelPerRole(scored);
  assert.ok(!roles.some((r) => r.role === "Debugger (fix)"));
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

test("REGRESSION: summarizeCatalogCoverage propagates the real catalog read error (e.g. 'Authentication required') instead of silently dropping it", () => {
  const coverage = summarizeCatalogCoverage([
    { adapterId: "cursor", catalogStatus: "unknown", models: [], error: "cursor-agent models exited with code 1: Authentication required" },
    { adapterId: "codex", catalogStatus: "measured", models: [] }
  ], []);
  assert.equal(coverage[0].error, "cursor-agent models exited with code 1: Authentication required");
  assert.equal(coverage[1].error, undefined, "a provider with no real error must never carry a fabricated one");
});

test("summarizeCatalogCoverage handles Cursor's plain-string catalog shape too", () => {
  const aa = [{ slug: "claude-opus-5", name: "Claude Opus 5", intelligenceIndex: 50.7, codingIndex: 78, mathIndex: null }];
  const coverage = summarizeCatalogCoverage(
    [{ adapterId: "cursor", catalogStatus: "measured", models: ["claude-opus-5", "unmatched-model"] }], aa
  );
  assert.deepEqual(coverage, [{ adapterId: "cursor", catalogStatus: "measured", totalModels: 2, matchedModels: 1 }]);
});

test("buildAiTeam names a real primary and eligible fallback for each of the six real roles, never Economy or Orchestrator", () => {
  const aa = [
    { slug: "model-a", name: "Model A", intelligenceIndex: 90, codingIndex: 60, mathIndex: null, priceInputPerMTok: 10, outputTokensPerSecond: 50 },
    { slug: "model-b", name: "Model B", intelligenceIndex: 50, codingIndex: 95, mathIndex: null, priceInputPerMTok: 2, outputTokensPerSecond: 200 }
  ];
  const scored = scoreAvailableModels(
    [{ adapterId: "claude", models: [{ id: "model-a" }] }, { adapterId: "codex", models: [{ id: "model-b" }] }], aa
  );
  const eligibility = { claude: { ok: true }, codex: { ok: true } };
  const team = buildAiTeam(scored, eligibility);
  const explorer = team.find((t) => t.role === "Explorer");
  assert.equal(explorer.primary.adapterId, "claude");
  assert.equal(explorer.primary.available, true);
  assert.equal(explorer.fallback.adapterId, "codex");
  // Economy is no longer a 7th role competing in QUALITY TEAM — per the
  // "PROJECT TEAM primero" plan, it becomes an execution policy the six
  // real roles run under at task-routing time, not a ranked team slot.
  assert.ok(!team.some((t) => t.role === "Economy"));
  assert.ok(!team.some((t) => t.role === "Orchestrator"));
});

test("buildAiTeam keeps a preferred-but-ineligible primary visible instead of dropping it, and picks an eligible fallback", () => {
  const aa = [
    { slug: "go-model", name: "Go Model", intelligenceIndex: 40, codingIndex: 99, mathIndex: null, terminalBenchV2: 0.9 },
    { slug: "claude-model", name: "Claude Model", intelligenceIndex: 40, codingIndex: 70, mathIndex: null, terminalBenchV2: 0.8 }
  ];
  const scored = scoreAvailableModels(
    [{ adapterId: "opencode-go", models: [{ id: "go-model" }] }, { adapterId: "claude", models: [{ id: "claude-model" }] }], aa
  );
  // OpenCode Go is rate-limited right now — it stays the real capability
  // winner for Test Runner (best codingIndex), but should be flagged unavailable
  // with Claude surfaced as the real, eligible fallback.
  const eligibility = { "opencode-go": { ok: false, reason: "rate limited" }, claude: { ok: true } };
  const team = buildAiTeam(scored, eligibility);
  const tester = team.find((t) => t.role === "Test Runner");
  assert.equal(tester.primary.adapterId, "opencode-go");
  assert.equal(tester.primary.available, false);
  assert.equal(tester.fallback.adapterId, "claude");
  assert.equal(tester.fallback.available, true);
});

test("buildAiTeam reports no fallback, never a fabricated one, when no eligible alternative exists", () => {
  const aa = [{ slug: "only-model", name: "Only Model", intelligenceIndex: 80, codingIndex: 80, mathIndex: null }];
  const scored = scoreAvailableModels([{ adapterId: "codex", models: [{ id: "only-model" }] }], aa);
  const team = buildAiTeam(scored, { codex: { ok: true } });
  assert.equal(team.find((t) => t.role === "Explorer").fallback, null);
});

test("buildAiTeam keeps capability tiebreaks within absolute demand tiers", () => {
  // Comparable synthetic evidence, equal unknown costs, explicitly enabled
  // providers: absolute floors qualify first; capability bands break ties.
  const aa = [
    { slug: "claude-model", name: "Claude Model", intelligenceIndex: 53.4, codingIndex: 81.6, mathIndex: null, terminalBenchV2: 0.85 },
    { slug: "codex-model", name: "Codex Model", intelligenceIndex: 52.8, codingIndex: 60.0, mathIndex: null, terminalBenchV2: 0.50 },
    { slug: "go-model", name: "Go Model", intelligenceIndex: 50.0, codingIndex: 78.0, mathIndex: null, terminalBenchV2: 0.80 }
  ];
  const scored = scoreAvailableModels([
    { adapterId: "claude", models: [{ id: "claude-model" }] },
    { adapterId: "codex", models: [{ id: "codex-model" }] },
    { adapterId: "opencode-go", models: [{ id: "go-model" }] }
  ], aa);
  const team = buildAiTeam(scored, { claude: { ok: true }, codex: { ok: true }, "opencode-go": { ok: true } });
  const byRole = Object.fromEntries(team.map((t) => [t.role, t]));

  // S43: the scaled model cap leaves the capability leader available for Explorer.
  // Role-weighted Debugger (fix) and Test Runner selection remains unchanged.
  assert.deepEqual(Object.fromEntries(team.map(entry => [entry.role, entry.primary?.adapterId])), {
    Explorer: "codex", Architect: "claude", Builder: "opencode-go",
    "Debugger (fix)": "claude", "Test Runner": "opencode-go", Reviewer: "claude",
    "Debugger (diagnosis)": "claude", "Test Designer": "opencode-go"
  });
  assert.match(byRole["Test Runner"].reason, /Near-equivalent alternatives/);

});

test("S25 buildAiTeam does not let decisively weaker broad evidence exclude a strong provisional candidate", () => {
  const aa = [
    { slug: "thin-model", name: "Thin Model", intelligenceIndex: null, codingIndex: null, mathIndex: null },
    { slug: "broad-model", name: "Broad Model", intelligenceIndex: null, codingIndex: null, mathIndex: null }
  ];
  const scored = scoreAvailableModels([
    { adapterId: "opencode-go", models: [{ id: "thin-model" }] },
    { adapterId: "claude", models: [{ id: "broad-model" }] }
  ], aa);
  const registry = createCapabilityRegistry();
  const thinId = registry.registerIdentity("opencode-go", "thin-model");
  const broadId = registry.registerIdentity("claude", "broad-model");
  // Thin: a real, HIGH single HLE score — real evidence, but only 1 of
  // reasoning's 3 real active benchmarks (provisional).
  registry.addEvidence(thinId, { metric: "hle", value: 0.95, source: "huggingface-leaderboard", scale: "unit", date: "2026-09-15", verified: false });
  // Broad: real evidence on 2 of 3 (gpqa + hle) — comparable, even though
  // its own individual scores are LOWER than thin's single number.
  registry.addEvidence(broadId, { metric: "gpqa", value: 0.55, source: "artificial-analysis-free", scale: "unit", date: "2026-09-15", verified: false });
  registry.addEvidence(broadId, { metric: "hle", value: 0.50, source: "artificial-analysis-free", scale: "unit", date: "2026-09-15", verified: false });

  const team = buildAiTeam(scored, { "opencode-go": { ok: true }, claude: { ok: true } }, registry, {
    Explorer: { required: ["reasoning"], optional: [] }
  });
  const explorer = team.find((t) => t.role === "Explorer");
  assert.equal(explorer.primary.adapterId, "opencode-go", "S25: .525 broad evidence cannot exclude .95 provisional evidence");
});

test("REGRESSION: buildAiTeam still picks the real leader as an honest fallback, with an explicit reason, when EVERY real eligible candidate for a role is provisional", () => {
  const aa = [
    { slug: "thin-a", name: "Thin A", intelligenceIndex: null, codingIndex: null, mathIndex: null },
    { slug: "thin-b", name: "Thin B", intelligenceIndex: null, codingIndex: null, mathIndex: null }
  ];
  const scored = scoreAvailableModels([
    { adapterId: "opencode-go", models: [{ id: "thin-a" }] },
    { adapterId: "claude", models: [{ id: "thin-b" }] }
  ], aa);
  const registry = createCapabilityRegistry();
  const aId = registry.registerIdentity("opencode-go", "thin-a");
  const bId = registry.registerIdentity("claude", "thin-b");
  // Both candidates have real evidence on only 1 of reasoning's 3 real
  // active benchmarks — both provisional, no comparable alternative exists.
  registry.addEvidence(aId, { metric: "hle", value: 0.60, source: "huggingface-leaderboard", scale: "unit", date: "2026-09-15", verified: false });
  registry.addEvidence(bId, { metric: "hle", value: 0.40, source: "artificial-analysis-free", scale: "unit", date: "2026-09-15", verified: false });

  const team = buildAiTeam(scored, { "opencode-go": { ok: true }, claude: { ok: true } }, registry, {
    Explorer: { required: ["reasoning"], optional: [] }
  });
  const explorer = team.find((t) => t.role === "Explorer");
  // The real leader among the (all-provisional) pool still wins — a real
  // fallback, never silently dropped — but with an honest reason.
  assert.equal(explorer.primary.adapterId, "opencode-go");
  assert.match(explorer.reason, /Only provisional evidence available/);
});

test("buildAiTeam preserves demanding classes before the soft provider cap and diversifies light roles", () => {
  // Two real Claude models plus one real Codex model, all real
  // near-equivalents of each other — real relative gap vs claude-a (90):
  // claude-b 1.11%, codex 3.33%, comfortably inside every applicable
  // per-role band this test exercises (Debugger (fix)'s 5% is the tightest of
  // them; Explorer/Builder/Test Runner's 6% is looser still). The 2-role-per-
  // model limit alone wouldn't stop Claude from covering most roles
  // (claude-a takes 2, claude-b takes 2), but the 3-per-provider limit
  // kicks in first — once Claude (either model) has covered 3 technical
  // roles, Codex (a real, capable alternative) gets the next one instead
  // of a 3rd Claude model or a 4th Claude role.
  const aa = [
    { slug: "claude-a", name: "Claude A", intelligenceIndex: 90, codingIndex: 90, mathIndex: null, terminalBenchV2: 0.90 },
    { slug: "claude-b", name: "Claude B", intelligenceIndex: 89, codingIndex: 89, mathIndex: null, terminalBenchV2: 0.89 },
    { slug: "codex-model", name: "Codex", intelligenceIndex: 87, codingIndex: 87, mathIndex: null, terminalBenchV2: 0.87 }
  ];
  const scored = scoreAvailableModels([
    { adapterId: "claude", models: [{ id: "claude-a" }, { id: "claude-b" }] },
    { adapterId: "codex", models: [{ id: "codex-model" }] }
  ], aa);
  const team = buildAiTeam(scored, { claude: { ok: true }, codex: { ok: true } });
  const byRole = Object.fromEntries(team.map((t) => [t.role, t]));

  // Explorer/Architect/Builder: Claude covers these first (real capability
  // leader), reaching its real 3-role provider limit by Builder.
  assert.equal(byRole.Explorer.primary.adapterId, "claude");
  assert.equal(byRole.Architect.primary.adapterId, "claude");
  assert.equal(byRole.Builder.primary.adapterId, "claude");

  // S43: Debugger (fix) rejects the bottom-third Codex model despite provider load.
  // Test Runner remains free to use that qualified alternative as a light role.
  assert.equal(byRole["Debugger (fix)"].primary.adapterId, "claude");
  assert.equal(byRole["Test Runner"].primary.adapterId, "codex");
  assert.match(byRole["Debugger (fix)"].reason, /class guard/);
});

test("buildAiTeam shares the scaled family cap across adapters instead of counting effort variants separately", () => {
  // A single real family ("leader"), reachable via two adapters: p1's bare
  // "leader" (intelligenceIndex 100) and p2's "leader-low" (85 — a 15%
  // real gap, deliberately outside every role's near-equivalence band
  // here but still clearing the 80% floor, so it's reachable ONLY via the
  // widened search, never the narrow band).
  const R = { required: ["reasoning"], optional: [] };
  const aa = [
    { slug: "leader", name: "Leader", intelligenceIndex: 100, codingIndex: null, mathIndex: null },
    { slug: "leader-low", name: "Leader Low", intelligenceIndex: 85, codingIndex: null, mathIndex: null }
  ];
  const scored = scoreAvailableModels([
    { adapterId: "p1", models: [{ id: "leader" }] },
    { adapterId: "p2", models: [{ id: "leader-low" }] }
  ], aa);
  const eligibility = { p1: { ok: true }, p2: { ok: true } };
  const team = buildAiTeam(scored, eligibility, null, { Architect: R, Builder: R, "Test Runner": R });
  const byRole = Object.fromEntries(team.map((t) => [t.role, t]));

  // Three roles and one distinct eligible family give a cap of four.
  for (const role of ["Architect", "Builder", "Test Runner"]) {
    assert.equal(byRole[role].primary.adapterId, "p1");
    assert.equal(byRole[role].selection.modelRoleCap, 4);
    assert.doesNotMatch(byRole[role].reason ?? "", /exceeding|cap overflow/);
  }
});

test("buildAiTeam's widened search still respects the 3-per-provider limit — a fresh-family candidate under an already-maxed adapter is skipped for one under a real, different provider", () => {
  // One real leader (alpha) plus three real, distinct-family alternatives
  // — beta/gamma/delta all on the SAME adapter as alpha (p1), epsilon on
  // a genuinely different provider (p2). Every one of them sits well
  // outside every role's near-equivalence band here (7-15% real gaps) but
  // clears the 80% floor, so they're only reachable via the widened
  // search — deliberately isolating the provider-cap check from the
  // near-equivalence band itself.
  const R = { required: ["reasoning"], optional: [] };
  const aa = [
    { slug: "alpha", name: "Alpha", intelligenceIndex: 100, codingIndex: null, mathIndex: null },
    { slug: "beta", name: "Beta", intelligenceIndex: 93, codingIndex: null, mathIndex: null },
    { slug: "gamma", name: "Gamma", intelligenceIndex: 91, codingIndex: null, mathIndex: null },
    { slug: "delta", name: "Delta", intelligenceIndex: 89, codingIndex: null, mathIndex: null },
    { slug: "epsilon", name: "Epsilon", intelligenceIndex: 85, codingIndex: null, mathIndex: null }
  ];
  const scored = scoreAvailableModels([
    { adapterId: "p1", models: [{ id: "alpha" }, { id: "beta" }, { id: "gamma" }, { id: "delta" }] },
    { adapterId: "p2", models: [{ id: "epsilon" }] }
  ], aa);
  const eligibility = { p1: { ok: true }, p2: { ok: true } };
  const team = buildAiTeam(scored, eligibility, null, { Architect: R, Builder: R, "Debugger (fix)": R, "Test Runner": R });
  const byRole = Object.fromEntries(team.map((t) => [t.role, t]));

  // Architect/Builder: alpha is the only narrow-band candidate both
  // times — its real 2-role family limit is reached.
  assert.equal(byRole.Architect.primary.adapterId, "p1");
  assert.equal(byRole.Builder.primary.adapterId, "p1");

  // Debugger (fix): alpha blocked by its family limit. Widened search finds
  // beta/gamma/delta/epsilon all clearing the 80% floor and all
  // respecting concentration so far (p1 has only used 2 of its 3
  // technical-role slots, from alpha's own two uses) — beta wins on real
  // capability (93, the highest of the real alternatives). p1 now hits
  // its real 3-role provider limit (alpha x2 + beta x1).
  assert.equal(byRole["Debugger (fix)"].primary.modelId, "beta");
  assert.match(byRole["Debugger (fix)"].reason, /widened the search/);

  // Test Runner: alpha still blocked (family). gamma and delta are REAL,
  // fresh-family, floor-clearing alternatives — numerically better than
  // epsilon (91 and 89 vs 85) — but both sit on p1, which just hit its
  // real 3-role provider limit. Only epsilon, on the genuinely different
  // provider p2, respects it — proving the provider cap, not just
  // capability value, decided the widened pick.
  assert.equal(byRole["Test Runner"].primary.modelId, "epsilon");
  assert.match(byRole["Test Runner"].reason, /widened the search/);
});

test("S43 class guard precedes the soft provider cap when only the bottom-third model is independent", () => {
  // SYNTHETIC scores (not the preserved AA fixture). Locks the concentration
  // contract in isolation. Deterministic offline repro of the saved session
  // lives in test/team-selection-repro.test.js + fixtures/team-selection-repro-dfd018.json.
  const roleCaps = {
    Explorer: { required: ["reasoning"], optional: [] },
    Architect: { required: ["reasoning"], optional: [] },
    "Debugger (fix)": { required: ["reasoning"], optional: [] },
    Reviewer: { required: ["reasoning"], optional: [] }
  };
  const aa = [
    { slug: "gpt-6-astra", name: "GPT-6 Astra", intelligenceIndex: 100, codingIndex: null, mathIndex: null },
    { slug: "gpt-5.6-terra", name: "GPT-5.6-Terra", intelligenceIndex: 96, codingIndex: null, mathIndex: null },
    { slug: "gpt-5.6-sol", name: "GPT-5.6-Sol", intelligenceIndex: 94, codingIndex: null, mathIndex: null },
    { slug: "gpt-5.5", name: "GPT-5.5", intelligenceIndex: 92, codingIndex: null, mathIndex: null },
    { slug: "claude-opus-5", name: "Claude Opus 5", intelligenceIndex: 88, codingIndex: null, mathIndex: null }
  ];
  const scored = scoreAvailableModels([
    { adapterId: "codex", models: [{ id: "gpt-6-astra" }, { id: "gpt-5.6-terra" }, { id: "gpt-5.6-sol" }, { id: "gpt-5.5" }] },
    { adapterId: "claude", models: [{ id: "claude-opus-5" }] },
    { adapterId: "opencode-go", models: [{ id: "kimi-k3" }] }
  ], aa);
  const eligibility = {
    codex: { ok: true },
    claude: { ok: true },
    "opencode-go": {
      ok: false,
      cause: "rate_limited",
      reason: "OpenCode Go monthly window is rate-limited"
    }
  };
  const team = buildAiTeam(scored, eligibility, null, roleCaps);
  const byRole = Object.fromEntries(team.map((t) => [t.role, t]));
  const adapters = new Set(team.map((t) => t.primary.adapterId === "opencode-go" && t.primary.available === false
    ? t.fallback?.adapterId
    : t.primary.adapterId));

  // S43: the only Claude model is bottom-third; demanding roles must retain
  // stronger qualified Codex models rather than satisfy a soft provider cap.
  assert.deepEqual([...adapters], ["codex"]);
  assert.match(byRole.Reviewer.reason, /class guard/);
});

test("buildAiTeam's widened search still keeps Reviewer independent from Builder's own provider — a same-adapter, different-family candidate is skipped for a genuinely independent one", () => {
  // Builder's own adapter (pB) hosts both the leader Reviewer would
  // otherwise repeat AND a real, different-family rival that clears the
  // 80% floor — neither the family limit (rival is a fresh family) nor
  // the provider limit (pB has only 1 of 3 technical-role slots used) is
  // what should stop the rival; only Reviewer's own independence-from-
  // Builder rule should. A genuinely independent real alternative (pC)
  // clears the floor too and should be the one actually picked.
  const R = { required: ["reasoning"], optional: [] };
  const aa = [
    { slug: "leader", name: "Leader", intelligenceIndex: 100, codingIndex: null, mathIndex: null },
    { slug: "rival", name: "Rival", intelligenceIndex: 90, codingIndex: null, mathIndex: null },
    { slug: "other", name: "Other", intelligenceIndex: 85, codingIndex: null, mathIndex: null }
  ];
  const scored = scoreAvailableModels([
    { adapterId: "pB", models: [{ id: "leader" }, { id: "rival" }] },
    { adapterId: "pC", models: [{ id: "other" }] }
  ], aa);
  const eligibility = { pB: { ok: true }, pC: { ok: true } };
  const team = buildAiTeam(scored, eligibility, null, { Builder: R, Reviewer: R });
  const byRole = Object.fromEntries(team.map((t) => [t.role, t]));

  assert.equal(byRole.Builder.primary.adapterId, "pB");

  // Reviewer: "leader" is the only narrow-band candidate, but it's on
  // Builder's own adapter (pB) — blocked outright, even with family/
  // provider usage nowhere near their real limits. The widened search
  // reaches "rival" (0.90, clears the 80% floor) — same pB adapter as
  // Builder, so independence excludes it too — before reaching "other"
  // (0.85, clears the floor, genuinely independent adapter pC). The
  // pre-existing "Kept independent from Builder's provider" message
  // (buildAiTeam's own reviewerLeaderWasBuilderAdapter case) correctly
  // takes priority over the generic widened-search reason here — it's
  // the more specific, accurate explanation for why the pick changed.
  assert.equal(byRole.Reviewer.primary.adapterId, "pC");
  assert.ok(byRole.Reviewer.reason.startsWith("Kept independent from Builder's provider."));
});

test("buildAiTeam widened search uses the absolute light-role floor inclusively", () => {
  const R = { required: ["reasoning"], optional: [] };
  // Four active roles consume the scaled third slot before Test Runner is assigned.
  // Below the absolute .35 light floor: with no other real alternative, the lone narrow
  // candidate is repeated (trivially decisive, per leaderAdvantage's own
  // doc for a single-candidate pool) rather than admitting a real
  // candidate that doesn't actually clear the floor.
  const belowFloorAa = [
    { slug: "leader", name: "Leader", intelligenceIndex: 100, codingIndex: null, mathIndex: null },
    { slug: "weak34", name: "Weak 34", intelligenceIndex: 34, codingIndex: null, mathIndex: null }
  ];
  const belowFloorScored = scoreAvailableModels([
    { adapterId: "p1", models: [{ id: "leader" }] },
    { adapterId: "p2", models: [{ id: "weak34" }] }
  ], belowFloorAa);
  const belowFloorTeam = buildAiTeam(
    belowFloorScored, { p1: { ok: true }, p2: { ok: true } }, null, { Architect: R, Builder: R, Explorer: R, "Test Runner": R }
  );
  const belowFloorByRole = Object.fromEntries(belowFloorTeam.map((t) => [t.role, t]));
  assert.equal(belowFloorByRole["Test Runner"].primary.adapterId, "p1");
  assert.ok(belowFloorByRole["Test Runner"].reason.startsWith("Decisive real capability advantage — kept despite exceeding the concentration limit."));

  // Exactly at the absolute .35 floor: demandCandidates is inclusive
  // (`>=`), so a real candidate with gapValue .35 IS admitted and, having nothing else to compete
  // with, gets chosen over forcing the (now over its scaled 3-role limit) leader.
  const atFloorAa = [
    { slug: "leader", name: "Leader", intelligenceIndex: 100, codingIndex: null, mathIndex: null },
    { slug: "atfloor35", name: "At Floor 35", intelligenceIndex: 35, codingIndex: null, mathIndex: null }
  ];
  const atFloorScored = scoreAvailableModels([
    { adapterId: "p1", models: [{ id: "leader" }] },
    { adapterId: "p2", models: [{ id: "atfloor35" }] }
  ], atFloorAa);
  const atFloorTeam = buildAiTeam(
    atFloorScored, { p1: { ok: true }, p2: { ok: true } }, null, { Architect: R, Builder: R, Explorer: R, "Test Runner": R }
  );
  const atFloorByRole = Object.fromEntries(atFloorTeam.map((t) => [t.role, t]));
  assert.equal(atFloorByRole["Test Runner"].primary.adapterId, "p2");
  assert.match(atFloorByRole["Test Runner"].reason, /widened the search/);
});

test("REGRESSION: the same real model family under Claude, Cursor, and several Cursor reasoning-tier variants shares the scaled family cap as ONE model, not four independent ones", () => {
  // The exact real-world scenario a live catalog produced: "Claude Fable
  // 5.1" reachable as a bare id via Claude AND as three separately-listed
  // reasoning-tier ids via Cursor (low/high/thinking-xhigh) — four
  // distinct adapterId::modelId identities for what is, for concentration
  // purposes, one real model. Before familyKey existed, MAX_ROLES_PER_MODEL
  // was keyed on the exact identity (modelKey), so these four could
  // collectively cover 4 technical roles — double the real 2-role cap —
  // simply by rotating through reasoning-tier variants and access paths.
  // AA genuinely benchmarks each reasoning tier separately (verified
  // against live AA data before this fix), so each variant keeps its own
  // real, close-but-distinct score here — deliberately within the 8%
  // near-equivalence band of each other, matching what real reasoning-tier
  // variants of the same base model actually look like.
  const aa = [
    { slug: "claude-fable-5-1", name: "Claude Fable 5.1", intelligenceIndex: 90, codingIndex: 90, mathIndex: null },
    { slug: "claude-fable-5-1-low", name: "Claude Fable 5.1 Low", intelligenceIndex: 88, codingIndex: 88, mathIndex: null },
    { slug: "claude-fable-5-1-high", name: "Claude Fable 5.1 High", intelligenceIndex: 91, codingIndex: 91, mathIndex: null },
    { slug: "claude-fable-5-1-thinking-xhigh", name: "Claude Fable 5.1 Thinking XHigh", intelligenceIndex: 92, codingIndex: 92, mathIndex: null },
    { slug: "second-model", name: "Second Model", intelligenceIndex: 87, codingIndex: 87, mathIndex: null },
    { slug: "third-model", name: "Third Model", intelligenceIndex: 86, codingIndex: 86, mathIndex: null }
  ];
  const scored = scoreAvailableModels([
    { adapterId: "claude", models: [{ id: "claude-fable-5-1" }] },
    { adapterId: "cursor", models: [
      { id: "claude-fable-5-1-low", displayName: "Claude Fable 5.1 Low" },
      { id: "claude-fable-5-1-high", displayName: "Claude Fable 5.1 High" },
      { id: "claude-fable-5-1-thinking-xhigh", displayName: "Claude Fable 5.1 Thinking XHigh" }
    ] },
    { adapterId: "opencode-go", models: [{ id: "second-model" }] },
    { adapterId: "codex", models: [{ id: "third-model" }] }
  ], aa);
  const team = buildAiTeam(scored, { claude: { ok: true }, cursor: { ok: true }, "opencode-go": { ok: true }, codex: { ok: true } });
  const byRole = Object.fromEntries(team.map((t) => [t.role, t]));

  // The default allowlist leaves two eligible families for six roles, so
  // their shared scaled cap is four; aliases must not create extra capacity.
  const fableIds = new Set(["claude-fable-5-1", "claude-fable-5-1-low", "claude-fable-5-1-high", "claude-fable-5-1-thinking-xhigh"]);
  const technicalRoles = ["Explorer", "Architect", "Builder", "Debugger (fix)", "Test Runner", "Reviewer"];
  const fableRoleCount = technicalRoles.filter((role) => fableIds.has(byRole[role]?.primary?.modelId)).length;
  assert.ok(fableRoleCount <= 4, `Six roles and two eligible model families give a cap of four, not separate caps per variant; got ${fableRoleCount}`);
  // The real alternatives (genuinely different models) must pick up the
  // roles Fable's variants can no longer take once the family limit hits.
  assert.ok(technicalRoles.some((role) => byRole[role]?.primary?.modelId === "second-model" || byRole[role]?.primary?.modelId === "third-model"),
    "a genuinely different model must cover at least one role once the Fable family hits its concentration limit");
});

test("buildEfficientTeam applies absolute demand floors and coordinates equal-cost alternatives", () => {
  // Both models clear the new absolute floors despite differing retention:
  // Codex Architect/Reviewer .715, Builder/Test Runner .71, Debugger (fix) .87.
  const aa = [
    { slug: "claude-model", name: "Claude Model", intelligenceIndex: 90, codingIndex: 90, mathIndex: null, terminalBenchV2: 0.90 },
    { slug: "codex-model", name: "Codex Model", intelligenceIndex: 88, codingIndex: 55, mathIndex: null, terminalBenchV2: 0.87 }
  ];
  const scored = scoreAvailableModels(
    [{ adapterId: "claude", models: [{ id: "claude-model" }] }, { adapterId: "codex", models: [{ id: "codex-model" }] }], aa
  );
  const team = buildEfficientTeam(scored, { claude: { ok: true }, codex: { ok: true } });
  // Both models now clear the absolute floors; concentration breaks cost ties.
  assert.deepEqual(Object.fromEntries(team.map(entry => [entry.role, entry.primary?.adapterId])), {
    Explorer: "claude", Architect: "codex", Builder: "claude",
    "Debugger (fix)": "codex", "Test Runner": "claude", Reviewer: "codex",
    "Debugger (diagnosis)": "claude", "Test Designer": "claude"
  });

});

test("buildAiTeam blocks Reviewer when no independent real alternative exists", () => {
  const aa = [{ slug: "only-model", name: "Only Model", intelligenceIndex: 80, codingIndex: 80, mathIndex: null, terminalBenchV2: 0.80 }];
  const scored = scoreAvailableModels([{ adapterId: "claude", models: [{ id: "only-model" }] }], aa);
  const team = buildAiTeam(scored, { claude: { ok: true } });
  const byRole = Object.fromEntries(team.map((t) => [t.role, t]));
  assert.equal(byRole.Reviewer.primary, null);
  assert.equal(byRole.Builder.primary.adapterId, "claude");
});

test("buildAiTeam never forces Reviewer onto a decisively worse independent alternative just to satisfy independence — a capability floor gates the swap", () => {
  // codex-model is dramatically weaker on every real metric (not a near
  // tie) — the only "independent" option here fails the same
  // NEAR_EQUIVALENCE_BAND used everywhere else, so Reviewer must remain blocked rather than using the Builder's
  // provider or being forced onto a much worse model.
  const aa = [
    { slug: "claude-model", name: "Claude Model", intelligenceIndex: 90, codingIndex: 90, mathIndex: null, terminalBenchV2: 0.90 },
    { slug: "codex-model", name: "Codex Model", intelligenceIndex: 20, codingIndex: 20, mathIndex: null, terminalBenchV2: 0.20 }
  ];
  const scored = scoreAvailableModels(
    [{ adapterId: "claude", models: [{ id: "claude-model" }] }, { adapterId: "codex", models: [{ id: "codex-model" }] }], aa
  );
  const team = buildAiTeam(scored, { claude: { ok: true }, codex: { ok: true } });
  const byRole = Object.fromEntries(team.map((t) => [t.role, t]));
  assert.equal(byRole.Builder.primary.adapterId, "claude");
  assert.equal(byRole.Reviewer.primary, null, "independence must not override a real capability floor");
});

test("annotateWithRegistryEvidence attaches real registry evidence without changing any ranking value", () => {
  const aa = [{ slug: "gpt-6-astra", name: "GPT-6 Astra", intelligenceIndex: 52.8, codingIndex: 76.9, mathIndex: null }];
  const scored = scoreAvailableModels([{ adapterId: "codex", models: [{ id: "gpt-6-astra" }] }], aa);
  const registry = createCapabilityRegistry();
  const id = registry.registerIdentity("codex", "gpt-6-astra");
  registry.addEvidence(id, { metric: "gpqa-diamond", value: 96.0, source: "openai-official", date: "2026-09-03", verified: false });

  const annotated = annotateWithRegistryEvidence(scored, registry);
  assert.equal(annotated[0].intelligenceIndex, 52.8); // unchanged
  assert.deepEqual(annotated[0].corroboration, [{ metric: "gpqa-diamond", value: 96.0, source: "openai-official" }]);
});

test("annotateWithRegistryEvidence omits corroboration (no extra field) when the registry has nothing for a model", () => {
  const aa = [{ slug: "gpt-6-astra", name: "GPT-6 Astra", intelligenceIndex: 52.8, codingIndex: 76.9, mathIndex: null }];
  const scored = scoreAvailableModels([{ adapterId: "codex", models: [{ id: "gpt-6-astra" }] }], aa);
  const registry = createCapabilityRegistry();
  const annotated = annotateWithRegistryEvidence(scored, registry);
  assert.equal(annotated[0].corroboration, undefined);
});

test("annotateWithRegistryEvidence returns models unchanged when no registry is given", () => {
  const aa = [{ slug: "gpt-6-astra", name: "GPT-6 Astra", intelligenceIndex: 52.8, codingIndex: 76.9, mathIndex: null }];
  const scored = scoreAvailableModels([{ adapterId: "codex", models: [{ id: "gpt-6-astra" }] }], aa);
  assert.equal(annotateWithRegistryEvidence(scored), scored);
});

test("buildAiTeam attaches corroboration to a team pick when given a registry, without changing which model was chosen", () => {
  const aa = [
    { slug: "claude-model", name: "Claude Model", intelligenceIndex: 90, codingIndex: 90, mathIndex: null, terminalBenchV2: 0.90 },
    { slug: "codex-model", name: "Codex Model", intelligenceIndex: 20, codingIndex: 20, mathIndex: null, terminalBenchV2: 0.20 }
  ];
  const scored = scoreAvailableModels(
    [{ adapterId: "claude", models: [{ id: "claude-model" }] }, { adapterId: "codex", models: [{ id: "codex-model" }] }], aa
  );
  const registry = createCapabilityRegistry();
  const id = registry.registerIdentity("claude", "claude-model");
  registry.addEvidence(id, { metric: "kairo.success", value: 1, source: "kairo-telemetry", date: "2026-09-12", verified: true });

  const withoutRegistry = buildAiTeam(scored, { claude: { ok: true }, codex: { ok: true } });
  const withRegistry = buildAiTeam(scored, { claude: { ok: true }, codex: { ok: true } }, registry);
  const builderWithout = withoutRegistry.find((t) => t.role === "Builder");
  const builderWith = withRegistry.find((t) => t.role === "Builder");

  assert.equal(builderWith.primary.adapterId, builderWithout.primary.adapterId, "the pick itself never changes");
  // terminalBenchV2 (now a real required-capability signal for Builder,
  // not just a ranking fallback) shows up as corroboration even without
  // an explicit registry — ensureRegistry always ingests it internally.
  assert.deepEqual(builderWithout.primary.corroboration, [{ metric: "terminalBenchV2", value: 0.9, source: "artificial-analysis-free" }]);
  assert.deepEqual(builderWith.primary.corroboration, [
    { metric: "kairo.success", value: 1, source: "kairo-telemetry" },
    { metric: "terminalBenchV2", value: 0.9, source: "artificial-analysis-free" }
  ]);
});

test("buildEfficientTeam prefers a real, meaningfully cheaper near-equivalent over the raw leader — capability being close enough is when cost should decide", () => {
  // Shaped directly on real measured data: Claude Fable 5.1 vs OpenCode
  // Go's Kimi K3 sit ~6.6% apart on codingIndex (within the 8% band) at
  // roughly a third of the real price.
  const aa = [
    { slug: "fable-model", name: "Fable-shaped", intelligenceIndex: 53.4, codingIndex: 81.6, mathIndex: null, priceInputPerMTok: 10 },
    { slug: "kimi-model", name: "Kimi-shaped", intelligenceIndex: 43.8, codingIndex: 76.2, mathIndex: null, priceInputPerMTok: 3 }
  ];
  const scored = scoreAvailableModels(
    [{ adapterId: "claude", models: [{ id: "fable-model" }] }, { adapterId: "opencode-go", models: [{ id: "kimi-model" }] }], aa
  );
  // Checked on Explorer — the first role assigned in this fixture (Kimi
  // also clears the intelligence floor here), so the portfolio's own
  // 2-role concentration limit can't yet have contaminated the result.
  const team = buildEfficientTeam(scored, { claude: { ok: true }, "opencode-go": { ok: true } });
  const explorer = team.find((t) => t.role === "Explorer");
  assert.equal(explorer.primary.adapterId, "opencode-go", "the cheaper, near-equivalent real option should win over the raw leader");
  assert.match(explorer.reason, /lower real full input\+output price/);
});

test("buildAiTeam never lets price itself decide — it only ever sees a role's real capability and the portfolio's concentration state", () => {
  // Fable's intelligence lead over Kimi (~18%) is decisive for Explorer/
  // Architect (reasoning-only/reasoning+coding) — Kimi never qualifies
  // there. Debugger (fix) now also folds in terminalExecution (a real required
  // capability, tied here at 0.78 for both) — with reasoning+coding+
  // terminal all in the median, a tied terminal score is real evidence
  // that dilutes reasoning's otherwise-decisive weight enough for Kimi to
  // become a real near-equivalent for Debugger \(fix\) too, same as Builder/
  // Test Runner. Kimi never wins because it's cheaper; price never appears
  // anywhere in this reasoning — only real capability and concentration.
  const aa = [
    { slug: "fable-model", name: "Fable-shaped", intelligenceIndex: 53.4, codingIndex: 81.6, mathIndex: null, priceInputPerMTok: 10, terminalBenchV2: 0.78 },
    { slug: "kimi-model", name: "Kimi-shaped", intelligenceIndex: 43.8, codingIndex: 76.2, mathIndex: null, priceInputPerMTok: 3, terminalBenchV2: 0.78 }
  ];
  const scored = scoreAvailableModels(
    [{ adapterId: "claude", models: [{ id: "fable-model" }] }, { adapterId: "opencode-go", models: [{ id: "kimi-model" }] }], aa
  );
  const team = buildAiTeam(scored, { claude: { ok: true }, "opencode-go": { ok: true } });
  const byRole = Object.fromEntries(team.map((t) => [t.role, t]));

  assert.equal(byRole.Explorer.primary.adapterId, "claude");
  assert.equal(byRole.Architect.primary.adapterId, "claude");
  assert.equal(byRole.Builder.primary.adapterId, "opencode-go", "the real coding+terminal near-equivalent gets Builder under the role-weighted capability and concentration policy");
  assert.equal(byRole["Debugger (fix)"].primary.adapterId, "claude", "S43 scaled cap leaves the stronger qualified demanding model available");
  assert.match(byRole.Builder.reason, /assigned to a different model\/provider to avoid concentration/);

  for (const entry of team) {
    if (entry.reason) assert.doesNotMatch(entry.reason, /price/i, "AI TEAM's reasoning must never mention price at all");
  }
});

test("buildAiTeam permits a cheaper light-role model outside the old relative retention band", () => {
  const aa = [
    { slug: "strong-model", name: "Strong", intelligenceIndex: 90, codingIndex: 90, mathIndex: null, priceInputPerMTok: 10, terminalBenchV2: 0.90 },
    { slug: "cheap-weak-model", name: "Cheap Weak", intelligenceIndex: 90, codingIndex: 40, mathIndex: null, priceInputPerMTok: 1, terminalBenchV2: 0.90 }
  ];
  const scored = scoreAvailableModels(
    [{ adapterId: "claude", models: [{ id: "strong-model" }] }, { adapterId: "opencode-go", models: [{ id: "cheap-weak-model" }] }], aa
  );
  const team = buildAiTeam(scored, { claude: { ok: true }, "opencode-go": { ok: true } });
  const tester = team.find((t) => t.role === "Test Runner");
  assert.equal(tester.primary.adapterId, "opencode-go", "the light role admits a cheap candidate above its absolute .35 floor");
});

test("buildAiTeam falls back to usage-based diversity when near-equivalent alternatives have no real price to compare", () => {
  const aa = [
    { slug: "claude-model", name: "Claude Model", intelligenceIndex: 53.4, codingIndex: 81.6, mathIndex: null, terminalBenchV2: 0.80 },
    { slug: "codex-model", name: "Codex Model", intelligenceIndex: 52.8, codingIndex: 78.0, mathIndex: null, terminalBenchV2: 0.80 }
  ];
  const scored = scoreAvailableModels(
    [{ adapterId: "claude", models: [{ id: "claude-model" }] }, { adapterId: "codex", models: [{ id: "codex-model" }] }], aa
  );
  // Neither model reports a real price — must not crash or fabricate a
  // preference; behavior should match the pre-existing usage-based tiebreak.
  const team = buildAiTeam(scored, { claude: { ok: true }, codex: { ok: true } });
  const tester = team.find((t) => t.role === "Test Runner");
  assert.ok(["claude", "codex"].includes(tester.primary.adapterId));
});

test("Debugger (fix)'s real optional terminalBenchV2 signal can flip a near-equivalent pick, without requiring every model to report it", () => {
  // Debugger (fix)'s real required capabilities are reasoning, coding,
  // terminalExecution (ROLE_CAPABILITIES) — coding can no longer be
  // omitted to isolate terminal-bench (missing a required capability now
  // excludes a candidate entirely, see buildAiTeamRoleDefinitions). Under
  // the multi-metric median engine, a capability only counts toward the
  // median when a model has coverage for it — with exactly 2 candidates
  // tied EXACTLY on 2 of 3 capabilities, the median mathematically can
  // never move on the third alone ([0.5, 0.5, 1]'s median is still 0.5):
  // one of reasoning/coding must carry a small real gap of its own too,
  // for the median to have any real room to shift — a third, decisively
  // worse real candidate on reasoning/coding also gives the percentile
  // engine real granularity (0/0.5/1 instead of a binary 0/1 tie).
  const aa = [
    { slug: "claude-model", name: "Claude Model", intelligenceIndex: 90, codingIndex: 79, mathIndex: null, terminalBenchV2: 0.60 },
    { slug: "codex-model", name: "Codex Model", intelligenceIndex: 90, codingIndex: 81, mathIndex: null, terminalBenchV2: 0.95 },
    { slug: "weak-model", name: "Weak Model", intelligenceIndex: 40, codingIndex: 40, mathIndex: null, terminalBenchV2: 0.40 }
  ];
  const scored = scoreAvailableModels(
    [
      { adapterId: "claude", models: [{ id: "claude-model" }] }, { adapterId: "codex", models: [{ id: "codex-model" }] },
      { adapterId: "opencode-go", models: [{ id: "weak-model" }] }
    ], aa
  );
  const claude = scored.find((m) => m.adapterId === "claude");
  assert.equal(claude.terminalBenchV2, 0.60); // confirms the field actually flows through scoreAvailableModels
  const team = buildAiTeam(scored, { claude: { ok: true }, codex: { ok: true }, "opencode-go": { ok: true } });
  const debugger_ = team.find((t) => t.role === "Debugger (fix)");
  assert.equal(debugger_.primary.adapterId, "codex", "the real terminal-bench gap should be the deciding signal once reasoning/coding are this close");
});

test("a role's optional metric never shrinks its candidate pool for a model AA simply hasn't scored on it yet", () => {
  const aa = [
    // Only one model reports tauBanking (Builder's optional metric) — the
    // other must still qualify for Builder using codingIndex alone.
    { slug: "has-tau", name: "Has Tau", intelligenceIndex: 50, codingIndex: 60, mathIndex: null, tauBanking: 0.9, terminalBenchV2: 0.7 },
    { slug: "no-tau", name: "No Tau", intelligenceIndex: 50, codingIndex: 95, mathIndex: null, terminalBenchV2: 0.7 }
  ];
  const scored = scoreAvailableModels(
    [{ adapterId: "claude", models: [{ id: "has-tau" }] }, { adapterId: "codex", models: [{ id: "no-tau" }] }], aa
  );
  const team = buildAiTeam(scored, { claude: { ok: true }, codex: { ok: true } });
  const builder = team.find((t) => t.role === "Builder");
  // no-tau's real ~58% coding advantage must still win decisively —
  // missing the optional metric must not disqualify or penalize it.
  assert.equal(builder.primary.adapterId, "codex");
});

test("S25 buildEfficientTeam lets decisively stronger provisional evidence compete", () => {
  const aa = [
    { slug: "thin-cheap", name: "Thin Cheap", intelligenceIndex: null, codingIndex: null, mathIndex: null, priceInputPerMTok: 0.1 },
    { slug: "broad-pricier", name: "Broad Pricier", intelligenceIndex: null, codingIndex: null, mathIndex: null, priceInputPerMTok: 5 }
  ];
  const scored = scoreAvailableModels([
    { adapterId: "opencode-go", models: [{ id: "thin-cheap" }] },
    { adapterId: "claude", models: [{ id: "broad-pricier" }] }
  ], aa);
  const registry = createCapabilityRegistry();
  const thinId = registry.registerIdentity("opencode-go", "thin-cheap");
  const broadId = registry.registerIdentity("claude", "broad-pricier");
  // Thin: real, high single HLE score — 1 of reasoning's 3 real active
  // benchmarks, provisional — and much cheaper.
  registry.addEvidence(thinId, { metric: "hle", value: 0.95, source: "huggingface-leaderboard", scale: "unit", date: "2026-09-15", verified: false });
  // Broad: real evidence on 2 of 3 — comparable, even though pricier and
  // individually lower-scoring.
  registry.addEvidence(broadId, { metric: "gpqa", value: 0.55, source: "artificial-analysis-free", scale: "unit", date: "2026-09-15", verified: false });
  registry.addEvidence(broadId, { metric: "hle", value: 0.50, source: "artificial-analysis-free", scale: "unit", date: "2026-09-15", verified: false });

  const team = buildEfficientTeam(scored, { "opencode-go": { ok: true }, claude: { ok: true } }, registry, {
    roleCapabilities: { Explorer: { required: ["reasoning"], optional: [] } }
  });
  const explorer = team.find((t) => t.role === "Explorer");
  assert.equal(explorer.primary.adapterId, "opencode-go", "S25: the broad candidate is decisively weaker, not similar strength");
});

test("buildEfficientTeam prefers real higher throughput as the tie-break when BOTH real retention and real price are genuinely tied", () => {
  // A real capability DIFFERENCE at the same price is no longer an
  // arbitrary throughput tie under the Pareto balance-point redesign —
  // the candidate retaining strictly more real capability for the exact
  // same real resource cost legitimately wins outright (it dominates the
  // other on the Pareto frontier: >= resource, > retention). Throughput
  // only gets to decide a genuine tie on BOTH axes — same real
  // intelligenceIndex (retention) AND same real price — verified here
  // with intentionally IDENTICAL intelligenceIndex for both models.
  const aa = [
    { slug: "claude-model", name: "Claude Model", intelligenceIndex: 53.4, codingIndex: 81.6, mathIndex: null, priceInputPerMTok: 10, outputTokensPerSecond: 50 },
    { slug: "codex-model", name: "Codex Model", intelligenceIndex: 53.4, codingIndex: 81.6, mathIndex: null, priceInputPerMTok: 10, outputTokensPerSecond: 150 }
  ];
  const scored = scoreAvailableModels(
    [{ adapterId: "claude", models: [{ id: "claude-model" }] }, { adapterId: "codex", models: [{ id: "codex-model" }] }], aa
  );
  const team = buildEfficientTeam(scored, { claude: { ok: true }, codex: { ok: true } });
  const explorer = team.find((t) => t.role === "Explorer");
  assert.equal(explorer.primary.adapterId, "codex", "the real 3x faster option should win the tie when neither retention nor price distinguish them");
});

// The three tests below verify the Pareto balance-point redesign's own
// explicit acceptance criteria (never just "cheapest wins" or "leader
// wins") — they need a REAL three-way pool (not just two candidates) to
// have an actual "middle" to find at all: with exactly two candidates the
// balance score always ties by construction (see computeBalanceScores's
// own doc) and correctly falls through to the plain price cascade, which
// is what the near-equivalent-cheaper tests above already cover.

test("EFFICIENT never lets the pool's cheapest real candidate win automatically — a genuine balance point beats it when one exists", () => {
  const aa = [
    { slug: "leader-model", name: "Leader", intelligenceIndex: 90, codingIndex: null, mathIndex: null, priceInputPerMTok: 20 },
    // Real balance point: retains ~98% of the leader's real capability at
    // 1/4 of its real price.
    { slug: "balance-model", name: "Balance", intelligenceIndex: 88, codingIndex: null, mathIndex: null, priceInputPerMTok: 5 },
    // The pool's actual cheapest real option — real, adequate (clears the
    // 80% floor), but pays for its rock-bottom price with real capability
    // it can't make back anywhere else.
    { slug: "cheapest-model", name: "Cheapest", intelligenceIndex: 73, codingIndex: null, mathIndex: null, priceInputPerMTok: 1 }
  ];
  const scored = scoreAvailableModels([
    { adapterId: "claude", models: [{ id: "leader-model" }] },
    { adapterId: "codex", models: [{ id: "balance-model" }] },
    { adapterId: "opencode-go", models: [{ id: "cheapest-model" }] }
  ], aa);
  const team = buildEfficientTeam(scored, { claude: { ok: true }, codex: { ok: true }, "opencode-go": { ok: true } });
  const explorer = team.find((t) => t.role === "Explorer");
  assert.equal(explorer.primary.adapterId, "codex", "the real balance point must win over the pool's own cheapest real candidate");
});

test("EFFICIENT lets a pricier real candidate win when it's the genuine Pareto balance point, not just the intelligence leader", () => {
  const aa = [
    { slug: "leader-model", name: "Leader", intelligenceIndex: 90, codingIndex: null, mathIndex: null, priceInputPerMTok: 25 },
    // Real balance point: a broadly-measured, higher-retention (~94%) but
    // pricier real candidate — the "Terra/Sonnet"-shaped case from the
    // plan: it should legitimately win by sitting at the genuine
    // capability/resource balance, not by being either extreme.
    { slug: "balance-model", name: "Balance", intelligenceIndex: 85, codingIndex: null, mathIndex: null, priceInputPerMTok: 6 },
    { slug: "cheap-model", name: "Cheap", intelligenceIndex: 74, codingIndex: null, mathIndex: null, priceInputPerMTok: 1 }
  ];
  const scored = scoreAvailableModels([
    { adapterId: "claude", models: [{ id: "leader-model" }] },
    { adapterId: "codex", models: [{ id: "balance-model" }] },
    { adapterId: "opencode-go", models: [{ id: "cheap-model" }] }
  ], aa);
  const team = buildEfficientTeam(scored, { claude: { ok: true }, codex: { ok: true }, "opencode-go": { ok: true } });
  const explorer = team.find((t) => t.role === "Explorer");
  assert.equal(explorer.primary.adapterId, "codex", "the pricier real balance-point candidate must win over both the raw leader and the pool's cheapest option");
});

test("EFFICIENT still lets a near-equivalent real cheap model win legitimately when only two real candidates exist", () => {
  // With only two real candidates there's no real 'middle' for the
  // balance score to find (see computeBalanceScores's own doc — both
  // extremes tie at 0 by construction), so the real, near-equivalent,
  // much cheaper option correctly wins via the plain price cascade —
  // distinguishing "arbitrarily cheap at real capability cost" (excluded
  // by the floor) from "a genuinely good real deal" (this case).
  const aa = [
    { slug: "leader-model", name: "Leader", intelligenceIndex: 90, codingIndex: null, mathIndex: null, priceInputPerMTok: 20 },
    { slug: "cheap-near-equiv", name: "CheapNearEquiv", intelligenceIndex: 88, codingIndex: null, mathIndex: null, priceInputPerMTok: 2 }
  ];
  const scored = scoreAvailableModels([
    { adapterId: "claude", models: [{ id: "leader-model" }] },
    { adapterId: "codex", models: [{ id: "cheap-near-equiv" }] }
  ], aa);
  const team = buildEfficientTeam(scored, { claude: { ok: true }, codex: { ok: true } });
  const explorer = team.find((t) => t.role === "Explorer");
  assert.equal(explorer.primary.adapterId, "codex", "a real near-equivalent (98% retention) at 1/10 the price should still legitimately win");
});

// REGRESSION: Artificial Analysis's own raw dataset carries hundreds of
// real $0-priced models, and any of them reaching an eligible provider
// catalog would trigger this. computeBalanceScores used to normalize
// resource pressure via
// value/bestValue (a ratio against the pool's cheapest real value) —
// with a real free candidate this is 0/0 (NaN) or x/0 (Infinity),
// corrupting the whole pool's comparison and always forcing the
// capability leader to win by default. Fixed by normalizing raw values
// directly against the pool's own min/max instead of dividing by one of
// them (see computeBalanceScores's own doc).

test("REGRESSION: a real free (price $0) candidate in the pool must not corrupt the balance score or force the leader to win by default", () => {
  const aa = [
    { slug: "leader-model", name: "Leader", intelligenceIndex: 90, codingIndex: null, mathIndex: null, priceInputPerMTok: 20 },
    // The real balance point — same as the earlier balance-point test,
    // just with a genuinely free real candidate also present this time.
    { slug: "middle-model", name: "Middle", intelligenceIndex: 87, codingIndex: null, mathIndex: null, priceInputPerMTok: 5 },
    { slug: "free-model", name: "Free", intelligenceIndex: 73, codingIndex: null, mathIndex: null, priceInputPerMTok: 0 }
  ];
  const scored = scoreAvailableModels([
    { adapterId: "claude", models: [{ id: "leader-model" }] },
    { adapterId: "codex", models: [{ id: "middle-model" }] },
    { adapterId: "opencode-go", models: [{ id: "free-model" }] }
  ], aa);
  const team = buildEfficientTeam(scored, { claude: { ok: true }, codex: { ok: true }, "opencode-go": { ok: true } });
  const explorer = team.find((t) => t.role === "Explorer");
  assert.equal(explorer.primary.adapterId, "codex", "the real balance point must still win with a free candidate in the pool — the old ratio-based bug always defaulted to the leader here");
});

test("REGRESSION: two real free (price $0) candidates are still compared on real retention, not collapsed by a 0/0 division", () => {
  const aa = [
    { slug: "leader-model", name: "Leader", intelligenceIndex: 90, codingIndex: null, mathIndex: null, priceInputPerMTok: 20 },
    { slug: "free-high", name: "FreeHigh", intelligenceIndex: 85, codingIndex: null, mathIndex: null, priceInputPerMTok: 0 },
    { slug: "free-low", name: "FreeLow", intelligenceIndex: 73, codingIndex: null, mathIndex: null, priceInputPerMTok: 0 }
  ];
  const scored = scoreAvailableModels([
    { adapterId: "claude", models: [{ id: "leader-model" }] },
    { adapterId: "codex", models: [{ id: "free-high" }] },
    { adapterId: "opencode-go", models: [{ id: "free-low" }] }
  ], aa);
  const team = buildEfficientTeam(scored, { claude: { ok: true }, codex: { ok: true }, "opencode-go": { ok: true } });
  const explorer = team.find((t) => t.role === "Explorer");
  assert.equal(explorer.primary.adapterId, "codex", "with two real free candidates tied on price (pressure), the one retaining more real capability must win");
});

test("REGRESSION: when every real candidate reports the same price (including all $0), the capability leader wins deterministically instead of a NaN-driven default", () => {
  const aa = [
    { slug: "leader-model", name: "Leader", intelligenceIndex: 90, codingIndex: null, mathIndex: null, priceInputPerMTok: 0 },
    { slug: "middle-model", name: "Middle", intelligenceIndex: 87, codingIndex: null, mathIndex: null, priceInputPerMTok: 0 },
    { slug: "weak-model", name: "Weak", intelligenceIndex: 73, codingIndex: null, mathIndex: null, priceInputPerMTok: 0 }
  ];
  const scored = scoreAvailableModels([
    { adapterId: "claude", models: [{ id: "leader-model" }] },
    { adapterId: "codex", models: [{ id: "middle-model" }] },
    { adapterId: "opencode-go", models: [{ id: "weak-model" }] }
  ], aa);
  const team = buildEfficientTeam(scored, { claude: { ok: true }, codex: { ok: true }, "opencode-go": { ok: true } });
  const explorer = team.find((t) => t.role === "Explorer");
  assert.equal(explorer.primary.adapterId, "claude", "with zero real price range to compare, retention alone must decide, and it must resolve to the real leader, never an undefined/NaN pick");
});

test("REGRESSION: the real balance-point pick does not depend on the input order of the candidate pool", () => {
  const buildTeam = (catalogOrder) => {
    const aa = [
      { slug: "leader-model", name: "Leader", intelligenceIndex: 90, codingIndex: null, mathIndex: null, priceInputPerMTok: 20 },
      { slug: "middle-model", name: "Middle", intelligenceIndex: 87, codingIndex: null, mathIndex: null, priceInputPerMTok: 5 },
      { slug: "free-model", name: "Free", intelligenceIndex: 73, codingIndex: null, mathIndex: null, priceInputPerMTok: 0 }
    ];
    const scored = scoreAvailableModels(catalogOrder, aa);
    return buildEfficientTeam(scored, { claude: { ok: true }, codex: { ok: true }, "opencode-go": { ok: true } });
  };
  const forward = buildTeam([
    { adapterId: "claude", models: [{ id: "leader-model" }] },
    { adapterId: "codex", models: [{ id: "middle-model" }] },
    { adapterId: "opencode-go", models: [{ id: "free-model" }] }
  ]);
  const reversed = buildTeam([
    { adapterId: "opencode-go", models: [{ id: "free-model" }] },
    { adapterId: "codex", models: [{ id: "middle-model" }] },
    { adapterId: "claude", models: [{ id: "leader-model" }] }
  ]);
  const forwardExplorer = forward.find((t) => t.role === "Explorer");
  const reversedExplorer = reversed.find((t) => t.role === "Explorer");
  assert.equal(forwardExplorer.primary.adapterId, "codex");
  assert.equal(reversedExplorer.primary.adapterId, forwardExplorer.primary.adapterId, "the real balance-point winner must not depend on the order candidates were scored in");
});

test("a role's optional metric can be satisfied by real registry evidence from any connected source, not just the AA field baked onto the model", () => {
  const aa = [
    // Neither model reports gpqa via AA at all — the registry is the only
    // place this evidence exists, simulating a non-AA source (e.g. a
    // manufacturer snapshot or Hugging Face leaderboard).
    { slug: "claude-model", name: "Claude Model", intelligenceIndex: 90, codingIndex: 90, mathIndex: null },
    { slug: "codex-model", name: "Codex Model", intelligenceIndex: 90, codingIndex: 90, mathIndex: null }
  ];
  const scored = scoreAvailableModels(
    [{ adapterId: "claude", models: [{ id: "claude-model" }] }, { adapterId: "codex", models: [{ id: "codex-model" }] }], aa
  );
  const registry = createCapabilityRegistry();
  const claudeId = registry.registerIdentity("claude", "claude-model");
  const codexId = registry.registerIdentity("codex", "codex-model");
  registry.addEvidence(claudeId, { metric: "gpqa", value: 0.60, source: "other-source", verified: true });
  registry.addEvidence(codexId, { metric: "gpqa", value: 0.95, source: "other-source", verified: true });

  const team = buildAiTeam(scored, { claude: { ok: true }, codex: { ok: true } }, registry);
  const explorer = team.find((t) => t.role === "Explorer");
  assert.equal(explorer.primary.adapterId, "codex", "gpqa evidence from a non-AA source in the registry must actually decide the pick, not just show as /models corroboration");
});

test("buildEfficientTeam prefers Kairo's own observed real duration over AA's reported throughput when both exist", () => {
  const aa = [
    { slug: "claude-model", name: "Claude Model", intelligenceIndex: 53.4, codingIndex: 81.6, mathIndex: null, priceInputPerMTok: 10, outputTokensPerSecond: 150 },
    { slug: "codex-model", name: "Codex Model", intelligenceIndex: 52.8, codingIndex: 77.0, mathIndex: null, priceInputPerMTok: 10, outputTokensPerSecond: 50 }
  ];
  const scored = scoreAvailableModels(
    [{ adapterId: "claude", models: [{ id: "claude-model" }] }, { adapterId: "codex", models: [{ id: "codex-model" }] }], aa
  );
  const registry = createCapabilityRegistry();
  const claudeId = registry.registerIdentity("claude", "claude-model");
  const codexId = registry.registerIdentity("codex", "codex-model");
  // Real observed telemetry says the opposite of AA's reported throughput:
  // Codex is actually faster in Kairo's own real runs (lower durationMs),
  // even though AA reports Claude as the higher-throughput model.
  registry.addEvidence(claudeId, { metric: "kairo.durationMs", value: 9000, source: "kairo-telemetry", verified: true });
  registry.addEvidence(codexId, { metric: "kairo.durationMs", value: 3000, source: "kairo-telemetry", verified: true });

  // Checked on Explorer — the first role assigned in this fixture, so the
  // portfolio's own concentration limits can't contaminate the result.
  const team = buildEfficientTeam(scored, { claude: { ok: true }, codex: { ok: true } }, registry);
  const explorer = team.find((t) => t.role === "Explorer");
  assert.equal(explorer.primary.adapterId, "codex", "real observed duration must win over AA's reported throughput, which alone would have picked claude here");
});

// The tests below cover EFFICIENT_CAPABILITY_FLOOR (0.80) — a genuinely
// different policy from NEAR_EQUIVALENCE_BAND (0.08). The floor lets a
// real, meaningfully weaker (but still adequate) model compete, not just
// near-identical ones; it also stops a provider's quota alone from
// deciding, since quota now sits last in EFFICIENCY_DIMENSIONS.

test("a model below the 80% capability floor is excluded from EFFICIENT TEAM even if it's real and cheaper", () => {
  const aa = [
    { slug: "leader-model", name: "Leader", intelligenceIndex: 90, codingIndex: 90, mathIndex: null, priceInputPerMTok: 10, terminalBenchV2: 0.90 },
    // 55% of the leader's coding score — real, but below the 80% floor and,
    // under S34, below the .55 Builder absolute floor (the old .585 now clears it).
    { slug: "too-weak-model", name: "Too Weak", intelligenceIndex: 90, codingIndex: 49.5, mathIndex: null, priceInputPerMTok: 1, terminalBenchV2: 0.495 }
  ];
  const scored = scoreAvailableModels(
    [{ adapterId: "claude", models: [{ id: "leader-model" }] }, { adapterId: "codex", models: [{ id: "too-weak-model" }] }], aa
  );
  const team = buildEfficientTeam(scored, { claude: { ok: true }, codex: { ok: true } });
  const builder = team.find((t) => t.role === "Builder");
  assert.equal(builder.primary.adapterId, "claude", "a model below the capability floor must never win purely on price");
  assert.match(builder.reason, /Only adequate option/);
});

test("a model at or above the 80% capability floor competes on efficiency, even with a real, meaningful capability gap", () => {
  const aa = [
    { slug: "leader-model", name: "Leader", intelligenceIndex: 90, codingIndex: 90, mathIndex: null, priceInputPerMTok: 10, terminalBenchV2: 0.90 },
    // 85% of the leader's coding score — well outside NEAR_EQUIVALENCE_BAND
    // (8%), but still within the new, wider 80% floor.
    { slug: "adequate-model", name: "Adequate", intelligenceIndex: 20, codingIndex: 76.5, mathIndex: null, priceInputPerMTok: 1, terminalBenchV2: 0.765 },
    // A third, real distractor so Explorer/Architect/Debugger \(fix\)/Reviewer
    // (intelligence) claim a different model entirely, never touching
    // "adequate-model" — isolating Builder/Test Runner (coding) from the
    // portfolio's own 2-role concentration limit for this check.
    { slug: "distractor-model", name: "Distractor", intelligenceIndex: 88, codingIndex: 20, mathIndex: null, priceInputPerMTok: 5, terminalBenchV2: 0.20 }
  ];
  const scored = scoreAvailableModels([
    { adapterId: "claude", models: [{ id: "leader-model" }] },
    { adapterId: "codex", models: [{ id: "adequate-model" }] },
    { adapterId: "opencode-go", models: [{ id: "distractor-model" }] }
  ], aa);
  const team = buildEfficientTeam(scored, { claude: { ok: true }, codex: { ok: true }, "opencode-go": { ok: true } });
  const builder = team.find((t) => t.role === "Builder");
  assert.equal(builder.primary.adapterId, "codex", "a model that clears the wider capability floor should win on price, even though it's well outside the old 8% near-equivalence band");
});

test("the capability floor is configurable via buildEfficientTeam's fourth argument", () => {
  const aa = [
    { slug: "leader-model", name: "Leader", intelligenceIndex: 90, codingIndex: 90, mathIndex: null, priceInputPerMTok: 10, terminalBenchV2: 0.90 },
    { slug: "adequate-model", name: "Adequate", intelligenceIndex: 90, codingIndex: 76.5, mathIndex: null, priceInputPerMTok: 1, terminalBenchV2: 0.765 } // 85%
  ];
  const scored = scoreAvailableModels(
    [{ adapterId: "claude", models: [{ id: "leader-model" }] }, { adapterId: "codex", models: [{ id: "adequate-model" }] }], aa
  );
  const strictFloor = buildEfficientTeam(scored, { claude: { ok: true }, codex: { ok: true } }, null, { capabilityFloor: 0.9 });
  const builder = strictFloor.find((t) => t.role === "Builder");
  assert.equal(builder.primary.adapterId, "claude", "a stricter 90% floor should exclude the 85%-capable candidate");
});

test("S23 reserve headroom overrides observed efficiency on a depleted provider", () => {
  const aa = [
    // Codex is the real capability leader; Claude retains ~90.5% of its
    // coding score, well clear of the 80% floor.
    { slug: "codex-model", name: "Codex Model", intelligenceIndex: 90, codingIndex: 90, mathIndex: null },
    { slug: "claude-model", name: "Claude Model", intelligenceIndex: 90, codingIndex: 81.5, mathIndex: null }
  ];
  const scored = scoreAvailableModels(
    [{ adapterId: "codex", models: [{ id: "codex-model" }] }, { adapterId: "claude", models: [{ id: "claude-model" }] }], aa
  );
  const registry = createCapabilityRegistry();
  const codexId = registry.registerIdentity("codex", "codex-model");
  const claudeId = registry.registerIdentity("claude", "claude-model");
  // Claude's real observed cost per task is meaningfully lower — a
  // genuine per-model efficiency signal. S23 reserve now takes precedence
  // when that provider is depleted and qualified headroom exists.
  registry.addEvidence(codexId, { metric: "kairo.cost", value: 0.40, source: "kairo-telemetry", verified: true });
  registry.addEvidence(claudeId, { metric: "kairo.cost", value: 0.05, source: "kairo-telemetry", verified: true });
  // Codex's PROVIDER has far more real quota headroom than Claude's —
  // modeled as ProviderCapacity, resolved by adapterId, never copied into
  // the per-model registry above.
  const providerCapacity = { codex: { adapterId: "codex", quotaRemainingPercent: 95 }, claude: { adapterId: "claude", quotaRemainingPercent: 10 } };

  // Checked on Explorer — the first role assigned in this fixture (both
  // models tie exactly on intelligence, so the same real cost evidence
  // decides there too), before the portfolio's own 2-role concentration
  // limit could contaminate a later role's result.
  const team = buildEfficientTeam(scored, { codex: { ok: true }, claude: { ok: true } }, registry, { providerCapacity });
  const explorer = team.find((t) => t.role === "Explorer");
  assert.equal(explorer.primary.adapterId, "codex", "reserve moves to qualified headroom before exhaustion");
  assert.match(explorer.reason, /Quota reserve/);
});

test("real provider quota still decides as a last resort when no per-model signal distinguishes otherwise-adequate candidates", () => {
  const aa = [
    { slug: "claude-model", name: "Claude Model", intelligenceIndex: 90, codingIndex: 90, mathIndex: null },
    { slug: "codex-model", name: "Codex Model", intelligenceIndex: 90, codingIndex: 81.5, mathIndex: null } // ~90.5%, clears the floor
  ];
  const scored = scoreAvailableModels(
    [{ adapterId: "claude", models: [{ id: "claude-model" }] }, { adapterId: "codex", models: [{ id: "codex-model" }] }], aa
  );
  // No real consumption/cost/duration/price/throughput evidence for
  // either model — quota is the only real signal available, so it's
  // legitimate for it to decide, just last in line.
  const providerCapacity = { claude: { adapterId: "claude", quotaRemainingPercent: 10 }, codex: { adapterId: "codex", quotaRemainingPercent: 95 } };

  // Checked on Explorer — the first role assigned in this fixture (both
  // models tie exactly on intelligence, so quota decides there first).
  const team = buildEfficientTeam(scored, { claude: { ok: true }, codex: { ok: true } }, null, { providerCapacity });
  const explorer = team.find((t) => t.role === "Explorer");
  assert.equal(explorer.primary.adapterId, "codex", "with no other real signal, quota headroom is a legitimate last-resort tiebreak");
  assert.match(explorer.reason, /Quota reserve/);
});

test("provider quota is resolved per-adapter, not per-model — two models under the winning provider both benefit identically", () => {
  const aa = [
    { slug: "claude-fable", name: "Fable", intelligenceIndex: 90, codingIndex: 90, mathIndex: null },
    { slug: "claude-opus", name: "Opus", intelligenceIndex: 90, codingIndex: 88, mathIndex: null }, // ~97.8%, clears the floor
    { slug: "codex-model", name: "Codex Model", intelligenceIndex: 90, codingIndex: 89, mathIndex: null } // ~98.9%, clears the floor
  ];
  const scored = scoreAvailableModels(
    [{ adapterId: "claude", models: [{ id: "claude-fable" }, { id: "claude-opus" }] }, { adapterId: "codex", models: [{ id: "codex-model" }] }], aa
  );
  // No per-model signal for any of the three — Claude's real quota
  // headroom is the only distinguishing signal, and it applies equally to
  // BOTH Claude models, not just whichever one happens to be the leader.
  const providerCapacity = { claude: { adapterId: "claude", quotaRemainingPercent: 90 }, codex: { adapterId: "codex", quotaRemainingPercent: 5 } };
  // Checked on Explorer — the first role assigned in this fixture, before
  // the portfolio's own concentration state could contaminate the result.
  const team = buildEfficientTeam(scored, { claude: { ok: true }, codex: { ok: true } }, null, { providerCapacity });
  const explorer = team.find((t) => t.role === "Explorer");
  assert.equal(explorer.primary.adapterId, "claude", "the provider with more real headroom should win when nothing else distinguishes the candidates");
});

// The tests below use the REAL production ingestion functions
// (ingestOfficialSnapshotEvidence, ingestHuggingFaceLeaderboardEvidence)
// with the exact metric names those sources actually write in production
// ("terminal-bench", "hle") — not a hand-picked synthetic key like "gpqa"
// added directly via registry.addEvidence(). This is what proves the
// canonical capability mapping (CANONICAL_CAPABILITIES) actually bridges
// real vocabulary mismatches, not just a same-named test fixture.

test("Debugger (fix)'s terminalExecution requirement is satisfied by the real ingestOfficialSnapshotEvidence pipeline (metric name \"terminal-bench\", not a same-named synthetic key)", () => {
  // Debugger (fix)'s real required capabilities (reasoning, coding,
  // terminalExecution) are aggregated via median — coding can no longer
  // be omitted to isolate terminal-bench (missing a required capability's
  // evidence now excludes a candidate entirely, see
  // buildAiTeamRoleDefinitions), and a median of 3 with 2 candidates tied
  // exactly on 2 capabilities mathematically can't move on the third
  // alone — so codingIndex carries a small real gap of its own, and a
  // third, decisively worse real candidate gives the percentile engine
  // real granularity (0/0.5/1 instead of a binary 0/1 tie).
  const aa = [
    { slug: "astra-model", name: "Astra Model", intelligenceIndex: 90, codingIndex: 79, mathIndex: null },
    { slug: "fable-model", name: "Fable Model", intelligenceIndex: 90, codingIndex: 81, mathIndex: null },
    { slug: "weak-model", name: "Weak Model", intelligenceIndex: 40, codingIndex: 40, mathIndex: null }
  ];
  const scored = scoreAvailableModels(
    [
      { adapterId: "codex", models: [{ id: "astra-model" }] }, { adapterId: "claude", models: [{ id: "fable-model" }] },
      { adapterId: "opencode-go", models: [{ id: "weak-model" }] }
    ], aa
  );
  const registry = createCapabilityRegistry();
  // Real production function, real integrity validation, real metric name
  // ("terminal-bench") — only the magnitudes are a test fixture, chosen
  // large enough to demonstrate decisive influence unambiguously.
  ingestOfficialSnapshotEvidence(registry, [{
    source: "test-official", url: "https://example.com/test-official", published: "2026-09-12",
    benchmark: "terminal-bench", benchmarkVersion: "test", caveat: "test fixture, not a real published table",
    scores: [
      { adapterId: "codex", modelId: "astra-model", value: 30 },
      { adapterId: "claude", modelId: "fable-model", value: 90 },
      { adapterId: "opencode-go", modelId: "weak-model", value: 20 }
    ]
  }]);

  const team = buildAiTeam(scored, { codex: { ok: true }, claude: { ok: true }, "opencode-go": { ok: true } }, registry);
  const debugger_ = team.find((t) => t.role === "Debugger (fix)");
  assert.equal(debugger_.primary.adapterId, "claude", "real terminal-bench evidence from the actual production ingestion pipeline must decide this, not just AA's tied intelligence/coding");
});

test("Explorer's reasoning requirement is satisfied by the real ingestHuggingFaceLeaderboardEvidence pipeline (metric name \"hle\", not a same-named synthetic key)", () => {
  const aa = [
    { slug: "model-a", name: "Model A", intelligenceIndex: 90, codingIndex: 90, mathIndex: null },
    { slug: "model-b", name: "Model B", intelligenceIndex: 90, codingIndex: 90, mathIndex: null }
  ];
  const scored = scoreAvailableModels(
    [{ adapterId: "claude", models: [{ id: "model-a" }] }, { adapterId: "opencode-go", models: [{ id: "model-b" }] }], aa
  );
  const registry = createCapabilityRegistry();
  // Real production function and real HF entry shape (org/model modelId,
  // verified flag) — only the magnitudes are a test fixture.
  ingestHuggingFaceLeaderboardEvidence(
    registry,
    [{ adapterId: "claude", models: [{ id: "model-a" }] }, { adapterId: "opencode-go", models: [{ id: "model-b" }] }],
    [
      { modelId: "anthropic/model-a", value: 0.30, verified: false, rank: 10 },
      { modelId: "moonshotai/model-b", value: 0.85, verified: true, rank: 1 }
    ],
    { metric: "hle", fetchedAt: "2026-09-12" }
  );

  const team = buildAiTeam(scored, { claude: { ok: true }, "opencode-go": { ok: true } }, registry);
  const explorer = team.find((t) => t.role === "Explorer");
  assert.equal(explorer.primary.adapterId, "opencode-go", "real hle evidence from the actual production Hugging Face ingestion pipeline must decide this, not just AA's tied intelligence");
});

test("bestModelPerRoleGlobal (BEST FIT GLOBAL) never cedes a role for portfolio diversity — Astra keeps winning every role it's the real leader for, unlike buildAiTeam's coordinated PROJECT TEAM", () => {
  // Astra is the real capability leader across every technical role here,
  // with Muse Spark a real NEAR-equivalent alternative (within the 8%
  // band) — close enough that buildAiTeam's own portfolio coordination
  // forces Astra to cede a 3rd role to Muse under its 2-role concentration
  // limit (never a decisive-override, since the gap isn't decisive). BEST
  // FIT GLOBAL, with no such coordination, must keep Astra everywhere.
  const aa = [
    { slug: "gpt-6-astra", name: "GPT-6 Astra", intelligenceIndex: 90, codingIndex: 90, mathIndex: null, terminalBenchV2: 0.90 },
    { slug: "muse-spark", name: "Muse Spark", intelligenceIndex: 85, codingIndex: 85, mathIndex: null, terminalBenchV2: 0.85 }
  ];
  const scored = scoreAvailableModels([
    { adapterId: "codex", models: [{ id: "gpt-6-astra" }] },
    { adapterId: "opencode-go", models: [{ id: "muse-spark" }] }
  ], aa);
  const eligibility = { codex: { ok: true }, "opencode-go": { ok: true } };

  const coordinated = buildAiTeam(scored, eligibility);
  const coordinatedByRole = Object.fromEntries(coordinated.map((t) => [t.role, t]));
  assert.ok(Object.values(coordinatedByRole).some((t) => t.primary.adapterId === "opencode-go"), "sanity check: buildAiTeam must actually hand at least one role to Muse under real portfolio concentration");

  const global = bestModelPerRoleGlobal(scored, eligibility);
  const technicalRoles = ["Explorer", "Architect", "Builder", "Debugger (fix)", "Test Runner", "Reviewer"];
  const globalByRole = Object.fromEntries(global.map((t) => [t.role, t]));
  for (const role of technicalRoles) {
    assert.equal(globalByRole[role]?.primary?.adapterId, "codex", `BEST FIT GLOBAL must keep Astra for ${role} — no portfolio coordination applies here`);
    assert.equal(globalByRole[role]?.reason, null, "a clean, uncoordinated global leader needs no diversity/concentration explanation");
  }
});

test("bestEfficientModelPerRoleGlobal (EFFICIENT GLOBAL) also applies no portfolio coordination — same real efficiency winner for every role it clears the capability floor for", () => {
  const aa = [
    { slug: "gpt-6-astra", name: "GPT-6 Astra", intelligenceIndex: 95, codingIndex: 95, mathIndex: null, priceInputPerMTok: 20, outputTokensPerSecond: 50, terminalBenchV2: 0.95 },
    { slug: "gpt-5-6-luna", name: "GPT-5.6 Luna", intelligenceIndex: 90, codingIndex: 90, mathIndex: null, priceInputPerMTok: 2, outputTokensPerSecond: 90, terminalBenchV2: 0.90 }
  ];
  const scored = scoreAvailableModels([
    { adapterId: "codex", models: [{ id: "gpt-6-astra" }] },
    { adapterId: "opencode-go", models: [{ id: "gpt-5-6-luna" }] }
  ], aa);
  const eligibility = { codex: { ok: true }, "opencode-go": { ok: true } };
  const registry = createCapabilityRegistry();

  const global = bestEfficientModelPerRoleGlobal(scored, eligibility, registry);
  const technicalRoles = ["Explorer", "Architect", "Builder", "Debugger (fix)", "Test Runner", "Reviewer"];
  const globalByRole = Object.fromEntries(global.map((t) => [t.role, t]));
  // Luna clears the real 80% capability floor against Astra and is
  // meaningfully cheaper/faster — the real efficient winner for every
  // role, with no per-role variation forced by portfolio concentration.
  for (const role of technicalRoles) {
    assert.equal(globalByRole[role]?.primary?.adapterId, "opencode-go", `EFFICIENT GLOBAL must keep the real cheaper/faster winner for ${role} in every role, uncoordinated`);
  }
});

// decisionEvidence: the single, real receipt behind each team entry that
// /models --evidence will render (see buildDecisionEvidence's own doc) —
// never recalculated by the UI, only labeled/attached here where the real
// decision already happened.

test("buildAiTeam and buildEfficientTeam attach the same real coverage/confidence contract to decisionEvidence", () => {
  const aa = [
    { slug: "leader-model", name: "Leader", intelligenceIndex: 90, codingIndex: null, mathIndex: null, priceInputPerMTok: 20 },
    { slug: "middle-model", name: "Middle", intelligenceIndex: 87, codingIndex: null, mathIndex: null, priceInputPerMTok: 5 }
  ];
  const scored = scoreAvailableModels([
    { adapterId: "claude", models: [{ id: "leader-model" }] },
    { adapterId: "codex", models: [{ id: "middle-model" }] }
  ], aa);
  const eligibility = { claude: { ok: true }, codex: { ok: true } };
  const quality = buildAiTeam(scored, eligibility).find((t) => t.role === "Explorer");
  const efficient = buildEfficientTeam(scored, eligibility).find((t) => t.role === "Explorer");
  assert.ok(quality.decisionEvidence, "QUALITY entries must carry decisionEvidence");
  assert.ok(efficient.decisionEvidence, "EFFICIENT entries must carry decisionEvidence");
  // Same coverage contract shape: real benchmark identities have/active
  // per required capability, never a made-up field name for one team and
  // not the other.
  assert.deepEqual(Object.keys(quality.decisionEvidence.coverage), Object.keys(efficient.decisionEvidence.coverage));
  for (const capability of Object.keys(quality.decisionEvidence.coverage)) {
    assert.deepEqual(Object.keys(quality.decisionEvidence.coverage[capability]), ["have", "active", "comparable"]);
  }
  // QUALITY never carries EFFICIENT-only concepts.
  assert.equal(quality.decisionEvidence.retention, null);
  assert.equal(quality.decisionEvidence.requiredFloor, null);
  assert.equal(quality.decisionEvidence.riskLevel, null);
});

test("decisionEvidence's receipt corresponds exactly to the selected candidate — coverage/confidence describe the CHOSEN model, not the raw leader", () => {
  const aa = [
    // Leader has thin real reasoning coverage (only intelligenceIndex —
    // no gpqa/hle) but wins on the raw composite; middle has broader real
    // benchmark coverage and clears the floor comfortably.
    { slug: "leader-model", name: "Leader", intelligenceIndex: 90, codingIndex: null, mathIndex: null, priceInputPerMTok: 20 },
    { slug: "middle-model", name: "Middle", intelligenceIndex: 85, codingIndex: null, mathIndex: null, priceInputPerMTok: 5, gpqa: 0.8, hle: 0.7 }
  ];
  const scored = scoreAvailableModels([
    { adapterId: "claude", models: [{ id: "leader-model" }] },
    { adapterId: "codex", models: [{ id: "middle-model" }] }
  ], aa);
  const eligibility = { claude: { ok: true }, codex: { ok: true } };
  const efficient = buildEfficientTeam(scored, eligibility).find((t) => t.role === "Explorer");
  // Whichever model was actually chosen, its own real benchmark count is
  // what coverage.reasoning.have reports — never the leader's.
  const chosenHasGpqaHle = efficient.primary.adapterId === "codex";
  assert.equal(efficient.decisionEvidence.coverage.reasoning.have, chosenHasGpqaHle ? 2 : 0);
});

test("decisionEvidence's decisionType distinguishes leader, pareto, provisional-fallback, and tiebreak with different real values", () => {
  // leader: a lone adequate real candidate.
  const soleAa = [{ slug: "solo-model", name: "Solo", intelligenceIndex: 90, codingIndex: null, mathIndex: null }];
  const soleScored = scoreAvailableModels([{ adapterId: "claude", models: [{ id: "solo-model" }] }], soleAa);
  const soleTeam = buildEfficientTeam(soleScored, { claude: { ok: true } }).find((t) => t.role === "Explorer");
  assert.equal(soleTeam.decisionEvidence.decisionType, "fallback");

  // pareto: a genuine 3-way real balance point (see the balance-point
  // tests above) — reused fixture shape.
  const paretoAa = [
    { slug: "leader-model", name: "Leader", intelligenceIndex: 90, codingIndex: null, mathIndex: null, priceInputPerMTok: 20 },
    { slug: "middle-model", name: "Middle", intelligenceIndex: 88, codingIndex: null, mathIndex: null, priceInputPerMTok: 5 },
    { slug: "cheapest-model", name: "Cheapest", intelligenceIndex: 73, codingIndex: null, mathIndex: null, priceInputPerMTok: 1 }
  ];
  const paretoScored = scoreAvailableModels([
    { adapterId: "claude", models: [{ id: "leader-model" }] },
    { adapterId: "codex", models: [{ id: "middle-model" }] },
    { adapterId: "opencode-go", models: [{ id: "cheapest-model" }] }
  ], paretoAa);
  const paretoTeam = buildEfficientTeam(paretoScored, { claude: { ok: true }, codex: { ok: true }, "opencode-go": { ok: true } }).find((t) => t.role === "Explorer");
  assert.equal(paretoTeam.decisionEvidence.decisionType, "pareto");
  assert.ok(paretoTeam.decisionEvidence.savings, "a real pareto decision must carry real savings evidence");

  // tiebreak: exactly two real candidates (no real 'middle' to find).
  const tieAa = [
    { slug: "leader-model", name: "Leader", intelligenceIndex: 90, codingIndex: null, mathIndex: null, priceInputPerMTok: 20 },
    { slug: "cheap-model", name: "Cheap", intelligenceIndex: 88, codingIndex: null, mathIndex: null, priceInputPerMTok: 2 }
  ];
  const tieScored = scoreAvailableModels([
    { adapterId: "claude", models: [{ id: "leader-model" }] },
    { adapterId: "codex", models: [{ id: "cheap-model" }] }
  ], tieAa);
  const tieTeam = buildEfficientTeam(tieScored, { claude: { ok: true }, codex: { ok: true } }).find((t) => t.role === "Explorer");
  assert.equal(tieTeam.decisionEvidence.decisionType, "tiebreak");
});

test("decisionEvidence never fabricates NaN/Infinity or an invented savings figure when a required metric is missing", () => {
  const aa = [
    { slug: "leader-model", name: "Leader", intelligenceIndex: 90, codingIndex: null, mathIndex: null },
    { slug: "cheap-model", name: "Cheap", intelligenceIndex: 88, codingIndex: null, mathIndex: null }
  ];
  const scored = scoreAvailableModels([
    { adapterId: "claude", models: [{ id: "leader-model" }] },
    { adapterId: "codex", models: [{ id: "cheap-model" }] }
  ], aa);
  const efficient = buildEfficientTeam(scored, { claude: { ok: true }, codex: { ok: true } }).find((t) => t.role === "Explorer");
  const evidence = efficient.decisionEvidence;
  const json = JSON.stringify(evidence);
  assert.doesNotMatch(json, /NaN|null,"to":null|Infinity/);
  if (evidence.retention != null) assert.ok(Number.isFinite(evidence.retention));
  // Neither model reports any real price/cost/duration/throughput —
  // savings must stay honestly null, never an invented figure.
  assert.equal(evidence.savings, null);
});

// S5 R1: independence is a hard gate, not a portfolio preference.
test("Reviewer blocks visibly when no independent provider is eligible", () => {
  const models = scoreAvailableModels([
    { adapterId: "claude", models: [{ id: "claude-model" }] },
    { adapterId: "codex", models: [{ id: "codex-model" }] }
  ], [
    { slug: "claude-model", name: "Claude", intelligenceIndex: 90, codingIndex: 90, terminalBenchV2: 0.90 },
    { slug: "codex-model", name: "Codex", intelligenceIndex: 89, codingIndex: 89, terminalBenchV2: 0.89 }
  ]);
  const roles = { Builder: { required: ["coding"], optional: [] }, Reviewer: { required: ["coding"], optional: [] } };
  for (const build of [
    (models, eligibility) => buildAiTeam(models, eligibility, null, roles),
    (models, eligibility) => buildEfficientTeam(models, eligibility, null, { roleCapabilities: roles })
  ]) {
    const blocked = build(models, { claude: { ok: true }, codex: { ok: false } }).find(row => row.role === "Reviewer");
    assert.equal(blocked.primary, null);
    assert.equal(blocked.fallback, null);
    assert.equal(blocked.selection.reasonKind, "reviewer_independence");
    assert.match(blocked.reason, /Reviewer needs a different provider than the Builder/);
    const available = build(models, { claude: { ok: true }, codex: { ok: true } });
    assert.notEqual(available.find(row => row.role === "Reviewer").primary.adapterId,
      available.find(row => row.role === "Builder").primary.adapterId);
  }
});

test("global comparative Reviewer preserves uncoordinated global Reviewer fallback", () => {
  const scored = scoreAvailableModels([
    { adapterId: "claude", models: [{ id: "claude-model" }] },
    { adapterId: "codex", models: [{ id: "codex-model" }] }
  ], [
    { slug: "claude-model", name: "Claude", intelligenceIndex: 90, codingIndex: 90, terminalBenchV2: 0.90 },
    { slug: "codex-model", name: "Codex", intelligenceIndex: 89, codingIndex: 89, terminalBenchV2: 0.89 }
  ]);
  const roles = { Builder: { required: ["coding"], optional: [] }, Reviewer: { required: ["coding"], optional: [] } };
  const reviewer = bestEfficientModelPerRoleGlobal(scored, { claude: { ok: true }, codex: { ok: true } }, null, { roleCapabilities: roles }).find(row => row.role === "Reviewer");
  assert.ok(reviewer.fallback, "Global comparative Reviewer must retain independent vendor fallback; it has no Builder binding");
  assert.notEqual(reviewer.primary.adapterId, reviewer.fallback.adapterId);
});

// U5b: isolate each role so portfolio concentration cannot decide the tie.
function quotaPriceTeam(role, { providerCapacity = null, secondScore = 89, registry = null } = {}) {
  const scored = scoreAvailableModels([
    { adapterId: "claude", models: [{ id: "cheap-model" }] },
    { adapterId: "codex", models: [{ id: "headroom-model" }] }
  ], [
    { slug: "cheap-model", name: "Cheap Model", intelligenceIndex: 90, priceInputPerMTok: 1 },
    { slug: "headroom-model", name: "Headroom Model", intelligenceIndex: secondScore, priceInputPerMTok: 10 }
  ]);
  return buildEfficientTeam(scored, { claude: { ok: true }, codex: { ok: true } }, registry, {
    providerCapacity, roleCapabilities: { [role]: { required: ["reasoning"], optional: [] } }
  })[0];
}

const quotaBeforePriceCapacity = {
  claude: { adapterId: "claude", quotaRemainingPercent: 5 },
  codex: { adapterId: "codex", quotaRemainingPercent: 95 }
};

for (const role of ["Builder", "Explorer"]) {
  test(`${role} uses live quota before cheaper price for near-equivalent candidates`, () => {
    for (const secondScore of [89, 90]) {
      const entry = quotaPriceTeam(role, { providerCapacity: quotaBeforePriceCapacity, secondScore });
      assert.equal(entry.primary.adapterId, "codex");
      assert.match(entry.reason, /Quota reserve/);
      assert.equal(entry.decisionEvidence.decisionType, "efficient");
      assert.equal(entry.decisionEvidence.savings, null);
    }
  });
}

test("S23 reserve also protects a custom Planner role", () => {
  assert.equal(quotaPriceTeam("Planner", { providerCapacity: quotaBeforePriceCapacity }).primary.adapterId, "codex");
});

test("Builder and Explorer keep price ordering with wholly unknown quota, but known quota beats unknown", () => {
  for (const role of ["Builder", "Explorer"]) {
    for (const providerCapacity of [null, {}, { codex: quotaBeforePriceCapacity.codex }]) {
      assert.equal(quotaPriceTeam(role, { providerCapacity }).primary.adapterId, providerCapacity?.codex ? "codex" : "claude");
    }
  }
});

test("S23 reserve moves outside the near-equivalence band but above the absolute floor", () => {
  for (const role of ["Builder", "Explorer"]) {
    const withoutQuota = quotaPriceTeam(role, { secondScore: 80 });
    const withQuota = quotaPriceTeam(role, { secondScore: 80, providerCapacity: quotaBeforePriceCapacity });
    assert.equal(withoutQuota.primary.adapterId, "claude");
    assert.equal(withQuota.primary.adapterId, "codex");
  }
});

test("S23 reserve protects headroom before observed cost and public price", () => {
  const registry = createCapabilityRegistry();
  for (const [adapter, model, value] of [["claude", "cheap-model", 0.01], ["codex", "headroom-model", 0.4]]) {
    const id = registry.registerIdentity(adapter, model);
    registry.addEvidence(id, { metric: "kairo.cost", value, source: "kairo-telemetry", verified: true });
  }
  for (const role of ["Builder", "Explorer"]) {
    assert.equal(quotaPriceTeam(role, { registry, providerCapacity: quotaBeforePriceCapacity }).primary.adapterId, "codex");
  }
});

for (const metric of ["terminalBenchV4", "terminalBenchV2"]) {
  test(`${metric}: AA evidence survives scoring, ingestion and both team builders without a missing-terminal penalty`, () => {
    const catalogs = [{ adapterId: "claude", models: [{ id: "claude-opus-5-5" }, { id: "claude-sonnet-5-5" }] }];
    const aa = catalogs[0].models.map(({ id }, index) => ({
      slug: id, name: id, sciCode: 0.8 - index * 0.1, [metric]: 0.60 - index * 0.01
    }));
    const rows = scoreAvailableModels(catalogs, aa);
    assert.equal(rows[0][metric], 0.60);
    const registry = createCapabilityRegistry();
    ingestArtificialAnalysisEvidence(registry, catalogs, aa);
    const id = registry.registerIdentity("claude", "claude-opus-5-5");
    assert.equal(registry.getEvidence(id, metric)[0]?.value, 0.60);
    assert.equal(registry.getEvidence(id, metric)[0]?.scale, "unit");
    assert.ok(annotateWithRegistryEvidence(rows, registry)[0].corroboration.some(entry => entry.metric === metric));
    const eligibility = { claude: { ok: true } };
    for (const role of ["Builder", "Test Runner", "Debugger (fix)"]) {
      const capabilities = { [role]: { required: ["coding", "terminalExecution"] } };
      for (const team of [
        buildAiTeam(rows, eligibility, null, capabilities),
        buildEfficientTeam(rows, eligibility, null, { roleCapabilities: capabilities })
      ]) {
        assert.equal(team[0].primary.modelId, "claude-opus-5-5");
        assert.deepEqual(team[0].decisionEvidence.coverage.terminalExecution, { have: 1, active: 1, comparable: true });
        assert.deepEqual(team[0].decisionEvidence.coverage.coding, { have: 1, active: 2, comparable: true });
        assert.equal(team[0].decisionEvidence.isProvisional, false);
        assert.doesNotMatch(team[0].reason ?? "", /Missing terminalExecution|penalty/);
      }
    }
  });
}

test("S21 scored models retain documented task cost, variant and stored agentic index", () => {
  const scored = scoreAvailableModels([{ adapterId: "codex", models: [{ id: "fixture-model" }] }],
    [{ slug: "fixture-model", intelligenceIndex: 50, costPerTask: .5, costPerTaskVariant: "fixture-model-medium", agenticIndex: 42 }]);
  assert.equal(scored[0].costPerTask, .5);
  assert.equal(scored[0].costPerTaskVariant, "fixture-model-medium");
  assert.equal(scored[0].agenticIndex, 42);
});

test("S21 global efficient guide explains task cost instead of conflicting token price", () => {
  const models = [
    { adapterId: "codex", modelId: "fixture-a", intelligenceIndex: 60, priceInputPerMTok: 1, priceOutputPerMTok: 1, costPerTask: 10, costPerTaskVariant: "fixture-a-high" },
    { adapterId: "claude", modelId: "fixture-b", intelligenceIndex: 60, priceInputPerMTok: 10, priceOutputPerMTok: 10, costPerTask: .1, costPerTaskVariant: "fixture-b-medium" }
  ];
  const team = bestEfficientModelPerRoleGlobal(models, { codex: { ok: true }, claude: { ok: true } }, null,
    { roleCapabilities: { Explorer: { required: ["reasoning"] } } });
  assert.equal(team[0].primary.modelId, "fixture-b");
  assert.match(team[0].reason, /AA task-equivalent cost/);
  assert.equal(team[0].primary.costPerTaskVariant, "fixture-b-medium");
});

// Live-shaped normalized AA rows, 2026-10-16; missing signals remain missing.
function c13LivePool({ floorMiss = false } = {}) {
  const aa = [
    { slug: "claude-opus-5-5", intelligenceIndex: 57.6, hle: .614, sciCode: .669, terminalBenchV4: .596, lcr: .847, priceInputPerMTok: 4, priceOutputPerMTok: 20 },
    { slug: "claude-sonnet-5-5", intelligenceIndex: 56, hle: .55, sciCode: .61, terminalBenchV4: .636, priceInputPerMTok: 2, priceOutputPerMTok: 10, costPerTask: .48 },
    { slug: "claude-4-5-haiku", intelligenceIndex: 15.4, gpqa: .646, hle: .042, mmluPro: .80, liveCodeBench: .511, ifBench: .42, terminalBenchHard: .273, tau2: .325, priceInputPerMTok: 1, priceOutputPerMTok: 5 },
    { slug: "gpt-6-astra", intelligenceIndex: 52.7, codingIndex: 76.9, gpqa: .961, hle: .547, sciCode: .565, terminalBenchV2: .884, terminalBenchV4: .591, priceInputPerMTok: 10, priceOutputPerMTok: 50 },
    { slug: "gpt-5.6-terra", intelligenceIndex: 42.1, codingIndex: 76.7, gpqa: .925, hle: .429, sciCode: .55, ifBench: .712, terminalBenchHard: .576, terminalBenchV2: .880, tau2: .863, priceInputPerMTok: 2, priceOutputPerMTok: 12 },
    { slug: "gpt-6.1-sol", intelligenceIndex: 51.8, hle: .529, sciCode: .542, priceInputPerMTok: 2, priceOutputPerMTok: 10, costPerTask: .39 }
  ].map(row => {
    // Floor-miss snapshot retains coding and terminal values, but lacks the
    // legacy v2 and instruction-following signals. Missing is not zero.
    const snapshot = { codingIndex: null, mathIndex: null, name: row.slug, ...row };
    if (floorMiss) {
      delete snapshot.terminalBenchV2; delete snapshot.ifBench;
      // Sparse project additions no longer impose penalties. Keep this
      // floor-miss fixture below .55 on its base capabilities instead.
      for (const key of ["sciCode", "terminalBenchV4"]) if (snapshot[key] != null) snapshot[key] *= .75;
    }
    return snapshot;
  });
  const catalogs = [
    { adapterId: "claude", models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5"].map(id => ({ id })) },
    { adapterId: "codex", models: ["gpt-6-astra", "gpt-5.6-terra", "gpt-6.1-sol"].map(id => ({ id })) }
  ];
  const registry = createCapabilityRegistry();
  ingestArtificialAnalysisEvidence(registry, catalogs, aa);
  return { models: annotateWithRegistryEvidence(scoreAvailableModels(catalogs, aa), registry), registry };
}

const c13Capacity = (claude = 80) => ({
  claude: { quotaRemainingPercent: claude }, codex: { quotaRemainingPercent: 80 }
});

test("S25 live Claude-only demanding roles keep strong provisional models over weak broad evidence", () => {
  const { models, registry } = c13LivePool();
  for (const build of [buildAiTeam, buildEfficientTeam]) {
    const options = { providerCapacity: c13Capacity(), teamProviders: ["claude"] };
    const team = build === buildAiTeam
      ? build(models, { claude: { ok: true }, codex: { ok: false } }, registry, undefined, options)
      : build(models, { claude: { ok: true }, codex: { ok: false } }, registry, options);
    for (const role of ["Architect", "Debugger (fix)"]) {
      const entry = team.find(entry => entry.role === role);
      assert.ok(entry.primary, `${role} must be assigned`);
      assert.notEqual(entry.primary.modelId, "claude-haiku-4-5", `${role}: ${entry.reason}`);
    }
    assert.equal(team.find(entry => entry.role === "Reviewer").primary, null);
  }
});

for (const scenario of ["Codex-only", "Claude-10-percent"]) {
  test(`S26 live ${scenario} Builder avoids Astra when cheaper Terra qualifies`, () => {
    const { models, registry } = c13LivePool();
    const eligibility = { codex: { ok: true }, claude: { ok: scenario !== "Codex-only" } };
    const options = { providerCapacity: c13Capacity(scenario === "Codex-only" ? 80 : 10),
      teamProviders: scenario === "Codex-only" ? ["codex"] : ["claude", "codex"],
      roleCapabilities: { Builder: { required: ["coding"], optional: [] } } };
    for (const build of [buildAiTeam, buildEfficientTeam]) {
      const team = build === buildAiTeam ? build(models, eligibility, registry, options.roleCapabilities, options) : build(models, eligibility, registry, options);
      const builder = team.find(entry => entry.role === "Builder");
      assert.ok(builder.primary);
      assert.notEqual(builder.primary.modelId, "gpt-6-astra", builder.reason);
      assert.doesNotMatch(builder.reason, /No candidate meets the Builder absolute demand floor/);
    }
  });
}

for (const scenario of ["Codex-only", "Claude-10-percent"]) {
  for (const build of [buildAiTeam, buildEfficientTeam]) {
    test(`S26 ${build.name} ${scenario} multi-capability Builder trades cost after missing floor`, () => {
      const { models, registry } = c13LivePool({ floorMiss: true });
      const eligibility = { codex: { ok: true }, claude: { ok: scenario !== "Codex-only" } };
      const roles = { Builder: { required: ["coding", "terminalExecution", "softwareExecution", "instructionFollowing"] } };
      const options = { providerCapacity: c13Capacity(scenario === "Codex-only" ? 80 : 10),
        teamProviders: scenario === "Codex-only" ? ["codex"] : ["claude", "codex"], roleCapabilities: roles };
      const team = build === buildAiTeam ? build(models, eligibility, registry, roles, options)
        : build(models, eligibility, registry, options);
      const builder = team.find(entry => entry.role === "Builder");
      assert.ok(builder.primary);
      assert.ok(builder.selection.evaluated.every(entry => entry.gapValue < .55), "fixture must miss the S34 Builder floor");
      assert.notEqual(builder.primary.modelId, "gpt-6-astra", builder.reason);
      assert.match(builder.reason, /No candidate meets the Builder absolute demand floor \(0\.55\)/);
      assert.match(builder.reason, /capability\/cost trade-off.*capability weight.*cost weight.*near-equivalence band/i);
      assert.doesNotMatch(builder.reason, /among models meeting this role's quality floor/);
    });
  }
}

test("C13 healthy two-provider pool preserves its current Architect pick", () => {
  const { models, registry } = c13LivePool();
  const eligibility = { claude: { ok: true }, codex: { ok: true } };
  for (const build of [buildAiTeam, buildEfficientTeam]) {
    const options = { providerCapacity: c13Capacity() };
    const team = build === buildAiTeam ? build(models, eligibility, registry, undefined, options) : build(models, eligibility, registry, options);
    assert.equal(team.find(entry => entry.role === "Architect").primary.modelId, "gpt-6-astra");
  }
});

test("S25 comparable evidence of similar strength still beats a higher provisional score", () => {
  const rows = [
    { adapterId: "claude", modelId: "thin", hle: .95, priceInputPerMTok: 1, priceOutputPerMTok: 1 },
    { adapterId: "codex", modelId: "broad", gpqa: .93, hle: .92, priceInputPerMTok: 2, priceOutputPerMTok: 2 }
  ];
  const capabilities = { Architect: { required: ["reasoning"], optional: [] } };
  for (const build of [buildAiTeam, buildEfficientTeam]) {
    const eligibility = { claude: { ok: true }, codex: { ok: true } };
    const team = build === buildAiTeam ? build(rows, eligibility, null, capabilities)
      : build(rows, eligibility, null, { roleCapabilities: capabilities });
    assert.equal(team[0].primary.modelId, "broad");
  }
});

test("S26 Builder cannot trade higher volume for the same provider's most expensive qualified model", () => {
  const rows = [
    { adapterId: "codex", modelId: "strong-expensive", intelligenceIndex: 95, codingIndex: 95, priceInputPerMTok: 3, priceOutputPerMTok: 3 },
    { adapterId: "codex", modelId: "qualified-cheaper", intelligenceIndex: 65, codingIndex: 65, priceInputPerMTok: 2.9, priceOutputPerMTok: 2.9 }
  ];
  const capabilities = { Builder: { required: ["reasoning", "coding"], optional: [] } };
  for (const build of [buildAiTeam, buildEfficientTeam]) {
    const team = build === buildAiTeam ? build(rows, { codex: { ok: true } }, null, capabilities)
      : build(rows, { codex: { ok: true } }, null, { roleCapabilities: capabilities });
    assert.equal(team[0].primary.modelId, "qualified-cheaper");
  }
});


for (const mode of ["quality", "efficient"]) test(`S40 ${mode} reviewers are independent from every Builder or visibly blocked`, () => {
  const capabilities = Object.fromEntries(["Reviewer", "Security Reviewer", "Frontend Builder", "Backend Builder"].map(role => [role, { required: ["reasoning"] }]));
  const rows = ["codex", "claude", "cursor"].map((adapterId, i) => ({ adapterId, modelId: `model-${i}`, intelligenceIndex: 80 }));
  const build = (models, caps = capabilities) => mode === "quality"
    ? buildAiTeam(models, Object.fromEntries(models.map(m => [m.adapterId, { ok: true }])), null, caps)
    : buildEfficientTeam(models, Object.fromEntries(models.map(m => [m.adapterId, { ok: true }])), null, { roleCapabilities: caps });
  for (const models of [rows, rows.slice(0, 2), rows.slice(0, 1)]) {
    const team = build(models);
    const builders = team.filter(r => r.role.endsWith("Builder")).map(r => r.primary?.adapterId).filter(Boolean);
    assert.equal(new Set(builders).size, models.length >= 3 ? 2 : 1);
    for (const role of ["Reviewer", "Security Reviewer"]) {
      const review = team.find(r => r.role === role);
      assert.ok(review, role);
      if (review.primary) assert.ok(!builders.includes(review.primary.adapterId));
      else assert.match(review.reason, /different provider/);
      if (models.length === 1) assert.equal(review.primary, null);
      else assert.ok(review.primary, "multiple providers preserve independent review");
    }
  }
  // No Builder: no fabricated independence constraint.
  assert.ok(build(rows, { "Security Reviewer": { required: ["reasoning"] } })[0].primary);
});
test("S40 new roles contribute to provider cap evidence", () => {
  const caps = Object.fromEntries(["Planner", "DevOps", "Verifier", "Refactorer", "Documenter"].map(role => [role, { required: ["reasoning"] }]));
  const team = buildAiTeam(Array.from({ length: 5 }, (_, i) => ({ adapterId: "codex", modelId: `family-${i}`, intelligenceIndex: 80 })), { codex: { ok: true } }, null, caps);
  assert.equal(team.length, 5);
  assert.ok(team.slice(3).some(row => row.selection?.evaluated.some(c => c.blockedBy === "provider_cap")));
});

for (const build of [buildAiTeam, buildEfficientTeam]) {
  for (const floorMiss of [false, true]) {
    test(`split Builders ${build.name}: S26 survives catalog concentration${floorMiss ? ' and floor miss' : ''}`, () => {
      const { models, registry } = c13LivePool({ floorMiss });
      const required = floorMiss ? ["coding", "terminalExecution", "softwareExecution", "instructionFollowing"] : ["coding"];
      const roles = Object.fromEntries(["Planner", "Refactorer", "Frontend Builder", "Backend Builder"]
        .map(role => [role, { required }]));
      const options = { roleCapabilities: roles, teamProviders: ["codex"], providerCapacity: c13Capacity() };
      const team = build === buildAiTeam
        ? build(models, { codex: { ok: true } }, registry, roles, options)
        : build(models, { codex: { ok: true } }, registry, options);
      for (const role of ["Frontend Builder", "Backend Builder"]) {
        const entry = team.find(row => row.role === role);
        assert.ok(entry.primary, `${role} must be assigned`);
        assert.notEqual(entry.primary.modelId, "gpt-6-astra", `${role}: ${entry.reason}`);
        if (floorMiss) assert.match(entry.reason, /No candidate meets/);
      }
    });
  }
}

// S23 live 2026-10-16: Codex 5h 8% (reset in 3.3h) sits below the 10% reserve while Claude is
// paced into reserve but still above it. The comparable-evidence preference dropped thin-evidence
// Claude models before the reserve step, so demanding roles never left Codex.
const liveReserveCapacity = (codex5h = 8) => ({
  codex: { adapterId: "codex", quotaRemainingPercent: codex5h, quotaPaceFactor: codex5h / 66, quotaWindows: [
    { kind: "5h", remainingPercent: codex5h, resetsInMs: 11863322, timeLeftFraction: .659, paceFactor: codex5h / 66 },
    { kind: "weekly", remainingPercent: 51, resetsInMs: 493145322, timeLeftFraction: .815, paceFactor: .625 }] },
  claude: { adapterId: "claude", quotaRemainingPercent: 19, quotaPaceFactor: .575, quotaWindows: [
    { kind: "Current session", remainingPercent: 31, resetsInMs: 9706322, timeLeftFraction: .539, paceFactor: .575 },
    { kind: "Current week (all models)", remainingPercent: 19, resetsInMs: 142906322, timeLeftFraction: .236, paceFactor: .804 }] }
});
const liveReserveTeam = (build, providerCapacity) => {
  const { models, registry } = c13LivePool();
  const eligibility = { claude: { ok: true }, codex: { ok: true } };
  return build === buildAiTeam ? build(models, eligibility, registry, undefined, { providerCapacity })
    : build(models, eligibility, registry, { providerCapacity });
};
for (const build of [buildAiTeam, buildEfficientTeam]) {
  test(`S23 live ${build.name}: demanding roles leave a provider below the reserve for thin-evidence peers above it`, () => {
    const team = liveReserveTeam(build, liveReserveCapacity());
    for (const role of ["Architect", "Debugger (fix)"]) {
      const entry = team.find(entry => entry.role === role);
      assert.equal(entry.primary?.adapterId, "claude", `${role} stayed on ${entry.primary?.modelId}: ${entry.reason}`);
      assert.notEqual(entry.primary.modelId, "claude-haiku-4-5", `${role}: ${entry.reason}`);
    }
  });
  test(`S23 live ${build.name}: Codex above the reserve keeps the comparable-evidence preference`, () => {
    const team = liveReserveTeam(build, liveReserveCapacity(50));
    const baseline = liveReserveTeam(build, null);
    for (const role of ["Architect", "Debugger (fix)"]) {
      const comparable = entry => entry.selection?.evaluated?.map(candidate => candidate.candidateKey).sort();
      assert.deepEqual(comparable(team.find(entry => entry.role === role)), comparable(baseline.find(entry => entry.role === role)), role);
    }
  });
}
