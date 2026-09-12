import test from "node:test";
import assert from "node:assert/strict";
import { createCapabilityRegistry, bestEvidence } from "../src/global/intelligence/model-capability-registry.js";

test("registerIdentity is idempotent for the same (adapterId, modelId) pair", () => {
  const registry = createCapabilityRegistry();
  const id1 = registry.registerIdentity("codex", "gpt-6-astra", "GPT-6 Astra");
  const id2 = registry.registerIdentity("codex", "gpt-6-astra", "GPT-6 Astra");
  assert.equal(id1, id2);
  assert.equal(registry.listIdentities().length, 1);
});

test("registerIdentity treats the same modelId under different adapters as distinct identities — no cross-provider unification guessed", () => {
  const registry = createCapabilityRegistry();
  const codexId = registry.registerIdentity("codex", "shared-name");
  const claudeId = registry.registerIdentity("claude", "shared-name");
  assert.notEqual(codexId, claudeId);
});

test("addEvidence rejects evidence for an unregistered identity, never silently creating one", () => {
  const registry = createCapabilityRegistry();
  assert.throws(() => registry.addEvidence("codex:unknown", { metric: "intelligenceIndex", value: 50, source: "test" }));
});

test("addEvidence requires metric, value, and source — never accepts a partial/guessed entry", () => {
  const registry = createCapabilityRegistry();
  const id = registry.registerIdentity("codex", "gpt-6-astra");
  assert.throws(() => registry.addEvidence(id, { value: 50, source: "test" }));
  assert.throws(() => registry.addEvidence(id, { metric: "intelligenceIndex", source: "test" }));
  assert.throws(() => registry.addEvidence(id, { metric: "intelligenceIndex", value: 50 }));
});

test("addEvidence appends rather than overwrites — a model can have multiple real measurements for the same metric", () => {
  const registry = createCapabilityRegistry();
  const id = registry.registerIdentity("codex", "gpt-6-astra");
  registry.addEvidence(id, { metric: "intelligenceIndex", value: 52.8, source: "artificial-analysis-free" });
  registry.addEvidence(id, { metric: "intelligenceIndex", value: 53.1, source: "huggingface-leaderboard", verified: true });
  const entries = registry.getEvidence(id, "intelligenceIndex");
  assert.equal(entries.length, 2);
});

test("getEvidence returns an empty array, never null, when nothing is recorded", () => {
  const registry = createCapabilityRegistry();
  const id = registry.registerIdentity("codex", "gpt-6-astra");
  assert.deepEqual(registry.getEvidence(id), []);
  assert.deepEqual(registry.getEvidence(id, "intelligenceIndex"), []);
});

test("bestEvidence prefers independently verified evidence over unverified, regardless of recency", () => {
  const registry = createCapabilityRegistry();
  const id = registry.registerIdentity("codex", "gpt-6-astra");
  registry.addEvidence(id, { metric: "codingIndex", value: 76.9, source: "artificial-analysis-free", date: "2026-09-10", verified: false });
  registry.addEvidence(id, { metric: "codingIndex", value: 74.2, source: "huggingface-leaderboard", date: "2026-01-01", verified: true });
  const best = bestEvidence(registry, id, "codingIndex");
  assert.equal(best.source, "huggingface-leaderboard");
});

test("bestEvidence prefers the most recent among equally (un)verified evidence", () => {
  const registry = createCapabilityRegistry();
  const id = registry.registerIdentity("codex", "gpt-6-astra");
  registry.addEvidence(id, { metric: "codingIndex", value: 70, source: "source-a", date: "2025-01-01", verified: false });
  registry.addEvidence(id, { metric: "codingIndex", value: 76.9, source: "source-b", date: "2026-09-10", verified: false });
  const best = bestEvidence(registry, id, "codingIndex");
  assert.equal(best.source, "source-b");
});

test("bestEvidence returns null, never a guess, when there is no evidence for that metric", () => {
  const registry = createCapabilityRegistry();
  const id = registry.registerIdentity("codex", "gpt-6-astra");
  assert.equal(bestEvidence(registry, id, "gpqa"), null);
});
