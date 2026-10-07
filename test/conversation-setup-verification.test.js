import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConversationService, buildAccessVerificationPlan } from "../src/global/conversation/service.js";
import { createConversationOperations } from "../src/global/conversation/operations.js";
import { scoreAvailableModels } from "../src/global/intelligence/model-intelligence.js";
import { createCapabilityRegistry } from "../src/global/intelligence/model-capability-registry.js";
import { ENTITLEMENT } from "../src/global/observability/claude-model-entitlement.js";

const AA = [
  { slug: "codex-model", name: "Codex Model", intelligenceIndex: 90, codingIndex: 40, mathIndex: null },
  { slug: "claude-model", name: "Claude Model", intelligenceIndex: 40, codingIndex: 90, mathIndex: null }
];
const ADAPTERS = [
  { id: "claude", label: "Claude Code", available: true, launchable: true, reason: null },
  { id: "codex", label: "Codex", available: true, launchable: true, reason: null }
];

/**
 * Real service and operations; provider probes, runs and strategy writes are
 * counted fakes so "reading setup never verifies or launches" is observable.
 */
async function harness({ claudeEntitlement = {}, extra = {} } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "kairo-setupv-root-")));
  const home = await realpath(await mkdtemp(join(tmpdir(), "kairo-setupv-home-")));
  const counts = { claudeProbes: 0, cursorProbes: 0, startRun: 0, strategyWrites: 0 };
  const scoredAll = scoreAvailableModels([
    { adapterId: "codex", models: [{ id: "codex-model" }] },
    { adapterId: "claude", models: [{ id: "claude-model" }] }
  ], AA).map((model) => ({ ...model, accessMode: "automatic" }));
  const eligibility = { codex: { ok: true }, claude: { ok: true } };
  const claudeModels = [{ id: "claude-model", displayName: "Claude Model" }];
  const modelIntelligence = {
    scoredAll, manualSelectionScoredPool: scoredAll, unscoredModels: [], registry: createCapabilityRegistry(),
    providerCapacity: null, eligibility, claudeEntitlement, cursorAccess: {},
    verificationPlan: buildAccessVerificationPlan({ eligibility, claudeModels, claudeEntitlement }),
    ...extra
  };
  const service = createConversationService({
    resolveRoot: async () => root,
    homeDir: home,
    inspectExecutionAdapters: () => ADAPTERS,
    readProjectStrategy: async () => null,
    writeProjectStrategy: async (_h, _r, next) => { counts.strategyWrites += 1; return next; },
    readAvailabilityRecovery: async () => null,
    probeClaudeModelEntitlements: async () => { counts.claudeProbes += 1; return []; },
    probeCursorPoolAccess: async () => { counts.cursorProbes += 1; return null; },
    startRun: async () => { counts.startRun += 1; throw new Error("setup must never launch a run"); }
  });
  service.snapshot = async () => ({ projectRoot: root, projectStrategy: null, modelIntelligence, timeline: [] });
  const ops = createConversationOperations({ cwd: root, getService: () => service });
  return { root, counts, service, ops, modelIntelligence };
}

const provider = (setup, id) => setup.providers.find((p) => p.id === id);

test("setup read projects the existing verification plan: pending vs reusable, cost statement, nothing executed", async () => {
  const h = await harness({ claudeEntitlement: {} });
  const setup = await h.ops.setup();
  const plan = h.modelIntelligence.verificationPlan;
  assert.equal(plan.pendingCount, 1, "fixture sanity: one Claude model check is pending");
  const view = setup.accessVerification;
  assert.equal(view.pendingCount, plan.pendingCount);
  assert.equal(view.reusableCount, plan.reusableCount);
  assert.equal(view.mayConsumeQuota, true);
  assert.equal(view.costStatement, plan.costStatement);
  assert.equal(view.executed, false);
  assert.deepEqual(view.subscriptions.map((s) => [s.provider, s.pendingCount, s.reusableCount]), [["claude", 1, 0]]);
  assert.deepEqual(view.subscriptions[0].checks.map((c) => [c.id, c.state, c.reason]), [["claude::claude-model", "pending", "never_verified"]]);
});

