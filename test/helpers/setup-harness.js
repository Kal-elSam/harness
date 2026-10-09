/**
 * Real conversation service with fakes only at the provider/disk edges, shared
 * by the setup operation tests and the MCP tests. Offline: no real
 * provider execution, no network.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConversationService } from "../../src/global/conversation/service.js";
import { createConversationOperations } from "../../src/global/conversation/operations.js";
import { scoreAvailableModels } from "../../src/global/intelligence/model-intelligence.js";
import { createCapabilityRegistry } from "../../src/global/intelligence/model-capability-registry.js";
import { ENTITLEMENT } from "../../src/global/observability/claude-model-entitlement.js";

const AA = [
  { slug: "codex-model", name: "Codex Model", intelligenceIndex: 90, codingIndex: 40, mathIndex: null },
  { slug: "claude-model", name: "Claude Model", intelligenceIndex: 40, codingIndex: 90, mathIndex: null }
];
const ADAPTERS = [
  { id: "claude", label: "Claude Code", available: true, launchable: true, reason: null },
  { id: "codex", label: "Codex", available: true, launchable: true, reason: null },
  { id: "cursor", label: "Cursor", available: false, launchable: false, reason: "Cursor CLI is not on PATH." }
];
const PROFILE = {
  projectName: "repo", stack: ["Node.js"], architecture: { pattern: "x" },
  quality: { buildCommand: null, testCommand: null, lintCommand: null, typeCheckCommand: null },
  hotspots: [], workflowCapabilities: [], risks: [], fingerprint: "fp-1",
  roleRequirements: [{ role: "Explorer", capabilities: ["reasoning"], reason: "" }]
};
const ANALYSIS = JSON.stringify({
  architectureTraits: [], complexitySignals: [], criticalAreas: [], contextNeeds: [], workflowNeeds: [],
  recommendedRoleNeeds: [{ role: "Architect", capabilities: ["coding"], reason: "coding-heavy area", evidence: ["src/app.js"] }],
  uncertainties: [], evidenceReferences: ["src/app.js"]
});

/** Real service; only the provider/network/disk edges are fakes with call counters. */
export async function harness({ git = false, claude = ENTITLEMENT.ALLOWED, codexOk = true, cursorAccess = {}, recovery = null, strategy = null } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "kairo-setup-root-")));
  if (git) execFileSync("git", ["init", "-q"], { cwd: root });
  const home = await realpath(await mkdtemp(join(tmpdir(), "kairo-setup-home-")));
  const counts = { startRun: 0, strategyWrites: 0, analyze: 0, recoveryWrites: 0, resolveRoot: [] };
  const analyzed = [];
  const store = { strategy };
  const scoredAll = scoreAvailableModels([
    { adapterId: "codex", models: [{ id: "codex-model" }] },
    { adapterId: "claude", models: [{ id: "claude-model" }] }
  ], AA).map((model) => ({ ...model, accessMode: "automatic" }));
  const claudeModel = scoredAll.find((m) => m.adapterId === "claude");
  const blocked = claude === ENTITLEMENT.UNVERIFIED || claude === ENTITLEMENT.DENIED;
  const pool = scoredAll.map((m) => (m.adapterId === "claude" ? { ...claudeModel, entitlement: claude } : m));
  const modelIntelligence = {
    scoredAll: blocked ? scoredAll.filter((m) => m.adapterId !== "claude") : scoredAll,
    manualSelectionScoredPool: pool, unscoredModels: [], registry: createCapabilityRegistry(),
    providerCapacity: null,
    eligibility: { codex: { ok: codexOk, reason: codexOk ? undefined : "codex sandbox unavailable" }, claude: { ok: true } },
    claudeEntitlement: claude === null ? {} : { "claude-model": { status: claude, reason: blocked ? "no plan evidence" : null } },
    cursorAccess
  };
  const service = createConversationService({
    resolveRoot: async (cwd) => { counts.resolveRoot.push(cwd); return root; },
    homeDir: home,
    inspectExecutionAdapters: () => ADAPTERS,
    computeProjectProfile: async () => PROFILE,
    readProjectStrategy: async () => store.strategy,
    writeProjectStrategy: async (_h, _r, next) => { counts.strategyWrites += 1; store.strategy = next; return next; },
    readAvailabilityRecovery: async () => recovery,
    writeAvailabilityRecovery: async () => { counts.recoveryWrites += 1; },
    acquireProjectAnalysisLock: async () => ({ acquired: true, release: async () => {} }),
    buildSanitizedSnapshot: async () => ({
      snapshotRoot: "/tmp/fake-snapshot", filesCopied: 1, secretsRedacted: 0, copiedFiles: ["src/app.js"],
      excludedPrivatePaths: [], cleanup: async () => {}
    }),
    createBootstrapAnalyzerAdapter: (adapterId, { modelId }) => ({
      checkEligibility: async () => ({ eligible: true, isolation: "verified" }),
      analyze: async () => { counts.analyze += 1; analyzed.push(`${adapterId}::${modelId}`); return { status: "answered", answer: ANALYSIS }; }
    }),
    startRun: async () => { counts.startRun += 1; throw new Error("setup must never launch a run"); }
  });
  service.snapshot = async () => ({
    projectRoot: root, projectStrategy: store.strategy, modelIntelligence, timeline: []
  });
  const ops = createConversationOperations({ cwd: root, getService: () => service });
  return { root, home, counts, analyzed, store, service, ops, modelIntelligence };
}

export async function draftTeam(h) {
  const plan = await h.ops.planSetup({ action: "run_analysis", analyzerKey: "codex::codex-model" });
  await h.ops.runAnalysis({ confirmationTarget: plan.confirmationTarget });
  return h;
}
