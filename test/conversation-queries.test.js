import test from "node:test";
import assert from "node:assert/strict";
import { createConversationService } from "../src/global/team/service.js";

function buildService(overrides = {}) {
  const counters = { startRun: 0, writeProjectStrategy: 0 };
  const service = createConversationService({
    resolveRoot: async (cwd) => cwd,
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

test("repeated queries never start a run or write, and return identical results", async () => {
  const { service, counters } = buildService({ strategy: STRATEGY });
  const first = { team: await service.readTeam({ cwd: "/repo" }) };
  const second = { team: await service.readTeam({ cwd: "/repo" }) };
  assert.deepEqual(second, first);
  assert.deepEqual(counters, { startRun: 0, writeProjectStrategy: 0 });
});
