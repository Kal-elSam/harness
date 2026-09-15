import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAutomaticExecutionPool, buildCompleteCandidateCatalog, buildRecommendationPool,
  resolveLineage, stripDisplayVariant, stripLineageSuffixes
} from "../src/global/intelligence/model-candidate-catalog.js";
import { buildAiTeam, scoreAvailableModels } from "../src/global/intelligence/model-intelligence.js";

test("stripDisplayVariant strips real trailing effort/context tokens, never touching a model's own real name", () => {
  assert.deepEqual(stripDisplayVariant("Claude Opus 4.7 1M High Thinking Fast"), { modelName: "Claude Opus 4.7", variant: "1M High Thinking Fast" });
  assert.deepEqual(stripDisplayVariant("Codex 5.3 Low Fast"), { modelName: "Codex 5.3", variant: "Low Fast" });
  assert.deepEqual(stripDisplayVariant("GPT-5.6 Sol 1M None Fast"), { modelName: "GPT-5.6 Sol", variant: "1M None Fast" });
  assert.deepEqual(stripDisplayVariant("Claude Fable 5.1 1M Extra High Thinking (NO ZDR)"), {
    modelName: "Claude Fable 5.1", variant: "1M Extra High Thinking (NO ZDR)"
  });
});

test("stripDisplayVariant leaves real product-tier names alone — Mini/Nano/Flash/Sol/Code are real, distinct models, never stripped as if they were effort settings", () => {
  // Real audited counter-example: GLM-5.3 and GLM-5.3-Flash are genuinely
  // different OpenCode Go models (1.4/4.4 vs 0.15/0.5 real cost) — Flash
  // must never be treated as a variant of GLM-5.3.
  assert.deepEqual(stripDisplayVariant("GLM-5.3-Flash"), { modelName: "GLM-5.3-Flash", variant: null });
  assert.deepEqual(stripDisplayVariant("GPT-5.4 Mini Extra High"), { modelName: "GPT-5.4 Mini", variant: "Extra High" });
  assert.deepEqual(stripDisplayVariant("Gemini 3.6 Flash Minimal"), { modelName: "Gemini 3.6 Flash", variant: "Minimal" });
  assert.deepEqual(stripDisplayVariant("Kimi K2.7 Code"), { modelName: "Kimi K2.7 Code", variant: null });
});

test("stripDisplayVariant is a no-op for a name with no trailing variant tokens — idempotent, never invents a split", () => {
  assert.deepEqual(stripDisplayVariant("GPT-6-Astra"), { modelName: "GPT-6-Astra", variant: null });
  assert.deepEqual(stripDisplayVariant("Claude Opus 5"), { modelName: "Claude Opus 5", variant: null });
});

test("buildCompleteCandidateCatalog includes every real model from every provider given, UNSCORED ones included, never dropped for lack of evidence", () => {
  const providerCatalogs = [
    { adapterId: "codex", models: [{ id: "gpt-6-astra", displayName: "GPT-6-Astra" }] },
    { adapterId: "cursor", models: [{ id: "gpt-5.3-codex-low", displayName: "Codex 5.3 Low" }, { id: "auto", displayName: "Auto (current, default)" }] },
    { adapterId: "opencode-go", models: [{ id: "glm-5.3-flash", displayName: "GLM-5.3-Flash", costInputPerMTok: 0.15, costOutputPerMTok: 0.5 }] }
  ];
  const aaModels = [
    { slug: "gpt-6-astra", name: "GPT-6 Astra", intelligenceIndex: 52.8, codingIndex: 76.9 }
    // gpt-5.3-codex-low and glm-5.3-flash have no real AA match here.
  ];
  const catalog = buildCompleteCandidateCatalog(providerCatalogs, aaModels);
  assert.equal(catalog.length, 4);

  const astra = catalog.find((c) => c.candidateKey === "codex::gpt-6-astra");
  assert.equal(astra.modelName, "GPT-6-Astra");
  assert.equal(astra.accessMode, "automatic");
  assert.equal(astra.evidenceStatus, "scored");

  const codexLow = catalog.find((c) => c.candidateKey === "cursor::gpt-5.3-codex-low");
  assert.equal(codexLow.modelName, "Codex 5.3");
  assert.equal(codexLow.rawDisplayName, "Codex 5.3 Low");
  assert.equal(codexLow.accessMode, "manual");
  // No real AA match for this exact id in this fixture — UNSCORED, never guessed.
  assert.equal(codexLow.evidenceStatus, "unscored");

  const glmFlash = catalog.find((c) => c.candidateKey === "opencode-go::glm-5.3-flash");
  assert.equal(glmFlash.modelName, "GLM-5.3-Flash");
  assert.equal(glmFlash.accessMode, "manual");
  assert.deepEqual(glmFlash.resourceCost, { inputPerMTok: 0.15, outputPerMTok: 0.5 });
});

