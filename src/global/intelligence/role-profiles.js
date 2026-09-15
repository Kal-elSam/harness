// RoleProfile: the operational policy layer around each of Kairo's six
// team-vocabulary roles (Explorer / Architect / Builder / Debugger /
// Tester / Reviewer) — what the role is FOR, what it's allowed to do,
// what it must hand back, how risky its own mistakes are, when it's
// "done", and when it should escalate to a stronger model. This is
// deliberately a SEPARATE concern from ROLE_CAPABILITIES (model-
// intelligence.js) — capabilities answer "which real model can do this
// role's work", RoleProfile answers "what does doing this role's work
// actually mean, and under what constraints". A RoleProfile's own
// `capabilities` field is a direct reference to ROLE_CAPABILITIES[role],
// never a duplicate — the two stay in sync by construction, not by
// remembering to update two places.
//
// Economy has no RoleProfile. Per the "Convertir la guía en un equipo
// operativo real" plan, Economy stops being a 7th role competing for its
// own slot and becomes an EXECUTION POLICY any of the six real roles can
// run under (cheapest real model that still clears the role's own
// requiredRoleFit floor, instead of the role's own leader/near-
// equivalence pick) — see model-intelligence.js's own Economy handling,
// still unchanged as of this module; wiring RoleProfile-aware routing to
// actually apply that policy per-role is a later increment, not this one.

import { ROLE_CAPABILITIES } from "./model-intelligence.js";

/**
 * @typedef {object} RoleProfile
 * @property {string} role
 * @property {string} objective - what this role is trying to accomplish, in one sentence.
 * @property {string} responsibility - the concrete scope of work this role owns.
 * @property {{required: string[], optional: string[]}} capabilities - direct reference to ROLE_CAPABILITIES[role].
 * @property {string[]} allowedActions - what this role may actually do (e.g. "read files", "write files", "run tests").
 * @property {string} deliverable - what this role must hand back when it finishes.
 * @property {"low"|"medium"|"high"} riskLevel - how costly a mistake from this role is to the rest of the team.
 * @property {string} completionCriteria - the real, checkable condition that marks this role's work as done.
 * @property {string[]} escalationConditions - real situations where this role's own model should be escalated to a stronger one, not just retried.
 * @property {{dependsOn: string[], independentOf: string[]}} dependencies - which other roles this one's output depends on, and which it must stay independent from.
 */

/**
 * The six real RoleProfiles. Order matches ROLE_CAPABILITIES's own
 * declaration order (Explorer, Architect, Builder, Debugger, Tester,
 * Reviewer) — not alphabetical, not risk-ordered — so a reader who
 * already knows one table can find the same role in the other without
 * re-deriving the order.
 * @type {Record<string, RoleProfile>}
 */
