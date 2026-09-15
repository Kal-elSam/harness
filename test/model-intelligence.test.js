import test from "node:test";
import assert from "node:assert/strict";
import {
  annotateWithRegistryEvidence, bestEfficientModelPerRoleGlobal, bestModelPerRole, bestModelPerRoleGlobal, buildAiTeam,
  buildEfficientTeam, matchArtificialAnalysisScore, scoreAvailableModels, summarizeCatalogCoverage
} from "../src/global/intelligence/model-intelligence.js";
import { createCapabilityRegistry } from "../src/global/intelligence/model-capability-registry.js";
import { ingestHuggingFaceLeaderboardEvidence } from "../src/global/intelligence/model-capability-registry-sources.js";
import { ingestOfficialSnapshotEvidence } from "../src/global/intelligence/official-benchmark-snapshots.js";

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
    { slug: "go-model", name: "Go Model", intelligenceIndex: 40, codingIndex: 99, mathIndex: null, terminalBenchV2: 0.9 },
    { slug: "claude-model", name: "Claude Model", intelligenceIndex: 40, codingIndex: 70, mathIndex: null, terminalBenchV2: 0.8 }
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

test("buildAiTeam coordinates the whole portfolio under per-role near-equivalence bands: a tighter Architect/Reviewer tolerance keeps Claude as sole leader there, while Builder/Debugger/Tester's wider tolerance lets Go compete and take concentration-avoidance roles", () => {
  // Three real providers, verified against the actual required-only
  // gapValue math (never guessed): reasoning (intelligenceIndex fallback)
  // real relative gaps vs Claude — Codex 1.12%, Go 6.37%; coding
  // (codingIndex fallback) — Codex 26.47%, Go 4.41%; terminalExecution
  // (terminalBenchV2) — Codex 41.18%, Go 5.88%.
  //
  // required-only medians (per-role, post required/optional split):
  //   Architect/Reviewer (reasoning+coding):      Go 5.19% behind Claude
  //   Explorer (reasoning only):                  Codex 1.12%, Go 6.37% behind
  //   Builder/Tester (coding+terminalExecution):   Go 5.16% behind Claude
  //   Debugger (reasoning+coding+terminalExecution): Go 4.41% behind Claude
  //
  // Against each role's own ROLE_NEAR_EQUIVALENCE_BAND:
  //   Architect (3%, "muy estricta"): Go's 5.19% is OUTSIDE — Architect's
  //     real pool is Claude ALONE, a decisive single-candidate leader.
  //   Reviewer (5%, "alta"): same 5.19% gap, ALSO outside a 5% band — same
  //     single-candidate pool, even though the underlying capability mix
  //     is identical to Architect's.
  //   Explorer (6%, "media"): Codex's 1.12% is inside, Go's 6.37% is just
  //     outside — pool is Claude+Codex (Go excluded).
  //   Builder/Tester (6%, "media"): Go's 5.16% is inside — pool is
  //     Claude+Go.
  //   Debugger (5%, "alta"): Go's 4.41% is inside a 5% band — pool is
  //     Claude+Go.
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

  // Assignment order (ascending pool size, Reviewer always last among
  // technical roles): Architect(1) → Explorer(2) → Builder(2) → Debugger(2)
  // → Tester(2) → Reviewer(1, forced last regardless of size).

  // Architect: sole real candidate — Claude wins outright, no message.
  assert.equal(byRole.Architect.primary.adapterId, "claude");
  assert.equal(byRole.Architect.reason, null);

  // Explorer: Claude still under its 2-role limit (used once, by
  // Architect) — real value decides cleanly between Claude and Codex,
  // Claude wins again (now at its 2-role limit).
  assert.equal(byRole.Explorer.primary.adapterId, "claude");
  assert.equal(byRole.Explorer.reason, null);

  // Builder: Claude has now hit its 2-role limit (Architect+Explorer) —
  // with real, near-equivalent Go available and not decisive enough to
  // override concentration (5.16% < Builder's own 6% band), Go gets it.
  assert.equal(byRole.Builder.primary.adapterId, "opencode-go");
  assert.match(byRole.Builder.reason, /assigned to a different model\/provider to avoid concentration/);

  // Debugger: same story — Claude still capped, Go (used once so far,
  // real 4.41% gap not decisive against Debugger's 5% band) takes it too.
  assert.equal(byRole.Debugger.primary.adapterId, "opencode-go");
  assert.match(byRole.Debugger.reason, /assigned to a different model\/provider to avoid concentration/);

  // Tester: BOTH Claude and Go have now hit their real 2-role limit
  // (Claude: Architect+Explorer; Go: Builder+Debugger) — no real
  // alternative keeps every limit intact, so the real leader (Claude) is
  // repeated anyway rather than forcing an incapable model in.
  assert.equal(byRole.Tester.primary.adapterId, "claude");
  assert.match(byRole.Tester.reason, /Only adequate option — no real alternative avoids concentration without forcing a repeat\./);

  // Reviewer: its own pool was ALREADY single-candidate (Claude alone,
  // Go's 5.19% real gap falling just outside Reviewer's 5% band) — but by
  // now Claude has been assigned 3 times (Architect+Explorer+Tester,
  // Tester's forced repeat included), so even this lone option fails the
  // 2-role concentration check. It's still assigned — a real single
  // candidate is never withheld — but honestly flagged as forced.
  assert.equal(byRole.Reviewer.primary.adapterId, "claude");
  assert.match(byRole.Reviewer.reason, /Only adequate option — no real alternative avoids concentration without forcing a repeat\./);
});

