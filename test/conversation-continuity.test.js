import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArchitecturePlan } from "../src/global/architect/architect-manager.js";
import { taskPaths, transitionTask } from "../src/global/architect/architect-store.js";
import { createConversationService } from "../src/global/conversation/service.js";
import { createSession } from "../src/global/conversation/session-registry.js";
import { createToolHandlers } from "../src/global/mcp/kairo-mcp.js";

// Continuity across environments over the REAL service, exercised through MCP
// only (the Pi tool surface is not part of this line; Pi<->MCP parity is deferred
// until a named Pi RPC consumer needs it).
// Fake startRun/stopRun/readRun, simulated Gentle, temp git repo: no provider,
// no network, no spend. `connect()` builds TWO independent environments (each a
// FRESH service + MCP client, "primary" and "alt") over the same on-disk state,
// which simulates a second client, close/reopen and reconnect. `piCall` keeps
// its name as the "alt" environment caller (throws typed `code` errors on
// failure, like the former Pi tool surface).

const SESSION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const SESSION_B = "aaaaaaaa-0000-4000-8000-000000000002";
const TARGET = Object.freeze({ role: "Builder", selection: "assigned", strategyFingerprint: "fp-1", candidateKey: "codex:m1" });
const ROUTED = { decision: "ROUTED", role: "Builder", strategyFingerprint: "fp-1", model: { adapterId: "codex", modelId: "m1", candidateKey: "codex:m1" } };
const MODEL = { candidateKey: "codex:m1", adapterId: "codex", modelId: "m1", displayName: "M1", accessMode: "automatic" };
const NO_GENTLE = { probe: async () => ({ state: "missing", evidence: [] }), runCommand: () => { throw new Error("must not run"); } };

async function gitRepo() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "kairo-cont-repo-")));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "T"], { cwd: root });
  await writeFile(join(root, "README.md"), "hi\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: root });
  return root;
}

