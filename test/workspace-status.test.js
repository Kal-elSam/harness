import assert from "node:assert/strict";
import { test } from "node:test";
import {
  WORK_STATUS,
  deriveAgentStatus,
  deriveTaskStatus,
  deriveTeamStatus,
  deriveWorkspaceStatus,
  rolesFromPublicTeam
} from "../src/global/host/workspace-status.js";

const run = (over = {}) => ({ runId: "run_a", state: "running", active: true, role: "Builder", error: null, ...over });
const task = (over = {}) => ({
  taskId: "task-a", state: "approved", execution: null, error: null, nextTransition: "delegated", sessionId: null, ...over
});

test("the status vocabulary is exactly draft / active / working / blocked", () => {
  assert.deepEqual(
    [WORK_STATUS.DRAFT, WORK_STATUS.ACTIVE, WORK_STATUS.WORKING, WORK_STATUS.BLOCKED],
    ["draft", "active", "working", "blocked"]
  );
});

test("team status: suggested strategy is draft, active stays active, stale and absent are explicit", () => {
  assert.equal(deriveTeamStatus("suggested").status, "draft");
  assert.equal(deriveTeamStatus("draft").status, "draft");
  assert.equal(deriveTeamStatus("active").status, "active");
  assert.equal(deriveTeamStatus("stale").status, "stale");
  assert.equal(deriveTeamStatus("not_analyzed").status, "none");
  assert.equal(deriveTeamStatus("none").status, "none");
  assert.equal(deriveTeamStatus("weird").status, "unknown");
  assert.equal(deriveTeamStatus(undefined).status, "unknown");
});

test("task: a plan that is not confirmed for execution is draft, with the reason", () => {
  for (const state of ["draft", "awaiting_approval", "approved"]) {
    const result = deriveTaskStatus(task({ state }));
    assert.equal(result.status, "draft", state);
    assert.ok(result.reason);
  }
  assert.equal(deriveTaskStatus(task({ state: "approved", execution: { state: "not_started", active: false } })).status, "draft");
});

test("task: working only when a real non-terminal run exists", () => {
  for (const state of ["pending", "starting", "running"]) {
    assert.equal(deriveTaskStatus(task({ execution: run({ state }) })).status, "working", state);
  }
  // A claimed `active` with a terminal state is not working.
  assert.notEqual(deriveTaskStatus(task({ execution: run({ state: "completed", active: true }) })).status, "working");
  // A launch reservation with no run record is never working.
  const reserved = deriveTaskStatus(task({ execution: run({ state: "reserved", active: false }) }));
  assert.equal(reserved.status, "unknown");
});

test("task: interrupted, corrupt or unreadable run evidence is blocked with a reason", () => {
  for (const state of ["interrupted", "result_corrupt", "evidence_unreadable"]) {
    const result = deriveTaskStatus(task({ execution: run({ state, active: false }) }));
    assert.equal(result.status, "blocked", state);
    assert.match(result.reason, /interrupted|corrupt|unreadable/i);
  }
  assert.equal(deriveTaskStatus(task({ state: "failed" })).status, "blocked");
});

test("task: terminal results are shown honestly; done only with an observed result", () => {
  const completed = (nextTransition) => deriveTaskStatus(task({ execution: run({ state: "completed", active: false }), nextTransition }));
  // Result not yet read: never claimed done.
  assert.equal(completed("result_observed").status, "unknown");
  assert.equal(completed("delegated").status, "unknown");
  // result_observed recorded (next step is later in the circuit): done.
  assert.equal(completed("review_authorized").status, "done");
  assert.equal(completed(null).status, "done");
  assert.equal(deriveTaskStatus(task({ execution: run({ state: "failed", active: false, error: "boom" }) })).status, "failed");
  assert.equal(deriveTaskStatus(task({ execution: run({ state: "cancelled", active: false }) })).status, "cancelled");
  assert.equal(deriveTaskStatus(task({ state: "rejected" })).status, "rejected");
});

test("agent: draft team => draft, regardless of availability evidence", () => {
  const result = deriveAgentStatus({ role: "Builder", teamStatus: "draft", availability: "available", tasks: [] });
  assert.equal(result.status, "draft");
});

