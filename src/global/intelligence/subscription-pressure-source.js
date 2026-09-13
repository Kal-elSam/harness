// Real subscription quota pressure — how much headroom is actually left
// on each provider's account right now (from the same usage probes
// service.js already fetches for /usage). This is a PROVIDER-level
// signal, not a per-model efficiency measurement: quota is account-wide,
// so the same real remaining-percent is attached to every model under
// that adapter's real catalog purely so EFFICIENT TEAM can look it up the
// same way as a model-specific metric. It must never be treated as
// evidence that one MODEL is more efficient than another — two models
// from the same provider always carry the identical value here. It's also
// deliberately the LAST signal EFFICIENCY_DIMENSIONS checks (see
// model-intelligence.js), used only when no real per-model signal
// (consumption, cost, duration, price, throughput) distinguishes
// otherwise-adequate candidates — a provider's spare quota must never, by
// itself, decide who wins a role over a model with genuinely better
// per-task economics.

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
