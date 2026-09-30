// Combines a real ProjectProfile (project-profile.js), a real, already-
// validated ProjectAnalysis from the Bootstrap Analyst (project-analysis.js
// — which the analyst produced by actually reading the project, not a
// fixed mechanical checklist), and the real candidate pool (scoreAvailableModels
// output, eligibility, and the Model Intelligence Foundation registry —
// exactly what buildAiTeam/buildEfficientTeam already need) into a
// ProjectStrategy: which roles THIS project actually needs, AND which
// real model wins each one — genuinely re-scored against the project's
// own real, analyst-derived capabilities per role, never just the generic
// global team filtered down to a subset of role names.
//
// bootstrapAnalyst is NOT decided in this module — by the time
// buildProjectStrategy runs, the human has already chosen and confirmed a
// real model (see computeBootstrapAnalystCatalog + ProjectOverlay's
// preflight/select/confirm/analyze flow),
// and that model has already produced the real analysis this module
// consumes. The analyst never picks the team; it only investigates.

import {
  buildAiTeam, buildEfficientTeam, ensureRegistry, modelIdentityKey, rankCandidatesByRequirements
} from "../intelligence/model-intelligence.js";
import { ROLE_CAPABILITIES } from "../intelligence/role-profiles.js";
import { computeRoleEvaluations } from "../intelligence/capability-scoring.js";
import { BOOTSTRAP_ANALYST_PROFILE } from "./bootstrap-analyst-profile.js";
import { ENTITLEMENT } from "../observability/claude-model-entitlement.js";
import { QUALIFICATION, classifyAnalystCatalog, compareAnalystRows } from "./analyst-qualification.js";

// The Bootstrap Analyst investigates read-only via askProvider
// (intelligence/quick-ask.js), which only actually supports these
// providers today — offering any other real candidate as an "alternative"
// here would be a menu item Kairo can't actually run. Exported: ASK mode's
// own real-time routing (service.js's planAsk) needs this exact same real
// constraint when it tries to route a plain question through a PROJECT
// TEAM role.
//
// Pure CAPABILITY (can askProvider invoke this adapter's CLI at all?),
// never a cost-risk judgment — OpenCode Zen's real PAYG billing risk is
// deliberately NOT re-litigated here; that's checkCandidate's own job
// (it hard-excludes opencode-zen unconditionally), and the real
// eligibility this module receives already reflects that exclusion. Both
// opencode-go and opencode-zen genuinely run through the same real
// askOpencode call (Kairo's own read-only agent — see
// intelligence/opencode-ask-agent.js), same as real execution routing
// already treats capability and cost-risk as two separate layers.
export const ASK_SUPPORTED_ADAPTERS = new Set(["codex", "claude", "cursor", "opencode-go", "opencode-zen"]);

// "Unavailable" means absent from every real selector entirely — never
// merely flagged with a warning tag. Denied and unverified are the two
// real per-model blocking statuses (see model-candidate-catalog.js's own
// resolveEntitlement); a candidate with either must never appear in the
// Bootstrap Analyst catalog or the project team role editor, scored or
// unscored. A model reappears only once a real check reports allowed or
// not_applicable.
export const BLOCKED_ENTITLEMENTS = new Set([ENTITLEMENT.DENIED, ENTITLEMENT.UNVERIFIED]);

// T20 (user decision, supersedes T10's "BLOCKED_ENTITLEMENTS unchanged" for
// UNVERIFIED only): the Bootstrap Analyst picker keeps UNVERIFIED-access
// models as selectable rows (access is UNKNOWN, not denied). They are never
// `available` (the safe-to-run-now flag), never starred, never a default and
// never picked by automatic recovery; the analyze path re-verifies access on
// selection. DENIED stays excluded everywhere. Every other surface (team edit
// catalog, unscored list, router) keeps using BLOCKED_ENTITLEMENTS.
const isAccessUnverified = (model) => model?.entitlement === ENTITLEMENT.UNVERIFIED;
const isAccessDenied = (model) => model?.entitlement === ENTITLEMENT.DENIED;

// The Bootstrap Analyst profile (single definition shared with the analyst
// prompt) lives in bootstrap-analyst-profile.js; re-exported here for the
// existing import sites.
export { BOOTSTRAP_ANALYST_PROFILE };

function modelRef(teamModel) {
  if (!teamModel) return null;
  return { adapterId: teamModel.adapterId, modelId: teamModel.modelId, displayName: teamModel.displayName ?? null };
}

