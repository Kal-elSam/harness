// Robust multi-metric role scoring: percentile-normalized, confidence-aware,
// never a fabricated zero for missing evidence. Consumes the same raw
// CapabilityRegistry evidence (model-capability-registry.js) that AI TEAM
// always has — this module owns turning that evidence into a per-role
// score; it never collects evidence itself.
//
// Why percentiles, not the AA composite indices directly: AA's
// intelligenceIndex/codingIndex are already a blend Kairo doesn't control
// (which benchmarks, what weights) and mix 0-100/0-1 scales across
// sources. Ranking on percentile position within Kairo's own real,
// accessible candidate pool sidesteps the whole scale question — relative
// order is scale-invariant — and stops one blended vendor number from
// silently deciding a role Kairo could score on its own real component
// benchmarks instead.
//
// Percentile alone can't decide EVERYTHING, though: with Kairo's typical
// real candidate pool (2-3 accessible providers), a percentile rank is
// always exactly {0, 0.5, 1} — it encodes ORDER, never real magnitude, by
// construction. Two models 1% apart and two models 40% apart both just
// read "1 vs 0" with only two real candidates. So this module exports two
// parallel, deliberately different numbers per model: capabilityPercentile
// (robust rank position — decides WHO'S AHEAD) and a separate real,
// scale-normalized gap value (decides HOW CLOSE — near-equivalence bands
// and capability floors in model-intelligence.js compare THIS, never the
// percentile, so small pools keep real granularity instead of collapsing
// every non-winner to a floor-failing 0).

/**
 * @typedef {"reasoning"|"coding"|"terminalExecution"|"softwareExecution"|"instructionFollowing"} Capability
 */

/**
 * One real, distinct benchmark identity per row — `metricAliases` lists
 * every metric NAME any connected source uses for that SAME real
 * benchmark (e.g. AA's free API reports GPQA as "gpqa"; a manufacturer's
 * own launch-page table reports the identical benchmark as
 * "gpqa-diamond"). Deduplicated via bestEvidence-style pick (verified
 * first, then most recent) BEFORE ranking, so the same real benchmark
 * reported by two sources counts once, never twice in a capability's
 * median. Distinct real benchmarks (GPQA vs HLE — Humanity's Last Exam is
 * a different exam, not a rename) always stay separate rows.
 *
 * terminalBenchV2/terminalBenchHard/terminal-bench/terminal-bench-science
 * are pooled as one identity here, inheriting the same grouping this
 * codebase's CANONICAL_CAPABILITIES table already uses elsewhere — not a
 * new decision introduced by this module.
 *
 * tauBanking is deliberately excluded from softwareExecution: it's kept
 * as a separate agentic/tool-use signal, never counted as software
 * engineering capability, per explicit product decision.
 * Each alias also carries its own real `scale` ("unit": 0-1 fraction, as
 * AA's free API and most independent evals report; "hundred": 0-100
 * score, as manufacturer launch tables tend to report) — used ONLY by the
 * real-gap calculation below, never by the percentile ranking (which is
 * scale-invariant by construction).
 * @type {Array<{benchmarkId: string, capability: Capability, metricAliases: Array<{metric: string, scale: "unit"|"hundred"}>}>}
 */
export const BENCHMARK_IDENTITIES = [
  { benchmarkId: "gpqa", capability: "reasoning", metricAliases: [{ metric: "gpqa", scale: "unit" }, { metric: "gpqa-diamond", scale: "hundred" }] },
  { benchmarkId: "hle", capability: "reasoning", metricAliases: [{ metric: "hle", scale: "unit" }] },
  { benchmarkId: "mmlu-pro", capability: "reasoning", metricAliases: [{ metric: "mmluPro", scale: "unit" }] },
  { benchmarkId: "livecodebench", capability: "coding", metricAliases: [{ metric: "liveCodeBench", scale: "unit" }] },
  { benchmarkId: "scicode", capability: "coding", metricAliases: [{ metric: "sciCode", scale: "unit" }] },
  { benchmarkId: "terminal-bench", capability: "terminalExecution", metricAliases: [
    { metric: "terminalBenchV2", scale: "unit" }, { metric: "terminalBenchHard", scale: "unit" },
    { metric: "terminal-bench", scale: "hundred" }, { metric: "terminal-bench-science", scale: "hundred" }
  ] },
  { benchmarkId: "cursorbench", capability: "softwareExecution", metricAliases: [{ metric: "cursorbench", scale: "hundred" }] },
  { benchmarkId: "kairo-success", capability: "softwareExecution", metricAliases: [{ metric: "kairo.success", scale: "unit" }] },
  { benchmarkId: "ifbench", capability: "instructionFollowing", metricAliases: [{ metric: "ifBench", scale: "unit" }] }
];