test("buildAiTeam caps a single provider at 3 of the 6 technical roles when a real alternative provider exists — even across two different real models under it", () => {
  // Two real Claude models plus one real Codex model, all real
  // near-equivalents of each other — real relative gap vs claude-a (90):
  // claude-b 1.11%, codex 3.33%, comfortably inside every applicable
  // per-role band this test exercises (Debugger's 5% is the tightest of
  // them; Explorer/Builder/Tester's 6% is looser still). The 2-role-per-
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

  // Debugger/Tester: Claude has now hit its 3-role provider limit — Codex,
  // a real near-equivalent alternative, covers these instead of a 4th
  // Claude role.
  assert.equal(byRole.Debugger.primary.adapterId, "codex");
  assert.equal(byRole.Tester.primary.adapterId, "codex");
  assert.match(byRole.Debugger.reason, /assigned to a different model\/provider to avoid concentration/);
});

test("REGRESSION: the same real model family under Claude, Cursor, and several Cursor reasoning-tier variants still respects the real 2-role concentration limit as ONE model, not four independent ones", () => {
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

  // Every real assignment across all 6 technical roles must draw on the
  // Fable family (any of its 4 identities) for at most 2 roles total —
  // never 3 or more, regardless of which exact variant/access-path each
  // individual pick used. Two genuinely different real alternatives exist
  // (second-model, third-model), so the portfolio never needs to fall back
  // to "no real alternative left" and re-pick Fable anyway.
  const fableIds = new Set(["claude-fable-5-1", "claude-fable-5-1-low", "claude-fable-5-1-high", "claude-fable-5-1-thinking-xhigh"]);
  const technicalRoles = ["Explorer", "Architect", "Builder", "Debugger", "Tester", "Reviewer"];
  const fableRoleCount = technicalRoles.filter((role) => fableIds.has(byRole[role]?.primary?.modelId)).length;
  assert.ok(fableRoleCount <= 2, `Fable family (any variant/access-path) covered ${fableRoleCount} technical roles — must never exceed the real 2-role concentration limit`);
  // The real alternatives (genuinely different models) must pick up the
  // roles Fable's variants can no longer take once the family limit hits.
  assert.ok(technicalRoles.some((role) => byRole[role]?.primary?.modelId === "second-model" || byRole[role]?.primary?.modelId === "third-model"),
    "a genuinely different model must cover at least one role once the Fable family hits its concentration limit");
});

