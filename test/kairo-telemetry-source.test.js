import test from "node:test";
import assert from "node:assert/strict";
import { createCapabilityRegistry, bestEvidence } from "../src/global/intelligence/model-capability-registry.js";
import { ingestKairoTelemetryEvidence, TELEMETRY_METRICS } from "../src/global/intelligence/kairo-telemetry-source.js";
import { RUN_STATES } from "../src/global/runtime/run-types.js";

function fakeRun(overrides = {}) {
  return {
    runId: "run-1", agentId: "codex", model: "gpt-6-astra",
    state: RUN_STATES.COMPLETED,
    startedAt: "2026-09-12T10:00:00.000Z",
    completedAt: "2026-09-12T10:04:00.000Z",
    tokenUsage: { input: 1000, output: 500, total: 1500 },
    cost: 0.42,
    ...overrides
  };
}

test("ingestKairoTelemetryEvidence records real duration, tokens, cost, and success for a completed run", () => {
  const registry = createCapabilityRegistry();
  ingestKairoTelemetryEvidence(registry, [fakeRun()]);
  const id = registry.registerIdentity("codex", "gpt-6-astra");
  assert.equal(bestEvidence(registry, id, TELEMETRY_METRICS.DURATION_MS).value, 240_000);
  assert.equal(bestEvidence(registry, id, TELEMETRY_METRICS.TOTAL_TOKENS).value, 1500);
  assert.equal(bestEvidence(registry, id, TELEMETRY_METRICS.COST).value, 0.42);
  assert.equal(bestEvidence(registry, id, TELEMETRY_METRICS.SUCCESS).value, 1);
});

test("Kairo's own directly-observed telemetry is marked verified — there's no more first-party a measurement gets", () => {
  const registry = createCapabilityRegistry();
  ingestKairoTelemetryEvidence(registry, [fakeRun()]);
  const id = registry.registerIdentity("codex", "gpt-6-astra");
  for (const entry of registry.getEvidence(id)) assert.equal(entry.verified, true);
});

test("a failed run records success=0, still real evidence, never dropped", () => {
  const registry = createCapabilityRegistry();
  ingestKairoTelemetryEvidence(registry, [fakeRun({ state: RUN_STATES.FAILED, runId: "run-2" })]);
  const id = registry.registerIdentity("codex", "gpt-6-astra");
  assert.equal(bestEvidence(registry, id, TELEMETRY_METRICS.SUCCESS).value, 0);
});

test("a run still in progress is skipped — it has no real duration or outcome yet", () => {
  const registry = createCapabilityRegistry();
  ingestKairoTelemetryEvidence(registry, [fakeRun({ state: RUN_STATES.RUNNING, completedAt: null })]);
  assert.equal(registry.listIdentities().length, 0);
});

test("a run with no recorded model is skipped — it can't be attributed to a specific model", () => {
  const registry = createCapabilityRegistry();
  ingestKairoTelemetryEvidence(registry, [fakeRun({ model: null })]);
  assert.equal(registry.listIdentities().length, 0);
});

test("a run with no cost or token usage still records duration and success, never fabricating the missing fields", () => {
  const registry = createCapabilityRegistry();
  ingestKairoTelemetryEvidence(registry, [fakeRun({ tokenUsage: null, cost: null })]);
  const id = registry.registerIdentity("codex", "gpt-6-astra");
  assert.equal(registry.getEvidence(id, TELEMETRY_METRICS.TOTAL_TOKENS).length, 0);
  assert.equal(registry.getEvidence(id, TELEMETRY_METRICS.COST).length, 0);
  assert.ok(registry.getEvidence(id, TELEMETRY_METRICS.DURATION_MS).length >= 1);
});

test("each real run's evidence keeps its own runId in modelConfig, never averaged with another run", () => {
  const registry = createCapabilityRegistry();
  ingestKairoTelemetryEvidence(registry, [
    fakeRun({ runId: "run-a", tokenUsage: { total: 1000 } }),
    fakeRun({ runId: "run-b", tokenUsage: { total: 2000 } })
  ]);
  const id = registry.registerIdentity("codex", "gpt-6-astra");
  const entries = registry.getEvidence(id, TELEMETRY_METRICS.TOTAL_TOKENS);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((e) => e.modelConfig).sort(), ["run-a", "run-b"]);
});
