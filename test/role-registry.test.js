import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ROLE_REGISTRY, roleView, rolesWhere } from "../src/global/intelligence/role-registry.js";
import { ROLE_CAPABILITIES, ROLE_METRIC_WEIGHTS, ROLE_PROFILES, ALLOWED_ACTION_IDS, ESCALATION_SIGNAL_IDS, getRoleProfile } from "../src/global/intelligence/role-profiles.js";
import { ASSESSMENT_RAISED_ROLES, ROLE_WORK_VOLUME, roleDemandFloor, roleWorkVolume, nearEquivalenceBandFor, isLightRole } from "../src/global/intelligence/role-demand.js";
import { buildAiTeam, buildEfficientTeam, TECHNICAL_ROLES } from "../src/global/intelligence/model-intelligence.js";
import { KNOWN_ROLES } from "../src/global/team/project-analysis.js";
import { buildProjectStrategy } from "../src/global/team/project-strategy.js";

// Literal pre-refactor values, captured before role-registry.js existed.
const old = {
  "capabilities": {
    "Explorer": {
      "required": [
        "reasoning"
      ],
      "optional": [
        "instructionFollowing",
        "agenticExecution"
      ]
    },
    "Architect": {
      "required": [
        "reasoning",
        "coding",
        "agenticExecution"
      ],
      "optional": [
        "instructionFollowing"
      ]
    },
    "Builder": {
      "required": [
        "coding",
        "terminalExecution",
        "agenticExecution"
      ],
      "optional": [
        "softwareExecution",
        "instructionFollowing"
      ]
    },
    "Debugger": {
      "required": [
        "reasoning",
        "coding",
        "terminalExecution",
        "agenticExecution"
      ],
      "optional": [
        "softwareExecution"
      ]
    },
    "Tester": {
      "required": [
        "coding",
        "terminalExecution"
      ],
      "optional": [
        "responseTime"
      ]
    },
    "Reviewer": {
      "required": [
        "reasoning",
        "coding"
      ],
      "optional": []
    }
  },
  "metricWeights": {
    "Explorer": {
      "reasoning": 0.45,
      "agenticExecution": 0.25,
      "coding": 0.3
    },
    "Architect": {
      "reasoning": 0.4,
      "coding": 0.3,
      "agenticExecution": 0.3
    },
    "Builder": {
      "coding": 0.45,
      "agenticExecution": 0.3,
      "terminalExecution": 0.25
    },
    "Debugger": {
      "coding": 0.35,
      "terminalExecution": 0.3,
      "reasoning": 0.2,
      "agenticExecution": 0.15
    },
    "Tester": {
      "coding": 0.5,
      "terminalExecution": 0.3,
      "responseTime": 0.2
    },
    "Reviewer": {
      "coding": 0.5,
      "reasoning": 0.5
    }
  },
  "allowedActionIds": [
    "repo.read",
    "repo.search",
    "repo.inspect_history",
    "plan.write",
    "repo.write",
    "build.run",
    "lint.run",
    "test.run",
    "test.write",
    "review.write",
    "git.commit",
    "git.push",
    "pr.open"
  ],
  "escalationSignalIds": [
    "large_scope",
    "architectural_intent_required",
    "cross_subsystem",
    "high_reversal_cost",
    "plan_invalidated",
    "security_sensitive",
    "root_cause_not_found",
    "high_uncertainty"
  ]
};
const roles = ["Explorer", "Architect", "Builder", "Debugger", "Tester", "Reviewer"];
function snapshot({ models, eligibility, profiles, scenarios }) {
  return scenarios.map(providerCapacity => ({
    quality: buildAiTeam(models, eligibility, null, undefined, { providerCapacity }),
    efficient: buildEfficientTeam(models, eligibility, null, { providerCapacity }),
    strategies: profiles.map(profile => buildProjectStrategy({
      fingerprint: "f",
      roleRequirements: [{ role: "Builder", capabilities: ["reasoning"], reason: "" }],
      ...profile
    }, { scoredAll: models, eligibility, registry: null, providerCapacity, now: Date.parse("2026-01-01T00:00:00Z") }, {
      model: { adapterId: "claude", modelId: "claude-opus-5-5" }
    }))
  }));
}

