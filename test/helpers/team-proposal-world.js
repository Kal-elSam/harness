// Shared in-memory world for the pending-proposal / recovery-selection tests:
// the REAL conversation service and team-recovery logic over fake stores,
// fake provider eligibility and a fake analyst adapter. No provider is ever
// called; every store write is observable.
import { createConversationService } from "../../src/global/conversation/service.js";
import { scoreAvailableModels } from "../../src/global/intelligence/model-intelligence.js";
import { createCapabilityRegistry } from "../../src/global/intelligence/model-capability-registry.js";

export const GO_LIMIT = { provider: "opencode-go", window: "monthly", remainingPercent: 0, resetsAt: "2026-10-01T00:00:00Z" };
export const ELIGIBILITY_GO_LIMITED = {
  codex: { ok: true, reason: null },
  claude: { ok: true, reason: null },
  "opencode-go": { ok: false, reason: "OpenCode Go monthly window is rate-limited (resets 2026-10-01T00:00:00Z)", limit: GO_LIMIT }
};
export const ELIGIBILITY_ALL_OK = {
  codex: { ok: true, reason: null },
  claude: { ok: true, reason: null },
  "opencode-go": { ok: true, reason: null }
};
export const GO_MODEL = { candidateKey: "opencode-go::glm-5-3", adapterId: "opencode-go", modelId: "glm-5-3", displayName: "GLM-5.3", accessMode: "automatic" };
export const PROFILE = {
  projectName: "repo", stack: ["Node.js"], architecture: { pattern: "x" },
  quality: { buildCommand: null, testCommand: null, lintCommand: null, typeCheckCommand: null },
  hotspots: [], workflowCapabilities: [], risks: [], fingerprint: "fp-2",
  roleRequirements: [
    { role: "Architect", capabilities: ["reasoning"], reason: "" },
    { role: "Explorer", capabilities: ["reasoning"], reason: "" }
  ]
};
export const ACTIVE_TEAM = {
  schema: "kairo.project-strategy/v1",
  status: "active", profileFingerprint: "fp-1", approvedAt: "2026-09-01T00:00:00.000Z",
  orchestrator: null, bootstrapAnalyst: null,
  projectTeam: [{ role: "Explorer", model: GO_MODEL, fallback: null, assignmentSource: "recommended" }]
};
const ANALYSIS_ANSWER = JSON.stringify({
  architectureTraits: [], complexitySignals: [], criticalAreas: [], contextNeeds: [],
  workflowNeeds: [], recommendedRoleNeeds: [], uncertainties: [], evidenceReferences: []
});

/**
 * @param {{strategy?: object|null, eligibility?: object, failAnalysis?: boolean, failStrategyWrite?: boolean, store?: object}} [options]
 *   `store` lets a "restarted process" share the persisted state of an earlier world.
 */
export function proposalWorld({ strategy = structuredClone(ACTIVE_TEAM), eligibility = ELIGIBILITY_GO_LIMITED, failAnalysis = false, store } = {}) {
  const shared = store ?? {
    strategy,
    recovery: null,
    pending: null,
    analyses: 0,
    strategyWrites: 0,
    recoveryWrites: [],
    locks: 0,
    lockHeld: false,
    failStrategyWrite: false,
    failAnalysis,
    eligibility
  };
  const scoredAll = scoreAvailableModels([
    { adapterId: "codex", models: [{ id: "codex-model" }] },
    { adapterId: "claude", models: [{ id: "claude-model" }] }
  ], [
    { slug: "codex-model", name: "Codex Model", intelligenceIndex: 90, codingIndex: 40, mathIndex: null },
    { slug: "claude-model", name: "Claude Model", intelligenceIndex: 40, codingIndex: 90, mathIndex: null }
  ]).map((model) => ({ ...model, accessMode: "automatic" }));

  const createService = (overrides = {}) => {
    const service = createConversationService({
      resolveRoot: async () => "/repo",
      homeDir: "/home/test",
      computeProjectProfile: async () => PROFILE,
      readProjectStrategy: async () => (shared.strategy ? structuredClone(shared.strategy) : null),
      writeProjectStrategy: async (_home, _root, next) => {
        if (shared.failStrategyWrite) throw new Error("simulated write failure");
        shared.strategyWrites += 1;
        shared.strategy = structuredClone(next);
        return next;
      },
      readAvailabilityRecovery: async () => (shared.recovery ? structuredClone(shared.recovery) : null),
      writeAvailabilityRecovery: async (_home, _root, record) => {
        shared.recoveryWrites.push(structuredClone(record));
        shared.recovery = { ...structuredClone(record), updatedAt: new Date().toISOString() };
        return shared.recovery;
      },
      readPendingTeamProposal: async () => (shared.pending ? structuredClone(shared.pending) : null),
      writePendingTeamProposal: async (_home, _root, doc) => {
        shared.pending = structuredClone(doc);
        return shared.pending;
      },
      clearPendingTeamProposal: async () => { shared.pending = null; },
      acquireProjectAnalysisLock: async () => {
        if (shared.lockHeld) return { acquired: false, holder: { owner: "manual", startedAt: "2026-09-23T10:00:00.000Z" } };
        shared.locks += 1;
        return { acquired: true, release: async () => {} };
      },
      buildSanitizedSnapshot: async () => ({ snapshotRoot: "/tmp/snap", filesCopied: 0, secretsRedacted: 0, copiedFiles: [], excludedPrivatePaths: [], cleanup: async () => {} }),
      createBootstrapAnalyzerAdapter: () => ({
        checkEligibility: async () => ({ eligible: true, isolation: "verified" }),
        analyze: async () => {
          shared.analyses += 1;
          if (shared.failAnalysis) return { status: "failed", error: "provider timeout" };
          return { status: "answered", answer: ANALYSIS_ANSWER };
        }
      }),
      ...overrides
    });
    service.snapshot = async () => ({
      modelIntelligence: { scoredAll, eligibility: shared.eligibility, registry: createCapabilityRegistry(), providerCapacity: null }
    });
    return service;
  };
  return { store: shared, createService };
}

/** The analyst a human would pick: the first qualified row of the real preflight catalog. */
export async function chosenAnalyst(service) {
  const preflight = await service.preflightProject({ cwd: "/repo" });
  const row = preflight.analystCatalog.models.find((model) => model.available === true && model.accessVerified !== false);
  if (!row) throw new Error("the fake world exposes no analyst row");
  return {
    preflight,
    analyst: {
      model: { adapterId: row.adapterId, modelId: row.modelId, displayName: row.displayName },
      selectionSource: "manual", recommendationTags: [], choice: null
    },
    row
  };
}
