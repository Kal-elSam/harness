// The Complete Candidate Catalog: every real model Kairo's four provider
// catalogs (Codex, Claude, Cursor, OpenCode Go) actually report, mapped
// into one uniform ModelCandidateIdentity shape — INCLUDING models with
// zero real Artificial Analysis evidence (UNSCORED). This module also
// builds the two real consumer pools joined against it (see
// buildRecommendationPool/buildAutomaticExecutionPool's own docs near
// the bottom of this file) — deliberately SEPARATE from buildAiTeam/
// buildEfficientTeam's own capability-gated role ranking
// (model-intelligence.js), which this module never reimplements: a
// model with no real benchmark can still be offered for MANUAL selection
// here, but it must never receive an invented score — see
// role-profiles.js's RoleProfile.capabilities for what "scored" actually
// requires per role; this module never computes that, only whether AA
// matched the candidate at all.
//
// Per the real catalog audit this session ran against crm's live
// providers (codex 5, claude 9 documented, opencode-go 27, cursor 223):
// none of the four sources report an explicit usage multiplier anywhere
// — `usageMultiplier` is deliberately NOT a field here yet; adding it
// would mean inventing a number no provider actually gives us. Re-audit
// before adding it, never assume it stays true forever.
//
// lineageKey/generation are populated only for the recognized, conservative
// families in LINEAGE_PARSERS (see its own doc) — every other candidate
// gets null/null, never a guess. lifecycle is computed from THAT: a
// candidate is "superseded" only when a real, strictly newer generation
// under the exact same lineageKey is ALSO present in this same catalog
// (i.e. genuinely accessible, not hypothetical); everything else —
// unrecognized lineage, or the newest (or only) generation within a
// recognized one — is "current" or "unknown", never excluded from
// anything downstream just because its lineage couldn't be determined.

import { matchArtificialAnalysisScore } from "./model-intelligence.js";

/**
 * @typedef {object} ModelCandidateIdentity
 * @property {string} candidateKey - `${adapterId}::${modelId}`, this catalog's stable identity key.
 * @property {string} modelId - the exact provider-reported id — what scoring/execution actually use, never the cleaned name.
 * @property {string} modelName - human-readable clean name, with real effort/context/privacy variant tokens stripped (see stripDisplayVariant). Never invented — always derived from the provider's own real displayName.
 * @property {string} rawDisplayName - the provider's own displayName, completely unmodified — the real evidence modelName was derived from. Whatever stripDisplayVariant peeled off (effort/context/privacy tokens) to produce modelName is still visible here, never a separate field: /models --evidence's own "technical detail" is just this string.
 * @property {string} adapterId - "codex" | "claude" | "cursor" | "opencode-go".
 * @property {"automatic"|"manual"} accessMode - whether Kairo can actually launch this candidate itself right now, or whether it's a real, recommendable option the human runs manually (Cursor's own "auto" router model always; OpenCode Go until its own empirical automatic-execution proof lands — see this module's own doc). Named Cursor models are automatic.
 * @property {"scored"|"partial"|"unscored"} evidenceStatus - "scored": AA matched this exact model AND reports at least one of intelligenceIndex/codingIndex. "partial": AA matched it but both composite indices are null (real match, thin evidence). "unscored": no confident AA match at all. Never role-specific — see this module's own doc for why.
 * @property {string|null} lineageKey - real, recognized model family/lineage (see LINEAGE_PARSERS) — null when the modelId doesn't match any recognized, conservative pattern. Never guessed.
 * @property {number|null} generation - a real, comparable version number within that lineage — null whenever lineageKey is null.
 * @property {"current"|"superseded"|"unknown"} lifecycle - "superseded" only when a real, strictly newer generation under the SAME lineageKey is also present in this catalog; "current" when it's the newest (or only) generation in a recognized lineage; "unknown" whenever lineageKey is null. An unknown lineage NEVER excludes a candidate from anything downstream.
 * @property {{inputPerMTok: number, outputPerMTok: number}|null} resourceCost - real, provider-reported cost, when the provider actually reports one (OpenCode Go today) — never estimated or carried over from a different model.
 */

