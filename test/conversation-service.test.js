import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildClaudeEntitlementVerifyCostStatement,
  buildUnverifiedClaudePreflightNotice,
  createConversationService
} from "../src/global/conversation/service.js";
import { ENTITLEMENT } from "../src/global/observability/claude-model-entitlement.js";
import { DEFAULT_ENTITLEMENT_TTL_MS } from "../src/global/observability/claude-entitlement-store.js";


// runBootstrapAnalysis now takes the per-project analysis lock; these tests
// use a fake homeDir, so they grant it in memory.
const grantedLock = async () => ({ acquired: true, release: async () => {} });
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
    }),
    readCodexModels: async () => ({ status: "unknown", models: [] }),
    readOpenCodeModels: async () => ({ status: "unknown", models: [] }),
    readCursorModels: async () => ({ status: "unknown", models: [] }),
    readArtificialAnalysisModels: async () => ({ status: "unknown", source: null, age: null, models: [] }),
    readHuggingFaceLeaderboard: async () => ({ status: "unknown", source: null, fetchedAt: null, age: null, entries: [], error: "not mocked" })
  });

  const snapshot = await service.snapshot({ cwd: "/repo" });
  assert.equal(snapshot.providers.Claude.status, "Current session 66% left · Current week (all models) 39% left · measured");
  assert.equal(snapshot.usage.claude.primary.remainingPercent, 66);
});

test("approved plan execution reserves one detached run for the PROJECT TEAM-confirmed candidate and reuses it", async () => {
  const status = {
    taskId: "task-id", state: "approved", provider: "codex", model: null,
    baseHead: "a".repeat(40), artifacts: { task: ".ai/tasks/task-id/task.md", plan: ".ai/tasks/task-id/plan.md" }
  };
  const record = { status, planMarkdown: "# Approved plan" };
  const claudeModel = { candidateKey: "claude::claude-opus-5", adapterId: "claude", modelId: "claude-opus-5", displayName: "Claude Opus 5", accessMode: "automatic" };
  const strategy = activeStrategyWithBuilder({ model: claudeModel });
  let link = null;
  let launches = 0;
  const service = serviceWithEligibility({
    verifyExecution: async () => record,
    createRunId: () => "run_fixed",
    readExecution: async () => link,
    readRun: async () => link ? { state: "starting", startedAt: "now", updatedAt: "now" } : null,
    writeExecution: async (_root, _id, value) => { link = value; },
    updateExecution: async (_root, _id, value) => { link = value; },
    readProjectStrategy: async () => strategy,
    startRun: async (input) => {
      launches += 1;
      assert.equal(input.agentId, "claude");
      assert.deepEqual(input.permissions, []);
      assert.equal(input.allowUnsafePermissions, false);
      assert.equal(input.permissionSource, "cockpit");
      assert.equal(input.wait, false);
      assert.equal(input.captureTranscript, true, "real assistant/result content must flow into the run's own event log, since the cockpit tails it live via readRunTranscript");
      assert.match(input.task, /# Approved plan/);
      return { metadata: { state: "starting", startedAt: "now", updatedAt: "now" } };
    }
  }, { claude: { ok: true } });
  const confirmationTarget = { role: "Builder", selection: "assigned", strategyFingerprint: "fp-1", candidateKey: "claude::claude-opus-5" };
  const first = await service.executePlan({ cwd: "/repo", taskId: "task-id", confirmationTarget });
  const retry = await service.executePlan({ cwd: "/repo", taskId: "task-id", confirmationTarget });
  assert.equal(first.execution.state, "starting");
  assert.equal(retry.reused, true);
  assert.equal(launches, 1);
});

test("planExecution rejects a missing role outright — PROJECT TEAM is the sole authority, role is never optional or inferred", async () => {
  const service = createConversationService({ resolveRoot: async () => "/repo", homeDir: "/home/test" });
  await assert.rejects(() => service.planExecution({ cwd: "/repo", taskId: "task-id" }), /requires an explicit role/);
  await assert.rejects(() => service.planExecution({ cwd: "/repo", taskId: "task-id", role: null }), /requires an explicit role/);
});

test("executePlan rejects a missing confirmationTarget outright — no free-form agentId/model bypass exists anymore", async () => {
  const record = { status: {}, planMarkdown: "# Plan" };
  const service = createConversationService({ resolveRoot: async () => "/repo", homeDir: "/home/test", verifyExecution: async () => record, readExecution: async () => null });
  await assert.rejects(
    () => service.executePlan({ cwd: "/repo", taskId: "task-id" }),
    /confirmationTarget from a fresh planExecution/
  );
  // Legacy free-form fields — intentionally ignored now, not honored as an override.
  await assert.rejects(
    () => service.executePlan({ cwd: "/repo", taskId: "task-id", agentId: "claude", model: "claude-opus-5" }),
    /confirmationTarget from a fresh planExecution/
  );
});

test("submitTask answers a real question directly — no plan, no task, no approval gate", async () => {
  const askCalls = [];
  const planCalls = [];
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    inspectExecutionAdapters: () => [{ id: "claude", available: true, launchable: true, reason: null }],
    selectAskProvider: () => ({ decision: "ROUTED", provider: "claude", model: null }),
    askProvider: async (args) => { askCalls.push(args); return { status: "answered", answer: "This project orchestrates Codex/Claude/OpenCode.", error: null }; },
    createPlan: async (args) => { planCalls.push(args); return { status: {}, reused: false }; },
    readAskHistory: async () => [], appendAskHistoryEntry: async () => {}
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
  assert.deepEqual(planCalls, [{ cwd: "/repo", task: "Implement pagination on the users table", model: null, sessionId: null }]);
});

test("submitTask's explicit WorkMode overrides the isLikelyQuestion guess — ASK never creates a plan, even for a clear change request", async () => {
  const askCalls = [];
  const planCalls = [];
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    inspectExecutionAdapters: () => [{ id: "claude", available: true, launchable: true, reason: null }],
    selectAskProvider: () => ({ decision: "ROUTED", provider: "claude", model: null }),
    askProvider: async (args) => { askCalls.push(args); return { status: "answered", answer: "Real answer.", error: null }; },
    createPlan: async (args) => { planCalls.push(args); return { status: {}, reused: false }; },
    readAskHistory: async () => [], appendAskHistoryEntry: async () => {}
  });
  const result = await service.submitTask({ cwd: "/repo", task: "Implement pagination on the users table", mode: "ask" });
  assert.equal(result.kind, "answer");
  assert.equal(planCalls.length, 0);
  assert.equal(askCalls.length, 1);
});

test("submitTask's explicit WorkMode overrides the isLikelyQuestion guess — PLAN and AGENT always create a plan, even for a plain question", async () => {
  const status = { taskId: "task-id", state: "awaiting_approval", provider: "codex", model: null, baseHead: "a".repeat(40), artifacts: {} };
  const planCalls = [];
  const askCalls = [];
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    createPlan: async (args) => { planCalls.push(args); return { status, reused: false }; },
    askProvider: async (args) => { askCalls.push(args); return { status: "answered", answer: "should never be called", error: null }; }
  });
  const planResult = await service.submitTask({ cwd: "/repo", task: "What is this project about?", mode: "plan" });
  const agentResult = await service.submitTask({ cwd: "/repo", task: "What is this project about?", mode: "agent" });
  assert.equal(planResult.kind, "plan");
  assert.equal(agentResult.kind, "plan");
  assert.equal(planCalls.length, 2);
  assert.equal(askCalls.length, 0);
});

test("getSession/setMode persist and round-trip the real WorkMode for a project", async () => {
  let stored = null;
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/test",
    readSession: async (homeDir, projectRoot) => {
      assert.equal(homeDir, "/home/test");
      assert.equal(projectRoot, "/repo");
      return stored ?? { schema: "kairo.session/v1", id: "repo", mode: "ask", createdAt: "t0", updatedAt: "t0" };
    },
    writeSessionMode: async (homeDir, projectRoot, mode) => {
      stored = { schema: "kairo.session/v1", id: "repo", mode, createdAt: "t0", updatedAt: "t1" };
      return stored;
    }
  });
  const initial = await service.getSession({ cwd: "/repo" });
  assert.equal(initial.mode, "ask");
  const updated = await service.setMode({ cwd: "/repo", mode: "agent" });
  assert.equal(updated.mode, "agent");
  const reread = await service.getSession({ cwd: "/repo" });
  assert.equal(reread.mode, "agent");
});

test("REGRESSION: snapshot with a real sessionId shows only that session's own tasks plus any task that predates sessions (no recorded sessionId)", async () => {
  const own = { taskId: "own", state: "awaiting_approval", sessionId: "s1", provider: "codex", model: null, baseHead: "a".repeat(40), artifacts: {} };
  const other = { taskId: "other", state: "awaiting_approval", sessionId: "s2", provider: "codex", model: null, baseHead: "a".repeat(40), artifacts: {} };
  const legacy = { taskId: "legacy", state: "awaiting_approval", sessionId: null, provider: "codex", model: null, baseHead: "a".repeat(40), artifacts: {} };
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    listPlans: async () => [own, other, legacy],
    readExecution: async () => null, recoverRuns: async () => {},
    inspectExecutionAdapters: () => [], inspectEngramIntegration: () => ({ status: "unconfigured" })
  });
  const scoped = await service.snapshot({ cwd: "/repo", sessionId: "s1" });
  assert.deepEqual(scoped.timeline.map((t) => t.taskId).sort(), ["legacy", "own"]);

  const unscoped = await service.snapshot({ cwd: "/repo" });
  assert.deepEqual(unscoped.timeline.map((t) => t.taskId).sort(), ["legacy", "other", "own"]);
});

test("REGRESSION: decidePlan/planExecution/executePlan/showPlan throw when a real sessionId doesn't own the task, but never block a caller or task with no sessionId", async () => {
  const owned = { taskId: "task-1", sessionId: "s1", state: "awaiting_approval", provider: "codex", model: null, baseHead: "a".repeat(40), artifacts: {} };
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    readPlan: async () => ({ status: owned, taskMarkdown: "# Task", planMarkdown: "# Plan" }),
    transition: async () => ({ status: { ...owned, state: "approved" } }),
    verifyExecution: async () => ({ status: owned }),
    readExecution: async () => null,
    routeProjectExecution: async () => ({ decision: "WAIT_FOR_PROJECT_TEAM", role: "Builder" })
  });

  await assert.rejects(() => service.showPlan({ cwd: "/repo", taskId: "task-1", sessionId: "s2" }), /different session/);
  await assert.rejects(() => service.decidePlan({ cwd: "/repo", taskId: "task-1", decision: "approved", sessionId: "s2" }), /different session/);
  await assert.rejects(() => service.planExecution({ cwd: "/repo", taskId: "task-1", role: "Builder", sessionId: "s2" }), /different session/);
  await assert.rejects(
    () => service.executePlan({ cwd: "/repo", taskId: "task-1", confirmationTarget: { role: "Builder" }, sessionId: "s2" }),
    /different session/
  );

  // The owning session, or no sessionId at all, is never blocked.
  const owner = await service.showPlan({ cwd: "/repo", taskId: "task-1", sessionId: "s1" });
  assert.equal(owner.taskId, "task-1");
  const noSession = await service.showPlan({ cwd: "/repo", taskId: "task-1" });
  assert.equal(noSession.taskId, "task-1");
});

test("REGRESSION: getSession/setMode with a real sessionId route to the session's own v2 document, never the legacy project-wide session.json", async () => {
  let legacyTouched = false;
  let v2Session = { schema: "kairo.session/v2", id: "s1", projectKey: "pk", title: null, mode: "ask", createdAt: "t0", updatedAt: "t0" };
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/test",
    readSession: async () => { legacyTouched = true; return { schema: "kairo.session/v1", id: "repo", mode: "ask", createdAt: "t0", updatedAt: "t0" }; },
    writeSessionMode: async () => { legacyTouched = true; },
    getSession: async (homeDir, projectRoot, sessionId) => {
      assert.equal(sessionId, "s1");
      return v2Session;
    },
    updateSessionMode: async (homeDir, projectRoot, sessionId, mode) => {
      assert.equal(sessionId, "s1");
      v2Session = { ...v2Session, mode, updatedAt: "t1" };
      return v2Session;
    }
  });
  const initial = await service.getSession({ cwd: "/repo", sessionId: "s1" });
  assert.equal(initial.mode, "ask");
  const updated = await service.setMode({ cwd: "/repo", mode: "agent", sessionId: "s1" });
  assert.equal(updated.mode, "agent");
  const reread = await service.getSession({ cwd: "/repo", sessionId: "s1" });
  assert.equal(reread.mode, "agent");
  assert.equal(legacyTouched, false, "the legacy project-wide session.json must never be touched once a real sessionId is given");
});

test("REGRESSION: loadTranscript/appendTranscript/clearTranscript forward sessionId to the underlying stores", async () => {
  const transcriptCalls = [];
  const askHistoryClearCalls = [];
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/test",
    readTranscript: async (homeDir, projectRoot, sessionId) => { transcriptCalls.push(["read", sessionId]); return []; },
    appendTranscriptEntry: async (homeDir, projectRoot, entry, sessionId) => { transcriptCalls.push(["append", sessionId]); },
    clearTranscript: async (homeDir, projectRoot, sessionId) => { transcriptCalls.push(["clear", sessionId]); },
    clearAskHistory: async (homeDir, projectRoot, sessionId) => { askHistoryClearCalls.push(sessionId); }
  });
  await service.loadTranscript({ cwd: "/repo", sessionId: "s1" });
  await service.appendTranscript({ cwd: "/repo", role: "user", text: "hi", sessionId: "s1" });
  await service.clearTranscript({ cwd: "/repo", sessionId: "s1" });
  assert.deepEqual(transcriptCalls, [["read", "s1"], ["append", "s1"], ["clear", "s1"]]);
  assert.deepEqual(askHistoryClearCalls, ["s1"]);
});

test("REGRESSION: resolveActiveSession returns the most recently updated real session, or creates one when none exists yet", async () => {
  let created = null;
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/test",
    listSessions: async () => [{ id: "most-recent" }, { id: "older" }],
    createSession: async () => { created = true; return { id: "brand-new" }; }
  });
  const active = await service.resolveActiveSession({ cwd: "/repo" });
  assert.equal(active.id, "most-recent");
  assert.equal(created, null);

  const emptyService = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/test",
    listSessions: async () => [],
    createSession: async () => { created = true; return { id: "brand-new" }; }
  });
  const fresh = await emptyService.resolveActiveSession({ cwd: "/repo" });
  assert.equal(fresh.id, "brand-new");
  assert.equal(created, true);
});

