// Canonical team catalog metadata and project activation rules.
// Portfolio-wide concentration limits remain selection policy, not role metadata.
function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const ALLOWED_ACTION_IDS = [
  "repo.read", "repo.search", "repo.inspect_history",
  "plan.write", "repo.write", "build.run", "lint.run", "test.run", "test.write", "review.write"
];
export const ESCALATION_SIGNAL_IDS = [
  "large_scope", "architectural_intent_required", "cross_subsystem", "high_reversal_cost",
  "plan_invalidated", "security_sensitive", "root_cause_not_found", "high_uncertainty"
];

const definitions = {
  Explorer: {
    capabilities: { required: ["reasoning"], optional: ["instructionFollowing", "agenticExecution"] },
    metricWeights: { reasoning: .45, agenticExecution: .25, coding: .30 },
    tier: "light", workVolume: .5, nearEquivalenceBand: .06,
    assessmentRaised: false, technical: true, alwaysOn: true, orchestrator: false,
    activation: { always: true },
    profile: {
      role: "Explorer",
      objective: "Investigate a real question or area of the codebase and come back with real, checkable evidence — never a guess.",
      responsibility: "Read-only reconnaissance: locate the relevant real files, trace how something actually works today, and summarize findings a later role (usually Architect) can act on.",
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
    }
  },
  Architect: {
    capabilities: { required: ["reasoning", "coding", "agenticExecution"], optional: ["instructionFollowing"] },
    metricWeights: { reasoning: .40, coding: .30, agenticExecution: .30 },
    tier: "demanding", workVolume: .2, nearEquivalenceBand: .03,
    assessmentRaised: true, technical: true, alwaysOn: true, orchestrator: true,
    activation: { always: true },
    profile: {
      role: "Architect",
      objective: "Turn a real requirement (and, when available, Explorer's findings) into a concrete, buildable plan — decide the approach before any code changes.",
      responsibility: "Design and sequence the real work: which files change, in what order, what the acceptance criteria are, and what tradeoffs were considered and rejected.",
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
    }
  },
  Builder: {
    capabilities: { required: ["coding", "terminalExecution", "agenticExecution"], optional: ["softwareExecution", "instructionFollowing"] },
    metricWeights: { coding: .45, agenticExecution: .30, terminalExecution: .25 },
    tier: "standard", workVolume: 1, nearEquivalenceBand: .06,
    assessmentRaised: false, technical: true, alwaysOn: false, orchestrator: false,
    activation: { any: ["build-command", "known-stack"] },
    profile: {
      role: "Builder",
      objective: "Implement the real plan Architect produced — write, edit, or remove real code.",
      responsibility: "Execute the approved plan faithfully: make the real file changes it calls for, following this codebase's own existing conventions rather than inventing new ones.",
      allowedActions: ["read files", "write/edit files", "run build/lint commands to self-check"],
      allowedActionIds: ["repo.read", "repo.write", "build.run", "lint.run"],
      deliverable: "The real code change described by the plan, in a state ready for Tester/Reviewer — not a partial or half-finished implementation.",
      riskLevel: "medium",
      completionCriteria: "Every file target in the plan is actually changed, the change builds/lints cleanly, and no acceptance criterion from the plan is left unaddressed.",
      escalationConditions: [
        "the real implementation reveals the plan's approach doesn't actually work and needs Architect to reconsider it",
        "the change touches a real security- or data-integrity-sensitive path"
      ],
      escalationSignalIds: ["plan_invalidated", "security_sensitive"],
      dependencies: { dependsOn: ["Architect"], independentOf: [] }
    }
  },
  Debugger: {
    capabilities: { required: ["reasoning", "coding", "terminalExecution", "agenticExecution"], optional: ["softwareExecution"] },
    metricWeights: { coding: .35, terminalExecution: .30, reasoning: .20, agenticExecution: .15 },
    tier: "demanding", workVolume: .3, nearEquivalenceBand: .05,
    assessmentRaised: true, technical: true, alwaysOn: false, orchestrator: false,
    activation: { command: "test" },
    profile: {
      role: "Debugger",
      objective: "Find the real root cause of a real failure and fix it — never patch the symptom without understanding why it happened.",
      responsibility: "Reproduce the real failure, trace it to its real cause in the code, and make the minimal real change that actually fixes that cause.",
      allowedActions: ["read files", "write/edit files", "run tests and reproduction commands"],
      // test.write, not just test.run: this role's own deliverable requires
      // handing back a real regression test — per this project's own Zero
      // Bugs Policy ("every bug fix requires a regression test that fails
      // first, then passes with the fix"), the same actor that finds and
      // fixes the real root cause writes that specific test, not a
      // mandatory Debugger->Tester handoff for every fix. Debugger already
      // has broad repo.write; this is a more specific, explicit grant of
      // the same real capability, not an expansion of what it can touch.
      allowedActionIds: ["repo.read", "repo.write", "test.write", "test.run"],
      deliverable: "A fix with a real regression test that fails before the fix and passes after it, plus a stated root cause.",
      riskLevel: "high",
      completionCriteria: "The real failure no longer reproduces, a regression test proves it, and the stated root cause is the actual cause, not a plausible-sounding guess.",
      escalationConditions: [
        "the failure's real root cause isn't found after a reasonable real investigation — guessing at fixes past that point is worse than escalating",
        "the failure is in a real security- or data-integrity-sensitive path"
      ],
      escalationSignalIds: ["root_cause_not_found", "security_sensitive"],
      dependencies: { dependsOn: [], independentOf: ["Builder"] }
    }
  },
  Tester: {
    capabilities: { required: ["coding", "terminalExecution"], optional: ["responseTime"] },
    metricWeights: { coding: .50, terminalExecution: .30, responseTime: .20 },
    tier: "light", workVolume: .6, nearEquivalenceBand: .06,
    assessmentRaised: false, technical: true, alwaysOn: false, orchestrator: false,
    activation: { command: "test", otherwise: "gap" },
    profile: {
      role: "Tester",
      objective: "Verify the real behavior of a change, including its real edge cases — not just the happy path Builder already checked.",
      responsibility: "Write and run real tests that would catch a real regression, deliberately probing edge cases and failure modes the implementation might have missed.",
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
    }
  },
  Reviewer: {
    capabilities: { required: ["reasoning", "coding"], optional: [] },
    metricWeights: { coding: .50, reasoning: .50 },
    tier: "demanding", workVolume: .2, nearEquivalenceBand: .05,
    assessmentRaised: true, technical: true, alwaysOn: false, orchestrator: false,
    activation: { any: ["lint-command", "typecheck-command"], otherwise: "gap" },
    profile: {
      role: "Reviewer",
      objective: "Independently verify a real change is correct, safe, and consistent with this codebase's own conventions — the team's last real check before delivery.",
      responsibility: "Read the real diff with an adversarial eye: look for correctness issues, security issues, and departures from established patterns Builder may have missed or rationalized.",
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
  }
};

// Defaults retain the pre-catalog team when no project activation inputs exist.
for (const entry of Object.values(definitions)) entry.defaultTeam = true;
definitions.Builder.builder = true;
definitions.Reviewer.independentReview = true;

function catalogRole(role, baseRole, metadata, profile) {
  const base = definitions[baseRole];
  definitions[role] = {
    ...base, defaultTeam: false, alwaysOn: false, orchestrator: false,
    assessmentRaised: false, builder: false, independentReview: false,
    ...metadata,
    profile: { ...base.profile, role, ...profile }
  };
}
for (const side of ["Frontend", "Backend"]) catalogRole(`${side} Builder`, "Builder", {
  builder: true, workVolume: .5, activation: { all: ["ui", "server"] }
}, {
  objective: `Implement the approved ${side.toLowerCase()} work from Architect's plan.`,
  responsibility: `Own the ${side.toLowerCase()} implementation, coordinating the shared API contract with the other Builder.`
});
catalogRole("Planner", "Architect", {
  tier: "standard", workVolume: .2, nearEquivalenceBand: .06,
  activation: { assessment: ["domainComplexity"], minLevel: 3 }
}, {
  objective: "Break Architect's approved plan into executable tasks without replacing the orchestrator.",
  responsibility: "Sequence bounded tasks, dependencies and acceptance criteria from the approved design.",
  deliverable: "A task breakdown linked to the approved architecture and acceptance criteria.",
  completionCriteria: "Every task has a bounded scope, dependencies and a checkable outcome.",
  dependencies: { dependsOn: ["Architect"], independentOf: [] }
});
catalogRole("Security Reviewer", "Reviewer", {
  independentReview: true, assessmentRaised: true,
  activation: { assessment: ["actionsAndSecurity", "money", "personalData"], minLevel: 4 }
}, {
  objective: "Independently review security, financial and personal-data boundaries.",
  responsibility: "Inspect sensitive changes for authorization, data exposure and integrity defects with cited evidence.",
  dependencies: { dependsOn: ["Builder", "Frontend Builder", "Backend Builder"], independentOf: ["Builder", "Frontend Builder", "Backend Builder"] }
});
definitions.Reviewer.profile.dependencies = definitions["Security Reviewer"].profile.dependencies;
catalogRole("DevOps", "Builder", {
  workVolume: .2, metricWeights: { coding: .2, terminalExecution: .5, agenticExecution: .3 },
  activation: { any: ["ci", "docker", "deploy"] }
}, {
  objective: "Maintain the detected build, CI and deployment configuration under the approved plan.",
  responsibility: "Implement configuration changes and validate them locally; never infer permission to deploy.",
  deliverable: "Validated configuration changes with local check results and remaining deployment risks."
});
catalogRole("Verifier", "Tester", {
  capabilities: { required: ["terminalExecution", "instructionFollowing", "responseTime"], optional: [] },
  metricWeights: { terminalExecution: .5, instructionFollowing: .3, responseTime: .2 },
  activation: { command: "test" }
}, {
  objective: "Run existing tests and lint and report observed evidence without editing files.",
  responsibility: "Execute the configured test and lint commands only; report exit codes and failures.",
  allowedActions: ["run existing tests", "run existing lint commands"], allowedActionIds: ["test.run", "lint.run"],
  deliverable: "The exact commands, exit codes and observed results, including unavailable checks.",
  completionCriteria: "Configured tests and lint have observed results or an explicit unavailable explanation."
});
catalogRole("Refactorer", "Builder", {
  workVolume: .5, activation: { assessment: ["domainComplexity"], minLevel: 4 }
}, {
  objective: "Improve internal structure without changing the approved observable behavior.",
  responsibility: "Apply bounded refactors from Architect's plan and preserve existing contracts.",
  deliverable: "A behavior-preserving refactor with regression evidence."
});
catalogRole("Documenter", "Builder", {
  tier: "light", workVolume: .2,
  capabilities: { required: ["coding", "instructionFollowing", "responseTime"], optional: [] },
  metricWeights: { coding: .3, instructionFollowing: .5, responseTime: .2 },
  activation: { any: ["docs", "publishedLibrary"] }
}, {
  objective: "Keep project documentation aligned with the actual public behavior.",
  responsibility: "Write and update documentation using real source and interface evidence.",
  allowedActions: ["read files", "search repository", "write documentation"],
  allowedActionIds: ["repo.read", "repo.search", "repo.write"],
  deliverable: "Accurate documentation with working examples and no invented behavior.",
  completionCriteria: "Documentation matches the implemented behavior and every example was checked."
});

/** Activate catalog roles from detected signals or an already verified S35 assessment. */
export function activateCatalogRoles(requirements, { signals = {}, quality = {}, demandAssessment = null } = {}) {
  const byRole = new Map(requirements.map(entry => [entry.role, entry]));
  for (const [role, entry] of Object.entries(ROLE_REGISTRY)) {
    if (entry.defaultTeam) continue;
    const rule = entry.activation;
    const active = rule.assessment
      ? rule.assessment.some(name => (demandAssessment?.categories?.[name]?.level ?? 0) >= rule.minLevel)
      : rule.command ? Boolean(quality[`${rule.command}Command`])
      : rule.all ? rule.all.every(signal => signals[signal])
      : rule.any.some(signal => signals[signal]);
    if (active && !byRole.has(role)) byRole.set(role, {
      role, capabilities: [...entry.capabilities.required], source: rule.assessment ? "assessment" : "profile",
      reason: rule.assessment ? `Verified ${rule.assessment.join(" or ")} level >= ${rule.minLevel}.` : `Detected project activation: ${JSON.stringify(rule)}.`
    });
  }
  return normalizeBuilderRoles([...byRole.values()]);
}

// Retain shared capability identity without duplicating the definition in profiles.
for (const entry of Object.values(definitions)) entry.profile.capabilities = entry.capabilities;
export const ROLE_REGISTRY = deepFreeze(definitions);

// Scoped project catalog (role-catalog.js). Selection is synchronous, so a
// scoped swap is safe; with no catalog every reader sees ROLE_REGISTRY itself.
let activeRegistry = ROLE_REGISTRY;
/** Registry the scoring entry points read: the scoped project catalog, else the built-ins. */
export const currentRegistry = () => activeRegistry;
/** Run a synchronous selection with `catalog.registry` as the role registry. A falsy catalog is a no-op. */
export function withRoleCatalog(catalog, fn) {
  if (!catalog?.registry) return fn();
  const previous = activeRegistry;
  activeRegistry = catalog.registry;
  try { return fn(); } finally { activeRegistry = previous; }
}
export const roleView = attribute => Object.fromEntries(Object.entries(ROLE_REGISTRY).map(([role, entry]) => [role, entry[attribute]]));
export const rolesWhere = attribute => Object.keys(ROLE_REGISTRY).filter(role => ROLE_REGISTRY[role][attribute]);

export const DEFAULT_ROLE_CAPABILITIES = Object.fromEntries(Object.entries(ROLE_REGISTRY).filter(([, entry]) => entry.defaultTeam).map(([role, entry]) => [role, entry.capabilities]));

/** Split implementation roles replace the default Builder, even after analyst merges. */
export function normalizeBuilderRoles(requirements) {
  const split = requirements.some(({ role }) => ROLE_REGISTRY[role]?.builder && !ROLE_REGISTRY[role].defaultTeam);
  return split ? requirements.filter(({ role }) => !(ROLE_REGISTRY[role]?.builder && ROLE_REGISTRY[role].defaultTeam)) : requirements;
}