/**
 * The richer model reference `projectTeam` entries carry — adds
 * `candidateKey` (the identity/scoring join key) and `accessMode`
 * (subscription/API/manual — see model-candidate-catalog.js) on top of
 * `modelRef`'s plain adapterId/modelId/displayName, since projectTeam is
 * the OPERATIONAL team a real router resolves against, not just
 * comparative evidence — it needs enough to actually route and launch.
 */
function projectModelRef(teamModel) {
  if (!teamModel) return null;
  return {
    candidateKey: teamModel.candidateKey ?? null, adapterId: teamModel.adapterId, modelId: teamModel.modelId,
    displayName: teamModel.displayName ?? null, accessMode: teamModel.accessMode ?? null
  };
}

/**
 * The project's own real role->capabilities map, straight from its (by
 * now analyst-derived) roleRequirements — never the generic global
 * table's OWN capability set. But whether a project-derived capability
 * is required or merely optional still comes from the global table's own
 * measured required/optional split (ROLE_CAPABILITIES[role].optional) —
 * `requirement.capabilities` itself is a flat array (project-analysis.js's
 * deriveRoleRequirements never distinguishes required from optional; the
 * Bootstrap Analyst's own schema doesn't ask for that distinction
 * either), and passing a flat array straight through would hit
 * normalizeRoleCapabilities' legacy branch — "every entry required" —
 * silently reintroducing the exact scarce-evidence problem the required/
 * optional split fixed globally (e.g. a project need citing
 * softwareExecution would make it a hard requirement again, per
 * role-profiles.js's own measured ~2-3-candidates-system-wide finding).
 * A capability the project cites that ALSO appears in the role's global
 * optional list stays optional here; everything else (the role's own
 * global-required capabilities, plus anything project-specific the
 * analyst found real evidence for that isn't in the global optional
 * list) stays required — the project's own real evidence is still
 * trusted, just not blindly promoted past what's already known to be
 * thin evidence system-wide.
 */
function projectRoleCapabilities(profile) {
  return Object.fromEntries(profile.roleRequirements.map((requirement) => {
    const globalOptional = new Set(ROLE_CAPABILITIES[requirement.role]?.optional ?? []);
    const required = requirement.capabilities.filter((capability) => !globalOptional.has(capability));
    const optional = requirement.capabilities.filter((capability) => globalOptional.has(capability));
    return [requirement.role, { required, optional }];
  }));
}

function candidateKeyOf(model) {
  return model.candidateKey ?? `${model.adapterId}::${model.modelId}`;
}

/**
 * The analyst order, from the SHARED quality evaluator (model-intelligence.js
 * rankCandidatesByRequirements — the machinery every team role already uses):
 * required capabilities first, comparable evidence before thin evidence,
 * optional capabilities only as a tie-break, a stable identifier last. Quality
 * is never multiplied by confidence and magnitudes of different benchmarks are
 * never mixed.
 *
 * Evidence is counted ONCE: routes that carry the same benchmark row (same AA
 * slug — the same model through several subscriptions) enter the comparison as
 * a single entry, then every route inherits that entry's evaluation and gets an
 * adjacent rank ordered by candidateKey.
 *
 * Returns, per candidateKey: `{rank, qualification, identityKey, evaluation}`.
 * A row without sufficient REQUIRED evidence has `rank: null`; nothing is
 * invented for it.
 * @param {object[]} pool - every non-denied, ask-supported scored candidate
 * @param {object|null} registry
 * @param {typeof BOOTSTRAP_ANALYST_PROFILE} [profile]
 * @returns {Map<string, {rank: number|null, qualification: string, identityKey: string, evaluation: object}>}
 */