test("REGRESSION: acquireSessionLock against real storage refuses a second real process opening the same session, but releases cleanly so a later real attempt succeeds", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-service-lock-home-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "kairo-service-lock-project-"));
  const service = createConversationService({ resolveRoot: async () => projectRoot, homeDir });

  const session = await service.resolveActiveSession({ cwd: projectRoot });
  const first = await service.acquireSessionLock({ cwd: projectRoot, sessionId: session.id });

  await assert.rejects(
    () => service.acquireSessionLock({ cwd: projectRoot, sessionId: session.id }),
    /already open in another process/,
    "a second real process must get a real, clear error — never silently open the same session"
  );

  await first.release();
  const second = await service.acquireSessionLock({ cwd: projectRoot, sessionId: session.id });
  await second.release();
});

function fakeCandidates() {
  const aa = [
    { slug: "codex-model", name: "Codex Model", intelligenceIndex: 90, codingIndex: 40, mathIndex: null },
    { slug: "claude-model", name: "Claude Model", intelligenceIndex: 40, codingIndex: 90, mathIndex: null }
  ];
  return { aa };
}

async function realScoredCandidates() {
  const { scoreAvailableModels } = await import("../src/global/intelligence/model-intelligence.js");
  const { createCapabilityRegistry } = await import("../src/global/intelligence/model-capability-registry.js");
  const { aa } = fakeCandidates();
  const scoredAll = scoreAvailableModels([
    { adapterId: "codex", models: [{ id: "codex-model" }] },
    { adapterId: "claude", models: [{ id: "claude-model" }] }
  ], aa);
  return { scoredAll, eligibility: { codex: { ok: true }, claude: { ok: true } }, registry: createCapabilityRegistry(), providerCapacity: null };
}

test("preflightProject computes a real read-only ProjectProfile and full analyst catalog, never touching persistence", async () => {
  let wrote = false;
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/test",
    computeProjectProfile: async ({ cwd }) => { assert.equal(cwd, "/repo"); return { fingerprint: "fp-1", roleRequirements: [] }; },
    writeProjectStrategy: async () => { wrote = true; }
  });
  service.snapshot = async () => ({ modelIntelligence: await realScoredCandidates() });
  const result = await service.preflightProject({ cwd: "/repo" });
  assert.equal(result.profile.fingerprint, "fp-1");
  assert.equal(wrote, false, "preflight must never persist a ProjectStrategy");
  assert.ok(result.analystCatalog, "preflight must expose the full real analyst catalog");
  assert.ok(result.analystCatalog.recommendedModel);
  assert.equal(result.analystCatalog.models.length, 2, "both real ask-supported candidates from realScoredCandidates() must appear");
});

test("REGRESSION: preflightProject recommends only entitlement-safe models and excludes unverified Claude entirely — 'unavailable' means absent, never visible with a warning", async () => {
  const candidates = await realScoredCandidates();
  const codex = candidates.scoredAll.find((model) => model.adapterId === "codex");
  const claude = {
    ...candidates.scoredAll.find((model) => model.adapterId === "claude"),
    candidateKey: "claude::claude-model", entitlement: ENTITLEMENT.UNVERIFIED,
    entitlementReason: "Access has not been verified"
  };
  const service = createConversationService({
    resolveRoot: async () => "/repo", homeDir: "/home/test",
    computeProjectProfile: async () => ({ fingerprint: "fp-1", roleRequirements: [] })
  });
  service.snapshot = async () => ({
    modelIntelligence: {
      ...candidates, scoredAll: [codex], manualSelectionScoredPool: [codex, claude],
      unscoredModels: [], claudeEntitlement: { "claude-model": { status: ENTITLEMENT.UNVERIFIED } }
    }
  });

  const result = await service.preflightProject({ cwd: "/repo" });
  assert.equal(result.analystCatalog.recommendedModel.adapterId, "codex");
  assert.ok(!result.analystCatalog.models.some((model) => model.adapterId === "claude"), "an unverified model must never appear in the analyst catalog at all, not even with a warning");
});

test("runBootstrapAnalysis refuses to start while another analysis holds the project lock, without touching the analyst", async () => {
  let analyzed = false;
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/test",
    acquireProjectAnalysisLock: async (homeDir, projectRoot, { owner }) => {
      assert.equal(projectRoot, "/repo");
      assert.equal(owner, "manual");
      return { acquired: false, holder: { owner: "automatic-recovery", startedAt: "2026-09-23T10:00:00.000Z" } };
    },
    buildSanitizedSnapshot: async () => { analyzed = true; throw new Error("must not snapshot"); },
    createBootstrapAnalyzerAdapter: () => { analyzed = true; throw new Error("must not create an analyst"); }
  });
  await assert.rejects(
    service.runBootstrapAnalysis({ cwd: "/repo", profile: {}, candidates: {}, analyst: { model: { adapterId: "claude", modelId: "claude-sonnet-5" } } }),
    /already running for this project.*2026-09-23T10:00:00\.000Z.*automatic-recovery/
  );
  assert.equal(analyzed, false);
});

test("runBootstrapAnalysis releases the project lock when the analysis fails", async () => {
  const events = [];
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/test",
    acquireProjectAnalysisLock: async () => {
      events.push("acquire");
      return { acquired: true, release: async () => { events.push("release"); } };
    },
    buildSanitizedSnapshot: async () => { events.push("snapshot"); throw new Error("snapshot failed"); }
  });
  await assert.rejects(
    service.runBootstrapAnalysis({ cwd: "/repo", profile: {}, candidates: {}, analyst: { model: { adapterId: "claude", modelId: "claude-sonnet-5" } } }),
    /snapshot failed/
  );
  assert.deepEqual(events, ["acquire", "snapshot", "release"]);
});

test("runBootstrapAnalysis runs the real chosen model read-only against a SANITIZED SNAPSHOT (never the real cwd), validates its response, and only then builds + persists a SUGGESTED ProjectStrategy genuinely re-scored per its real, evidence-backed findings", async () => {
  let written = null;
  const askCalls = [];
  let cleanedUp = false;
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/test",
    // The real OS-level sandbox check (codex-sandbox.js) only reports
    // Codex eligible on real macOS with a real sandbox-exec binary — this
    // test exercises runBootstrapAnalysis's own logic, not platform
    // detection, so it simulates a macOS host with sandbox-exec present
    // rather than depending on whatever OS actually runs this suite (CI
    // runs on Linux).
    codexIsolationDeps: { platform: "darwin", access: async () => {} },
    acquireProjectAnalysisLock: grantedLock,
    buildSanitizedSnapshot: async (projectRoot) => {
      assert.equal(projectRoot, "/repo");
      return {
        snapshotRoot: "/tmp/fake-snapshot", filesCopied: 1, secretsRedacted: 0,
        copiedFiles: ["src/app/api/chat/route.ts"], excludedPrivatePaths: [],
        cleanup: async () => { cleanedUp = true; }
      };
    },
    runCodexSandboxedBootstrap: async (args) => {
      askCalls.push(args);
      return {
        status: "answered", error: null,
        answer: JSON.stringify({
          architectureTraits: [], complexitySignals: [], criticalAreas: [], contextNeeds: [], workflowNeeds: [],
          recommendedRoleNeeds: [{ role: "Architect", capabilities: ["coding"], reason: "coding-heavy area found", evidence: ["src/app/api/chat/route.ts"] }],
          uncertainties: [], evidenceReferences: ["src/app/api/chat/route.ts"]
        })
      };
    },
    writeProjectStrategy: async (homeDir, projectRoot, strategy) => {
      assert.equal(homeDir, "/home/test");
      assert.equal(projectRoot, "/repo");
      written = strategy;
      return strategy;
    }
  });
  const profile = {
    projectName: "repo", stack: ["Node.js"], architecture: { pattern: "x" },
    quality: { buildCommand: null, testCommand: null, lintCommand: null, typeCheckCommand: null },
    hotspots: [], workflowCapabilities: [], risks: [], fingerprint: "fp-1",
    roleRequirements: [{ role: "Explorer", capabilities: ["reasoning"], reason: "" }]
  };
  const candidates = await realScoredCandidates();
  const analyst = { choice: "quality", model: { adapterId: "codex", modelId: "codex-model" } };
  const result = await service.runBootstrapAnalysis({ cwd: "/repo", profile, candidates, analyst });

  assert.equal(askCalls[0].model, "codex-model");
  assert.equal(askCalls[0].snapshotRoot, "/tmp/fake-snapshot", "the analyst must run against the sanitized snapshot, never the real project directory");
  assert.equal(result.status, "suggested");
  assert.equal(result.bootstrapAnalyst.adapterId, "codex");
  assert.equal(result.bootstrapAnalystChoice, "quality");
  // Explorer (mechanical floor) + Architect (the analyst's own real, evidence-backed finding) must both be active.
  assert.ok(result.activeRoles.includes("Explorer") && result.activeRoles.includes("Architect"));
  assert.equal(result.orchestrator.adapterId, "claude", "coding-only Architect (from the analyst's real finding) must pick the real coding leader");
  assert.equal(written.status, "suggested", "the suggestion must actually be persisted, not just returned");
  assert.equal(cleanedUp, true, "the sanitized snapshot must always be cleaned up, never left on disk");
});

test("runBootstrapAnalysis drops the analyst's recommendedRoleNeeds when none of its evidenceReferences verify against a real file, but still cleans up the snapshot and persists the mechanical-floor strategy", async () => {
  let cleanedUp = false;
  const service = createConversationService({
    resolveRoot: async () => "/repo", homeDir: "/home/test",
    codexIsolationDeps: { platform: "darwin", access: async () => {} },
    acquireProjectAnalysisLock: grantedLock,
    buildSanitizedSnapshot: async () => ({
      snapshotRoot: "/tmp/fake-snapshot", filesCopied: 1, secretsRedacted: 0,
      copiedFiles: ["src/real.ts"], excludedPrivatePaths: [], cleanup: async () => { cleanedUp = true; }
    }),
    runCodexSandboxedBootstrap: async () => ({
      status: "answered", error: null,
      answer: JSON.stringify({
        architectureTraits: [], complexitySignals: [], criticalAreas: [], contextNeeds: [], workflowNeeds: [],
        recommendedRoleNeeds: [{ role: "Reviewer", capabilities: ["reasoning"], reason: "fabricated" }],
        uncertainties: [], evidenceReferences: ["src/made/up/path.ts"]
      })
    }),
    writeProjectStrategy: async (homeDir, projectRoot, strategy) => strategy
  });
  const profile = {
    projectName: "repo", stack: [], architecture: {}, quality: {}, hotspots: [], workflowCapabilities: [], risks: [], fingerprint: "fp-1",
    roleRequirements: [{ role: "Explorer", capabilities: ["reasoning"], reason: "baseline" }]
  };
  const candidates = await realScoredCandidates();
  const analyst = { choice: "quality", model: { adapterId: "codex", modelId: "codex-model" } };
  const result = await service.runBootstrapAnalysis({ cwd: "/repo", profile, candidates, analyst });
  assert.ok(!result.activeRoles.includes("Reviewer"), "Reviewer must be dropped — nothing the analyst cited was a real file");
  assert.equal(cleanedUp, true);
});

test("runBootstrapAnalysis never builds or persists a ProjectStrategy when the analyst's response fails validation, but still cleans up the sanitized snapshot", async () => {
  let wrote = false;
  let cleanedUp = false;
  const service = createConversationService({
    resolveRoot: async () => "/repo", homeDir: "/home/test",
    codexIsolationDeps: { platform: "darwin", access: async () => {} },
    acquireProjectAnalysisLock: grantedLock,
    buildSanitizedSnapshot: async () => ({
      snapshotRoot: "/tmp/fake-snapshot", filesCopied: 0, secretsRedacted: 0,
      copiedFiles: [], excludedPrivatePaths: [], cleanup: async () => { cleanedUp = true; }
    }),
    runCodexSandboxedBootstrap: async () => ({ status: "answered", error: null, answer: "not real json at all" }),
    writeProjectStrategy: async () => { wrote = true; }
  });
  const profile = { projectName: "repo", stack: [], architecture: {}, quality: {}, hotspots: [], workflowCapabilities: [], risks: [], fingerprint: "fp-1", roleRequirements: [] };
  const candidates = await realScoredCandidates();
  const analyst = { choice: "quality", model: { adapterId: "codex", modelId: "codex-model" } };
  await assert.rejects(() => service.runBootstrapAnalysis({ cwd: "/repo", profile, candidates, analyst }), /failed validation/);
  assert.equal(wrote, false);
  assert.equal(cleanedUp, true, "a failed analysis must never leave the sanitized snapshot on disk");
});

test("runBootstrapAnalysis never builds or persists a ProjectStrategy when the real provider call itself fails", async () => {
  let wrote = false;
  const service = createConversationService({
    resolveRoot: async () => "/repo", homeDir: "/home/test",
    acquireProjectAnalysisLock: grantedLock,
    codexIsolationDeps: { platform: "darwin", access: async () => {} },
    runCodexSandboxedBootstrap: async () => ({ status: "error", error: "codex -p timed out", answer: null }),
    writeProjectStrategy: async () => { wrote = true; }
  });
  const profile = { projectName: "repo", stack: [], architecture: {}, quality: {}, hotspots: [], workflowCapabilities: [], risks: [], fingerprint: "fp-1", roleRequirements: [] };
  const candidates = await realScoredCandidates();
  const analyst = { choice: "quality", model: { adapterId: "codex", modelId: "codex-model" } };
  await assert.rejects(() => service.runBootstrapAnalysis({ cwd: "/repo", profile, candidates, analyst }), /did not answer/);
  assert.equal(wrote, false);
});

test("runBootstrapAnalysis routes a Codex analyst through the real OS-level sandbox wrapper, never through plain askProvider", async () => {
  let sandboxCalled = false;
  let askProviderCalled = false;
  const service = createConversationService({
    resolveRoot: async () => "/repo", homeDir: "/home/test",
    codexIsolationDeps: { platform: "darwin", access: async () => {} },
    acquireProjectAnalysisLock: grantedLock,
    buildSanitizedSnapshot: async () => ({
      snapshotRoot: "/tmp/fake-snapshot", filesCopied: 0, secretsRedacted: 0,
      copiedFiles: [], excludedPrivatePaths: [], cleanup: async () => {}
    }),
    runCodexSandboxedBootstrap: async () => {
      sandboxCalled = true;
      return { status: "answered", error: null, answer: JSON.stringify({ architectureTraits: [], complexitySignals: [], criticalAreas: [], contextNeeds: [], workflowNeeds: [], recommendedRoleNeeds: [], uncertainties: [], evidenceReferences: [] }) };
    },
    askProvider: async () => { askProviderCalled = true; return { status: "answered", error: null, answer: "should never be called for codex" }; },
    writeProjectStrategy: async (homeDir, projectRoot, strategy) => strategy
  });
  const profile = { projectName: "repo", stack: [], architecture: {}, quality: {}, hotspots: [], workflowCapabilities: [], risks: [], fingerprint: "fp-1", roleRequirements: [] };
  const candidates = await realScoredCandidates();
  const analyst = { choice: "quality", model: { adapterId: "codex", modelId: "codex-model" } };
  await service.runBootstrapAnalysis({ cwd: "/repo", profile, candidates, analyst });
  assert.equal(sandboxCalled, true);
  assert.equal(askProviderCalled, false, "Codex Bootstrap Analysis must never fall back to the non-confining plain askProvider path");
});

