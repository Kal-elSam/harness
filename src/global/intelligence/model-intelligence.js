// Cross-references the models Kairo can actually launch right now (each
// provider's real, discovered/documented catalog) with real Artificial
// Analysis benchmark scores — deliberately NOT "download every model AA
// tracks": only the ones we actually have access to matter for routing.
//
// A model with no confident match gets no score, never a guessed one —
// same fail-closed rule as everywhere else in Kairo's routing.

import { bestEvidence } from "./model-capability-registry.js";

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
        priceInputPerMTok: score.priceInputPerMTok ?? null, outputTokensPerSecond: score.outputTokensPerSecond ?? null
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

// Same real metrics as ROLE_DEFINITIONS, relabeled to the seven-role team
// vocabulary the user settled on for the "AI TEAM" widget (Explorer /
// Architect / Builder / Debugger / Tester / Reviewer / Economy). Kept as a
// separate list — rather than renaming ROLE_DEFINITIONS in place — so the
// existing bestModelPerRole() contract and its tests stay untouched.
const AI_TEAM_ROLE_DEFINITIONS = [
  { role: "Explorer", compute: (m) => m.intelligenceIndex, better: "max" },
  { role: "Architect", compute: (m) => m.intelligenceIndex, better: "max" },
  { role: "Builder", compute: (m) => m.codingIndex, better: "max" },
  { role: "Debugger", compute: (m) => minOfReal(m.intelligenceIndex, m.codingIndex), better: "max" },
  { role: "Tester", compute: (m) => m.codingIndex, better: "max" },
  { role: "Reviewer", compute: (m) => minOfReal(m.intelligenceIndex, m.codingIndex), better: "max" },
  { role: "Economy", compute: (m) => m.priceInputPerMTok, better: "min" }
];

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

/** The best real alternative from a DIFFERENT adapter than `ranked[0]` — null if none exists. */
function rivalOf(ranked) {
  if (!ranked.length) return null;
  return ranked.find((entry) => entry.model.adapterId !== ranked[0].model.adapterId) ?? null;
}

/**
 * How decisive a role's real winner is over the best real alternative from
 * another provider: 0 means a dead tie, larger means a bigger real gap.
 * Infinity means there is no real alternative at all (the winner is
 * forced — never overridden for diversity). Roles are settled in
 * descending order of this value so a genuine capability gap always locks
 * in its true winner before any near-tied role gets spread elsewhere.
 */
function decisiveness(ranked) {
  if (!ranked.length) return -Infinity;
  const rival = rivalOf(ranked);
  if (!rival) return Infinity;
  const scale = Math.abs(ranked[0].value) || 1;
  return Math.abs(ranked[0].value - rival.value) / scale;
}

// Calibrated directly against real measured data, not picked arbitrarily:
// Claude Fable 5.1 vs Codex GPT-6 Astra on intelligence sit ~1.1% apart
// (a real coin flip — no reason to spend the same subscription on every
// role just because it happens to be a hair ahead), while Fable 5.1 vs
// Codex GPT-5.6 Sol on coding sit ~5.2% apart (a real, meaningful edge
// that should never be sacrificed for diversity). 2% sits safely between
// the two so both keep their honest classification.
const NEAR_EQUIVALENCE_BAND = 0.02;