test("buildCompleteCandidateCatalog gives Cursor's Auto router an honest, opaque identity — never an assumed inner model", () => {
  const catalog = buildCompleteCandidateCatalog(
    [{ adapterId: "cursor", models: [{ id: "auto", displayName: "Auto (current, default)" }] }], []
  );
  const auto = catalog[0];
  assert.equal(auto.candidateKey, "cursor::auto");
  assert.equal(auto.modelName, "Cursor Auto");
  assert.equal(auto.accessMode, "manual");
  assert.equal(auto.evidenceStatus, "unscored");
  assert.equal(auto.lifecycle, "unknown");
});

test("evidenceStatus distinguishes a real AA match with thin evidence (partial) from no match at all (unscored)", () => {
  const providerCatalogs = [{ adapterId: "codex", models: [{ id: "thin-model", displayName: "Thin Model" }] }];
  const aaModels = [{ slug: "thin-model", name: "Thin Model", intelligenceIndex: null, codingIndex: null }];
  const catalog = buildCompleteCandidateCatalog(providerCatalogs, aaModels);
  assert.equal(catalog[0].evidenceStatus, "partial");
});

test("an unrecognized modelId pattern always gets lineageKey/generation/lifecycle null/null/unknown — never guessed", () => {
  const catalog = buildCompleteCandidateCatalog(
    [{ adapterId: "opencode-go", models: [{ id: "kimi-k2.7-code", displayName: "Kimi K2.7 Code" }, { id: "deepseek-v4.1-flash", displayName: "DeepSeek V4.1 Flash" }] }],
    []
  );
  for (const candidate of catalog) {
    assert.equal(candidate.lineageKey, null);
    assert.equal(candidate.generation, null);
    assert.equal(candidate.lifecycle, "unknown");
  }
});

test("resolveLineage recognizes Claude's own opus/sonnet/fable/haiku naming — real generations verified against this session's live audit", () => {
  assert.deepEqual(resolveLineage("claude-opus-5"), { lineageKey: "claude-opus", generation: 5 });
  assert.deepEqual(resolveLineage("claude-opus-4-8"), { lineageKey: "claude-opus", generation: 4.8 });
  assert.deepEqual(resolveLineage("claude-fable-5-1"), { lineageKey: "claude-fable", generation: 5.1 });
  assert.deepEqual(resolveLineage("claude-fable-5"), { lineageKey: "claude-fable", generation: 5 });
  // A real Cursor-style effort-suffixed id resolves to the SAME real
  // lineage/generation as its bare id — a variant never changes what
  // generation a model actually is (see stripLineageSuffixes).
  assert.deepEqual(resolveLineage("claude-opus-5-thinking-high"), { lineageKey: "claude-opus", generation: 5 });
});