// A capability falls back to AA's own composite index ONLY when none of
// its component benchmarks (above) produced a real, comparable cohort
// anywhere in the current candidate pool — never alongside real component
// benchmarks (that would double-count the same underlying capability:
// once via its real components, once via the blended index that already
// includes them).
export const COMPOSITE_FALLBACKS = { reasoning: "intelligenceIndex", coding: "codingIndex" };

function activeBenchmarkIdentities(capability) {
  return BENCHMARK_IDENTITIES.filter((identity) => identity.capability === capability);
}

/** How many of a capability's real, distinct benchmark identities exist at all — reasoning: 3 (gpqa/hle/mmlu-pro), coding: 2, terminalExecution/instructionFollowing: 1 each. Static reference data (never per-model) — used by /models --evidence to render "X/Y benchmarks" alongside a real model's own count. */
export function activeBenchmarkCountForCapability(capability) {
  return activeBenchmarkIdentities(capability).length;
}

/**
 * How many of this capability's real, distinct benchmark identities this
 * EXACT model has real evidence for — counting identities (AA's "hle" and
 * Hugging Face's "hle" are the SAME real benchmark, counted once), never
 * raw evidence entries or sources. Deliberately independent of whether a
 * comparable cohort formed for ranking (percentileForBenchmark's own,
 * separate concern) — this measures how much of the capability THIS
 * candidate's own evidence actually covers, regardless of who else is in
 * the pool.
 * @param {ReturnType<import("./model-capability-registry.js").createCapabilityRegistry>} registry
 * @param {object} model
 * @param {Capability} capability
 * @returns {number}
 */
export function countModelBenchmarks(registry, model, capability) {
  const id = registry.registerIdentity(model.adapterId, model.modelId, model.displayName ?? null);
  let count = 0;
  for (const identity of activeBenchmarkIdentities(capability)) {
    if (bestAcrossAliases(registry, id, identity)) count += 1;
  }
  return count;
}

// A capability is "comparable" once real, distinct benchmark coverage
// reaches at least half of its real active benchmarks, rounded UP —
// reasoning (3 active) needs 2, coding (2 active) needs 1, and a
// capability with only ever one real known benchmark (terminalExecution,
// instructionFollowing) needs just that one — the 50% floor never
// demands evidence the real catalog structurally can't provide. Below
// that floor, a candidate is "provisional" for the capability: it can
// still be scored and ranked (never excluded outright — a real single
// data point is still real evidence), but never wins outright over a
// real, more broadly comparable candidate — see model-intelligence.js's
// own comparable-before-provisional selection order.
const COMPARABILITY_THRESHOLD_RATIO = 0.5;

/**
 * @param {Capability} capability
 * @param {number} benchmarkCount - this model's own real distinct benchmark count for the capability (see countModelBenchmarks)
 * @returns {boolean}
 */
export function isCapabilityComparable(capability, benchmarkCount) {
  const active = activeBenchmarkCountForCapability(capability);
  if (active === 0) return true; // no known real benchmark for this capability at all — never gate on something unmeasurable
  return benchmarkCount >= Math.ceil(active * COMPARABILITY_THRESHOLD_RATIO);
}

