/**
 * Pure, UI-free "why this assignment" text — shared by the cockpit overlay
 * and the workspace snapshot / Project proposal table. Never invents
 * metrics; existing `reason` always wins.
 */

/** Plain-language description of what each role optimizes for — mirrors
 * buildAiTeamRoleDefinitions()'s real compute functions in
 * model-intelligence.js, never a per-model claim. */
export const ROLE_CAPABILITY_BLURB = {
  Explorer: "general reasoning capability",
  Architect: "general reasoning capability",
  Builder: "coding capability",
  Debugger: "reasoning and terminal-debugging capability",
  Tester: "coding and terminal-execution capability",
  Reviewer: "independent reasoning and coding review"
};

const OVERRIDE_DECISION_TEXT = "Manual override — not the automatic ranking's own pick.";

/**
 * Pure, human-readable why for one team assignment — from real
 * `reason` / `decisionEvidence` only, never invented metrics.
 * Existing `entry.reason` always wins; overrides use a single formulation.
 * @param {{role?: string, reason?: string|null, assignmentSource?: string|null, decisionEvidence?: object|null}|null|undefined} entry
 * @returns {string}
 */
export function explainTeamDecision(entry) {
  if (!entry) return `Selected for ${ROLE_CAPABILITY_BLURB.Explorer ?? "this role's capability requirement"}.`;
  if (entry.assignmentSource === "override") return OVERRIDE_DECISION_TEXT;
  if (entry.reason) return entry.reason;

  const blurb = ROLE_CAPABILITY_BLURB[entry.role] ?? "this role's capability requirement";
  const decisionType = entry.decisionEvidence?.decisionType ?? null;
  if (decisionType === "leader") {
    const floor = entry.decisionEvidence?.requiredFloor;
    const risk = entry.decisionEvidence?.riskLevel;
    if (floor != null && risk != null) {
      const floorPct = Math.round(floor * 100);
      return `Ranked first for ${blurb} among eligible candidates — nothing cheaper or faster displaced it at the ${floorPct}% capability floor (${risk}-risk role).`;
    }
    return `Ranked first for ${blurb} among eligible candidates.`;
  }
  return `Selected for ${blurb}.`;
}