test("REGRESSION: resolveLineage never treats a real Cursor effort suffix (low/medium/high/xhigh/max/none/fast/thinking) as a DIFFERENT real product tier — a real bug this session's live-catalog verification caught: it invented fake lineages like \"gpt-low\"/\"glm-high\" that wrongly compared unrelated base generations sharing the same effort word", () => {
  for (const suffix of ["low", "medium", "high", "xhigh", "max", "none", "fast"]) {
    assert.deepEqual(resolveLineage(`gpt-5.4-${suffix}`), { lineageKey: "gpt", generation: 5.4 }, `gpt-5.4-${suffix} should resolve to the bare gpt lineage, not a fake "gpt-${suffix}" one`);
    assert.deepEqual(resolveLineage(`glm-5.2-${suffix}`), { lineageKey: "glm", generation: 5.2 }, `glm-5.2-${suffix} should resolve to the bare glm lineage, not a fake "glm-${suffix}" one`);
  }
  // The real regression scenario: without the fix, gpt-5.1-low and
  // gpt-5.4-low shared a fake "gpt-low" lineage — a DIFFERENT bug from
  // "unrelated ids sharing a real bare lineage" (which IS correct: both
  // really are bare "gpt" generation 5.1 and 5.4, and 5.1 genuinely is
  // older). The fix must reject the FAKE tier split, not the real
  // lineage match itself.
  const catalog = buildCompleteCandidateCatalog([{
    adapterId: "cursor",
    models: [{ id: "gpt-5.1-low", displayName: "GPT-5.1 Low" }, { id: "gpt-5.4-low", displayName: "GPT-5.4 Low" }]
  }], []);
  const byId = Object.fromEntries(catalog.map((c) => [c.modelId, c]));
  assert.equal(byId["gpt-5.1-low"].lineageKey, "gpt");
  assert.equal(byId["gpt-5.4-low"].lineageKey, "gpt");
  assert.equal(byId["gpt-5.1-low"].lifecycle, "superseded");
  assert.equal(byId["gpt-5.4-low"].lifecycle, "current");
});

test("REGRESSION: a variant suffix never produces a false unknown — a real, genuinely-superseded old generation's Cursor variant must still resolve its true lineage and get marked superseded, exactly like the bare id would", () => {
  const catalog = buildCompleteCandidateCatalog([{
    adapterId: "cursor",
    models: [
      { id: "claude-sonnet-4-6-thinking-high", displayName: "Claude Sonnet 4.6 1M Thinking High" },
      { id: "claude-sonnet-5", displayName: "Claude Sonnet 5" }
    ]
  }], []);
  const byId = Object.fromEntries(catalog.map((c) => [c.modelId, c]));
  assert.equal(byId["claude-sonnet-4-6-thinking-high"].lineageKey, "claude-sonnet");
  assert.equal(byId["claude-sonnet-4-6-thinking-high"].lifecycle, "superseded");
  assert.equal(byId["claude-sonnet-5"].lifecycle, "current");
  // The real modelId used for scoring/execution/candidateKey must stay
  // completely untouched — lineageSubjectId is internal to resolveLineage.
  assert.equal(byId["claude-sonnet-4-6-thinking-high"].modelId, "claude-sonnet-4-6-thinking-high");
  assert.equal(byId["claude-sonnet-4-6-thinking-high"].candidateKey, "cursor::claude-sonnet-4-6-thinking-high");
});

test("stripLineageSuffixes strips real, verified variant tokens (thinking/high/fast/1m and the two-token \"no-zdr\" privacy marker) without touching a real base id", () => {
  assert.equal(stripLineageSuffixes("claude-fable-5-1-1m-thinking-no-zdr"), "claude-fable-5-1");
  assert.equal(stripLineageSuffixes("gpt-5.6-sol-high-fast"), "gpt-5.6-sol");
  assert.equal(stripLineageSuffixes("claude-opus-5"), "claude-opus-5");
});

