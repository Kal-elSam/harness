import test from "node:test";
import assert from "node:assert/strict";
import { createCapabilityRegistry, bestEvidence } from "../src/global/intelligence/model-capability-registry.js";
import { ingestKairoBenchEvidence } from "../src/global/intelligence/kairobench-source.js";

function fakeResult(overrides = {}) {
  return {
    taskId: "implementation-01", category: "Implementation",
    adapterId: "codex", model: "gpt-6-astra", success: true,
    durationMs: 4200, tokenUsage: { total: 1500 }, cost: 0.03, runId: "run-1",
    ...overrides
  };
}

test("ingestKairoBenchEvidence records real success, duration, and cost per task", () => {
  const registry = createCapabilityRegistry();
  ingestKairoBenchEvidence(registry, [fakeResult()]);
  const id = registry.registerIdentity("codex", "gpt-6-astra");
  assert.equal(bestEvidence(registry, id, "kairobench.implementation-01.success").value, 1);
  assert.equal(bestEvidence(registry, id, "kairobench.implementation-01.durationMs").value, 4200);
  assert.equal(bestEvidence(registry, id, "kairobench.implementation-01.cost").value, 0.03);
});

test("ingestKairoBenchEvidence records a real failure as success=0, never dropped", () => {
  const registry = createCapabilityRegistry();
  ingestKairoBenchEvidence(registry, [fakeResult({ success: false })]);
  const id = registry.registerIdentity("codex", "gpt-6-astra");
  assert.equal(bestEvidence(registry, id, "kairobench.implementation-01.success").value, 0);
});

test("ingestKairoBenchEvidence is verified:true — Kairo directly ran this exact task against this exact model itself", () => {
  const registry = createCapabilityRegistry();
  ingestKairoBenchEvidence(registry, [fakeResult()]);
  const id = registry.registerIdentity("codex", "gpt-6-astra");
  for (const entry of registry.getEvidence(id)) assert.equal(entry.verified, true);
});

test("ingestKairoBenchEvidence keeps each task's metric distinct — never blends implementation-01 with debugging-01", () => {
  const registry = createCapabilityRegistry();
  ingestKairoBenchEvidence(registry, [
    fakeResult({ taskId: "implementation-01", success: true }),
    fakeResult({ taskId: "debugging-01", success: false })
  ]);
  const id = registry.registerIdentity("codex", "gpt-6-astra");
  assert.equal(bestEvidence(registry, id, "kairobench.implementation-01.success").value, 1);
  assert.equal(bestEvidence(registry, id, "kairobench.debugging-01.success").value, 0);
});

test("ingestKairoBenchEvidence skips a result missing adapterId, model, or taskId rather than guessing an identity", () => {
  const registry = createCapabilityRegistry();
  ingestKairoBenchEvidence(registry, [fakeResult({ model: null })]);
  assert.equal(registry.listIdentities().length, 0);
});

test("ingestKairoBenchEvidence never fabricates duration or cost when they weren't recorded", () => {
  const registry = createCapabilityRegistry();
  ingestKairoBenchEvidence(registry, [fakeResult({ durationMs: null, cost: null })]);
  const id = registry.registerIdentity("codex", "gpt-6-astra");
  assert.equal(registry.getEvidence(id, "kairobench.implementation-01.durationMs").length, 0);
  assert.equal(registry.getEvidence(id, "kairobench.implementation-01.cost").length, 0);
});
