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
import { loadKairoWorkspaceSnapshot, buildKairoWorkspaceSnapshot } from "../src/global/host/workspace-snapshot.js";
import { deriveWorkspaceStatus, rolesFromPublicTeam } from "../src/global/host/workspace-status.js";

// The workspace snapshot over the REAL conversation service, with fakes
// only at the provider/run edges. Offline: no provider, no network.

const SESSION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TARGET = Object.freeze({ role: "Builder", selection: "assigned", strategyFingerprint: "fp-1", candidateKey: "codex:m1" });
const ROUTED = { decision: "ROUTED", role: "Builder", strategyFingerprint: "fp-1", model: { adapterId: "codex", modelId: "m1", candidateKey: "codex:m1" } };
const CODEX = { displayName: "M1", adapterId: "codex", modelId: "m1", accessMode: "automatic" };
const strategyOf = (status) => ({
  status, bootstrapAnalyst: CODEX, orchestrator: CODEX,
  projectTeam: [{ role: "Builder", model: CODEX }, { role: "Reviewer", model: CODEX }]
});
const AVAILABLE = { eligibility: { codex: { ok: true } }, claudeEntitlement: {}, cursorAccess: {} };
const BLOCKED = { eligibility: { codex: { ok: false, reason: "Codex limit reached" } }, claudeEntitlement: {}, cursorAccess: {} };
const NO_GENTLE = { probe: async () => ({ state: "missing", evidence: [] }), runCommand: () => { throw new Error("must not run"); } };