// Real variant tokens observed across the four live provider catalogs
// this session audited (Cursor's 223-model catalog especially — the only
// source that embeds these directly into displayName text, with no
// separate field). Deliberately separate from model-intelligence.js's
// own CONCENTRATION_SUFFIX_TOKENS (modelId-level, kebab-case) — this
// operates on human display TEXT (space-separated, mixed case, multi-
// word phrases like "Extra High") and per explicit instruction never
// modifies that other table. Longest phrases first so "extra high"
// matches before a lone trailing "high" would. Real product-tier names
// that happen to look like effort words in isolation — Mini, Nano,
// Flash, Pro, Sol, Terra, Luna, Astra, Code — are deliberately absent:
// they're part of a model's real identity (verified against real, very
// differently-priced OpenCode Go siblings, e.g. GLM-5.3 vs GLM-5.3-Flash
// at 1.4/4.4 vs 0.15/0.5 — genuinely different models, never a variant of
// each other), never stripped.
const VARIANT_PHRASES = ["extra high", "minimal", "medium", "thinking", "high", "low", "max", "none", "fast", "1m"];
const PARENTHETICAL_VARIANT = /\s*\(([^()]*)\)\s*$/;

/**
 * Splits a provider's real displayName into a clean modelName and the
 * real variant text stripped from its end — never touches the front of
 * the name (a variant token is only ever a TRAILING modifier in every
 * real example this session's audit found; a word matching the variant
 * vocabulary elsewhere in the name is left alone). Idempotent: a name
 * with no trailing variant tokens returns unchanged with `variant: null`.
 * @param {string} rawDisplayName
 * @returns {{modelName: string, variant: string|null}}
 */
export function stripDisplayVariant(rawDisplayName) {
  const trimmed = String(rawDisplayName ?? "").trim();
  if (!trimmed) return { modelName: trimmed, variant: null };

  let working = trimmed;
  const trailingParts = [];
  const parenMatch = working.match(PARENTHETICAL_VARIANT);
  if (parenMatch) {
    working = working.slice(0, parenMatch.index).trim();
  }

  let tokens = working.split(/\s+/).filter(Boolean);
  const peeled = [];
  let peeling = true;
  while (peeling && tokens.length) {
    peeling = false;
    for (const phrase of VARIANT_PHRASES) {
      const phraseWords = phrase.split(" ");
      if (phraseWords.length > tokens.length) continue;
      const candidate = tokens.slice(tokens.length - phraseWords.length).join(" ").toLowerCase();
      if (candidate === phrase) {
        peeled.unshift(tokens.slice(tokens.length - phraseWords.length).join(" "));
        tokens = tokens.slice(0, tokens.length - phraseWords.length);
        peeling = true;
        break;
      }
    }
  }

  const modelName = tokens.join(" ") || trimmed;
  if (peeled.length) trailingParts.push(peeled.join(" "));
  if (parenMatch) trailingParts.push(`(${parenMatch[1]})`);
  const variant = trailingParts.length ? trailingParts.join(" ") : null;
  return { modelName, variant };
}

