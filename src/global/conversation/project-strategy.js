// Combines a real ProjectProfile (project-profile.js) with the real
// candidate pool (scoreAvailableModels output, eligibility, and the
// Model Intelligence Foundation registry — exactly what buildAiTeam/
// buildEfficientTeam already need) into a ProjectStrategy: which roles
// THIS project actually needs, AND which real model wins each one —
// genuinely re-scored against the project's own real detected
// capabilities per role (profile.roleRequirements), never just the
// generic global team filtered down to a subset of role names. A
// project whose real evidence asks for a different capability mix than
// another project (e.g. no real test command, so Tester/Debugger never
// need terminalExecution) CAN and DOES land on a different real model
// for the same role, given the exact same candidate pool — that's the
// actual point of a per-project strategy, not just per-project role
// activation.

import { buildAiTeam, buildEfficientTeam } from "../intelligence/model-intelligence.js";

function modelRef(teamModel) {
  if (!teamModel) return null;
  return { adapterId: teamModel.adapterId, modelId: teamModel.modelId, displayName: teamModel.displayName ?? null };
}

/** The project's own real role->capabilities map, straight from its roleRequirements — never the generic global table. */
function projectRoleCapabilities(profile) {
  return Object.fromEntries(profile.roleRequirements.map((requirement) => [requirement.role, requirement.capabilities]));
}

/**
 * Builds a "suggested" ProjectStrategy — never "active" (that only happens
 * via explicit human approval, see project-strategy-store.js +
 * conversation/service.js's approveProjectStrategy).
 *
 * bootstrapAnalyst is the real, project-rescored Explorer pick (read-only
 * investigation capability — reasoning + instructionFollowing, as this
 * project's own roleRequirements define it); orchestrator is the real,
 * project-rescored Architect pick — a SEPARATE real decision, never the
 * analyst self-appointing itself, even when they happen to land on the
 * same real model because only one real candidate is accessible right now.
 * @param {object} profile - computeProjectProfile() result
 * @param {object} candidates - the real candidate pool: `scoredAll`
 *   (scoreAvailableModels output, every candidate provider), `eligibility`
 *   (checkCandidate results per adapterId), `registry` (Model Intelligence
 *   Foundation registry), `providerCapacity` (optional, for EFFICIENT's
 *   quota tiebreak) — exactly what conversation/service.js's snapshot()
 *   already attaches to modelIntelligence for this purpose.
 * @returns {object} ProjectStrategy (status: "suggested")
 */
export function buildProjectStrategy(profile, { scoredAll, eligibility, registry, providerCapacity = null }) {
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

  const qualityAnalyst = modelRef(byRoleCapability.get("Explorer")?.primary);
  const efficientAnalyst = modelRef(byRoleEfficient.get("Explorer")?.primary);

  return {
    status: "suggested",
    // The real default recommendation (capability-best Explorer pick) —
    // never final until the human confirms it, see selectBootstrapAnalyst
    // below. bootstrapAnalystChoice records which real alternative was
    // actually picked ("quality" | "efficient"); absent until a real
    // choice is made, so the cockpit can tell "recommended, not yet
    // confirmed" apart from "the human picked this one".
    bootstrapAnalyst: qualityAnalyst,
    bootstrapAnalystChoice: null,
    // Real quality vs. efficiency alternatives for the SAME role — exactly
    // what "muestra alternativas de calidad y eficiencia" asks for. Only
    // two entries because those are the only two real, independently
    // computed picks Kairo has for Explorer; never a fabricated menu.
    bootstrapAnalystAlternatives: [
      { choice: "quality", model: qualityAnalyst },
      { choice: "efficient", model: efficientAnalyst }
    ].filter((alt) => alt.model),
    orchestrator: modelRef(byRoleCapability.get("Architect")?.primary),
    activeRoles,
    qualityTeam,
    efficientTeam: efficientRoles,
    profileFingerprint: profile.fingerprint,
    approvedAt: null
  };
}

/**
 * Explicit Bootstrap Analyst selection ("el usuario selecciona el
 * modelo") — the human picks between the two real alternatives
 * buildProjectStrategy already computed (quality-best vs efficiency-best
 * Explorer pick), never a value Kairo invents on the spot. Only valid
 * while the strategy is still "suggested" — once approved, changing the
 * analyst is a fresh /project analyze, not a silent edit of an active
 * commitment.
 * @param {object} strategy - the persisted ProjectStrategy
 * @param {"quality"|"efficient"} choice
 * @returns {object} the updated strategy
 */
export function selectBootstrapAnalyst(strategy, choice) {
  if (strategy.status !== "suggested") {
    throw new Error(`Bootstrap Analyst can only be chosen for a SUGGESTED strategy (current status: ${strategy.status}).`);
  }
  const alternative = (strategy.bootstrapAnalystAlternatives ?? []).find((alt) => alt.choice === choice);
  if (!alternative) throw new Error(`"${choice}" is not one of the real available alternatives (quality, efficient).`);
  return { ...strategy, bootstrapAnalyst: alternative.model, bootstrapAnalystChoice: choice };
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
