import test from "node:test";
import assert from "node:assert/strict";
import { createConversationService } from "../src/global/conversation/service.js";

test("conversation service projects a provider-neutral durable timeline", async () => {
  const calls = [];
  const status = {
    taskId: "task-id", state: "awaiting_approval", provider: "codex", model: null,
    baseHead: "a".repeat(40), createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:01Z",
    artifacts: { task: ".ai/tasks/task-id/task.md", plan: ".ai/tasks/task-id/plan.md" }
  };
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    listPlans: async () => [status],
    createPlan: async (input) => { calls.push(input); return { status, reused: false }; },
    readPlan: async () => ({ status, taskMarkdown: "# Task", planMarkdown: "# Plan" }),
    transition: async (_root, _id, decision) => ({ status: { ...status, state: decision } }),
    recoverRuns: async () => {}, readExecution: async () => null,
    inspectExecutionAdapters: () => [],
    inspectEngramIntegration: () => ({ status: "unconfigured" })
  });
  const snapshot = await service.snapshot({ cwd: "/repo/subdir" });
  assert.equal(snapshot.schema, "kairo.conversation/v1");
  assert.equal(snapshot.governance.methodologyOwner, "gentle-ai");
  assert.equal(snapshot.governance.approvalIsExecutionConsent, false);
  assert.equal(snapshot.timeline[0].execution.state, "not_started");
  assert.equal(snapshot.timeline[0].planReady, true);

  await service.submitArchitecture({ cwd: "/repo", task: "Plan auth" });
  assert.equal(calls[0].cwd, "/repo");
  const shown = await service.showPlan({ cwd: "/repo", taskId: "task-id" });
  assert.equal(shown.planMarkdown, "# Plan");
  const approved = await service.decidePlan({ cwd: "/repo", taskId: "task-id", decision: "approved" });
  assert.equal(approved.approval, "approved");
  assert.equal(approved.execution.state, "not_started");
});

test("snapshot populates real provider and integration status instead of leaving them empty", async () => {
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    listPlans: async () => [],
    recoverRuns: async () => {},
    inspectExecutionAdapters: ({ cwd }) => {
      assert.equal(cwd, "/repo");
      return [
        { id: "codex", label: "Codex", available: true, launchable: true, reason: null },
        { id: "opencode", label: "OpenCode", available: true, launchable: false, reason: "billing unverified" },
        { id: "cursor", label: "Cursor", available: false, launchable: false, reason: "Cursor CLI is not on PATH." }
      ];
    },
    inspectEngramIntegration: () => ({ status: "configured" })
  });

  const snapshot = await service.snapshot({ cwd: "/repo" });
  assert.equal(snapshot.providers.Codex.status, "ENABLED");
  assert.equal(snapshot.providers.OpenCode.status, "LIMITED · billing unverified");
  assert.equal(snapshot.providers.Cursor.status, "MISSING · Cursor CLI is not on PATH.");
  assert.equal(snapshot.integrations.engram.status, "configured");
});

test("snapshot aggregates real per-run token usage into the matching provider line", async () => {
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    listPlans: async () => [],
    recoverRuns: async () => {},
    inspectExecutionAdapters: () => [
      { id: "codex", label: "Codex", available: true, launchable: true, reason: null }
    ],
    inspectEngramIntegration: () => ({ status: "configured" }),
    listRunRecords: async (homeDir, { limit }) => {
      assert.equal(limit, 50);
      return [
        { agentId: "codex", tokenUsage: { input: 100, output: 50, total: 150 } },
        { agentId: "codex", tokenUsage: { input: 20, output: 10, total: 30 } },
        { agentId: "claude", tokenUsage: { input: 5, output: 5, total: 10 } },
        { agentId: "codex", tokenUsage: null }
      ];
    }
  });

  const snapshot = await service.snapshot({ cwd: "/repo" });
  assert.equal(snapshot.providers.Codex.status, "ENABLED · 180 tokens (2 runs via Kairo)");
});

test("snapshot surfaces real Claude session/weekly usage percentages via /usage, at zero cost", async () => {
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    enableProviderProbes: true,
    listPlans: async () => [],
    recoverRuns: async () => {},
    listRunRecords: async () => [],
    inspectExecutionAdapters: () => [],
    inspectEngramIntegration: () => ({ status: "available" }),
    readCodexUsage: async () => ({ status: "unknown" }),
    readClaudeUsage: async () => ({
      status: "measured",
      primary: { label: "Current session", usedPercent: 34, remainingPercent: 66, resetsAt: "Sep 11 at 8pm" },
      secondary: { label: "Current week (all models)", usedPercent: 61, remainingPercent: 39, resetsAt: "Sep 14 at 9am" }
    })
  });

  const snapshot = await service.snapshot({ cwd: "/repo" });
  assert.equal(snapshot.providers.Claude.status, "Current session 66% left · Current week (all models) 39% left · measured");
  assert.equal(snapshot.usage.claude.primary.remainingPercent, 66);
});