// Metrics where a LOWER value is the better real result. Every metric in
// BENCHMARK_IDENTITIES today is higher-is-better; this stays a real,
// checked table (not a hardcoded assumption baked into the ranking math)
// so a future lower-is-better benchmark is handled correctly without
// silently ranking it backwards.
const LOWER_IS_BETTER_METRICS = new Set();

function modelKey(model) {
  return `${model.adapterId}::${model.modelId}`;
}

function directionFor(metric) {
  return LOWER_IS_BETTER_METRICS.has(metric) ? "lower" : "higher";
}

function convertByScale(scale, value) {
  return scale === "hundred" ? value / 100 : value;
}

/**
 * The single most trustworthy real entry for a model across every metric
 * alias of one benchmark identity — verified first, then most recent,
 * exactly bestEvidence()'s own rule, just applied across aliases instead
 * of a single metric name. This is the dedup step: the same real
 * benchmark reported under two different source-specific key names never
 * produces two competing data points for the same model. Returns the
 * alias's own `scale` alongside the raw entry, for callers that need a
 * real, unit-converted value (the gap calculation) — percentile ranking
 * itself never needs this, since relative order is scale-invariant.
 * @param {ReturnType<import("./model-capability-registry.js").createCapabilityRegistry>} registry
 * @param {string} id
 * @param {{metricAliases: Array<{metric: string, scale: string}>}} identity
 */
function bestAcrossAliases(registry, id, identity) {
  let best = null;
  for (const alias of identity.metricAliases) {
    for (const entry of registry.getEvidence(id, alias.metric)) {
      const isBetter = !best
        || (entry.verified && !best.entry.verified)
        || (entry.verified === best.entry.verified && Date.parse(entry.date ?? "") > Date.parse(best.entry.date ?? ""));
      // The evidence's OWN real scale (set by the ingestion source that
      // actually knows it) always wins over the alias's metric-name-based
      // guess — two sources can share one metric name ("hle") while
      // genuinely reporting in different real scales (AA: 0-1 fraction;
      // Hugging Face: 0-100, verified live — DeepSeek-V4.1-Flash's real
      // HLE via HF is 63.9, not 0.639). The alias scale stays a fallback
      // only for evidence that never declared its own.
      if (isBetter) best = { entry, scale: entry.scale ?? alias.scale };
    }
  }
  return best;
}

/**
 * Percentile rank (0-1) of each real, comparable result for one benchmark
 * identity, among the given candidate models — scale-invariant (only
 * relative order matters, so 0-1 fractions and 0-100 scores from
 * different sources never need unit conversion here). Requires at least
 * two distinct models with a real result for this exact benchmark WHEN
 * other real candidate models exist in the pool but simply lack evidence
 * for this one benchmark (that reduces coverage honestly instead of
 * inventing a comparison with nobody). The one exception: when the ENTIRE
 * candidate pool is a single model (the only accessible real provider —
 * a real, common case, not a data gap), that lone model gets percentile 1
 * for any benchmark it has real evidence for — being the only real
 * option available IS the real, correct result, not a fabricated one.
 * @param {ReturnType<import("./model-capability-registry.js").createCapabilityRegistry>} registry
 * @param {Array<object>} models
 * @param {{metricAliases: Array<{metric: string, scale: string}>}} identity
 * @returns {Map<string, {value: number, verified: boolean}>} modelKey -> percentile + whether the deciding real entry was independently verified
 */
