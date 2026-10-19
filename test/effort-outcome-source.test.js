import test from "node:test";
import assert from "node:assert/strict";
import { createCapabilityRegistry } from "../src/global/intelligence/model-capability-registry.js";
import { readEffortOutcomes, ingestEffortOutcomeEvidence } from "../src/global/intelligence/effort-outcome-source.js";

const model = "claude-haiku-4-5";
const rows = n => Array.from({ length: n }, (_, i) => ({
  model, outcome: i === 0 ? "fail" : "pass", timestamp: `2026-10-${String(i + 1).padStart(2, "0")}T00:00:00Z`
}));

test("S48 five valid rows plus any malformed line atomically produce no evidence", async () => {
  const valid = rows(5).map(row => JSON.stringify(row)).join("\n");
  for (const invalid of ["{broken", "null", "{}", '{"model":"","outcome":"pass"}', '{"model":42,"outcome":"pass"}', `{"model":"${model}","outcome":"unknown"}`]) {
    const readFile = async (path, encoding) => {
      assert.equal(path, "results.jsonl");
      assert.equal(encoding, "utf8");
      return `${valid}\n\n${invalid}\n`;
    };
    const parsed = await readEffortOutcomes("results.jsonl", readFile);
    assert.deepEqual(parsed, [], invalid);
    const registry = createCapabilityRegistry();
    ingestEffortOutcomeEvidence(registry, parsed);
    assert.deepEqual(registry.listIdentities(), [], invalid);
  }
});

test("S48 missing and wholly malformed files yield no rows", async () => {
  assert.deepEqual(await readEffortOutcomes("missing", async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); }), []);
  assert.deepEqual(await readEffortOutcomes("bad", async () => "not json\n{bad"), []);
});

test("S48 four valid outcomes are ignored, five produce a unit-scale pass-rate prior", () => {
  const registry = createCapabilityRegistry();
  ingestEffortOutcomeEvidence(registry, [...rows(4), { model, outcome: "unknown" }]);
  assert.deepEqual(registry.listIdentities(), []);
  ingestEffortOutcomeEvidence(registry, [...rows(5).reverse(), null, {}, { model: "gpt-x", outcome: "pass" }]);
  const evidence = registry.getEvidence(`claude:${model}`);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].metric, "effort.passRate"); // Metric preserves prior semantics when the registry drops unknown flags.
  assert.equal(evidence[0].value, 0.8);
  assert.equal(evidence[0].source, "kairo-effort-eval");
  assert.equal(evidence[0].scale, "unit");
  assert.equal(evidence[0].verified, false);
  assert.equal(evidence[0].date, "2026-10-05T00:00:00Z");
  assert.equal(evidence[0].modelConfig, "5 outcome tasks");
});

test("S48 threshold is injectable and each Claude model has its own denominator", () => {
  const registry = createCapabilityRegistry();
  ingestEffortOutcomeEvidence(registry, [...rows(2), ...rows(2).map(row => ({ ...row, model: "claude-opus-5-5", outcome: "pass" }))], { minRows: 2 });
  assert.equal(registry.getEvidence(`claude:${model}`)[0].value, 0.5);
  assert.equal(registry.getEvidence("claude:claude-opus-5-5")[0].value, 1);
});
