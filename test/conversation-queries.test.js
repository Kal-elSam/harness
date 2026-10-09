import test from "node:test";
import assert from "node:assert/strict";
import { createConversationService } from "../src/global/conversation/service.js";

const SESSION_A = { schema: "kairo.session/v2", id: "aaaa1111-0000", mode: "ask", updatedAt: "2026-01-02T00:00:00Z" };
const SESSION_B = { schema: "kairo.session/v2", id: "aaaa2222-0000", mode: "plan", updatedAt: "2026-01-01T00:00:00Z" };

function buildService(overrides = {}) {
  const counters = { startRun: 0, createSession: 0, writeProjectStrategy: 0 };
  const sessions = overrides.sessions ?? [SESSION_A, SESSION_B];
  const service = createConversationService({
    resolveRoot: async (cwd) => cwd,
    listSessions: async () => sessions,
    // Mirrors the registry contract: exact id, else unique prefix; null when
    // unknown; throws on an ambiguous prefix.
    resolveSessionRef: async (_home, _root, ref) => {
      const exact = sessions.find((s) => s.id === ref);
      if (exact) return exact;
      const matches = sessions.filter((s) => s.id.startsWith(ref));
      if (matches.length > 1) throw new Error(`"${ref}" matches ${matches.length} real sessions — use a longer prefix.`);
      return matches[0] ?? null;
    },
    createSession: async () => { counters.createSession += 1; return SESSION_A; },
    startRun: async () => { counters.startRun += 1; throw new Error("startRun must never be called by a read-only query"); },
    writeProjectStrategy: async () => { counters.writeProjectStrategy += 1; },
    listPlans: async () => overrides.plans ?? [],
    readExecution: async () => null,
    recoverRuns: async () => {},
    inspectExecutionAdapters: () => overrides.adapters ?? [
      { id: "codex", label: "Codex", available: true, launchable: true, reason: null },
      { id: "claude", label: "Claude Code", available: false, launchable: false, reason: "Claude CLI is not on PATH." }
    ],
    inspectEngramIntegration: () => ({ status: "configured" }),
    readProjectStrategy: async () => overrides.strategy ?? null
  });
  return { service, counters };
}

const STRATEGY = {
  status: "active",
  bootstrapAnalyst: { adapterId: "codex", modelId: "gpt-x", displayName: "GPT X" },
  orchestrator: { adapterId: "codex", modelId: "gpt-x", displayName: "GPT X" },
  projectTeam: [
    { role: "Builder", model: { adapterId: "claude", modelId: "sonnet", displayName: "Sonnet" } },
    { role: "Reviewer", model: { adapterId: "codex", modelId: "gpt-x", displayName: "GPT X" } }
  ]
};

test("listSessions exposes the registry for the resolved project root", async () => {
  const { service } = buildService();
  const sessions = await service.listSessions({ cwd: "/repo" });
  assert.deepEqual(sessions.map((s) => s.id), [SESSION_A.id, SESSION_B.id]);
});

test("resolveSession returns the exact or unique-prefix session", async () => {
  const { service } = buildService();
  assert.equal((await service.resolveSession({ cwd: "/repo", ref: SESSION_A.id })).id, SESSION_A.id);
  assert.equal((await service.resolveSession({ cwd: "/repo", ref: "aaaa2" })).id, SESSION_B.id);
});

test("resolveSession rejects an ambiguous ref with a typed error and never guesses", async () => {
  const { service, counters } = buildService();
  await assert.rejects(
    () => service.resolveSession({ cwd: "/repo", ref: "aaaa" }),
    (error) => error.code === "SESSION_REF_AMBIGUOUS" && /aaaa/.test(error.message)
  );
  assert.equal(counters.createSession, 0);
});

test("resolveSession rejects an empty ref without consulting the registry", async () => {
  const { service } = buildService();
  await assert.rejects(() => service.resolveSession({ cwd: "/repo", ref: "  " }), (error) => error.code === "SESSION_REF_UNKNOWN");
});

test("resolveSession rejects an unknown ref and creates no session", async () => {
  const { service, counters } = buildService();
  await assert.rejects(
    () => service.resolveSession({ cwd: "/repo", ref: "zzzz" }),
    (error) => error.code === "SESSION_REF_UNKNOWN"
  );
  assert.equal(counters.createSession, 0);
});

test("readTeam reports not_analyzed with no roles when no strategy exists", async () => {
  const { service } = buildService();
  const team = await service.readTeam({ cwd: "/repo" });
  assert.equal(team.projectRoot, "/repo");
  assert.equal(team.state, "not_analyzed");
  assert.deepEqual(team.roles, []);
});

test("readTeam shows roles, providers/models and a blocked reason when the provider is unavailable", async () => {
  const { service } = buildService({ strategy: STRATEGY });
  const team = await service.readTeam({ cwd: "/repo" });
  assert.deepEqual(team.roles.map((r) => r.role), ["Project Analyst", "Orchestrator", "Builder", "Reviewer"]);
  const builder = team.roles.find((r) => r.role === "Builder");
  assert.equal(builder.provider, "claude");
  assert.equal(builder.model, "Sonnet");
  assert.equal(builder.eligible, false);
  assert.equal(builder.blockedReason, "Claude CLI is not on PATH.");
  const reviewer = team.roles.find((r) => r.role === "Reviewer");
  assert.equal(reviewer.eligible, true);
  assert.equal(reviewer.blockedReason, null);
  const claude = team.providers.find((p) => p.id === "claude");
  assert.deepEqual({ installed: claude.installed, launchable: claude.launchable }, { installed: false, launchable: false });
});

test("readTeam lists tasks with states and result pointers", async () => {
  const plan = {
    taskId: "t1", state: "approved", provider: "codex", model: null, sessionId: null, baseHead: "a".repeat(40),
    createdAt: "c", updatedAt: "u", artifacts: { plan: ".ai/tasks/t1/plan.md" }
  };
  const { service } = buildService({ strategy: STRATEGY, plans: [plan] });
  const team = await service.readTeam({ cwd: "/repo" });
  assert.equal(team.tasks.length, 1);
  assert.equal(team.tasks[0].taskId, "t1");
  assert.equal(team.tasks[0].state, "approved");
  assert.equal(team.tasks[0].execution.state, "not_started");
  assert.deepEqual(team.tasks[0].artifacts, { plan: ".ai/tasks/t1/plan.md" });
});

test("repeated queries never start a run, write, or create a session, and return identical results", async () => {
  const { service, counters } = buildService({ strategy: STRATEGY });
  const first = { sessions: await service.listSessions({ cwd: "/repo" }), team: await service.readTeam({ cwd: "/repo" }) };
  const second = { sessions: await service.listSessions({ cwd: "/repo" }), team: await service.readTeam({ cwd: "/repo" }) };
  assert.deepEqual(second, first);
  assert.deepEqual(counters, { startRun: 0, createSession: 0, writeProjectStrategy: 0 });
});