function evaluateAnalystPool(pool, registry, profile = BOOTSTRAP_ANALYST_PROFILE) {
  const results = new Map();
  if (!pool.length) return results;
  const { required, optional } = profile.capabilities;
  const groups = new Map();
  for (const model of [...pool].sort((a, b) => candidateKeyOf(a).localeCompare(candidateKeyOf(b)))) {
    const evidenceKey = model.slug ?? candidateKeyOf(model);
    groups.set(evidenceKey, [...(groups.get(evidenceKey) ?? []), model]);
  }
  const groupOf = new Map([...groups.values()].flatMap((routes) => routes.map((route) => [candidateKeyOf(route), routes])));
  const representatives = [...groups.values()].map((routes) => routes[0]);
  const { ranked, unranked } = rankCandidatesByRequirements(
    representatives, ensureRegistry(representatives, registry), { role: profile.role, capabilities: { required, optional } }
  );
  const capabilityOrNull = (values, capability) => (typeof values?.[capability] === "number" ? values[capability] : null);
  let nextRank = 1;
  for (const entry of ranked) {
    const evaluation = {
      comparable: entry.comparable,
      confidence: entry.confidence,
      capabilities: { reasoning: capabilityOrNull(entry.capabilities, "reasoning"), coding: capabilityOrNull(entry.capabilities, "coding") },
      benchmarkCounts: { reasoning: entry.benchmarkCounts?.reasoning ?? null, coding: entry.benchmarkCounts?.coding ?? null },
      optionalEvidence: entry.optionalFit != null,
      missing: []
    };
    for (const route of groupOf.get(candidateKeyOf(entry.model))) {
      results.set(candidateKeyOf(route), {
        rank: nextRank++,
        qualification: entry.comparable ? QUALIFICATION.QUALIFIED : QUALIFICATION.PARTIAL,
        identityKey: modelIdentityKey(route), evaluation
      });
    }
  }
  for (const entry of unranked) {
    const evaluation = {
      comparable: null, confidence: null,
      capabilities: { reasoning: capabilityOrNull(entry.capabilities, "reasoning"), coding: capabilityOrNull(entry.capabilities, "coding") },
      benchmarkCounts: { reasoning: entry.benchmarkCounts?.reasoning ?? null, coding: entry.benchmarkCounts?.coding ?? null },
      optionalEvidence: false, missing: entry.missing
    };
    const hasAny = entry.missing.length < required.length;
    for (const route of groupOf.get(candidateKeyOf(entry.model))) {
      results.set(candidateKeyOf(route), {
        rank: null, qualification: hasAny ? QUALIFICATION.INSUFFICIENT : QUALIFICATION.NONE,
        identityKey: modelIdentityKey(route), evaluation
      });
    }
  }
  return results;
}

/** Evaluation of a model with no benchmark at all: every field unknown. */
const noEvaluation = () => ({
  comparable: null, confidence: null, capabilities: { reasoning: null, coding: null },
  benchmarkCounts: { reasoning: null, coding: null }, optionalEvidence: false, missing: [...BOOTSTRAP_ANALYST_PROFILE.capabilities.required]
});

function quotaFor(providerCapacity, adapterId) {
  return providerCapacity?.[adapterId]?.quotaRemainingPercent ?? null;
}

/**
 * The full real Bootstrap Analyst catalog — every real, ask-supported
 * (see ASK_SUPPORTED_ADAPTERS) Codex/Claude candidate askProvider could
 * actually run, scored AND unscored, not just the top Quality/Efficient
 * picks. A real, unscored model (no Artificial Analysis match) is still
 * included — honestly marked `evidenceStatus: "unscored"` — so a human
 * can still pick it manually; Kairo just never recommends one on its own.
 * The ORDER is the shared quality evaluator's (model-intelligence.js
 * rankCandidatesByRequirements, the machinery every team role uses) applied to
 * BOOTSTRAP_ANALYST_PROFILE.capabilities: required capabilities first,
 * comparable evidence before thin evidence, optional capabilities only as a
 * tie-break. This function never invents a second ranking formula; it projects
 * that one result (`rank`, `qualification`, `evaluation`) into the catalog and
 * only the "efficient" tag still comes from the Explorer efficiency balance.
 * @param {object} args - `scoredAll`, `eligibility`, `registry`,
 *   `providerCapacity`, plus
 *   `unscoredModels` (real catalog models with no AA match — see
 *   conversation/service.js's own `unscoredModels`).
 * @returns {{recommendedModel: object|null, models: Array<{candidateKey: string, adapterId: string, modelId: string, displayName: string, evidenceStatus: string, available: boolean, accessVerified: boolean, selectable: boolean, cause: string|null, quota: number|null, rank: number|null, qualification: "qualified"|"partial_evidence"|"insufficient_evidence"|"no_evidence", identityKey: string, evaluation: {comparable: boolean|null, confidence: "high"|"medium"|"low"|null, capabilities: {reasoning: number|null, coding: number|null}, benchmarkCounts: {reasoning: number|null, coding: number|null}, optionalEvidence: boolean, missing: string[]}, recommendationTags: string[]}>, exclusions: Array<{candidateKey: string, adapterId: string, modelId: string, cause: string, reason: string|null}>}}
 */
