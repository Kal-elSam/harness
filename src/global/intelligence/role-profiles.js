// RoleProfile: the canonical definition of Kairo's six team-vocabulary
// roles (Explorer / Architect / Builder / Debugger / Tester / Reviewer)
// — what each role is FOR, what real model can do its work, what it's
// allowed to do, what it must hand back, how risky its own mistakes are,
// when it's "done", and when it should escalate to a stronger model.
// This module is the source of truth; model-intelligence.js imports
// ROLE_CAPABILITIES from here (and re-exports it, so existing external
// callers keep working) rather than the other way around — a real
// routing layer will need to import BOTH role-profiles.js (policy) and
// capability-scoring.js (scoring) without ever routing through each
// other, and role-profiles.js -> model-intelligence.js -> capability-
// scoring.js would have made that a cycle the moment routing imported
// role-profiles.js too.
//
// ROLE_CAPABILITIES answers "which real model can do this role's work";
// the rest of RoleProfile answers "what does doing this role's work
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

// Each role's real relevant capabilities (see capability-scoring.js),
// derived from the plan's per-role table. "Hard problem solving" folds
// into reasoning (GPQA/HLE are themselves hard-reasoning benchmarks);
// "scientific coding" folds into coding (SciCode is already one of
// coding's real component benchmarks) rather than inventing a separate
// capability neither BENCHMARK_IDENTITIES nor any real source measures
// directly. Tester/Reviewer/Explorer rows were truncated in the source
// plan — inferred from this codebase's own pre-existing role-definition
// pattern (Tester: coding + terminal execution; Reviewer: independent
// reasoning + coding review; Explorer: the same reasoning-only signal
// Architect always had) rather than guessed from nothing.
// required: a model MUST have real evidence for every one of these to
// compete for the role at all — missing evidence on even one required
// capability excludes it from the ranking entirely (see
// model-intelligence.js's buildAiTeamRoleDefinitions's compute()).
// required capabilities ALONE decide both the ranking order
// (requiredRoleFit, i.e. RoleEvaluation.capabilityPercentile computed
// only from `required`) and how close two real picks are (gapValueByRole,
// computed the same way) — optional capabilities never dilute either
// number. optional: real evidence, when present, is scored completely
// separately (optionalEvaluationsByRole) and used ONLY as a tiebreak
// among candidates already equally fit on required capabilities — it can
// never move a model up in requiredRoleFit order, and its absence never
// excludes a model. Before this split, an optional capability was folded
// into the SAME median as required ones — so a generalist's real
// requiredRoleFit gap on the capabilities that actually define the role
// could be smoothed over by an unrelated optional signal. Whether this
// alone changes a specific real pick (e.g. Muse Spark 1.3 on Architect)
// still depends on the per-role near-equivalence band
// (model-intelligence.js's ROLE_NEAR_EQUIVALENCE_BAND) — verify against
// real data, never assume.
//
// softwareExecution is optional everywhere it appears (Builder, Debugger),
// not required — verified against two independent real catalogs before
// deciding this, not assumed: the full multi-provider catalog (Codex +
// Claude + Cursor + OpenCode Go, 81 scored candidates) showed real
// evidence for only 3 of them; crm's own real candidate pool (9 scored
// candidates) showed only 2. Coverage is a fact about the CURRENT real
// catalog, never a fixed constant — these specific numbers will already
// be stale by the time this comment is read; re-measure via
// capability-scoring.js's computeCapabilityPercentile against the real
// scored pool in hand, never assume a ratio. Making softwareExecution
// required at either measured ratio would have left Builder/Debugger with
// only 2-3 real candidates system-wide, no matter how many other models
// are genuinely capable — instructionFollowing is optional everywhere for
// the same reason (never load-bearing enough for any role to gate on).
export const ROLE_CAPABILITIES = {
  Explorer: { required: ["reasoning"], optional: ["instructionFollowing"] },
  Architect: { required: ["reasoning", "coding"], optional: ["instructionFollowing"] },
  Builder: { required: ["coding", "terminalExecution"], optional: ["softwareExecution", "instructionFollowing"] },
  Debugger: { required: ["reasoning", "coding", "terminalExecution"], optional: ["softwareExecution"] },
  Tester: { required: ["coding", "terminalExecution"], optional: [] },
  Reviewer: { required: ["reasoning", "coding"], optional: [] }
};

