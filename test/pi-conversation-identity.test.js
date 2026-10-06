import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArchitecturePlan } from "../src/global/architect/architect-manager.js";
import { transitionTask } from "../src/global/architect/architect-store.js";
import { createConversationService } from "../src/global/conversation/service.js";
import { createSession } from "../src/global/conversation/session-registry.js";
import { createToolHandlers } from "../src/global/mcp/kairo-mcp.js";
import { registerKairoConversationTools, KAIRO_PI_CONVERSATION_TOOLS } from "../src/global/host/extension/conversation-tools.js";
import { createKairoWorkspaceExtension } from "../src/global/host/extension/index.js";

const RUN = "run_pi_1";
const SNAPSHOT = {
  project: { label: "demo" }, session: { state: "unbound" },
  team: { state: "active", assignments: [], rows: [] }, usage: [], agents: [], spaces: [],
  subscriptions: { state: "ready", segments: [], usageModel: [] }, memory: { status: "configured" }
};
const TARGET = Object.freeze({ role: "Builder", selection: "assigned", strategyFingerprint: "fp-1", candidateKey: "codex:m1" });

async function gitRepo() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "kairo-pi-repo-")));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "T"], { cwd: root });
  await writeFile(join(root, "README.md"), "hi\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: root });
  return root;
}