test("buildEfficientTeam coordinates the portfolio too: a model that already claimed its 2-role limit on the coding floor cedes an adequate intelligence role to the real alternative", () => {
  // Codex's coding score (60.0) is only ~73.5% of Claude's (81.6) — below
  // the 80% floor, so Claude is the ONLY adequate candidate for
  // Builder/Tester; Codex never clears the coding floor for those roles.
  // Codex is the raw intelligence leader (53.4 vs Claude's 52.8, ~1.1%
  // ahead) — Claude still clears the 80% floor there (well within it).
  //
  // Under the multi-metric role-capability engine, Architect/Debugger/
  // Reviewer blend reasoning+coding (median); with only these two real
  // metrics, both models' median collapses to their shared, near-tied
  // reasoning score, so both stay adequate for these roles too — same
  // 2-candidate floor-passing pool as Explorer. EFFICIENT TEAM's
  // concentration override never invokes the tighter (8%) decisive-leader
  // check used by CAPABILITY TEAM — its whole pool is already
  // floor-filtered, so any member is by definition "adequate," and a
  // concentration limit can always force a swap among floor-clearing
  // candidates instead of repeating the raw leader.
  const aa = [
    { slug: "claude-model", name: "Claude Model", intelligenceIndex: 52.8, codingIndex: 81.6, mathIndex: null, terminalBenchV2: 0.80 },
    { slug: "codex-model", name: "Codex Model", intelligenceIndex: 53.4, codingIndex: 60.0, mathIndex: null, terminalBenchV2: 0.55 }
  ];
  const scored = scoreAvailableModels(
    [{ adapterId: "claude", models: [{ id: "claude-model" }] }, { adapterId: "codex", models: [{ id: "codex-model" }] }], aa
  );
  const team = buildEfficientTeam(scored, { claude: { ok: true }, codex: { ok: true } });
  const byRole = Object.fromEntries(team.map((t) => [t.role, t]));

  // Builder/Tester: Claude is the ONLY real candidate that clears the
  // coding floor — Codex never even qualifies for these roles, claiming
  // Claude's full 2-role concentration limit before any other role is
  // resolved.
  assert.equal(byRole.Builder.primary.adapterId, "claude");
  assert.equal(byRole.Tester.primary.adapterId, "claude");

  // Explorer/Architect: Claude's 2-role limit is already spent on
  // Builder/Tester — Codex, the real adequate alternative, gets both.
  assert.equal(byRole.Explorer.primary.adapterId, "codex");
  assert.equal(byRole.Architect.primary.adapterId, "codex");
  assert.match(byRole.Architect.reason, /assigned to a different model\/provider to avoid concentration/);

  // Debugger/Reviewer: Codex's real terminal-bench gap (added alongside
  // coding to satisfy Builder/Debugger's real required-capability gate)
  // now also drags it below Debugger's capability floor — Claude is the
  // only real adequate candidate here regardless of concentration state.
  assert.equal(byRole.Debugger.primary.adapterId, "claude");
  assert.equal(byRole.Reviewer.primary.adapterId, "claude");
  assert.match(byRole.Debugger.reason, /Only adequate option — no real alternative clears the capability floor\./);
});

test("buildAiTeam keeps Reviewer on Builder's own provider when no independent real alternative exists, rather than forcing an incapable model", () => {
  const aa = [{ slug: "only-model", name: "Only Model", intelligenceIndex: 80, codingIndex: 80, mathIndex: null, terminalBenchV2: 0.80 }];
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
    { slug: "claude-model", name: "Claude Model", intelligenceIndex: 90, codingIndex: 90, mathIndex: null, terminalBenchV2: 0.90 },
    { slug: "codex-model", name: "Codex Model", intelligenceIndex: 20, codingIndex: 20, mathIndex: null, terminalBenchV2: 0.20 }
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
  assert.match(explorer.reason, /lower real price/);
});

test("buildAiTeam never lets price itself decide — it only ever sees a role's real capability and the portfolio's concentration state", () => {
  // Fable's intelligence lead over Kimi (~18%) is decisive for Explorer/
  // Architect (reasoning-only/reasoning+coding) — Kimi never qualifies
  // there. Debugger now also folds in terminalExecution (a real required
  // capability, tied here at 0.78 for both) — with reasoning+coding+
  // terminal all in the median, a tied terminal score is real evidence
  // that dilutes reasoning's otherwise-decisive weight enough for Kimi to
  // become a real near-equivalent for Debugger too, same as Builder/
  // Tester. Kimi never wins because it's cheaper; price never appears
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
  assert.equal(byRole.Builder.primary.adapterId, "opencode-go", "the real coding+terminal near-equivalent gets Builder once Fable's 2-role limit is spent");
  assert.equal(byRole.Debugger.primary.adapterId, "opencode-go", "a tied terminal score is real evidence Kimi is a genuine near-equivalent here too");
  assert.match(byRole.Builder.reason, /assigned to a different model\/provider to avoid concentration/);

  for (const entry of team) {
    if (entry.reason) assert.doesNotMatch(entry.reason, /price/i, "AI TEAM's reasoning must never mention price at all");
  }
});