test("approved plan execution reserves one detached Claude run and reuses it", async () => {
  const status = {
    taskId: "task-id", state: "approved", provider: "codex", model: null,
    baseHead: "a".repeat(40), artifacts: { task: ".ai/tasks/task-id/task.md", plan: ".ai/tasks/task-id/plan.md" }
  };
  const record = { status, planMarkdown: "# Approved plan" };
  let link = null;
  let launches = 0;
  const service = createConversationService({
    resolveRoot: async () => "/repo", homeDir: "/home/test",
    verifyExecution: async () => record,
    createRunId: () => "run_fixed",
    readExecution: async () => link,
    readRun: async () => link ? { state: "starting", startedAt: "now", updatedAt: "now" } : null,
    writeExecution: async (_root, _id, value) => { link = value; },
    updateExecution: async (_root, _id, value) => { link = value; },
    startRun: async (input) => {
      launches += 1;
      assert.equal(input.agentId, "claude");
      assert.deepEqual(input.permissions, []);
      assert.equal(input.allowUnsafePermissions, false);
      assert.equal(input.permissionSource, "cockpit");
      assert.equal(input.wait, false);
      assert.match(input.task, /# Approved plan/);
      return { metadata: { state: "starting", startedAt: "now", updatedAt: "now" } };
    }
  });
  const first = await service.executePlan({ cwd: "/repo", taskId: "task-id", agentId: "claude" });
  const retry = await service.executePlan({ cwd: "/repo", taskId: "task-id", agentId: "claude" });
  assert.equal(first.execution.state, "starting");
  assert.equal(retry.reused, true);
  assert.equal(launches, 1);
});

test("submitTask answers a real question directly — no plan, no task, no approval gate", async () => {
  const askCalls = [];
  const planCalls = [];
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    inspectExecutionAdapters: () => [{ id: "claude", available: true, launchable: true, reason: null }],
    selectAskProvider: () => ({ decision: "ROUTED", provider: "claude", model: null }),
    askProvider: async (args) => { askCalls.push(args); return { status: "answered", answer: "This project orchestrates Codex/Claude/OpenCode.", error: null }; },
    createPlan: async (args) => { planCalls.push(args); return { status: {}, reused: false }; }
  });

  const result = await service.submitTask({ cwd: "/repo", task: "What is this project about?" });
  assert.equal(result.kind, "answer");
  assert.equal(result.answer, "This project orchestrates Codex/Claude/OpenCode.");
  assert.equal(result.provider, "claude");
  assert.deepEqual(askCalls, [{ provider: "claude", question: "What is this project about?", model: null, cwd: "/repo" }]);
  assert.equal(planCalls.length, 0);
});

test("submitTask still creates a plan for an actual change request", async () => {
  const status = { taskId: "task-id", state: "awaiting_approval", provider: "codex", model: null, baseHead: "a".repeat(40), artifacts: {} };
  const planCalls = [];
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    createPlan: async (args) => { planCalls.push(args); return { status, reused: false }; }
  });

  const result = await service.submitTask({ cwd: "/repo", task: "Implement pagination on the users table" });
  assert.equal(result.kind, "plan");
  assert.equal(result.taskId, "task-id");
  assert.deepEqual(planCalls, [{ cwd: "/repo", task: "Implement pagination on the users table", model: null }]);
});

test("snapshot cross-references real model catalogs with real Artificial Analysis scores when probes are enabled", async () => {
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/kal-el",
    enableProviderProbes: true,
    listPlans: async () => [],
    recoverRuns: async () => {},
    inspectExecutionAdapters: () => [],
    inspectEngramIntegration: () => ({ status: "configured" }),
    readCodexUsage: async () => null,
    readClaudeUsage: async () => null,
    readCodexModels: async () => ({ status: "measured", models: [{ id: "gpt-6-astra", displayName: "GPT-6 Astra" }] }),
    readClaudeModels: () => ({ status: "documented", models: [{ id: "claude-opus-5" }] }),
    readArtificialAnalysisModels: async () => ({
      status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h",
      models: [
        { slug: "gpt-6-astra", name: "GPT-6 Astra", intelligenceIndex: 52.8, codingIndex: 76.9, mathIndex: null },
        { slug: "claude-opus-5", name: "Claude Opus 5", intelligenceIndex: 50.7, codingIndex: 78, mathIndex: null }
      ]
    })
  });

  const snapshot = await service.snapshot({ cwd: "/repo" });
  assert.equal(snapshot.modelIntelligence.status, "live");
  assert.equal(snapshot.modelIntelligence.models.length, 2);
  assert.deepEqual(snapshot.modelIntelligence.models.map((m) => m.modelId), ["gpt-6-astra", "claude-opus-5"]);
});