export function computeBootstrapAnalystCatalog({
  scoredAll, manualSelectionScoredPool = scoredAll, eligibility, registry,
  providerCapacity = null, unscoredModels = []
}) {
  // Restrict the CANDIDATE POOL itself to ask-supported adapters before
  // ranking — not a post-hoc check on the winner — so the real portfolio
  // logic picks the best real candidate among what Kairo can actually
  // invoke, the same way it would for any other real role. Filtering
  // after the fact would silently lose a genuinely real 2nd/3rd-place
  // candidate whenever the unsupported provider happened to rank #1.
  const askSupportedRecommended = scoredAll.filter((model) => ASK_SUPPORTED_ADAPTERS.has(model.adapterId));
  const askSupportedScoredAll = manualSelectionScoredPool.filter((model) => (
    ASK_SUPPORTED_ADAPTERS.has(model.adapterId) && !isAccessDenied(model)
  ));
  // scoredAll (the Recommendation Pool) already excludes superseded
  // candidates (buildRecommendationPool); unscoredModels doesn't go
  // through that pool, so the same real "not superseded" rule is applied
  // here too — defense in depth, never trusting the caller alone to have
  // already filtered a real, proven-stale candidate out.
  const askSupportedUnscored = unscoredModels.filter((model) => (
    ASK_SUPPORTED_ADAPTERS.has(model.adapterId)
    && model.lifecycle !== "superseded"
    && !isAccessDenied(model)
  ));

  const roleCapabilities = { Explorer: BOOTSTRAP_ANALYST_PROFILE.capabilities };
  // ONE comparison for every route, verified or not: verification changes who
  // may be listed, never the order.
  const evaluations = evaluateAnalystPool(askSupportedScoredAll, registry);
  const efficientTeam = buildEfficientTeam(askSupportedRecommended, eligibility, registry, { providerCapacity, roleCapabilities });
  const efficient = efficientTeam.find((entry) => entry.role === "Explorer")?.primary ?? null;
  const efficientKey = efficient ? candidateKeyOf(efficient) : null;

  // Exclusion causes (machine-readable). Verified-denied models are absent
  // from `models` by design, so their cause travels in `exclusions` instead.
  // Unverified access (UNKNOWN, never unavailability) is selectable since T20
  // and lives in `models` with cause "access_unknown"; only unverified
  // UNSCORED models (hidden upstream) still surface here.
  const entitlementCause = (entitlement) => (
    entitlement === ENTITLEMENT.DENIED ? "unavailable_verified" : "access_unknown"
  );
  const scoredKeys = new Set([...askSupportedScoredAll, ...askSupportedUnscored].map(candidateKeyOf));
  const exclusions = [];
  const seenExcluded = new Set();
  for (const model of [...manualSelectionScoredPool, ...unscoredModels]) {
    if (!ASK_SUPPORTED_ADAPTERS.has(model.adapterId) || !BLOCKED_ENTITLEMENTS.has(model.entitlement)) continue;
    if (isAccessUnverified(model) && scoredKeys.has(candidateKeyOf(model))) continue;
    const key = candidateKeyOf(model);
    if (seenExcluded.has(key)) continue;
    seenExcluded.add(key);
    exclusions.push({
      candidateKey: key, adapterId: model.adapterId, modelId: model.modelId,
      cause: entitlementCause(model.entitlement), reason: model.entitlementReason ?? null
    });
  }
  // Unavailable (eligibility not ok): the router's own cause, else the
  // verified-unavailable default (checkCandidate only says !ok on real evidence).
  const unavailableCause = (adapterId) => eligibility[adapterId]?.cause ?? "unavailable_verified";

  const scoredEntries = askSupportedScoredAll.map((model) => {
    const key = candidateKeyOf(model);
    const unverified = isAccessUnverified(model);
    const providerOk = eligibility[model.adapterId]?.ok === true;
    const recommendationTags = [];
    // An unverified-access model is never starred or tagged, whatever the
    // caller's recommendation pool says. The "quality" tag/star is assigned
    // below, from the unified ranking (never the old Explorer/Pareto pick).
    if (!unverified && key === efficientKey) recommendationTags.push("efficient");
    const verdict = evaluations.get(key);
    return {
      candidateKey: key, adapterId: model.adapterId, modelId: model.modelId,
      displayName: model.modelName ?? model.displayName ?? model.modelId,
      evidenceStatus: model.evidenceStatus ?? "scored",
      entitlement: model.entitlement ?? null,
      entitlementReason: model.entitlementReason ?? null,
      // `available` = safe to run now. Unknown access is not that.
      available: providerOk && !unverified,
      accessVerified: !unverified,
      selectable: providerOk,
      cause: !providerOk ? unavailableCause(model.adapterId) : unverified ? "access_unknown" : null,
      quota: quotaFor(providerCapacity, model.adapterId),
      rank: verdict?.rank ?? null,
      qualification: verdict?.qualification ?? QUALIFICATION.NONE,
      identityKey: verdict?.identityKey ?? modelIdentityKey(model),
      // The benchmark row the evidence comes from (AA slug): routes sharing it
      // carry the same evidence, counted once.
      evidenceKey: model.slug ?? null,
      evaluation: verdict?.evaluation ?? noEvaluation(),
      recommendationTags
    };
  });
  const unscoredEntries = askSupportedUnscored.map((model) => {
    const providerOk = eligibility[model.adapterId]?.ok === true;
    const unverified = isAccessUnverified(model);
    return {
    candidateKey: candidateKeyOf(model), adapterId: model.adapterId, modelId: model.modelId,
    displayName: model.displayName ?? model.modelId,
    evidenceStatus: "unscored",
    entitlement: model.entitlement ?? null,
    entitlementReason: model.entitlementReason ?? null,
    // Unknown access (no benchmark AND unverified) is a manual candidate that
    // is revalidated on confirm: selectable, never "safe to run now".
    available: providerOk && !unverified,
    accessVerified: !unverified,
    selectable: providerOk,
    // Unscored is a manual-only choice, not unavailability. When the
    // provider itself is unavailable right now, that verified cause wins so
    // the picker never hides why a whole provider is out.
    cause: !providerOk ? unavailableCause(model.adapterId) : unverified ? "access_unknown" : "unscored",
    quota: quotaFor(providerCapacity, model.adapterId),
    // No benchmark exists: no rank, no evaluation, nothing invented.
    // Availability alone makes the model selectable (manual view).
    rank: null, qualification: QUALIFICATION.NONE, identityKey: modelIdentityKey(model), evidenceKey: null, evaluation: noEvaluation(),
    recommendationTags: []
    };
  });

  // Deterministic order (rank, then candidateKey), whatever the input order was.
  const models = [...scoredEntries, ...unscoredEntries].sort(compareAnalystRows);
  // The star: the first row of the ONE classification (same function the
  // picker curation uses) — a qualified, verified, available row, never a
  // per-provider pick and never a name/stack preference.
  const { star } = classifyAnalystCatalog(models);
  if (star) star.recommendationTags = ["quality", ...star.recommendationTags.filter((tag) => tag !== "quality")];
  const recommendedModel = star;
  return { recommendedModel, models, exclusions };
}

