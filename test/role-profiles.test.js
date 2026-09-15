import test from "node:test";
import assert from "node:assert/strict";
import { ROLE_PROFILES, getRoleProfile } from "../src/global/intelligence/role-profiles.js";
import { ROLE_CAPABILITIES } from "../src/global/intelligence/model-intelligence.js";

const KNOWN_ROLES = ["Explorer", "Architect", "Builder", "Debugger", "Tester", "Reviewer"];

test("ROLE_PROFILES defines exactly the six real team-vocabulary roles, never Economy", () => {
  assert.deepEqual(Object.keys(ROLE_PROFILES), KNOWN_ROLES);
  assert.equal(ROLE_PROFILES.Economy, undefined);
});

test("every RoleProfile's capabilities is the SAME object as ROLE_CAPABILITIES[role] — one source of truth, never a duplicate", () => {
  for (const role of KNOWN_ROLES) {
    assert.equal(ROLE_PROFILES[role].capabilities, ROLE_CAPABILITIES[role]);
  }
});

test("every RoleProfile has every required field, non-empty", () => {
  const requiredStringFields = ["role", "objective", "responsibility", "deliverable", "riskLevel", "completionCriteria"];
  for (const role of KNOWN_ROLES) {
    const profile = ROLE_PROFILES[role];
    for (const field of requiredStringFields) {
      assert.equal(typeof profile[field], "string", `${role}.${field} should be a string`);
      assert.ok(profile[field].length > 0, `${role}.${field} should not be empty`);
    }
    assert.equal(profile.role, role);
    assert.ok(Array.isArray(profile.allowedActions) && profile.allowedActions.length > 0, `${role}.allowedActions should be a non-empty array`);
    assert.ok(Array.isArray(profile.escalationConditions) && profile.escalationConditions.length > 0, `${role}.escalationConditions should be a non-empty array`);
    assert.ok(["low", "medium", "high"].includes(profile.riskLevel), `${role}.riskLevel should be low/medium/high`);
    assert.ok(Array.isArray(profile.dependencies?.dependsOn), `${role}.dependencies.dependsOn should be an array`);
    assert.ok(Array.isArray(profile.dependencies?.independentOf), `${role}.dependencies.independentOf should be an array`);
  }
});

test("every dependsOn/independentOf entry names a real known role, never Economy or a typo", () => {
  for (const role of KNOWN_ROLES) {
    const { dependsOn, independentOf } = ROLE_PROFILES[role].dependencies;
    for (const other of [...dependsOn, ...independentOf]) {
      assert.ok(KNOWN_ROLES.includes(other), `${role}'s dependencies reference unknown role "${other}"`);
    }
  }
});

test("Builder never depends on Reviewer, and Reviewer is marked independent from Builder — the real independence rule model-intelligence.js's buildAiTeam enforces mechanically", () => {
  assert.ok(!ROLE_PROFILES.Builder.dependencies.dependsOn.includes("Reviewer"));
  assert.ok(ROLE_PROFILES.Reviewer.dependencies.independentOf.includes("Builder"));
});

test("Architect and Reviewer are marked high risk — the two roles whose real mistakes are most expensive for the rest of the team to catch", () => {
  assert.equal(ROLE_PROFILES.Architect.riskLevel, "high");
  assert.equal(ROLE_PROFILES.Reviewer.riskLevel, "high");
});

test("getRoleProfile returns the real profile for a known role and null for anything else, including Economy", () => {
  assert.equal(getRoleProfile("Architect"), ROLE_PROFILES.Architect);
  assert.equal(getRoleProfile("Economy"), null);
  assert.equal(getRoleProfile("NotARealRole"), null);
});
