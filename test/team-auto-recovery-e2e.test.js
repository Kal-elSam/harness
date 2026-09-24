// End-to-end: OpenCode Go hits a window limit while Codex and Claude stay
// available. Real pieces: the Pi extension, the conversation service's
// recoverProjectTeam -> runTeamRecovery, the real availability fingerprint,
// store logic, and route loader (loadKairoProviderModels). Faked: provider
// probes (the snapshot's eligibility), the analyst's answer, and storage
// (one in-memory store shared by the service and the Pi route loader).
import test from "node:test";
import assert from "node:assert/strict";
import { createKairoWorkspaceExtension } from "../src/global/host/extension/index.js";
import { loadKairoProviderModels } from "../src/global/host/kairo-route-provider.js";
import { buildKairoWorkspaceSnapshot, recoverKairoProjectTeam } from "../src/global/host/workspace-snapshot.js";
import { createConversationService } from "../src/global/conversation/service.js";
import { scoreAvailableModels } from "../src/global/intelligence/model-intelligence.js";
import { createCapabilityRegistry } from "../src/global/intelligence/model-capability-registry.js";

const GO_LIMIT = { provider: "opencode-go", window: "monthly", remainingPercent: 0, resetsAt: "2026-10-01T00:00:00Z" };
const ELIGIBILITY = {
  codex: { ok: true, reason: null },
  claude: { ok: true, reason: null },
  "opencode-go": { ok: false, reason: "OpenCode Go monthly window is rate-limited (resets 2026-10-01T00:00:00Z)", limit: GO_LIMIT }
};
const GO_MODEL = { candidateKey: "opencode-go::glm-5-3", adapterId: "opencode-go", modelId: "glm-5-3", displayName: "GLM-5.3", accessMode: "automatic" };
const PROFILE = {
  projectName: "repo", stack: ["Node.js"], architecture: { pattern: "x" },
  quality: { buildCommand: null, testCommand: null, lintCommand: null, typeCheckCommand: null },
  hotspots: [], workflowCapabilities: [], risks: [], fingerprint: "fp-2",
  roleRequirements: [{ role: "Explorer", capabilities: ["reasoning"], reason: "" }]
};

function scenario() {
  const store = {
    strategy: {
      status: "active", profileFingerprint: "fp-1", approvedAt: "2026-09-01T00:00:00.000Z",
      orchestrator: null, bootstrapAnalyst: null,
      projectTeam: [{ role: "Explorer", model: GO_MODEL, fallback: null, assignmentSource: "recommended" }]
    },
    recovery: null,
    analyses: 0
  };
  const scoredAll = scoreAvailableModels([
    { adapterId: "codex", models: [{ id: "codex-model" }] },
    { adapterId: "claude", models: [{ id: "claude-model" }] }
  ], [
    { slug: "codex-model", name: "Codex Model", intelligenceIndex: 90, codingIndex: 40, mathIndex: null },
    { slug: "claude-model", name: "Claude Model", intelligenceIndex: 40, codingIndex: 90, mathIndex: null }
  ]).map((model) => ({ ...model, accessMode: "automatic" }));
  const modelIntelligence = { scoredAll, eligibility: ELIGIBILITY, registry: createCapabilityRegistry(), providerCapacity: null };

  const createService = () => {
    const service = createConversationService({
      resolveRoot: async () => "/repo",
      homeDir: "/home/test",
      computeProjectProfile: async () => PROFILE,
      readProjectStrategy: async () => store.strategy,
      writeProjectStrategy: async (_home, _root, strategy) => { store.strategy = strategy; return strategy; },
      readAvailabilityRecovery: async () => store.recovery,
      writeAvailabilityRecovery: async (_home, _root, record) => { store.recovery = { ...record, updatedAt: new Date().toISOString() }; return store.recovery; },
      acquireProjectAnalysisLock: async () => ({ acquired: true, release: async () => {} }),
      buildSanitizedSnapshot: async () => ({ snapshotRoot: "/tmp/snap", filesCopied: 0, secretsRedacted: 0, copiedFiles: [], excludedPrivatePaths: [], cleanup: async () => {} }),
      createBootstrapAnalyzerAdapter: () => ({
        checkEligibility: async () => ({ eligible: true, isolation: "verified" }),
        analyze: async () => {
          store.analyses += 1;
          return { status: "answered", answer: JSON.stringify({ architectureTraits: [], complexitySignals: [], criticalAreas: [], contextNeeds: [], workflowNeeds: [], recommendedRoleNeeds: [], uncertainties: [], evidenceReferences: [] }) };
        }
      })
    });
    service.snapshot = async () => ({ modelIntelligence });
    return service;
  };

  const { pi, providers, events } = fakePi();
  const extension = createKairoWorkspaceExtension(pi, {
    loadSnapshot: async ({ availabilityIntelligence }) => buildKairoWorkspaceSnapshot({
      projectRoot: "/repo", strategy: store.strategy, usageIntelligence: {}, availabilityIntelligence
    }),
    loadUsageData: async () => ({ usage: {}, providers: {} }),
    loadLiveData: async () => ({ eligibility: ELIGIBILITY, claudeEntitlement: {}, cursorAccess: {} }),
    loadRouteModels: (args) => loadKairoProviderModels(args, {
      resolveProjectRoot: async () => "/repo",
      resolveHomeDir: () => "/home/test",
      readProjectStrategy: async () => store.strategy,
      resolveAdapter: () => ({ availability: () => ({ launchable: true }) })
    }),
    createProvider: ({ models }) => ({ models }),
    recoverTeam: (args) => recoverKairoProjectTeam(args, { createConversationService: createService })
  });
  const notifications = [];
  const ctx = { cwd: "/repo", ui: { setStatus: () => {}, setWidget: () => {}, notify: (...args) => notifications.push(args) } };
  return { store, providers, events, extension, notifications, ctx };
}