// Real, conservative lineage parsers — one per recognized, unambiguous
// naming scheme. Each entry's `match` is deliberately STRICT (anchored
// start and end, no wildcard trailing segments): a modelId that doesn't
// match EXACTLY falls through to the next parser, and if none match, the
// candidate gets lineageKey/generation null — "unknown", never a guess.
// This strictness is itself the safety boundary: Cursor's own re-exposed
// ids append effort-variant suffixes this session's catalog audit found
// (e.g. "gpt-5.6-sol-high-fast", "claude-opus-5-thinking-high") — those
// intentionally DON'T match here and stay unknown, rather than trying to
// also parse Cursor's much larger, effort-suffixed id space in this same
// pass (a separate, later increment, not this one).
//
// claude-{opus|sonnet|fable|haiku}-{version}: Claude's own catalog
// (claude-models.js, "documented" — hand-maintained, regular naming).
// Version "4-8" parses as generation 4.8, "5" as 5.0 — real, verified
// against this session's live audit: opus-4-6 < opus-4-7 < opus-4-8 <
// opus-5; sonnet-4-6 < sonnet-5; fable-5 < fable-5-1.
//
// glm-{version}[-tier]: OpenCode Go's GLM models. A tier suffix (e.g.
// "-flash") produces a DIFFERENT lineageKey ("glm-flash") from the bare
// line ("glm") — verified against real, very differently-priced siblings
// (glm-5.3 at 1.4/4.4 vs glm-5.3-flash at 0.15/0.5 real cost): genuinely
// different products, never comparable generations of each other.
//
// gpt-{version}[-name]: Codex's own catalog. Same tier-suffix-changes-
// lineage rule as GLM — "gpt-6-astra" (lineage "gpt-astra") is never
// compared against "gpt-5.6-sol" (lineage "gpt-sol") or bare "gpt-5.5"
// (lineage "gpt") — verified against this session's audit finding no
// real evidence any of Codex's five current models share a persona name
// at two different generations yet.
//
// A real bug this same session's live-catalog verification caught before
// shipping: GLM/GPT's own trailing-tier group also matched Cursor's
// EFFORT suffixes (e.g. "gpt-5.4-low", "glm-5.2-high") — treating
// "-low"/"-high" as if they were real product names invented fake
// lineages ("gpt-low", "glm-high") that then wrongly compared DIFFERENT
// base generations sharing the same effort word (gpt-5.1-low vs
// gpt-5.2-low vs gpt-5.4-low) as if they were the same real product line,
// marking real, unrelated older generations "superseded" for the wrong
// reason. EFFORT_SUFFIX_WORDS excludes every real effort/mode token this
// session's audit found (mirrors model-intelligence.js's own
// CONCENTRATION_SUFFIX_TOKENS vocabulary, kept separate per that file's
// own "never modify" instruction) — a trailing word matching this set is
// treated as NOT a real tier name, falling through to unrecognized
// (null) rather than inventing a lineage split.
const EFFORT_SUFFIX_WORDS = new Set(["low", "medium", "high", "xhigh", "max", "none", "fast", "thinking"]);
const LINEAGE_PARSERS = [
  { pattern: /^claude-(opus|sonnet|fable|haiku)-(\d+(?:-\d+)?)$/, resolve: (m) => ({ lineageKey: `claude-${m[1]}`, generation: parseVersionToken(m[2]) }) },
  // A real, separate id ordering this session's own live integration
  // verification caught: Claude's documented catalog uses
  // "claude-{tier}-{version}" (claude-sonnet-5), but Cursor's own
  // real re-exposure of the SAME Sonnet 4/4.5/4.6 generations uses
  // "claude-{version}-{tier}" instead (claude-4-sonnet,
  // claude-4.6-sonnet — verified against Cursor's real catalog: no
  // "claude-sonnet-4" id exists there at all for this specific
  // generation, only this reordered form). Resolves to the exact same
  // lineageKey ("claude-sonnet") as the other pattern, so a real
  // "claude-4-sonnet" and a real "claude-sonnet-5" correctly compare
  // as the same lineage's generations 4 and 5 — this is what actually
  // closes the original reported bug (an old Sonnet 4 still appearing
  // as an option once Sonnet 5 is real and accessible).
  { pattern: /^claude-(\d+(?:\.\d+)?)-(opus|sonnet|fable|haiku)$/, resolve: (m) => ({ lineageKey: `claude-${m[2]}`, generation: parseFloat(m[1]) }) },
  { pattern: /^glm-(\d+(?:\.\d+)?)(-[a-z0-9]+)?$/, resolve: (m) => resolveTieredVersion("glm", m[1], m[2]) },
  { pattern: /^gpt-(\d+(?:\.\d+)?)(-[a-z]+)?$/, resolve: (m) => resolveTieredVersion("gpt", m[1], m[2]) }
];