function percentileForBenchmark(registry, models, identity) {
  const direction = directionFor(identity.metricAliases[0].metric);
  const results = [];
  for (const model of models) {
    const id = registry.registerIdentity(model.adapterId, model.modelId, model.displayName ?? null);
    const best = bestAcrossAliases(registry, id, identity);
    // Different models can win bestAcrossAliases via different metric
    // aliases of the SAME real benchmark identity (e.g. one model's best
    // evidence is a 0-1 "unit" alias, another's is a 0-100 "hundred"
    // alias) — comparing their raw entry.value would rank 0.64 below 57.9
    // even though 0.64 (64%) is actually ahead of 57.9/100 (57.9%).
    // Percentile ranking is scale-invariant only WITHIN one common scale,
    // so every result is normalized to the same 0-1 scale before sorting.
    if (best) results.push({ model, entry: best.entry, normalizedValue: convertByScale(best.scale, best.entry.value) });
  }
  if (results.length < 2 && models.length > 1) return new Map();
  if (!results.length) return new Map();

  const sorted = [...results].sort((a, b) => (direction === "higher" ? a.normalizedValue - b.normalizedValue : b.normalizedValue - a.normalizedValue));
  const percentiles = new Map();
  const n = sorted.length;
  sorted.forEach((entry, index) => {
    // Ties share the same percentile (their shared rank position), so a
    // real dead-heat is never arbitrarily broken by array order here —
    // portfolio-level tiebreaks happen later, on the final score.
    let rankIndex = index;
    while (rankIndex > 0 && sorted[rankIndex - 1].normalizedValue === entry.normalizedValue) rankIndex -= 1;
    const percentile = n > 1 ? rankIndex / (n - 1) : 1;
    percentiles.set(modelKey(entry.model), { value: percentile, verified: entry.entry.verified });
  });
  return percentiles;
}

/**
 * @param {number[]} values
 */
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * One capability's real percentile per model: the median across every
 * real benchmark identity in that capability that produced a comparable
 * cohort (see percentileForBenchmark) — median, not mean, so one real
 * outlier benchmark can't swing the capability score on its own. Falls
 * back to AA's own composite index (also percentile-ranked, same
 * scale-invariance) ONLY when NOT ONE component benchmark produced any
 * real cohort anywhere in the pool — never blended alongside real
 * components.
 * @param {ReturnType<import("./model-capability-registry.js").createCapabilityRegistry>} registry
 * @param {Array<object>} models
 * @param {Capability} capability
 * @returns {Map<string, {percentile: number, benchmarkCount: number, verifiedCount: number}>}
 */
export function computeCapabilityPercentile(registry, models, capability) {
  const identities = BENCHMARK_IDENTITIES.filter((identity) => identity.capability === capability);
  const perModel = new Map(models.map((m) => [modelKey(m), { percentiles: [], verifiedCount: 0 }]));
  let anyComponentCohort = false;

  for (const identity of identities) {
    const percentiles = percentileForBenchmark(registry, models, identity);
    if (!percentiles.size) continue;
    anyComponentCohort = true;
    for (const [key, { value, verified }] of percentiles) {
      const bucket = perModel.get(key);
      bucket.percentiles.push(value);
      if (verified) bucket.verifiedCount += 1;
    }
  }

  if (!anyComponentCohort && COMPOSITE_FALLBACKS[capability]) {
    const fallbackIdentity = { metricAliases: [{ metric: COMPOSITE_FALLBACKS[capability], scale: "hundred" }] };
    const percentiles = percentileForBenchmark(registry, models, fallbackIdentity);
    for (const [key, { value, verified }] of percentiles) {
      const bucket = perModel.get(key);
      bucket.percentiles.push(value);
      if (verified) bucket.verifiedCount += 1;
    }
  }

  const result = new Map();
  for (const [key, bucket] of perModel) {
    if (!bucket.percentiles.length) continue; // no real, comparable evidence at all — absent, never zero
    result.set(key, {
      percentile: median(bucket.percentiles),
      benchmarkCount: bucket.percentiles.length,
      verifiedCount: bucket.verifiedCount
    });
  }
  return result;
}

/**
 * One capability's real, scale-normalized magnitude per model — the
 * median of each real benchmark identity's own best real value, converted
 * to a common 0-1 scale via that alias's real `scale`. Unlike
 * computeCapabilityPercentile, this needs no 2-model cohort (it's each
 * model's own real value, not a rank), so it keeps real granularity even
 * for a lone runner-up — exactly what a near-equivalence band or
 * capability floor needs to mean anything with only 2-3 real candidates.
 * Falls back to AA's own composite index under the same real rule as the
 * percentile side: only when NOT ONE component benchmark has any real
 * value anywhere in the pool, never blended alongside real components.
 * @param {ReturnType<import("./model-capability-registry.js").createCapabilityRegistry>} registry
 * @param {Array<object>} models
 * @param {Capability} capability
 * @returns {Map<string, number>} modelKey -> real 0-1 magnitude
 */
