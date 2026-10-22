import test from "node:test";
import assert from "node:assert/strict";
import { ROLE_REGISTRY } from "../src/global/intelligence/role-registry.js";

const load = () => import("../src/global/intelligence/gentle-role-map.js");
const assignment = (role, modelId = `${role}-model`, effort) => ({
  role,
  model: { adapterId: "claude", modelId, ...(effort === undefined ? {} : { effort }) },
  assignmentSource: "recommended"
});

test("Explorer maps to odd-explorer using the registry role ID", async () => {
  const { GENTLE_ROLE_MAP, mapGentleRolePicks } = await load();
  assert.equal(GENTLE_ROLE_MAP.Explorer, "odd-explorer");
  assert.deepEqual(mapGentleRolePicks([assignment("Explorer")]).picks, {
    "odd-explorer": { role: "Explorer", model: "Explorer-model" }
  });
  assert.ok(Object.keys(GENTLE_ROLE_MAP).every(role => Object.hasOwn(ROLE_REGISTRY, role)));
});

test("every implementation role maps to odd-worker", async () => {
  const { GENTLE_ROLE_MAP, mapGentleRolePicks } = await load();
  for (const role of ["Builder", "Frontend Builder", "Backend Builder", "Debugger", "Refactorer"]) {
    assert.equal(GENTLE_ROLE_MAP[role], "odd-worker");
    assert.deepEqual(mapGentleRolePicks([assignment(role)]).picks, {
      "odd-worker": { role, model: `${role}-model` }
    });
  }
});

test("Tester and Verifier map to odd-verify", async () => {
  const { GENTLE_ROLE_MAP, mapGentleRolePicks } = await load();
  for (const role of ["Tester", "Verifier"]) {
    assert.equal(GENTLE_ROLE_MAP[role], "odd-verify");
    assert.deepEqual(mapGentleRolePicks([assignment(role)]).picks, {
      "odd-verify": { role, model: `${role}-model` }
    });
  }
});

test("every role without an ODD counterpart is reported with its assigned model", async () => {
  const { GENTLE_ROLE_MAP, mapGentleRolePicks } = await load();
  const roles = Object.keys(ROLE_REGISTRY).filter(role => !Object.hasOwn(GENTLE_ROLE_MAP, role));
  assert.deepEqual(new Set(roles), new Set(["Architect", "Reviewer", "Planner", "Security Reviewer", "DevOps", "Documenter"]));
  const result = mapGentleRolePicks([...roles.map(role => assignment(role)), assignment("Future Role")]);
  assert.deepEqual(result.picks, {});
  assert.deepEqual(result.unmapped, [...roles, "Future Role"].map(role => ({ role, model: `${role}-model` })));
});

test("Builder wins worker collisions and all other candidates remain visible", async () => {
  const { mapGentleRolePicks } = await load();
  const roles = ["Refactorer", "Backend Builder", "Frontend Builder", "Debugger", "Builder"];
  const team = roles.map(role => assignment(role));
  const result = mapGentleRolePicks(team);
  assert.deepEqual(result.picks["odd-worker"], { role: "Builder", model: "Builder-model" });
  const expected = Object.keys(ROLE_REGISTRY).filter(role => roles.includes(role) && role !== "Builder");
  assert.deepEqual(result.alternatives["odd-worker"], expected.map(role => ({ role, model: `${role}-model` })));
  assert.deepEqual(mapGentleRolePicks([...team].reverse()), result);
});

test("Verifier wins over Tester and retains Tester as an alternative", async () => {
  const { mapGentleRolePicks } = await load();
  const team = [assignment("Tester"), assignment("Verifier")];
  const result = mapGentleRolePicks(team);
  assert.deepEqual(result.picks["odd-verify"], { role: "Verifier", model: "Verifier-model" });
  assert.deepEqual(result.alternatives["odd-verify"], [{ role: "Tester", model: "Tester-model" }]);
  assert.deepEqual(mapGentleRolePicks([...team].reverse()), result);
});

test("registry order resolves collisions without a generic role", async () => {
  const { mapGentleRolePicks } = await load();
  const roles = ["Frontend Builder", "Backend Builder", "Refactorer", "Debugger"];
  const ordered = Object.keys(ROLE_REGISTRY).filter(role => roles.includes(role));
  const result = mapGentleRolePicks(roles.map(role => assignment(role)));
  assert.deepEqual(result.picks["odd-worker"], { role: ordered[0], model: `${ordered[0]}-model` });
  assert.deepEqual(result.alternatives["odd-worker"], ordered.slice(1).map(role => ({ role, model: `${role}-model` })));
});

test("empty and partial teams do not invent picks", async () => {
  const { mapGentleRolePicks } = await load();
  assert.deepEqual(mapGentleRolePicks(), { picks: {}, unmapped: [], alternatives: {} });
  assert.deepEqual(mapGentleRolePicks([]), { picks: {}, unmapped: [], alternatives: {} });
  assert.deepEqual(mapGentleRolePicks([assignment("Tester")]), {
    picks: { "odd-verify": { role: "Tester", model: "Tester-model" } }, unmapped: [], alternatives: {}
  });
  assert.deepEqual(mapGentleRolePicks([{ role: "Explorer", model: null }]).picks, {
    "odd-explorer": { role: "Explorer", model: null }
  });
});

test("optional effort survives in picks and alternative candidates without mutating inputs", async () => {
  const { mapGentleRolePicks } = await load();
  const team = [assignment("Builder", "builder", "high"), assignment("Debugger", "debugger", "medium")];
  const before = structuredClone(team);
  const result = mapGentleRolePicks(team);
  assert.deepEqual(result.picks["odd-worker"], { role: "Builder", model: "builder", effort: "high" });
  assert.deepEqual(result.alternatives["odd-worker"], [{ role: "Debugger", model: "debugger", effort: "medium" }]);
  assert.deepEqual(team, before);
});