test("REGRESSION: resolveLineage also recognizes Cursor's own reordered claude-{version}-{tier} id form as the SAME lineage as claude-{tier}-{version} — a real gap this session's own live integration verification caught: Cursor re-exposes Sonnet 4/4.5/4.6 as \"claude-4-sonnet\"/\"claude-4.6-sonnet\", never \"claude-sonnet-4\"", () => {
  assert.deepEqual(resolveLineage("claude-4-sonnet"), { lineageKey: "claude-sonnet", generation: 4 });
  assert.deepEqual(resolveLineage("claude-4.6-sonnet"), { lineageKey: "claude-sonnet", generation: 4.6 });
  // Same lineageKey as the tier-first form — genuinely comparable.
  assert.equal(resolveLineage("claude-4-sonnet").lineageKey, resolveLineage("claude-sonnet-5").lineageKey);

  const catalog = buildCompleteCandidateCatalog([{
    adapterId: "cursor",
    models: [
      { id: "claude-4-sonnet", displayName: "Claude Sonnet 4" },
      { id: "claude-4.6-sonnet-medium", displayName: "Claude Sonnet 4.6 1M" }
    ]
  }, {
    adapterId: "claude",
    models: [{ id: "claude-sonnet-5", displayName: "Claude Sonnet 5" }]
  }], []);
  const byId = Object.fromEntries(catalog.map((c) => [c.modelId, c]));
  assert.equal(byId["claude-4-sonnet"].lifecycle, "superseded");
  assert.equal(byId["claude-4.6-sonnet-medium"].lifecycle, "superseded");
  assert.equal(byId["claude-sonnet-5"].lifecycle, "current");
});

test("resolveLineage treats a GLM tier suffix as a DIFFERENT lineage, never a generation of the bare line — verified against real, differently-priced siblings", () => {
  assert.deepEqual(resolveLineage("glm-5.3"), { lineageKey: "glm", generation: 5.3 });
  assert.deepEqual(resolveLineage("glm-5.3-flash"), { lineageKey: "glm-flash", generation: 5.3 });
  assert.notEqual(resolveLineage("glm-5.3").lineageKey, resolveLineage("glm-5.3-flash").lineageKey);
});

test("resolveLineage treats a Codex persona name as a DIFFERENT lineage too — astra/sol/terra/luna are real, distinct products, never comparable generations", () => {
  assert.deepEqual(resolveLineage("gpt-6-astra"), { lineageKey: "gpt-astra", generation: 6 });
  assert.deepEqual(resolveLineage("gpt-5.6-sol"), { lineageKey: "gpt-sol", generation: 5.6 });
  assert.deepEqual(resolveLineage("gpt-5.5"), { lineageKey: "gpt", generation: 5.5 });
});

test("buildCompleteCandidateCatalog marks a real, strictly older Claude generation superseded when its real successor is also in the catalog", () => {
  const catalog = buildCompleteCandidateCatalog([{
    adapterId: "claude",
    models: [
      { id: "claude-opus-4-6", displayName: "Claude Opus 4.6" },
      { id: "claude-opus-4-8", displayName: "Claude Opus 4.8" },
      { id: "claude-opus-5", displayName: "Claude Opus 5" },
      { id: "claude-sonnet-5", displayName: "Claude Sonnet 5" }
    ]
  }], []);
  const byId = Object.fromEntries(catalog.map((c) => [c.modelId, c]));
  assert.equal(byId["claude-opus-4-6"].lifecycle, "superseded");
  assert.equal(byId["claude-opus-4-8"].lifecycle, "superseded");
  assert.equal(byId["claude-opus-5"].lifecycle, "current");
  // Sonnet is its own lineage — the only sonnet present, so it's current
  // even though it never competed against any opus generation.
  assert.equal(byId["claude-sonnet-5"].lifecycle, "current");
});

test("buildCompleteCandidateCatalog never marks a candidate superseded just because a NEWER-NAMED sibling exists at a DIFFERENT persona/tier lineage", () => {
  // Real Codex catalog shape: gpt-6-astra (newest generation number) does
  // NOT supersede gpt-5.6-sol/terra/luna (different persona) or bare
  // gpt-5.5 (no persona at all, no matching-tier successor exists).
  const catalog = buildCompleteCandidateCatalog([{
    adapterId: "codex",
    models: [
      { id: "gpt-6-astra", displayName: "GPT-6-Astra" },
      { id: "gpt-5.6-sol", displayName: "GPT-5.6-Sol" },
      { id: "gpt-5.6-terra", displayName: "GPT-5.6-Terra" },
      { id: "gpt-5.6-luna", displayName: "GPT-5.6-Luna" },
      { id: "gpt-5.5", displayName: "GPT-5.5" }
    ]
  }], []);
  for (const candidate of catalog) assert.equal(candidate.lifecycle, "current", `${candidate.modelId} should stay current — no real same-lineage successor exists`);
});

