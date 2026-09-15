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
// real model (see computeBootstrapAnalystAlternatives + the
// LOCAL_PREFLIGHT/AWAITING_ANALYST/ANALYZING flow in conversation/service.js),
// and that model has already produced the real analysis this module
// consumes. The analyst never picks the team; it only investigates.

import { buildAiTeam, buildEfficientTeam } from "../intelligence/model-intelligence.js";

// The Bootstrap Analyst investigates read-only via askProvider
// (intelligence/quick-ask.js), which only actually supports these two
// providers today — offering any other real candidate as an "alternative"
// here would be a menu item Kairo can't actually run.
const ASK_SUPPORTED_ADAPTERS = new Set(["codex", "claude"]);

// The Bootstrap Analyst's own required capability, fixed and generic
// (real investigation, not yet informed by this project's own evidence —
// that's exactly what running the analyst is FOR): the same baseline
// Explorer definition model-intelligence.js's global ROLE_CAPABILITIES
// table already uses — reasoning required, instructionFollowing merely
// complementary (its absence must never exclude an otherwise-capable
// candidate from being offered as a real analyst option).
const ANALYST_CAPABILITIES = { Explorer: { required: ["reasoning"], optional: ["instructionFollowing"] } };

function modelRef(teamModel) {
  if (!teamModel) return null;
  return { adapterId: teamModel.adapterId, modelId: teamModel.modelId, displayName: teamModel.displayName ?? null };
}

/** The project's own real role->capabilities map, straight from its (by now analyst-derived) roleRequirements — never the generic global table. */
function projectRoleCapabilities(profile) {
  return Object.fromEntries(profile.roleRequirements.map((requirement) => [requirement.role, requirement.capabilities]));
}

/**
 * Real quality/efficiency Bootstrap Analyst alternatives — computed BEFORE
 * any analysis runs (LOCAL_PREFLIGHT/AWAITING_ANALYST), restricted to
 * providers Kairo can actually invoke read-only (see ASK_SUPPORTED_ADAPTERS).
 * A provider that would otherwise win Explorer but can't actually run ASK
 * (e.g. opencode-go today) is honestly excluded here, never offered as a
 * choice Kairo can't follow through on.
 * @param {object} candidates - `scoredAll`, `eligibility`, `registry`, `providerCapacity`
 * @returns {Array<{choice: "quality"|"efficient", model: object}>}
 */
export function computeBootstrapAnalystAlternatives({ scoredAll, eligibility, registry, providerCapacity = null }) {
  // Restrict the CANDIDATE POOL itself to ask-supported adapters before
  // ranking — not a post-hoc check on the winner — so the real portfolio
  // logic picks the best real candidate among what Kairo can actually
  // invoke, the same way it would for any other real role. Filtering
  // after the fact would silently lose a genuinely real 2nd/3rd-place
  // candidate whenever the unsupported provider happened to rank #1.
  const askSupportedScored = scoredAll.filter((model) => ASK_SUPPORTED_ADAPTERS.has(model.adapterId));
  const aiTeam = buildAiTeam(askSupportedScored, eligibility, registry, ANALYST_CAPABILITIES);
  const efficientTeam = buildEfficientTeam(askSupportedScored, eligibility, registry, { providerCapacity, roleCapabilities: ANALYST_CAPABILITIES });
  const quality = aiTeam.find((entry) => entry.role === "Explorer");
  const efficient = efficientTeam.find((entry) => entry.role === "Explorer");
  return [
    { choice: "quality", model: modelRef(quality?.primary) },
    { choice: "efficient", model: modelRef(efficient?.primary) }
  ].filter((alt) => alt.model);
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
 * @param {{model: object, choice: "quality"|"efficient"}} bootstrapAnalyst -
 *   the real model the human already chose, confirmed, and ran.
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

  return {
    status: "suggested",
    bootstrapAnalyst: bootstrapAnalyst.model,
    bootstrapAnalystChoice: bootstrapAnalyst.choice,
    orchestrator: modelRef(byRoleCapability.get("Architect")?.primary),
    activeRoles,
    qualityTeam,
    efficientTeam: efficientRoles,
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