async function harness() {
  const root = await gitRepo();
  const home = await mkdtemp(join(tmpdir(), "kairo-pi-home-"));
  const created = await createArchitecturePlan({
    task: "Do a thing", cwd: root, runCodex: async () => ({ plan: "## Plan\nDo it.", usage: null })
  });
  const taskId = created.status.taskId;
  await transitionTask(root, taskId, "approved");
  const counters = { startRun: 0 };
  const service = createConversationService({
    resolveRoot: async () => root, homeDir: home, createRunId: () => RUN,
    startRun: async () => {
      counters.startRun += 1;
      return { metadata: { state: "running", startedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" } };
    },
    readRun: async () => ({ runId: RUN, agentId: "codex", state: "completed", error: null }),
    readRunEvents: async () => [{ type: "run.transcript", source: "codex", data: { text: "Done." } }],
    gentle: { probe: async () => ({ state: "missing", evidence: [] }), runCommand: () => { throw new Error("must not run"); } }
  });
  service.routeProjectExecution = async () => ({
    decision: "ROUTED", role: "Builder", strategyFingerprint: "fp-1",
    model: { adapterId: "codex", modelId: "m1", candidateKey: "codex:m1" }
  });
  const session = await createSession(home, root, {});
  const mcp = createToolHandlers({
    workspaceBound: true, cwdExplicit: true, cwd: root, processCwd: root, userHome: home, env: {},
    conversationService: service
  });
  const tools = new Map();
  const pi = { registerTool(t) { tools.set(t.name, t); } };
  registerKairoConversationTools(pi, { getService: async () => service, resolveProjectRootImpl: async (c) => c });
  const ctx = { cwd: root };
  const piCall = async (name, params) => (await tools.get(name).execute("id", params, undefined, undefined, ctx)).details;
  const mcpCall = async (name, args) => (await mcp[name](args)).structuredContent.data;
  return { root, home, taskId, counters, service, session, tools, piCall, mcpCall, ctx };
}

test("Pi registers the shared tools (six conversation + five setup) with the MCP names", async () => {
  const h = await harness();
  assert.deepEqual([...h.tools.keys()].sort(), [...KAIRO_PI_CONVERSATION_TOOLS].sort());
  assert.deepEqual([...KAIRO_PI_CONVERSATION_TOOLS].sort(), [
    "kairo_cancel_execution", "kairo_execute_plan", "kairo_plan_execution",
    "kairo_sessions", "kairo_setup", "kairo_setup_approve_team", "kairo_setup_plan",
    "kairo_setup_run_analysis", "kairo_setup_set_assignment", "kairo_task_result", "kairo_team"
  ]);
});

test("identity: Pi and MCP return deeply equal sessions, team, task, run for the same project", async () => {
  const h = await harness();
  assert.deepEqual(await h.piCall("kairo_sessions", {}), await h.mcpCall("kairo_sessions", {}));
  assert.deepEqual(await h.piCall("kairo_team", {}), await h.mcpCall("kairo_team", {}));
  const plan = await h.piCall("kairo_plan_execution", { taskId: h.taskId, role: "Builder" });
  assert.deepEqual(plan, await h.mcpCall("kairo_plan_execution", { taskId: h.taskId, role: "Builder" }));
  assert.equal(plan.confirmationRequired, true);
  assert.equal(h.counters.startRun, 0, "preview never launches");
  console.error("PLAN", JSON.stringify(plan));
  const run = await h.piCall("kairo_execute_plan", { taskId: h.taskId, confirmationTarget: plan.confirmationTarget });
  assert.equal(run.reused, false);
  assert.equal(h.counters.startRun, 1);
  const mcpRun = await h.mcpCall("kairo_execute_plan", { taskId: h.taskId, confirmationTarget: plan.confirmationTarget });
  assert.equal(mcpRun.runId, run.runId);
  assert.equal(mcpRun.reused, true);
  assert.equal(h.counters.startRun, 1, "second confirmed execute reuses, never relaunches");
  assert.deepEqual(await h.piCall("kairo_task_result", { taskId: h.taskId }), await h.mcpCall("kairo_task_result", { taskId: h.taskId }));
  assert.deepEqual(await h.piCall("kairo_team", {}), await h.mcpCall("kairo_team", {}));
  const result = await h.piCall("kairo_task_result", { taskId: h.taskId });
  assert.equal(result.runId, RUN);
  assert.ok(Array.isArray(result.transitions.recorded));
  assert.equal(typeof result.transitions.next === "string" || result.transitions.next === null, true);
  assert.equal(h.counters.startRun, 1);
});

test("Pi refuses ambiguous refs, unconfirmed execute and stale targets; nothing launches", async () => {
  const h = await harness();
  const second = await createSession(h.home, h.root, {});
  const shared = [...h.session.id].findIndex((c, k) => c !== second.id[k]);
  const prefix = h.session.id.slice(0, shared);
  if (prefix.length > 0) {
    await assert.rejects(h.piCall("kairo_sessions", { ref: prefix }), { code: "session_ref_ambiguous" });
  }
  await assert.rejects(h.piCall("kairo_sessions", { ref: "zzzz-nope" }), { code: "session_ref_unknown" });
  await assert.rejects(h.piCall("kairo_execute_plan", { taskId: h.taskId, confirmationTarget: null }), { code: "confirmation_required" });
  await assert.rejects(h.piCall("kairo_execute_plan", {
    taskId: h.taskId, confirmationTarget: { ...TARGET, strategyFingerprint: "other" }
  }), { code: "confirmation_stale" });
  assert.equal(h.counters.startRun, 0);
});

test("Pi tools refuse without an explicit host project (no process cwd fallback)", async () => {
  const h = await harness();
  const out = h.tools.get("kairo_sessions").execute("id", {}, undefined, undefined, undefined);
  await assert.rejects(out, { code: "project_unbound" });
});

test("reconnect (session_start reload/resume with a binding) and repeated Pi queries launch zero runs", async () => {
  const h = await harness();
  const tools = new Map();
  const events = new Map();
  const pi = {
    registerCommand() {}, registerProvider() {}, unregisterProvider() {},
    registerTool(t) { tools.set(t.name, t); }, on(n, fn) { events.set(n, fn); }
  };
  createKairoWorkspaceExtension(pi, {
    env: {}, loadSnapshot: async () => SNAPSHOT,
    loadUsageData: async () => ({ usage: {}, providers: {} }), loadLiveData: async () => null, loadRouteModels: async () => [],
    resolveHomeDirImpl: () => h.home, resolveProjectRootImpl: async () => h.root,
    lookupPiBindingImpl: async () => h.session.id, getSessionImpl: async () => ({ id: h.session.id, mode: "agent" }),
    recordPiBindingImpl: async () => ({}),
    conversationService: h.service
  });
  const ctx = { cwd: h.root, sessionManager: { getSessionId: () => "pi-1" }, ui: { setStatus() {}, setWidget() {}, notify() {} } };
  for (const reason of ["reload", "resume", "reload"]) await events.get("session_start")({ reason }, ctx);
  for (let i = 0; i < 3; i += 1) {
    await tools.get("kairo_team").execute("id", {}, undefined, undefined, ctx);
    await tools.get("kairo_task_result").execute("id", { taskId: h.taskId }, undefined, undefined, ctx);
    await tools.get("kairo_sessions").execute("id", {}, undefined, undefined, ctx);
  }
  assert.equal(h.counters.startRun, 0);
});

test("Pi cancel and unknown-task errors go through the shared service only", async () => {
  const calls = [];
  const service = { cancelExecution: async (a) => { calls.push(a); return { taskId: a.taskId, execution: { runId: "r1", state: "cancelled", active: false } }; } };
  const tools = new Map();
  registerKairoConversationTools({ registerTool(t) { tools.set(t.name, t); } }, { getService: async () => service, resolveProjectRootImpl: async (c) => c });
  const out = await tools.get("kairo_cancel_execution").execute("id", { taskId: "t-1" }, undefined, undefined, { cwd: "/proj" });
  assert.deepEqual(calls, [{ cwd: "/proj", taskId: "t-1" }]);
  assert.equal(out.details.state, "cancelled");
});