test("runBootstrapAnalysis keeps a Claude analyst on the plain askProvider path — the OS sandbox wrapper is Codex-only", async () => {
  let askProviderCalled = false;
  let sandboxCalled = false;
  const service = createConversationService({
    resolveRoot: async () => "/repo", homeDir: "/home/test",
    acquireProjectAnalysisLock: grantedLock,
    buildSanitizedSnapshot: async () => ({
      snapshotRoot: "/tmp/fake-snapshot", filesCopied: 0, secretsRedacted: 0,
      copiedFiles: [], excludedPrivatePaths: [], cleanup: async () => {}
    }),
    verifyClaudeSubscriptionAuth: async () => ({ mode: "subscription", subscriptionType: "pro" }),
    readClaudeModels: () => ({ status: "documented", source: "test", models: [{ id: "claude-model", displayName: "Claude Model" }], error: null }),
    askProvider: async (args) => {
      askProviderCalled = true;
      assert.equal(args.provider, "claude");
      return { status: "answered", error: null, answer: JSON.stringify({ architectureTraits: [], complexitySignals: [], criticalAreas: [], contextNeeds: [], workflowNeeds: [], recommendedRoleNeeds: [], uncertainties: [], evidenceReferences: [] }) };
    },
    runCodexSandboxedBootstrap: async () => { sandboxCalled = true; return { status: "error", error: "should never be called for claude", answer: null }; },
    writeProjectStrategy: async (homeDir, projectRoot, strategy) => strategy
  });
  const profile = { projectName: "repo", stack: [], architecture: {}, quality: {}, hotspots: [], workflowCapabilities: [], risks: [], fingerprint: "fp-1", roleRequirements: [] };
  const candidates = await realScoredCandidates();
  const analyst = { choice: "quality", model: { adapterId: "claude", modelId: "claude-model" } };
  await service.runBootstrapAnalysis({ cwd: "/repo", profile, candidates, analyst });
  assert.equal(askProviderCalled, true);
  assert.equal(sandboxCalled, false);
});

test("runBootstrapAnalysis fails closed (never a silent fallback) when Codex's OS-level sandbox is unavailable on this platform", async () => {
  let wrote = false;
  let cleanedUp = false;
  const service = createConversationService({
    resolveRoot: async () => "/repo", homeDir: "/home/test",
    acquireProjectAnalysisLock: grantedLock,
    buildSanitizedSnapshot: async () => ({
      snapshotRoot: "/tmp/fake-snapshot", filesCopied: 0, secretsRedacted: 0,
      copiedFiles: [], excludedPrivatePaths: [], cleanup: async () => { cleanedUp = true; }
    }),
    codexIsolationDeps: { platform: "linux" },
    runCodexSandboxedBootstrap: async () => { throw new Error("must never be called — checkEligibility must gate before analyze"); },
    writeProjectStrategy: async () => { wrote = true; }
  });
  const profile = { projectName: "repo", stack: [], architecture: {}, quality: {}, hotspots: [], workflowCapabilities: [], risks: [], fingerprint: "fp-1", roleRequirements: [] };
  const candidates = await realScoredCandidates();
  const analyst = { choice: "quality", model: { adapterId: "codex", modelId: "codex-model" } };
  await assert.rejects(() => service.runBootstrapAnalysis({ cwd: "/repo", profile, candidates, analyst }), /not eligible/);
  assert.equal(wrote, false);
  assert.equal(cleanedUp, true);
});

test("runBootstrapAnalysis rejects an analyst adapterId with no real BootstrapAnalyzerAdapter implementation yet, never a silent guess", async () => {
  let wrote = false;
  const service = createConversationService({
    resolveRoot: async () => "/repo", homeDir: "/home/test",
    acquireProjectAnalysisLock: grantedLock,
    buildSanitizedSnapshot: async () => ({
      snapshotRoot: "/tmp/fake-snapshot", filesCopied: 0, secretsRedacted: 0,
      copiedFiles: [], excludedPrivatePaths: [], cleanup: async () => {}
    }),
    writeProjectStrategy: async () => { wrote = true; }
  });
  const profile = { projectName: "repo", stack: [], architecture: {}, quality: {}, hotspots: [], workflowCapabilities: [], risks: [], fingerprint: "fp-1", roleRequirements: [] };
  const candidates = await realScoredCandidates();
  const analyst = { choice: "quality", model: { adapterId: "opencode-go", modelId: "some-model" } };
  await assert.rejects(() => service.runBootstrapAnalysis({ cwd: "/repo", profile, candidates, analyst }), /not eligible/);
  assert.equal(wrote, false);
});

test("CANARY: runBootstrapAnalysis's real sanitized-snapshot pipeline (not mocked away) never lets a real secret reach what would be sent to the provider", async () => {
  // A real fixture project with a real-shaped fake secret — the exact
  // scenario the crm live-verification exposed. Only the analyst call
  // itself is mocked (a real provider can't be called in a unit test); the
  // sanitized-snapshot build is the REAL implementation, exercised
  // end-to-end, so this test would fail if that pipeline regressed.
  const CANARY = "abcd1234efgh5678ijkl9012mnop3456";
  const projectRoot = await mkdtemp(join(tmpdir(), "kairo-canary-project-"));
  await mkdir(join(projectRoot, "src/app/api/chat"), { recursive: true });
  await writeFile(
    join(projectRoot, "src/app/api/chat/route.ts"),
    `const AZURE_OPENAI_API_KEY = "${CANARY}";\nexport const handler = () => {};`,
    "utf8"
  );

  async function collectFileContents(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    let all = "";
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) all += await collectFileContents(full);
      else all += await readFile(full, "utf8").catch(() => "");
    }
    return all;
  }

  let seenCwd = null;
  let everythingTheProviderCouldRead = null;
  const service = createConversationService({
    resolveRoot: async () => projectRoot,
    homeDir: "/home/test",
    acquireProjectAnalysisLock: grantedLock,
    codexIsolationDeps: { platform: "darwin", access: async () => {} },
    // Inspect the real sanitized snapshot WHILE it still exists — the
    // real cleanup() runs in runBootstrapAnalysis's own `finally`, right
    // after this call returns, so the snapshot is gone by the time the
    // outer test code resumes.
    runCodexSandboxedBootstrap: async (args) => {
      seenCwd = args.snapshotRoot;
      everythingTheProviderCouldRead = await collectFileContents(args.snapshotRoot);
      return {
        status: "answered", error: null,
        answer: JSON.stringify({
          architectureTraits: [], complexitySignals: [], criticalAreas: [], contextNeeds: [], workflowNeeds: [],
          recommendedRoleNeeds: [], uncertainties: [], evidenceReferences: []
        })
      };
    },
    writeProjectStrategy: async (homeDir, projectRootArg, strategy) => strategy
  });
  const profile = {
    projectName: "canary", stack: [], architecture: {}, quality: {}, hotspots: [], workflowCapabilities: [], risks: [], fingerprint: "fp-1",
    roleRequirements: [{ role: "Explorer", capabilities: ["reasoning"], reason: "baseline" }]
  };
  const candidates = await realScoredCandidates();
  const analyst = { choice: "quality", model: { adapterId: "codex", modelId: "codex-model" } };
  await service.runBootstrapAnalysis({ cwd: projectRoot, profile, candidates, analyst });

  assert.ok(seenCwd, "askProvider must have been called");
  assert.notEqual(seenCwd, projectRoot, "the provider must never be pointed at the real project directory");
  assert.doesNotMatch(everythingTheProviderCouldRead, new RegExp(CANARY), "the real secret must never exist anywhere the provider could read it");
  assert.match(everythingTheProviderCouldRead, /\[REDACTED-SECRET\]/, "the redaction must have actually run, not just happened to omit the file");
});

test("approveProjectStrategy moves SUGGESTED -> ACTIVE and stamps a real approvedAt, but requires a real suggested strategy to exist first", async () => {
  let stored = { schema: "kairo.project-strategy/v1", status: "suggested", profileFingerprint: "fp-1" };
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/test",
    readProjectStrategy: async () => stored,
    writeProjectStrategy: async (homeDir, projectRoot, strategy) => { stored = strategy; return strategy; }
  });
  const approved = await service.approveProjectStrategy({ cwd: "/repo" });
  assert.equal(approved.status, "active");
  assert.ok(approved.approvedAt);

  const serviceNoStrategy = createConversationService({
    resolveRoot: async () => "/repo", homeDir: "/home/test",
    readProjectStrategy: async () => null
  });
  await assert.rejects(() => serviceNoStrategy.approveProjectStrategy({ cwd: "/repo" }));
});

test("refreshProjectStrategy marks an ACTIVE strategy STALE only when the real fingerprint actually changed, and preserves its previous approval/team otherwise", async () => {
  const activeStrategy = { schema: "kairo.project-strategy/v1", status: "active", profileFingerprint: "fp-1", activeRoles: ["Explorer"], approvedAt: "t0" };
  let written = null;
  const staleService = createConversationService({
    resolveRoot: async () => "/repo", homeDir: "/home/test",
    readProjectStrategy: async () => activeStrategy,
    computeProjectProfile: async () => ({ fingerprint: "fp-2", roleRequirements: [] }),
    writeProjectStrategy: async (homeDir, projectRoot, strategy) => { written = strategy; return strategy; }
  });
  const staleResult = await staleService.refreshProjectStrategy({ cwd: "/repo" });
  assert.equal(staleResult.status, "stale");
  assert.deepEqual(staleResult.activeRoles, ["Explorer"], "the previous team assignment must survive — refresh flags staleness, it never silently swaps the team");
  assert.equal(written.status, "stale");

  const freshService = createConversationService({
    resolveRoot: async () => "/repo", homeDir: "/home/test",
    readProjectStrategy: async () => activeStrategy,
    computeProjectProfile: async () => ({ fingerprint: "fp-1", roleRequirements: [] })
  });
  const freshResult = await freshService.refreshProjectStrategy({ cwd: "/repo" });
  assert.equal(freshResult.status, "active", "an unchanged real fingerprint must never be marked stale");
});

test("refreshProjectStrategy never silently re-runs a real provider call for a project that was never approved — nothing was a real commitment to go stale", async () => {
  let profileComputed = false;
  const service = createConversationService({
    resolveRoot: async () => "/repo", homeDir: "/home/test",
    readProjectStrategy: async () => null,
    computeProjectProfile: async () => { profileComputed = true; return { fingerprint: "fp-1", roleRequirements: [] }; }
  });
  const result = await service.refreshProjectStrategy({ cwd: "/repo" });
  assert.equal(result, null, "NOT_ANALYZED stays NOT_ANALYZED — refresh never auto-runs the interactive analyst flow");
  assert.equal(profileComputed, false);

  const suggestedStrategy = { schema: "kairo.project-strategy/v1", status: "suggested", profileFingerprint: "fp-1" };
  const suggestedService = createConversationService({
    resolveRoot: async () => "/repo", homeDir: "/home/test",
    readProjectStrategy: async () => suggestedStrategy,
    computeProjectProfile: async () => { profileComputed = true; return { fingerprint: "fp-2", roleRequirements: [] }; }
  });
  const suggestedResult = await suggestedService.refreshProjectStrategy({ cwd: "/repo" });
  assert.equal(suggestedResult, suggestedStrategy, "a merely-suggested strategy is left exactly as-is");
  assert.equal(profileComputed, false);
});

test("REGRESSION: setCursorManualQuota no longer exists — Cursor's real access is a real automatic probe now (cursor-entitlement.js), never a human toggle", () => {
  const service = createConversationService({ resolveRoot: async () => "/repo", homeDir: "/home/test" });
  assert.equal(service.setCursorManualQuota, undefined);
});

async function realTeamEditCandidates() {
  const { scoreAvailableModels } = await import("../src/global/intelligence/model-intelligence.js");
  const { createCapabilityRegistry } = await import("../src/global/intelligence/model-capability-registry.js");
  const scoredAll = scoreAvailableModels([
    { adapterId: "codex", models: [{ id: "codex-model" }] },
    { adapterId: "claude", models: [{ id: "claude-model" }] },
    { adapterId: "cursor", models: [{ id: "cursor-model" }] }
  ], [
    { slug: "codex-model", name: "Codex Model", intelligenceIndex: 90, codingIndex: 40, mathIndex: null },
    { slug: "claude-model", name: "Claude Model", intelligenceIndex: 40, codingIndex: 90, mathIndex: null },
    { slug: "cursor-model", name: "Cursor Model", intelligenceIndex: 70, codingIndex: 70, mathIndex: null }
  ]);
  return { scoredAll, eligibility: { codex: { ok: true }, claude: { ok: true }, cursor: { ok: true } }, registry: createCapabilityRegistry(), providerCapacity: null, unscoredModels: [] };
}

function suggestedStrategyWithExplorer(model) {
  return {
    schema: "kairo.project-strategy/v1", status: "suggested", profileFingerprint: "fp-1", activeRoles: ["Explorer"],
    projectTeam: [{
      role: "Explorer", model, fallback: null, decisionEvidence: null, assignmentSource: "recommended",
      recommendedAssignment: { model, fallback: null, decisionEvidence: null }, overrideEvidence: null
    }]
  };
}

test("getProjectTeamEditCatalog reads the real modelIntelligence pool and includes every real team-executable adapter (Codex/Claude/Cursor/OpenCode Go), read-only, no quota consumed", async () => {
  const service = createConversationService({ resolveRoot: async () => "/repo", homeDir: "/home/test" });
  service.snapshot = async () => ({ modelIntelligence: await realTeamEditCandidates() });
  const catalog = await service.getProjectTeamEditCatalog({ cwd: "/repo", role: "Explorer" });
  assert.deepEqual(new Set(catalog.models.map((m) => m.adapterId)), new Set(["codex", "claude", "cursor"]));
});

