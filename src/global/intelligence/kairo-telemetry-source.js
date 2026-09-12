// Kairo's own real runtime telemetry as a Model Intelligence Foundation
// source. Every real task Kairo executes already gets its duration, token
// usage, cost, and outcome recorded per run (see applyEventToMetadata in
// run-events.js) — this just wires that already-collected data into the
// same CapabilityRegistry as every external source, with zero new cost
// and zero new benchmark runs. It's the one source with real 100%
// coverage of exactly what you actually use: every model, every provider,
// in your real environment, on your real tasks — not a public
// benchmark's idea of what matters.
//
// Only terminal (finished) runs with a known model are ingested: a run
// still in progress has no real duration or outcome yet, and a run with
// no recorded model can't be attributed to one. Kairo directly observing
// its own runs is treated as `verified: true` — there is no more
// first-party a measurement can get.

import { isTerminalRunState, RUN_STATES } from "../runtime/run-types.js";

export const TELEMETRY_METRICS = Object.freeze({
  DURATION_MS: "kairo.durationMs",
  TOTAL_TOKENS: "kairo.totalTokens",
  COST: "kairo.cost",
  SUCCESS: "kairo.success"
});

/**
 * @param {ReturnType<import("./model-capability-registry.js").createCapabilityRegistry>} registry
 * @param {Array<object>} runRecords - listRunRecords() output (real run metadata)
 */
export function ingestKairoTelemetryEvidence(registry, runRecords) {
  for (const run of runRecords ?? []) {
    if (!run?.model || !run?.agentId) continue;
    if (!isTerminalRunState(run.state)) continue;

    const id = registry.registerIdentity(run.agentId, run.model);
    const date = run.completedAt ?? run.updatedAt ?? null;
    // runId identifies WHICH real run each measurement came from — never
    // averaged into a single number here; that's for whatever consumes
    // this evidence to decide, same as every other source in this registry.
    const addTelemetryEvidence = (metric, value) => {
      if (value == null) return;
      registry.addEvidence(id, {
        metric, value, source: "kairo-telemetry",
        benchmarkVersion: null, modelConfig: run.runId, date, verified: true
      });
    };

    const startedAtMs = Date.parse(run.startedAt ?? "");
    const completedAtMs = Date.parse(run.completedAt ?? "");
    if (Number.isFinite(startedAtMs) && Number.isFinite(completedAtMs) && completedAtMs >= startedAtMs) {
      addTelemetryEvidence(TELEMETRY_METRICS.DURATION_MS, completedAtMs - startedAtMs);
    }

    addTelemetryEvidence(TELEMETRY_METRICS.TOTAL_TOKENS, run.tokenUsage?.total ?? null);
    addTelemetryEvidence(TELEMETRY_METRICS.COST, run.cost ?? null);
    addTelemetryEvidence(TELEMETRY_METRICS.SUCCESS, run.state === RUN_STATES.COMPLETED ? 1 : 0);
  }
  return registry;
}