test("agent: active team + available + no run => active (never working)", () => {
  assert.equal(deriveAgentStatus({ role: "Builder", teamStatus: "active", availability: "available", tasks: [] }).status, "active");
});

test("agent: blocked access is blocked and carries the reason", () => {
  const result = deriveAgentStatus({
    role: "Builder", teamStatus: "active", availability: "blocked", reason: "Claude access denied", tasks: []
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "Claude access denied");
});

test("agent: working only with a real non-terminal run attributed to that role", () => {
  const working = deriveAgentStatus({
    role: "Builder", teamStatus: "active", availability: "available",
    tasks: [task({ execution: run({ role: "Builder" }) })]
  });
  assert.equal(working.status, "working");
  // A run of ANOTHER role, or a legacy run with no role, is never attributed.
  for (const other of [run({ role: "Reviewer" }), run({ role: null })]) {
    const result = deriveAgentStatus({
      role: "Builder", teamStatus: "active", availability: "available", tasks: [task({ execution: other })]
    });
    assert.equal(result.status, "active");
  }
  // A terminal run is not working.
  const done = deriveAgentStatus({
    role: "Builder", teamStatus: "active", availability: "available",
    tasks: [task({ execution: run({ state: "completed", active: false }) })]
  });
  assert.equal(done.status, "active");
});

test("agent: its latest run being interrupted or corrupt makes it blocked", () => {
  for (const state of ["interrupted", "result_corrupt"]) {
    const result = deriveAgentStatus({
      role: "Builder", teamStatus: "active", availability: "available",
      tasks: [task({ taskId: "task-x", execution: run({ state, active: false }) })]
    });
    assert.equal(result.status, "blocked", state);
    assert.match(result.reason, /task-x/);
  }
});

test("agent: unknown or checking availability is unknown, never active or permission", () => {
  for (const availability of ["unknown", "checking", undefined]) {
    assert.equal(deriveAgentStatus({ role: "Builder", teamStatus: "active", availability, tasks: [] }).status, "unknown");
  }
});

test("agent: a stale team is blocked with its reason", () => {
  const result = deriveAgentStatus({ role: "Builder", teamStatus: "stale", availability: "available", tasks: [] });
  assert.equal(result.status, "blocked");
  assert.match(result.reason, /stale/i);
});

test("rolesFromPublicTeam maps the shared kairo_team roles to normalized availability", () => {
  const roles = rolesFromPublicTeam({
    roles: [
      { role: "Builder", eligible: true, blockedReason: null },
      { role: "Reviewer", eligible: false, blockedReason: "Codex limit reached" }
    ]
  });
  assert.deepEqual(roles, [
    { role: "Builder", availability: "available", reason: null },
    { role: "Reviewer", availability: "blocked", reason: "Codex limit reached" }
  ]);
});

test("deriveWorkspaceStatus composes team, agents and tasks from one set of shared facts", () => {
  const status = deriveWorkspaceStatus({
    team: { state: "active" },
    roles: [
      { role: "Builder", availability: "available", reason: null },
      { role: "Reviewer", availability: "blocked", reason: "no access" }
    ],
    tasks: [task({ taskId: "task-a", execution: run({ role: "Builder" }) }), task({ taskId: "task-b", state: "awaiting_approval" })]
  });
  assert.equal(status.team.status, "active");
  assert.equal(status.team.working, 1);
  assert.equal(status.team.blocked, 1);
  assert.deepEqual(status.agents.map((a) => [a.role, a.status]), [["Builder", "working"], ["Reviewer", "blocked"]]);
  assert.deepEqual(status.tasks.map((t) => [t.taskId, t.status]), [["task-a", "working"], ["task-b", "draft"]]);
});

test("deriveWorkspaceStatus with no team has no agents and an explicit none", () => {
  const status = deriveWorkspaceStatus({ team: { state: "not_analyzed" }, roles: [], tasks: [] });
  assert.equal(status.team.status, "none");
  assert.deepEqual(status.agents, []);
});