/** Shared by the glm/gpt parsers: a real tier suffix changes lineageKey; an effort-word suffix (Cursor's own re-exposed variants) is NOT a real tier — returns null (unrecognized) instead of inventing a fake lineage split. */
function resolveTieredVersion(base, versionToken, suffix) {
  const tier = suffix ? suffix.slice(1).toLowerCase() : null;
  if (tier && EFFORT_SUFFIX_WORDS.has(tier)) return null;
  return { lineageKey: tier ? `${base}-${tier}` : base, generation: parseFloat(versionToken) };
}

/** Turns Claude's real hyphenated minor-version token ("4-8") into a comparable number (4.8); a bare token ("5") becomes 5. */
function parseVersionToken(token) {
  return parseFloat(token.replace("-", "."));
}

// A real gap this session's own live-catalog verification found AFTER
// EFFORT_SUFFIX_WORDS shipped: rejecting an effort suffix at the TOP
// level (e.g. "claude-opus-5-thinking-high" simply failing to match the
// claude pattern's anchored end) avoided the false lineage, but produced
// a false UNKNOWN instead — a real, genuinely-superseded Cursor variant
// of an old Claude generation (e.g. "claude-sonnet-4-6-thinking-high")
// silently escaped supersession entirely, which would let it keep
// competing as if lineage-unknown. A variant token never changes what
// generation a model actually is — thinking/high/low/medium/xhigh/max/
// none/fast/1m and the "no-zdr" (from "(NO ZDR)") privacy marker are
// real, comprobados (verified against this session's own live catalog)
// suffixes that get stripped to compute a lineageSubjectId BEFORE
// matching against LINEAGE_PARSERS — modelId itself is never touched
// (scoring/execution/candidateKey all still use the real, exact,
// unmodified modelId; lineageSubjectId exists ONLY inside lineage
// resolution). Deliberately the SAME real vocabulary as
// EFFORT_SUFFIX_WORDS (kebab-case tokens here, not display-text words) —
// resolveTieredVersion's own EFFORT_SUFFIX_WORDS check stays as a second,
// defensive layer in case a future suffix token isn't in this set yet.
const LINEAGE_SUFFIX_TOKENS = new Set(["thinking", "high", "low", "medium", "xhigh", "max", "none", "fast", "1m"]);

/**
 * Strips real, verified trailing variant tokens (see LINEAGE_SUFFIX_TOKENS's
 * own doc) from a modelId to compute the id lineage resolution should
 * actually match against — never the modelId used for scoring/execution
 * itself. "no-zdr" (two kebab tokens) is peeled as one unit, matching
 * displayName's own "(NO ZDR)" marker. Idempotent: an id with no
 * recognized trailing tokens returns unchanged.
 * @param {string} modelId
 * @returns {string}
 */
export function stripLineageSuffixes(modelId) {
  let tokens = String(modelId ?? "").split("-").filter(Boolean);
  let peeling = true;
  while (peeling && tokens.length) {
    peeling = false;
    if (tokens.length >= 2 && tokens[tokens.length - 2] === "no" && tokens[tokens.length - 1] === "zdr") {
      tokens = tokens.slice(0, -2);
      peeling = true;
      continue;
    }
    if (LINEAGE_SUFFIX_TOKENS.has(tokens[tokens.length - 1])) {
      tokens = tokens.slice(0, -1);
      peeling = true;
    }
  }
  return tokens.join("-");
}

/**
 * Resolves a real modelId against the recognized, conservative lineage
 * parsers above — null (never a guess) when nothing matches, even after
 * stripping real, verified variant suffixes via stripLineageSuffixes.
 * @param {string} modelId
 * @returns {{lineageKey: string, generation: number}|null}
 */