export const ROLE_PROFILES = {
  Explorer: {
    role: "Explorer",
    objective: "Investigate a real question or area of the codebase and come back with real, checkable evidence — never a guess.",
    responsibility: "Read-only reconnaissance: locate the relevant real files, trace how something actually works today, and summarize findings a later role (usually Architect) can act on.",
    capabilities: ROLE_CAPABILITIES.Explorer,
    allowedActions: ["read files", "search/grep the repository", "run read-only inspection commands (e.g. git log, git blame)"],
    deliverable: "A findings summary with real file:line references for every claim — no unverified assertion presented as fact.",
    riskLevel: "low",
    completionCriteria: "Every question the investigation was scoped to answer has a real, cited answer, or is explicitly listed as unresolved with why.",
    escalationConditions: [
      "the area under investigation is large enough that a shallow read risks missing a real contradiction elsewhere in the codebase",
      "the question requires understanding real architectural intent, not just locating code"
    ],
    dependencies: { dependsOn: [], independentOf: ["Builder", "Reviewer"] }
  },
  Architect: {
    role: "Architect",
    objective: "Turn a real requirement (and, when available, Explorer's findings) into a concrete, buildable plan — decide the approach before any code changes.",
    responsibility: "Design and sequence the real work: which files change, in what order, what the acceptance criteria are, and what tradeoffs were considered and rejected.",
    capabilities: ROLE_CAPABILITIES.Architect,
    allowedActions: ["read files", "search/grep the repository", "produce a written plan or design document"],
    deliverable: "A plan concrete enough for Builder to execute without re-deciding the approach — real file targets, real ordering, real acceptance criteria.",
    riskLevel: "high",
    completionCriteria: "The plan covers every real file the work will touch, states its acceptance criteria explicitly, and names the tradeoffs it chose between.",
    escalationConditions: [
      "the requirement touches multiple subsystems whose real interaction isn't already well understood",
      "a wrong architectural decision here would be expensive to reverse once Builder has acted on it"
    ],
    dependencies: { dependsOn: ["Explorer"], independentOf: [] }
  },
  Builder: {
    role: "Builder",
    objective: "Implement the real plan Architect produced — write, edit, or remove real code.",
    responsibility: "Execute the approved plan faithfully: make the real file changes it calls for, following this codebase's own existing conventions rather than inventing new ones.",
    capabilities: ROLE_CAPABILITIES.Builder,
    allowedActions: ["read files", "write/edit files", "run build/lint commands to self-check"],
    deliverable: "The real code change described by the plan, in a state ready for Tester/Reviewer — not a partial or half-finished implementation.",
    riskLevel: "medium",
    completionCriteria: "Every file target in the plan is actually changed, the change builds/lints cleanly, and no acceptance criterion from the plan is left unaddressed.",
    escalationConditions: [
      "the real implementation reveals the plan's approach doesn't actually work and needs Architect to reconsider it",
      "the change touches a real security- or data-integrity-sensitive path"
    ],
    dependencies: { dependsOn: ["Architect"], independentOf: [] }
  },
  Debugger: {
    role: "Debugger",
    objective: "Find the real root cause of a real failure and fix it — never patch the symptom without understanding why it happened.",
    responsibility: "Reproduce the real failure, trace it to its real cause in the code, and make the minimal real change that actually fixes that cause.",
    capabilities: ROLE_CAPABILITIES.Debugger,
    allowedActions: ["read files", "write/edit files", "run tests and reproduction commands"],
    deliverable: "A fix with a real regression test that fails before the fix and passes after it, plus a stated root cause.",
    riskLevel: "high",
    completionCriteria: "The real failure no longer reproduces, a regression test proves it, and the stated root cause is the actual cause, not a plausible-sounding guess.",
    escalationConditions: [
      "the failure's real root cause isn't found after a reasonable real investigation — guessing at fixes past that point is worse than escalating",
      "the failure is in a real security- or data-integrity-sensitive path"
    ],
    dependencies: { dependsOn: [], independentOf: ["Builder"] }
  },
  Tester: {
    role: "Tester",
    objective: "Verify the real behavior of a change, including its real edge cases — not just the happy path Builder already checked.",
    responsibility: "Write and run real tests that would catch a real regression, deliberately probing edge cases and failure modes the implementation might have missed.",
    capabilities: ROLE_CAPABILITIES.Tester,
    allowedActions: ["read files", "write/edit test files", "run test commands"],
    deliverable: "A real, passing test suite covering the change's stated behavior and its real edge cases, with any gap found reported honestly.",
    riskLevel: "medium",
    completionCriteria: "The relevant real test command passes, and the edge cases specific to this change (not just a generic checklist) are actually covered.",
    escalationConditions: [
      "the edge cases under test require reasoning about a real, non-obvious interaction between subsystems"
    ],
    dependencies: { dependsOn: ["Builder"], independentOf: [] }
  },
  Reviewer: {
    role: "Reviewer",
    objective: "Independently verify a real change is correct, safe, and consistent with this codebase's own conventions — the team's last real check before delivery.",
    responsibility: "Read the real diff with an adversarial eye: look for correctness issues, security issues, and departures from established patterns Builder may have missed or rationalized.",
    capabilities: ROLE_CAPABILITIES.Reviewer,
    allowedActions: ["read files", "search/grep the repository", "produce a written review with real file:line findings"],
    deliverable: "A review that either approves the change or lists real, concrete, file:line-anchored findings — never a vague 'looks fine' or an unfounded objection.",
    riskLevel: "high",
    completionCriteria: "Every real file the change touches has been read, and every finding raised is backed by a concrete file:line reference and a real failure scenario.",
    escalationConditions: [
      "the change touches a real security- or data-integrity-sensitive path",
      "the reviewer's own uncertainty about correctness is high enough that a second, independent pass would materially change the outcome"
    ],
    // Reviewer's independence from Builder isn't just a design principle
    // here — model-intelligence.js's buildAiTeam enforces it mechanically
    // (a Reviewer pick is barred from Builder's own chosen adapter
    // whenever a real, near-equivalent or floor-clearing alternative
    // exists — see passesConcentration's reviewerBuilderAdapter check).
    dependencies: { dependsOn: ["Builder"], independentOf: ["Builder"] }
  }
};

/**
 * @param {string} role
 * @returns {RoleProfile|null}
 */
export function getRoleProfile(role) {
  return ROLE_PROFILES[role] ?? null;
}