test("setup read keeps reusable checks and the consumption warning distinct from pending ones", async () => {
  const h = await harness({ claudeEntitlement: { "claude-model": { status: ENTITLEMENT.ALLOWED, age: "1h" } } });
  const view = (await h.ops.setup()).accessVerification;
  assert.equal(view.pendingCount, 0);
  assert.equal(view.reusableCount, 1);
  assert.equal(view.mayConsumeQuota, false);
  assert.equal(view.costStatement, null);
  assert.equal(view.subscriptions[0].checks[0].state, "reusable");
});

test("hints cite the pending plan instead of telling the reader to run verification first", async () => {
  const pending = await harness({ claudeEntitlement: {} });
  const claude = provider(await pending.ops.setup(), "claude");
  assert.equal(claude.accessVerified, "unverified");
  assert.match(claude.accessReason, /1 access check is pending/);
  assert.match(claude.accessReason, /not run/);
  assert.match(claude.accessReason, /confirmation/);
  assert.doesNotMatch(claude.accessReason, /run the access verification first/i);
  const noPlan = await harness({ claudeEntitlement: {}, extra: { verificationPlan: undefined } });
  const bare = provider(await noPlan.ops.setup(), "claude");
  assert.equal(bare.accessVerified, "unverified");
  assert.doesNotMatch(bare.accessReason, /pending|run the access verification first/i);
});

test("reading setup runs no probe, no verification, no run and writes nothing", async () => {
  const h = await harness({ claudeEntitlement: {} });
  await h.ops.setup();
  await h.ops.setup();
  await h.ops.planSetup({ action: "run_analysis", analyzerKey: "claude::claude-model" });
  assert.deepEqual(h.counts, { claudeProbes: 0, cursorProbes: 0, startRun: 0, strategyWrites: 0 });
});

test("catalog gates preserved: denied models are evidence-only, analystUnscoredModels (not unscoredModels) feed the analyzer pool", async () => {
  const unscored = { adapterId: "codex", modelId: "plain-unscored", displayName: "Plain Unscored", candidateKey: "codex::plain-unscored", evidenceStatus: "unscored" };
  const other = { adapterId: "codex", modelId: "hidden-unscored", displayName: "Hidden", candidateKey: "codex::hidden-unscored", evidenceStatus: "unscored" };
  const denied = { ...scoreAvailableModels([{ adapterId: "claude", models: [{ id: "denied-model" }] }], [
    { slug: "denied-model", name: "Denied", intelligenceIndex: 80, codingIndex: 80, mathIndex: null }
  ])[0], entitlement: ENTITLEMENT.DENIED };
  const h = await harness({
    claudeEntitlement: { "claude-model": { status: ENTITLEMENT.ALLOWED } },
    extra: { deniedScoredPool: [denied], unscoredModels: [other], analystUnscoredModels: [unscored] }
  });
  const keys = (await h.ops.setup()).analyzers.map((a) => a.candidateKey);
  assert.ok(keys.includes("codex::plain-unscored"), "analyst pool uses analystUnscoredModels");
  assert.ok(!keys.includes("codex::hidden-unscored"), "plain unscoredModels do not leak into the analyst pool");
  assert.ok(!keys.includes(denied.candidateKey ?? `${denied.adapterId}::${denied.modelId}`), "verified-denied candidates are never rows");
  const facts = await h.service.readSetup({ cwd: h.root });
  assert.ok(facts.analystCatalog.exclusions.some((e) => e.modelId === "denied-model" && e.cause === "unavailable_verified"));
  assert.equal(facts.verificationPlan, h.modelIntelligence.verificationPlan, "the facts carry the base plan, not a copy");
});
