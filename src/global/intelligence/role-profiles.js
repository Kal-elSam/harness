// Compatibility views; role-registry.js owns all per-role metadata.
import { ROLE_REGISTRY, roleView } from "./role-registry.js";
export { ALLOWED_ACTION_IDS, ESCALATION_SIGNAL_IDS } from "./role-registry.js";

/**
 * @typedef {object} RoleProfile
 * @property {string} role
 * @property {string} objective - what this role is trying to accomplish, in one sentence.
 * @property {string} responsibility - the concrete scope of work this role owns.
 * @property {{required: string[], optional: string[]}} capabilities - direct reference to ROLE_CAPABILITIES[role].
 * @property {string[]} allowedActions - human-readable description of what this role may do — prompts/UI only, never evaluated mechanically. See `allowedActionIds` for the real decision surface.
 * @property {string[]} allowedActionIds - stable ids from ALLOWED_ACTION_IDS; what a router actually checks.
 * @property {string} deliverable - what this role must hand back when it finishes.
 * @property {"low"|"medium"|"high"} riskLevel - how costly a mistake from this role is to the rest of the team; already a stable enum, safe for a router to branch on directly.
 * @property {string} completionCriteria - the real, checkable condition that marks this role's work as done (human-readable; not yet machine-evaluable — see role-profiles.js's own module doc).
 * @property {string[]} escalationConditions - human-readable description of when this role should escalate — prompts/UI only. See `escalationSignalIds` for the real decision surface.
 * @property {string[]} escalationSignalIds - stable ids from ESCALATION_SIGNAL_IDS; what a router actually checks to decide whether to escalate.
 * @property {{dependsOn: string[], independentOf: string[]}} dependencies - which other roles this one's output depends on, and which it must stay independent from.
 */

export const ROLE_CAPABILITIES = roleView("capabilities");
export const ROLE_METRIC_WEIGHTS = roleView("metricWeights");
export const ROLE_PROFILES = roleView("profile");

/** Return the canonical profile, or null for an unknown role. */
export function getRoleProfile(role) {
  return ROLE_PROFILES[role] ?? null;
}