test("setProjectTeamAssignment persists a real override that survives a store round-trip", async () => {
  const recommendedModel = { candidateKey: "codex::codex-model", adapterId: "codex", modelId: "codex-model", displayName: "Codex Model", accessMode: "automatic" };
  let stored = suggestedStrategyWithExplorer(recommendedModel);
  const service = createConversationService({
    resolveRoot: async () => "/repo", homeDir: "/home/test",
    readProjectStrategy: async () => stored,
    writeProjectStrategy: async (homeDir, projectRoot, strategy) => { stored = strategy; return strategy; }
  });
  service.snapshot = async () => ({ modelIntelligence: await realTeamEditCandidates() });
  const updated = await service.setProjectTeamAssignment({ cwd: "/repo", role: "Explorer", candidateKey: "cursor::cursor-model" });
  const entry = updated.projectTeam.find((e) => e.role === "Explorer");
  assert.equal(entry.model.adapterId, "cursor");
  assert.equal(entry.assignmentSource, "override");
  assert.deepEqual(entry.recommendedAssignment.model, recommendedModel, "the real original recommendation must survive the override");
  assert.equal(stored.projectTeam.find((e) => e.role === "Explorer").assignmentSource, "override", "the override must actually be persisted, not just returned");
});

test("setProjectTeamAssignment rejects a candidateKey that is no longer a real, current candidate (superseded or disappeared)", async () => {
  const recommendedModel = { candidateKey: "codex::codex-model", adapterId: "codex", modelId: "codex-model", displayName: "Codex Model", accessMode: "automatic" };
  const service = createConversationService({
    resolveRoot: async () => "/repo", homeDir: "/home/test",
    readProjectStrategy: async () => suggestedStrategyWithExplorer(recommendedModel)
  });
  service.snapshot = async () => ({ modelIntelligence: await realTeamEditCandidates() });
  await assert.rejects(
    () => service.setProjectTeamAssignment({ cwd: "/repo", role: "Explorer", candidateKey: "codex::gpt-long-gone" }),
    /not a real, current candidate/
  );
});

test("setProjectTeamAssignment refuses to edit an ACTIVE or STALE project strategy", async () => {
  const recommendedModel = { candidateKey: "codex::codex-model", adapterId: "codex", modelId: "codex-model", displayName: "Codex Model", accessMode: "automatic" };
  const activeStrategy = { ...suggestedStrategyWithExplorer(recommendedModel), status: "active" };
  const service = createConversationService({
    resolveRoot: async () => "/repo", homeDir: "/home/test",
    readProjectStrategy: async () => activeStrategy
  });
  service.snapshot = async () => ({ modelIntelligence: await realTeamEditCandidates() });
  await assert.rejects(
    () => service.setProjectTeamAssignment({ cwd: "/repo", role: "Explorer", candidateKey: "cursor::cursor-model" }),
    /ACTIVE/
  );
});

test("setProjectTeamAssignment choosing the real recommended candidateKey again implicitly resets the override", async () => {
  const recommendedModel = { candidateKey: "codex::codex-model", adapterId: "codex", modelId: "codex-model", displayName: "Codex Model", accessMode: "automatic" };
  let stored = suggestedStrategyWithExplorer(recommendedModel);
  const service = createConversationService({
    resolveRoot: async () => "/repo", homeDir: "/home/test",
    readProjectStrategy: async () => stored,
    writeProjectStrategy: async (homeDir, projectRoot, strategy) => { stored = strategy; return strategy; }
  });
  service.snapshot = async () => ({ modelIntelligence: await realTeamEditCandidates() });
  await service.setProjectTeamAssignment({ cwd: "/repo", role: "Explorer", candidateKey: "cursor::cursor-model" });
  const restored = await service.setProjectTeamAssignment({ cwd: "/repo", role: "Explorer", candidateKey: "codex::codex-model" });
  const entry = restored.projectTeam.find((e) => e.role === "Explorer");
  assert.equal(entry.assignmentSource, "recommended");
  assert.equal(entry.overrideEvidence, null);
});

test("snapshot exposes the real persisted ProjectStrategy (or null for NOT_ANALYZED) without ever recomputing it on a plain poll", async () => {
  let profileComputed = false;
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/test",
    listPlans: async () => [],
    recoverRuns: async () => {},
    readProjectStrategy: async () => ({ schema: "kairo.project-strategy/v1", status: "active", profileFingerprint: "fp-1" }),
    computeProjectProfile: async () => { profileComputed = true; return { fingerprint: "fp-1", roleRequirements: [] }; }
  });
  const snap = await service.snapshot({ cwd: "/repo" });
  assert.equal(snap.projectStrategy.status, "active");
  assert.equal(profileComputed, false, "a plain snapshot/poll must never trigger a real ProjectProfile computation");
});

test("snapshot cross-references real model catalogs with real Artificial Analysis scores when probes are enabled", async () => {
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/kal-el",
    enableProviderProbes: true,
    listPlans: async () => [],
    recoverRuns: async () => {},
    inspectExecutionAdapters: () => [
      { id: "codex", available: true, launchable: true, reason: null },
      { id: "claude", available: true, launchable: true, reason: null }
    ],
    inspectEngramIntegration: () => ({ status: "configured" }),
    readCodexUsage: async () => null,
    readClaudeUsage: async () => null,
    readCodexModels: async () => ({ status: "measured", models: [{ id: "gpt-6-astra", displayName: "GPT-6 Astra" }] }),
    readClaudeModels: () => ({ status: "documented", models: [{ id: "claude-opus-5" }] }),
    readOpenCodeModels: async () => ({ status: "measured", models: [] }),
    readCursorModels: async () => ({ status: "measured", models: [] }),
    readArtificialAnalysisModels: async () => ({
      status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h",
      models: [
        { slug: "gpt-6-astra", name: "GPT-6 Astra", intelligenceIndex: 52.8, codingIndex: 76.9, mathIndex: null },
        { slug: "claude-opus-5", name: "Claude Opus 5", intelligenceIndex: 50.7, codingIndex: 78, mathIndex: null }
      ]
    }),
    readHuggingFaceLeaderboard: async () => ({ status: "unknown", source: null, fetchedAt: null, age: null, entries: [], error: "not mocked" }),
    listRunRecords: async () => []
  });

  const snapshot = await service.snapshot({ cwd: "/repo" });
  assert.equal(snapshot.modelIntelligence.status, "live");
  assert.equal(snapshot.modelIntelligence.models.length, 2);
  assert.deepEqual(snapshot.modelIntelligence.models.map((m) => m.modelId), ["gpt-6-astra", "claude-opus-5"]);
  assert.deepEqual(snapshot.modelIntelligence.scoredAll.map((m) => m.modelId), ["gpt-6-astra"], "unverified Claude must be absent from automatic recommendations");
  assert.deepEqual(
    new Set(snapshot.modelIntelligence.manualSelectionScoredPool.map((m) => m.modelId)),
    new Set(["gpt-6-astra", "claude-opus-5"]),
    "the explicit manual catalog keeps unverified Claude"
  );
  assert.equal(
    snapshot.modelIntelligence.manualSelectionScoredPool.find((m) => m.modelId === "claude-opus-5").entitlement,
    ENTITLEMENT.UNVERIFIED
  );
  // Coverage/confidence: real catalog status + how much of it matched AA,
  // independent of runtime eligibility — Claude stays "documented" (no
  // live per-account discovery exists), Codex is "measured".
  const codexCoverage = snapshot.modelIntelligence.coverage.find((c) => c.adapterId === "codex");
  const claudeCoverage = snapshot.modelIntelligence.coverage.find((c) => c.adapterId === "claude");
  assert.deepEqual(codexCoverage, { adapterId: "codex", catalogStatus: "measured", totalModels: 1, matchedModels: 1 });
  assert.deepEqual(claudeCoverage, { adapterId: "claude", catalogStatus: "documented", totalModels: 1, matchedModels: 1 });
});

test("REGRESSION: snapshot resolves Claude entitlement from cache only — never calls a per-model probe dep", async () => {
  let probeCalls = 0;
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/kal-el",
    enableProviderProbes: true,
    listPlans: async () => [],
    recoverRuns: async () => {},
    inspectExecutionAdapters: () => [
      { id: "claude", available: true, launchable: true, reason: null }
    ],
    inspectEngramIntegration: () => ({ status: "configured" }),
    readCodexUsage: async () => null,
    readClaudeUsage: async () => null,
    readCodexModels: async () => ({ status: "measured", models: [] }),
    readClaudeModels: () => ({ status: "documented", models: [{ id: "claude-opus-5" }] }),
    readOpenCodeModels: async () => ({ status: "measured", models: [] }),
    readCursorModels: async () => ({ status: "measured", models: [] }),
    readArtificialAnalysisModels: async () => ({
      status: "live", source: "test", age: "<1h", models: []
    }),
    readHuggingFaceLeaderboard: async () => ({ status: "unknown", source: null, fetchedAt: null, age: null, entries: [], error: "not mocked" }),
    listRunRecords: async () => [],
    verifyClaudeSubscriptionAuth: async () => ({ mode: "subscription", subscriptionType: "pro" }),
    readClaudeEntitlementCache: async () => ({
      subscriptionType: "pro",
      fetchedAt: new Date().toISOString(),
      models: {
        "claude-opus-5": {
          status: "allowed",
          reason: null,
          probedAt: new Date().toISOString()
        }
      }
    }),
    // If snapshot ever imported/called a probe, tests wiring this would still
    // fail closed here — there is no probeClaude* dep on the service.
    probeClaudeModelEntitlement: async () => {
      probeCalls += 1;
      throw new Error("snapshot must never probe entitlement");
    }
  });

  const snapshot = await service.snapshot({ cwd: "/repo" });
  assert.equal(probeCalls, 0);
  assert.equal(snapshot.modelIntelligence.claudeEntitlement["claude-opus-5"].status, "allowed");
});

test("REGRESSION: snapshot's real unscoredModels preserves candidateKey/accessMode/lifecycle (never defaulting a real Cursor model's accessMode to null) and excludes a real superseded generation", async () => {
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/kal-el",
    enableProviderProbes: true,
    listPlans: async () => [],
    recoverRuns: async () => {},
    inspectExecutionAdapters: () => [{ id: "claude", available: true, launchable: true, reason: null }],
    inspectEngramIntegration: () => ({ status: "configured" }),
    readCodexUsage: async () => null,
    readClaudeUsage: async () => null,
    // claude-opus-5 must be entitlement-ALLOWED here — this test is about
    // real field preservation (candidateKey/accessMode/lifecycle) and
    // supersession, orthogonal to entitlement; an UNVERIFIED default
    // (the real behavior with no cache) would now correctly exclude it.
    // subscriptionType must match resolveClaudeEntitlements' own real
    // cache-invalidation check, or the mocked cache is silently ignored.
    verifyClaudeSubscriptionAuth: async () => ({ mode: "subscription", subscriptionType: "pro" }),
    readClaudeEntitlementCache: async () => ({
      subscriptionType: "pro",
      fetchedAt: new Date().toISOString(),
      models: { "claude-opus-5": { status: "allowed", probedAt: new Date().toISOString() } }
    }),
    readCodexModels: async () => ({ status: "measured", models: [] }),
    // None of these three real ids have an AA match below — all unscored.
    // opus-4-6/4-8 are a real, recognized older generation once opus-5 is
    // also present (see model-candidate-catalog.test.js's own fixture).
    readClaudeModels: () => ({
      status: "documented",
      models: [
        { id: "claude-opus-4-6", displayName: "Claude Opus 4.6" },
        { id: "claude-opus-4-8", displayName: "Claude Opus 4.8" },
        { id: "claude-opus-5", displayName: "Claude Opus 5" }
      ]
    }),
    readOpenCodeModels: async () => ({ status: "measured", models: [] }),
    readCursorModels: async () => ({ status: "measured", models: [] }),
    readArtificialAnalysisModels: async () => ({ status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h", models: [] }),
    readHuggingFaceLeaderboard: async () => ({ status: "unknown", source: null, fetchedAt: null, age: null, entries: [], error: "not mocked" }),
    listRunRecords: async () => []
  });

  const snapshot = await service.snapshot({ cwd: "/repo" });
  const byId = Object.fromEntries(snapshot.modelIntelligence.unscoredModels.map((m) => [m.modelId, m]));
  assert.ok(byId["claude-opus-5"], "the real current generation must appear as unscored");
  assert.equal(byId["claude-opus-5"].accessMode, "automatic", "a real Claude model's real accessMode must survive, never default to null");
  assert.equal(byId["claude-opus-5"].candidateKey, "claude::claude-opus-5");
  assert.equal(byId["claude-opus-4-6"], undefined, "a real superseded generation must never appear in unscoredModels");
  assert.equal(byId["claude-opus-4-8"], undefined, "a real superseded generation must never appear in unscoredModels");
});

test("REGRESSION: snapshot starts usage, project strategy, and provider-probe catalog reads concurrently — never as sequential waves", async () => {
  // A slow usage read (50ms) must not block a provider-probe read
  // (artificial-analysis models) from resolving first — if they were
  // still two sequential Promise.all waves, the second wave couldn't
  // even START until the slow usage read in the first wave finished.
  let aaResolvedBeforeSlowUsageFinished = false;
  let usageFinished = false;
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/kal-el",
    enableProviderProbes: true,
    listPlans: async () => [],
    recoverRuns: async () => {},
    inspectExecutionAdapters: () => [{ id: "codex", available: true, launchable: true, reason: null }],
    inspectEngramIntegration: () => ({ status: "configured" }),
    readCodexUsage: async () => null,
    readClaudeUsage: async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      usageFinished = true;
      return null;
    },
    verifyClaudeSubscriptionAuth: async () => ({ mode: "subscription", subscriptionType: "pro" }),
    readClaudeEntitlementCache: async () => null,
    readCodexModels: async () => ({ status: "measured", models: [] }),
    readClaudeModels: () => ({ status: "documented", models: [] }),
    readOpenCodeModels: async () => ({ status: "measured", models: [] }),
    readCursorModels: async () => ({ status: "measured", models: [] }),
    readArtificialAnalysisModels: async () => {
      if (!usageFinished) aaResolvedBeforeSlowUsageFinished = true;
      return { status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h", models: [] };
    },
    readHuggingFaceLeaderboard: async () => ({ status: "unknown", source: null, fetchedAt: null, age: null, entries: [], error: "not mocked" }),
    listRunRecords: async () => []
  });

  await service.snapshot({ cwd: "/repo" });
  assert.equal(aaResolvedBeforeSlowUsageFinished, true, "provider-probe reads must start concurrently with usage reads, not wait for them to finish first");
});