test("snapshot leaves modelIntelligence at its honest unknown default when probes are disabled", async () => {
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    listPlans: async () => [],
    recoverRuns: async () => {},
    inspectExecutionAdapters: () => [],
    inspectEngramIntegration: () => ({ status: "configured" })
  });
  const snapshot = await service.snapshot({ cwd: "/repo" });
  assert.equal(snapshot.modelIntelligence.status, "unknown");
  assert.deepEqual(snapshot.modelIntelligence.models, []);
});

test("loadTranscript resolves the project root and reads real persisted history from the global harness home", async () => {
  const reads = [];
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/kal-el",
    readTranscript: async (homeDir, projectRoot) => { reads.push({ homeDir, projectRoot }); return [{ role: "user", text: "hi", at: "2026-01-01T00:00:00Z" }]; }
  });
  const entries = await service.loadTranscript({ cwd: "/repo" });
  assert.deepEqual(reads, [{ homeDir: "/home/kal-el", projectRoot: "/repo" }]);
  assert.deepEqual(entries, [{ role: "user", text: "hi", at: "2026-01-01T00:00:00Z" }]);
});

test("appendTranscript persists one real entry and propagates a write failure", async () => {
  const appends = [];
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/kal-el",
    appendTranscriptEntry: async (homeDir, projectRoot, entry) => { appends.push({ homeDir, projectRoot, entry }); }
  });
  await service.appendTranscript({ cwd: "/repo", role: "kairo", text: "claude: it orchestrates." });
  assert.deepEqual(appends, [{ homeDir: "/home/kal-el", projectRoot: "/repo", entry: { role: "kairo", text: "claude: it orchestrates." } }]);

  const failing = createConversationService({
    resolveRoot: async () => "/repo",
    appendTranscriptEntry: async () => { throw new Error("disk full"); }
  });
  await assert.rejects(() => failing.appendTranscript({ cwd: "/repo", role: "user", text: "hi" }), /disk full/);
});

test("clearTranscript persists an empty transcript for the real project root", async () => {
  const calls = [];
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/kal-el",
    clearTranscript: async (homeDir, projectRoot) => { calls.push({ homeDir, projectRoot }); }
  });
  await service.clearTranscript({ cwd: "/repo" });
  assert.deepEqual(calls, [{ homeDir: "/home/kal-el", projectRoot: "/repo" }]);
});

test("askQuestion refuses to fabricate an answer when no ask-capable provider is available", async () => {
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    inspectExecutionAdapters: () => [],
    selectAskProvider: () => ({ decision: "NO_PROVIDER_AVAILABLE", provider: null, model: null, why: "no ask-capable provider available" })
  });
  await assert.rejects(() => service.askQuestion({ cwd: "/repo", task: "What is this?" }), /no ask-capable provider/);
});

test("askQuestion threads the real question text through to the router, so effort-tier model selection sees the actual complexity", async () => {
  const routeCalls = [];
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    inspectExecutionAdapters: () => [{ id: "claude", available: true, launchable: true, reason: null }],
    selectAskProvider: (args) => {
      routeCalls.push(args.taskText);
      return { decision: "ROUTED", provider: "claude", model: "claude-haiku-4-5", why: "read-only question (light effort)" };
    },
    askProvider: async () => ({ status: "answered", answer: "It's an orchestrator." })
  });
  await service.askQuestion({ cwd: "/repo", task: "what is this project about?" });
  assert.deepEqual(routeCalls, ["what is this project about?"]);
});

test("planExecution previews the real router's decision without reserving or launching anything", async () => {
  const status = {
    taskId: "task-id", state: "approved", provider: "codex", model: null,
    baseHead: "a".repeat(40), artifacts: { task: ".ai/tasks/task-id/task.md", plan: ".ai/tasks/task-id/plan.md" }
  };
  const record = { status, taskMarkdown: "Investigate the root cause of this race condition", planMarkdown: "# Plan" };
  let reserved = false;
  let launched = false;
  const service = createConversationService({
    resolveRoot: async () => "/repo", homeDir: "/home/test",
    readPlan: async () => record,
    inspectExecutionAdapters: () => [{ id: "codex", available: true, launchable: true, reason: null }],
    writeExecution: async () => { reserved = true; },
    startRun: async () => { launched = true; return { metadata: {} }; }
  });
  const preview = await service.planExecution({ cwd: "/repo", taskId: "task-id" });
  assert.equal(preview.decision, "ROUTED");
  assert.equal(preview.provider, "codex");
  assert.match(preview.why, /root cause/);
  assert.equal(reserved, false);
  assert.equal(launched, false);
});

