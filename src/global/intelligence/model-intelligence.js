// Cross-references the models Kairo can actually launch right now (each
// provider's real, discovered/documented catalog) with real Artificial
// Analysis benchmark scores — deliberately NOT "download every model AA
// tracks": only the ones we actually have access to matter for routing.
//
// A model with no confident match gets no score, never a guessed one —
// same fail-closed rule as everywhere else in Kairo's routing.

import { bestEvidence, createCapabilityRegistry } from "./model-capability-registry.js";
import { CONFIDENCE_RANK, computeRoleEvaluations, computeRoleGapValue } from "./capability-scoring.js";
import { ROLE_CAPABILITIES, getRoleProfile } from "./role-profiles.js";

// Real per-benchmark metrics worth surfacing as corroborating evidence
// alongside a pick — never blended into the ranking itself, since
// Terminal-Bench/GPQA/HLE aren't the same measurement as AA's
// intelligenceIndex/codingIndex and averaging them would violate the
// registry's own no-blending contract.
const CORROBORATION_METRICS = [
  "terminal-bench", "terminal-bench-science", "gpqa-diamond", "hle", "cursorbench", "kairo.success",
  // AA's own real per-benchmark scores (0-1 scale, as AA reports them) —
  // verified live to already be in the free API response alongside the
  // composite indices, kept distinct from the manufacturer-reported
  // 0-100 scale metrics above.
  "gpqa", "sciCode", "mmluPro", "liveCodeBench", "ifBench", "terminalBenchHard", "terminalBenchV2", "tau2", "tauBanking"
];

/**
 * Attaches real registry evidence (Hugging Face, manufacturer snapshots,
 * Kairo's own telemetry) to a model, purely for transparency — never used
 * to change a ranking value. `registry` is optional; without one, models
 * pass through unchanged (existing callers/tests keep working).
 * @param {object} model - has adapterId/modelId
 * @param {ReturnType<import("./model-capability-registry.js").createCapabilityRegistry>|null} registry
 */
function withCorroboration(model, registry) {
  if (!registry) return model;
  const id = registry.registerIdentity(model.adapterId, model.modelId);
  const corroboration = [];
  for (const metric of CORROBORATION_METRICS) {
    const best = bestEvidence(registry, id, metric);
    if (best) corroboration.push({ metric, value: best.value, source: best.source });
  }
  return corroboration.length ? { ...model, corroboration } : model;
}

/**
 * @param {Array<object>} models - scoreAvailableModels() output
 * @param {ReturnType<import("./model-capability-registry.js").createCapabilityRegistry>|null} [registry]
 */
export function annotateWithRegistryEvidence(models, registry = null) {
  if (!registry) return models;
  return models.map((model) => withCorroboration(model, registry));
}

