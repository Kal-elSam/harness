import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("submitTask's explicit WorkMode overrides the isLikelyQuestion guess — ASK never creates a plan, even for a clear change request", async () => {
  const askCalls = [];
  const planCalls = [];
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    inspectExecutionAdapters: () => [{ id: "claude", available: true, launchable: true, reason: null }],
    selectAskProvider: () => ({ decision: "ROUTED", provider: "claude", model: null }),
    askProvider: async (args) => { askCalls.push(args); return { status: "answered", answer: "Real answer.", error: null }; },
    createPlan: async (args) => { planCalls.push(args); return { status: {}, reused: false }; }
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

test("preflightProject computes a real read-only ProjectProfile and real Bootstrap Analyst alternatives, never touching persistence", async () => {
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
  assert.ok(result.alternatives.length >= 1);
  assert.equal(wrote, false, "preflight must never persist a ProjectStrategy");
  // analystCatalog: the fuller real catalog (additive — existing
  // alternatives stays unchanged for today's overlay/analyst-run callers).
  assert.ok(result.analystCatalog, "preflight must also expose the full real analyst catalog");
  assert.ok(result.analystCatalog.recommendedModel);
  assert.equal(result.analystCatalog.models.length, 2, "both real ask-supported candidates from realScoredCandidates() must appear");
});

test("runBootstrapAnalysis runs the real chosen model read-only against a SANITIZED SNAPSHOT (never the real cwd), validates its response, and only then builds + persists a SUGGESTED ProjectStrategy genuinely re-scored per its real, evidence-backed findings", async () => {
  let written = null;
  const askCalls = [];
  let cleanedUp = false;
  const service = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/test",
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
  // Coverage/confidence: real catalog status + how much of it matched AA,
  // independent of runtime eligibility — Claude stays "documented" (no
  // live per-account discovery exists), Codex is "measured".
  const codexCoverage = snapshot.modelIntelligence.coverage.find((c) => c.adapterId === "codex");
  const claudeCoverage = snapshot.modelIntelligence.coverage.find((c) => c.adapterId === "claude");
  assert.deepEqual(codexCoverage, { adapterId: "codex", catalogStatus: "measured", totalModels: 1, matchedModels: 1 });
  assert.deepEqual(claudeCoverage, { adapterId: "claude", catalogStatus: "documented", totalModels: 1, matchedModels: 1 });
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
    listRunRecords: async () => []
  });

  const snapshot = await service.snapshot({ cwd: "/repo" });
  assert.deepEqual(snapshot.modelIntelligence.models.map((m) => m.adapterId), ["codex"]);
  assert.equal(snapshot.modelIntelligence.eligibility.claude.ok, false);
  assert.match(snapshot.modelIntelligence.eligibility.claude.reason, /nearly exhausted/);
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

test("snapshot lets AI TEAM recommend a real, accessible opencode-go model even though it isn't launchable yet", async () => {
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
      // structured events) but not launchable — blocked pending
      // provider-isolation proof between Go and Zen.
      { id: "opencode", available: true, launchable: false, reason: "blocked pending provider-isolation proof" }
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
    readCursorModels: async () => ({ status: "measured", models: [{ id: "composer-2.5", displayName: "Composer 2.5" }] }),
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