/**
 * Builds a "suggested" ProjectStrategy — never "active" (that only happens
 * via explicit human approval, see project-strategy-store.js +
 * conversation/service.js's approveProjectStrategy).
 *
 * orchestrator is the real, project-rescored Architect pick — a decision
 * SEPARATE from bootstrapAnalyst (given in, already confirmed and run by
 * this point), even when they happen to land on the same real model
 * because only one real candidate is accessible right now.
 * @param {object} profile - computeProjectProfile() result, with
 *   roleRequirements already replaced by project-analysis.js's
 *   deriveRoleRequirements() output (real analyst findings + mechanical floor)
 * @param {object} candidates - the real candidate pool: `scoredAll`
 *   (scoreAvailableModels output, every candidate provider), `eligibility`
 *   (checkCandidate results per adapterId), `registry` (Model Intelligence
 *   Foundation registry), `providerCapacity` (optional, for EFFICIENT's
 *   quota tiebreak) — exactly what conversation/service.js's snapshot()
 *   already attaches to modelIntelligence for this purpose.
 * @param {{model: object, choice?: "quality"|"efficient"|null, selectionSource?: "recommended"|"manual", recommendationTags?: string[]}} bootstrapAnalyst -
 *   the real model the human already chose, confirmed, and ran. `choice`
 *   remains persisted for backward compatibility with existing strategies;
 *   any real catalog pick (including a manual/unscored one that fits
 *   neither bucket) is honestly `choice: null`, never forced into one.
 *   `selectionSource`/`recommendationTags` are the real, current contract —
 *   defaulted to "recommended"/`[bootstrapAnalyst.choice]` when a caller
 *   doesn't supply them, for the legacy path's own backward compatibility.
 * @returns {object} ProjectStrategy (status: "suggested")
 */
