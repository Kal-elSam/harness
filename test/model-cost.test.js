import test from "node:test";
import assert from "node:assert/strict";
import { resolveModelCost } from "../src/global/intelligence/model-cost.js";

test("cost uses AA prices rather than catalog rates or model names", () => {
  const model = { adapterId: "codex", modelId: "arbitrary", resourceCost: { inputPerMTok: 1, outputPerMTok: 3 }, priceInputPerMTok: 10, priceOutputPerMTok: 20 };
  assert.equal(resolveModelCost(model).weight, 30);
  assert.equal(resolveModelCost({ ...model, modelId: "renamed" }).weight, 30);
  assert.equal(resolveModelCost({ priceInputPerMTok: 2, priceOutputPerMTok: 6 }).weight, 8);
  assert.equal(resolveModelCost({ resourceCost: model.resourceCost }).weight, Infinity);
  assert.equal(resolveModelCost(model, null, 0).weight, 30);
});

test("unknown or incomplete prices fail expensive; invalid quota is not zero", () => {
  for (const model of [{}, { priceInputPerMTok: 1 }, { priceInputPerMTok: -1, priceOutputPerMTok: 2 }, { priceInputPerMTok: "1", priceOutputPerMTok: 2 }]) {
    assert.equal(resolveModelCost(model).weight, Infinity);
    assert.equal(resolveModelCost(model).source, "unknown");
  }
  const model = { adapterId: "codex", priceInputPerMTok: 1, priceOutputPerMTok: 1 };
  for (const remaining of [null, undefined, NaN, "1", -1, 101]) {
    assert.equal(resolveModelCost(model, { codex: { quotaRemainingPercent: remaining } }).weight, 2);
  }
  assert.equal(resolveModelCost(model, { codex: { quotaRemainingPercent: 1 } }).weight, 200);
  assert.equal(resolveModelCost(model, { codex: { quotaRemainingPercent: 0 } }).weight, Infinity);
});

test("AA prices remain authoritative even when owned task costs were measured", async () => {
  const { withQuotaCosts } = await import("../src/global/intelligence/model-cost.js");
  const rows = [
    { model: { adapterId: "codex", priceInputPerMTok: 1, priceOutputPerMTok: 1 }, ownedEvidence: { cost: null } },
    { model: { adapterId: "claude", priceInputPerMTok: 2, priceOutputPerMTok: 2 }, ownedEvidence: { cost: null } }
  ];
  assert.deepEqual(withQuotaCosts(rows, null).map(row => row.quotaCostWeight), [2, 4]);
  assert.deepEqual(withQuotaCosts(rows, { codex: { quotaRemainingPercent: 1 } }).map(row => row.quotaCostWeight), [200, 4]);
  rows[0].ownedEvidence.cost = 10;
  assert.deepEqual(withQuotaCosts(rows, null).map(row => row.quotaCostWeight), [2, 4]);
});