/**
 * The "AI TEAM" distribution policy: decides which real, eligible provider
 * actually gets reserved for each role — not just "who scores highest
 * seven times over," which is what let one model (Fable) win every role
 * that shares a real metric. The policy, in order:
 *
 * 1. Capability floor — a role only considers models that report the real
 *    metric(s) it needs (unchanged from before: `rankBy` drops nulls).
 * 2. Decisive roles settle first — if a role's real winner beats the best
 *    alternative from another provider by more than NEAR_EQUIVALENCE_BAND,
 *    that real advantage is never sacrificed for diversity.
 * 3. Near-equivalent roles spread across providers — among alternatives
 *    within the band, the least-used provider so far wins the tie, so
 *    ties (never real wins) are what create diversity and conserve quota.
 * 4. Review independence — Reviewer is reassigned off Builder's own
 *    provider whenever a real alternative exists, so a model is never the
 *    sole judge of its own family's work.
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
  const roleRankings = AI_TEAM_ROLE_DEFINITIONS.map(({ role, compute, better }) => ({
    role, compute, better, ranked: rankEligible(models, eligibility, compute, better)
  }));

  const settlementOrder = [...roleRankings].sort((a, b) => decisiveness(b.ranked) - decisiveness(a.ranked));
  const usageCount = {};
  const chosenByRole = {};
  for (const { role, ranked } of settlementOrder) {
    if (!ranked.length) { chosenByRole[role] = null; continue; }
    const leader = ranked[0];
    const rival = rivalOf(ranked);
    let pick = leader;
    if (rival) {
      const scale = Math.abs(leader.value) || 1;
      const margin = Math.abs(leader.value - rival.value) / scale;
      if (margin <= NEAR_EQUIVALENCE_BAND) {
        const leaderUsage = usageCount[leader.model.adapterId] ?? 0;
        const rivalUsage = usageCount[rival.model.adapterId] ?? 0;
        if (rivalUsage <= leaderUsage) pick = rival;
      }
    }
    chosenByRole[role] = pick;
    usageCount[pick.model.adapterId] = (usageCount[pick.model.adapterId] ?? 0) + 1;
  }

  // A model is never the sole reviewer of its own family's work when a
  // real independent alternative exists — this is a hard requirement, not
  // a tie-break preference, so it's applied after settlement. But
  // independence never overrides a real capability floor: the swap only
  // happens when an independent alternative is a near-equivalent
  // (same NEAR_EQUIVALENCE_BAND used everywhere else), never when the
  // only other option is decisively worse — forcing a much weaker model
  // in just to satisfy independence would trade away real review quality
  // for a formality.
  const builderPick = chosenByRole.Builder;
  const reviewerRanked = roleRankings.find((r) => r.role === "Reviewer")?.ranked ?? [];
  const currentReviewer = chosenByRole.Reviewer;
  if (builderPick && currentReviewer && currentReviewer.model.adapterId === builderPick.model.adapterId) {
    const scale = Math.abs(currentReviewer.value) || 1;
    const independent = reviewerRanked.find((r) => (
      r.model.adapterId !== builderPick.model.adapterId
      && Math.abs(currentReviewer.value - r.value) / scale <= NEAR_EQUIVALENCE_BAND
    ));
    if (independent) chosenByRole.Reviewer = independent;
    // else: no independent alternative clears the capability floor — keep
    // the same-provider pick rather than forcing a much weaker reviewer.
  }

  const entries = [];
  for (const { role, compute, better } of AI_TEAM_ROLE_DEFINITIONS) {
    const chosen = chosenByRole[role];
    const eligibleRanked = roleRankings.find((r) => r.role === role).ranked;
    const globalRanked = rankBy(models, compute, better);
    if (!globalRanked.length) continue; // no model anywhere reports this role's real metric — never guessed

    if (!chosen) {
      const globalLeader = globalRanked[0];
      entries.push({
        role, primary: toTeamModel(globalLeader.model, false, registry), fallback: null,
        reason: "No eligible provider currently covers this role."
      });
      continue;
    }

    const globalLeader = globalRanked[0];
    const globalLeaderEligible = eligibility[globalLeader.model.adapterId]?.ok === true;
    const globalLeaderIsStrictlyBetter = better === "max" ? globalLeader.value > chosen.value : globalLeader.value < chosen.value;
    if (!globalLeaderEligible && globalLeaderIsStrictlyBetter) {
      entries.push({
        role, primary: toTeamModel(globalLeader.model, false, registry), fallback: toTeamModel(chosen.model, true, registry),
        reason: `Real capability leader is temporarily unavailable (${eligibility[globalLeader.model.adapterId]?.reason ?? "not eligible"}).`
      });
      continue;
    }

    const fallbackEntry = eligibleRanked.find((r) => r.model.adapterId !== chosen.model.adapterId);
    entries.push({
      role, primary: toTeamModel(chosen.model, true, registry),
      fallback: fallbackEntry ? toTeamModel(fallbackEntry.model, true, registry) : null,
      reason: describeChoice(role, chosen, eligibleRanked, builderPick)
    });
  }
  return entries;
}

/** Explains a role's pick only when it isn't the unremarkable default (a clear real win). */
function describeChoice(role, chosen, ranked, builderPick) {
  const leader = ranked[0];
  const rival = rivalOf(ranked);
  if (!rival) return null;
  const scale = Math.abs(leader.value) || 1;
  const marginPct = ((Math.abs(leader.value - rival.value) / scale) * 100).toFixed(1);
  const isDecisiveLeader = leader.model.adapterId === chosen.model.adapterId && Number(marginPct) > NEAR_EQUIVALENCE_BAND * 100;
  if (isDecisiveLeader) return null;
  if (role === "Reviewer" && builderPick && chosen.model.adapterId !== builderPick.model.adapterId && leader.model.adapterId === builderPick.model.adapterId) {
    return "Kept independent from Builder's provider.";
  }
  return `Near-equivalent alternatives (~${marginPct}%) — assigned to balance provider load.`;
}
