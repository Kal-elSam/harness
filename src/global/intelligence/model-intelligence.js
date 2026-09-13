// Cross-references the models Kairo can actually launch right now (each
// provider's real, discovered/documented catalog) with real Artificial
// Analysis benchmark scores — deliberately NOT "download every model AA
// tracks": only the ones we actually have access to matter for routing.
//
// A model with no confident match gets no score, never a guessed one —
// same fail-closed rule as everywhere else in Kairo's routing.

import { bestEvidence, createCapabilityRegistry } from "./model-capability-registry.js";

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
    for (const entry of models ?? []) {
      // Cursor's real catalog is a plain array of model name strings, not
      // {id, displayName} objects like Codex/Claude/OpenCode's — normalize
      // both shapes rather than silently dropping every Cursor model.
      const model = typeof entry === "string" ? { id: entry, displayName: entry } : entry;
      const score = matchArtificialAnalysisScore(model.id, aaModels);
      if (!score) continue;
      results.push({
        adapterId, modelId: model.id, displayName: model.displayName ?? null,
        slug: score.slug, name: score.name,
        intelligenceIndex: score.intelligenceIndex, codingIndex: score.codingIndex, mathIndex: score.mathIndex,
        priceInputPerMTok: score.priceInputPerMTok ?? null, outputTokensPerSecond: score.outputTokensPerSecond ?? null,
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

// AA's composite indices (intelligenceIndex/codingIndex/mathIndex) are
// reported on a 0-100 scale; its individual per-benchmark evaluations
// (gpqa, hle, tauBanking, terminalBenchV2, ...) are reported as 0-1
// fractions. Converting the 0-100 ones down to the same 0-1 scale is a
// real, FIXED unit conversion — not a pool-relative rescaling. That
// distinction matters: a percentile- or min-max-by-pool approach
// degenerates to always reporting just the two extremes {0, 1} whenever
// there are only 2 real candidates (Kairo's typical case — usually just
// Codex vs Claude, sometimes plus Go), which would destroy the real
// magnitude of the gap entirely. Fixed unit conversion preserves it.
const HUNDRED_SCALE_METRICS = new Set(["intelligenceIndex", "codingIndex", "mathIndex"]);

function toUnitScale(key, value) {
  if (value == null) return null;
  return HUNDRED_SCALE_METRICS.has(key) ? value / 100 : value;
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
 * When none is given, builds a throwaway one seeded only from the AA
 * fields already present on `models` (scoreAvailableModels' output) —
 * identical data to what compute() would have read directly before, so
 * every existing call site (most tests, and any caller not yet passing
 * the real Model Intelligence Foundation registry) behaves exactly as
 * before. A caller that DOES pass a real registry (service.js, wired to
 * AA + Hugging Face + manufacturer snapshots + Kairo's own telemetry)
 * lets every role requirement resolve against the full evidence base,
 * not just AA.
 */
function ensureRegistry(models, registry) {
  if (registry) return registry;
  const fallback = createCapabilityRegistry();
  for (const model of models) {
    const id = fallback.registerIdentity(model.adapterId, model.modelId, model.displayName ?? null);
    for (const metric of KNOWN_MODEL_METRICS) {
      const value = model[metric];
      if (value == null) continue;
      fallback.addEvidence(id, { metric, value, source: "artificial-analysis-free", benchmarkVersion: null, modelConfig: null, date: null, verified: false });
    }
  }
  return fallback;
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
 * "gpqa-diamond") needs resolveCanonicalCapability instead — looking up
 * one exact key would silently miss every other source's real evidence
 * for the same real thing, which is exactly the gap found and fixed here.
 */
function resolveMetric(registry, model, key) {
  const id = registry.registerIdentity(model.adapterId, model.modelId, model.displayName ?? null);
  const best = bestEvidence(registry, id, key);
  return best ? best.value : (model[key] ?? null);
}

function dateOf(entry) {
  const parsed = Date.parse(entry?.date ?? "");
  return Number.isFinite(parsed) ? parsed : -Infinity;
}

function convertByScale(scale, value) {
  if (value == null) return null;
  return scale === "hundred" ? value / 100 : value;
}

// Canonical capabilities: a real thing a role cares about (reasoning,
// terminal execution, software execution) mapped to every real metric
// name any connected source uses to measure it, each with its own real
// scale. Different sources name the same real benchmark differently —
// AA's free API reports GPQA as "gpqa" (0-1); a manufacturer's own
// published table reports the identical benchmark as "gpqa-diamond"
// (0-100). Without this mapping, a role asking for "gpqa" would find
// AA's own number but silently miss a manufacturer-reported or
// Hugging-Face-reported score for the exact same real benchmark, which
// defeats the entire point of connecting a multi-source registry.
const CANONICAL_CAPABILITIES = {
  // gpqa/gpqa-diamond are the same real benchmark under different source
  // names/scales; hle (Humanity's Last Exam) is a different real
  // reasoning benchmark, not a rename of GPQA — included because it's the
  // one Hugging Face's leaderboard integration actually reports for Go's
  // models in production (see model-capability-registry-sources.js), and
  // "never average, take the single most trustworthy real evidence" still
  // applies: whichever real reasoning score is best-evidenced wins, none
  // of them are blended together.
  reasoning: [
    { metric: "gpqa", scale: "unit" },
    { metric: "gpqa-diamond", scale: "hundred" },
    { metric: "hle", scale: "unit" }
  ],
  terminalExecution: [
    { metric: "terminalBenchV2", scale: "unit" },
    { metric: "terminalBenchHard", scale: "unit" },
    { metric: "terminal-bench", scale: "hundred" },
    { metric: "terminal-bench-science", scale: "hundred" }
  ],
  softwareExecution: [
    { metric: "tauBanking", scale: "unit" },
    { metric: "cursorbench", scale: "hundred" },
    { metric: "kairo.success", scale: "unit" }
  ]
};

/**
 * Resolves a canonical capability by checking every real metric name any
 * connected source uses for it (see CANONICAL_CAPABILITIES), converting
 * each candidate to the same 0-1 scale, and keeping only the single most
 * trustworthy real result across all of them (verified first, then most
 * recent) — never averaging across different metrics, since "gpqa" and
 * "gpqa-diamond" are still not literally the identical measurement even
 * once mapped to the same real-world concept. Falls back to whichever
 * mapped AA-native field the model object itself reports directly, for
 * callers using a registry that wasn't seeded with these metrics (a
 * sparse registry passed directly in a test, for instance).
 */
function resolveCanonicalCapability(registry, model, canonicalName) {
  const id = registry.registerIdentity(model.adapterId, model.modelId, model.displayName ?? null);
  const mappings = CANONICAL_CAPABILITIES[canonicalName] ?? [];
  let best = null;
  for (const mapping of mappings) {
    for (const entry of registry.getEvidence(id, mapping.metric)) {
      const isBetter = !best
        || (entry.verified && !best.entry.verified)
        || (entry.verified === best.entry.verified && dateOf(entry) > dateOf(best.entry));
      if (isBetter) best = { entry, scale: mapping.scale };
    }
  }
  if (best) return convertByScale(best.scale, best.entry.value);
  for (const mapping of mappings) {
    if (model[mapping.metric] != null) return convertByScale(mapping.scale, model[mapping.metric]);
  }
  return null;
}

/**
 * Builds a compute() for a role that needs more than one real signal,
 * possibly on different scales and named differently across sources.
 * `requiredKeys` are single-name real metrics (intelligenceIndex,
 * codingIndex — no source names these differently yet) resolved via
 * resolveMetric, and form a hard capability floor: a model missing any
 * of them doesn't qualify for this role at all. `optionalCapabilities`
 * are canonical names (see CANONICAL_CAPABILITIES) resolved via
 * resolveCanonicalCapability across every real source that measures
 * them — present only tightens the bottleneck, absent never excludes or
 * penalizes a model, so a role gaining a new, sparser real signal never
 * shrinks its candidate pool for models nothing has scored on it yet.
 */
function scaledBottleneck(registry, requiredKeys, optionalCapabilities = []) {
  return (model) => {
    const get = (key) => resolveMetric(registry, model, key);
    if (requiredKeys.some((key) => get(key) == null)) return null;
    const requiredValues = requiredKeys.map((key) => toUnitScale(key, get(key)));
    const optionalValues = optionalCapabilities
      .map((name) => resolveCanonicalCapability(registry, model, name))
      .filter((v) => v != null);
    return Math.min(...requiredValues, ...optionalValues);
  };
}

/**
 * Same real metrics as ROLE_DEFINITIONS, relabeled to the seven-role team
 * vocabulary the user settled on for the "AI TEAM" widget (Explorer /
 * Architect / Builder / Debugger / Tester / Reviewer / Economy) — plus,
 * per explicit decision, real role-specific capabilities layered in as
 * optional tie-breakers (reasoning for reasoning-heavy roles,
 * softwareExecution for agentic/tool-use, terminalExecution for
 * terminal-involved roles), resolved as CANONICAL capabilities (see
 * CANONICAL_CAPABILITIES) — not a single exact metric name — so a
 * manufacturer snapshot's "gpqa-diamond", Hugging Face's "hle"-shaped
 * evidence for the mapped benchmark, or Kairo's own "kairo.success" can
 * all actually satisfy a role's requirement, not just AA's own
 * exact-named field. Built fresh per buildAiTeam() call (registry
 * differs per call). Kept as a separate list from ROLE_DEFINITIONS so
 * bestModelPerRole()'s existing contract and tests stay untouched.
 */
function buildAiTeamRoleDefinitions(registry) {
  return [
    { role: "Explorer", compute: scaledBottleneck(registry, ["intelligenceIndex"], ["reasoning"]), better: "max" },
    { role: "Architect", compute: scaledBottleneck(registry, ["intelligenceIndex"], ["reasoning"]), better: "max" },
    { role: "Builder", compute: scaledBottleneck(registry, ["codingIndex"], ["softwareExecution"]), better: "max" },
    { role: "Debugger", compute: scaledBottleneck(registry, ["intelligenceIndex", "codingIndex"], ["terminalExecution"]), better: "max" },
    { role: "Tester", compute: scaledBottleneck(registry, ["codingIndex"], ["terminalExecution"]), better: "max" },
    { role: "Reviewer", compute: (m) => minOfReal(resolveMetric(registry, m, "intelligenceIndex"), resolveMetric(registry, m, "codingIndex")), better: "max" },
    // Capability floor: cheapest-wins-outright would let a model with zero
    // known real capability (AA tracks a price for it but never scored its
    // intelligence or coding) win Economy purely on price. Requiring at
    // least one of the two composite indices is the same real floor every
    // other role already has, just applied before ranking by price.
    {
      role: "Economy",
      compute: (m) => {
        const intel = resolveMetric(registry, m, "intelligenceIndex");
        const coding = resolveMetric(registry, m, "codingIndex");
        return intel == null && coding == null ? null : resolveMetric(registry, m, "priceInputPerMTok");
      },
      better: "min"
    }
  ];
}

function toTeamModel(model, available, registry = null) {
  const base = { adapterId: model.adapterId, modelId: model.modelId, displayName: model.displayName, available };
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


// Calibrated directly against real measured data, not picked arbitrarily.
// Per explicit decision: capability alone isn't the only thing that
// matters — a model being capable of everything doesn't mean it should
// always be the one doing it, especially when a real, meaningfully
// cheaper alternative is genuinely close enough. Two real data points
// anchor this band: Claude Fable 5.1 vs OpenCode Go's Kimi K3 sit ~6.6%
// apart on codingIndex (real GPQA scores are within 0.2 points of each
// other — the composite index alone overstates the gap) at roughly a
// third of the price, while Fable 5.1 vs Codex GPT-5.6 Sol on coding sit
// ~5.2% apart with no price advantage either way. 8% includes the
// genuinely-close, meaningfully-cheaper case without swallowing gaps
// this codebase has already confirmed are real and decisive elsewhere
// (e.g. the 18%+ gaps used in this file's own tests).
const NEAR_EQUIVALENCE_BAND = 0.08;

// Portfolio-level concentration limits — applied to BOTH teams while
// assigning roles, not just a per-role decision. Seven independent
// per-role winners don't form a team: without these, the same one or two
// real models/providers can end up covering every technical role, which
// is a monoculture risk (a single outage or rate-limit takes out the
// whole portfolio) even when each individual pick was locally correct.
// Economy is deliberately exempt from both limits — it's a distinct,
// single-signal role (real price) with its own hard capability floor
// already, not part of the "coordinate the technical roles" problem these
// limits exist to solve.
const MAX_ROLES_PER_MODEL = 2;
const MAX_TECHNICAL_ROLES_PER_PROVIDER = 3;
const TECHNICAL_ROLES = ["Explorer", "Architect", "Builder", "Debugger", "Tester", "Reviewer"];

function modelKey(model) {
  return `${model.adapterId}::${model.modelId}`;
}

/**
 * The real capability leader's advantage over the rest of a pool, as a
 * fraction of its own value — never a fabricated percentage. A
 * single-candidate pool is trivially decisive (Infinity): there is
 * nothing to concentrate away from.
 */
function leaderAdvantage(pool, better) {
  if (pool.length < 2) return Infinity;
  const leader = pool[0];
  const scale = Math.abs(leader.value) || 1;
  let minDiff = Infinity;
  for (let i = 1; i < pool.length; i += 1) {
    const diff = better === "max" ? leader.value - pool[i].value : pool[i].value - leader.value;
    minDiff = Math.min(minDiff, diff / scale);
  }
  return minDiff;
}

/** A real decisive real-capability advantage (see NEAR_EQUIVALENCE_BAND) is allowed to break the portfolio's concentration limits — a model that dramatically outclasses every other real candidate for a role should never be sacrificed just to spread load. */
function isDecisiveLeader(pool, better) {
  return leaderAdvantage(pool, better) > NEAR_EQUIVALENCE_BAND;
}

/**
 * Orders roles for coordinated assignment: fewer real alternatives first,
 * so the most-constrained roles claim their pick before a more flexible
 * role could have taken it instead. Economy goes last (exempt from
 * concentration, order doesn't matter for it). Builder is always resolved
 * before Reviewer, regardless of pool-size ordering, since Reviewer's
 * independence constraint depends on knowing Builder's chosen provider.
 */
function orderRolesForAssignment(rolePools) {
  const technical = rolePools.filter((r) => r.role !== "Economy");
  const economy = rolePools.filter((r) => r.role === "Economy");
  technical.sort((a, b) => a.pool.length - b.pool.length);
  const reviewerIndex = technical.findIndex((r) => r.role === "Reviewer");
  const builderIndex = technical.findIndex((r) => r.role === "Builder");
  if (reviewerIndex !== -1 && builderIndex !== -1 && reviewerIndex < builderIndex) {
    const [reviewerEntry] = technical.splice(reviewerIndex, 1);
    technical.push(reviewerEntry);
  }
  return [...technical, ...economy].map((r) => r.role);
}

/**
 * Assigns one role's real winner under the portfolio's concentration
 * limits. Never a benchmark or an invented diversity score — diversity is
 * purely a hard constraint on an already-adequate real candidate pool,
 * applied in this order:
 *   1. A decisive real leader (see isDecisiveLeader) always wins, even if
 *      it means exceeding a concentration limit.
 *   2. Otherwise, only candidates that keep every limit intact are
 *      eligible; `sortWithinAllowed` picks among those (each team's own
 *      real priority order — see buildAiTeam/buildEfficientTeam).
 *   3. If NO candidate keeps every limit intact and there's no decisive
 *      leader either, the real leader is repeated anyway — a portfolio
 *      constraint must never force an incapable model in just to satisfy
 *      diversity for its own sake.
 * @param {object} params
 * @param {string} params.role
 * @param {Array<{model: object, value: number}>} params.pool - already
 *   filtered to this role's real candidate pool (capability-band or
 *   capability-floor, per team).
 * @param {"max"|"min"} params.better
 * @param {Map<string, number>} params.modelUsage
 * @param {Map<string, number>} params.providerTechnicalUsage
 * @param {string|null} params.reviewerBuilderAdapter - Builder's chosen
 *   adapterId, only when assigning Reviewer; null otherwise.
 * @param {(candidates: Array<{model: object, value: number}>) => Array<{model: object, value: number}>} params.sortWithinAllowed
 * @param {"capability"|"efficient"} params.mode
 * @returns {{entry: {model: object, value: number}, reasonKind: string|null}|null}
 */
function assignOneRole({ role, pool, better, modelUsage, providerTechnicalUsage, reviewerBuilderAdapter, sortWithinAllowed, mode }) {
  if (!pool.length) return null;

  if (pool.length === 1) {
    const only = pool[0];
    const passes = passesConcentration(only, role, modelUsage, providerTechnicalUsage, reviewerBuilderAdapter);
    if (passes) {
      // capability mode: a lone real winner needs no explanation — this is
      // the common case (most roles have a clear leader well outside the
      // much narrower 8% band). efficient mode: a lone adequate candidate
      // means nothing smaller cleared the capability floor — worth saying.
      return { entry: only, reasonKind: mode === "efficient" ? "only-adequate-floor" : null };
    }
    return { entry: only, reasonKind: "only-adequate-concentration" };
  }

  const leader = pool[0];
  const allowed = pool.filter((candidate) => passesConcentration(candidate, role, modelUsage, providerTechnicalUsage, reviewerBuilderAdapter));

  let candidatePool;
  let forcedReasonKind = null;
  if (allowed.includes(leader)) {
    // The real capability leader doesn't even hit a concentration limit
    // here — let it compete normally against every other real candidate
    // already known to be adequate (CAPABILITY's own diversity priority,
    // or EFFICIENT's real cost/duration/price/throughput chain). A
    // decisive real capability advantage never needs to short-circuit
    // that comparison when there's no actual limit to break.
    candidatePool = allowed;
  } else if (isDecisiveLeader(pool, better)) {
    // The leader IS blocked by concentration, but its real capability
    // advantage over the rest of this pool is decisive (> NEAR_EQUIVALENCE_BAND)
    // — a portfolio limit never sacrifices a real, decisive capability
    // gap just to spread load.
    candidatePool = [leader];
    forcedReasonKind = "decisive-override";
  } else if (allowed.length) {
    candidatePool = allowed;
  } else {
    candidatePool = [leader];
    forcedReasonKind = "only-adequate-concentration";
  }

  const chosen = sortWithinAllowed(candidatePool)[0];
  const reasonKind = forcedReasonKind ?? (chosen === leader ? null : "diversity");
  return { entry: chosen, reasonKind };
}

function passesConcentration(candidate, role, modelUsage, providerTechnicalUsage, reviewerBuilderAdapter) {
  const key = modelKey(candidate.model);
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
 * @param {Array<{role: string, better: string, pool: Array<{model: object, value: number}>}>} rolePools
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
    const { better, pool } = rolePools.find((r) => r.role === role);
    // Snapshot the concentration state as it stood BEFORE this role was
    // assigned — describeEfficiencyChoice must explain a decision using
    // the state that was actually true when it was made, never the
    // portfolio's final state after every later role has also been
    // assigned (which would misattribute a plain capability/price/etc.
    // pick made before any concentration existed as if it had been a
    // deliberate concentration-avoidance move).
    const modelUsageSnapshot = new Map(modelUsage);
    const providerUsageSnapshot = new Map(providerTechnicalUsage);
    if (role === "Economy") {
      results[role] = pool.length
        ? { entry: pool[0], reasonKind: null, modelUsageSnapshot, providerUsageSnapshot }
        : null;
      continue;
    }
    const result = assignOneRole({
      role, pool, better, modelUsage, providerTechnicalUsage,
      reviewerBuilderAdapter: role === "Reviewer" ? builderAdapter : null,
      sortWithinAllowed: makeSorter(role, modelUsage, providerTechnicalUsage), mode
    });
    if (result) {
      result.modelUsageSnapshot = modelUsageSnapshot;
      result.providerUsageSnapshot = providerUsageSnapshot;
      const key = modelKey(result.entry.model);
      modelUsage.set(key, (modelUsage.get(key) ?? 0) + 1);
      providerTechnicalUsage.set(result.entry.model.adapterId, (providerTechnicalUsage.get(result.entry.model.adapterId) ?? 0) + 1);
      if (role === "Builder") builderAdapter = result.entry.model.adapterId;
    }
    results[role] = result;
  }
  return { results, modelUsage, providerTechnicalUsage };
}

function capabilityPool(ranked, better) {
  if (!ranked.length) return [];
  const leader = ranked[0];
  const scale = Math.abs(leader.value) || 1;
  return ranked.filter((entry) => Math.abs(leader.value - entry.value) / scale <= NEAR_EQUIVALENCE_BAND);
}

/** CAPABILITY priority: real capability value, then diversity (least-used model, then least-used provider), then a stable tiebreak. */
function sortByCapabilityPriority(candidates, better, modelUsage, providerTechnicalUsage) {
  return [...candidates].sort((a, b) => {
    if (a.value !== b.value) return better === "max" ? b.value - a.value : a.value - b.value;
    const aModelUsage = modelUsage.get(modelKey(a.model)) ?? 0;
    const bModelUsage = modelUsage.get(modelKey(b.model)) ?? 0;
    if (aModelUsage !== bModelUsage) return aModelUsage - bModelUsage;
    const aProviderUsage = providerTechnicalUsage.get(a.model.adapterId) ?? 0;
    const bProviderUsage = providerTechnicalUsage.get(b.model.adapterId) ?? 0;
    if (aProviderUsage !== bProviderUsage) return aProviderUsage - bProviderUsage;
    const adapterCompare = a.model.adapterId.localeCompare(b.model.adapterId);
    return adapterCompare !== 0 ? adapterCompare : a.model.modelId.localeCompare(b.model.modelId);
  });
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
 *    pool (NEAR_EQUIVALENCE_BAND), the highest-scoring eligible model
 *    wins, UNLESS the portfolio's concentration limits (max 2 roles per
 *    model, max 3 of 6 technical roles per provider) would be exceeded
 *    and a real, near-equivalent alternative exists — then the
 *    less-concentrated alternative is preferred instead. A decisive real
 *    advantage (outside the band) always overrides the limits: capability
 *    is never sacrificed just to spread load.
 * 3. Review independence — Reviewer is additionally constrained off
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
 * @returns {Array<{role: string, primary: object, fallback: object|null, reason: string|null}>}
 */
export function buildAiTeam(models, eligibility = {}, registry = null) {
  const effectiveRegistry = ensureRegistry(models, registry);
  const roleDefinitions = buildAiTeamRoleDefinitions(effectiveRegistry);
  const roleRankings = roleDefinitions.map(({ role, compute, better }) => ({
    role, compute, better, ranked: rankEligible(models, eligibility, compute, better)
  }));

  const rolePools = roleRankings.map(({ role, better, ranked }) => ({
    role, better,
    pool: role === "Economy" ? ranked.slice(0, 1) : capabilityPool(ranked, better)
  }));
  const makeSorter = (role, modelUsage, providerTechnicalUsage) => {
    const { better } = rolePools.find((r) => r.role === role);
    return (candidates) => sortByCapabilityPriority(candidates, better, modelUsage, providerTechnicalUsage);
  };
  const { results } = assignCoordinatedTeam(rolePools, makeSorter, "capability");

  const entries = [];
  for (const { role, compute, better } of roleDefinitions) {
    const result = results[role];
    const eligibleRanked = roleRankings.find((r) => r.role === role).ranked;
    const globalRanked = rankBy(models, compute, better);
    if (!globalRanked.length) continue; // no model anywhere reports this role's real metric — never guessed

    if (!result) {
      const globalLeader = globalRanked[0];
      entries.push({
        role, primary: toTeamModel(globalLeader.model, false, effectiveRegistry), fallback: null,
        reason: "No eligible provider currently covers this role."
      });
      continue;
    }

    const chosen = result.entry;
    const globalLeader = globalRanked[0];
    const globalLeaderEligible = eligibility[globalLeader.model.adapterId]?.ok === true;
    const globalLeaderIsStrictlyBetter = better === "max" ? globalLeader.value > chosen.value : globalLeader.value < chosen.value;
    if (!globalLeaderEligible && globalLeaderIsStrictlyBetter) {
      entries.push({
        role, primary: toTeamModel(globalLeader.model, false, effectiveRegistry), fallback: toTeamModel(chosen.model, true, effectiveRegistry),
        reason: `Real capability leader is temporarily unavailable (${eligibility[globalLeader.model.adapterId]?.reason ?? "not eligible"}).`
      });
      continue;
    }

    const fallbackEntry = eligibleRanked.find((r) => r.model.adapterId !== chosen.model.adapterId);
    const pool = rolePools.find((r) => r.role === role).pool;
    const reviewerLeaderWasBuilderAdapter = role === "Reviewer" && pool.length
      && pool[0].model.adapterId === entries.find((e) => e.role === "Builder")?.primary.adapterId;
    let reason;
    if (reviewerLeaderWasBuilderAdapter && chosen.model.adapterId !== pool[0].model.adapterId) {
      reason = "Kept independent from Builder's provider.";
    } else if (result.reasonKind === "only-adequate-concentration") {
      reason = "Only adequate option — no real alternative avoids concentration without forcing a repeat.";
    } else if (result.reasonKind === "decisive-override") {
      reason = "Decisive real capability advantage — kept despite exceeding the concentration limit.";
    } else if (result.reasonKind === "diversity") {
      reason = "Near-equivalent alternatives — assigned to a different model/provider to avoid concentration.";
    } else {
      reason = null;
    }
    entries.push({
      role, primary: toTeamModel(chosen.model, true, effectiveRegistry),
      fallback: fallbackEntry ? toTeamModel(fallbackEntry.model, true, effectiveRegistry) : null,
      reason
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
  { key: "priceInputPerMTok", better: "min", label: "lower real price" },
  { key: "outputTokensPerSecond", better: "max", label: "higher reported throughput" }
];

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
// fraction of the real capability leader's score to be considered
// "adequate" for a role — a genuinely different policy from
// NEAR_EQUIVALENCE_BAND's "almost identical" test. NEAR_EQUIVALENCE_BAND
// (0.08, ~8%) keeps governing maximum-capability equivalence (AI TEAM's
// near-equivalence pool, Reviewer independence) — it no longer governs
// EFFICIENT TEAM. This floor is intentionally much wider: EFFICIENT
// TEAM's job is "the minimum model that's still genuinely sufficient for
// the role," not "whichever near-identical model happens to be cheaper."
// 0.80 is an initial, explicitly configurable starting point (see
// buildEfficientTeam's `options.capabilityFloor`) — not calibrated
// against measured data the way NEAR_EQUIVALENCE_BAND was, since
// "sufficient" is a product decision, not something derivable from
// benchmark gaps alone.
export const EFFICIENT_CAPABILITY_FLOOR = 0.80;

/**
 * Orders real adequate candidates by the EFFICIENCY_DIMENSIONS priority
 * chain (real per-model economics), then by the portfolio's own
 * concentration state (prefer the less-used model, then the less-used
 * provider), then a real ProviderCapacity signal (quota, resolved
 * per-adapter, never per-model), and only then a stable adapterId/modelId
 * tiebreak so the same real near-tie always resolves the same way run to
 * run.
 * @param {Array<{model: object, value: number}>} candidates
 * @param {ReturnType<import("./model-capability-registry.js").createCapabilityRegistry>} registry
 * @param {Record<string, import("./subscription-pressure-source.js").ProviderCapacity>|null} providerCapacity
 * @param {Map<string, number>} modelUsage
 * @param {Map<string, number>} providerTechnicalUsage
 */
function sortByEfficiencyPriority(candidates, registry, providerCapacity, modelUsage, providerTechnicalUsage) {
  return [...candidates].sort((a, b) => {
    for (const { key, better } of EFFICIENCY_DIMENSIONS) {
      const av = resolveMetric(registry, a.model, key);
      const bv = resolveMetric(registry, b.model, key);
      if (av == null || bv == null || av === bv) continue;
      return better === "max" ? bv - av : av - bv;
    }
    const aModelUsage = modelUsage.get(modelKey(a.model)) ?? 0;
    const bModelUsage = modelUsage.get(modelKey(b.model)) ?? 0;
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
  for (const { key, better, label } of EFFICIENCY_DIMENSIONS) {
    const chosenValue = resolveMetric(registry, chosen.model, key);
    const leaderValue = resolveMetric(registry, leader.model, key);
    if (chosenValue == null || leaderValue == null || chosenValue === leaderValue) continue;
    const chosenIsBetter = better === "max" ? chosenValue > leaderValue : chosenValue < leaderValue;
    if (chosenIsBetter) return `Adequate capability — chosen for ${label}.`;
    break; // this dimension didn't favor the switch; a later real signal must have — no real number to report
  }
  const chosenModelUsage = modelUsage.get(modelKey(chosen.model)) ?? 0;
  const leaderModelUsage = modelUsage.get(modelKey(leader.model)) ?? 0;
  const chosenProviderUsage = providerTechnicalUsage.get(chosen.model.adapterId) ?? 0;
  const leaderProviderUsage = providerTechnicalUsage.get(leader.model.adapterId) ?? 0;
  if (chosenModelUsage < leaderModelUsage || chosenProviderUsage < leaderProviderUsage) {
    return "Adequate capability — assigned to a different model/provider to avoid concentration.";
  }
  const chosenQuota = resolveProviderCapacity(providerCapacity, chosen.model);
  const leaderQuota = resolveProviderCapacity(providerCapacity, leader.model);
  if (chosenQuota != null && leaderQuota != null && chosenQuota > leaderQuota) {
    return "Adequate capability — chosen for lower real provider quota pressure.";
  }
  return "Adequate capability — chosen by a stable tiebreak, no real consumption/cost/duration/price/speed/concentration/quota signal distinguished them.";
}

/**
 * Which eligible, ranked candidates are "adequate" for a role under the
 * capability-floor policy — retain at least `capabilityFloor` fraction of
 * the real leader's score. Roles ranked "min" (Economy, ranked by price)
 * have no meaningful capability floor to apply here: their own compute()
 * already enforces a hard intelligence/coding floor before ranking by
 * price, so every eligible candidate already qualifies as "adequate" —
 * applying a floor to the ranked value (price) would be applying it to
 * the wrong axis entirely.
 */
function adequateCandidates(eligibleRanked, leader, better, capabilityFloor) {
  if (!eligibleRanked.length) return [];
  if (better !== "max") return eligibleRanked;
  const floorValue = leader.value * capabilityFloor;
  return eligibleRanked.filter((entry) => entry.value >= floorValue);
}

/**
 * EFFICIENT TEAM: the minimum real model that's still genuinely
 * sufficient for a role — not "whichever near-identical model happens to
 * be cheaper" — coordinated across the whole portfolio the same way
 * buildAiTeam is, so EFFICIENT TEAM doesn't just trade one monoculture
 * (always the capability leader) for another (always the single cheapest
 * real model). Among eligible candidates that retain at least
 * `options.capabilityFloor` (default EFFICIENT_CAPABILITY_FLOOR, 0.80) of
 * the real capability leader's score, prefers whichever real signal
 * actually reduces resource pressure (see EFFICIENCY_DIMENSIONS — token
 * consumption, then cost, duration, price, throughput), then the
 * portfolio's own concentration state, then a provider's real quota
 * headroom, instead of always taking the raw leader. Never invents a
 * savings percentage or a blended score — only ever orders by a real,
 * already-connected signal, and falls back to a stable tiebreak when none
 * of them distinguish the candidates.
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
  const { capabilityFloor = EFFICIENT_CAPABILITY_FLOOR, providerCapacity = null } = options;
  const effectiveRegistry = ensureRegistry(models, registry);
  const roleDefinitions = buildAiTeamRoleDefinitions(effectiveRegistry);
  const roleRankings = roleDefinitions.map(({ role, compute, better }) => ({
    role, compute, better, ranked: rankEligible(models, eligibility, compute, better)
  }));

  const rolePools = roleRankings.map(({ role, better, ranked }) => ({
    role, better,
    pool: role === "Economy" ? ranked.slice(0, 1) : adequateCandidates(ranked, ranked[0], better, capabilityFloor)
  }));
  const makeSorter = (_role, modelUsage, providerTechnicalUsage) => (candidates) => (
    sortByEfficiencyPriority(candidates, effectiveRegistry, providerCapacity, modelUsage, providerTechnicalUsage)
  );
  const { results } = assignCoordinatedTeam(rolePools, makeSorter, "efficient");

  const entries = [];
  for (const { role, compute, better } of roleDefinitions) {
    const result = results[role];
    const eligibleRanked = roleRankings.find((r) => r.role === role).ranked;
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
    if (result.reasonKind === "only-adequate-floor") {
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
