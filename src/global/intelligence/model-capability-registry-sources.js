// Feeds real evidence into a CapabilityRegistry (model-capability-registry.js).
// Today this has exactly one source — Artificial Analysis, already
// integrated elsewhere in Kairo — proving the registry's shape works
// before any new external source (Hugging Face leaderboard API, Epoch AI,
// OpenRouter metadata) is wired in. Adding a source later means adding
// another `ingest*` function here, never changing the registry itself.

import { matchArtificialAnalysisScore } from "./model-intelligence.js";

// One evidence entry per real, non-null field AA reports — never a
// fabricated zero for a metric AA doesn't have for that model.
const AA_METRICS = ["intelligenceIndex", "codingIndex", "mathIndex", "priceInputPerMTok", "outputTokensPerSecond"];

/**
 * Registers every real, matched (provider catalog ↔ Artificial Analysis)
 * model as an identity, and records one evidence entry per real metric it
 * reports. AA's free tier never independently verifies a result the way a
 * leaderboard's per-submission `verified` flag would, so every entry here
 * is honestly `verified: false` — that distinction matters once a source
 * that does verify (e.g. Hugging Face leaderboards) is added.
 * @param {ReturnType<import("./capability-registry.js").createCapabilityRegistry>} registry
 * @param {Array<{adapterId: string, models: Array<object|string>}>} providerCatalogs
 * @param {Array<object>} aaModels
 * @param {{fetchedAt?: string}} [options]
 */
export function ingestArtificialAnalysisEvidence(registry, providerCatalogs, aaModels, { fetchedAt = new Date().toISOString() } = {}) {
  for (const { adapterId, models } of providerCatalogs) {
    for (const entry of models ?? []) {
      const model = typeof entry === "string" ? { id: entry, displayName: entry } : entry;
      const match = matchArtificialAnalysisScore(model.id, aaModels);
      if (!match) continue;
      const id = registry.registerIdentity(adapterId, model.id, model.displayName ?? null);
      for (const metric of AA_METRICS) {
        const value = match[metric];
        if (value == null) continue;
        registry.addEvidence(id, {
          metric, value, source: "artificial-analysis-free",
          benchmarkVersion: null, modelConfig: null, date: fetchedAt, verified: false
        });
      }
    }
  }
  return registry;
}