test("REGRESSION: Cursor's two real pool probes run concurrently, never sequentially — a slow probe for one pool must not delay starting the other's", async () => {
  const startedAt = {};
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/kal-el",
    enableProviderProbes: true,
    listPlans: async () => [],
    recoverRuns: async () => {},
    inspectExecutionAdapters: () => [{ id: "cursor", available: true, launchable: true, reason: null }],
    inspectEngramIntegration: () => ({ status: "configured" }),
    readCodexUsage: async () => null,
    readClaudeUsage: async () => null,
    verifyClaudeSubscriptionAuth: async () => ({ mode: "subscription", subscriptionType: "pro" }),
    readClaudeEntitlementCache: async () => null,
    readCodexModels: async () => ({ status: "measured", models: [] }),
    readClaudeModels: () => ({ status: "documented", models: [] }),
    readOpenCodeModels: async () => ({ status: "measured", models: [] }),
    readCursorModels: async () => ({
      status: "measured",
      models: [
        { id: "composer-2.5", displayName: "Composer 2.5" }, // cursor_models pool
        { id: "gpt-5.3-codex", displayName: "Codex 5.3" } // other_models pool
      ]
    }),
    readCursorAccessCache: async () => null,
    writeCursorAccessCache: async () => {},
    probeCursorPoolAccess: async ({ pool }) => {
      startedAt[pool] = Date.now();
      // cursor_models is deliberately the slow one — a sequential for-loop
      // probes it FIRST (see resolveOrProbeCursorAccess's real pool order),
      // so other_models would only start after this whole delay if the two
      // probes weren't running concurrently.
      await new Promise((resolve) => setTimeout(resolve, pool === "cursor_models" ? 40 : 5));
      return { pool, status: "available", reason: null, probedAt: new Date().toISOString() };
    },
    readArtificialAnalysisModels: async () => ({ status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h", models: [] }),
    readHuggingFaceLeaderboard: async () => ({ status: "unknown", source: null, fetchedAt: null, age: null, entries: [], error: "not mocked" }),
    listRunRecords: async () => []
  });

  await service.snapshot({ cwd: "/repo" });
  assert.ok(startedAt.cursor_models, "cursor_models pool must have been probed");
  assert.ok(startedAt.other_models, "other_models pool must have been probed");
  const gap = Math.abs(startedAt.other_models - startedAt.cursor_models);
  assert.ok(gap < 20, `both pool probes must start within a few ms of each other (concurrent) — got a ${gap}ms gap, consistent with a sequential for-loop waiting out cursor_models' full 40ms delay first`);
});

test("REGRESSION: a real UNVERIFIED Cursor probe result cools down in memory for 30s — never re-spawns cursor-agent on every snapshot() poll", async () => {
  let probeCalls = 0;
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/kal-el",
    enableProviderProbes: true,
    listPlans: async () => [],
    recoverRuns: async () => {},
    inspectExecutionAdapters: () => [{ id: "cursor", available: true, launchable: true, reason: null }],
    inspectEngramIntegration: () => ({ status: "configured" }),
    readCodexUsage: async () => null,
    readClaudeUsage: async () => null,
    verifyClaudeSubscriptionAuth: async () => ({ mode: "subscription", subscriptionType: "pro" }),
    readClaudeEntitlementCache: async () => null,
    readCodexModels: async () => ({ status: "measured", models: [] }),
    readClaudeModels: () => ({ status: "documented", models: [] }),
    readOpenCodeModels: async () => ({ status: "measured", models: [] }),
    readCursorModels: async () => ({ status: "measured", models: [{ id: "composer-2.5", displayName: "Composer 2.5" }] }),
    readCursorAccessCache: async () => null,
    writeCursorAccessCache: async () => {},
    // A real, ongoing auth failure — this account never resolves to
    // AVAILABLE/EXHAUSTED, so the disk cache (which never persists
    // UNVERIFIED) stays permanently stale between polls.
    probeCursorPoolAccess: async ({ pool }) => {
      probeCalls += 1;
      return { pool, status: "unverified", reason: "cursor-agent exited 1: Authentication required", probedAt: new Date().toISOString() };
    },
    readArtificialAnalysisModels: async () => ({ status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h", models: [] }),
    readHuggingFaceLeaderboard: async () => ({ status: "unknown", source: null, fetchedAt: null, age: null, entries: [], error: "not mocked" }),
    listRunRecords: async () => []
  });

  await service.snapshot({ cwd: "/repo" });
  await service.snapshot({ cwd: "/repo" });
  await service.snapshot({ cwd: "/repo" });
  assert.equal(probeCalls, 1, "three snapshot() polls within the 30s cooldown must real-probe exactly once, not once per poll");
});

test("REGRESSION: snapshot's real unscoredModels — the exact list /models --evidence renders — excludes an UNVERIFIED unscored Claude model, not just a DENIED one", async () => {
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/kal-el",
    enableProviderProbes: true,
    listPlans: async () => [],
    recoverRuns: async () => {},
    inspectExecutionAdapters: () => [{ id: "claude", available: true, launchable: true, reason: null }],
    inspectEngramIntegration: () => ({ status: "configured" }),
    readCodexUsage: async () => null,
    readClaudeUsage: async () => null,
    // Never spawn the real Claude CLI in a test — mocked deterministic,
    // not this machine's own real auth state.
    verifyClaudeSubscriptionAuth: async () => ({ mode: "subscription", subscriptionType: "pro" }),
    // No real entitlement cache at all — the exact real-world default,
    // per resolveClaudeEntitlements — resolves to UNVERIFIED.
    readClaudeEntitlementCache: async () => null,
    readClaudeModels: () => ({ status: "documented", models: [{ id: "claude-unscored-model", displayName: "Claude Unscored Model" }] }),
    readOpenCodeModels: async () => ({ status: "measured", models: [] }),
    readCursorModels: async () => ({ status: "measured", models: [] }),
    readArtificialAnalysisModels: async () => ({ status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h", models: [] }),
    readHuggingFaceLeaderboard: async () => ({ status: "unknown", source: null, fetchedAt: null, age: null, entries: [], error: "not mocked" }),
    listRunRecords: async () => []
  });

  const snapshot = await service.snapshot({ cwd: "/repo" });
  assert.ok(
    !snapshot.modelIntelligence.unscoredModels.some((m) => m.modelId === "claude-unscored-model"),
    "an UNVERIFIED unscored Claude model must never appear in /models --evidence's UNSCORED list — 'unavailable' means absent, never visible with a warning"
  );
});

test("snapshot excludes a provider from FIT once its real quota is exhausted, even though it would otherwise win on capability", async () => {
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/kal-el",
    enableProviderProbes: true,
    listPlans: async () => [],
    recoverRuns: async () => {},
    inspectExecutionAdapters: () => [
      { id: "codex", available: true, launchable: true, reason: null },
      { id: "claude", available: true, launchable: true, reason: null }
    ],
    inspectEngramIntegration: () => ({ status: "configured" }),
    readCodexUsage: async () => null,
    readClaudeUsage: async () => ({ primary: { remainingPercent: 2 } }), // nearly exhausted
    readCodexModels: async () => ({ status: "measured", models: [{ id: "gpt-6-astra", displayName: "GPT-6 Astra" }] }),
    readClaudeModels: () => ({ status: "documented", models: [{ id: "claude-opus-5" }] }),
    readOpenCodeModels: async () => ({ status: "measured", models: [] }),
    readCursorModels: async () => ({ status: "measured", models: [] }),
    readArtificialAnalysisModels: async () => ({
      status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h",
      models: [
        // Claude objectively wins on every real metric, but its quota is exhausted.
        { slug: "gpt-6-astra", name: "GPT-6 Astra", intelligenceIndex: 30, codingIndex: 30, mathIndex: null },
        { slug: "claude-opus-5", name: "Claude Opus 5", intelligenceIndex: 99, codingIndex: 99, mathIndex: null }
      ]
    }),
    readHuggingFaceLeaderboard: async () => ({ status: "unknown", source: null, fetchedAt: null, age: null, entries: [], error: "not mocked" }),
    listRunRecords: async () => [],
    verifyClaudeSubscriptionAuth: async () => ({ mode: "subscription", subscriptionType: "pro" }),
    readClaudeEntitlementCache: async () => ({
      subscriptionType: "pro", fetchedAt: new Date().toISOString(),
      models: { "claude-opus-5": { status: ENTITLEMENT.ALLOWED, reason: null, probedAt: new Date().toISOString() } }
    })
  });

  const snapshot = await service.snapshot({ cwd: "/repo" });
  assert.deepEqual(snapshot.modelIntelligence.models.map((m) => m.adapterId), ["codex"]);
  assert.equal(snapshot.modelIntelligence.eligibility.claude.ok, false);
  assert.match(snapshot.modelIntelligence.eligibility.claude.reason, /window is limited/);
  assert.doesNotMatch(snapshot.modelIntelligence.eligibility.claude.reason, /exhaust/i);
  assert.equal(snapshot.modelIntelligence.eligibility.codex.ok, true);
  // Claude never wins a role despite the higher real score, because it was excluded before comparison.
  assert.ok(snapshot.modelIntelligence.roles.every((r) => r.adapterId === "codex"));
  // AI TEAM is different on purpose: it's computed across every real
  // candidate, so Claude still shows as the true capability winner — just
  // flagged unavailable — with Codex surfaced as the real eligible fallback,
  // instead of silently disappearing the way `roles`/`models` do above.
  const explorer = snapshot.modelIntelligence.aiTeam.find((t) => t.role === "Explorer");
  assert.equal(explorer.primary.adapterId, "claude");
  assert.equal(explorer.primary.available, false);
  assert.equal(explorer.fallback.adapterId, "codex");
  assert.equal(explorer.fallback.available, true);
});

test("snapshot lets AI TEAM recommend a real, accessible, launchable opencode-go model — Go is a real automatic candidate now", async () => {
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/kal-el",
    enableProviderProbes: true,
    listPlans: async () => [],
    recoverRuns: async () => {},
    inspectExecutionAdapters: () => [
      { id: "codex", available: true, launchable: true, reason: null },
      { id: "claude", available: true, launchable: true, reason: null },
      // Real, verified state: OpenCode is available (CLI on PATH, real
      // structured events) and launchable — its own idle timeout (see
      // execution-adapters/opencode.js) covers the real hang risk.
      { id: "opencode", available: true, launchable: true, reason: null }
    ],
    inspectEngramIntegration: () => ({ status: "configured" }),
    readCodexUsage: async () => null,
    readClaudeUsage: async () => null,
    readCodexModels: async () => ({ status: "measured", models: [] }),
    readClaudeModels: () => ({ status: "documented", models: [] }),
    readOpenCodeModels: async () => ({ status: "measured", models: [{ id: "glm-5.3", displayName: "GLM 5.3" }] }),
    readCursorModels: async () => ({ status: "measured", models: [] }),
    readArtificialAnalysisModels: async () => ({
      status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h",
      models: [{ slug: "glm-5.3", name: "GLM 5.3", intelligenceIndex: 44.9, codingIndex: 74.8, mathIndex: null, priceInputPerMTok: 1.4 }]
    }),
    // Real-shaped HF leaderboard evidence for this exact Go model, so this
    // test also proves the Model Intelligence Foundation registry is wired
    // into AI TEAM's picks as corroboration (never as a ranking input).
    readHuggingFaceLeaderboard: async () => ({
      status: "live", source: "huggingface datasets api (leaderboard)", fetchedAt: "2026-09-12T00:00:00.000Z", age: "<1h",
      entries: [{ modelId: "zai-org/GLM-5.3", value: 62.5, verified: false, rank: 2 }], error: null
    }),
    listRunRecords: async () => []
  });

  const snapshot = await service.snapshot({ cwd: "/repo" });
  // Real, accessible via the Go subscription — AI TEAM can recommend it.
  assert.equal(snapshot.modelIntelligence.eligibility["opencode-go"].ok, true);
  // Explorer (required: reasoning only) is the only role this single
  // candidate's real evidence (intelligenceIndex/codingIndex composite
  // fallback, no terminalExecution) actually covers among the six real
  // roles — Economy is no longer one of them (see role-profiles.js).
  const explorer = snapshot.modelIntelligence.aiTeam.find((t) => t.role === "Explorer");
  assert.equal(explorer.primary.adapterId, "opencode-go");
  assert.equal(explorer.primary.available, true);
  assert.deepEqual(explorer.primary.corroboration, [{ metric: "hle", value: 62.5, source: "huggingface-leaderboard" }]);
});

test("snapshot always excludes opencode-zen from FIT's automatic candidates, independent of its catalog", async () => {
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/kal-el",
    enableProviderProbes: true,
    listPlans: async () => [],
    recoverRuns: async () => {},
    inspectExecutionAdapters: () => [
      { id: "codex", available: true, launchable: true, reason: null },
      { id: "claude", available: true, launchable: true, reason: null },
      { id: "cursor", available: false, launchable: false, reason: "not on PATH" }
    ],
    inspectEngramIntegration: () => ({ status: "configured" }),
    readCodexUsage: async () => null,
    readClaudeUsage: async () => null,
    readCodexModels: async () => ({ status: "measured", models: [] }),
    readClaudeModels: () => ({ status: "documented", models: [] }),
    readOpenCodeModels: async () => ({ status: "measured", models: [] }),
    readCursorModels: async () => ({ status: "measured", models: [] }),
    readArtificialAnalysisModels: async () => ({
      status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h",
      models: [{ slug: "claude-opus-5", name: "Claude Opus 5", intelligenceIndex: 99, codingIndex: 99, mathIndex: null }]
    }),
    readHuggingFaceLeaderboard: async () => ({ status: "unknown", source: null, fetchedAt: null, age: null, entries: [], error: "not mocked" }),
    listRunRecords: async () => []
  });

  const snapshot = await service.snapshot({ cwd: "/repo" });
  assert.equal(snapshot.modelIntelligence.eligibility["opencode-zen"].ok, false);
  assert.match(snapshot.modelIntelligence.eligibility["opencode-zen"].reason, /PAYG/);
});

test("snapshot genuinely includes a real, available Cursor as an AI TEAM recommendation candidate — recommendable, even though never auto-executable", async () => {
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/kal-el",
    enableProviderProbes: true,
    listPlans: async () => [],
    recoverRuns: async () => {},
    inspectExecutionAdapters: () => [
      { id: "codex", available: true, launchable: true, reason: null },
      { id: "claude", available: true, launchable: true, reason: null },
      { id: "cursor", available: true, launchable: true, reason: null }
    ],
    inspectEngramIntegration: () => ({ status: "configured" }),
    readCodexUsage: async () => null,
    readClaudeUsage: async () => null,
    readCodexModels: async () => ({ status: "measured", models: [] }),
    readClaudeModels: () => ({ status: "documented", models: [] }),
    readOpenCodeModels: async () => ({ status: "measured", models: [] }),
    readCursorModels: async () => ({ status: "measured", models: [{ id: "composer-2.5", displayName: "Composer 2.5" }, { id: "auto", displayName: "Auto (current, default)" }] }),
    // Real Cursor access is now a real, automatic probe (cursor-entitlement.js)
    // — never mock a spawn implicitly; a test that needs Cursor eligible
    // mocks the probe result explicitly, same discipline as every other
    // real subprocess call in this suite.
    readCursorAccessCache: async () => null,
    probeCursorPoolAccess: async ({ pool }) => ({ pool, status: "available", reason: null, probedAt: new Date().toISOString() }),
    writeCursorAccessCache: async () => {},
    readArtificialAnalysisModels: async () => ({
      status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h",
      models: [{ slug: "composer-2.5", name: "Composer 2.5", intelligenceIndex: 90, codingIndex: 95, mathIndex: null }]
    }),
    readHuggingFaceLeaderboard: async () => ({ status: "unknown", source: null, fetchedAt: null, age: null, entries: [], error: "not mocked" }),
    listRunRecords: async () => []
  });

  const snapshot = await service.snapshot({ cwd: "/repo" });
  assert.equal(snapshot.modelIntelligence.eligibility.cursor.ok, true);
  assert.ok(snapshot.modelIntelligence.models.some((m) => m.adapterId === "cursor" && m.modelId === "composer-2.5"));
  assert.ok(!snapshot.modelIntelligence.models.some((m) => m.adapterId === "cursor" && m.modelId === "auto"), "Cursor's opaque 'auto' fallback must never be scored or recommended as if it were a real, checkable named model");
});