export function computeCapabilityGapValue(registry, models, capability) {
  const identities = BENCHMARK_IDENTITIES.filter((identity) => identity.capability === capability);
  const perModel = new Map(models.map((m) => [modelKey(m), []]));
  let anyComponentValue = false;

  for (const identity of identities) {
    for (const model of models) {
      const id = registry.registerIdentity(model.adapterId, model.modelId, model.displayName ?? null);
      const best = bestAcrossAliases(registry, id, identity);
      if (!best) continue;
      anyComponentValue = true;
      perModel.get(modelKey(model)).push(convertByScale(best.scale, best.entry.value));
    }
  }

  if (!anyComponentValue && COMPOSITE_FALLBACKS[capability]) {
    const fallbackIdentity = { metricAliases: [{ metric: COMPOSITE_FALLBACKS[capability], scale: "hundred" }] };
    for (const model of models) {
      const id = registry.registerIdentity(model.adapterId, model.modelId, model.displayName ?? null);
      const best = bestAcrossAliases(registry, id, fallbackIdentity);
      if (best) perModel.get(modelKey(model)).push(convertByScale(best.scale, best.entry.value));
    }
  }

  const result = new Map();
  for (const [key, values] of perModel) {
    if (values.length) result.set(key, median(values));
  }
  return result;
}

/**
 * A role's real, scale-normalized magnitude per model — the median across
 * its relevant capabilities' own real gap values (see
 * computeCapabilityGapValue). This is what model-intelligence.js's
 * NEAR_EQUIVALENCE_BAND and EFFICIENT_CAPABILITY_FLOOR actually compare —
 * never RoleEvaluation.capabilityPercentile, which only encodes rank
 * order and collapses to {0, 0.5, 1} with Kairo's typical small candidate
 * pools.
 * @param {ReturnType<import("./model-capability-registry.js").createCapabilityRegistry>} registry
 * @param {Array<object>} models
 * @param {Capability[]} relevantCapabilities
 * @returns {Map<string, number>} modelKey -> real 0-1 magnitude
 */
export function computeRoleGapValue(registry, models, relevantCapabilities) {
  const perCapability = relevantCapabilities.map((capability) => computeCapabilityGapValue(registry, models, capability));
  const result = new Map();
  for (const model of models) {
    const key = modelKey(model);
    const values = perCapability.map((m) => m.get(key)).filter((v) => v != null);
    if (values.length) result.set(key, median(values));
  }
  return result;
}

/**
 * @typedef {object} RoleEvaluation
 * @property {string} role
 * @property {number} capabilityPercentile - median across the role's relevant capabilities, each already a median across that capability's real benchmarks
 * @property {number} coverage - fraction of the role's relevant capabilities that produced a real score (0-1)
 * @property {"high"|"medium"|"low"} confidence
 * @property {number} benchmarkCount - total real benchmark identities that contributed, across all relevant capabilities
 * @property {Record<string, number>} capabilities - per-capability percentile, only for capabilities with real evidence
 * @property {Record<string, number>} benchmarkCountsByCapability - this model's own real, distinct benchmark-identity count per relevant capability (see countModelBenchmarks) — never a source count (AA HLE + Hugging Face HLE is one benchmark, not two).
 * @property {Record<string, number>} benchmarkCoverage - benchmarkCountsByCapability[capability] / activeBenchmarkCountForCapability(capability), 0-1, per relevant capability.
 * @property {string[]} provisionalCapabilities - relevant capabilities where this model's real coverage falls below the comparability floor (isCapabilityComparable) — empty when every relevant capability clears it.
 * @property {boolean} isProvisional - true whenever provisionalCapabilities is non-empty.
 */