// Stable, machine-checkable vocabularies for a router to branch on — the
// human-readable `allowedActions`/`escalationConditions` strings below
// are for prompts and UI copy; a router must never parse or pattern-match
// those sentences to decide anything, since wording can change for
// clarity without meaning to change behavior. `allowedActionIds`/
// `escalationSignalIds` are the actual decision surface: closed,
// versioned sets a router (or a test) can validate membership against.
// Every id used in ROLE_PROFILES below must come from one of these two
// sets — see role-profiles.test.js's own membership check.
export const ALLOWED_ACTION_IDS = [
  "repo.read", "repo.search", "repo.inspect_history",
  "plan.write", "repo.write", "build.run", "test.run", "test.write", "review.write"
];
export const ESCALATION_SIGNAL_IDS = [
  "large_scope", "architectural_intent_required", "cross_subsystem", "high_reversal_cost",
  "plan_invalidated", "security_sensitive", "root_cause_not_found", "high_uncertainty"
];

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
    allowedActionIds: ["repo.read", "repo.search", "repo.inspect_history"],
    deliverable: "A findings summary with real file:line references for every claim — no unverified assertion presented as fact.",
    riskLevel: "low",
    completionCriteria: "Every question the investigation was scoped to answer has a real, cited answer, or is explicitly listed as unresolved with why.",
    escalationConditions: [
      "the area under investigation is large enough that a shallow read risks missing a real contradiction elsewhere in the codebase",
      "the question requires understanding real architectural intent, not just locating code"
    ],
    escalationSignalIds: ["large_scope", "architectural_intent_required"],
    dependencies: { dependsOn: [], independentOf: ["Builder", "Reviewer"] }
  },
  Architect: {
    role: "Architect",
    objective: "Turn a real requirement (and, when available, Explorer's findings) into a concrete, buildable plan — decide the approach before any code changes.",
    responsibility: "Design and sequence the real work: which files change, in what order, what the acceptance criteria are, and what tradeoffs were considered and rejected.",
    capabilities: ROLE_CAPABILITIES.Architect,
    allowedActions: ["read files", "search/grep the repository", "produce a written plan or design document"],
    allowedActionIds: ["repo.read", "repo.search", "plan.write"],
    deliverable: "A plan concrete enough for Builder to execute without re-deciding the approach — real file targets, real ordering, real acceptance criteria.",
    riskLevel: "high",
    completionCriteria: "The plan covers every real file the work will touch, states its acceptance criteria explicitly, and names the tradeoffs it chose between.",
    escalationConditions: [
      "the requirement touches multiple subsystems whose real interaction isn't already well understood",
      "a wrong architectural decision here would be expensive to reverse once Builder has acted on it"
    ],
    escalationSignalIds: ["cross_subsystem", "high_reversal_cost"],
    dependencies: { dependsOn: ["Explorer"], independentOf: [] }
  },
  Builder: {
    role: "Builder",
    objective: "Implement the real plan Architect produced — write, edit, or remove real code.",
    responsibility: "Execute the approved plan faithfully: make the real file changes it calls for, following this codebase's own existing conventions rather than inventing new ones.",
    capabilities: ROLE_CAPABILITIES.Builder,
    allowedActions: ["read files", "write/edit files", "run build/lint commands to self-check"],
    allowedActionIds: ["repo.read", "repo.write", "build.run"],
    deliverable: "The real code change described by the plan, in a state ready for Tester/Reviewer — not a partial or half-finished implementation.",
    riskLevel: "medium",
    completionCriteria: "Every file target in the plan is actually changed, the change builds/lints cleanly, and no acceptance criterion from the plan is left unaddressed.",
    escalationConditions: [
      "the real implementation reveals the plan's approach doesn't actually work and needs Architect to reconsider it",
      "the change touches a real security- or data-integrity-sensitive path"
    ],
    escalationSignalIds: ["plan_invalidated", "security_sensitive"],
    dependencies: { dependsOn: ["Architect"], independentOf: [] }
  },
  Debugger: {
    role: "Debugger",
    objective: "Find the real root cause of a real failure and fix it — never patch the symptom without understanding why it happened.",
    responsibility: "Reproduce the real failure, trace it to its real cause in the code, and make the minimal real change that actually fixes that cause.",
    capabilities: ROLE_CAPABILITIES.Debugger,
    allowedActions: ["read files", "write/edit files", "run tests and reproduction commands"],
    allowedActionIds: ["repo.read", "repo.write", "test.run"],
    deliverable: "A fix with a real regression test that fails before the fix and passes after it, plus a stated root cause.",
    riskLevel: "high",
    completionCriteria: "The real failure no longer reproduces, a regression test proves it, and the stated root cause is the actual cause, not a plausible-sounding guess.",
    escalationConditions: [
      "the failure's real root cause isn't found after a reasonable real investigation — guessing at fixes past that point is worse than escalating",
      "the failure is in a real security- or data-integrity-sensitive path"
    ],
    escalationSignalIds: ["root_cause_not_found", "security_sensitive"],
    dependencies: { dependsOn: [], independentOf: ["Builder"] }
  },
  Tester: {
    role: "Tester",
    objective: "Verify the real behavior of a change, including its real edge cases — not just the happy path Builder already checked.",
    responsibility: "Write and run real tests that would catch a real regression, deliberately probing edge cases and failure modes the implementation might have missed.",
    capabilities: ROLE_CAPABILITIES.Tester,
    allowedActions: ["read files", "write/edit test files", "run test commands"],
    allowedActionIds: ["repo.read", "test.write", "test.run"],
    deliverable: "A real, passing test suite covering the change's stated behavior and its real edge cases, with any gap found reported honestly.",
    riskLevel: "medium",
    completionCriteria: "The relevant real test command passes, and the edge cases specific to this change (not just a generic checklist) are actually covered.",
    escalationConditions: [
      "the edge cases under test require reasoning about a real, non-obvious interaction between subsystems"
    ],
    escalationSignalIds: ["cross_subsystem"],
    dependencies: { dependsOn: ["Builder"], independentOf: [] }
  },
  Reviewer: {
    role: "Reviewer",
    objective: "Independently verify a real change is correct, safe, and consistent with this codebase's own conventions — the team's last real check before delivery.",
    responsibility: "Read the real diff with an adversarial eye: look for correctness issues, security issues, and departures from established patterns Builder may have missed or rationalized.",
    capabilities: ROLE_CAPABILITIES.Reviewer,
    allowedActions: ["read files", "search/grep the repository", "produce a written review with real file:line findings"],
    allowedActionIds: ["repo.read", "repo.search", "review.write"],
    deliverable: "A review that either approves the change or lists real, concrete, file:line-anchored findings — never a vague 'looks fine' or an unfounded objection.",
    riskLevel: "high",
    completionCriteria: "Every real file the change touches has been read, and every finding raised is backed by a concrete file:line reference and a real failure scenario.",
    escalationConditions: [
      "the change touches a real security- or data-integrity-sensitive path",
      "the reviewer's own uncertainty about correctness is high enough that a second, independent pass would materially change the outcome"
    ],
    escalationSignalIds: ["security_sensitive", "high_uncertainty"],
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