async function setup({ route = ROUTED, serviceDeps = {} } = {}) {
  const root = await gitRepo();
  const home = await mkdtemp(join(tmpdir(), "kairo-cont-home-"));
  const sessionA = await createSession(home, root, {}, { randomUUID: () => SESSION_A });
  const sessionB = await createSession(home, root, {}, { randomUUID: () => SESSION_B });
  const counters = { startRun: 0, stopRun: 0 };
  const runs = {};
  const events = {};
  let runSeq = 0;
  const newTask = async (sessionId = null) => {
    const created = await createArchitecturePlan({
      task: "Do a thing", cwd: root, sessionId, runCodex: async () => ({ plan: "## Plan\nDo it.", usage: null })
    });
    await transitionTask(root, created.status.taskId, "approved");
    return created.status.taskId;
  };
  const connect = () => {
    const serviceOptions = () => ({
      resolveRoot: async () => root, homeDir: home, createRunId: () => `run_cont_${++runSeq}`,
      startRun: async ({ runId }) => {
        counters.startRun += 1;
        runs[runId] = { runId, agentId: "codex", state: "running", error: null };
        return { metadata: { state: "running", startedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" } };
      },
      stopRun: async (_home, runId) => { counters.stopRun += 1; runs[runId].state = "cancelled"; },
      readRun: async (_home, runId) => {
        const run = runs[runId];
        if (run?.throws) throw run.throws;
        return run ?? null;
      },
      readRunEvents: async (_home, runId) => events[runId] ?? [{ type: "run.transcript", source: "codex", data: { text: "Done." } }],
      gentle: NO_GENTLE,
      ...serviceDeps
    });
    const service = createConversationService(serviceOptions());
    if (route) service.routeProjectExecution = async () => route;
    const makeMcp = (svc) => createToolHandlers({
      workspaceBound: true, cwdExplicit: true, cwd: root, processCwd: root, userHome: home, env: {},
      conversationService: svc
    });
    const mcp = makeMcp(service);
    const altService = createConversationService(serviceOptions());
    if (route) altService.routeProjectExecution = async () => route;
    const alt = makeMcp(altService);
    const piCall = async (name, params) => {
      const structured = (await alt[name](params)).structuredContent;
      if (structured.ok === false) throw Object.assign(new Error(structured.code), { code: structured.code });
      return structured.data;
    };
    const mcpCall = async (name, args) => (await mcp[name](args)).structuredContent.data;
    const mcpRaw = async (name, args) => (await mcp[name](args)).structuredContent;
    return { service, altService, piCall, mcpCall, mcpRaw };
  };
  return { root, home, sessionA, sessionB, counters, runs, events, newTask, connect };
}

const both = async (c, name, args) => {
  const [pi, mcp] = [await c.piCall(name, args), await c.mcpCall(name, args)];
  assert.deepEqual(pi, mcp, `${name}: projections must be identical across independent MCP environments`);
  return pi;
};
const exists = (path) => stat(path).then(() => true, () => false);

async function launchVia(call, taskId) {
  const plan = await call("kairo_plan_execution", { taskId, role: "Builder" });
  assert.equal(plan.confirmationRequired, true);
  return call("kairo_execute_plan", { taskId, confirmationTarget: plan.confirmationTarget });
}

test("1a. start in MCP (plan -> confirmed execute), continue in a second MCP environment with identical projections, zero extra launches", async () => {
  const h = await setup();
  const taskId = await h.newTask();
  const c = h.connect();
  const run = await launchVia(c.mcpCall, taskId);
  assert.equal(run.reused, false);
  assert.equal(h.counters.startRun, 1);
  h.runs[run.runId].state = "completed";
  const result = await both(c, "kairo_task_result", { taskId });
  assert.equal(result.runId, run.runId);
  assert.equal(result.status, "terminal");
  await both(c, "kairo_team", {});
  await both(c, "kairo_sessions", {});
  assert.equal(h.counters.startRun, 1);
});

test("1b. start in the second MCP environment, read in the first with identical projections, zero extra launches", async () => {
  const h = await setup();
  const taskId = await h.newTask();
  const c = h.connect();
  const run = await launchVia(c.piCall, taskId);
  assert.equal(run.reused, false);
  h.runs[run.runId].state = "completed";
  const result = await both(c, "kairo_task_result", { taskId });
  assert.equal(result.runId, run.runId);
  const again = await c.mcpCall("kairo_execute_plan", {
    taskId, confirmationTarget: (await c.mcpCall("kairo_plan_execution", { taskId, role: "Builder" })).confirmationTarget
  });
  assert.equal(again.reused, true);
  await both(c, "kairo_team", {});
  assert.equal(h.counters.startRun, 1);
});

test("2. close and reopen: pending next transition preserved, reconnect never launches, repeated queries are stable", async () => {
  const h = await setup();
  const taskId = await h.newTask();
  const first = h.connect();
  const run = await launchVia(first.mcpCall, taskId);
  h.runs[run.runId].state = "completed";
  const before = await both(first, "kairo_task_result", { taskId });
  assert.equal(before.transitions.next, "review_authorized");
  const bytes = await readFile(taskPaths(h.root, taskId).transitionsPath, "utf8");
  for (let i = 0; i < 3; i += 1) {
    const reopened = h.connect();
    const after = await both(reopened, "kairo_task_result", { taskId });
    assert.deepEqual(after, before);
    const team = await both(reopened, "kairo_team", {});
    assert.equal(team.tasks.find((t) => t.taskId === taskId).nextTransition, "review_authorized");
  }
  assert.equal(await readFile(taskPaths(h.root, taskId).transitionsPath, "utf8"), bytes);
  assert.equal(h.counters.startRun, 1);
  assert.equal(h.counters.stopRun, 0);
  const preview = await h.connect().piCall("kairo_plan_execution", { taskId, role: "Builder" });
  assert.equal(preview.confirmationRequired, true, "reconnect never authorizes: a new confirmation is still required");
  assert.equal(h.counters.startRun, 1);
});

test("3. interrupted run: typed interrupted state, next transition derived, nothing relaunched", async () => {
  const h = await setup();
  const taskId = await h.newTask();
  const c = h.connect();
  const run = await launchVia(c.mcpCall, taskId);
  h.runs[run.runId].state = "interrupted";
  const out = await both(h.connect(), "kairo_task_result", { taskId });
  assert.equal(out.runState, "interrupted");
  assert.equal(out.status, "terminal");
  assert.equal(out.result.ok, false);
  assert.equal(typeof out.transitions.next, "string");
  assert.equal(out.transitions.next, "review_authorized");
  await both(h.connect(), "kairo_task_result", { taskId });
  assert.equal(h.counters.startRun, 1);
});

test("4a. corrupt run record and corrupt events: typed result_corrupt, no crash, no relaunch", async () => {
  const h = await setup();
  const taskId = await h.newTask();
  const c = h.connect();
  const run = await launchVia(c.mcpCall, taskId);
  h.runs[run.runId].throws = new SyntaxError("Unexpected token in run.json");
  const unreadable = await both(h.connect(), "kairo_task_result", { taskId });
  assert.equal(unreadable.status, "evidence_unreadable");
  assert.equal(unreadable.errorCode, "result_corrupt");
  assert.equal(unreadable.result, null);
  h.runs[run.runId].throws = null;
  h.runs[run.runId].state = "completed";
  h.events[run.runId] = [{ parseError: true, line: 2 }];
  const badEvents = await both(h.connect(), "kairo_task_result", { taskId });
  assert.equal(badEvents.errorCode, "result_corrupt");
  assert.equal(badEvents.result, null);
  assert.equal(h.counters.startRun, 1);
});

test("4b. corrupt transitions file: typed transitions_corrupt, result still read, file never overwritten, no relaunch", async () => {
  const h = await setup();
  const taskId = await h.newTask();
  const c = h.connect();
  const run = await launchVia(c.piCall, taskId);
  h.runs[run.runId].state = "completed";
  await writeFile(taskPaths(h.root, taskId).transitionsPath, "garbage{\n");
  const fresh = h.connect();
  const out = await both(fresh, "kairo_task_result", { taskId });
  assert.equal(out.status, "terminal");
  assert.equal(out.transitions.state, "corrupt");
  assert.equal(out.transitions.next, null);
  const raw = await fresh.service.readTaskResult({ cwd: h.root, taskId });
  assert.equal(raw.transitions.error, "transitions_corrupt");
  const team = await both(fresh, "kairo_team", {});
  assert.equal(team.tasks.find((t) => t.taskId === taskId).nextTransition, null);
  assert.equal(await readFile(taskPaths(h.root, taskId).transitionsPath, "utf8"), "garbage{\n");
  const replay = await launchVia(fresh.mcpCall, taskId);
  assert.equal(replay.reused, true);
  assert.equal(h.counters.startRun, 1);
});

test("5a. cancel from the other environment is reflected in both; unknown run is a typed error", async () => {
  const h = await setup();
  const taskId = await h.newTask();
  const c = h.connect();
  const run = await launchVia(c.mcpCall, taskId);
  const cancelled = await c.piCall("kairo_cancel_execution", { taskId });
  assert.equal(cancelled.state, "cancelled");
  assert.equal(h.counters.stopRun, 1);
  const result = await both(h.connect(), "kairo_task_result", { taskId });
  assert.equal(result.runState, "cancelled");
  assert.equal(result.runId, run.runId);
  const team = await both(h.connect(), "kairo_team", {});
  assert.equal(team.tasks.find((t) => t.taskId === taskId).execution.state, "cancelled");
  const other = await h.newTask();
  await assert.rejects(c.piCall("kairo_cancel_execution", { taskId: other }), { code: "execution_not_found" });
  const mcp = await c.mcpRaw("kairo_cancel_execution", { taskId: other });
  assert.equal(mcp.code, "execution_not_found");
  assert.equal(h.counters.stopRun, 1);
  assert.equal(h.counters.startRun, 1);
});

test("5b. cancel with a session ref refuses a run owned by another session and does not cancel it (both MCP environments)", async () => {
  const h = await setup();
  const taskId = await h.newTask(h.sessionA.id);
  const c = h.connect();
  await launchVia(c.mcpCall, taskId);
  await assert.rejects(c.piCall("kairo_cancel_execution", { taskId, ref: h.sessionB.id }), { code: "session_mismatch" });
  const mcp = await c.mcpRaw("kairo_cancel_execution", { taskId, ref: h.sessionB.id });
  assert.equal(mcp.code, "session_mismatch");
  assert.equal(mcp.ok, false);
  assert.equal(h.counters.stopRun, 0, "a foreign session must not cancel the run");
  const result = await c.piCall("kairo_task_result", { taskId });
  assert.equal(result.runState, "running");
  const ok = await c.piCall("kairo_cancel_execution", { taskId, ref: h.sessionA.id });
  assert.equal(ok.state, "cancelled");
  assert.equal(h.counters.stopRun, 1);
});

test("5c. cancel with an ambiguous or unknown ref is rejected and nothing is cancelled", async () => {
  const h = await setup();
  const taskId = await h.newTask(h.sessionA.id);
  const c = h.connect();
  await launchVia(c.mcpCall, taskId);
  await assert.rejects(c.piCall("kairo_cancel_execution", { taskId, ref: "aaaaaaaa" }), { code: "session_ref_ambiguous" });
  assert.equal((await c.mcpRaw("kairo_cancel_execution", { taskId, ref: "aaaaaaaa" })).code, "session_ref_ambiguous");
  await assert.rejects(c.piCall("kairo_cancel_execution", { taskId, ref: "zzzz-nope" }), { code: "session_ref_unknown" });
  assert.equal(h.counters.stopRun, 0);
});

test("6. declined consent: no confirmation leaves no run, no transition, zero launches", async () => {
  const h = await setup();
  const taskId = await h.newTask();
  const c = h.connect();
  const plan = await both(c, "kairo_plan_execution", { taskId, role: "Builder" });
  assert.equal(plan.confirmationRequired, true);
  await assert.rejects(c.piCall("kairo_execute_plan", { taskId, confirmationTarget: null }), { code: "confirmation_required" });
  assert.equal((await c.mcpRaw("kairo_execute_plan", { taskId, confirmationTarget: null })).code, "confirmation_required");
  await assert.rejects(c.piCall("kairo_execute_plan", { taskId, confirmationTarget: { ...plan.confirmationTarget, strategyFingerprint: "declined" } }), { code: "confirmation_stale" });
  assert.equal((await c.mcpRaw("kairo_execute_plan", { taskId, confirmationTarget: { ...plan.confirmationTarget, candidateKey: "other:m" } })).code, "confirmation_stale");
  assert.equal(h.counters.startRun, 0);
  assert.equal(await exists(taskPaths(h.root, taskId).transitionsPath), false);
  const result = await both(h.connect(), "kairo_task_result", { taskId });
  assert.equal(result.status, "not_started");
  assert.equal(result.runId, null);
  assert.equal(await exists(taskPaths(h.root, taskId).transitionsPath), false);
});

test("7. provider unavailable: execute is blocked with a typed code, zero launches, team shows the same blocked reason in both", async () => {
  const strategy = {
    schema: "kairo.project-strategy/v1", status: "active", profileFingerprint: "fp-1", activeRoles: ["Builder"],
    projectTeam: [{ role: "Builder", model: MODEL, fallback: null, decisionEvidence: null, assignmentSource: "recommended",
      recommendedAssignment: { model: MODEL, fallback: null, decisionEvidence: null }, overrideEvidence: null }]
  };
  const h = await setup({
    route: null,
    serviceDeps: {
      readProjectStrategy: async () => strategy,
      inspectExecutionAdapters: () => [{ id: "codex", label: "Codex", available: false, launchable: false, reason: "Codex CLI is not installed" }]
    }
  });
  const taskId = await h.newTask();
  const c = h.connect();
  const waiting = async () => ({ decision: "WAIT_FOR_PROJECT_TEAM", role: "Builder", strategyFingerprint: "fp-1", why: "codex unavailable" });
  c.service.routeProjectExecution = waiting;
  c.altService.routeProjectExecution = waiting;
  await assert.rejects(c.piCall("kairo_execute_plan", { taskId, confirmationTarget: TARGET }), { code: "provider_unavailable" });
  assert.equal((await c.mcpRaw("kairo_execute_plan", { taskId, confirmationTarget: TARGET })).code, "provider_unavailable");
  const plan = await both(c, "kairo_plan_execution", { taskId, role: "Builder" });
  assert.equal(plan.confirmationRequired, false);
  const team = await both(c, "kairo_team", {});
  const builder = team.roles.find((r) => r.role === "Builder");
  assert.equal(builder.eligible, false);
  assert.equal(builder.blockedReason, "Codex CLI is not installed");
  assert.equal(h.counters.startRun, 0);
});

test("8a. Gentle unavailable or unparseable never blocks reading results; taskReview stays not_established", async () => {
  const variants = {
    missing: NO_GENTLE,
    unparseable: {
      probe: async () => { throw new Error("probe exploded"); },
      runCommand: () => { throw new Error("must not run"); }
    }
  };
  for (const [name, gentle] of Object.entries(variants)) {
    const h = await setup({ serviceDeps: { gentle } });
    const taskId = await h.newTask();
    const c = h.connect();
    const run = await launchVia(c.mcpCall, taskId);
    h.runs[run.runId].state = "completed";
    const out = await both(c, "kairo_task_result", { taskId });
    assert.equal(out.status, "terminal", name);
    assert.equal(out.result.ok, true, name);
    assert.equal(out.gentle.state, "unavailable", name);
    assert.equal(out.gentle.taskReview, "not_established", name);
    assert.equal(h.counters.startRun, 1, name);
  }
});

test("8b. a project-level Gentle receipt is never read as task approval", async () => {
  const receipt = {
    provider: "gentle-ai",
    mappedStatus: { state: "approved", receipt: { id: "rcpt-1", state: "approved" }, gate: "open", applicability: "project", nextTransition: null },
    rddMode: "on"
  };
  const h = await setup({ serviceDeps: { readGentleContext: async () => receipt } });
  const taskId = await h.newTask();
  const c = h.connect();
  const run = await launchVia(c.piCall, taskId);
  h.runs[run.runId].state = "completed";
  const out = await both(c, "kairo_task_result", { taskId });
  assert.equal(out.gentle.scope, "project_context");
  assert.equal(out.gentle.taskReview, "not_established");
  assert.equal(out.transitions.next, "review_authorized", "a project receipt never advances the task circuit");
  assert.equal(h.counters.startRun, 1);
});