export function resolveLineage(modelId) {
  const subjectId = stripLineageSuffixes(modelId);
  for (const { pattern, resolve } of LINEAGE_PARSERS) {
    const match = subjectId.match(pattern);
    if (match) return resolve(match);
  }
  return null;
}

/**
 * Computes each candidate's real "current"/"superseded"/"unknown"
 * lifecycle from lineageKey/generation already resolved onto it —
 * "superseded" only when a real, strictly newer generation under the
 * SAME lineageKey is ALSO present in `catalog` (i.e. genuinely
 * accessible right now, not merely a known future release). Returns a
 * NEW array (candidates are copied, never mutated in place).
 * @param {Array<ModelCandidateIdentity>} catalog
 * @returns {Array<ModelCandidateIdentity>}
 */
function applyLifecycle(catalog) {
  const maxGenerationByLineage = new Map();
  for (const candidate of catalog) {
    if (candidate.lineageKey == null) continue;
    const current = maxGenerationByLineage.get(candidate.lineageKey);
    if (current == null || candidate.generation > current) maxGenerationByLineage.set(candidate.lineageKey, candidate.generation);
  }
  return catalog.map((candidate) => {
    if (candidate.lineageKey == null) return { ...candidate, lifecycle: "unknown" };
    const max = maxGenerationByLineage.get(candidate.lineageKey);
    return { ...candidate, lifecycle: candidate.generation < max ? "superseded" : "current" };
  });
}

// Whether Kairo can actually launch a candidate itself right now, per
// adapter — real, current state (execution-adapters/index.js's own
// `launchable` flags, intelligence/execution-router.js's checkCandidate),
// not a guess. OpenCode Go stays "manual" until the real empirical
// automatic-execution proof this session's plan calls for
// (`opencode run -m opencode-go/<model>`, verifying real provider
// attribution and Go-only consumption) actually runs and passes — see
// this module's own doc. Cursor is "automatic": its own execution
// adapter (execution-adapters/cursor.js) already builds a real,
// auditable non-interactive launch (`cursor-agent -p --output-format
// stream-json`) and parses its structured event stream, the exact same
// shape as Codex/Claude — Cursor's own docs explicitly support this
// (headless/CI use is an intended, documented capability, not a hack).
// The earlier "permanent manual" policy predated this adapter being
// finished and had no technical or billing reason behind it (unlike
// OpenCode Go's real, confirmed Go/Zen billing-attribution gap above).
const ACCESS_MODE_BY_ADAPTER = { codex: "automatic", claude: "automatic", cursor: "automatic", "opencode-go": "manual" };

function resolveAccessMode(adapterId, modelId) {
  // Cursor's own "auto" router picks whichever underlying model it wants
  // per request — an opaque, non-deterministic identity Kairo can't
  // attribute to a real scored model, so THIS one candidate stays manual
  // even though named Cursor models are now real automatic candidates.
  if (adapterId === "cursor" && modelId === "auto") return "manual";
  return ACCESS_MODE_BY_ADAPTER[adapterId] ?? "manual";
}

function resolveEvidenceStatus(matched) {
  if (!matched) return "unscored";
  return matched.intelligenceIndex == null && matched.codingIndex == null ? "partial" : "scored";
}

function resolveResourceCost(rawModel) {
  const input = rawModel?.costInputPerMTok;
  const output = rawModel?.costOutputPerMTok;
  return typeof input === "number" && typeof output === "number" ? { inputPerMTok: input, outputPerMTok: output } : null;
}

/**
 * Builds one ModelCandidateIdentity for a single real provider model —
 * the Cursor "auto" router gets an honest, deliberately opaque identity
 * (never an assumed inner model): modelName "Cursor Auto", no variant,
 * always unscored/manual/unknown-lifecycle.
 * @param {string} adapterId
 * @param {{id: string, displayName?: string}} rawModel
 * @param {Array<object>} aaModels
 * @param {(modelId: string, aaModels: Array<object>) => object|null} matcher
 * @returns {ModelCandidateIdentity}
 */