test("executePlan auto-routes to the real decision's provider when no agentId is given, and threads its model through the launch", async () => {
  const status = {
    taskId: "task-id", state: "approved", provider: "codex", model: null,
    baseHead: "a".repeat(40), artifacts: { task: ".ai/tasks/task-id/task.md", plan: ".ai/tasks/task-id/plan.md" }
  };
  const record = { status, taskMarkdown: "Investigate the root cause of this bug", planMarkdown: "# Approved plan" };
  let link = null;
  const service = createConversationService({
    resolveRoot: async () => "/repo", homeDir: "/home/test",
    verifyExecution: async () => record,
    createRunId: () => "run_fixed",
    readExecution: async () => link,
    readRun: async () => (link ? { state: "starting", startedAt: "now", updatedAt: "now", agentId: link.agentId } : null),
    writeExecution: async (_root, _id, value) => { link = value; },
    updateExecution: async (_root, _id, value) => { link = value; },
    inspectExecutionAdapters: () => [{ id: "codex", available: true, launchable: true, reason: null }],
    selectExecutionProvider: () => ({ decision: "ROUTED", provider: "codex", model: "gpt-6-astra", why: "reasoning task" }),
    startRun: async (input) => {
      assert.equal(input.agentId, "codex");
      assert.equal(input.model, "gpt-6-astra");
      return { metadata: { state: "starting", startedAt: "now", updatedAt: "now" } };
    }
  });
  const result = await service.executePlan({ cwd: "/repo", taskId: "task-id" });
  assert.equal(result.execution.provider, "codex");
  assert.match(result.execution.message, /codex run is starting/);
});

test("executePlan refuses to auto-launch and reports why when the router says the task needs human approval", async () => {
  const status = {
    taskId: "task-id", state: "approved", provider: "codex", model: null,
    baseHead: "a".repeat(40), artifacts: { task: ".ai/tasks/task-id/task.md", plan: ".ai/tasks/task-id/plan.md" }
  };
  const record = { status, taskMarkdown: "Migrate the production auth database", planMarkdown: "# Plan" };
  let launched = false;
  const service = createConversationService({
    resolveRoot: async () => "/repo", homeDir: "/home/test",
    verifyExecution: async () => record,
    inspectExecutionAdapters: () => [{ id: "claude", available: true, launchable: true, reason: null }],
    selectExecutionProvider: () => ({ decision: "WAIT_FOR_APPROVAL", provider: null, model: null, why: "high risk auth task" }),
    startRun: async () => { launched = true; return { metadata: {} }; }
  });
  await assert.rejects(
    () => service.executePlan({ cwd: "/repo", taskId: "task-id" }),
    /high risk auth task/
  );
  assert.equal(launched, false);
});

test("an explicit agentId override skips the router entirely (manual confirm-execute choice)", async () => {
  const status = {
    taskId: "task-id", state: "approved", provider: "codex", model: null,
    baseHead: "a".repeat(40), artifacts: { task: ".ai/tasks/task-id/task.md", plan: ".ai/tasks/task-id/plan.md" }
  };
  const record = { status, taskMarkdown: "Anything", planMarkdown: "# Plan" };
  let routerCalled = false;
  const service = createConversationService({
    resolveRoot: async () => "/repo", homeDir: "/home/test",
    verifyExecution: async () => record,
    createRunId: () => "run_fixed",
    readExecution: async () => null,
    writeExecution: async () => {},
    updateExecution: async () => {},
    selectExecutionProvider: () => { routerCalled = true; return { decision: "WAIT_FOR_APPROVAL" }; },
    startRun: async (input) => {
      assert.equal(input.agentId, "claude");
      return { metadata: { state: "starting", startedAt: "now", updatedAt: "now" } };
    }
  });
  await service.executePlan({ cwd: "/repo", taskId: "task-id", agentId: "claude" });
  assert.equal(routerCalled, false);
});

test("snapshot deduplicates in-flight Codex usage probes and honors its TTL", async () => {
  let calls = 0;
  let now = 1_000;
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    enableProviderProbes: true,
    codexUsageTtlMs: 60_000,
    now: () => now,
    readCodexUsage: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 1));
      return { status: "measured", windows: [], primary: null, secondary: null };
    },
    readClaudeUsage: async () => ({ status: "unknown" }),
    listPlans: async () => [],
    recoverRuns: async () => {},
    listRunRecords: async () => [],
    inspectExecutionAdapters: () => [],
    inspectEngramIntegration: () => ({ status: "available" })
  });
  await Promise.all([service.snapshot({ cwd: "/repo" }), service.snapshot({ cwd: "/repo" })]);
  assert.equal(calls, 1);
  now += 60_001;
  await service.snapshot({ cwd: "/repo" });
  assert.equal(calls, 2);
});