async function setup({ strategy = strategyOf("active") } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "kairo-work-repo-")));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "T"], { cwd: root });
  await writeFile(join(root, "README.md"), "hi\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: root });
  const home = await realpath(await mkdtemp(join(tmpdir(), "kairo-work-home-")));
  await createSession(home, root, {}, { randomUUID: () => SESSION_A });
  const counters = { startRun: 0 };
  const runs = {};
  let seq = 0;
  const serviceDeps = (extra = {}) => ({
    resolveRoot: async () => root, homeDir: home, createRunId: () => `run_work_${++seq}`,
    readProjectStrategy: async () => strategy,
    startRun: async ({ runId }) => {
      counters.startRun += 1;
      runs[runId] = { runId, agentId: "codex", state: "running", error: null };
      return { metadata: { state: "running", startedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" } };
    },
    readRun: async (_h, runId) => {
      const run = runs[runId];
      if (run?.throws) throw run.throws;
      return run ?? null;
    },
    readRunEvents: async () => [],
    gentle: NO_GENTLE,
    ...extra
  });
  const service = createConversationService(serviceDeps());
  service.routeProjectExecution = async () => ROUTED;
  const newTask = async ({ approve = true } = {}) => {
    const created = await createArchitecturePlan({
      task: "Do a thing", cwd: root, sessionId: null, runCodex: async () => ({ plan: "## Plan\nDo it.", usage: null })
    });
    if (approve) await transitionTask(root, created.status.taskId, "approved");
    return created.status.taskId;
  };
  const launch = async (taskId) => {
    const preview = await service.planExecution({ cwd: root, taskId, role: "Builder" });
    return service.executePlan({ cwd: root, taskId, confirmationTarget: preview.confirmationTarget });
  };
  const deps = {
    resolveProjectRoot: async () => root, resolveHomeDir: () => home,
    readProjectStrategy: async () => strategy, listProviderUsage: async () => [],
    inspectEngramIntegration: () => ({ status: "configured" }),
    readCachedUsage: async () => null, writeCachedUsage: async () => {},
    readCachedAvailability: async () => null, writeCachedAvailability: async () => {},
    createConversationService: (options) => {
      const own = createConversationService({ ...serviceDeps(), ...options });
      own.routeProjectExecution = async () => ROUTED;
      return own;
    }
  };
  const load = (args = {}) => loadKairoWorkspaceSnapshot({ cwd: root, availabilityIntelligence: AVAILABLE, usageIntelligence: null, ...args }, deps);
  return { root, home, runs, counters, service, newTask, launch, load, serviceDeps };
}

test("the snapshot lists sessions and tasks from the shared service, with explicit project and session ids", async () => {
  const s = await setup();
  const approved = await s.newTask();
  const snapshot = await s.load({ sessionId: SESSION_A });
  assert.deepEqual(snapshot.scope, { projectRoot: s.root, sessionId: SESSION_A });
  assert.deepEqual(snapshot.sessions.map((x) => [x.id, x.bound]), [[SESSION_A, true]]);
  assert.equal(snapshot.sessions[0].projectRoot, s.root);
  assert.equal(snapshot.tasks.length, 1);
  assert.deepEqual(
    { id: snapshot.tasks[0].id, state: snapshot.tasks[0].state, status: snapshot.tasks[0].status, role: snapshot.tasks[0].role, runId: snapshot.tasks[0].runId, nextTransition: snapshot.tasks[0].nextTransition },
    { id: approved, state: "approved", status: "draft", role: null, runId: null, nextTransition: "delegated" }
  );
  assert.equal(snapshot.tasks[0].projectRoot, s.root);
  // Existing fields stay valid.
  assert.equal(snapshot.team.state, "active");
  assert.equal(snapshot.session.state, "bound");
});

test("working appears only with a real non-terminal run attributed to the role", async () => {
  const s = await setup();
  const taskId = await s.newTask();
  let snapshot = await s.load();
  assert.equal(snapshot.agents.find((a) => a.role === "Builder").status, "active");
  assert.equal(snapshot.status.working, 0);

  await s.launch(taskId);
  snapshot = await s.load();
  assert.equal(snapshot.tasks[0].status, "working");
  assert.equal(snapshot.tasks[0].role, "Builder");
  assert.match(snapshot.tasks[0].runId, /^run_work_/);
  assert.equal(snapshot.agents.find((a) => a.role === "Builder").status, "working");
  assert.equal(snapshot.agents.find((a) => a.role === "Reviewer").status, "active");
  assert.equal(snapshot.status.working, 1);

  // The run ends: nothing is working any more and nothing is claimed done.
  s.runs[snapshot.tasks[0].runId].state = "completed";
  snapshot = await s.load();
  assert.equal(snapshot.agents.find((a) => a.role === "Builder").status, "active");
  assert.equal(snapshot.tasks[0].status, "unknown");
});

test("an interrupted run makes its task and role blocked with a reason", async () => {
  const s = await setup();
  const taskId = await s.newTask();
  await s.launch(taskId);
  const { runId } = (await s.load()).tasks[0];
  s.runs[runId].state = "interrupted";
  const snapshot = await s.load();
  assert.equal(snapshot.tasks[0].status, "blocked");
  assert.match(snapshot.tasks[0].statusReason, /interrupted/);
  const builder = snapshot.agents.find((a) => a.role === "Builder");
  assert.equal(builder.status, "blocked");
  assert.match(builder.statusReason, /interrupted/);
});

test("corrupt run evidence is blocked, never a crash", async () => {
  const s = await setup();
  const taskId = await s.newTask();
  await s.launch(taskId);
  const { runId } = (await s.load()).tasks[0];
  s.runs[runId].throws = new SyntaxError("Unexpected token");
  const snapshot = await s.load();
  assert.equal(snapshot.tasks[0].status, "blocked");
  assert.match(snapshot.tasks[0].statusReason, /corrupt/);
});

test("blocked access is blocked with the shared reason, and an unresolved probe is unknown", async () => {
  const s = await setup();
  const blocked = await s.load({ availabilityIntelligence: BLOCKED });
  assert.ok(blocked.agents.every((a) => a.status === "blocked"));
  assert.ok(blocked.agents.every((a) => a.statusReason));
  const checking = await s.load({ availabilityIntelligence: undefined });
  assert.ok(checking.agents.every((a) => a.status === "unknown"));
});

test("a draft team shows draft for the team and every role", async () => {
  const s = await setup({ strategy: strategyOf("suggested") });
  const snapshot = await s.load();
  assert.equal(snapshot.status.status, "draft");
  assert.ok(snapshot.agents.every((a) => a.status === "draft"));
});

test("a failed work read keeps the snapshot and says so, never inventing tasks", async () => {
  const s = await setup();
  const snapshot = await loadKairoWorkspaceSnapshot({ cwd: s.root, availabilityIntelligence: AVAILABLE, usageIntelligence: null }, {
    resolveProjectRoot: async () => s.root, resolveHomeDir: () => s.home,
    readProjectStrategy: async () => strategyOf("active"), listProviderUsage: async () => [],
    inspectEngramIntegration: () => ({ status: "configured" }),
    readCachedUsage: async () => null, writeCachedUsage: async () => {},
    readCachedAvailability: async () => null, writeCachedAvailability: async () => {},
    createConversationService: () => { throw new Error("service down"); }
  });
  assert.deepEqual(snapshot.tasks, []);
  assert.deepEqual(snapshot.sessions, []);
  assert.equal(snapshot.workState, "unknown");
  assert.equal(snapshot.team.state, "active");
});

test("refreshing the snapshot is read-only: repeated loads are identical and never launch a run", async () => {
  const s = await setup();
  await s.newTask();
  const first = await s.load({ sessionId: SESSION_A });
  const second = await s.load({ sessionId: SESSION_A });
  const third = await s.load({ sessionId: SESSION_A });
  assert.deepEqual(second, first);
  assert.deepEqual(third, first);
  assert.equal(s.counters.startRun, 0);

  // Even with an active run, reconnecting (a fresh load/service) never relaunches.
  await s.launch((await s.load()).tasks[0].id);
  assert.equal(s.counters.startRun, 1);
  await s.load(); await s.load();
  assert.equal(s.counters.startRun, 1);
});

test("the snapshot data and the MCP read tool agree on team, task and role status for the same project", async () => {
  const s = await setup();
  const taskId = await s.newTask();
  await s.launch(taskId);
  await s.newTask({ approve: false });

  const mcp = createToolHandlers({
    workspaceBound: true, cwdExplicit: true, cwd: s.root, processCwd: s.root, userHome: s.home, env: {},
    conversationService: s.service
  });
  const mcpTeam = (await mcp.kairo_team({})).structuredContent.data;
  assert.deepEqual((await mcp.kairo_team({})).structuredContent.data, mcpTeam, "repeated reads are stable");

  const fromTool = deriveWorkspaceStatus({
    team: { state: mcpTeam.state },
    roles: rolesFromPublicTeam(mcpTeam).map((r) => ({ ...r, availability: "available", reason: null })),
    tasks: mcpTeam.tasks
  });
  const snapshot = await s.load();

  const byId = (rows, key) => Object.fromEntries(rows.map((r) => [r[key], r.status]));
  assert.deepEqual(byId(snapshot.tasks, "id"), byId(fromTool.tasks, "taskId"));
  assert.equal(snapshot.status.status, fromTool.team.status);
  assert.deepEqual(byId(snapshot.agents, "role"), byId(fromTool.agents, "role"));
  for (const row of snapshot.tasks) {
    const shared = mcpTeam.tasks.find((t) => t.taskId === row.id);
    assert.deepEqual(
      { state: row.state, role: row.role, runId: row.runId, nextTransition: row.nextTransition },
      { state: shared.state, role: shared.execution?.role ?? null, runId: shared.execution?.runId ?? null, nextTransition: shared.nextTransition }
    );
  }
});

test("execution records the role, and legacy runs without a role are never attributed to one", async () => {
  const s = await setup();
  const taskId = await s.newTask();
  await s.launch(taskId);
  const team = await s.service.readTeam({ cwd: s.root });
  assert.equal(team.tasks.find((t) => t.taskId === taskId).execution.role, "Builder");
  const pure = buildKairoWorkspaceSnapshot({
    projectRoot: s.root, strategy: strategyOf("active"), availabilityIntelligence: AVAILABLE,
    work: { sessions: [], tasks: [{ taskId: "legacy", state: "approved", execution: { runId: "run_x", state: "running", active: true, role: null }, nextTransition: "delegated" }] }
  });
  assert.equal(pure.agents.find((a) => a.role === "Builder").status, "active");
  assert.equal(pure.tasks[0].status, "working");
});
