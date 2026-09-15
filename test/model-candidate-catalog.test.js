import test from "node:test";
import assert from "node:assert/strict";
import { buildCompleteCandidateCatalog, stripDisplayVariant } from "../src/global/intelligence/model-candidate-catalog.js";

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

test("lineageKey/generation/lifecycle are always null/null/unknown in this increment — real generation-supersession detection is deliberately deferred, never guessed", () => {
  const catalog = buildCompleteCandidateCatalog(
    [{ adapterId: "claude", models: [{ id: "claude-opus-4-6", displayName: "Claude Opus 4.6" }, { id: "claude-opus-5", displayName: "Claude Opus 5" }] }],
    []
  );
  for (const candidate of catalog) {
    assert.equal(candidate.lineageKey, null);
    assert.equal(candidate.generation, null);
    assert.equal(candidate.lifecycle, "unknown");
  }
});

test("resourceCost is null when the provider reports no real cost — never estimated or borrowed from another model", () => {
  const catalog = buildCompleteCandidateCatalog(
    [{ adapterId: "cursor", models: [{ id: "gpt-5.3-codex", displayName: "Codex 5.3" }] }], []
  );
  assert.equal(catalog[0].resourceCost, null);
});