test("buildAiTeam only prefers cost when a real alternative is actually near-equivalent — a genuinely large real gap still wins on capability, whatever the price", () => {
  const aa = [
    { slug: "strong-model", name: "Strong", intelligenceIndex: 90, codingIndex: 90, mathIndex: null, priceInputPerMTok: 10, terminalBenchV2: 0.90 },
    { slug: "cheap-weak-model", name: "Cheap Weak", intelligenceIndex: 90, codingIndex: 40, mathIndex: null, priceInputPerMTok: 1, terminalBenchV2: 0.90 }
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
    { slug: "claude-model", name: "Claude Model", intelligenceIndex: 53.4, codingIndex: 81.6, mathIndex: null, terminalBenchV2: 0.80 },
    { slug: "codex-model", name: "Codex Model", intelligenceIndex: 52.8, codingIndex: 78.0, mathIndex: null, terminalBenchV2: 0.80 }
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
  // Debugger's real required capabilities are reasoning, coding,
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
  const debugger_ = team.find((t) => t.role === "Debugger");
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

test("Economy requires a real capability floor — a model AA never scored on intelligence or coding can't win purely on price", () => {
  const aa = [
    { slug: "unscored-cheap", name: "Unscored Cheap", intelligenceIndex: null, codingIndex: null, mathIndex: null, priceInputPerMTok: 0.01 },
    { slug: "scored-pricier", name: "Scored Pricier", intelligenceIndex: 50, codingIndex: 60, mathIndex: null, priceInputPerMTok: 5 }
  ];
  const scored = scoreAvailableModels(
    [{ adapterId: "codex", models: [{ id: "unscored-cheap" }] }, { adapterId: "claude", models: [{ id: "scored-pricier" }] }], aa
  );
  const team = buildAiTeam(scored, { codex: { ok: true }, claude: { ok: true } });
  const economy = team.find((t) => t.role === "Economy");
  assert.equal(economy.primary.adapterId, "claude", "an unscored model must never win Economy just because it's cheaper");
});

test("buildEfficientTeam prefers real higher throughput as the tie-break after price", () => {
  const aa = [
    { slug: "claude-model", name: "Claude Model", intelligenceIndex: 53.4, codingIndex: 81.6, mathIndex: null, priceInputPerMTok: 10, outputTokensPerSecond: 50 },
    { slug: "codex-model", name: "Codex Model", intelligenceIndex: 52.8, codingIndex: 77.0, mathIndex: null, priceInputPerMTok: 10, outputTokensPerSecond: 150 }
  ];
  const scored = scoreAvailableModels(
    [{ adapterId: "claude", models: [{ id: "claude-model" }] }, { adapterId: "codex", models: [{ id: "codex-model" }] }], aa
  );
  // Same real price — speed should decide the near-equivalent tie. Checked
  // on Explorer (intelligence), the first role assigned in this fixture —
  // Builder/Tester (coding) also clear the floor here and would otherwise
  // get contaminated by whichever model Explorer/Architect claim first
  // under the portfolio's own 2-role concentration limit.
  const team = buildEfficientTeam(scored, { claude: { ok: true }, codex: { ok: true } });
  const explorer = team.find((t) => t.role === "Explorer");
  assert.equal(explorer.primary.adapterId, "codex", "the real 3x faster option should win the tie when price doesn't distinguish them");
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
    // 65% of the leader's coding score — real, but below the 80% floor.
    { slug: "too-weak-model", name: "Too Weak", intelligenceIndex: 90, codingIndex: 58.5, mathIndex: null, priceInputPerMTok: 1, terminalBenchV2: 0.585 }
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
    // A third, real distractor so Explorer/Architect/Debugger/Reviewer
    // (intelligence) claim a different model entirely, never touching
    // "adequate-model" — isolating Builder/Tester (coding) from the
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

test("a provider's real quota headroom alone can never decide a role when a real per-model signal (cost, duration, price, throughput) is available", () => {
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
  // genuine per-model efficiency signal that must decide first, even
  // though it means picking the model whose provider has far LESS quota.
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
  assert.equal(explorer.primary.adapterId, "claude", "real observed cost must decide before quota, even when the other provider has far more headroom");
  assert.match(explorer.reason, /lower real observed cost per task/);
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
  assert.match(explorer.reason, /lower real provider quota pressure/);
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

test("Debugger's terminalExecution requirement is satisfied by the real ingestOfficialSnapshotEvidence pipeline (metric name \"terminal-bench\", not a same-named synthetic key)", () => {
  // Debugger's real required capabilities (reasoning, coding,
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
  const debugger_ = team.find((t) => t.role === "Debugger");
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
  const technicalRoles = ["Explorer", "Architect", "Builder", "Debugger", "Tester", "Reviewer"];
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
  const technicalRoles = ["Explorer", "Architect", "Builder", "Debugger", "Tester", "Reviewer"];
  const globalByRole = Object.fromEntries(global.map((t) => [t.role, t]));
  // Luna clears the real 80% capability floor against Astra and is
  // meaningfully cheaper/faster — the real efficient winner for every
  // role, with no per-role variation forced by portfolio concentration.
  for (const role of technicalRoles) {
    assert.equal(globalByRole[role]?.primary?.adapterId, "opencode-go", `EFFICIENT GLOBAL must keep the real cheaper/faster winner for ${role} in every role, uncoordinated`);
  }
});