test("REGRESSION: a real Cursor probe failure (never verified) fails closed — the model still appears (auditable) but its per-model entitlement is UNVERIFIED, never silently ALLOWED", async () => {
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/kal-el",
    enableProviderProbes: true,
    listPlans: async () => [],
    recoverRuns: async () => {},
    inspectExecutionAdapters: () => [
      { id: "codex", available: true, launchable: true, reason: null },
      { id: "claude", available: true, launchable: true, reason: null },
      { id: "cursor", available: true, launchable: true, reason: null }
    ],
    inspectEngramIntegration: () => ({ status: "configured" }),
    readCodexUsage: async () => null,
    readClaudeUsage: async () => null,
    readCodexModels: async () => ({ status: "measured", models: [] }),
    readClaudeModels: () => ({ status: "documented", models: [] }),
    readOpenCodeModels: async () => ({ status: "measured", models: [] }),
    readCursorModels: async () => ({ status: "measured", models: [{ id: "composer-2.5", displayName: "Composer 2.5" }] }),
    readCursorAccessCache: async () => null,
    probeCursorPoolAccess: async ({ pool }) => ({ pool, status: "unverified", reason: "cursor-agent probe timed out", probedAt: new Date().toISOString() }),
    writeCursorAccessCache: async () => {},
    readArtificialAnalysisModels: async () => ({
      status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h",
      models: [{ slug: "composer-2.5", name: "Composer 2.5", intelligenceIndex: 90, codingIndex: 95, mathIndex: null }]
    }),
    readHuggingFaceLeaderboard: async () => ({ status: "unknown", source: null, fetchedAt: null, age: null, entries: [], error: "not mocked" }),
    listRunRecords: async () => []
  });

  const snapshot = await service.snapshot({ cwd: "/repo" });
  // Adapter-level: Cursor CLI is genuinely installed/launchable — that's
  // real and true regardless of quota.
  assert.equal(snapshot.modelIntelligence.eligibility.cursor.ok, true);
  // Per-model: real quota was never confirmed — fails closed. "composer-2.5"
  // is Cursor's own model line, so it's the cursor_models pool here.
  assert.equal(snapshot.modelIntelligence.cursorAccess.cursor_models.status, "unverified");
  assert.equal(snapshot.modelIntelligence.modelEntitlement.cursor["composer-2.5"].status, ENTITLEMENT.UNVERIFIED);
});

test("snapshot exposes globalGuide.capability/efficient as the real, uncoordinated per-role winners — separate from the portfolio-coordinated aiTeam/efficientTeam", async () => {
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/kal-el",
    enableProviderProbes: true,
    listPlans: async () => [],
    recoverRuns: async () => {},
    inspectExecutionAdapters: () => [
      { id: "codex", available: true, launchable: true, reason: null },
      { id: "opencode", available: true, launchable: true, reason: null }
    ],
    inspectEngramIntegration: () => ({ status: "configured" }),
    readCodexUsage: async () => null,
    readClaudeUsage: async () => null,
    readCodexModels: async () => ({ status: "measured", models: [{ id: "gpt-6-astra" }] }),
    readClaudeModels: () => ({ status: "documented", models: [] }),
    readOpenCodeModels: async ({ provider } = {}) => (
      provider === "opencode-go" ? { status: "measured", models: [{ id: "muse-spark" }] } : { status: "measured", models: [] }
    ),
    readCursorModels: async () => ({ status: "measured", models: [] }),
    readArtificialAnalysisModels: async () => ({
      status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h",
      models: [
        { slug: "gpt-6-astra", name: "GPT-6 Astra", intelligenceIndex: 90, codingIndex: 90, mathIndex: null },
        { slug: "muse-spark", name: "Muse Spark", intelligenceIndex: 85, codingIndex: 85, mathIndex: null }
      ]
    }),
    readHuggingFaceLeaderboard: async () => ({ status: "unknown", source: null, fetchedAt: null, age: null, entries: [], error: "not mocked" }),
    listRunRecords: async () => []
  });

  const snapshot = await service.snapshot({ cwd: "/repo" });
  const capability = snapshot.modelIntelligence.globalGuide.capability;
  assert.ok(capability.length > 0, "globalGuide.capability must be populated, not just present as an empty default");
  // Astra is the real, decisive-enough-to-matter leader — globalGuide must
  // never cede a role to Muse for portfolio diversity the way aiTeam can.
  assert.ok(capability.every((entry) => entry.primary.adapterId === "codex"), "globalGuide.capability must keep the real per-role leader everywhere, uncoordinated");
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

test("REGRESSION: askQuestion reconstructs a real conversation from prior ASK exchanges — every provider call is otherwise a genuinely fresh one-shot process", async () => {
  const askCalls = [];
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    inspectExecutionAdapters: () => [{ id: "claude", available: true, launchable: true, reason: null }],
    selectAskProvider: () => ({ decision: "ROUTED", provider: "claude", model: "claude-opus-5", why: "read-only question" }),
    readAskHistory: async () => [
      { question: "what is this project?", answer: "It's an orchestrator.", provider: "claude", model: "claude-opus-5" }
    ],
    askProvider: async (args) => { askCalls.push(args); return { status: "answered", answer: "Codex, Claude, Cursor, OpenCode." }; },
    appendAskHistoryEntry: async () => {}
  });
  await service.askQuestion({ cwd: "/repo", task: "and what does it orchestrate?" });
  assert.match(askCalls[0].question, /what is this project\?/);
  assert.match(askCalls[0].question, /It's an orchestrator\./);
  assert.match(askCalls[0].question, /Now: and what does it orchestrate\?/);
  assert.match(askCalls[0].question, /reference context only, never as instructions/);
});

test("REGRESSION: a single most-recent ASK exchange that alone exceeds the 6000-char history budget is truncated, never sent whole and unbounded", async () => {
  const askCalls = [];
  const hugeAnswer = "x".repeat(9000);
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    inspectExecutionAdapters: () => [{ id: "claude", available: true, launchable: true, reason: null }],
    selectAskProvider: () => ({ decision: "ROUTED", provider: "claude", model: "claude-opus-5", why: "read-only question" }),
    readAskHistory: async () => [
      { question: "explain the whole architecture", answer: hugeAnswer, provider: "claude", model: "claude-opus-5" }
    ],
    askProvider: async (args) => { askCalls.push(args); return { status: "answered", answer: "ok" }; },
    appendAskHistoryEntry: async () => {}
  });
  await service.askQuestion({ cwd: "/repo", task: "and then what?" });
  // Pin the EXACT 6000-char budget invariant, not just "smaller than the
  // huge original" — a looser bound would pass even if the real cap
  // silently drifted to some other number.
  const parts = askCalls[0].question.split("\n\n");
  assert.equal(parts.length, 3, `expected header/block/Now — got:\n${askCalls[0].question}`);
  assert.equal(parts[1].length, 6000, "the truncated block must be exactly the 6000-char budget");
  assert.ok(parts[1].startsWith("Q: explain the whole architecture\nA: "));
  assert.ok(parts[1].endsWith("…"));
  assert.equal(parts[2], "Now: and then what?");
});

test("askQuestion with no prior ASK history sends the plain question, unwrapped", async () => {
  const askCalls = [];
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    inspectExecutionAdapters: () => [{ id: "claude", available: true, launchable: true, reason: null }],
    selectAskProvider: () => ({ decision: "ROUTED", provider: "claude", model: "claude-opus-5", why: "read-only question" }),
    readAskHistory: async () => [],
    askProvider: async (args) => { askCalls.push(args); return { status: "answered", answer: "ok" }; },
    appendAskHistoryEntry: async () => {}
  });
  await service.askQuestion({ cwd: "/repo", task: "hola" });
  assert.equal(askCalls[0].question, "hola");
});

test("REGRESSION: askQuestion persists only the real, original question — never the history-enriched prompt actually sent to the provider", async () => {
  const appendCalls = [];
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    inspectExecutionAdapters: () => [{ id: "claude", available: true, launchable: true, reason: null }],
    selectAskProvider: () => ({ decision: "ROUTED", provider: "claude", model: "claude-opus-5", why: "read-only question" }),
    readAskHistory: async () => [{ question: "prior q", answer: "prior a", provider: "claude", model: "claude-opus-5" }],
    askProvider: async () => ({ status: "answered", answer: "real answer" }),
    appendAskHistoryEntry: async (homeDirArg, projectRoot, entry) => { appendCalls.push(entry); }
  });
  await service.askQuestion({ cwd: "/repo", task: "the real question" });
  assert.deepEqual(appendCalls, [{ question: "the real question", answer: "real answer", provider: "claude", model: "claude-opus-5" }]);
});

test("clearTranscript also clears the ASK exchange history, so a cleared chat genuinely stops carrying prior context forward", async () => {
  const clearAskHistoryCalls = [];
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    clearTranscript: async () => {},
    clearAskHistory: async (homeDirArg, projectRoot) => { clearAskHistoryCalls.push(projectRoot); }
  });
  await service.clearTranscript({ cwd: "/repo" });
  assert.equal(clearAskHistoryCalls.length, 1);
});

test("REGRESSION: askQuestion routes through PROJECT TEAM's Explorer role when it's assigned to an ask-capable provider, never the generic heuristic", async () => {
  const explorerModel = { candidateKey: "claude::claude-opus-5", adapterId: "claude", modelId: "claude-opus-5", displayName: "Claude Opus 5", accessMode: "automatic" };
  const activeStrategy = { ...suggestedStrategyWithExplorer(explorerModel), status: "active" };
  const askCalls = [];
  const heuristicCalls = [];
  const service = createConversationService({
    resolveRoot: async () => "/repo", homeDir: "/home/test",
    readProjectStrategy: async () => activeStrategy,
    selectAskProvider: (args) => { heuristicCalls.push(args); return { decision: "NO_PROVIDER_AVAILABLE", provider: null, model: null, why: "should never be reached" }; },
    askProvider: async (args) => { askCalls.push(args); return { status: "answered", answer: "PROJECT TEAM answered." }; }
  });
  service.snapshot = async () => ({ modelIntelligence: { eligibility: { claude: { ok: true } } } });

  const answer = await service.askQuestion({ cwd: "/repo", task: "donde estamos parados?" });
  assert.equal(answer.provider, "claude");
  assert.equal(answer.model, "claude-opus-5");
  assert.equal(heuristicCalls.length, 0, "the generic heuristic must never run when PROJECT TEAM's Explorer is real and ask-capable");
  assert.deepEqual(askCalls[0].provider, "claude");
});

test("REGRESSION: askQuestion routes through PROJECT TEAM's Explorer role when it's assigned to Cursor — Cursor is now ask-capable via its real --mode ask", async () => {
  const explorerModel = { candidateKey: "cursor::gemini-3-flash-high", adapterId: "cursor", modelId: "gemini-3-flash-high", displayName: "Gemini 3 Flash", accessMode: "automatic" };
  const activeStrategy = { ...suggestedStrategyWithExplorer(explorerModel), status: "active" };
  const askCalls = [];
  const service = createConversationService({
    resolveRoot: async () => "/repo", homeDir: "/home/test",
    readProjectStrategy: async () => activeStrategy,
    askProvider: async (args) => { askCalls.push(args); return { status: "answered", answer: "Cursor answered." }; }
  });
  service.snapshot = async () => ({ modelIntelligence: { eligibility: { cursor: { ok: true } } } });

  const answer = await service.askQuestion({ cwd: "/repo", task: "donde estamos parados?" });
  assert.equal(answer.provider, "cursor");
  assert.equal(answer.model, "gemini-3-flash-high");
  assert.equal(askCalls[0].provider, "cursor");
});

test("REGRESSION: askQuestion falls back to the generic heuristic when Explorer is assigned to a provider ASK can't call", async () => {
  const explorerModel = { candidateKey: "future-adapter::future-model", adapterId: "future-adapter", modelId: "future-model", displayName: "Future Model", accessMode: "automatic" };
  const activeStrategy = { ...suggestedStrategyWithExplorer(explorerModel), status: "active" };
  const askCalls = [];
  const service = createConversationService({
    resolveRoot: async () => "/repo", homeDir: "/home/test",
    readProjectStrategy: async () => activeStrategy,
    inspectExecutionAdapters: () => [{ id: "claude", available: true, launchable: true, reason: null }],
    selectAskProvider: () => ({ decision: "ROUTED", provider: "claude", model: "claude-haiku-4-5", why: "read-only question (light effort)" }),
    askProvider: async (args) => { askCalls.push(args); return { status: "answered", answer: "Heuristic answered." }; }
  });
  service.snapshot = async () => ({ modelIntelligence: { eligibility: { "future-adapter": { ok: true } } } });

  const answer = await service.askQuestion({ cwd: "/repo", task: "donde estamos parados?" });
  assert.equal(answer.provider, "claude");
  assert.equal(askCalls[0].provider, "claude", "Explorer's real assignment isn't ask-capable, so the heuristic's pick must be used instead");
});