export function buildProjectStrategy(profile, { scoredAll, eligibility, registry, providerCapacity = null }, bootstrapAnalyst) {
  const roleCapabilities = projectRoleCapabilities(profile);
  const aiTeam = buildAiTeam(scoredAll, eligibility, registry, roleCapabilities);
  const efficientTeam = buildEfficientTeam(scoredAll, eligibility, registry, { providerCapacity, roleCapabilities });

  const byRoleCapability = new Map(aiTeam.map((entry) => [entry.role, entry]));
  const byRoleEfficient = new Map(efficientTeam.map((entry) => [entry.role, entry]));

  // Only a role the profile's own real evidence asked for (roleRequirements)
  // AND that has a real pick (against THIS project's own capability mix)
  // is "active" — a required role with no real eligible model is honestly
  // dropped, never filled with a guess.
  const activeRoles = profile.roleRequirements
    .map((requirement) => requirement.role)
    .filter((role) => byRoleCapability.has(role));

  const qualityTeam = activeRoles.map((role) => {
    const entry = byRoleCapability.get(role);
    return { role, model: modelRef(entry.primary), reason: entry.reason ?? null };
  });
  const efficientRoles = activeRoles.map((role) => {
    const entry = byRoleEfficient.get(role);
    return entry ? { role, model: modelRef(entry.primary), reason: entry.reason ?? null } : { role, model: null, reason: null };
  });

  // The OPERATIONAL team a real router resolves against (see
  // project-router.js) — reuses the exact same real Pareto/risk-floor
  // balance already computed above for efficientTeam (byRoleEfficient),
  // never a third selection formula. qualityTeam/efficientTeam remain
  // comparative evidence only; projectTeam is what Kairo actually
  // delegates to. `assignmentSource` is always "recommended" here — a
  // human override (per-role, never touching this computed ranking) is a
  // separate, later cockpit action that sets it to "override".
  //
  // `fallback` persists the SAME real next-best candidate
  // buildEfficientTeam already computed for this role (its own `fallback`
  // field — the next real eligible candidate under a different adapter,
  // see model-intelligence.js) — never a new alternative-ranking formula.
  // The router uses this, PERSISTED here at analysis time, as its own
  // real `suggestedAlternative` when the primary assignment's eligibility
  // is lost later — alternative selection is domain policy, computed
  // once here, never re-derived independently by the UI/CLI/router (which
  // would risk drifting to different answers for the same real state).
  // recommendedAssignment freezes the real original pick (model, fallback,
  // decisionEvidence) — immutable, never touched by a later override. The
  // top-level model/fallback/decisionEvidence fields are the CURRENT
  // OPERATIONAL assignment (what project-router.js actually resolves
  // against) — identical to recommendedAssignment until a human overrides
  // this role (see applyProjectTeamOverride), at which point they diverge
  // and overrideEvidence records the real access/evidence state behind
  // that specific override, never reusing the original recommendation's
  // own evidence as if it justified a different model.
  const projectTeam = activeRoles.map((role) => {
    const entry = byRoleEfficient.get(role);
    const model = entry ? projectModelRef(entry.primary) : null;
    const fallback = entry?.fallback ? projectModelRef(entry.fallback) : null;
    const decisionEvidence = entry?.decisionEvidence ?? null;
    // The same real, human-readable string efficientTeam's own entries
    // already carry (see buildEfficientTeam/describeEfficiencyDecision) —
    // never a new explanation formula, just surfaced here too so the
    // overlay can show WHY this role got this model, not only which one.
    const reason = entry?.reason ?? null;
    return {
      role, model, fallback, decisionEvidence, reason,
      assignmentSource: "recommended",
      recommendedAssignment: { model, fallback, decisionEvidence, reason },
      overrideEvidence: null
    };
  });

  return {
    status: "suggested",
    bootstrapAnalyst: bootstrapAnalyst.model,
    bootstrapAnalystChoice: bootstrapAnalyst.choice ?? null,
    bootstrapAnalystSelectionSource: bootstrapAnalyst.selectionSource ?? "recommended",
    bootstrapAnalystRecommendationTags: bootstrapAnalyst.recommendationTags ?? (bootstrapAnalyst.choice ? [bootstrapAnalyst.choice] : []),
    orchestrator: modelRef(byRoleCapability.get("Architect")?.primary),
    activeRoles,
    qualityTeam,
    efficientTeam: efficientRoles,
    projectTeam,
    profileFingerprint: profile.fingerprint,
    approvedAt: null
  };
}

/**
 * Whether a persisted, previously-approved ProjectStrategy is STALE — its
 * real underlying evidence (the ProjectProfile it was built from) has
 * genuinely changed, not just "some time has passed". A suggested (never
 * approved) strategy is never marked stale — it wasn't a commitment yet.
 * @param {object|null} strategy - the persisted ProjectStrategy, or null (NOT_ANALYZED)
 * @param {object} currentProfile - a freshly computed ProjectProfile
 * @returns {boolean}
 */
export function isStrategyStale(strategy, currentProfile) {
  if (!strategy || strategy.status !== "active") return false;
  return strategy.profileFingerprint !== currentProfile.fingerprint;
}

// projectTeam editing (section 4 — "Edición persistida del PROJECT TEAM").
// A SUGGESTED strategy only, never active/stale (see applyProjectTeamOverride/
// resetProjectTeamAssignment's own guards) — the review-before-approval
// window, not a way to silently mutate an already-running team.