test("S41 all team and strategy outputs equal the pre-refactor golden", () => {
  // S1/S2: golden regenerated; build roles (Builder, Tester) lose frontier picks/fallbacks, Builder skips project raises, and quota-volume evidence cascades to Explorer.
  // S15 intentionally changes only the host-owned orchestrator fixture field; T21 adds selection.modelRoleCap.
  const golden = JSON.parse(readFileSync(new URL("./fixtures/role-registry-golden.json", import.meta.url)));
  assert.deepEqual(snapshot(golden.inputs), golden.expected);
});
test("S41 derived views retain every old literal value and role order", () => {
  const legacy = view => Object.fromEntries(roles.map(role => [role, view[role]]));
  assert.deepEqual(Object.keys(ROLE_REGISTRY).slice(0, roles.length), roles);
  assert.deepEqual([...KNOWN_ROLES], Object.keys(ROLE_REGISTRY));
  assert.deepEqual(TECHNICAL_ROLES, Object.keys(ROLE_REGISTRY));
  assert.deepEqual(legacy(ROLE_CAPABILITIES), old.capabilities);
  assert.deepEqual(legacy(ROLE_METRIC_WEIGHTS), old.metricWeights);
  assert.deepEqual(ALLOWED_ACTION_IDS, old.allowedActionIds);
  assert.deepEqual(ESCALATION_SIGNAL_IDS, old.escalationSignalIds);
  assert.deepEqual(ASSESSMENT_RAISED_ROLES, ["Architect", "Debugger", "Reviewer", "Security Reviewer"]);
  assert.deepEqual(legacy(ROLE_WORK_VOLUME), {Builder:1,Tester:.6,Explorer:.5,Debugger:.3,Architect:.2,Reviewer:.2});
  assert.deepEqual(legacy(roleView("tier")), {Explorer:"light",Architect:"demanding",Builder:"standard",Debugger:"demanding",Tester:"light",Reviewer:"demanding"});
  assert.deepEqual(legacy(roleView("nearEquivalenceBand")), {Explorer:.06,Architect:.03,Builder:.06,Debugger:.05,Tester:.06,Reviewer:.05});
  assert.deepEqual(rolesWhere("alwaysOn"), ["Explorer", "Architect"]);
  assert.deepEqual(rolesWhere("orchestrator"), ["Architect"]);
  assert.deepEqual(legacy(roleView("activation")), {
    Explorer: { always: true }, Architect: { always: true },
    Builder: { any: ["build-command", "known-stack"] },
    Debugger: { command: "test" },
    Tester: { command: "test", otherwise: "gap" },
    Reviewer: { any: ["lint-command", "typecheck-command"], otherwise: "gap" }
  });
});
test("S41 registry deeply freezes role metadata and shares profile capabilities", () => {
  const frozen = value => { if (value && typeof value === "object") { assert.ok(Object.isFrozen(value)); for (const child of Object.values(value)) frozen(child); } };
  frozen(ROLE_REGISTRY);
  for (const role of Object.keys(ROLE_REGISTRY)) {
    assert.equal(ROLE_PROFILES[role], ROLE_REGISTRY[role].profile);
    assert.equal(getRoleProfile(role).capabilities, ROLE_CAPABILITIES[role]);
    assert.ok(ROLE_REGISTRY[role].activation);
  }
});
test("S41 unknown role fallbacks remain unchanged", () => {
  assert.equal(getRoleProfile("unknown"), null);
  assert.equal(roleDemandFloor("unknown"), .55);
  assert.equal(roleWorkVolume("unknown"), .2);
  assert.equal(nearEquivalenceBandFor("unknown"), .06);
  assert.equal(isLightRole("unknown"), false);
});


test("S40 catalog metadata has normalized required weights, split volume and closed actions", () => {
  const catalog = ["Frontend Builder", "Backend Builder", "Planner", "Security Reviewer", "DevOps", "Verifier", "Refactorer", "Documenter", "Deliverer"];
  for (const role of catalog) {
    const entry = ROLE_REGISTRY[role];
    assert.ok(entry, role);
    assert.equal(entry.technical, true);
    assert.ok(entry.activation);
    assert.ok(Math.abs(Object.values(entry.metricWeights).reduce((a, b) => a + b, 0) - 1) < 1e-9);
    for (const key of Object.keys(entry.metricWeights)) assert.ok(entry.capabilities.required.includes(key), `${role}: ${key}`);
    for (const id of entry.profile.allowedActionIds) assert.ok(ALLOWED_ACTION_IDS.includes(id));
    for (const id of entry.profile.escalationSignalIds) assert.ok(ESCALATION_SIGNAL_IDS.includes(id));
    assert.ok(TECHNICAL_ROLES.includes(role));
  }
  assert.equal(roleWorkVolume("Frontend Builder"), .5);
  assert.equal(roleWorkVolume("Backend Builder"), .5);
  assert.equal(roleWorkVolume("Verifier"), roleWorkVolume("Tester"));
  assert.deepEqual(ROLE_PROFILES.Verifier.allowedActionIds, ["test.run", "lint.run"]);
  assert.deepEqual(rolesWhere("orchestrator"), ["Architect"]);
});

test("Deliverer is a light, delivery-only catalog role", () => {
  const entry = ROLE_REGISTRY.Deliverer;
  assert.equal(entry.tier, "light");
  assert.equal(entry.defaultTeam, false);
  assert.equal(entry.builder, false);
  assert.deepEqual(entry.activation, { any: ["gitRemote"] });
  assert.deepEqual(entry.profile.allowedActionIds, ["repo.read", "git.commit", "git.push", "pr.open"]);
});
