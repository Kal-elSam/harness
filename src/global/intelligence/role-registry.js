import { frontierEvidence } from "./frontier-reference.js";
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
  "plan.write", "repo.write", "build.run", "lint.run", "test.run", "test.write", "review.write",
  "git.commit", "git.push", "pr.open"
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
      deliverable: "The real code change described by the plan, in a state ready for Test Runner/Reviewer — not a partial or half-finished implementation.",
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
  "Debugger (fix)": {
    workVolume: .3, technical: true, alwaysOn: false, orchestrator: false,
    activation: { command: "test" },
    profile: {
      role: "Debugger (fix)",
      objective: "Implement the bounded repair plan supplied by Debugger (diagnosis), and prove it with a regression test.",
      responsibility: "Apply the supplied diagnosis and acceptance criteria, make the minimal implementation change, and escalate when observations contradict the plan.",
      allowedActions: ["read files", "write/edit files", "run tests and reproduction commands"],
      // A bounded repair includes its regression test; diagnosis remains with
      // the read-only lead, and independent quality review stays separate.
      allowedActionIds: ["repo.read", "repo.write", "test.write", "test.run"],
      deliverable: "The specified fix with a regression test that fails before the change and passes after it, linked to the supplied diagnosis.",
      riskLevel: "medium",
      completionCriteria: "The supplied acceptance criteria pass, the regression no longer reproduces, and unexpected behavior is escalated rather than independently re-diagnosed.",
      escalationConditions: [
        "the supplied diagnosis or repair plan is missing, ambiguous, or contradicted by observed behavior",
        "the failure is in a real security- or data-integrity-sensitive path"
      ],
      escalationSignalIds: ["plan_invalidated", "security_sensitive"],
      dependencies: { dependsOn: ["Debugger (diagnosis)"], independentOf: [] }
    }
  },
  "Test Runner": {
    capabilities: { required: ["coding", "terminalExecution"], optional: ["responseTime"] },
    metricWeights: { coding: .50, terminalExecution: .30, responseTime: .20 },
    tier: "light", workVolume: .6, nearEquivalenceBand: .06,
    assessmentRaised: false, technical: true, alwaysOn: false, orchestrator: false,
    activation: { command: "test", otherwise: "gap" },
    profile: {
      role: "Test Runner",
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

// Fixes are bounded implementation work, so Builder owns their qualification
// contract. Diagnosis below overrides its own analysis requirements explicitly.
for (const field of ["capabilities", "metricWeights", "tier", "nearEquivalenceBand", "assessmentRaised"]) {
  definitions["Debugger (fix)"][field] = definitions.Builder[field];
}

// Stable role IDs use the registry's existing human-readable naming convention.
// The diagnosis/design actors produce decisions; fix/runner actors execute them.
definitions["Debugger (diagnosis)"] = {
  ...definitions["Debugger (fix)"],
  tier: "demanding", nearEquivalenceBand: .05, assessmentRaised: true,
  metricWeights: { reasoning: .45, coding: .35, agenticExecution: .20 },
  capabilities: { required: ["reasoning", "coding"], optional: ["agenticExecution"] },
  profile: {
    ...definitions["Debugger (fix)"].profile, role: "Debugger (diagnosis)",
    objective: "Identify the root cause from evidence and specify a minimal fix without implementing it.",
    responsibility: "Analyze failure evidence and hand a bounded diagnosis to Debugger (fix).",
    riskLevel: "high",
    dependencies: { dependsOn: [], independentOf: ["Builder"] },
    escalationConditions: [
      "the real root cause cannot be established from the available evidence",
      "the diagnosis exposes a security- or data-integrity-sensitive decision"
    ],
    escalationSignalIds: ["root_cause_not_found", "security_sensitive"],
    allowedActions: ["read evidence", "search the repository", "write a diagnosis"],
    allowedActionIds: ["repo.read", "repo.search", "plan.write"],
    deliverable: "A cited root cause, proposed fix and regression-test acceptance criteria.",
    completionCriteria: "The diagnosis explains the observed failure and gives a checkable fix plan."
  }
};
definitions["Test Designer"] = {
  ...definitions["Test Runner"], tier: "standard", assessmentRaised: true,
  capabilities: { required: ["reasoning", "coding"], optional: ["instructionFollowing"] },
  metricWeights: { reasoning: .5, coding: .5 },
  profile: {
    ...definitions["Test Runner"].profile, role: "Test Designer",
    objective: "Design tests and edge cases for the approved behavior without executing or implementing them.",
    responsibility: "Specify test inputs, expected outcomes and failure modes for Test Runner.",
    allowedActions: ["read evidence", "search the repository", "write a test plan"],
    allowedActionIds: ["repo.read", "repo.search", "plan.write"],
    deliverable: "A test plan with concrete inputs, expected outputs and regression coverage.",
    completionCriteria: "Every requested rule has a deterministic, checkable test case."
  }
};

// Defaults retain the pre-catalog team when no project activation inputs exist.
for (const entry of Object.values(definitions)) entry.defaultTeam = true;
definitions.Builder.builder = true;
definitions["Debugger (fix)"].builder = true;
// Test Runner executes builds and tests with scratch writes only: a build role for floors, not a code-writing Builder for S5 provider unity.
definitions["Test Runner"].executionRole = true;
definitions.Reviewer.independentReview = true;

function catalogRole(role, baseRole, metadata, profile) {
  const base = definitions[baseRole];
  definitions[role] = {
    ...base, defaultTeam: false, alwaysOn: false, orchestrator: false,
    assessmentRaised: false, builder: false, splitsBuilder: false, executionRole: false, independentReview: false,
    ...metadata,
    profile: { ...base.profile, role, ...profile }
  };
}
for (const side of ["Frontend", "Backend"]) catalogRole(`${side} Builder`, "Builder", {
  builder: true, splitsBuilder: true, workVolume: .5, activation: { all: ["ui", "server"] }
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
catalogRole("Verifier", "Test Runner", {
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
  builder: true,
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

catalogRole("Deliverer", "Test Runner", {
  tier: "light", workVolume: .1,
  capabilities: { required: ["terminalExecution", "instructionFollowing", "responseTime"], optional: [] },
  metricWeights: { terminalExecution: .4, instructionFollowing: .4, responseTime: .2 },
  activation: { any: ["gitRemote"] }
}, {
  objective: "Deliver finished, verified work: commit it, push the branch and open the pull request.",
  responsibility: "Run the git and gh steps the parent authorized, with the commit split and PR text the author supplied; never edit files.",
  allowedActions: ["read files", "commit staged work", "push the branch", "open a pull request"],
  allowedActionIds: ["repo.read", "git.commit", "git.push", "pr.open"],
  deliverable: "Commit identities, the pushed branch and the PR URL, with the observed CI status.",
  riskLevel: "medium",
  completionCriteria: "Every authorized delivery step has an observed result, or an explicit reason it did not run.",
  escalationConditions: ["a hook, merge conflict or failing check needs a code change"],
  escalationSignalIds: ["plan_invalidated"],
  dependencies: { dependsOn: ["Builder"], independentOf: [] }
});

/** Whether one catalog activation rule holds for the given signals, quality commands and verified assessment. */
function catalogRuleActive(rule, { signals = {}, quality = {}, demandAssessment = null }) {
  return rule.assessment
    ? rule.assessment.some(name => (demandAssessment?.categories?.[name]?.level ?? 0) >= rule.minLevel)
    : rule.command ? Boolean(quality[`${rule.command}Command`])
    : rule.all ? rule.all.every(signal => signals[signal])
    : rule.any.some(signal => signals[signal]);
}

/** Activate catalog roles from detected signals or an already verified S35 assessment. */
export function activateCatalogRoles(requirements, { signals = {}, quality = {}, demandAssessment = null } = {}) {
  const byRole = new Map(requirements.map(entry => [entry.role, entry]));
  for (const [role, entry] of Object.entries(ROLE_REGISTRY)) {
    if (entry.defaultTeam) continue;
    const rule = entry.activation;
    const active = catalogRuleActive(rule, { signals, quality, demandAssessment });
    if (active && !byRole.has(role)) byRole.set(role, {
      role, capabilities: [...entry.capabilities.required], source: rule.assessment ? "assessment" : "profile",
      reason: rule.assessment ? `Verified ${rule.assessment.join(" or ")} level >= ${rule.minLevel}.` : `Detected project activation: ${JSON.stringify(rule)}.`
    });
  }
  return normalizeBuilderRoles([...byRole.values()]);
}

/**
 * Bring a stored requirement list in line with TODAY's catalog signals: a
 * signal-activated catalog role (source "profile") whose signal is gone leaves,
 * and a catalog role whose signal now holds joins. Assessment-activated and
 * analyst-chosen roles never leave here. Returns the new list plus which
 * catalog roles were activated and deactivated.
 */
export function reconcileCatalogRoles(requirements, context = {}) {
  const deactivated = [];
  const kept = requirements.filter(entry => {
    const registered = ROLE_REGISTRY[entry.role];
    if (!registered || registered.defaultTeam || entry.source !== "profile" || registered.activation.assessment) return true;
    if (catalogRuleActive(registered.activation, context)) return true;
    deactivated.push(entry.role);
    return false;
  });
  const next = activateCatalogRoles(kept, context);
  const before = new Set(requirements.map(entry => entry.role));
  const activated = next.map(entry => entry.role).filter(role => !before.has(role) && ROLE_REGISTRY[role] && !ROLE_REGISTRY[role].defaultTeam);
  return { requirements: next, activated, deactivated };
}

// S4 v2 default catalog roles added next to the legacy ones. They stay out of
// the default team and never activate in U1 (empty `any` rule): U2 owns the
// migration, activation and defaultTeam flip.
const NEVER = { any: [] };
catalogRole("Technical Lead", "Architect", {
  orchestrator: false, tier: "demanding", workVolume: .2, nearEquivalenceBand: .03, assessmentRaised: false, activation: NEVER
}, {
  objective: "Own design decisions and diagnosis: turn a requirement or failure evidence into a bounded plan or root cause, then delegate.",
  responsibility: "Decide the approach, sequence work, diagnose failures from evidence and hand bounded contracts to the Execution Coordinator; never write code.",
  allowedActions: ["read files", "search/grep the repository", "write a plan, design or diagnosis"],
  allowedActionIds: ["repo.read", "repo.search", "repo.inspect_history", "plan.write"],
  escalationSignalIds: ["cross_subsystem", "high_reversal_cost", "root_cause_not_found", "security_sensitive"],
  dependencies: { dependsOn: ["Explorer"], independentOf: [] }
});
catalogRole("Execution Coordinator", "Architect", {
  orchestrator: false, tier: "demanding", workVolume: .2, nearEquivalenceBand: .04, assessmentRaised: false, activation: NEVER,
  capabilities: { required: ["reasoning", "agenticExecution", "instructionFollowing"], optional: [] },
  metricWeights: { reasoning: .4, agenticExecution: .4, instructionFollowing: .2 }
}, {
  objective: "Split approved work into independent units, assign edit surfaces and resolve integration between workers.",
  responsibility: "Coordinate Builders and the Documenter under the Technical Lead's plan: write delegation contracts, assign disjoint edit surfaces, resolve conflicts; never write code.",
  allowedActions: ["read files", "search/grep the repository", "write delegation contracts"],
  allowedActionIds: ["repo.read", "repo.search", "plan.write"],
  escalationSignalIds: ["plan_invalidated", "cross_subsystem"],
  dependencies: { dependsOn: ["Technical Lead"], independentOf: [] }
});
catalogRole("Quality Lead", "Reviewer", {
  independentReview: false, assessmentRaised: false, activation: NEVER
}, {
  objective: "Own verification strategy independent of implementation: design the tests and checks that prove the approved behavior.",
  responsibility: "Specify test designs, acceptance checks and verdicts for the quality cell; never edit files and never approve implementation it coordinated.",
  allowedActions: ["read evidence", "search the repository", "write a test plan or verdict"],
  allowedActionIds: ["repo.read", "repo.search", "plan.write"],
  dependencies: { dependsOn: [], independentOf: ["Builder", "Execution Coordinator"] }
});
catalogRole("Test/Repro Runner", "Test Runner", {
  executionRole: true, activation: NEVER
}, {
  objective: "Run tests and reproductions and report observed evidence; scratch writes only.",
  responsibility: "Execute the supplied checks and reproductions, writing only scratch state, and report exit codes and failures.",
  dependencies: { dependsOn: ["Builder"], independentOf: [] }
});

// Explicit class, cell and permission per role (S3/S4); a role without traits is a registration bug.
const D = "default", L = "legacy";
const TRAITS = {
  "Technical Lead": [D, "analysis", "design", "read-only"], Explorer: [D, "labor", "design", "read-only"],
  "Execution Coordinator": [D, "coordination", "implementation", "read-only"], Builder: [D, "labor", "implementation", "scoped-write"],
  Documenter: [D, "labor", "implementation", "docs-only"], "Quality Lead": [D, "verification", "quality", "read-only"],
  Reviewer: [D, "analysis", "quality", "read-only"], "Security Reviewer": [D, "analysis", "quality", "read-only"],
  "Test/Repro Runner": [D, "labor", "quality", "scratch-only"], Deliverer: [D, "labor", "delivery", "authorized-delivery"],
  // Legacy ids keep resolving until U2 migrates stored documents.
  Architect: [L, "analysis", "design", "read-only"], Planner: [L, "analysis", "design", "read-only"],
  "Debugger (diagnosis)": [L, "analysis", "design", "read-only"], "Test Designer": [L, "analysis", "quality", "read-only"],
  "Debugger (fix)": [L, "labor", "implementation", "scoped-write"], "Backend Builder": [L, "labor", "implementation", "scoped-write"],
  "Frontend Builder": [L, "labor", "implementation", "scoped-write"], Refactorer: [L, "labor", "implementation", "scoped-write"],
  DevOps: [L, "labor", "implementation", "scoped-write"], Verifier: [L, "verification", "quality", "read-only"],
  "Test Runner": [L, "labor", "quality", "scratch-only"]
};
for (const [role, entry] of Object.entries(definitions)) {
  const traits = TRAITS[role];
  if (!traits) throw new Error(`role ${role} has no class/cell/permission traits`);
  [entry.catalog, entry.class, entry.cell, entry.permission] = traits;
}
export const DEFAULT_CATALOG_ROLES = Object.freeze(Object.keys(definitions).filter(role => definitions[role].catalog === D));

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
  const split = requirements.some(({ role }) => ROLE_REGISTRY[role]?.splitsBuilder === true);
  return split ? requirements.filter(({ role }) => role !== "Builder") : requirements;
}

/** Execution roles cannot spend a provider's frontier band on implementation. */
export function isBuildRole(role) {
  const entry = currentRegistry()[role];
  return entry?.builder === true || entry?.executionRole === true;
}

/** Shared class gate. Role-weighted component scoring and absolute floors
 * remain the qualification gate; absence of AA is not an invented score.
 * The third argument accepts a full evidence catalog to hydrate stored refs.
 * Legacy price maps are accepted but intentionally never consulted. */
export function isModelCompatibleWithRole(model, role, catalog, registry = currentRegistry()) {
  const entry = registry[role];
  if (!model || !entry || !["analysis", "coordination", "labor", "verification"].includes(entry.class)) return false;
  const evidence = Array.isArray(catalog)
    ? catalog.find(row => row.adapterId === model.adapterId && row.modelId === model.modelId && Number.isFinite(row.intelligenceIndex)) ?? model
    : model;
  return frontierEvidence(evidence).status !== "frontier" || entry.class !== "labor";
}

// The only legacy single-role migration shim. First ID is the execution alias
// for old singular launch requests; read-time document migration keeps BOTH.
export const LEGACY_ROLE_IDS = Object.freeze({
  Tester: Object.freeze(["Test Runner", "Test Designer"]),
  Debugger: Object.freeze(["Debugger (fix)", "Debugger (diagnosis)"])
});
export const roleIdsOnRead = role => Object.hasOwn(LEGACY_ROLE_IDS, role) ? LEGACY_ROLE_IDS[role] : [role];
const originalDocuments = new WeakMap();
export const originalRoleDocument = doc => {
  const original = originalDocuments.get(doc);
  return original && original.snapshot === JSON.stringify(doc) ? original.doc : doc;
};

/** Pure, idempotent expansion shared by existing readers, never a disk write.
 * Explicit modern entries win over a legacy sibling. Nested teams, requirements,
 * phase plans and role-keyed maps migrate together, preserving model references.
 */
export function normalizeRoleDocument(doc) {
  if (!doc || typeof doc !== "object") return doc;
  const roleMaps = new Set(["roles", "roleCapabilities", "roleBandPools", "floors", "reasons", "byRole", "rolePools"]);
  const roleLists = new Set(["roles", "dependsOn", "independentOf"]);
  function visit(value, context = null) {
    if (Array.isArray(value)) {
      const fieldOf = item => item && typeof item === "object"
        ? (typeof item.role === "string" ? "role" : context === "roles" && typeof item.id === "string" ? "id" : null) : null;
      const explicit = new Set(value.map(item => fieldOf(item) && item[fieldOf(item)]));
      const next = value.flatMap(item => {
        const field = fieldOf(item);
        if (field && Object.hasOwn(LEGACY_ROLE_IDS, item[field])) return roleIdsOnRead(item[field]).filter(id => !explicit.has(id)).map(id => visit({ ...item, [field]: id }, context));
        if (roleLists.has(context) && typeof item === "string" && Object.hasOwn(LEGACY_ROLE_IDS, item)) return roleIdsOnRead(item).filter(id => !value.includes(id));
        return [visit(item, context)];
      });
      return next.length === value.length && next.every((item, index) => item === value[index]) ? value : next;
    }
    if (!value || typeof value !== "object") return value;
    const entries = [];
    for (const [key, child] of Object.entries(value)) {
      if ((key === "extends" || key === "role") && typeof child === "string") entries.push([key, roleIdsOnRead(child)[0]]);
      else for (const id of roleMaps.has(context) ? roleIdsOnRead(key) : [key]) {
        if (id !== key && Object.hasOwn(value, id)) continue;
        entries.push([id, visit(child, key)]);
      }
    }
    const keys = Object.keys(value);
    return entries.length === keys.length && entries.every(([key, child], index) => key === keys[index] && child === value[key])
      ? value : Object.fromEntries(entries);
  }
  const normalized = visit(doc);
  // Hash the original stored base when approving a legacy pending proposal.
  // This binding never reaches disk and edits/clones do not inherit it.
  if (normalized !== doc) originalDocuments.set(normalized, { doc: originalRoleDocument(doc), snapshot: JSON.stringify(normalized) });
  return normalized;
}
