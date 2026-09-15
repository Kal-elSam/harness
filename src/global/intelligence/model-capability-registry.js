// The "Model Intelligence Foundation": a raw evidence store, never a
// computed score. Every fact Kairo knows about a model — regardless of
// which source it came from — gets recorded here with its provenance
// (source, benchmark version, model config/harness, date, whether the
// source itself independently verified it) instead of being collapsed
// into a single number immediately. Routing (AI TEAM, the old FIT) can
// later be rebuilt on top of this without re-deriving evidence collection
// each time a new source is added.
//
// Deliberately out of scope here: role scores, confidence-weighted
// averages across sources, or automatic cross-source consensus. Averaging
// two benchmark runs from different harnesses/versions isn't honest —
// they're not measuring the same thing. This module only stores evidence
// and, at most, picks the single most trustworthy entry for a metric
// (bestEvidence) — it never blends.
//
// No cross-provider identity unification is attempted either: claiming
// "this Codex model IS this OpenCode model" needs real evidence Kairo
// doesn't have. Each (adapterId, modelId) pair is its own identity.

function identityKey(adapterId, modelId) {
  return `${adapterId}:${modelId}`;
}

const REQUIRED_EVIDENCE_FIELDS = ["metric", "value", "source"];

/**
 * @returns {{
 *   registerIdentity: (adapterId: string, modelId: string, displayName?: string|null) => string,
 *   addEvidence: (id: string, entry: object) => object,
 *   getEvidence: (id: string, metric?: string) => object[],
 *   getIdentity: (id: string) => object|null,
 *   listIdentities: () => object[]
 * }}
 */
export function createCapabilityRegistry() {
  const identities = new Map();
  const evidence = new Map();

  return {
    /** Idempotent: re-registering the same (adapterId, modelId) returns the same id without overwriting displayName. */
    registerIdentity(adapterId, modelId, displayName = null) {
      const id = identityKey(adapterId, modelId);
      if (!identities.has(id)) identities.set(id, { id, adapterId, modelId, displayName });
      return id;
    },

    /**
     * Appends one piece of raw evidence — never overwrites or merges with
     * existing entries, since a model can genuinely have multiple real
     * measurements for the same metric (different sources, versions,
     * configs) that must stay distinguishable.
     * @param {string} id - from registerIdentity()
     * @param {{metric: string, value: number, source: string, benchmarkVersion?: string|null, modelConfig?: string|null, date?: string|null, verified?: boolean}} entry
     */
    addEvidence(id, entry) {
      if (!identities.has(id)) throw new Error(`capability-registry: unknown model identity "${id}" — call registerIdentity() first`);
      for (const key of REQUIRED_EVIDENCE_FIELDS) {
        if (entry[key] == null) throw new Error(`capability-registry: evidence for "${id}" is missing required field "${key}"`);
      }
      if (entry.scale != null && entry.scale !== "unit" && entry.scale !== "hundred") {
        throw new Error(`capability-registry: evidence for "${id}" has invalid scale "${entry.scale}" — must be "unit", "hundred", or omitted`);
      }
      const record = {
        metric: entry.metric,
        value: entry.value,
        source: entry.source,
        benchmarkVersion: entry.benchmarkVersion ?? null,
        modelConfig: entry.modelConfig ?? null,
        date: entry.date ?? null,
        verified: entry.verified === true,
        // The REAL scale this exact value was reported on ("unit": 0-1
        // fraction, "hundred": 0-100 percentage-like score) — set by the
        // ingestion source that actually knows it, e.g.
        // ingestHuggingFaceLeaderboardEvidence's own real, live-verified
        // knowledge that HLE via Hugging Face reports 0-100 (63.9), never
        // a 0-1 fraction. Optional (null when omitted) so capability-
        // scoring.js's own BENCHMARK_IDENTITIES metric-name-based scale
        // stays a valid fallback for older evidence that never declared
        // one — see capability-scoring.js's bestAcrossAliases for the
        // real bug this fixes: two sources sharing one metric NAME
        // ("hle") but reporting in genuinely different real scales must
        // never both defer to a single scale guessed from the name alone.
        scale: entry.scale ?? null
      };
      if (!evidence.has(id)) evidence.set(id, []);
      evidence.get(id).push(record);
      return record;
    },

    /** All evidence for a model, optionally filtered to one metric. Empty array, never null, when there's none. */
    getEvidence(id, metric = null) {
      const all = evidence.get(id) ?? [];
      return metric ? all.filter((e) => e.metric === metric) : [...all];
    },

    getIdentity(id) {
      return identities.get(id) ?? null;
    },

    listIdentities() {
      return [...identities.values()];
    }
  };
}

/**
 * The single most trustworthy piece of evidence for a metric — never an
 * average or blend, since incompatible benchmark versions/harnesses can't
 * be honestly combined into one number. Preference: independently
 * verified first, then most recent. Returns null (never a guess) when no
 * evidence exists for that model/metric.
 * @param {ReturnType<createCapabilityRegistry>} registry
 * @param {string} id
 * @param {string} metric
 */
export function bestEvidence(registry, id, metric) {
  const entries = registry.getEvidence(id, metric);
  if (!entries.length) return null;
  return [...entries].sort((a, b) => {
    if (a.verified !== b.verified) return a.verified ? -1 : 1;
    const dateValue = (entry) => (entry.date ? Date.parse(entry.date) : Number.NEGATIVE_INFINITY);
    return dateValue(b) - dateValue(a);
  })[0];
}
