// The Complete Candidate Catalog: every real model Kairo's four provider
// catalogs (Codex, Claude, Cursor, OpenCode Go) actually report, mapped
// into one uniform ModelCandidateIdentity shape — INCLUDING models with
// zero real Artificial Analysis evidence (UNSCORED). This is deliberately
// a SEPARATE surface from the Automatic Team Pool (buildAiTeam/
// buildEfficientTeam's own capability-gated ranking, model-intelligence.js):
// a model with no real benchmark can still be offered for MANUAL selection
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
// lineageKey/generation/lifecycle are always null/null/"unknown" in this
// module — real generation-supersession detection (which family-specific
// version schemes are comparable, which aren't) is real, undesigned work
// deferred to its own increment. A model is NEVER excluded from this
// catalog, or silently marked superseded, just because its lineage is
// unknown — see the module's own accompanying plan for why that's a hard
// requirement, not a nice-to-have.

import { matchArtificialAnalysisScore } from "./model-intelligence.js";

/**
 * @typedef {object} ModelCandidateIdentity
 * @property {string} candidateKey - `${adapterId}::${modelId}`, this catalog's stable identity key.
 * @property {string} modelId - the exact provider-reported id — what scoring/execution actually use, never the cleaned name.
 * @property {string} modelName - human-readable clean name, with real effort/context/privacy variant tokens stripped (see stripDisplayVariant). Never invented — always derived from the provider's own real displayName.
 * @property {string} rawDisplayName - the provider's own displayName, completely unmodified — the real evidence modelName was derived from. Whatever stripDisplayVariant peeled off (effort/context/privacy tokens) to produce modelName is still visible here, never a separate field: /models --evidence's own "technical detail" is just this string.
 * @property {string} adapterId - "codex" | "claude" | "cursor" | "opencode-go".
 * @property {"automatic"|"manual"} accessMode - whether Kairo can actually launch this candidate itself right now, or whether it's a real, recommendable option the human runs manually (Cursor always; OpenCode Go until its own empirical automatic-execution proof lands — see this module's own doc).
 * @property {"scored"|"partial"|"unscored"} evidenceStatus - "scored": AA matched this exact model AND reports at least one of intelligenceIndex/codingIndex. "partial": AA matched it but both composite indices are null (real match, thin evidence). "unscored": no confident AA match at all. Never role-specific — see this module's own doc for why.
 * @property {string|null} lineageKey - real, recognized model family/lineage — always null in this increment (deferred).
 * @property {string|null} generation - a real, comparable version within that lineage — always null in this increment (deferred).
 * @property {"current"|"superseded"|"unknown"} lifecycle - always "unknown" in this increment (deferred) — an unknown lineage/generation NEVER excludes a candidate from anything downstream.
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

// Whether Kairo can actually launch a candidate itself right now, per
// adapter — real, current state (execution-adapters/index.js's own
// `launchable` flags, intelligence/execution-router.js's checkCandidate),
// not a guess. OpenCode Go stays "manual" until the real empirical
// automatic-execution proof this session's plan calls for
// (`opencode run -m opencode-go/<model>`, verifying real provider
// attribution and Go-only consumption) actually runs and passes — see
// this module's own doc. Cursor is permanently "manual" by design (see
// execution-router.js's own checkCandidate: real task execution always
// refuses it, recommendation never does).
const ACCESS_MODE_BY_ADAPTER = { codex: "automatic", claude: "automatic", cursor: "manual", "opencode-go": "manual" };

function resolveAccessMode(adapterId, modelId) {
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
  return {
    candidateKey: `${adapterId}::${modelId}`, modelId, modelName, rawDisplayName,
    adapterId, accessMode: resolveAccessMode(adapterId, modelId), evidenceStatus: resolveEvidenceStatus(matched),
    lineageKey: null, generation: null, lifecycle: "unknown", resourceCost: resolveResourceCost(rawModel)
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
  return catalog;
}
