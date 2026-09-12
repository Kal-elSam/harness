// Real subscription quota pressure — how much headroom is actually left
// on each provider's account right now (from the same usage probes
// service.js already fetches for /usage). Quota is account-wide, not
// per-model, so the same real remaining-percent is attached to every
// model under that adapter's real catalog — this is what lets EFFICIENT
// TEAM prefer whichever real provider currently has more room, instead of
// only ever comparing nominal per-token price.

export function ingestQuotaPressureEvidence(registry, catalogsByAdapter, remainingPercentByAdapter) {
  for (const [adapterId, remainingPercent] of Object.entries(remainingPercentByAdapter ?? {})) {
    if (remainingPercent == null) continue;
    const models = catalogsByAdapter[adapterId] ?? [];
    for (const entry of models) {
      const modelId = typeof entry === "string" ? entry : entry.id;
      if (!modelId) continue;
      const id = registry.registerIdentity(adapterId, modelId);
      registry.addEvidence(id, {
        metric: "kairo.quotaRemainingPercent", value: remainingPercent,
        source: "kairo-telemetry", benchmarkVersion: null, modelConfig: null,
        date: new Date().toISOString(), verified: true
      });
    }
  }
  return registry;
}