test("resourceCost is null when the provider reports no real cost — never estimated or borrowed from another model", () => {
  const catalog = buildCompleteCandidateCatalog(
    [{ adapterId: "cursor", models: [{ id: "gpt-5.3-codex", displayName: "Codex 5.3" }] }], []
  );
  assert.equal(catalog[0].resourceCost, null);
});

test("buildRecommendationPool excludes only real superseded candidates — current and unknown both stay recommendable", () => {
  const aa = [
    { slug: "claude-opus-4-6", name: "Claude Opus 4.6", intelligenceIndex: 40, codingIndex: 40 },
    { slug: "claude-opus-5", name: "Claude Opus 5", intelligenceIndex: 55, codingIndex: 55 },
    { slug: "kimi-k2.7-code", name: "Kimi K2.7 Code", intelligenceIndex: 45, codingIndex: 45 }
  ];
  const providerCatalogs = [
    { adapterId: "claude", models: [{ id: "claude-opus-4-6", displayName: "Claude Opus 4.6" }, { id: "claude-opus-5", displayName: "Claude Opus 5" }] },
    { adapterId: "opencode-go", models: [{ id: "kimi-k2.7-code", displayName: "Kimi K2.7 Code" }] }
  ];
  const scoredAll = scoreAvailableModels(providerCatalogs, aa);
  const catalog = buildCompleteCandidateCatalog(providerCatalogs, aa);
  const pool = buildRecommendationPool(scoredAll, catalog);
  const keys = pool.map((c) => c.candidateKey);
  assert.ok(!keys.includes("claude::claude-opus-4-6"), "the real, strictly older opus generation must be excluded");
  assert.ok(keys.includes("claude::claude-opus-5"), "the real current generation stays");
  // kimi-k2.7-code has no recognized lineage (unknown) — must NOT be excluded.
  assert.ok(keys.includes("opencode-go::kimi-k2.7-code"));
});

test("buildRecommendationPool keeps scoreAvailableModels' own real fields untouched and attaches identity fields alongside — resourceCost never blended with priceInputPerMTok", () => {
  const aa = [{ slug: "glm-5.3-flash", name: "GLM 5.3 Flash", intelligenceIndex: 40, codingIndex: 50, priceInputPerMTok: 0.15 }];
  const providerCatalogs = [{
    adapterId: "opencode-go",
    models: [{ id: "glm-5.3-flash", displayName: "GLM-5.3-Flash", costInputPerMTok: 0.15, costOutputPerMTok: 0.5 }]
  }];
  const scoredAll = scoreAvailableModels(providerCatalogs, aa);
  const catalog = buildCompleteCandidateCatalog(providerCatalogs, aa);
  const pool = buildRecommendationPool(scoredAll, catalog);
  const candidate = pool[0];
  assert.equal(candidate.intelligenceIndex, 40);
  assert.equal(candidate.codingIndex, 50);
  assert.equal(candidate.priceInputPerMTok, 0.15);
  assert.equal(candidate.modelName, "GLM-5.3-Flash");
  assert.equal(candidate.accessMode, "manual");
  assert.deepEqual(candidate.resourceCost, { inputPerMTok: 0.15, outputPerMTok: 0.5 });
  assert.notEqual(candidate.resourceCost.inputPerMTok, undefined);
  // The two cost signals coexist, never merged into one another.
  assert.notEqual(candidate.priceInputPerMTok, candidate.resourceCost);
});

