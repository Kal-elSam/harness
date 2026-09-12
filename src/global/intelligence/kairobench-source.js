// Feeds real KairoBench results (kairobench-runner.js) into the Model
// Intelligence Foundation registry, same shape as every other source:
// per-task success and duration recorded separately, never blended into
// one composite score. `verified: true` — Kairo directly ran this exact
// task against this exact model itself; there is no more first-party a
// measurement gets.

export function ingestKairoBenchEvidence(registry, results) {
  for (const result of results ?? []) {
    if (!result?.adapterId || !result?.model || !result?.taskId) continue;
    const id = registry.registerIdentity(result.adapterId, result.model);
    const date = new Date().toISOString();

    registry.addEvidence(id, {
      metric: `kairobench.${result.taskId}.success`, value: result.success ? 1 : 0,
      source: "kairobench", benchmarkVersion: null, modelConfig: result.runId ?? null, date, verified: true
    });

    if (result.durationMs != null) {
      registry.addEvidence(id, {
        metric: `kairobench.${result.taskId}.durationMs`, value: result.durationMs,
        source: "kairobench", benchmarkVersion: null, modelConfig: result.runId ?? null, date, verified: true
      });
    }

    if (result.cost != null) {
      registry.addEvidence(id, {
        metric: `kairobench.${result.taskId}.cost`, value: result.cost,
        source: "kairobench", benchmarkVersion: null, modelConfig: result.runId ?? null, date, verified: true
      });
    }
  }
  return registry;
}
