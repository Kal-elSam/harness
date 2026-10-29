import test from "node:test";
import assert from "node:assert/strict";
import { providerPriceTiers, tierBandPool, builderQuotaPool } from "../src/global/intelligence/price-tier.js";

const m = (adapterId, modelId, input, output, extra = {}) => ({ adapterId, modelId, priceInputPerMTok: input, priceOutputPerMTok: output, ...extra });
// Real list prices from the routing cache on 2026-10-26.
const MODELS = [
  m("claude", "claude-haiku-5-5", .1, .5), m("claude", "claude-haiku-4-5", 1, 5),
  m("claude", "claude-sonnet-5-5", 2, 10), m("claude", "claude-opus-5-5", 4, 20),
  m("codex", "gpt-6-luna", .1, .5), m("codex", "gpt-6.1-sol", 2, 10),
  m("codex", "gpt-5.6-terra", 2, 12), m("codex", "gpt-6-astra", 10, 50)
];
const ids = pool => pool.map(row => row.modelId).sort();

test("each provider's cheapest model is light, its priciest demanding, the rest standard", () => {
  const tiers = providerPriceTiers(MODELS);
  assert.deepEqual(Object.fromEntries(MODELS.map(row => [row.modelId, tiers.get(`${row.adapterId}/${row.modelId}`)])), {
    "claude-haiku-5-5": "light", "claude-haiku-4-5": "standard", "claude-sonnet-5-5": "standard", "claude-opus-5-5": "demanding",
    "gpt-6-luna": "light", "gpt-6.1-sol": "standard", "gpt-5.6-terra": "standard", "gpt-6-astra": "demanding"
  });
});

test("a light role never routes to a provider's demanding model", () => {
  assert.deepEqual(ids(tierBandPool(MODELS, MODELS, "light").pool), ["claude-haiku-5-5", "gpt-6-luna"]);
});

test("standard and demanding roles keep one band per provider", () => {
  assert.deepEqual(ids(tierBandPool(MODELS, MODELS, "standard").pool), ["claude-haiku-4-5", "claude-sonnet-5-5", "gpt-5.6-terra", "gpt-6.1-sol"]);
  assert.deepEqual(ids(tierBandPool(MODELS, MODELS, "demanding").pool), ["claude-opus-5-5", "gpt-6-astra"]);
});

test("a provider without the role's band contributes its nearest higher band and says so", () => {
  const pool = MODELS.filter(row => row.modelId !== "gpt-6-luna");
  const result = tierBandPool(pool, MODELS, "light");
  assert.deepEqual(ids(result.pool), ["claude-haiku-5-5", "gpt-6.1-sol", "gpt-5.6-terra"].sort());
  assert.match(result.note, /codex.*standard/);
});

test("a single priced model serves every band; unpriced models join only when a provider has no priced member", () => {
  const only = [m("opencode-go", "go-a", 1, 1)];
  assert.deepEqual(ids(tierBandPool(only, only, "light").pool), ["go-a"]);
  const mixed = [...MODELS, m("cursor", "cursor-auto", null, null)];
  assert.ok(ids(tierBandPool(mixed, mixed, "light").pool).includes("cursor-auto"));
  const shadowed = [...MODELS, m("claude", "claude-unknown", null, null)];
  assert.ok(!ids(tierBandPool(shadowed, shadowed, "light").pool).includes("claude-unknown"));
});

test("a model without list prices stays unpriced even with an AA cost per task", () => {
  const rows = [m("claude", "a", .1, .5), m("claude", "b", 4, 20), m("claude", "c", null, null, { costPerTask: 5 })];
  assert.equal(providerPriceTiers(rows).has("claude/c"), false);
});

test("builderQuotaPool narrows to the cheapest model unless the provider has projected unused quota", () => {
  const cheap = m("codex", "cheap", 1, 1), mid = m("codex", "mid", 2, 2), top = m("codex", "top", 10, 10);
  const qualified = [top, cheap, mid];
  const band = [top];
  assert.deepEqual(builderQuotaPool(qualified, band, new Set()).pool, [cheap]);
  assert.match(builderQuotaPool(qualified, band, new Set()).note, /cheapest qualified model/);
  assert.deepEqual(builderQuotaPool(qualified, band, new Set(["codex"])), { pool: [top], note: null });
});

test('Builder quota cannot replace rescued standard peers with the only qualified frontier', () => {
  const top = MODELS.find(row => row.modelId === 'gpt-6-astra');
  const mid = MODELS.find(row => row.modelId === 'gpt-6.1-sol');
  assert.deepEqual(builderQuotaPool([top], [mid], new Set()).pool, [mid]);
});
