// Offline preserved AA rows; prices are read from data, never identity aliases.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchArtificialAnalysisScore, scoreAvailableModels } from "../src/global/intelligence/model-intelligence.js";
import { readClaudeModels } from "../src/global/observability/claude-models.js";
import { AA_CATALOG_IDENTITIES } from "../src/global/intelligence/aa-identity.js";
import { resolveModelCost } from "../src/global/intelligence/model-cost.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/team-selection-repro-dfd018.json", import.meta.url), "utf8"));

test("Claude and captured Codex catalogs resolve AA identities and both AA prices offline", () => {
  const catalogs = [
    { adapterId: "claude", models: readClaudeModels().models },
    { adapterId: "codex", models: fixture.catalogs.codex.models }
  ];
  const scored = scoreAvailableModels(catalogs, fixture.aa.models);
  // claude-haiku-5-5 has no AA row in the captured fixture: it stays unscored, never borrows Haiku 4.5 data.
  const unscored = new Set(["claude-haiku-5-5"]);
  assert.equal(scored.length, catalogs.reduce((n, c) => n + c.models.filter(model => !unscored.has(model.id)).length, 0));
  assert.equal(scored.some(row => row.modelId === "claude-haiku-5-5"), false);
  for (const catalog of catalogs) for (const model of catalog.models.filter(model => !unscored.has(model.id))) {
    const expectedSlug = model.id === "claude-haiku-4-5-20251001" ? "claude-4-5-haiku" : model.id.replaceAll(".", "-");
    const aa = fixture.aa.models.find(row => row.slug === expectedSlug || (model.id === "claude-haiku-4-5" && row.slug === "claude-4-5-haiku"));
    const row = scored.find(row => row.adapterId === catalog.adapterId && row.modelId === model.id);
    assert.equal(row.slug, aa.slug, model.id);
    assert.equal(row.priceInputPerMTok, aa.priceInputPerMTok, model.id);
    assert.equal(row.priceOutputPerMTok, aa.priceOutputPerMTok, model.id);
    assert.equal(resolveModelCost(row).weight, aa.priceInputPerMTok + aa.priceOutputPerMTok, model.id);
  }
});

test("dated Haiku identity uses its exact AA alias without guessing other dates or generations", () => {
  assert.deepEqual(AA_CATALOG_IDENTITIES, { "claude-haiku-4-5-20251001": "claude-4-5-haiku" });
  const aa = fixture.aa.models.find(row => row.slug === "claude-4-5-haiku");
  assert.equal(matchArtificialAnalysisScore("claude-haiku-4-5-20251001", [aa]), aa);
  assert.equal(matchArtificialAnalysisScore("claude-haiku-4-5-20251002", [aa]), null);
  assert.equal(matchArtificialAnalysisScore("claude-haiku-5-5", [aa]), null);
  assert.equal(matchArtificialAnalysisScore("claude-haiku-4-5-20251001", []), null);
  const changed = { ...aa, priceInputPerMTok: 7, priceOutputPerMTok: 13 };
  const [model] = scoreAvailableModels([{ adapterId: "claude", models: [{ id: "claude-haiku-4-5-20251001" }] }], [changed]);
  assert.equal(resolveModelCost(model).weight, 20);
});
