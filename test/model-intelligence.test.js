import test from "node:test";
import assert from "node:assert/strict";
import { annotateWithRegistryEvidence, bestModelPerRole, buildAiTeam, matchArtificialAnalysisScore, scoreAvailableModels, summarizeCatalogCoverage } from "../src/global/intelligence/model-intelligence.js";
import { createCapabilityRegistry } from "../src/global/intelligence/model-capability-registry.js";

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

test("buildAiTeam names a real primary and eligible fallback for each of the seven team roles", () => {
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
  const economy = team.find((t) => t.role === "Economy");
  assert.equal(economy.primary.adapterId, "codex"); // cheapest priceInputPerMTok
  assert.equal(economy.fallback.adapterId, "claude");
  assert.ok(!team.some((t) => t.role === "Orchestrator"));
});

test("buildAiTeam keeps a preferred-but-ineligible primary visible instead of dropping it, and picks an eligible fallback", () => {
  const aa = [
    { slug: "go-model", name: "Go Model", intelligenceIndex: 40, codingIndex: 99, mathIndex: null },
    { slug: "claude-model", name: "Claude Model", intelligenceIndex: 40, codingIndex: 70, mathIndex: null }
  ];
  const scored = scoreAvailableModels(
    [{ adapterId: "opencode-go", models: [{ id: "go-model" }] }, { adapterId: "claude", models: [{ id: "claude-model" }] }], aa
  );
  // OpenCode Go is rate-limited right now — it stays the real capability
  // winner for Tester (best codingIndex), but should be flagged unavailable
  // with Claude surfaced as the real, eligible fallback.
  const eligibility = { "opencode-go": { ok: false, reason: "rate limited" }, claude: { ok: true } };
  const team = buildAiTeam(scored, eligibility);
  const tester = team.find((t) => t.role === "Tester");
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

test("buildAiTeam never lets one model win every role: a real decisive gap locks in its winner, but near-equivalent roles spread to the less-used provider", () => {
  // Claude has a real, meaningful coding edge (~26%, decisive even under
  // the wider 8% band) but only a razor-thin intelligence edge (~1.1%,
  // a real tie) over Codex.
  const aa = [
    { slug: "claude-model", name: "Claude Model", intelligenceIndex: 53.4, codingIndex: 81.6, mathIndex: null },
    { slug: "codex-model", name: "Codex Model", intelligenceIndex: 52.8, codingIndex: 60.0, mathIndex: null }
  ];
  const scored = scoreAvailableModels(
    [{ adapterId: "claude", models: [{ id: "claude-model" }] }, { adapterId: "codex", models: [{ id: "codex-model" }] }], aa
  );
  const team = buildAiTeam(scored, { claude: { ok: true }, codex: { ok: true } });
  const byRole = Object.fromEntries(team.map((t) => [t.role, t]));

  // Builder/Tester: the real ~5.2% coding gap is decisive — never sacrificed for diversity.
  assert.equal(byRole.Builder.primary.adapterId, "claude");
  assert.equal(byRole.Tester.primary.adapterId, "claude");
  assert.equal(byRole.Builder.reason, null); // an unremarkable, clear real win needs no explanation

  // Explorer/Architect: the ~1.1% intelligence gap is a real tie. Once
  // Claude already carries Builder+Tester, these spread to Codex instead
  // of piling every role onto the same subscription.
  assert.equal(byRole.Explorer.primary.adapterId, "codex");
  assert.equal(byRole.Architect.primary.adapterId, "codex");
  // Regression: the reason text must report the real leader-vs-rival gap
  // (~1.1%) even when the pick diverged from the raw leader — computing
  // the rival relative to `chosen` instead of the raw leader previously
  // collapsed this to a bogus "~0.0%".
  assert.match(byRole.Explorer.reason, /Near-equivalent alternatives \(~1\.1%\)/);

  // Reviewer must never default to reviewing Builder's own provider's work
  // when a real independent alternative exists — even though the raw
  // tie-break (usage counts alone) would land it back on Claude here, the
  // independence rule catches that and reassigns it to Codex.
  assert.notEqual(byRole.Reviewer.primary.adapterId, byRole.Builder.primary.adapterId);
});

test("buildAiTeam keeps Reviewer on Builder's own provider when no independent real alternative exists, rather than forcing an incapable model", () => {
  const aa = [{ slug: "only-model", name: "Only Model", intelligenceIndex: 80, codingIndex: 80, mathIndex: null }];
  const scored = scoreAvailableModels([{ adapterId: "claude", models: [{ id: "only-model" }] }], aa);
  const team = buildAiTeam(scored, { claude: { ok: true } });
  const byRole = Object.fromEntries(team.map((t) => [t.role, t]));
  assert.equal(byRole.Reviewer.primary.adapterId, "claude");
  assert.equal(byRole.Builder.primary.adapterId, "claude");
});

test("buildAiTeam never forces Reviewer onto a decisively worse independent alternative just to satisfy independence — a capability floor gates the swap", () => {
  // codex-model is dramatically weaker on every real metric (not a near
  // tie) — the only "independent" option here fails the same
  // NEAR_EQUIVALENCE_BAND used everywhere else, so Reviewer must stay on
  // Builder's own provider rather than being forced onto a much worse model.
  const aa = [
    { slug: "claude-model", name: "Claude Model", intelligenceIndex: 90, codingIndex: 90, mathIndex: null },
    { slug: "codex-model", name: "Codex Model", intelligenceIndex: 20, codingIndex: 20, mathIndex: null }
  ];
  const scored = scoreAvailableModels(
    [{ adapterId: "claude", models: [{ id: "claude-model" }] }, { adapterId: "codex", models: [{ id: "codex-model" }] }], aa
  );
  const team = buildAiTeam(scored, { claude: { ok: true }, codex: { ok: true } });
  const byRole = Object.fromEntries(team.map((t) => [t.role, t]));
  assert.equal(byRole.Builder.primary.adapterId, "claude");
  assert.equal(byRole.Reviewer.primary.adapterId, "claude", "independence must not override a real capability floor");
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
    { slug: "claude-model", name: "Claude Model", intelligenceIndex: 90, codingIndex: 90, mathIndex: null },
    { slug: "codex-model", name: "Codex Model", intelligenceIndex: 20, codingIndex: 20, mathIndex: null }
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
  assert.equal(builderWithout.primary.corroboration, undefined);
  assert.deepEqual(builderWith.primary.corroboration, [{ metric: "kairo.success", value: 1, source: "kairo-telemetry" }]);
});

test("buildAiTeam prefers a real, meaningfully cheaper near-equivalent over the raw leader — capability being close enough is when cost should decide", () => {
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
  const team = buildAiTeam(scored, { claude: { ok: true }, "opencode-go": { ok: true } });
  const tester = team.find((t) => t.role === "Tester"); // pure codingIndex, no independence rule involved
  assert.equal(tester.primary.adapterId, "opencode-go", "the cheaper, near-equivalent real option should win over the raw leader");
  assert.match(tester.reason, /Near-equivalent/);
});

test("buildAiTeam only prefers cost when a real alternative is actually near-equivalent — a genuinely large real gap still wins on capability, whatever the price", () => {
  const aa = [
    { slug: "strong-model", name: "Strong", intelligenceIndex: 90, codingIndex: 90, mathIndex: null, priceInputPerMTok: 10 },
    { slug: "cheap-weak-model", name: "Cheap Weak", intelligenceIndex: 90, codingIndex: 40, mathIndex: null, priceInputPerMTok: 1 }
  ];
  const scored = scoreAvailableModels(
    [{ adapterId: "claude", models: [{ id: "strong-model" }] }, { adapterId: "opencode-go", models: [{ id: "cheap-weak-model" }] }], aa
  );
  const team = buildAiTeam(scored, { claude: { ok: true }, "opencode-go": { ok: true } });
  const tester = team.find((t) => t.role === "Tester");
  assert.equal(tester.primary.adapterId, "claude", "a real ~56% coding gap must never be sacrificed just because the alternative is cheaper");
});

test("buildAiTeam falls back to usage-based diversity when near-equivalent alternatives have no real price to compare", () => {
  const aa = [
    { slug: "claude-model", name: "Claude Model", intelligenceIndex: 53.4, codingIndex: 81.6, mathIndex: null },
    { slug: "codex-model", name: "Codex Model", intelligenceIndex: 52.8, codingIndex: 78.0, mathIndex: null }
  ];
  const scored = scoreAvailableModels(
    [{ adapterId: "claude", models: [{ id: "claude-model" }] }, { adapterId: "codex", models: [{ id: "codex-model" }] }], aa
  );
  // Neither model reports a real price — must not crash or fabricate a
  // preference; behavior should match the pre-existing usage-based tiebreak.
  const team = buildAiTeam(scored, { claude: { ok: true }, codex: { ok: true } });
  const tester = team.find((t) => t.role === "Tester");
  assert.ok(["claude", "codex"].includes(tester.primary.adapterId));
});

test("Debugger's real optional terminalBenchV2 signal can flip a near-equivalent pick, without requiring every model to report it", () => {
  const aa = [
    // Both models tie exactly on intelligence/coding, so the bottleneck
    // comes down to their real, meaningfully different terminal-bench score.
    { slug: "claude-model", name: "Claude Model", intelligenceIndex: 90, codingIndex: 90, mathIndex: null, terminalBenchV2: 0.60 },
    { slug: "codex-model", name: "Codex Model", intelligenceIndex: 90, codingIndex: 90, mathIndex: null, terminalBenchV2: 0.95 }
  ];
  const scored = scoreAvailableModels(
    [{ adapterId: "claude", models: [{ id: "claude-model" }] }, { adapterId: "codex", models: [{ id: "codex-model" }] }], aa
  );
  const claude = scored.find((m) => m.adapterId === "claude");
  assert.equal(claude.terminalBenchV2, 0.60); // confirms the field actually flows through scoreAvailableModels
  const team = buildAiTeam(scored, { claude: { ok: true }, codex: { ok: true } });
  const debugger_ = team.find((t) => t.role === "Debugger");
  assert.equal(debugger_.primary.adapterId, "codex", "the real terminal-bench gap should be the deciding bottleneck once intelligence/coding are this close");
});

test("a role's optional metric never shrinks its candidate pool for a model AA simply hasn't scored on it yet", () => {
  const aa = [
    // Only one model reports tauBanking (Builder's optional metric) — the
    // other must still qualify for Builder using codingIndex alone.
    { slug: "has-tau", name: "Has Tau", intelligenceIndex: 50, codingIndex: 60, mathIndex: null, tauBanking: 0.9 },
    { slug: "no-tau", name: "No Tau", intelligenceIndex: 50, codingIndex: 95, mathIndex: null }
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