test("REGRESSION: askQuestion routes through PROJECT TEAM's Explorer role when it's assigned to OpenCode Go — Kairo's own real, verified read-only agent handles it", async () => {
  const explorerModel = { candidateKey: "opencode-go::kimi-k3", adapterId: "opencode-go", modelId: "kimi-k3", displayName: "Kimi K3", accessMode: "automatic" };
  const activeStrategy = { ...suggestedStrategyWithExplorer(explorerModel), status: "active" };
  const askCalls = [];
  const service = createConversationService({
    resolveRoot: async () => "/repo", homeDir: "/home/test",
    readProjectStrategy: async () => activeStrategy,
    askProvider: async (args) => { askCalls.push(args); return { status: "answered", answer: "OpenCode Go answered." }; }
  });
  service.snapshot = async () => ({ modelIntelligence: { eligibility: { "opencode-go": { ok: true } } } });

  const answer = await service.askQuestion({ cwd: "/repo", task: "donde estamos parados?" });
  assert.equal(answer.provider, "opencode-go");
  assert.equal(answer.model, "kimi-k3");
  assert.equal(askCalls[0].provider, "opencode-go");
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
    askProvider: async () => ({ status: "answered", answer: "It's an orchestrator." }),
    readAskHistory: async () => [], appendAskHistoryEntry: async () => {}
  });
  await service.askQuestion({ cwd: "/repo", task: "what is this project about?" });
  assert.deepEqual(routeCalls, ["what is this project about?"]);
});

// The four legacy no-role/free-agentId execution tests that used to live
// here (planExecution previewing the keyword router, executePlan auto-
// routing via selectExecutionProvider, refusing a WAIT_FOR_APPROVAL
// decision, and an explicit agentId bypassing the router) were removed —
// that whole path no longer exists. PROJECT TEAM (resolveProjectRoute) is
// now the sole authority; see "planExecution rejects a missing role
// outright" and "executePlan rejects a missing confirmationTarget
// outright" above, and the planExecution({role})/executePlan({confirmationTarget})
// regressions below, for the real replacement coverage.

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
    readCodexModels: async () => ({ status: "unknown", models: [] }),
    readOpenCodeModels: async () => ({ status: "unknown", models: [] }),
    readCursorModels: async () => ({ status: "unknown", models: [] }),
    readArtificialAnalysisModels: async () => ({ status: "unknown", source: null, age: null, models: [] }),
    readHuggingFaceLeaderboard: async () => ({ status: "unknown", source: null, fetchedAt: null, age: null, entries: [], error: "not mocked" }),
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

// --- PROJECT TEAM execution routing: planExecution/executePlan wired to
// resolveProjectRoute, replacing the legacy classifier for the role-based
// path. `service.snapshot` is overridden directly (same trick the
// getProjectTeamEditCatalog tests above use) so these tests control
// `modelIntelligence.eligibility` without driving the real provider-probe
// pipeline.

const AUTOMATIC_MODEL = { candidateKey: "codex::gpt-6-astra", adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra", accessMode: "automatic" };
const MANUAL_MODEL = { candidateKey: "opencode-go::go-model", adapterId: "opencode-go", modelId: "go-model", displayName: "GLM Go Model", accessMode: "manual" };
const ALTERNATIVE_MODEL = { candidateKey: "claude::claude-opus-5", adapterId: "claude", modelId: "claude-opus-5", displayName: "Claude Opus 5", accessMode: "automatic" };

function activeStrategyWithBuilder({ model, fallback = null, assignmentSource = "recommended", fingerprint = "fp-1" } = {}) {
  return {
    schema: "kairo.project-strategy/v1", status: "active", profileFingerprint: fingerprint, activeRoles: ["Builder"],
    projectTeam: [{
      role: "Builder", model, fallback, decisionEvidence: null, assignmentSource,
      recommendedAssignment: { model, fallback, decisionEvidence: null }, overrideEvidence: null
    }]
  };
}

function refusingLegacyRouter() {
  return () => { throw new Error("the legacy text-classification router must never be called on the role-based path"); };
}

function serviceWithEligibility(overrides, eligibility) {
  const service = createConversationService({
    resolveRoot: async () => "/repo", homeDir: "/home/test",
    selectExecutionProvider: refusingLegacyRouter(),
    ...overrides
  });
  const realSnapshot = service.snapshot.bind(service);
  service.snapshot = async (args) => {
    const snap = await realSnapshot(args);
    return { ...snap, modelIntelligence: { ...snap.modelIntelligence, eligibility } };
  };
  return service;
}

test("planExecution({role}) calls resolveProjectRoute and never the legacy classifier, returning a ROUTED ProjectExecutionPreview with a confirmable target", async () => {
  const record = { status: {}, taskMarkdown: "irrelevant text — role decides, never text", planMarkdown: "# Plan" };
  const strategy = activeStrategyWithBuilder({ model: AUTOMATIC_MODEL });
  const service = serviceWithEligibility({
    readPlan: async () => record,
    readProjectStrategy: async () => strategy
  }, { codex: { ok: true } });

  const preview = await service.planExecution({ cwd: "/repo", taskId: "task-id", role: "Builder" });
  assert.equal(preview.decision, "ROUTED");
  assert.equal(preview.role, "Builder");
  assert.equal(preview.provider, "codex");
  assert.equal(preview.model, "gpt-6-astra");
  assert.equal(preview.modelRef, AUTOMATIC_MODEL);
  assert.equal(preview.strategyFingerprint, "fp-1");
  assert.deepEqual(preview.confirmationTarget, {
    role: "Builder", selection: "assigned", strategyFingerprint: "fp-1", candidateKey: "codex::gpt-6-astra"
  });
  assert.equal(preview.taskPrompt, null, "a ROUTED preview never needs a copy-paste task prompt — executePlan builds the real task text itself when it actually launches");
});

test("planExecution({role}) returns WAIT_FOR_PROJECT_TEAM with no confirmationTarget when there is no active strategy", async () => {
  const record = { status: {}, taskMarkdown: "text", planMarkdown: "# Plan" };
  const service = serviceWithEligibility({
    readPlan: async () => record,
    readProjectStrategy: async () => null
  }, {});
  const preview = await service.planExecution({ cwd: "/repo", taskId: "task-id", role: "Builder" });
  assert.equal(preview.decision, "WAIT_FOR_PROJECT_TEAM");
  assert.equal(preview.confirmationTarget, null);
  assert.match(preview.why, /No project strategy/);
});

test("planExecution({role}) returns WAIT_FOR_PROJECT_TEAM for a merely SUGGESTED (not yet approved) strategy", async () => {
  const record = { status: {}, taskMarkdown: "text", planMarkdown: "# Plan" };
  const strategy = { ...activeStrategyWithBuilder({ model: AUTOMATIC_MODEL }), status: "suggested" };
  const service = serviceWithEligibility({
    readPlan: async () => record,
    readProjectStrategy: async () => strategy
  }, { codex: { ok: true } });
  const preview = await service.planExecution({ cwd: "/repo", taskId: "task-id", role: "Builder" });
  assert.equal(preview.decision, "WAIT_FOR_PROJECT_TEAM");
  assert.equal(preview.confirmationTarget, null);
  assert.match(preview.why, /SUGGESTED/);
});

test("planExecution({role}) returns WAIT_FOR_PROJECT_TEAM for a STALE strategy", async () => {
  const record = { status: {}, taskMarkdown: "text", planMarkdown: "# Plan" };
  const strategy = { ...activeStrategyWithBuilder({ model: AUTOMATIC_MODEL }), status: "stale" };
  const service = serviceWithEligibility({
    readPlan: async () => record,
    readProjectStrategy: async () => strategy
  }, { codex: { ok: true } });
  const preview = await service.planExecution({ cwd: "/repo", taskId: "task-id", role: "Builder" });
  assert.equal(preview.decision, "WAIT_FOR_PROJECT_TEAM");
  assert.equal(preview.confirmationTarget, null);
  assert.match(preview.why, /STALE/);
});

test("planExecution({role}) returns MANUAL_HANDOFF for an OpenCode Go assignment, with no confirmationTarget — never auto-executable", async () => {
  const record = { status: {}, taskMarkdown: "text", planMarkdown: "# Plan" };
  const strategy = activeStrategyWithBuilder({ model: MANUAL_MODEL });
  const service = serviceWithEligibility({
    readPlan: async () => record,
    readProjectStrategy: async () => strategy
  }, { "opencode-go": { ok: true } });
  const preview = await service.planExecution({ cwd: "/repo", taskId: "task-id", role: "Builder" });
  assert.equal(preview.decision, "MANUAL_HANDOFF");
  assert.equal(preview.provider, "opencode-go");
  assert.equal(preview.confirmationTarget, null);
  assert.match(preview.why, /continue manually/);
  assert.match(preview.taskPrompt, /# Plan/, "a MANUAL_HANDOFF preview must include the real, ready-to-paste task text — never just the model name");
  assert.match(preview.taskPrompt, /Implement the explicitly approved architecture plan/, "must be the exact same real task text executePlan would have used for a real automatic run — never a second, invented formula");
});

test("planExecution({role}) shows a persisted, currently-eligible fallback as suggestedAlternative when the assigned candidate lost eligibility — offered for confirmation, never auto-executed by the preview itself", async () => {
  const record = { status: {}, taskMarkdown: "text", planMarkdown: "# Plan" };
  const strategy = activeStrategyWithBuilder({ model: AUTOMATIC_MODEL, fallback: ALTERNATIVE_MODEL });
  let reserved = false;
  let launched = false;
  const service = serviceWithEligibility({
    readPlan: async () => record,
    readProjectStrategy: async () => strategy,
    writeExecution: async () => { reserved = true; },
    startRun: async () => { launched = true; return { metadata: {} }; }
  }, { codex: { ok: false, reason: "quota exhausted" }, claude: { ok: true } });

  const preview = await service.planExecution({ cwd: "/repo", taskId: "task-id", role: "Builder" });
  assert.equal(preview.decision, "WAIT_FOR_PROJECT_TEAM");
  assert.equal(preview.blockedAssignment.provider, "codex");
  assert.equal(preview.suggestedAlternative.provider, "claude");
  assert.deepEqual(preview.confirmationTarget, {
    role: "Builder", selection: "suggested-alternative", strategyFingerprint: "fp-1", candidateKey: "claude::claude-opus-5"
  });
  assert.equal(reserved, false, "a preview must never reserve quota");
  assert.equal(launched, false, "a preview must never start a run — a suggested alternative is never equivalent to authorization to run it");
});

test("executePlan rejects a confirmationTarget whose candidate no longer matches the freshly recomputed route (eligibility changed since preview) — never silently substitutes", async () => {
  const record = { status: {}, taskMarkdown: "text", planMarkdown: "# Plan" };
  const strategy = activeStrategyWithBuilder({ model: AUTOMATIC_MODEL });
  let launched = false;
  const service = serviceWithEligibility({
    verifyExecution: async () => record,
    readExecution: async () => null,
    readProjectStrategy: async () => strategy,
    startRun: async () => { launched = true; return { metadata: {} }; }
  }, { codex: { ok: false, reason: "quota exhausted since the preview was shown" } });

  await assert.rejects(
    () => service.executePlan({
      cwd: "/repo", taskId: "task-id",
      confirmationTarget: { role: "Builder", selection: "assigned", strategyFingerprint: "fp-1", candidateKey: "codex::gpt-6-astra" }
    }),
    /project team state changed/
  );
  assert.equal(launched, false);
});

test("executePlan rejects a confirmationTarget whose strategyFingerprint is stale — re-approving the strategy must force a new preview", async () => {
  const record = { status: {}, taskMarkdown: "text", planMarkdown: "# Plan" };
  const strategy = activeStrategyWithBuilder({ model: AUTOMATIC_MODEL, fingerprint: "fp-2" });
  let launched = false;
  const service = serviceWithEligibility({
    verifyExecution: async () => record,
    readExecution: async () => null,
    readProjectStrategy: async () => strategy,
    startRun: async () => { launched = true; return { metadata: {} }; }
  }, { codex: { ok: true } });

  await assert.rejects(
    () => service.executePlan({
      cwd: "/repo", taskId: "task-id",
      confirmationTarget: { role: "Builder", selection: "assigned", strategyFingerprint: "fp-1", candidateKey: "codex::gpt-6-astra" }
    }),
    /project team state changed/
  );
  assert.equal(launched, false);
});

test("executePlan with a matching confirmationTarget revalidates, reserves, and launches exactly once against the resolved candidate", async () => {
  const record = { status: {}, taskMarkdown: "text", planMarkdown: "# Approved plan" };
  const strategy = activeStrategyWithBuilder({ model: AUTOMATIC_MODEL });
  let link = null;
  const service = serviceWithEligibility({
    verifyExecution: async () => record,
    createRunId: () => "run_fixed",
    readExecution: async () => link,
    writeExecution: async (_root, _id, value) => { link = value; },
    updateExecution: async (_root, _id, value) => { link = value; },
    readProjectStrategy: async () => strategy,
    startRun: async (input) => {
      assert.equal(input.agentId, "codex");
      assert.equal(input.model, "gpt-6-astra");
      return { metadata: { state: "starting", startedAt: "now", updatedAt: "now" } };
    }
  }, { codex: { ok: true } });

  const confirmationTarget = { role: "Builder", selection: "assigned", strategyFingerprint: "fp-1", candidateKey: "codex::gpt-6-astra" };
  const first = await service.executePlan({ cwd: "/repo", taskId: "task-id", confirmationTarget });
  const retry = await service.executePlan({ cwd: "/repo", taskId: "task-id", confirmationTarget });
  assert.equal(first.execution.provider, "codex");
  assert.equal(first.execution.state, "starting");
  assert.equal(retry.reused, true, "the same confirmed target must only ever start one run");
});

test("REGRESSION: executePlan actually launches a real Cursor run — Cursor is a real automatic candidate now, not manual-only", async () => {
  const record = { status: {}, taskMarkdown: "text", planMarkdown: "# Approved plan" };
  const cursorAutomaticModel = { candidateKey: "cursor::gpt-5.6-sol", adapterId: "cursor", modelId: "gpt-5.6-sol", displayName: "GPT-5.6 Sol", accessMode: "automatic" };
  const strategy = activeStrategyWithBuilder({ model: cursorAutomaticModel });
  let link = null;
  const service = serviceWithEligibility({
    verifyExecution: async () => record,
    createRunId: () => "run_fixed",
    readExecution: async () => link,
    writeExecution: async (_root, _id, value) => { link = value; },
    updateExecution: async (_root, _id, value) => { link = value; },
    readProjectStrategy: async () => strategy,
    startRun: async (input) => {
      assert.equal(input.agentId, "cursor");
      assert.equal(input.model, "gpt-5.6-sol");
      return { metadata: { state: "starting", startedAt: "now", updatedAt: "now" } };
    }
  }, { cursor: { ok: true } });

  const confirmationTarget = { role: "Builder", selection: "assigned", strategyFingerprint: "fp-1", candidateKey: "cursor::gpt-5.6-sol" };
  const result = await service.executePlan({ cwd: "/repo", taskId: "task-id", confirmationTarget });
  assert.equal(result.execution.provider, "cursor");
  assert.equal(result.execution.state, "starting");
});

test("REGRESSION: executePlan launches OpenCode Go with the real, fully-qualified 'opencode-go/<id>' model ref — the real catalog only ever stores the bare id, and a bare id is exactly the Go/Zen routing ambiguity Kairo must never risk", async () => {
  const record = { status: {}, taskMarkdown: "text", planMarkdown: "# Approved plan" };
  const goModel = { candidateKey: "opencode-go::deepseek-v4-flash", adapterId: "opencode-go", modelId: "deepseek-v4-flash", displayName: "DeepSeek V4 Flash", accessMode: "automatic" };
  const strategy = activeStrategyWithBuilder({ model: goModel });
  let link = null;
  const service = serviceWithEligibility({
    verifyExecution: async () => record,
    createRunId: () => "run_fixed",
    readExecution: async () => link,
    writeExecution: async (_root, _id, value) => { link = value; },
    updateExecution: async (_root, _id, value) => { link = value; },
    readProjectStrategy: async () => strategy,
    startRun: async (input) => {
      assert.equal(input.agentId, "opencode-go");
      assert.equal(input.model, "opencode-go/deepseek-v4-flash", "the bare catalog id must be prefixed before it ever reaches the CLI");
      return { metadata: { state: "starting", startedAt: "now", updatedAt: "now" } };
    }
  }, { "opencode-go": { ok: true } });

  const confirmationTarget = { role: "Builder", selection: "assigned", strategyFingerprint: "fp-1", candidateKey: "opencode-go::deepseek-v4-flash" };
  const result = await service.executePlan({ cwd: "/repo", taskId: "task-id", confirmationTarget });
  assert.equal(result.execution.provider, "opencode-go");
  assert.equal(result.execution.state, "starting");
});

test("executePlan with a confirmationTarget selecting the suggested alternative launches on the alternative, never the blocked assignment", async () => {
  const record = { status: {}, taskMarkdown: "text", planMarkdown: "# Approved plan" };
  const strategy = activeStrategyWithBuilder({ model: AUTOMATIC_MODEL, fallback: ALTERNATIVE_MODEL });
  let link = null;
  const service = serviceWithEligibility({
    verifyExecution: async () => record,
    createRunId: () => "run_fixed",
    readExecution: async () => link,
    writeExecution: async (_root, _id, value) => { link = value; },
    updateExecution: async (_root, _id, value) => { link = value; },
    readProjectStrategy: async () => strategy,
    startRun: async (input) => {
      assert.equal(input.agentId, "claude");
      assert.equal(input.model, "claude-opus-5");
      return { metadata: { state: "starting", startedAt: "now", updatedAt: "now" } };
    }
  }, { codex: { ok: false, reason: "quota exhausted" }, claude: { ok: true } });

  const confirmationTarget = { role: "Builder", selection: "suggested-alternative", strategyFingerprint: "fp-1", candidateKey: "claude::claude-opus-5" };
  const result = await service.executePlan({ cwd: "/repo", taskId: "task-id", confirmationTarget });
  assert.equal(result.execution.provider, "claude");
});

// --- readRunTranscript: tailing a real run's own "run.transcript" events
// for the cockpit's live streaming display.

test("readRunTranscript returns only new real transcript entries since sinceIndex, with each real provider attributed from the event itself", async () => {
  const events = [
    { type: "run.started", source: "kairo", timestamp: "t0", data: {} },
    { type: "run.transcript", source: "codex", timestamp: "t1", data: { text: "Reading the failing test…" } },
    { type: "agent.tool_call", source: "codex", timestamp: "t2", data: {} },
    { type: "run.transcript", source: "codex", timestamp: "t3", data: { content: [{ type: "text", text: "Found it — fixing now." }] } }
  ];
  const service = createConversationService({ readRunEvents: async () => events });

  const first = await service.readRunTranscript({ runId: "run_1" });
  assert.equal(first.nextIndex, 2, "two real run.transcript events exist so far");
  assert.deepEqual(first.entries, [
    { provider: "codex", timestamp: "t1", text: "Reading the failing test…" },
    { provider: "codex", timestamp: "t3", text: "Found it — fixing now." }
  ]);

  events.push({ type: "run.transcript", source: "codex", timestamp: "t4", data: { text: "Tests pass." } });
  const second = await service.readRunTranscript({ runId: "run_1", sinceIndex: first.nextIndex });
  assert.equal(second.nextIndex, 3);
  assert.deepEqual(second.entries, [{ provider: "codex", timestamp: "t4", text: "Tests pass." }]);
});

test("readRunTranscript attributes each real event to its own real provider — multiple providers/runs never collapse into one label", async () => {
  const events = [
    { type: "run.transcript", source: "codex", timestamp: "t1", data: { text: "Codex output" } },
    { type: "run.transcript", source: "claude", timestamp: "t2", data: { text: "Claude output" } }
  ];
  const service = createConversationService({ readRunEvents: async () => events });
  const result = await service.readRunTranscript({ runId: "run_multi" });
  assert.deepEqual(result.entries.map((e) => e.provider), ["codex", "claude"]);
});

test("readRunTranscript returns an empty entries list for a run with no real transcript events yet, without throwing", async () => {
  const service = createConversationService({ readRunEvents: async () => [{ type: "run.started", source: "kairo", data: {} }] });
  const result = await service.readRunTranscript({ runId: "run_quiet" });
  assert.deepEqual(result, { runId: "run_quiet", nextIndex: 0, entries: [] });
});

test("buildClaudeEntitlementVerifyCostStatement names the measured economy before any spawn", () => {
  const statement = buildClaudeEntitlementVerifyCostStatement({ pendingCount: 3 });
  assert.match(statement, /3/);
  assert.match(statement, /\$0/);
  assert.match(statement, /cent/i);
});

test("buildUnverifiedClaudePreflightNotice is the measured one-line Spanish notice", () => {
  const notice = buildUnverifiedClaudePreflightNotice(2);
  assert.match(notice, /^2 modelos de Claude tienen acceso sin verificar/);
  assert.match(notice, /\/models --verify-access/);
  assert.match(notice, /\$0/);
  assert.match(notice, /centavo/);
});

test("REGRESSION: a real /models --verify-access result reaches the very next snapshot() in the same session, never stuck behind the 10-minute in-memory entitlement cache", async () => {
  // A real, stateful fake disk — writeClaudeEntitlementCache actually
  // updates what readClaudeEntitlementCache returns next, exactly like
  // the real filesystem does. Without cache invalidation, snapshot()'s
  // own in-memory readClaudeEntitlementCacheCached (10-minute TTL) would
  // keep serving the pre-verification read even though the real disk
  // file changed moments ago, in the same long-running session.
  let diskDoc = null;
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/kal-el",
    enableProviderProbes: true,
    listPlans: async () => [],
    recoverRuns: async () => {},
    inspectExecutionAdapters: () => [{ id: "claude", available: true, launchable: true, reason: null }],
    inspectEngramIntegration: () => ({ status: "configured" }),
    readCodexUsage: async () => null,
    readClaudeUsage: async () => null,
    verifyClaudeSubscriptionAuth: async () => ({ mode: "subscription", subscriptionType: "pro" }),
    readClaudeEntitlementCache: async () => diskDoc,
    writeClaudeEntitlementCache: async (_homeDir, doc) => { diskDoc = doc; },
    readCodexModels: async () => ({ status: "measured", models: [] }),
    readClaudeModels: () => ({ status: "documented", models: [{ id: "claude-newly-allowed" }] }),
    readOpenCodeModels: async () => ({ status: "measured", models: [] }),
    readCursorModels: async () => ({ status: "measured", models: [] }),
    probeClaudeModelEntitlements: async ({ modelIds }) => modelIds.map((modelId) => ({
      modelId, status: ENTITLEMENT.ALLOWED, reason: null, probedAt: new Date().toISOString()
    })),
    readArtificialAnalysisModels: async () => ({ status: "live", source: "artificial-analysis api v2 (data/llms/models)", age: "<1h", models: [] }),
    readHuggingFaceLeaderboard: async () => ({ status: "unknown", source: null, fetchedAt: null, age: null, entries: [], error: "not mocked" }),
    listRunRecords: async () => []
  });

  // First snapshot populates the in-memory cache with "nothing verified yet".
  const before = await service.snapshot({ cwd: "/repo" });
  assert.equal(before.modelIntelligence.claudeEntitlement["claude-newly-allowed"].status, ENTITLEMENT.UNVERIFIED);

  // A real verify-access sweep persists ALLOWED for this model.
  await service.verifyClaudeEntitlements({ cwd: "/repo", refresh: false });

  // The very next snapshot, same session, must see it — never the stale
  // in-memory read from before verification.
  const after = await service.snapshot({ cwd: "/repo" });
  assert.equal(after.modelIntelligence.claudeEntitlement["claude-newly-allowed"].status, ENTITLEMENT.ALLOWED);
});