test("buildRecommendationPool keeps real manual-only candidates (Cursor, OpenCode Go) — a caller must never silently drop them", () => {
  const aa = [{ slug: "gpt-5.3-codex", name: "Codex 5.3", intelligenceIndex: 50, codingIndex: 60 }];
  const providerCatalogs = [{ adapterId: "cursor", models: [{ id: "gpt-5.3-codex", displayName: "Codex 5.3" }] }];
  const scoredAll = scoreAvailableModels(providerCatalogs, aa);
  const catalog = buildCompleteCandidateCatalog(providerCatalogs, aa);
  const pool = buildRecommendationPool(scoredAll, catalog);
  assert.equal(pool.length, 1);
  assert.equal(pool[0].accessMode, "manual");
});

test("buildAutomaticExecutionPool requires BOTH accessMode automatic AND real current eligibility — never alters or drops the Recommendation Pool itself", () => {
  const aa = [
    { slug: "gpt-6-astra", name: "GPT-6 Astra", intelligenceIndex: 55, codingIndex: 70 },
    { slug: "gpt-5.3-codex", name: "Codex 5.3", intelligenceIndex: 50, codingIndex: 60 }
  ];
  const providerCatalogs = [
    { adapterId: "codex", models: [{ id: "gpt-6-astra", displayName: "GPT-6-Astra" }] },
    { adapterId: "cursor", models: [{ id: "gpt-5.3-codex", displayName: "Codex 5.3" }] }
  ];
  const scoredAll = scoreAvailableModels(providerCatalogs, aa);
  const catalog = buildCompleteCandidateCatalog(providerCatalogs, aa);
  const recommendationPool = buildRecommendationPool(scoredAll, catalog);

  const bothEligible = { codex: { ok: true }, cursor: { ok: true } };
  const automaticPool = buildAutomaticExecutionPool(recommendationPool, bothEligible);
  // Cursor is manual-only by real design — never appears here even when eligible.
  assert.deepEqual(automaticPool.map((c) => c.candidateKey), ["codex::gpt-6-astra"]);
  // The Recommendation Pool itself is completely unaffected.
  assert.equal(recommendationPool.length, 2);

  const codexNotEligible = { codex: { ok: false, reason: "quota exhausted" }, cursor: { ok: true } };
  assert.deepEqual(buildAutomaticExecutionPool(recommendationPool, codexNotEligible), []);
});

test("INTEGRATION: feeding the Recommendation Pool into buildAiTeam as its `models` argument keeps a real superseded generation from ever winning a role, with no change to buildAiTeam's own ranking logic", () => {
  const aa = [
    { slug: "claude-opus-4-6", name: "Claude Opus 4.6", intelligenceIndex: 90, codingIndex: 90 },
    { slug: "claude-opus-5", name: "Claude Opus 5", intelligenceIndex: 60, codingIndex: 60 }
  ];
  const providerCatalogs = [{
    adapterId: "claude",
    models: [{ id: "claude-opus-4-6", displayName: "Claude Opus 4.6" }, { id: "claude-opus-5", displayName: "Claude Opus 5" }]
  }];
  const scoredAll = scoreAvailableModels(providerCatalogs, aa);
  const catalog = buildCompleteCandidateCatalog(providerCatalogs, aa);
  const recommendationPool = buildRecommendationPool(scoredAll, catalog);
  const eligibility = { claude: { ok: true } };

  // Raw scoredAll (no lifecycle filtering) would let the real, higher-
  // scoring but strictly older opus-4-6 win on capability alone.
  const teamFromRawScored = buildAiTeam(scoredAll, eligibility);
  assert.equal(teamFromRawScored.find((t) => t.role === "Architect").primary.modelId, "claude-opus-4-6");

  // The Recommendation Pool already excluded it — buildAiTeam's own
  // ranking never needs to know why; it just never sees the option.
  const teamFromPool = buildAiTeam(recommendationPool, eligibility);
  assert.equal(teamFromPool.find((t) => t.role === "Architect").primary.modelId, "claude-opus-5");
});