/**
 * Confidence tiers, from real coverage and provenance only — never from
 * the score's magnitude:
 *   high:   >=70% of the role's relevant capabilities scored, AND at
 *           least one contributing benchmark was independently verified.
 *   medium: >=40% coverage, OR at least two distinct real benchmark
 *           identities contributed (even if coverage is thin).
 *   low:    anything short of that.
 * A provisional candidate (real benchmark-identity coverage below the
 * comparability floor for at least one relevant capability — see
 * isCapabilityComparable) can never reach "high", even with a real,
 * independently-verified single data point: one verified benchmark is
 * real evidence, but not YET broad enough evidence to be that confident.
 */
function confidenceFor(coverage, benchmarkCount, verifiedCount, isProvisional = false) {
  if (coverage >= 0.7 && verifiedCount >= 1 && !isProvisional) return "high";
  if (coverage >= 0.4 || benchmarkCount >= 2) return "medium";
  return "low";
}

/**
 * Computes one RoleEvaluation per candidate model for a role defined by
 * its relevant capabilities. A model with zero real evidence across every
 * relevant capability gets no evaluation at all (absent from the
 * returned map) — per explicit rule, it never competes for the role
 * rather than being scored as if it were the weakest real option.
 * @param {ReturnType<import("./model-capability-registry.js").createCapabilityRegistry>} registry
 * @param {Array<object>} models
 * @param {string} role
 * @param {Capability[]} relevantCapabilities
 * @returns {Map<string, RoleEvaluation>}
 */
export function computeRoleEvaluations(registry, models, role, relevantCapabilities) {
  const perCapability = relevantCapabilities.map((capability) => ({
    capability, scores: computeCapabilityPercentile(registry, models, capability)
  }));

  const evaluations = new Map();
  for (const model of models) {
    const key = modelKey(model);
    const capabilities = {};
    let benchmarkCount = 0;
    let verifiedCount = 0;
    for (const { capability, scores } of perCapability) {
      const entry = scores.get(key);
      if (!entry) continue;
      capabilities[capability] = entry.percentile;
      benchmarkCount += entry.benchmarkCount;
      verifiedCount += entry.verifiedCount;
    }
    const scoredCapabilities = Object.keys(capabilities);
    if (!scoredCapabilities.length) continue; // no real primary evidence anywhere — doesn't compete for this role

    // Benchmark-LEVEL coverage per relevant capability — independent of
    // whether a percentile cohort formed (that's a ranking concern; this
    // is "how much of the capability does THIS model's own evidence
    // cover"). Counts real, distinct benchmark identities, never sources.
    const benchmarkCountsByCapability = {};
    const benchmarkCoverage = {};
    const provisionalCapabilities = [];
    for (const capability of Object.keys(capabilities)) {
      const count = countModelBenchmarks(registry, model, capability);
      const active = activeBenchmarkCountForCapability(capability);
      benchmarkCountsByCapability[capability] = count;
      benchmarkCoverage[capability] = active ? count / active : 0;
      // A score of 0 real component-benchmark identities can only mean
      // this capability's real score came entirely from the composite-
      // index fallback (computeCapabilityPercentile's own pool-wide
      // switch) — the best real signal available in that mode, coarse
      // but not partial, so it's never "provisional" for lacking
      // component benchmarks it structurally couldn't have used anyway.
      // Only real, PARTIAL component-benchmark coverage (count > 0, but
      // still below the comparability floor) is provisional.
      if (count > 0 && !isCapabilityComparable(capability, count)) provisionalCapabilities.push(capability);
    }
    const isProvisional = provisionalCapabilities.length > 0;

    const coverage = scoredCapabilities.length / relevantCapabilities.length;
    evaluations.set(key, {
      role,
      capabilityPercentile: median(scoredCapabilities.map((c) => capabilities[c])),
      coverage,
      confidence: confidenceFor(coverage, benchmarkCount, verifiedCount, isProvisional),
      benchmarkCount,
      capabilities,
      benchmarkCountsByCapability, benchmarkCoverage, provisionalCapabilities, isProvisional
    });
  }
  return evaluations;
}

/** Ordinal rank so confidence can be compared/sorted (higher is more confident). */
export const CONFIDENCE_RANK = { high: 2, medium: 1, low: 0 };