function buildCandidateIdentity(adapterId, rawModel, aaModels, matcher) {
  const modelId = rawModel.id;
  const rawDisplayName = rawModel.displayName ?? modelId;

  if (adapterId === "cursor" && modelId === "auto") {
    return {
      candidateKey: `${adapterId}::${modelId}`, modelId, modelName: "Cursor Auto", rawDisplayName,
      adapterId, accessMode: "manual", evidenceStatus: "unscored",
      lineageKey: null, generation: null, lifecycle: "unknown", resourceCost: null
    };
  }

  const { modelName } = stripDisplayVariant(rawDisplayName);
  const matched = matcher(modelId, aaModels);
  const lineage = resolveLineage(modelId);
  return {
    candidateKey: `${adapterId}::${modelId}`, modelId, modelName, rawDisplayName,
    adapterId, accessMode: resolveAccessMode(adapterId, modelId), evidenceStatus: resolveEvidenceStatus(matched),
    // lifecycle is resolved in a second pass (applyLifecycle, called from
    // buildCompleteCandidateCatalog) once the WHOLE catalog is known —
    // "superseded" is a statement about this candidate relative to its
    // real siblings, not something a single candidate can determine
    // alone. "unknown" here is only a placeholder for lineage == null;
    // applyLifecycle overwrites it for every recognized lineage.
    lineageKey: lineage?.lineageKey ?? null, generation: lineage?.generation ?? null, lifecycle: "unknown",
    resourceCost: resolveResourceCost(rawModel)
  };
}

/**
 * The Complete Candidate Catalog: every real model across every real
 * provider catalog given, mapped to ModelCandidateIdentity — unfiltered,
 * UNSCORED candidates included. Never the ranking surface (see this
 * module's own doc) — just the real, complete inventory.
 * @param {Array<{adapterId: string, models: Array<{id: string, displayName?: string}>}>} providerCatalogs -
 *   same shape model-intelligence.js's scoreAvailableModels takes, e.g.
 *   `[{ adapterId: "codex", models: readCodexModels().models }, ...]`.
 * @param {Array<object>} aaModels - readArtificialAnalysisModels().models
 * @param {{matchArtificialAnalysisScore?: (modelId: string, aaModels: Array<object>) => object|null}} [deps] -
 *   injectable for tests; defaults to model-intelligence.js's real export.
 * @returns {Array<ModelCandidateIdentity>}
 */
export function buildCompleteCandidateCatalog(providerCatalogs, aaModels, deps = {}) {
  const matcher = deps.matchArtificialAnalysisScore ?? matchArtificialAnalysisScore;
  const catalog = [];
  for (const { adapterId, models } of providerCatalogs) {
    for (const rawModel of models ?? []) {
      catalog.push(buildCandidateIdentity(adapterId, rawModel, aaModels, matcher));
    }
  }
  return applyLifecycle(catalog);
}

/**
 * @typedef {object} RecommendationPoolCandidate
 * One real scoreAvailableModels() entry (adapterId, modelId,
 * intelligenceIndex, codingIndex, priceInputPerMTok, etc. — completely
 * untouched, never recomputed), spread together with: candidateKey,
 * modelName, accessMode, evidenceStatus, lineageKey, generation,
 * lifecycle, resourceCost from the joined ModelCandidateIdentity.
 * `resourceCost` and `priceInputPerMTok` are DELIBERATELY separate
 * fields — OpenCode Go's own real per-model cost is never blended into
 * or mistaken for AA's price figure, even when both exist for the same
 * candidate.
 */

