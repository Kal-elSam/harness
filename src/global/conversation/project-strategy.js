// Combines a real ProjectProfile (project-profile.js) with the already-
// computed global CAPABILITY/EFFICIENT teams (buildAiTeam/buildEfficientTeam
// — the SAME real scoring this module never re-derives) into a
// ProjectStrategy: which roles THIS project actually needs, and which real
// model fills each one. Never invents a role the profile didn't ask for,
// and never invents a model the global teams didn't already pick.

function modelRef(teamModel) {
  if (!teamModel) return null;
  return { adapterId: teamModel.adapterId, modelId: teamModel.modelId, displayName: teamModel.displayName ?? null };
}

/**
 * Builds a "suggested" ProjectStrategy — never "active" (that only happens
 * via explicit human approval, see project-strategy-store.js +
 * conversation/service.js's approveProjectStrategy).
 *
 * bootstrapAnalyst is the real Explorer pick (read-only investigation
 * capability — reasoning + instructionFollowing) from the global AI TEAM;
 * orchestrator is the real Architect pick — a SEPARATE real decision, never
 * the analyst self-appointing itself, even when they happen to land on the
 * same real model because only one real candidate is accessible right now.
 * @param {object} profile - computeProjectProfile() result
 * @param {Array<object>} aiTeam - buildAiTeam() result (global CAPABILITY team)
 * @param {Array<object>} efficientTeam - buildEfficientTeam() result (global EFFICIENT team)
 * @returns {object} ProjectStrategy (status: "suggested")
 */
export function buildProjectStrategy(profile, aiTeam, efficientTeam) {
  const byRoleCapability = new Map(aiTeam.map((entry) => [entry.role, entry]));
  const byRoleEfficient = new Map(efficientTeam.map((entry) => [entry.role, entry]));

  // Only a role the profile's own real evidence asked for (roleRequirements)
  // AND that has a real global pick is "active" — a required role with no
  // real eligible model is honestly dropped, never filled with a guess.
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
    bootstrapAnalyst: modelRef(byRoleCapability.get("Explorer")?.primary),
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
