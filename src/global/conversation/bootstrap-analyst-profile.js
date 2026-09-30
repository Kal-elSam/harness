// The ONE definition of what the Bootstrap Analyst job means. Both the
// analyst prompt (project-analysis.js) and the ranking requirement
// (project-strategy.js's computeBootstrapAnalystCatalog) read this object
// at call time, so changing it changes both. It lives in its own module
// so project-analysis.js and project-strategy.js can share it without an
// import cycle.

/**
 * Focus area -> real capability keys (capability-scoring.js vocabulary).
 * The single place where prompt focus is mapped to ranking. "architecture"
 * and "design" have no benchmark of their own: they are judged through
 * reasoning (structural judgment) and coding (reading real code), so they
 * remain prompt focus areas and rank through those two keys. A focus area
 * absent from this map steers the prompt only and never gates ranking.
 */
export const FOCUS_AREA_CAPABILITIES = Object.freeze({
  reasoning: Object.freeze(["reasoning"]),
  coding: Object.freeze(["coding"]),
  architecture: Object.freeze(["reasoning", "coding"]),
  design: Object.freeze(["reasoning", "coding"])
});

/** Default weight of a capability in the fit: required 1, optional 0.5 (override via profile.capabilityWeights). */
export const ANALYST_FIT_DEFAULT_WEIGHTS = Object.freeze({ required: 1, optional: 0.5 });

/**
 * Confidence of a model with NO benchmark evidence (an available model
 * Artificial Analysis does not track). A documented constant, deliberately
 * below the floor of any scored model's confidence (see
 * SCORED_ANALYST_CONFIDENCE_FLOOR): absence of evidence is never scored.
 */
export const UNSCORED_ANALYST_CONFIDENCE = 0.25;
/** A scored model's confidence lies in [floor, 1], growing with evidence coverage and benchmark depth. */
export const SCORED_ANALYST_CONFIDENCE_FLOOR = 0.4;

/**
 * Real capability requirement derived from a profile's focus areas (in
 * first-seen order, deduped) plus its supporting capabilities as optional.
 * @param {{focusAreas?: string[], supportingCapabilities?: string[]}} profile
 * @returns {{required: string[], optional: string[]}}
 */
export function deriveAnalystCapabilities(profile) {
  const required = [...new Set((profile.focusAreas ?? []).flatMap((area) => FOCUS_AREA_CAPABILITIES[area] ?? []))];
  const optional = (profile.supportingCapabilities ?? []).filter((capability) => !required.includes(capability));
  return { required, optional };
}

/**
 * The Bootstrap Analyst as a temporary, read-only WORKFLOW — deliberately
 * NOT a RoleProfile (see role-profiles.js's ROLE_PROFILES, the six real
 * team roles): the analyst never joins the team and only exists for one
 * /project analyze run. Shaped like a RoleProfile purely to reuse this
 * codebase's "what does doing this job mean" shape.
 * `capabilities` is DERIVED (getter) from `focusAreas` + `supportingCapabilities`.
 */
export const BOOTSTRAP_ANALYST_PROFILE = {
  role: "BootstrapAnalyst",
  objective: "Investigate a real, not-yet-analyzed project read-only and return a structured, evidence-backed ProjectAnalysis Kairo can trust to derive this project's real role requirements from.",
  responsibility: "Read the real project (files, history, workflow docs already collected by project-profile.js, plus anything else it reads on its own) and report real architecture traits, real risks, and which of Kairo's six roles this specific project actually needs — never a boilerplate or generic answer.",
  focusAreas: ["reasoning", "coding", "architecture", "design"],
  supportingCapabilities: ["instructionFollowing"],
  get capabilities() {
    return deriveAnalystCapabilities(this);
  },
  allowedActions: ["read files", "search/grep the repository", "run read-only inspection commands (e.g. git log, git blame)"],
  allowedActionIds: ["repo.read", "repo.search", "repo.inspect_history"],
  deliverable: "A valid ProjectAnalysis (see project-analysis.js's PROJECT_ANALYSIS_SCHEMA) — every field backed by a real file the analyst actually read, never an invented finding.",
  completionCriteria: "The analysis identifies this project's real architecture, its real risks, and which roles it actually needs, each with real supporting evidence — not just a subset copied from a generic checklist."
};

/** @param {string[]} areas @returns {string} "a, b and c" */
export function formatFocusAreas(areas) {
  if (areas.length <= 1) return areas.join("");
  return `${areas.slice(0, -1).join(", ")} and ${areas.at(-1)}`;
}