// Every real adapter a projectTeam role can be assigned to for EXECUTION,
// not just the two askProvider-supported ones the Bootstrap Analyst
// catalog uses (computeBootstrapAnalystCatalog) — Cursor/OpenCode Go are
// real, selectable manual-handoff options here.
const TEAM_EDIT_ADAPTERS = new Set(["codex", "claude", "cursor", "opencode-go"]);

/**
 * The real edit catalog for one role — every real, non-superseded
 * candidate (scored AND unscored) from all four real adapters, each with
 * its own real accessMode/availability/evidenceStatus and (when the
 * registry has real evidence for it) a real RoleEvaluation for this
 * SPECIFIC role — reused via capability-scoring.js's own
 * computeRoleEvaluations, never a new scoring formula. The role's
 * required capabilities come from the GLOBAL role-profiles.js table
 * (ROLE_CAPABILITIES), not the project's own analyst-derived
 * requirements — the persisted ProjectStrategy doesn't carry the full
 * ProjectProfile forward, only its fingerprint, so the project-specific
 * capability mix isn't available again at edit time; the global table is
 * real, existing data, not an invented substitute.
 * @param {string} role
 * @param {object} candidates - `scoredAll`, `eligibility`, `registry`, `unscoredModels`
 * @returns {{role: string, models: Array<{candidateKey: string, adapterId: string, modelId: string, displayName: string, accessMode: string|null, evidenceStatus: string, available: boolean, roleEvaluation: object|null}>}}
 */
export function computeProjectTeamEditCatalog(role, {
  scoredAll = [], manualSelectionScoredPool = scoredAll, eligibility = {}, registry = null, unscoredModels = []
}) {
  const capabilities = ROLE_CAPABILITIES[role];
  if (!capabilities) return { role, models: [] };

  const teamScored = manualSelectionScoredPool.filter((model) => (
    TEAM_EDIT_ADAPTERS.has(model.adapterId) && !BLOCKED_ENTITLEMENTS.has(model.entitlement)
  ));
  // Same "not superseded" real rule the Recommendation Pool applies to
  // scoredAll — unscoredModels doesn't go through that pool, so it's
  // applied here too, defense in depth, never trusting the caller alone.
  const teamUnscored = unscoredModels.filter((model) => (
    TEAM_EDIT_ADAPTERS.has(model.adapterId)
    && model.lifecycle !== "superseded"
    && !BLOCKED_ENTITLEMENTS.has(model.entitlement)
  ));
  // Same real registry-seeding every other role computation relies on
  // (buildAiTeam/buildEfficientTeam's own ensureRegistry) — a caller's
  // real registry might already have richer evidence (Hugging Face,
  // manufacturer snapshots, Kairo's own telemetry); a bare/empty one gets
  // scoreAvailableModels' own AA fields seeded in, never left empty.
  const effectiveRegistry = ensureRegistry(teamScored, registry);
  const evaluations = computeRoleEvaluations(effectiveRegistry, teamScored, role, capabilities.required);

  const scoredEntries = teamScored.map((model) => {
    const key = candidateKeyOf(model);
    return {
      candidateKey: key, adapterId: model.adapterId, modelId: model.modelId,
      displayName: model.modelName ?? model.displayName ?? model.modelId,
      accessMode: model.accessMode ?? null, evidenceStatus: model.evidenceStatus ?? "scored",
      entitlement: model.entitlement ?? null, entitlementReason: model.entitlementReason ?? null,
      available: eligibility[model.adapterId]?.ok === true,
      roleEvaluation: evaluations.get(`${model.adapterId}::${model.modelId}`) ?? null
    };
  });
  const unscoredEntries = teamUnscored.map((model) => ({
    candidateKey: candidateKeyOf(model), adapterId: model.adapterId, modelId: model.modelId,
    displayName: model.displayName ?? model.modelId,
    accessMode: model.accessMode ?? null, evidenceStatus: "unscored",
    entitlement: model.entitlement ?? null, entitlementReason: model.entitlementReason ?? null,
    available: eligibility[model.adapterId]?.ok === true,
    roleEvaluation: null
  }));

  return { role, models: [...scoredEntries, ...unscoredEntries] };
}

/**
 * Whether two real model references identify the SAME real candidate —
 * prefers candidateKey (the real identity/scoring join key), but falls
 * back to adapterId+modelId when either side lacks one, so "is this the
 * same real model as the recommendation" stays correct even for a real
 * model reference that predates the candidateKey join.
 */
function sameModel(a, b) {
  if (!a || !b) return false;
  if (a.candidateKey && b.candidateKey) return a.candidateKey === b.candidateKey;
  return a.adapterId === b.adapterId && a.modelId === b.modelId;
}

