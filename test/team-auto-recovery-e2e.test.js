// End-to-end: OpenCode Go hits a window limit while Codex and Claude stay
// available. Real pieces: the Pi extension, the conversation service's
// recoverProjectTeam -> runTeamRecovery, the real availability fingerprint,
// store logic, and route loader (loadKairoProviderModels). Faked: provider
// probes (the snapshot's eligibility), the analyst's answer, and storage
// (one in-memory store shared by the service and the Pi route loader).
import test from "node:test";
import assert from "node:assert/strict";
import { createKairoWorkspaceExtension } from "../src/global/host/extension/index.js";
import { buildKairoProviderModels, loadKairoProviderModels } from "../src/global/host/kairo-route-provider.js";
import { approveKairoRecovery, buildKairoWorkspaceSnapshot, recoverKairoProjectTeam, rejectKairoRecovery } from "../src/global/host/workspace-snapshot.js";
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
  const service = createService();
  const buildExtension = (extra = {}) => createKairoWorkspaceExtension(pi, {
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
    recoverTeam: (args) => recoverKairoProjectTeam(args, { createConversationService: createService }),
    approveTeam: (args) => approveKairoRecovery(args, { createConversationService: createService }),
    rejectTeam: (args) => rejectKairoRecovery(args, { createConversationService: createService }),
    readPendingRecovery: async () => store.recovery,
    ...extra
  });
  const extension = buildExtension();
  const notifications = [];
  const ctx = { cwd: "/repo", ui: { setStatus: () => {}, setWidget: () => {}, notify: (...args) => notifications.push(args) } };
  return {
    store,
    providers,
    events,
    extension,
    notifications,
    ctx,
    buildExtension,
    approveRecovery: (args) => service.approveRecoveryProposal(args),
    rejectRecovery: (args) => service.rejectRecoveryProposal(args)
  };
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

test("E2E: Go limited with Codex/Claude available — recovery proposes without swapping, approval activates and Pi routes follow", async () => {
  const { store, providers, events, extension, notifications, ctx, approveRecovery } = scenario();

  await events.get("session_start")({}, ctx);
  assert.deepEqual(providers.get("kairo").models.map((model) => model.kairoRoute.adapterId), ["opencode-go"], "before recovery Pi routes the Go team");

  const result = await extension.recovery();
  assert.equal(result.outcome, "proposed", result.reason);
  assert.equal(store.strategy.status, "active", "the proposal never touches the active team file");
  assert.equal(store.strategy.profileFingerprint, "fp-1", "the previous team keeps serving");
  assert.deepEqual(providers.get("kairo").models.map((model) => model.kairoRoute.adapterId), ["opencode-go"], "no silent route swap on propose");
  assert.ok(store.recovery.proposal.projectTeam.every((entry) => entry.model?.adapterId !== "opencode-go"), "no proposed assignment uses Go");
  assert.ok(result.affected.some((entry) => /rate-limited/.test(entry.reason)), "the cause rides along");

  const approved = await approveRecovery({ cwd: "/repo" });
  assert.equal(approved.outcome, "approved");
  assert.equal(store.strategy.status, "active");
  assert.equal(store.strategy.activation.source, "recovery-approved");
  assert.ok(store.strategy.projectTeam.every((entry) => entry.model?.adapterId !== "opencode-go"), "no activated assignment uses Go");

  const routes = buildKairoProviderModels({
    strategy: store.strategy,
    resolveAdapter: () => ({ availability: () => ({ launchable: true }) })
  });
  assert.ok(routes.length > 0, "the approved team yields executable routes");
  assert.ok(routes.every((model) => model.kairoRoute.adapterId !== "opencode-go"), "approved routes resolve to the recovered team, not Go");

  const messages = notifications.map(([message]) => message);
  assert.ok(messages.some((message) => /OpenCode Go monthly window is rate-limited/.test(message)), "the cause is named");
  assert.ok(messages.some((message) => /proposes a recovered team/.test(message)), "recovery proposes instead of activating");
  assert.ok(messages.some((message) => /Nothing was activated/.test(message)), "the notice is explicit that nothing swapped");
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

test("E2E: proposal survives a restart — a fresh process notifies the persisted cause and its approve decides", async () => {
  const first = scenario();
  await first.events.get("session_start")({}, first.ctx);
  const proposed = await first.extension.recovery();
  assert.equal(proposed.outcome, "proposed");

  // Restart: a new extension instance sharing only the persisted stores.
  const second = scenario();
  second.store.strategy = first.store.strategy;
  second.store.recovery = first.store.recovery;
  second.store.analyses = first.store.analyses;
  const restarted = second.buildExtension();
  assert.ok(restarted, "a fresh instance boots on the persisted stores");
  const notifications = [];
  const ctx = { cwd: "/repo", ui: { setStatus: () => {}, setWidget: () => {}, notify: (...args) => notifications.push(args) } };
  await second.events.get("session_start")({}, ctx);
  // session_start no longer awaits the background probes; recovery() does.
  await restarted.recovery();
  const joined = notifications.map(([message]) => message).join("\n");
  assert.match(joined, /rate-limited/, "the persisted cause shows after restart");
  assert.match(joined, /kairo-team-approve/, "the restart notice names the approve command");
});

test("E2E: recovery proposal reject keeps the prior Go team and never activates the proposal (SIMULATED eligibility)", async () => {
  const { store, providers, events, extension, ctx, rejectRecovery } = scenario();

  await events.get("session_start")({}, ctx);
  const proposed = await extension.recovery();
  assert.equal(proposed.outcome, "proposed");
  const priorTeam = structuredClone(store.strategy.projectTeam);
  assert.deepEqual(
    providers.get("kairo").models.map((model) => model.kairoRoute.adapterId),
    ["opencode-go"],
    "routes still point at the limited Go team before reject"
  );

  const rejected = await rejectRecovery({ cwd: "/repo" });
  assert.equal(rejected.outcome, "rejected");
  assert.equal(store.strategy.status, "active");
  assert.deepEqual(store.strategy.projectTeam, priorTeam, "reject never mutates the active team");
  assert.equal(store.strategy.activation?.source, undefined);
  assert.deepEqual(
    providers.get("kairo").models.map((model) => model.kairoRoute.adapterId),
    ["opencode-go"],
    "reject leaves Pi routes on the prior team"
  );
  assert.ok(store.recovery, "the fingerprint is closed so the same loss is not re-proposed forever");
});