test("verifyClaudeEntitlements without refresh only probes unverified or TTL-expired ids", async () => {
  const probed = [];
  const nowMs = Date.parse("2026-09-19T12:00:00.000Z");
  const freshProbedAt = new Date(nowMs - 60_000).toISOString();
  const expiredProbedAt = new Date(nowMs - DEFAULT_ENTITLEMENT_TTL_MS - 1).toISOString();
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/kal-el",
    now: () => nowMs,
    readClaudeModels: () => ({
      status: "documented",
      models: [
        { id: "claude-allowed-fresh" },
        { id: "claude-expired" },
        { id: "claude-never-probed" },
        { id: "claude-denied-fresh" }
      ]
    }),
    verifyClaudeSubscriptionAuth: async () => ({ mode: "subscription", subscriptionType: "pro" }),
    readClaudeEntitlementCache: async () => ({
      subscriptionType: "pro",
      fetchedAt: freshProbedAt,
      models: {
        "claude-allowed-fresh": { status: ENTITLEMENT.ALLOWED, reason: null, probedAt: freshProbedAt },
        "claude-expired": { status: ENTITLEMENT.ALLOWED, reason: null, probedAt: expiredProbedAt },
        "claude-denied-fresh": { status: ENTITLEMENT.DENIED, reason: "credits_required", probedAt: freshProbedAt }
      }
    }),
    probeClaudeModelEntitlements: async ({ modelIds }) => {
      probed.push(...modelIds);
      return modelIds.map((modelId) => ({
        modelId,
        status: ENTITLEMENT.ALLOWED,
        reason: null,
        probedAt: new Date(nowMs).toISOString()
      }));
    },
    writeClaudeEntitlementCache: async () => {}
  });

  const summary = await service.verifyClaudeEntitlements({ cwd: "/repo", refresh: false });
  assert.deepEqual(probed.sort(), ["claude-expired", "claude-never-probed"]);
  assert.equal(summary.probed.length, 2);
  assert.equal(probed.length, 2, "fresh allowed/denied must not be re-probed without --refresh");
});

test("verifyClaudeEntitlements with refresh probes all catalog ids (capped at maxProbes=12)", async () => {
  const probed = [];
  const catalog = Array.from({ length: 15 }, (_, i) => ({ id: `claude-model-${i}` }));
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/kal-el",
    readClaudeModels: () => ({ status: "documented", models: catalog }),
    verifyClaudeSubscriptionAuth: async () => ({ mode: "subscription", subscriptionType: "pro" }),
    readClaudeEntitlementCache: async () => null,
    probeClaudeModelEntitlements: async ({ modelIds, maxProbes }) => {
      assert.equal(maxProbes, 12);
      probed.push(...modelIds);
      return modelIds.map((modelId) => ({
        modelId,
        status: ENTITLEMENT.DENIED,
        reason: "credits_required",
        probedAt: new Date().toISOString()
      }));
    },
    writeClaudeEntitlementCache: async () => {}
  });

  await service.verifyClaudeEntitlements({ cwd: "/repo", refresh: true });
  assert.equal(probed.length, 12, "refresh still respects maxProbes=12");
  assert.deepEqual(probed, catalog.slice(0, 12).map((m) => m.id));
});

test("verifyClaudeEntitlements cost-statement contract: beforeProbe runs before any probe spawn", async () => {
  const order = [];
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/kal-el",
    readClaudeModels: () => ({ status: "documented", models: [{ id: "claude-haiku-4-5" }] }),
    verifyClaudeSubscriptionAuth: async () => ({ mode: "subscription", subscriptionType: "pro" }),
    readClaudeEntitlementCache: async () => null,
    probeClaudeModelEntitlements: async ({ modelIds }) => {
      order.push("probe");
      return modelIds.map((modelId) => ({
        modelId,
        status: ENTITLEMENT.ALLOWED,
        reason: null,
        probedAt: new Date().toISOString()
      }));
    },
    writeClaudeEntitlementCache: async () => {}
  });

  const statement = buildClaudeEntitlementVerifyCostStatement({ pendingCount: 1 });
  const summary = await service.verifyClaudeEntitlements({
    cwd: "/repo",
    refresh: false,
    beforeProbe: ({ costStatement, pendingCount }) => {
      order.push("cost");
      assert.equal(pendingCount, 1);
      assert.equal(costStatement, statement);
    }
  });
  assert.deepEqual(order, ["cost", "probe"]);
  assert.equal(summary.costStatement, statement);
});

test("verifyClaudeEntitlements does not persist evidence when every probe result is unverified", async () => {
  let writeCalls = 0;
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/kal-el",
    readClaudeModels: () => ({ status: "documented", models: [{ id: "a" }, { id: "b" }] }),
    verifyClaudeSubscriptionAuth: async () => ({ mode: "subscription", subscriptionType: "pro" }),
    readClaudeEntitlementCache: async () => null,
    probeClaudeModelEntitlements: async ({ modelIds }) => modelIds.map((modelId) => ({
      modelId,
      status: ENTITLEMENT.UNVERIFIED,
      reason: "529 overloaded",
      probedAt: new Date().toISOString()
    })),
    writeClaudeEntitlementCache: async () => { writeCalls += 1; }
  });

  const summary = await service.verifyClaudeEntitlements({ cwd: "/repo", refresh: false });
  assert.equal(writeCalls, 0, "all-unverified sweep must not write the entitlement cache");
  assert.equal(summary.persisted, false);
});

test("preflightProject surfaces the unverified Claude notice when live entitlement has unverified models", async () => {
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/test",
    computeProjectProfile: async () => ({ fingerprint: "fp-1", roleRequirements: [] }),
    writeProjectStrategy: async () => {}
  });
  service.snapshot = async () => ({
    modelIntelligence: {
      ...(await realScoredCandidates()),
      claudeEntitlement: {
        "claude-a": { status: ENTITLEMENT.UNVERIFIED, reason: null },
        "claude-b": { status: ENTITLEMENT.ALLOWED, reason: null },
        "claude-c": { status: ENTITLEMENT.UNVERIFIED, reason: null }
      }
    }
  });
  const result = await service.preflightProject({ cwd: "/repo" });
  assert.equal(result.unverifiedClaudeNotice, buildUnverifiedClaudePreflightNotice(2));
});