function normalizeId(id) {
  return String(id ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function sortedTokens(normalizedId) {
  return normalizedId.split("-").filter(Boolean).sort().join("-");
}

/**
 * Finds the Artificial Analysis entry for a real provider model id. Tries
 * an exact normalized match first (e.g. "gpt-6-astra" == "gpt-6-astra"),
 * then a same-tokens match for cases where the two sources order words
 * differently (e.g. Kairo's "claude-haiku-4-5" vs AA's "claude-4-5-haiku").
 * @param {string} modelId
 * @param {Array<{slug: string}>} aaModels
 */
export function matchArtificialAnalysisScore(modelId, aaModels) {
  const normalized = normalizeId(modelId);
  if (!normalized) return null;
  const exact = aaModels.find((model) => normalizeId(model.slug) === normalized);
  if (exact) return exact;
  const tokens = sortedTokens(normalized);
  return aaModels.find((model) => sortedTokens(normalizeId(model.slug)) === tokens) ?? null;
}

/**
 * @param {Array<{adapterId: string, models: Array<{id: string, displayName?: string}>}>} providerCatalogs
 *   - only the models each provider's own real catalog actually reports as
 *   available, e.g. `[{ adapterId: "codex", models: readCodexModels().models }]`
 * @param {Array<object>} aaModels - readArtificialAnalysisModels().models
 * @returns {Array<{adapterId: string, modelId: string, displayName: string|null, slug: string, name: string, intelligenceIndex: number|null, codingIndex: number|null, mathIndex: number|null}>}
 *   Only models Kairo actually has access to AND could confidently match — never a guessed score.
 */
export function scoreAvailableModels(providerCatalogs, aaModels) {
  const results = [];
  for (const { adapterId, models } of providerCatalogs) {
    for (const model of models ?? []) {
      const score = matchArtificialAnalysisScore(model.id, aaModels);
      if (!score) continue;
      results.push({
        adapterId, modelId: model.id, displayName: model.displayName ?? null,
        slug: score.slug, name: score.name,
        intelligenceIndex: score.intelligenceIndex, codingIndex: score.codingIndex, mathIndex: score.mathIndex,
        priceInputPerMTok: score.priceInputPerMTok ?? null, priceOutputPerMTok: score.priceOutputPerMTok ?? null,
        outputTokensPerSecond: score.outputTokensPerSecond ?? null,
        // Real per-benchmark scores AA's free API also returns — used as
        // optional role-specific tie-breakers in AI_TEAM_ROLE_DEFINITIONS,
        // never blended into the composite indices above.
        gpqa: score.gpqa ?? null, hle: score.hle ?? null, sciCode: score.sciCode ?? null,
        mmluPro: score.mmluPro ?? null, liveCodeBench: score.liveCodeBench ?? null, ifBench: score.ifBench ?? null,
        terminalBenchHard: score.terminalBenchHard ?? null, terminalBenchV2: score.terminalBenchV2 ?? null,
        tau2: score.tau2 ?? null, tauBanking: score.tauBanking ?? null
      });
    }
  }
  return annotateBestFit(results);
}

/**
 * How much of each provider's real catalog Kairo could actually match to
 * real Artificial Analysis data — separate from RUNTIME eligibility
 * (checkCandidate's quota/availability check): a provider can be fully
 * entitled and runtime-eligible yet still have unmatched models simply
 * because AA doesn't track them, or Kairo's own catalog is only
 * "documented" rather than a live discovery (Claude, today). Surfaces
 * that distinction so "Fable is the best model available now" is never
 * confused with "Fable is the only model Kairo could ever evaluate."
 * @param {Array<{adapterId: string, catalogStatus: string, models: Array<object|string>}>} providerCatalogs
 * @param {Array<object>} aaModels
 * @returns {Array<{adapterId: string, catalogStatus: string, totalModels: number, matchedModels: number}>}
 */
export function summarizeCatalogCoverage(providerCatalogs, aaModels) {
  return providerCatalogs.map(({ adapterId, catalogStatus, models }) => {
    const list = models ?? [];
    const matched = list.filter((entry) => {
      const id = typeof entry === "string" ? entry : entry.id;
      return matchArtificialAnalysisScore(id, aaModels) != null;
    });
    return { adapterId, catalogStatus, totalModels: list.length, matchedModels: matched.length };
  });
}

// listUnscoredModels used to live here — every real catalog model
// scoreAvailableModels() couldn't match to AA data, kept so /models
// --evidence could show it honestly instead of it just vanishing.
// model-candidate-catalog.js's buildCompleteCandidateCatalog now does
// this same real AA-match check as part of computing every candidate's
// evidenceStatus ("unscored" when unmatched) — a caller filters that
// catalog for evidenceStatus === "unscored" instead of calling a second,
// parallel function that duplicated the exact same real check.

// Which real, unweighted metric each model is best at among the models you
// actually have access to right now — never a blended/invented composite
// score. "better" says which direction wins for that metric (higher coding
// score is better; lower price is better).
const BEST_FIT_METRICS = [
  { key: "codingIndex", label: "best coding", better: "max" },
  { key: "intelligenceIndex", label: "best reasoning", better: "max" },
  { key: "outputTokensPerSecond", label: "fastest", better: "max" },
  { key: "priceInputPerMTok", label: "cheapest", better: "min" }
];

/**
 * @param {Array<object>} models
 * @param {(model: object) => number|null} getValue
 * @param {"max"|"min"} better
 */
function bestIndexForValue(models, getValue, better) {
  let bestIndex = -1;
  let bestValue = null;
  for (let i = 0; i < models.length; i += 1) {
    const value = getValue(models[i]);
    if (value == null) continue;
    const wins = bestValue == null || (better === "max" ? value > bestValue : value < bestValue);
    if (wins) { bestIndex = i; bestValue = value; }
  }
  return bestIndex;
}

function bestIndexFor(models, key, better) {
  return bestIndexForValue(models, (model) => model[key], better);
}

/**
 * The bottleneck (worst-case) of two real metrics — never their average or
 * a weighted blend. Used for roles that plausibly need both signals
 * (Debugger, Reviewer) but have no distinct benchmark of their own: a
 * model is only as good at the composite job as its weaker real skill.
 * Null if either input is missing — never guesses with partial data.
 */
function minOfReal(a, b) {
  return a == null || b == null ? null : Math.min(a, b);
}

/**
 * Tags each model with which real metrics it wins, relative only to the
 * other models actually in this list — a purely relative, computed fact,
 * not a judgment call about which role/persona it "is."
 * @param {Array<object>} models - scoreAvailableModels' output (pre-tagging)
 */
function annotateBestFit(models) {
  const bestFor = models.map(() => []);
  for (const metric of BEST_FIT_METRICS) {
    const bestIndex = bestIndexFor(models, metric.key, metric.better);
    if (bestIndex !== -1) bestFor[bestIndex].push(metric.label);
  }
  return models.map((model, i) => ({ ...model, bestFor: bestFor[i] }));
}

// The seven reusable role profiles, each resolved from real metrics only —
// never a weighted blend, never an invented percentage. Three have a
// direct real benchmark (Architect/Planner, Implementer, Economy); the
// rest are honestly derived:
//   - Explorer: same real signal as Architect/Planner (intelligence) —
//     Kairo has no distinct "exploration" benchmark, so it doesn't
//     pretend otherwise with a different-looking number.
//   - Debugger / Reviewer: the bottleneck (minimum, not an average) of
//     intelligence and coding — a model is only as good at either
//     composite job as its weaker real skill.
//   - Test Author: the same real coding signal as Implementer — there is
//     no distinct testing benchmark in this data either.
// "Orchestrator" is deliberately not a role: it's Kairo itself, never a
// ranked model. "Terminal-required" and "autonomous execution" are real
// gaps (no Agentic Index at this API tier, verified against the live
// response) — logged as future work, not faked with a stand-in metric.
const ROLE_DEFINITIONS = [
  { role: "Explorer", compute: (m) => m.intelligenceIndex, better: "max" },
  { role: "Architect / Planner", compute: (m) => m.intelligenceIndex, better: "max" },
  { role: "Implementer", compute: (m) => m.codingIndex, better: "max" },
  { role: "Debugger", compute: (m) => minOfReal(m.intelligenceIndex, m.codingIndex), better: "max" },
  { role: "Test Author", compute: (m) => m.codingIndex, better: "max" },
  { role: "Reviewer", compute: (m) => minOfReal(m.intelligenceIndex, m.codingIndex), better: "max" },
  { role: "Economy", compute: (m) => m.priceInputPerMTok, better: "min" }
];

/**
 * @param {Array<object>} models - scoreAvailableModels() output
 * @returns {Array<{role: string, adapterId: string, modelId: string, displayName: string|null}>}
 *   One entry per role that has a real winner; a role is simply omitted
 *   when no available model reports the metric(s) it needs.
 */
export function bestModelPerRole(models) {
  const entries = [];
  for (const { role, compute, better } of ROLE_DEFINITIONS) {
    const bestIndex = bestIndexForValue(models, compute, better);
    if (bestIndex === -1) continue;
    const winner = models[bestIndex];
    entries.push({ role, adapterId: winner.adapterId, modelId: winner.modelId, displayName: winner.displayName });
  }
  return entries;
}

// Every metric a role definition might ask for — re-ingested into a
// throwaway registry (see ensureRegistry) when the caller doesn't pass a
// real one, so role compute() functions always have exactly one code path
// (resolve via the registry) regardless of whether richer evidence
// (Hugging Face, manufacturer snapshots, Kairo's own telemetry) is
// actually available for this call.
const KNOWN_MODEL_METRICS = [
  "intelligenceIndex", "codingIndex", "mathIndex", "priceInputPerMTok", "outputTokensPerSecond",
  "gpqa", "hle", "sciCode", "mmluPro", "liveCodeBench", "ifBench", "terminalBenchHard", "terminalBenchV2", "tau2", "tauBanking"
];

/**
 * Guarantees buildAiTeam always has a real registry to resolve role
 * requirements against — a role's compute() must have exactly one code
 * path (resolve via the registry) whether or not the caller supplied one.
 * Always seeds the AA fields already present on `models`
 * (scoreAvailableModels' output) into whichever registry ends up in
 * use — a fresh throwaway one when none is given, or the caller's own
 * real registry (service.js, wired to AA + Hugging Face + manufacturer
 * snapshots + Kairo's own telemetry) otherwise. This has to seed the
 * caller's registry too, not just the throwaway one: the robust
 * multi-metric engine (capability-scoring.js) resolves every role
 * purely through registry evidence, with no fallback to the raw
 * `model[metric]` field the old single-metric `resolveMetric` used —
 * so a real registry that hasn't separately ingested AA's
 * intelligenceIndex/codingIndex would otherwise silently lose that
 * evidence entirely. Never overwrites evidence the registry already
 * has for a given identity/metric pair.
 */
function ensureRegistry(models, registry) {
  const effective = registry ?? createCapabilityRegistry();
  for (const model of models) {
    const id = effective.registerIdentity(model.adapterId, model.modelId, model.displayName ?? null);
    const existingMetrics = new Set(effective.getEvidence(id).map((entry) => entry.metric));
    for (const metric of KNOWN_MODEL_METRICS) {
      const value = model[metric];
      if (value == null || existingMetrics.has(metric)) continue;
      effective.addEvidence(id, { metric, value, source: "artificial-analysis-free", benchmarkVersion: null, modelConfig: null, date: null, verified: false });
    }
  }
  return effective;
}

/**
 * Resolves one real metric for a model through the evidence registry
 * first (bestEvidence already prefers verified/most-recent across every
 * connected source — AA, Hugging Face, manufacturer snapshots, Kairo's
 * own telemetry), falling back to the field already on `model` only if
 * the registry somehow has nothing for it. This is what actually
 * "connects the registry to each role's requirements" instead of only
 * ever reading the one AA field baked onto the model object.
 *
 * Only safe for metrics with ONE real name across every source (today:
 * intelligenceIndex, codingIndex, priceInputPerMTok — nothing else calls
 * them anything different yet). A metric multiple sources name
 * differently (GPQA as AA's "gpqa" vs a manufacturer table's
 * "gpqa-diamond") is instead resolved through the robust multi-metric
 * percentile engine (capability-scoring.js's BENCHMARK_IDENTITIES) —
 * looking up one exact key here would silently miss every other source's
 * real evidence for the same real thing.
 */
function resolveMetric(registry, model, key) {
  const id = registry.registerIdentity(model.adapterId, model.modelId, model.displayName ?? null);
  const best = bestEvidence(registry, id, key);
  return best ? best.value : (model[key] ?? null);
}

// ROLE_CAPABILITIES's canonical home is role-profiles.js — it's the
// capabilities half of that module's RoleProfile (objective, allowed
// actions, risk, escalation — the OTHER half — live there too), imported
// above and re-exported here only so every existing caller of
// model-intelligence.js keeps working unchanged. Never edit the table
// itself here; see role-profiles.js for the real definition and its full
// reasoning (required-vs-optional split, softwareExecution/
// instructionFollowing measurements, etc.).
export { ROLE_CAPABILITIES };

/**
 * Normalizes a role's capability requirement — either the legacy plain
 * array shape (every entry required; still used by
 * conversation/project-strategy.js's project-derived roleCapabilities,
 * which analyzes a real project and doesn't yet distinguish required from
 * optional) or the {required, optional} shape above.
 */
function normalizeRoleCapabilities(capabilities) {
  if (Array.isArray(capabilities)) return { required: capabilities, optional: [] };
  return { required: capabilities.required ?? [], optional: capabilities.optional ?? [] };
}

/**
 * Builds one role definition per team-vocabulary role (Explorer /
 * Architect / Builder / Debugger / Tester / Reviewer — the same six
 * RoleProfile owns, see role-profiles.js), scored via the robust
 * multi-metric percentile engine (capability-scoring.js). `compute()`
 * per role is a real, precomputed RoleEvaluation.capabilityPercentile
 * lookup (never recomputed per model — percentile is inherently relative
 * to the WHOLE candidate pool, so it's computed once per role, batched,
 * then looked up), and a model absent from that role's evaluations (zero
 * real primary evidence for any of its relevant capabilities) never
 * competes — same fail-closed contract `resolveMetric`-based compute()
 * functions already had. Built fresh per buildAiTeam()/
 * buildEfficientTeam() call (registry AND models differ per call).
 *
 * Economy is NOT one of these role definitions — it used to be a 7th
 * role competing for its own slot here (ranked purely by real price,
 * capability-floor-gated), but per the "PROJECT TEAM primero" plan it's
 * an EXECUTION POLICY any of the six real roles can run under (cheapest
 * real model that still clears that role's own requiredRoleFit),
 * evaluated at task-routing time, never a 7th competitor in QUALITY
 * TEAM/EFFICIENT TEAM's own rankings. Wiring that policy into real
 * routing is a later increment; this function no longer knows Economy
 * exists at all.
 * @param {ReturnType<import("./model-capability-registry.js").createCapabilityRegistry>} registry
 * @param {Array<object>} models
 * @param {Record<string, string[]|{required: string[], optional?: string[]}>} [roleCapabilities] -
 *   which real capabilities each role needs, defaulting to the generic
 *   global table above ({required, optional} — see normalizeRoleCapabilities
 *   for what that distinction gates). A caller building a PROJECT-specific
 *   team (see conversation/project-strategy.js) passes the project's own
 *   real, detected roleRequirements here instead, as a plain array (legacy
 *   shape — every entry treated as required) — e.g. a project with no real
 *   test command drops terminalExecution from Tester/Debugger's real
 *   requirement entirely, which can genuinely change which model wins
 *   that role, not just whether the role is active at all.
 * @returns {{roleDefinitions: Array<{role: string, compute: (model: object) => number|null, better: string}>, evaluationsByRole: Record<string, Map<string, import("./capability-scoring.js").RoleEvaluation>>, optionalEvaluationsByRole: Record<string, Map<string, import("./capability-scoring.js").RoleEvaluation>>, gapValueByRole: Record<string, Map<string, number>>}}
 */
function buildAiTeamRoleDefinitions(registry, models, roleCapabilities = ROLE_CAPABILITIES) {
  const evaluationsByRole = {};
  const optionalEvaluationsByRole = {};
  const gapValueByRole = {};
  const roleDefinitions = [];
  for (const [role, rawCapabilities] of Object.entries(roleCapabilities)) {
    const { required, optional } = normalizeRoleCapabilities(rawCapabilities);
    // requiredRoleFit: capabilityPercentile computed ONLY from `required`
    // — this is the number that decides both ranking ORDER (compute()
    // below) and, via gapValueByRole, how CLOSE two real picks are for
    // near-equivalence-band purposes. optional capabilities never enter
    // either computation, so they can't smooth over a real required-
    // capability gap the way folding them into one shared median used to.
    const evaluations = computeRoleEvaluations(registry, models, role, required);
    evaluationsByRole[role] = evaluations;
    // Real, scale-normalized magnitude per model — NOT the percentile
    // above. capabilityPercentile decides ORDER (robust, scale-invariant
    // rank position); this decides HOW CLOSE two real picks are for
    // near-equivalence-band/capability-floor purposes, which need real
    // granularity that percentile alone can't provide with Kairo's
    // typical 2-3-candidate pools (see capability-scoring.js). Same
    // required-only capability list as evaluations above — order and
    // closeness must agree on what "the role" actually means.
    gapValueByRole[role] = computeRoleGapValue(registry, models, required);
    // optionalRoleFit: a completely separate RoleEvaluation, scored only
    // from `optional` capabilities. Never touches ranking order or
    // gapValue — used purely as a tiebreak (sortByCapabilityPriority)
    // among candidates already equally fit on required capabilities. A
    // role with no optional capabilities (Tester, Reviewer) gets an empty
    // map, never a crash — the tiebreak below treats a missing entry as
    // "no optional signal for this model", which ranks equal to every
    // other model with no entry (see sortByCapabilityPriority).
    optionalEvaluationsByRole[role] = optional.length ? computeRoleEvaluations(registry, models, role, optional) : new Map();
    roleDefinitions.push({
      role, better: "max",
      // A model with real evidence on every REQUIRED capability competes
      // on its real requiredRoleFit (capabilityPercentile/gapValue).
      // Missing even one required capability's evidence excludes it from
      // the ranking entirely (null, filtered out by rankBy/rankEligible's
      // existing `.filter((entry) => entry.value != null)`) — coverage
      // stops being merely informational and becomes a real gate, so a
      // model that "looks near-equivalent" on partial evidence can never
      // quietly outrank a properly-measured generalist. Optional evidence
      // never appears here at all — see optionalEvaluationsByRole above.
      compute: (m) => {
        const evaluation = evaluations.get(modelKey(m));
        if (!evaluation) return null;
        if (required.some((capability) => evaluation.capabilities[capability] == null)) return null;
        return evaluation.capabilityPercentile;
      }
    });
  }
  return { roleDefinitions, evaluationsByRole, optionalEvaluationsByRole, gapValueByRole };
}

// modelName/candidateKey/accessMode/evidenceStatus/lineageKey/generation/
// lifecycle/resourceCost are real fields from a Recommendation Pool
// candidate (model-candidate-catalog.js) — passed through when present,
// never fabricated. A caller still passing raw scoreAvailableModels()
// output (no candidate-catalog join) simply gets null for all of them;
// this file never imports model-candidate-catalog.js itself, it just
// forwards whatever real identity fields the input model already
// carries, keeping the dependency one-directional.
function toTeamModel(model, available, registry = null) {
  const base = {
    adapterId: model.adapterId, modelId: model.modelId, displayName: model.displayName, available,
    modelName: model.modelName ?? null, candidateKey: model.candidateKey ?? null,
    accessMode: model.accessMode ?? null, evidenceStatus: model.evidenceStatus ?? null,
    lineageKey: model.lineageKey ?? null, generation: model.generation ?? null, lifecycle: model.lifecycle ?? null,
    resourceCost: model.resourceCost ?? null
  };
  return withCorroboration(base, registry);
}

function rankBy(models, compute, better) {
  return models
    .map((model) => ({ model, value: compute(model) }))
    .filter((entry) => entry.value != null)
    .sort((a, b) => (better === "max" ? b.value - a.value : a.value - b.value));
}

function rankEligible(models, eligibility, compute, better) {
  return rankBy(models.filter((m) => eligibility[m.adapterId]?.ok === true), compute, better);
}

/**
 * Comparable-before-provisional: real, distinct-benchmark coverage (see
 * capability-scoring.js's isCapabilityComparable/RoleEvaluation.isProvisional)
 * decides who's even allowed to compete BEFORE capability value does.
 * "Provisional" means real evidence, just too thin on at least one
 * required capability (e.g. one benchmark out of reasoning's three real
 * active ones) to be genuinely comparable to a broadly-measured
 * candidate — never excluded outright (a real, if thin, data point beats
 * guessing), just never preferred. Filters `ranked` down to only
 * comparable candidates whenever at least one exists; if EVERY real
 * candidate is provisional, the full (all-provisional) list is kept as a
 * real fallback — `usedProvisionalFallback` tells the caller this
 * happened, so the eventual pick can be given an honest reason instead
 * of looking like an ordinary capability win.
 * @param {Array<{model: object, value: number}>} ranked
 * @param {Map<string, import("./capability-scoring.js").RoleEvaluation>|undefined} roleEvaluations
 * @returns {{pool: Array<{model: object, value: number}>, usedProvisionalFallback: boolean}}
 */
function preferComparableCandidates(ranked, roleEvaluations) {
  if (!roleEvaluations || !ranked.length) return { pool: ranked, usedProvisionalFallback: false };
  const comparable = ranked.filter((entry) => !roleEvaluations.get(modelKey(entry.model))?.isProvisional);
  if (comparable.length) return { pool: comparable, usedProvisionalFallback: false };
  return { pool: ranked, usedProvisionalFallback: true };
}

/**
 * Attaches each ranked entry's REAL, scale-normalized gap value (see
 * capability-scoring.js's computeRoleGapValue) — a separate number from
 * `.value` (the percentile compute() already produced), used only for
 * near-equivalence-band/capability-floor magnitude comparisons (see
 * capabilityPool/adequateCandidates/leaderAdvantage). `gapValueByModel`
 * being undefined leaves entries unchanged — defensive, no current
 * caller passes one without it.
 */
function attachGapValues(ranked, gapValueByModel) {
  if (!gapValueByModel) return ranked;
  return ranked.map((entry) => ({ ...entry, gapValue: gapValueByModel.get(modelKey(entry.model)) ?? null }));
}


// Per-role near-equivalence tolerance — replaces the single flat 8% band
// this codebase used before. Per explicit decision: capability alone
// isn't the only thing that matters — a model being capable of everything
// doesn't mean it should always be the one doing it, especially when a
// real, meaningfully cheaper alternative is genuinely close enough — but
// how close is "close enough" is NOT the same question for every role.
// Architect decides the whole plan every other role executes against —
// a real requiredRoleFit gap there compounds across the entire team, so
// its tolerance is the tightest. Debugger/Reviewer sit right behind it —
// Debugger needs real reasoning under a live failure, Reviewer is the
// team's only independent check on Builder's own work. Builder/Explorer/
// Tester tolerate more: Builder's real output is still checked by
// Reviewer, Explorer/Tester's mistakes are cheap to catch and retry.
// Two real data points anchored the old flat 8%: Claude Fable 5.1 vs
// OpenCode Go's Kimi K3 sit ~6.6% apart on codingIndex (real GPQA scores
// within 0.2 points of each other) at roughly a third of the price, while
// Fable 5.1 vs Codex GPT-5.6 Sol on coding sit ~5.2% apart with no price
// advantage. Those numbers describe Builder-tier closeness, not
// Architect-tier — kept as this file's Builder/Explorer/Tester tier
// value; Architect/Debugger/Reviewer are deliberately tighter than either
// anchor point. Re-verify against real registry data before changing any
// of these, never assume a ratio holds indefinitely (see this table's own
// review date).
const ROLE_NEAR_EQUIVALENCE_BAND = {
  Architect: 0.03,
  Debugger: 0.05,
  Reviewer: 0.05,
  Builder: 0.06,
  Explorer: 0.06,
  Tester: 0.06
};
const DEFAULT_NEAR_EQUIVALENCE_BAND = 0.06;

/** The real near-equivalence tolerance for a role — see ROLE_NEAR_EQUIVALENCE_BAND's own doc for why this isn't one flat number. A role missing from the table (e.g. a future addition) falls back to the Builder-tier default rather than crashing. */
function nearEquivalenceBandFor(role) {
  return ROLE_NEAR_EQUIVALENCE_BAND[role] ?? DEFAULT_NEAR_EQUIVALENCE_BAND;
}

// Portfolio-level concentration limits — applied to BOTH teams while
// assigning roles, not just a per-role decision. Six independent
// per-role winners don't form a team: without these, the same one or two
// real models/providers can end up covering every technical role, which
// is a monoculture risk (a single outage or rate-limit takes out the
// whole portfolio) even when each individual pick was locally correct.
const MAX_ROLES_PER_MODEL = 2;
const MAX_TECHNICAL_ROLES_PER_PROVIDER = 3;
const TECHNICAL_ROLES = ["Explorer", "Architect", "Builder", "Debugger", "Tester", "Reviewer"];

function modelKey(model) {
  return `${model.adapterId}::${model.modelId}`;
}

// Real, enumerable reasoning-effort/execution-mode tokens providers append
// to a model id (low/medium/high/xhigh/max/none/fast/thinking) — not part
// of the model's real identity, just how hard/fast it's asked to think.
// Confirmed empirically against Cursor's real ~220-model catalog (a single
// provider surfacing the same underlying model — e.g. Claude Opus 5 or
// Claude Fable 5.1 — under many ids like "claude-opus-5-low",
// "claude-opus-5-thinking-high", etc.) that MAX_ROLES_PER_MODEL's identity
// key (modelKey, exact adapterId::modelId) does NOT recognize these as the
// same underlying model, so two different reasoning-tier variants of the
// identical model could each separately reach the per-model role cap —
// real evasion of a real limit, verified by reading passesConcentration's
// own modelKey usage, not assumed.
//
// This does NOT mean AA scores them identically — live-tested against
// real Artificial Analysis data, each reasoning-tier variant matches its
// OWN distinct real AA benchmark entry (AA genuinely measures different
// effort settings separately), so RANKING must keep using the exact
// modelKey (capability evaluation, gapValue, confidence — all still keyed
// by modelKey below). Only CONCENTRATION/diversity accounting should
// collapse same-family variants — that's what familyKey is for, used
// exclusively in passesConcentration, the modelUsage tracking Map, and
// the diversity tiebreak in both team-builders' sort functions.
//
// Family grouping is also deliberately cross-adapter (no adapterId in the
// key): the same real model reachable via two access paths (e.g. Claude
// Fable 5.1 through the Claude subscription and through Cursor) is still
// one real model for concentration purposes — per-adapter monoculture
// risk is already covered separately by MAX_TECHNICAL_ROLES_PER_PROVIDER,
// which stays keyed by adapterId alone, unaffected by this change.
//
// The whitelist is intentionally narrow and never strips a token outside
// it — "mini"/"nano"/"sol"/"luna"/"terra"/"astra" etc. are real, distinct
// models or product lines, not effort settings, and must never be
// collapsed into the same family.
const CONCENTRATION_SUFFIX_TOKENS = new Set(["low", "medium", "high", "xhigh", "max", "none", "fast", "thinking"]);

function canonicalModelFamily(modelId) {
  const tokens = String(modelId ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").filter(Boolean);
  while (tokens.length > 1 && CONCENTRATION_SUFFIX_TOKENS.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join("-");
}

function familyKey(model) {
  return canonicalModelFamily(model.modelId);
}

/**
 * The real capability leader's advantage over the rest of a pool, as a
 * fraction of its own REAL, scale-normalized gap value (see
 * capability-scoring.js's computeRoleGapValue — never the rank-only
 * capabilityPercentile, which is scale-invariant by construction and
 * would report every non-leader as "100% behind" with Kairo's typical
 * 2-3-candidate pools). A single-candidate pool is trivially decisive
 * (Infinity): there is nothing to concentrate away from. A leader with no
 * real gap value at all is likewise treated as trivially decisive —
 * there's no real magnitude to compare.
 */
function leaderAdvantage(pool, better) {
  if (pool.length < 2) return Infinity;
  const leader = pool[0];
  if (leader.gapValue == null) return Infinity;
  const scale = Math.abs(leader.gapValue) || 1;
  let minDiff = Infinity;
  for (let i = 1; i < pool.length; i += 1) {
    if (pool[i].gapValue == null) continue;
    const diff = better === "max" ? leader.gapValue - pool[i].gapValue : pool[i].gapValue - leader.gapValue;
    minDiff = Math.min(minDiff, diff / scale);
  }
  return minDiff;
}

/** A real decisive real-capability advantage (see ROLE_NEAR_EQUIVALENCE_BAND) is allowed to break the portfolio's concentration limits — a model that dramatically outclasses every other real candidate for a role should never be sacrificed just to spread load. */
function isDecisiveLeader(pool, better, role) {
  return leaderAdvantage(pool, better) > nearEquivalenceBandFor(role);
}

/**
 * Orders roles for coordinated assignment: fewer real alternatives first,
 * so the most-constrained roles claim their pick before a more flexible
 * role could have taken it instead. Builder is always resolved before
 * Reviewer, regardless of pool-size ordering, since Reviewer's
 * independence constraint depends on knowing Builder's chosen provider.
 */
function orderRolesForAssignment(rolePools) {
  const ordered = [...rolePools].sort((a, b) => a.pool.length - b.pool.length);
  const reviewerIndex = ordered.findIndex((r) => r.role === "Reviewer");
  const builderIndex = ordered.findIndex((r) => r.role === "Builder");
  if (reviewerIndex !== -1 && builderIndex !== -1 && reviewerIndex < builderIndex) {
    const [reviewerEntry] = ordered.splice(reviewerIndex, 1);
    ordered.push(reviewerEntry);
  }
  return ordered.map((r) => r.role);
}

/**
 * Stage 2 of buildAiTeam's per-role search: only reached when the narrow
 * near-equivalence band (Stage 1) has NO real candidate that respects the
 * portfolio's concentration limits. Before repeating the leader or
 * invoking decisive-override, search the role's FULL real eligible pool
 * (`fullRanked` — every candidate with real required-capability evidence,
 * not just the ones inside the tight band) for a genuinely adequate real
 * alternative: real requiredRoleFit gapValue still >= EFFICIENT_CAPABILITY_FLOOR
 * (0.80) of the leader's own — the SAME real floor EFFICIENT TEAM already
 * uses to mean "not near-identical, but still genuinely good enough",
 * reused here rather than inventing a second threshold — AND respects
 * concentration itself. Capability-mode only: EFFICIENT already builds
 * its pool this wide from the very first stage (see buildEfficientTeam's
 * own `adequateCandidates` call), so it never needs this widening and
 * never reaches this function (guarded by the `mode === "capability"`
 * check at both call sites below).
 */
function findWiderAlternative({ fullRanked, leader, better, role, modelUsage, providerTechnicalUsage, reviewerBuilderAdapter, sortWithinAllowed }) {
  if (!fullRanked) return null;
  const wide = adequateCandidates(fullRanked, leader, better, EFFICIENT_CAPABILITY_FLOOR)
    .filter((candidate) => passesConcentration(candidate, role, modelUsage, providerTechnicalUsage, reviewerBuilderAdapter));
  if (!wide.length) return null;
  const chosen = sortWithinAllowed(wide)[0];
  return { entry: chosen, reasonKind: "wider-search-diversity" };
}

/**
 * Assigns one role's real winner under the portfolio's concentration
 * limits. Never a benchmark or an invented diversity score — diversity is
 * purely a hard constraint on an already-adequate real candidate pool,
 * applied in this order:
 *   1. Among the narrow near-equivalence band (`pool`), any real
 *      candidate that keeps every concentration limit intact competes;
 *      `sortWithinAllowed` picks among those (each team's own real
 *      priority order — see buildAiTeam/buildEfficientTeam). This is the
 *      common case — most roles have a clear leader with no real
 *      near-equivalent competitor at all.
 *   2. If NO candidate in that narrow band respects every limit
 *      (capability mode only — see findWiderAlternative), widen the
 *      search to the role's FULL real eligible pool at
 *      EFFICIENT_CAPABILITY_FLOOR (0.80) — genuinely adequate, even if
 *      not near-equivalent — and use the best real, concentration-safe
 *      candidate there instead. A portfolio limit must never force an
 *      incapable model in, or silently exceed itself, while a real
 *      80%+-adequate alternative sits unexamined outside the tight band.
 *   3. If even THAT wide floor-filtered pool has no real,
 *      concentration-safe candidate, a decisive real leader (see
 *      isDecisiveLeader) is kept anyway rather than handing the role to a
 *      real-but-meaningfully-worse candidate from the narrow band.
 *   4. Absolute last resort — nothing anywhere clears the floor and
 *      respects concentration, and the leader isn't decisively ahead of
 *      the narrow band either: the real leader is repeated anyway. A
 *      portfolio constraint must never force an incapable model in just
 *      to satisfy diversity for its own sake.
 * @param {object} params
 * @param {string} params.role
 * @param {Array<{model: object, value: number}>} params.pool - already
 *   filtered to this role's near-equivalence band (capability mode) or
 *   capability-floor pool (efficient mode, already this wide — see
 *   buildEfficientTeam).
 * @param {Array<{model: object, value: number}>|undefined} params.fullRanked -
 *   the role's FULL real eligible ranking (every candidate with required-
 *   capability evidence), used only by Stage 2's widened search.
 *   Capability mode only; efficient mode never reads this.
 * @param {"max"|"min"} params.better
 * @param {Map<string, number>} params.modelUsage
 * @param {Map<string, number>} params.providerTechnicalUsage
 * @param {string|null} params.reviewerBuilderAdapter - Builder's chosen
 *   adapterId, only when assigning Reviewer; null otherwise.
 * @param {(candidates: Array<{model: object, value: number}>) => Array<{model: object, value: number}>} params.sortWithinAllowed
 * @param {"capability"|"efficient"} params.mode
 * @returns {{entry: {model: object, value: number}, reasonKind: string|null}|null}
 */
function assignOneRole({ role, pool, fullRanked, better, modelUsage, providerTechnicalUsage, reviewerBuilderAdapter, sortWithinAllowed, mode }) {
  if (!pool.length) return null;
  const leader = pool[0];
  const widen = () => (mode === "capability"
    ? findWiderAlternative({ fullRanked, leader, better, role, modelUsage, providerTechnicalUsage, reviewerBuilderAdapter, sortWithinAllowed })
    : null);

  if (pool.length === 1) {
    const passes = passesConcentration(leader, role, modelUsage, providerTechnicalUsage, reviewerBuilderAdapter);
    if (passes) {
      // capability mode: a lone real winner needs no explanation — this is
      // the common case (most roles have a clear leader well outside their
      // own, much narrower per-role band). efficient mode: a lone adequate
      // candidate means nothing smaller cleared the capability floor —
      // worth saying.
      return { entry: leader, reasonKind: mode === "efficient" ? "only-adequate-floor" : null };
    }
    const wide = widen();
    if (wide) return wide;
    if (mode === "capability" && isDecisiveLeader(pool, better, role)) return { entry: leader, reasonKind: "decisive-override" };
    return { entry: leader, reasonKind: "only-adequate-concentration" };
  }

  const allowed = pool.filter((candidate) => passesConcentration(candidate, role, modelUsage, providerTechnicalUsage, reviewerBuilderAdapter));
  if (allowed.length) {
    // The real capability leader doesn't even hit a concentration limit
    // here (or a real near-equivalent alternative already does) — let the
    // narrow band compete normally (CAPABILITY's own diversity priority,
    // or EFFICIENT's real cost/duration/price/throughput chain), with no
    // need to widen the search at all.
    const chosen = sortWithinAllowed(allowed)[0];
    return { entry: chosen, reasonKind: chosen === leader ? null : "diversity" };
  }

  const wide = widen();
  if (wide) return wide;
  if (mode === "capability" && isDecisiveLeader(pool, better, role)) {
    // The leader IS blocked by concentration, and even the wide,
    // floor-filtered search (Stage 2) found no real concentration-safe
    // alternative — but its real capability advantage over the narrow
    // band is decisive (> this role's own near-equivalence band, see
    // ROLE_NEAR_EQUIVALENCE_BAND), so it's kept over handing the role to
    // a real-but-meaningfully-worse narrow-band candidate.
    return { entry: leader, reasonKind: "decisive-override" };
  }
  return { entry: leader, reasonKind: "only-adequate-concentration" };
}

function passesConcentration(candidate, role, modelUsage, providerTechnicalUsage, reviewerBuilderAdapter) {
  const key = familyKey(candidate.model);
  if ((modelUsage.get(key) ?? 0) >= MAX_ROLES_PER_MODEL) return false;
  if (TECHNICAL_ROLES.includes(role) && (providerTechnicalUsage.get(candidate.model.adapterId) ?? 0) >= MAX_TECHNICAL_ROLES_PER_PROVIDER) return false;
  if (role === "Reviewer" && reviewerBuilderAdapter != null && candidate.model.adapterId === reviewerBuilderAdapter) return false;
  return true;
}

/**
 * Runs the coordinated portfolio assignment across every role's pool,
 * tracking model/provider usage as it goes so later roles see the real
 * concentration state left by earlier ones. Shared by buildAiTeam and
 * buildEfficientTeam — they differ only in how each role's pool is built
 * and how candidates are ordered within it (`makeSorter`).
 * @param {Array<{role: string, better: string, pool: Array<{model: object, value: number}>, fullRanked?: Array<{model: object, value: number}>}>} rolePools -
 *   `fullRanked` (buildAiTeam only — see assignOneRole's Stage 2) is the
 *   role's full real eligible ranking, used only when `pool` (the narrow
 *   near-equivalence band) has no concentration-safe candidate.
 * @param {(role: string, modelUsage: Map<string, number>, providerTechnicalUsage: Map<string, number>) => (candidates: Array<{model: object, value: number}>) => Array<{model: object, value: number}>} makeSorter -
 *   receives the SAME live Map instances this function mutates as it
 *   assigns roles, so a role's sort always sees the real concentration
 *   state left by every role assigned before it.
 * @param {"capability"|"efficient"} mode
 */
function assignCoordinatedTeam(rolePools, makeSorter, mode) {
  const order = orderRolesForAssignment(rolePools);
  const modelUsage = new Map();
  const providerTechnicalUsage = new Map();
  const results = {};
  let builderAdapter = null;

  for (const role of order) {
    const { better, pool, fullRanked } = rolePools.find((r) => r.role === role);
    // Snapshot the concentration state as it stood BEFORE this role was
    // assigned — describeEfficiencyChoice must explain a decision using
    // the state that was actually true when it was made, never the
    // portfolio's final state after every later role has also been
    // assigned (which would misattribute a plain capability/price/etc.
    // pick made before any concentration existed as if it had been a
    // deliberate concentration-avoidance move).
    const modelUsageSnapshot = new Map(modelUsage);
    const providerUsageSnapshot = new Map(providerTechnicalUsage);
    const result = assignOneRole({
      role, pool, fullRanked, better, modelUsage, providerTechnicalUsage,
      reviewerBuilderAdapter: role === "Reviewer" ? builderAdapter : null,
      sortWithinAllowed: makeSorter(role, modelUsage, providerTechnicalUsage), mode
    });
    if (result) {
      result.modelUsageSnapshot = modelUsageSnapshot;
      result.providerUsageSnapshot = providerUsageSnapshot;
      const key = familyKey(result.entry.model);
      modelUsage.set(key, (modelUsage.get(key) ?? 0) + 1);
      providerTechnicalUsage.set(result.entry.model.adapterId, (providerTechnicalUsage.get(result.entry.model.adapterId) ?? 0) + 1);
      if (role === "Builder") builderAdapter = result.entry.model.adapterId;
    }
    results[role] = result;
  }
  return { results, modelUsage, providerTechnicalUsage };
}

/**
 * The real near-equivalence pool for a role: the percentile-ranked leader
 * (`ranked[0]` — order comes from requiredRoleFit/capabilityPercentile)
 * plus every other candidate within that role's own near-equivalence band
 * (see ROLE_NEAR_EQUIVALENCE_BAND) of the leader's REAL, scale-normalized
 * gap value (never the percentile itself — see leaderAdvantage's own
 * comment). A candidate with no real gap value at all can't be honestly
 * compared, so it's excluded from the pool rather than guessed into or
 * out of it.
 */
function capabilityPool(ranked, better, role) {
  if (!ranked.length) return [];
  const leader = ranked[0];
  if (leader.gapValue == null) return [leader];
  const scale = Math.abs(leader.gapValue) || 1;
  const band = nearEquivalenceBandFor(role);
  return ranked.filter((entry) => entry.gapValue != null && Math.abs(leader.gapValue - entry.gapValue) / scale <= band);
}

/**
 * CAPABILITY priority: real requiredRoleFit value first, then — for a
 * real exact tie — which real pick has more trustworthy evidence behind
 * it (RoleEvaluation.confidence: high beats medium beats low, never the
 * score's own magnitude), then optionalRoleFit (a real pick with real
 * evidence on the role's optional capabilities — e.g. instructionFollowing
 * — beats one with none, purely as a tiebreak; never moves a model that's
 * behind on required capabilities ahead of one that's tied or ahead —
 * this only fires when `.value` is already an exact tie), then portfolio
 * diversity (least-used model, then least-used provider), then a stable
 * tiebreak.
 * `getConfidenceRank`/`getOptionalFitRank` default to "always tied" for
 * callers with no such signal (e.g. none was computed for this role).
 */
function sortByCapabilityPriority(candidates, better, modelUsage, providerTechnicalUsage, getConfidenceRank = () => 0, getOptionalFitRank = () => 0) {
  return [...candidates].sort((a, b) => {
    if (a.value !== b.value) return better === "max" ? b.value - a.value : a.value - b.value;
    const aConfidence = getConfidenceRank(a.model);
    const bConfidence = getConfidenceRank(b.model);
    if (aConfidence !== bConfidence) return bConfidence - aConfidence; // higher confidence wins
    const aOptionalFit = getOptionalFitRank(a.model);
    const bOptionalFit = getOptionalFitRank(b.model);
    if (aOptionalFit !== bOptionalFit) return bOptionalFit - aOptionalFit; // higher optionalRoleFit wins
    const aModelUsage = modelUsage.get(familyKey(a.model)) ?? 0;
    const bModelUsage = modelUsage.get(familyKey(b.model)) ?? 0;
    if (aModelUsage !== bModelUsage) return aModelUsage - bModelUsage;
    const aProviderUsage = providerTechnicalUsage.get(a.model.adapterId) ?? 0;
    const bProviderUsage = providerTechnicalUsage.get(b.model.adapterId) ?? 0;
    if (aProviderUsage !== bProviderUsage) return aProviderUsage - bProviderUsage;
    const adapterCompare = a.model.adapterId.localeCompare(b.model.adapterId);
    return adapterCompare !== 0 ? adapterCompare : a.model.modelId.localeCompare(b.model.modelId);
  });
}

/**
 * BEST FIT GLOBAL: el ganador de capability real por rol, sin ninguna
 * coordinación de portafolio — nunca cede un rol a otro modelo por límite
 * de familia, distribución por proveedor, o independencia Builder/
 * Reviewer. Ese tipo de coordinación existe para PROJECT TEAM (buildAiTeam),
 * un equipo real que se va a ejecutar en conjunto; esta función responde
 * una pregunta distinta — "¿cuál es honestamente el mejor modelo para
 * este rol, sin nada más en juego?" — así que Muse Spark nunca gana
 * Architect aquí solo porque Astra ya esté "usado" en otro rol.
 *
 * Usa el mismo sistema de roles que buildAiTeam/buildEfficientTeam
 * (buildAiTeamRoleDefinitions/ROLE_CAPABILITIES) — no el bestModelPerRole
 * legado (ROLE_DEFINITIONS, con "Test Author" en vez de "Tester") — para
 * que BEST FIT GLOBAL, EFFICIENT GLOBAL y PROJECT TEAM compartan
 * exactamente el mismo conjunto de roles.
 * @param {Array<object>} models - scoreAvailableModels() output
 * @param {Record<string, {ok: boolean, reason?: string}>} [eligibility]
 * @param {ReturnType<import("./model-capability-registry.js").createCapabilityRegistry>|null} [registry]
 * @param {Record<string, string[]>} [roleCapabilities]
 * @returns {Array<{role: string, primary: object, fallback: object|null, reason: string|null}>}
 */
export function bestModelPerRoleGlobal(models, eligibility = {}, registry = null, roleCapabilities = ROLE_CAPABILITIES) {
  const effectiveRegistry = ensureRegistry(models, registry);
  const { roleDefinitions } = buildAiTeamRoleDefinitions(effectiveRegistry, models, roleCapabilities);
  const entries = [];
  for (const { role, compute, better } of roleDefinitions) {
    const globalRanked = rankBy(models, compute, better);
    if (!globalRanked.length) continue;
    const leader = globalRanked[0];
    if (eligibility[leader.model.adapterId]?.ok === true) {
      entries.push({ role, primary: toTeamModel(leader.model, true, effectiveRegistry), fallback: null, reason: null });
      continue;
    }
    const eligibleRanked = rankEligible(models, eligibility, compute, better);
    const fallback = eligibleRanked[0] ?? null;
    entries.push({
      role, primary: toTeamModel(leader.model, false, effectiveRegistry),
      fallback: fallback ? toTeamModel(fallback.model, true, effectiveRegistry) : null,
      reason: fallback
        ? `Real capability leader is temporarily unavailable (${eligibility[leader.model.adapterId]?.reason ?? "not eligible"}).`
        : "No eligible provider currently covers this role."
    });
  }
  return entries;
}

/**
 * EFFICIENT GLOBAL: el ganador real de eficiencia por rol, con el mismo
 * piso de capacidad (capabilityFloor) que buildEfficientTeam, pero sin
 * ninguna coordinación de portafolio — el par natural de
 * bestModelPerRoleGlobal. Pasa Maps de uso vacíos a sortByEfficiencyPriority
 * a propósito: sin memoria de asignaciones previas, el desempate por
 * "menos usado" nunca puede activarse, así que la elección cae siempre en
 * la cadena real de eficiencia (costo/duración/precio/throughput) y,
 * recién al final, en el desempate estable por adapterId/modelId.
 * @param {Array<object>} models - scoreAvailableModels() output
 * @param {Record<string, {ok: boolean, reason?: string}>} [eligibility]
 * @param {ReturnType<import("./model-capability-registry.js").createCapabilityRegistry>|null} [registry]
 * @param {{capabilityFloor?: number, providerCapacity?: object|null, roleCapabilities?: Record<string,string[]>}} [options]
 * @returns {Array<{role: string, primary: object, fallback: object|null, reason: string|null}>}
 */
export function bestEfficientModelPerRoleGlobal(models, eligibility = {}, registry = null, options = {}) {
  const { capabilityFloor = null, providerCapacity = null, roleCapabilities = ROLE_CAPABILITIES } = options;
  const effectiveRegistry = ensureRegistry(models, registry);
  const { roleDefinitions, gapValueByRole } = buildAiTeamRoleDefinitions(effectiveRegistry, models, roleCapabilities);
  const noPortfolioUsage = new Map();
  const entries = [];
  for (const { role, compute, better } of roleDefinitions) {
    const globalRanked = rankBy(models, compute, better);
    if (!globalRanked.length) continue;
    const eligibleRanked = attachGapValues(rankEligible(models, eligibility, compute, better), gapValueByRole[role]);
    const globalLeader = globalRanked[0];

    if (!eligibleRanked.length) {
      entries.push({ role, primary: toTeamModel(globalLeader.model, false, effectiveRegistry), fallback: null, reason: "No eligible provider currently covers this role." });
      continue;
    }

    const pool = adequateCandidates(eligibleRanked, eligibleRanked[0], better, resolveEfficientFloor(role, capabilityFloor));
    const chosen = sortByEfficiencyPriority(pool, effectiveRegistry, providerCapacity, noPortfolioUsage, noPortfolioUsage, eligibleRanked[0])[0];

    const globalLeaderEligible = eligibility[globalLeader.model.adapterId]?.ok === true;
    const globalLeaderIsStrictlyBetter = better === "max" ? globalLeader.value > eligibleRanked[0].value : globalLeader.value < eligibleRanked[0].value;
    if (!globalLeaderEligible && globalLeaderIsStrictlyBetter) {
      entries.push({
        role, primary: toTeamModel(globalLeader.model, false, effectiveRegistry), fallback: toTeamModel(chosen.model, true, effectiveRegistry),
        reason: `Real capability leader is temporarily unavailable (${eligibility[globalLeader.model.adapterId]?.reason ?? "not eligible"}).`
      });
      continue;
    }

    const fallbackEntry = eligibleRanked.find((r) => r.model.adapterId !== chosen.model.adapterId);
    entries.push({
      role, primary: toTeamModel(chosen.model, true, effectiveRegistry),
      fallback: fallbackEntry ? toTeamModel(fallbackEntry.model, true, effectiveRegistry) : null,
      reason: describeEfficiencyChoice(chosen, eligibleRanked[0], effectiveRegistry, providerCapacity, noPortfolioUsage, noPortfolioUsage)
    });
  }
  return entries;
}

/**
 * The "AI TEAM" distribution policy: decides which real, eligible provider
 * actually gets reserved for each role, coordinated across the whole
 * portfolio rather than seven independent per-role decisions — seven
 * individual winners don't form a team. The policy, in order:
 *
 * 1. Capability floor — a role only considers models that report the real
 *    metric(s) it needs (unchanged from before: `rankBy` drops nulls).
 * 2. Real capability decides — within each role's real near-equivalence
 *    pool (its own ROLE_NEAR_EQUIVALENCE_BAND — tighter for Architect/
 *    Reviewer than for Builder/Explorer/Tester), the highest-scoring
 *    eligible model wins, UNLESS the portfolio's concentration limits
 *    (max 2 roles per model, max 3 of 6 technical roles per provider)
 *    would be exceeded and a real, near-equivalent alternative exists —
 *    then the less-concentrated alternative is preferred instead.
 * 3. Widened search (see assignOneRole's own doc) — if NO real candidate
 *    in that narrow band avoids concentration, the search widens to the
 *    role's full real eligible pool at the same 80% floor EFFICIENT TEAM
 *    uses, before ever resorting to a decisive-advantage override or
 *    repeating the leader. A portfolio limit must never silently exceed
 *    itself while a real, genuinely-adequate (if not near-identical)
 *    alternative sits unexamined outside the tight band.
 * 4. A decisive real advantage (outside even that wide search) always
 *    overrides the limits as a last resort: capability is never
 *    sacrificed just to spread load.
 * 5. Review independence — Reviewer is additionally constrained off
 *    Builder's own provider whenever a real, near-equivalent alternative
 *    exists, so a model is never the sole judge of its own family's work.
 *
 * A temporarily unavailable real leader (quota/rate-limit) still never
 * just disappears: if the true global winner (across every candidate,
 * eligible or not) is stronger than the eligible pick, it's shown as the
 * primary, honestly flagged unavailable, with the eligible pick surfaced
 * as the fallback instead.
 * @param {Array<object>} models - scoreAvailableModels() output, computed
 *   across every candidate provider regardless of current eligibility.
 * @param {Record<string, {ok: boolean, reason?: string}>} eligibility -
 *   checkCandidate() results per adapterId.
 * @param {ReturnType<import("./model-capability-registry.js").createCapabilityRegistry>|null} [registry] -
 *   when given, each primary/fallback also carries `corroboration` (real
 *   Hugging Face / manufacturer-snapshot / Kairo-telemetry evidence for
 *   that exact model) — purely informational, never part of the ranking.
 * @param {Record<string, string[]>} [roleCapabilities] - see
 *   buildAiTeamRoleDefinitions's own doc — overrides the generic global
 *   role->capability table with a PROJECT-specific one (project-strategy.js),
 *   so the actual model selection responds to a real project's own
 *   detected needs, not just which roles are active.
 * @returns {Array<{role: string, primary: object, fallback: object|null, reason: string|null}>}
 */
export function buildAiTeam(models, eligibility = {}, registry = null, roleCapabilities = ROLE_CAPABILITIES) {
  const effectiveRegistry = ensureRegistry(models, registry);
  const { roleDefinitions, evaluationsByRole, optionalEvaluationsByRole, gapValueByRole } = buildAiTeamRoleDefinitions(effectiveRegistry, models, roleCapabilities);
  const roleRankings = roleDefinitions.map(({ role, compute, better }) => {
    const eligibleRanked = attachGapValues(rankEligible(models, eligibility, compute, better), gapValueByRole[role]);
    // Comparable-before-provisional (see preferComparableCandidates's own
    // doc): a candidate with real evidence too thin on a required
    // capability to be genuinely comparable never outranks a broadly-
    // measured one, even at a higher raw capabilityPercentile — only
    // competes at all when every real eligible candidate is provisional.
    const { pool: ranked, usedProvisionalFallback } = preferComparableCandidates(eligibleRanked, evaluationsByRole[role]);
    return { role, compute, better, ranked, usedProvisionalFallback };
  });

  const rolePools = roleRankings.map(({ role, better, ranked }) => ({
    role, better,
    pool: capabilityPool(ranked, better, role),
    fullRanked: ranked
  }));
  const makeSorter = (role, modelUsage, providerTechnicalUsage) => {
    const { better } = rolePools.find((r) => r.role === role);
    const roleEvaluations = evaluationsByRole[role];
    const roleOptionalEvaluations = optionalEvaluationsByRole[role];
    const getConfidenceRank = (model) => CONFIDENCE_RANK[roleEvaluations?.get(modelKey(model))?.confidence] ?? 0;
    const getOptionalFitRank = (model) => roleOptionalEvaluations?.get(modelKey(model))?.capabilityPercentile ?? 0;
    return (candidates) => sortByCapabilityPriority(candidates, better, modelUsage, providerTechnicalUsage, getConfidenceRank, getOptionalFitRank);
  };
  const { results } = assignCoordinatedTeam(rolePools, makeSorter, "capability");

  const entries = [];
  for (const { role, compute, better } of roleDefinitions) {
    const result = results[role];
    const { ranked: eligibleRanked, usedProvisionalFallback } = roleRankings.find((r) => r.role === role);
    const globalRanked = rankBy(models, compute, better);
    if (!globalRanked.length) continue; // no model anywhere reports this role's real metric — never guessed
    // Real coverage/confidence for the model actually shown as primary
    // (see RoleEvaluation) — surfaced honestly as null rather than
    // fabricated when absent. Purely informational — /models --evidence's
    // own "UNSCORED"/incomplete-coverage detail, never part of the
    // ranking itself, which already happened above.
    const evalFor = (model) => evaluationsByRole[role]?.get(modelKey(model)) ?? null;

    if (!result) {
      const globalLeader = globalRanked[0];
      const evaluation = evalFor(globalLeader.model);
      entries.push({
        role, primary: toTeamModel(globalLeader.model, false, effectiveRegistry), fallback: null,
        reason: "No eligible provider currently covers this role.",
        coverage: evaluation?.coverage ?? null, confidence: evaluation?.confidence ?? null
      });
      continue;
    }

    const chosen = result.entry;
    const globalLeader = globalRanked[0];
    const globalLeaderEligible = eligibility[globalLeader.model.adapterId]?.ok === true;
    const globalLeaderIsStrictlyBetter = better === "max" ? globalLeader.value > chosen.value : globalLeader.value < chosen.value;
    if (!globalLeaderEligible && globalLeaderIsStrictlyBetter) {
      const evaluation = evalFor(globalLeader.model);
      entries.push({
        role, primary: toTeamModel(globalLeader.model, false, effectiveRegistry), fallback: toTeamModel(chosen.model, true, effectiveRegistry),
        reason: `Real capability leader is temporarily unavailable (${eligibility[globalLeader.model.adapterId]?.reason ?? "not eligible"}).`,
        coverage: evaluation?.coverage ?? null, confidence: evaluation?.confidence ?? null
      });
      continue;
    }

    const fallbackEntry = eligibleRanked.find((r) => r.model.adapterId !== chosen.model.adapterId);
    const pool = rolePools.find((r) => r.role === role).pool;
    const reviewerLeaderWasBuilderAdapter = role === "Reviewer" && pool.length
      && pool[0].model.adapterId === entries.find((e) => e.role === "Builder")?.primary.adapterId;
    let reason;
    if (usedProvisionalFallback) {
      // Every real eligible candidate for this role was provisional (real
      // evidence, just too thin on a required capability to be genuinely
      // comparable) — this pick is a real, honest fallback among them,
      // never presented as an ordinary capability win. Takes priority
      // over the other reason kinds below since it explains something
      // more fundamental about the WHOLE pool, not just this one pick.
      reason = "Only provisional evidence available for this role — no real candidate cleared comparable benchmark coverage.";
    } else if (reviewerLeaderWasBuilderAdapter && chosen.model.adapterId !== pool[0].model.adapterId) {
      reason = "Kept independent from Builder's provider.";
    } else if (result.reasonKind === "only-adequate-concentration") {
      reason = "Only adequate option — no real alternative avoids concentration without forcing a repeat.";
    } else if (result.reasonKind === "decisive-override") {
      reason = "Decisive real capability advantage — kept despite exceeding the concentration limit.";
    } else if (result.reasonKind === "diversity") {
      reason = "Near-equivalent alternatives — assigned to a different model/provider to avoid concentration.";
    } else if (result.reasonKind === "wider-search-diversity") {
      reason = "No near-equivalent alternative avoided concentration — widened the search to the full real catalog and assigned a genuinely adequate model/provider instead.";
    } else {
      reason = null;
    }
    const evaluation = evalFor(chosen.model);
    entries.push({
      role, primary: toTeamModel(chosen.model, true, effectiveRegistry),
      fallback: fallbackEntry ? toTeamModel(fallbackEntry.model, true, effectiveRegistry) : null,
      reason, coverage: evaluation?.coverage ?? null, confidence: evaluation?.confidence ?? null
    });
  }
  return entries;
}

// The real, per-MODEL signals EFFICIENT TEAM checks, in priority order, to
// choose among candidates that already clear EFFICIENT_CAPABILITY_FLOOR
// (see buildEfficientTeam) — never a blended score, each one only decides
// when the previous ones don't (unknown or tied). This is the
// "ModelEfficiency" side of the split: real per-task economics that
// genuinely differ model to model.
//
// Provider quota (ProviderCapacity, see subscription-pressure-source.js)
// is deliberately NOT one of these — it isn't a per-model measurement at
// all (every model under a provider shares the exact same real number),
// so it's resolved separately, by adapterId, and checked only as the very
// last tiebreak (see sortByEfficiencyPriority/describeEfficiencyChoice) —
// strictly after every real per-model signal AND the portfolio's own
// concentration state have been exhausted. A provider's spare quota must
// never, by itself, decide who wins a role over a model with genuinely
// better per-task economics.
const EFFICIENCY_DIMENSIONS = [
  { key: "kairo.totalTokens", better: "min", label: "lower real observed token consumption" },
  { key: "kairo.cost", better: "min", label: "lower real observed cost per task" },
  { key: "kairo.durationMs", better: "min", label: "lower real observed duration" },
  // The real FULL price (input + output) — a public-price fallback, never
  // a fake stand-in for an already-paid subscription's real marginal
  // cost (the three kairo.* dimensions above are that real cost; this is
  // what's left when Kairo hasn't actually run the model yet). Falls
  // back to input-only when a real output price isn't known — never
  // invents one.
  { key: "totalPricePerMTok", better: "min", label: "lower real full input+output price", resolve: resolveTotalPrice },
  { key: "outputTokensPerSecond", better: "max", label: "higher reported throughput" }
];

function resolveTotalPrice(registry, model) {
  const input = resolveMetric(registry, model, "priceInputPerMTok");
  if (input == null) return null;
  const output = resolveMetric(registry, model, "priceOutputPerMTok");
  return output == null ? input : input + output;
}

/** Resolves one EFFICIENCY_DIMENSIONS entry's real value for a model — its own `resolve` when it has one (a derived value, e.g. totalPricePerMTok), otherwise the plain registry/model field lookup every other dimension already used. */
function resolveDimension(dimension, registry, model) {
  return dimension.resolve ? dimension.resolve(registry, model) : resolveMetric(registry, model, dimension.key);
}

/**
 * Resolves a real ProviderCapacity signal for a model's adapter — never
 * the model's own identity. Two models under the same adapter always
 * resolve to the exact same value here, because quota genuinely is an
 * account-wide, not per-model, real fact.
 * @param {Record<string, import("./subscription-pressure-source.js").ProviderCapacity>|null} providerCapacity
 * @param {{adapterId: string}} model
 */
function resolveProviderCapacity(providerCapacity, model) {
  return providerCapacity?.[model.adapterId]?.quotaRemainingPercent ?? null;
}

// EFFICIENT TEAM's capability floor: a candidate must retain at least this
// fraction of the real capability leader's score (see "retention" below)
// to be considered "adequate" for a role — a genuinely different policy
// from NEAR_EQUIVALENCE_BAND's "almost identical" test. NEAR_EQUIVALENCE_BAND
// (0.08, ~8%) keeps governing maximum-capability equivalence (AI TEAM's
// near-equivalence pool, Reviewer independence) — it no longer governs
// EFFICIENT TEAM. This floor is intentionally much wider: EFFICIENT
// TEAM's job is "the minimum model that's still genuinely sufficient for
// the role," not "whichever near-identical model happens to be cheaper."
//
// The floor is now risk-based, sourced from role-profiles.js's own
// RoleProfile.riskLevel (already a real, deliberate per-role judgment —
// see role-profiles.js's own doc for why Architect/Debugger/Reviewer are
// "high" and Explorer is "low") rather than one flat number for every
// role: a mistake from Architect/Debugger/Reviewer compounds across the
// whole team or hits during a live failure, so EFFICIENT can afford to
// give up less capability there than it can for Explorer, whose mistakes
// are cheap to catch and retry. EFFICIENT_CAPABILITY_FLOOR (0.80) stays
// exported as the "low"-risk value and the real fallback for a role with
// no RoleProfile (a future addition, or a project-derived role name not
// among the canonical six) — never calibrated against measured data the
// way NEAR_EQUIVALENCE_BAND was, since "sufficient" is a product
// decision, not something derivable from benchmark gaps alone.
// `options.capabilityFloor` on buildEfficientTeam/bestEfficientModelPerRoleGlobal
// still overrides ALL of this with one explicit number when a caller
// wants that instead — resolveEfficientFloor only applies when it wasn't given.
export const EFFICIENT_CAPABILITY_FLOOR = 0.80;

const EFFICIENT_FLOOR_BY_RISK = { high: 0.90, medium: 0.85, low: EFFICIENT_CAPABILITY_FLOOR };

/**
 * The real capability floor a role's EFFICIENT pick must clear — an
 * explicit `options.capabilityFloor` always wins (a caller's deliberate
 * override); otherwise resolved from the role's own real RoleProfile.riskLevel.
 * @param {string} role
 * @param {number|null} explicitFloor - `options.capabilityFloor`, or null/undefined when not overridden.
 * @returns {number}
 */
function resolveEfficientFloor(role, explicitFloor) {
  if (explicitFloor != null) return explicitFloor;
  const profile = getRoleProfile(role);
  return (profile && EFFICIENT_FLOOR_BY_RISK[profile.riskLevel]) ?? EFFICIENT_CAPABILITY_FLOOR;
}

/**
 * Picks the single real EFFICIENCY_DIMENSIONS entry to use as the Pareto
 * frontier's resource axis for one role's candidate pool — the
 * HIGHEST-PRIORITY dimension that at least one real candidate actually
 * has a value for (kairo.* real telemetry first, public price as
 * fallback, throughput last). Deliberately a SINGLE dimension, never a
 * blend: comparing retention against two different candidates' two
 * different real metrics would be comparing unlike things.
 * @returns {{key: string, better: "min"|"max", label: string, resolve?: Function}|null}
 */
function resolveResourceDimension(registry, candidates) {
  for (const dimension of EFFICIENCY_DIMENSIONS) {
    if (candidates.some((c) => resolveDimension(dimension, registry, c.model) != null)) return dimension;
  }
  return null;
}

/**
 * A real candidate's raw value on the chosen resource dimension — just a
 * thin resolveDimension wrapper kept separate so computeBalanceScores
 * reads clearly. Deliberately NOT normalized against another candidate's
 * value here (see computeBalanceScores's own doc for why a ratio against
 * the pool's cheapest candidate is wrong, and breaks outright on a real
 * free/zero-cost model).
 */
function resourceValue(dimension, registry, model) {
  return dimension ? resolveDimension(dimension, registry, model) : null;
}

/**
 * The real Pareto balance-point scores for one role's pool — computed
 * once across the whole pool, never pairwise, because a "balance point"
 * is inherently relative to the pool's own real extremes. For every
 * candidate with a real value on the chosen resource dimension, both real
 * retention (gapValue as a fraction of the leader's) and real resource
 * pressure are normalized DIRECTLY against the POOL's own real min/max on
 * each axis — `(value - min) / (max - min)` for a "min is better"
 * dimension (0 at the pool's own cheapest/fastest-draining, 1 at its
 * worst), or `(max - value) / (max - min)` for a "max is better" one
 * (e.g. throughput) — then scored `retentionNorm - pressureNorm`.
 * Maximizing this rewards the candidate closest to the "good corner" —
 * high real retention AND low real resource pressure RELATIVE TO ITS
 * PEERS — a genuine knee/balance point.
 *
 * This is deliberately NOT retention/pressure (a plain ratio dividing by
 * the pool's cheapest real value): besides always anchoring the cheapest
 * candidate's own pressure at 1.0 (collapsing EFFICIENT into ECONOMY —
 * see the git history for that bug), a real free/zero-cost model in the
 * pool (Artificial Analysis's own raw dataset carries hundreds of these,
 * even where none currently reach an eligible provider catalog) makes
 * that division either NaN (0/0, when it's also the cheapest) or Infinity
 * (anything/0 elsewhere), silently corrupting the whole pool's comparison
 * and always forcing the capability leader to win by default. Direct
 * min/max normalization has
 * no such division and handles a real zero exactly like any other value.
 *
 * With exactly two candidates, the two extremes always score identically
 * (0 each, by construction — there is no "middle" to find with only two
 * points), so a real two-way choice correctly falls through to
 * EFFICIENCY_DIMENSIONS' own cascade (see sortByEfficiencyPriority)
 * instead of this function arbitrarily favoring either endpoint.
 * @returns {Map<string, number>|null} modelKey -> balance score, or null
 *   when there's no real leader/dimension/enough real data to compare.
 */
function computeBalanceScores(candidates, leader, dimension, registry) {
  if (!leader?.gapValue || !dimension) return null;
  const points = candidates
    .map((c) => ({
      key: modelKey(c.model),
      retention: (c.gapValue ?? 0) / leader.gapValue,
      value: resourceValue(dimension, registry, c.model)
    }))
    .filter((p) => p.value != null && Number.isFinite(p.value));
  if (points.length < 2) return null;
  const retentions = points.map((p) => p.retention);
  const values = points.map((p) => p.value);
  const minRet = Math.min(...retentions);
  const retRange = Math.max(...retentions) - minRet || 1;
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const hasValueRange = maxValue > minValue;
  const valueRange = maxValue - minValue || 1;
  const scores = new Map();
  for (const p of points) {
    const retentionNorm = (p.retention - minRet) / retRange;
    const pressureNorm = !hasValueRange ? 0
      : dimension.better === "min" ? (p.value - minValue) / valueRange : (maxValue - p.value) / valueRange;
    scores.set(p.key, retentionNorm - pressureNorm);
  }
  return scores;
}

/**
 * Orders real adequate candidates by their Pareto balance-point score
 * first (see computeBalanceScores's own doc — a real knee/balance point
 * relative to the pool's own extremes, never just "cheapest wins" or
 * "closest to QUALITY wins") when a real role leader is given; the EFFICIENCY_DIMENSIONS
 * priority chain (real per-model economics) then only ever breaks a
 * genuine tie in that score. Falls through to the portfolio's own
 * concentration state (prefer the less-used model, then the less-used
 * provider), then a real ProviderCapacity signal (quota, resolved
 * per-adapter, never per-model), and only then a stable adapterId/modelId
 * tiebreak so the same real near-tie always resolves the same way run to
 * run.
 * @param {Array<{model: object, value: number, gapValue?: number}>} candidates
 * @param {ReturnType<import("./model-capability-registry.js").createCapabilityRegistry>} registry
 * @param {Record<string, import("./subscription-pressure-source.js").ProviderCapacity>|null} providerCapacity
 * @param {Map<string, number>} modelUsage
 * @param {Map<string, number>} providerTechnicalUsage
 * @param {{model: object, gapValue?: number}|null} [leader] - the role's real QUALITY leader (retention reference); when omitted, falls back to the plain EFFICIENCY_DIMENSIONS-only ordering (no real gapValue reference to compute retention against).
 */
function sortByEfficiencyPriority(candidates, registry, providerCapacity, modelUsage, providerTechnicalUsage, leader = null) {
  const dimension = leader ? resolveResourceDimension(registry, candidates) : null;
  const balanceScores = dimension ? computeBalanceScores(candidates, leader, dimension, registry) : null;
  return [...candidates].sort((a, b) => {
    if (balanceScores) {
      const aScore = balanceScores.get(modelKey(a.model));
      const bScore = balanceScores.get(modelKey(b.model));
      if (aScore != null && bScore != null && aScore !== bScore) return bScore - aScore; // higher real balance score wins
    }
    for (const dim of EFFICIENCY_DIMENSIONS) {
      const av = resolveDimension(dim, registry, a.model);
      const bv = resolveDimension(dim, registry, b.model);
      if (av == null || bv == null || av === bv) continue;
      return dim.better === "max" ? bv - av : av - bv;
    }
    const aModelUsage = modelUsage.get(familyKey(a.model)) ?? 0;
    const bModelUsage = modelUsage.get(familyKey(b.model)) ?? 0;
    if (aModelUsage !== bModelUsage) return aModelUsage - bModelUsage;
    const aProviderUsage = providerTechnicalUsage.get(a.model.adapterId) ?? 0;
    const bProviderUsage = providerTechnicalUsage.get(b.model.adapterId) ?? 0;
    if (aProviderUsage !== bProviderUsage) return aProviderUsage - bProviderUsage;
    const aQuota = resolveProviderCapacity(providerCapacity, a.model);
    const bQuota = resolveProviderCapacity(providerCapacity, b.model);
    if (aQuota != null && bQuota != null && aQuota !== bQuota) return bQuota - aQuota; // higher headroom wins
    const adapterCompare = a.model.adapterId.localeCompare(b.model.adapterId);
    return adapterCompare !== 0 ? adapterCompare : a.model.modelId.localeCompare(b.model.modelId);
  });
}

/**
 * Names the real dimension that actually decided an EFFICIENT TEAM pick,
 * or null when it's just the unremarkable capability leader itself.
 * @param {{model: object, value: number}} chosen
 * @param {{model: object, value: number}} leader
 * @param {ReturnType<import("./model-capability-registry.js").createCapabilityRegistry>} registry
 * @param {Record<string, import("./subscription-pressure-source.js").ProviderCapacity>|null} providerCapacity
 * @param {Map<string, number>} modelUsage
 * @param {Map<string, number>} providerTechnicalUsage
 */
function describeEfficiencyChoice(chosen, leader, registry, providerCapacity, modelUsage, providerTechnicalUsage) {
  if (chosen.model.adapterId === leader.model.adapterId && chosen.model.modelId === leader.model.modelId) return null;
  // Real retention against the role's own QUALITY leader — "how much
  // real capability did this Pareto balance-point pick actually keep" —
  // prefixed onto every reason below, not just the resource-dimension
  // one, since it's real context for ANY reason a non-leader was chosen.
  const retentionPct = leader.gapValue ? Math.round(((chosen.gapValue ?? 0) / leader.gapValue) * 100) : null;
  const retentionPrefix = retentionPct != null ? `Retains ~${retentionPct}% of QUALITY's real capability — ` : "Adequate capability — ";
  const dimension = resolveResourceDimension(registry, [chosen, leader]);
  if (dimension) {
    const chosenValue = resolveDimension(dimension, registry, chosen.model);
    const leaderValue = resolveDimension(dimension, registry, leader.model);
    if (chosenValue != null && leaderValue != null && chosenValue !== leaderValue) {
      const chosenIsBetter = dimension.better === "max" ? chosenValue > leaderValue : chosenValue < leaderValue;
      if (chosenIsBetter) return `${retentionPrefix}chosen for ${dimension.label}.`;
      // this dimension didn't favor the switch; a later real signal must
      // have — no real number to report from THIS one, fall through.
    }
  }
  const chosenModelUsage = modelUsage.get(familyKey(chosen.model)) ?? 0;
  const leaderModelUsage = modelUsage.get(familyKey(leader.model)) ?? 0;
  const chosenProviderUsage = providerTechnicalUsage.get(chosen.model.adapterId) ?? 0;
  const leaderProviderUsage = providerTechnicalUsage.get(leader.model.adapterId) ?? 0;
  if (chosenModelUsage < leaderModelUsage || chosenProviderUsage < leaderProviderUsage) {
    return `${retentionPrefix}assigned to a different model/provider to avoid concentration.`;
  }
  const chosenQuota = resolveProviderCapacity(providerCapacity, chosen.model);
  const leaderQuota = resolveProviderCapacity(providerCapacity, leader.model);
  if (chosenQuota != null && leaderQuota != null && chosenQuota > leaderQuota) {
    return `${retentionPrefix}chosen for lower real provider quota pressure.`;
  }
  return `${retentionPrefix}chosen by a stable tiebreak, no real consumption/cost/duration/price/speed/concentration/quota signal distinguished them.`;
}

/**
 * Which eligible, ranked candidates are "adequate" for a role under the
 * capability-floor policy — retain at least `capabilityFloor` fraction of
 * the real leader's score. Every current real role is ranked "max"
 * (higher capability wins); a defensive `better !== "max"` early return
 * exists below for any future "min"-ranked role (lower-is-better, e.g. a
 * real cost signal) — applying a capability floor to a value that isn't
 * a capability score at all would be applying it to the wrong axis
 * entirely, so such a role's every eligible candidate is treated as
 * already "adequate" rather than floor-filtered.
 */
function adequateCandidates(eligibleRanked, leader, better, capabilityFloor) {
  if (!eligibleRanked.length) return [];
  if (better !== "max") return eligibleRanked;
  // The floor compares REAL, scale-normalized gap values (never the
  // rank-only percentile — see leaderAdvantage's comment), so a genuinely
  // 85%-capable real alternative still clears an 80% floor even with only
  // 2 real candidates, instead of reading as a flat 0% (percentile's
  // runner-up value with 2 candidates).
  if (leader.gapValue == null) return [leader];
  const floorValue = leader.gapValue * capabilityFloor;
  return eligibleRanked.filter((entry) => entry.gapValue != null && entry.gapValue >= floorValue);
}

/**
 * EFFICIENT TEAM: a real Pareto balance point between capability and
 * resource cost for each role — deliberately NOT "whichever candidate is
 * cheapest" (that's ECONOMY, a separate concept EFFICIENT must never
 * collapse into — see computeBalanceScores's own doc for why a plain
 * retention/pressure ratio would do exactly that). Among eligible
 * candidates that clear the role's own risk-based capability floor (see
 * resolveEfficientFloor — 90% for high-risk roles, 85% medium, 80% low,
 * sourced from RoleProfile.riskLevel; `options.capabilityFloor` overrides
 * this for every role when explicitly given), the real candidate whose
 * capability retention and real resource pressure sit at the pool's own
 * genuine knee/balance point wins — never the pool's cheapest-adequate
 * extreme merely because it's cheapest, and never the raw capability
 * leader merely because it's most capable. EFFICIENCY_DIMENSIONS (real
 * token consumption, then cost, duration, price, throughput) only ever
 * breaks a genuine tie in that balance score, then the portfolio's own
 * concentration state, then a provider's real quota headroom. Never
 * invents a savings percentage or a blended score — only ever orders by a
 * real, already-connected signal, and falls back to a stable tiebreak
 * when none of them distinguish the candidates.
 *
 * Astra/Fable/Opus-class leaders can still appear here — precisely when
 * no smaller real model clears the floor, EFFICIENT TEAM shows the exact
 * same model as AI TEAM for that role, with an honest "Only adequate
 * option" reason rather than a fabricated savings claim.
 * @param {Array<object>} models - scoreAvailableModels() output, computed
 *   across every candidate provider regardless of current eligibility.
 * @param {Record<string, {ok: boolean, reason?: string}>} eligibility
 * @param {ReturnType<import("./model-capability-registry.js").createCapabilityRegistry>|null} [registry]
 * @param {object} [options]
 * @param {number} [options.capabilityFloor] - fraction of the leader's
 *   real score a candidate must retain to be considered adequate
 *   (default 0.80).
 * @param {Record<string, import("./subscription-pressure-source.js").ProviderCapacity>|null} [options.providerCapacity] -
 *   real per-adapter quota headroom (see subscription-pressure-source.js's
 *   buildProviderCapacity) — a PROVIDER-level signal, checked only as the
 *   very last tiebreak, strictly after every per-model EFFICIENCY_DIMENSIONS
 *   signal AND the portfolio's own concentration state. Never blended
 *   with or treated as evidence about a specific model's own efficiency.
 * @returns {Array<{role: string, primary: object, fallback: object|null, reason: string|null}>}
 */
export function buildEfficientTeam(models, eligibility = {}, registry = null, options = {}) {
  const { capabilityFloor = null, providerCapacity = null, roleCapabilities = ROLE_CAPABILITIES } = options;
  const effectiveRegistry = ensureRegistry(models, registry);
  const { roleDefinitions, evaluationsByRole, gapValueByRole } = buildAiTeamRoleDefinitions(effectiveRegistry, models, roleCapabilities);
  const roleRankings = roleDefinitions.map(({ role, compute, better }) => {
    const eligibleRanked = attachGapValues(rankEligible(models, eligibility, compute, better), gapValueByRole[role]);
    // Same comparable-before-provisional policy as buildAiTeam (see
    // preferComparableCandidates's own doc) — the real, risk-based
    // capability floor below applies WITHIN whichever tier this produces,
    // never across both at once, so a thin, provisional candidate's real
    // value can't let it clear the floor ahead of a genuinely comparable one.
    const { pool: ranked, usedProvisionalFallback } = preferComparableCandidates(eligibleRanked, evaluationsByRole[role]);
    return { role, compute, better, ranked, usedProvisionalFallback };
  });

  const rolePools = roleRankings.map(({ role, better, ranked }) => ({
    role, better,
    pool: adequateCandidates(ranked, ranked[0], better, resolveEfficientFloor(role, capabilityFloor)),
    // The real QUALITY leader — retention reference for the Pareto
    // balance-point score (see sortByEfficiencyPriority's own doc). The
    // TRUE leader of the comparable-preferred `ranked` list, not just
    // `pool[0]` (pool is already floor-filtered, but preserves order —
    // ranked[0] and pool[0] are the same real model as long as the
    // leader itself clears its own floor, which it trivially always does).
    leader: ranked[0] ?? null
  }));
  const makeSorter = (role, modelUsage, providerTechnicalUsage) => {
    const { leader } = rolePools.find((r) => r.role === role);
    return (candidates) => sortByEfficiencyPriority(candidates, effectiveRegistry, providerCapacity, modelUsage, providerTechnicalUsage, leader);
  };
  const { results } = assignCoordinatedTeam(rolePools, makeSorter, "efficient");

  const entries = [];
  for (const { role, compute, better } of roleDefinitions) {
    const result = results[role];
    const { ranked: eligibleRanked, usedProvisionalFallback } = roleRankings.find((r) => r.role === role);
    const globalRanked = rankBy(models, compute, better);
    if (!globalRanked.length) continue; // no model anywhere reports this role's real metric — never guessed

    if (!eligibleRanked.length) {
      const globalLeader = globalRanked[0];
      entries.push({
        role, primary: toTeamModel(globalLeader.model, false, effectiveRegistry), fallback: null,
        reason: "No eligible provider currently covers this role."
      });
      continue;
    }

    const leader = eligibleRanked[0];
    const chosen = result.entry;

    const globalLeader = globalRanked[0];
    const globalLeaderEligible = eligibility[globalLeader.model.adapterId]?.ok === true;
    const globalLeaderIsStrictlyBetter = better === "max" ? globalLeader.value > leader.value : globalLeader.value < leader.value;
    if (!globalLeaderEligible && globalLeaderIsStrictlyBetter) {
      // Same "unavailable real leader" transparency AI TEAM has — never
      // hidden, with the efficient real pick among the rest as fallback.
      entries.push({
        role, primary: toTeamModel(globalLeader.model, false, effectiveRegistry), fallback: toTeamModel(chosen.model, true, effectiveRegistry),
        reason: `Real capability leader is temporarily unavailable (${eligibility[globalLeader.model.adapterId]?.reason ?? "not eligible"}).`
      });
      continue;
    }

    const fallbackEntry = eligibleRanked.find((r) => r.model.adapterId !== chosen.model.adapterId);
    let reason;
    if (usedProvisionalFallback) {
      reason = "Only provisional evidence available for this role — no real candidate cleared comparable benchmark coverage.";
    } else if (result.reasonKind === "only-adequate-floor") {
      reason = "Only adequate option — no real alternative clears the capability floor.";
    } else if (result.reasonKind === "only-adequate-concentration") {
      reason = "Only adequate option — no real alternative avoids concentration without forcing a repeat.";
    } else if (result.reasonKind === "decisive-override") {
      reason = "Decisive real capability advantage — kept despite exceeding the concentration limit.";
    } else {
      reason = describeEfficiencyChoice(chosen, leader, effectiveRegistry, providerCapacity, result.modelUsageSnapshot, result.providerUsageSnapshot);
    }
    entries.push({
      role, primary: toTeamModel(chosen.model, true, effectiveRegistry),
      fallback: fallbackEntry ? toTeamModel(fallbackEntry.model, true, effectiveRegistry) : null,
      reason
    });
  }
  return entries;
}
