// Feeds real evidence into a CapabilityRegistry (model-capability-registry.js).
// Two sources so far: Artificial Analysis (already integrated elsewhere in
// Kairo) and Hugging Face's per-benchmark leaderboard API, scoped to
// OpenCode Go's open-weight models only — verified live that HF's
// leaderboards have ZERO coverage of Codex/Claude (proprietary, not hosted
// on the HF Hub) and real coverage of Go's model family (GLM/Kimi/DeepSeek/
// Qwen/MiniMax, all HF-hosted). Adding another source (Epoch AI, OpenRouter
// metadata) means adding another `ingest*` function here, never changing
// the registry itself.

import { matchArtificialAnalysisScore } from "./model-intelligence.js";

// One evidence entry per real, non-null field AA reports — never a
// fabricated zero for a metric AA doesn't have for that model. The
// per-benchmark fields (gpqa, hle, ...) are real scores the free API
// already returns alongside the composite indices — verified live, an
// earlier assumption that free tier lacked them was wrong.
const AA_METRICS = [
  "intelligenceIndex", "codingIndex", "mathIndex", "priceInputPerMTok", "outputTokensPerSecond",
  "gpqa", "hle", "sciCode", "mmluPro", "liveCodeBench", "ifBench", "terminalBenchHard", "terminalBenchV2", "tau2", "tauBanking"
];

// The REAL scale each AA metric is reported on — declared here, not
// guessed downstream by capability-scoring.js's metric-name-based
// fallback. AA's own per-benchmark fields (gpqa/hle/sciCode/mmluPro/
// liveCodeBench/ifBench/terminalBenchHard/terminalBenchV2/tau2/
// tauBanking) are real 0-1 fractions. intelligenceIndex/codingIndex/
// mathIndex are AA's own 0-100 composite indices. price/speed aren't
// percentage-like values at all — no real "unit vs hundred" question
// applies, left undeclared (undefined here means addEvidence gets no
// scale for them, same as before this fix).
const AA_METRIC_SCALE = {
  gpqa: "unit", hle: "unit", sciCode: "unit", mmluPro: "unit", liveCodeBench: "unit", ifBench: "unit",
  terminalBenchHard: "unit", terminalBenchV2: "unit", tau2: "unit", tauBanking: "unit",
  intelligenceIndex: "hundred", codingIndex: "hundred", mathIndex: "hundred"
};

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
          metric, value, source: "artificial-analysis-free", scale: AA_METRIC_SCALE[metric] ?? null,
          benchmarkVersion: null, modelConfig: null, date: fetchedAt, verified: false
        });
      }
    }
  }
  return registry;
}

function normalizeHfId(id) {
  return String(id ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function sortedTokens(normalizedId) {
  return normalizedId.split("-").filter(Boolean).sort().join("-");
}

/**
 * Finds every real leaderboard entry for a model id — plural, never just
 * the first hit, because the same model can legitimately appear more than
 * once in one dataset with different real configs/harnesses (e.g. "with
 * tools" vs. not) and those aren't the same measurement. HF's `modelId` is
 * "org/model" (e.g. "zai-org/GLM-5.3"); only the model part is compared,
 * since Kairo's own catalog ids never carry an org prefix.
 * @param {string} modelId
 * @param {Array<{modelId: string}>} hfEntries
 */
export function matchHuggingFaceEntries(modelId, hfEntries) {
  const normalized = normalizeHfId(modelId);
  if (!normalized) return [];
  const withModelPart = hfEntries.map((entry) => {
    const raw = String(entry.modelId ?? "");
    const modelPart = raw.includes("/") ? raw.slice(raw.lastIndexOf("/") + 1) : raw;
    return { entry, normalized: normalizeHfId(modelPart) };
  });
  const exact = withModelPart.filter((c) => c.normalized === normalized);
  if (exact.length) return exact.map((c) => c.entry);
  const tokens = sortedTokens(normalized);
  return withModelPart.filter((c) => sortedTokens(c.normalized) === tokens).map((c) => c.entry);
}

/**
 * Registers real leaderboard evidence for one benchmark (one HF dataset =
 * one benchmark — there's no cross-benchmark aggregate endpoint). Every
 * real match becomes its own evidence entry (never averaged, never
 * deduplicated to "the first one") so different real configs/harnesses for
 * the same model stay distinguishable, exactly like the registry's own
 * contract requires. `verified` is real per-entry data from HF (an
 * independent-verification flag on that specific submission), unlike AA's
 * free tier which never verifies anything.
 * @param {ReturnType<import("./model-capability-registry.js").createCapabilityRegistry>} registry
 * @param {Array<{adapterId: string, models: Array<object|string>}>} providerCatalogs
 * @param {Array<{modelId: string, value: number|null, verified: boolean, notes?: string|null}>} hfEntries
 * @param {{metric: string, scale?: "unit"|"hundred", benchmarkVersion?: string|null, fetchedAt?: string}} options -
 *   `scale` is the REAL scale this exact HF dataset reports on — the
 *   caller's own responsibility to know, since a different source can
 *   report the SAME metric name in a genuinely different real scale (see
 *   the real bug this parameter fixes: HLE via Hugging Face reports 0-100,
 *   verified live — DeepSeek-V4.1-Flash's real value is 63.9, not 0.639 —
 *   while Artificial Analysis's own "hle" field is a real 0-1 fraction;
 *   both used to share capability-scoring.js's single metric-name-based
 *   "unit" assumption, silently treating HF's 63.9 as if it were already
 *   a fraction). Omit only when genuinely unknown — capability-scoring.js
 *   falls back to its own metric-name guess, which is exactly the
 *   behavior that produced the bug.
 */
export function ingestHuggingFaceLeaderboardEvidence(registry, providerCatalogs, hfEntries, { metric, scale = null, benchmarkVersion = null, fetchedAt = new Date().toISOString() }) {
  for (const { adapterId, models } of providerCatalogs) {
    for (const entry of models ?? []) {
      const model = typeof entry === "string" ? { id: entry, displayName: entry } : entry;
      const matches = matchHuggingFaceEntries(model.id, hfEntries);
      if (!matches.length) continue;
      const id = registry.registerIdentity(adapterId, model.id, model.displayName ?? null);
      for (const match of matches) {
        if (match.value == null) continue;
        registry.addEvidence(id, {
          metric, value: match.value, source: "huggingface-leaderboard", scale,
          benchmarkVersion, modelConfig: match.notes ?? match.modelId ?? null,
          date: fetchedAt, verified: match.verified === true
        });
      }
    }
  }
  return registry;
}