function findProjectTeamEntry(strategy, role) {
  if (!strategy) throw new Error("No project strategy to edit — run /project analyze first.");
  if (strategy.status !== "suggested") throw new Error(`Cannot edit a ${strategy.status?.toUpperCase() ?? "UNKNOWN"} project strategy — only a SUGGESTED one is editable.`);
  if (!Array.isArray(strategy.projectTeam)) throw new Error("This project strategy was approved before projectTeam existed — re-analyze and approve to enable editing.");
  const index = strategy.projectTeam.findIndex((entry) => entry.role === role);
  if (index === -1) throw new Error(`"${role}" is not part of this project's team.`);
  return index;
}

/**
 * Applies a manual override to one role — the real, edit-catalog-sourced
 * `candidate` becomes the role's real operational model. Picking the same
 * candidate as the role's own real recommendation is treated as a reset
 * (see resetProjectTeamAssignment), not a redundant override — the plan's
 * own "choosing the recommended model again removes the override" rule.
 * recommendedAssignment is NEVER touched; a legacy entry that predates
 * this field (recommendedAssignment undefined) has its own current real
 * model/fallback/decisionEvidence captured as the recommendation here,
 * lazily, since that WAS this project's real original recommendation
 * before any override existed — never lost, never guessed.
 * @param {object} strategy - the persisted SUGGESTED ProjectStrategy
 * @param {string} role
 * @param {{candidateKey: string, adapterId: string, modelId: string, displayName: string, accessMode?: string|null, available?: boolean, evidenceStatus?: string, roleEvaluation?: object|null}} candidate -
 *   one real entry from computeProjectTeamEditCatalog's own output.
 * @returns {object} the updated ProjectStrategy (still status: "suggested")
 */
export function applyProjectTeamOverride(strategy, role, candidate) {
  const index = findProjectTeamEntry(strategy, role);
  const entry = strategy.projectTeam[index];
  const recommendedAssignment = entry.recommendedAssignment
    ?? { model: entry.model, fallback: entry.fallback ?? null, decisionEvidence: entry.decisionEvidence ?? null, reason: entry.reason ?? null };

  if (sameModel(recommendedAssignment.model, candidate)) {
    return resetProjectTeamAssignment(strategy, role);
  }

  const updatedEntry = {
    ...entry,
    recommendedAssignment,
    model: {
      candidateKey: candidate.candidateKey ?? null, adapterId: candidate.adapterId, modelId: candidate.modelId,
      displayName: candidate.displayName ?? null, accessMode: candidate.accessMode ?? null
    },
    // The real recommendation's own fallback/decisionEvidence/reason
    // describe THAT candidate's Pareto selection, never a human
    // override's — an override has no real computed fallback, decision
    // receipt, or ranking reason of its own (it wasn't chosen by the
    // ranking at all), so all three are honestly cleared rather than left
    // pointing at evidence for a different model, which would
    // misrepresent it as if it applied here.
    fallback: null,
    decisionEvidence: null,
    reason: null,
    assignmentSource: "override",
    overrideEvidence: {
      accessMode: candidate.accessMode ?? null, available: candidate.available ?? null,
      evidenceStatus: candidate.evidenceStatus ?? null, roleEvaluation: candidate.roleEvaluation ?? null,
      entitlement: candidate.entitlement ?? null, entitlementReason: candidate.entitlementReason ?? null
    }
  };
  const projectTeam = [...strategy.projectTeam];
  projectTeam[index] = updatedEntry;
  return { ...strategy, projectTeam };
}

/**
 * Removes a role's override (if any) and restores its real original
 * recommendation — model, fallback, and decisionEvidence exactly as
 * recommendedAssignment froze them. A no-op-shaped call on a role that
 * was never overridden just re-confirms the same real recommendation.
 * @param {object} strategy - the persisted SUGGESTED ProjectStrategy
 * @param {string} role
 * @returns {object} the updated ProjectStrategy (still status: "suggested")
 */
export function resetProjectTeamAssignment(strategy, role) {
  const index = findProjectTeamEntry(strategy, role);
  const entry = strategy.projectTeam[index];
  const recommendedAssignment = entry.recommendedAssignment
    ?? { model: entry.model, fallback: entry.fallback ?? null, decisionEvidence: entry.decisionEvidence ?? null, reason: entry.reason ?? null };
  const updatedEntry = {
    ...entry,
    recommendedAssignment,
    model: recommendedAssignment.model, fallback: recommendedAssignment.fallback,
    decisionEvidence: recommendedAssignment.decisionEvidence, reason: recommendedAssignment.reason ?? null,
    assignmentSource: "recommended",
    overrideEvidence: null
  };
  const projectTeam = [...strategy.projectTeam];
  projectTeam[index] = updatedEntry;
  return { ...strategy, projectTeam };
}