/**
 * The Recommendation Pool: every real, scored candidate (from
 * scoreAvailableModels — the same real AA-matched pool buildAiTeam/
 * buildEfficientTeam already consume) that is NOT superseded, enriched
 * with its real ModelCandidateIdentity fields via a candidateKey join.
 * Deliberately does NOT recompute capability/role fit itself — that
 * stays model-intelligence.js's own job; a caller feeds this pool's
 * output straight into buildAiTeam/buildEfficientTeam/
 * bestModelPerRoleGlobal/etc. as their own `models` argument, in place
 * of raw scoreAvailableModels() output, so QUALITY/EFFICIENT TEAM
 * naturally stop considering a real, superseded old generation without
 * either team's own ranking logic needing to know why.
 *
 * "current" and "unknown" lifecycle candidates are BOTH kept — an
 * unrecognized lineage never excludes a real candidate from being
 * recommended, only a PROVEN newer same-lineage successor does. Manual-
 * only real candidates (Cursor, OpenCode Go today) are kept too — this
 * pool answers "what can Kairo honestly recommend", not "what can Kairo
 * launch by itself" (see buildAutomaticExecutionPool for that).
 * @param {Array<object>} scoredAll - scoreAvailableModels() output, every candidate provider regardless of eligibility.
 * @param {Array<ModelCandidateIdentity>} completeCatalog - buildCompleteCandidateCatalog() output, same provider catalogs.
 * @returns {Array<RecommendationPoolCandidate>}
 */
export function buildRecommendationPool(scoredAll, completeCatalog) {
  const identityByKey = new Map(completeCatalog.map((identity) => [identity.candidateKey, identity]));
  const pool = [];
  for (const scored of scoredAll) {
    const candidateKey = `${scored.adapterId}::${scored.modelId}`;
    const identity = identityByKey.get(candidateKey);
    // No real catalog identity for this exact scored candidate is only
    // possible if the caller passed mismatched provider catalogs to
    // scoreAvailableModels vs buildCompleteCandidateCatalog — defensive,
    // never excludes: an un-joined candidate is treated as lineage-
    // unknown, exactly like any other real unrecognized lineage.
    if (identity?.lifecycle === "superseded") continue;
    pool.push({
      ...scored,
      candidateKey,
      modelName: identity?.modelName ?? scored.displayName ?? scored.modelId,
      accessMode: identity?.accessMode ?? "manual",
      evidenceStatus: identity?.evidenceStatus ?? "scored",
      lineageKey: identity?.lineageKey ?? null,
      generation: identity?.generation ?? null,
      lifecycle: identity?.lifecycle ?? "unknown",
      resourceCost: identity?.resourceCost ?? null
    });
  }
  return pool;
}

/**
 * The Automatic Execution Pool: the subset of the Recommendation Pool
 * Kairo can actually launch itself, right now — real routing's own
 * candidate source, never QUALITY/EFFICIENT TEAM's. Requires BOTH a real
 * accessMode of "automatic" (OpenCode Go is currently manual, and
 * Cursor's own "auto" router model stays manual — see
 * ModelCandidateIdentity's own doc) AND real,
 * current eligibility (adapter availability, quota, launchability — the
 * exact same `eligibility` object checkCandidate/execution-router.js
 * already compute, reused here rather than reimplemented). Never
 * mutates or filters the Recommendation Pool itself — a manual-only real
 * recommendation (Cursor, say) stays fully visible there; a caller that
 * wants to actually RUN a task must separately produce a real
 * "Continue in Cursor"-style handoff for it, never a silent fallback to
 * a different, automatically-launchable model the human didn't ask for.
 * @param {Array<RecommendationPoolCandidate>} recommendationPool
 * @param {Record<string, {ok: boolean, reason?: string}>} eligibility - checkCandidate() results per adapterId.
 * @returns {Array<RecommendationPoolCandidate>}
 */
export function buildAutomaticExecutionPool(recommendationPool, eligibility) {
  return recommendationPool.filter((candidate) => candidate.accessMode === "automatic" && eligibility[candidate.adapterId]?.ok === true);
}