function fakePi() {
  const providers = new Map();
  const events = new Map();
  return {
    providers,
    events,
    pi: {
      registerCommand() {},
      registerProvider(name, definition) { providers.set(name, definition); },
      unregisterProvider(name) { providers.delete(name); },
      on(name, handler) { events.set(name, handler); }
    }
  };
}

test("E2E: Go limited with Codex/Claude available — no new Go assignment, the recovered team is active, and Pi routes resolve to it", async () => {
  const { store, providers, events, extension, notifications, ctx } = scenario();

  await events.get("session_start")({}, ctx);
  assert.deepEqual(providers.get("kairo").models.map((model) => model.kairoRoute.adapterId), ["opencode-go"], "before recovery Pi routes the Go team");

  const result = await extension.recovery();
  assert.equal(result.outcome, "activated", result.reason);
  assert.equal(store.strategy.status, "active");
  assert.equal(store.strategy.activation.source, "automatic-recovery");
  assert.ok(store.strategy.projectTeam.every((entry) => entry.model?.adapterId !== "opencode-go"), "no new assignment uses Go");

  const routes = providers.get("kairo").models;
  assert.ok(routes.length > 0, "Pi has executable routes for the recovered team");
  assert.ok(routes.every((model) => model.kairoRoute.adapterId !== "opencode-go"), "Pi routes resolve to the recovered team, not Go");

  const messages = notifications.map(([message]) => message);
  assert.equal(messages.filter((message) => /OpenCode Go monthly window is rate-limited/.test(message)).length, 1, "one availability notice for the Go window");
  assert.ok(messages.some((message) => /recovered the project team/.test(message)));
  assert.ok(messages.every((message) => !/exhaust/i.test(message)), "a window limit is never reported as exhausted");
  assert.equal(store.analyses, 1);
});

test("E2E: repeated refreshes trigger no duplicate analysis and no repeated notice", async () => {
  const { store, events, extension, notifications, ctx } = scenario();
  await events.get("session_start")({}, ctx);
  await extension.recovery();
  const afterFirst = notifications.length;

  await events.get("session_start")({}, ctx);
  await extension.recovery();
  await events.get("session_start")({}, ctx);
  await extension.recovery();

  assert.equal(store.analyses, 1, "same availability, no second analysis");
  assert.equal(notifications.length, afterFirst, "no notice is repeated");
});
