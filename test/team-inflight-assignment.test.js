import test from "node:test";
import assert from "node:assert/strict";
import { createConversationService } from "../src/global/conversation/service.js";
import { computeProposalId, strategyHash } from "../src/global/conversation/pending-team-proposal-store.js";

// T4b / D1: a run started before a recovery proposal is approved keeps the
// assignment it started with. executePlan, the plan -> assignment path and
// the real approve path are REAL; only stores, eligibility and the process
// launcher are in-memory fakes.

const CODEX = { candidateKey: "codex::gpt-6-astra", adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra", accessMode: "automatic" };
const CLAUDE = { candidateKey: "claude::claude-opus-5", adapterId: "claude", modelId: "claude-opus-5", displayName: "Claude Opus 5", accessMode: "automatic" };
const entry = (model) => ({
  role: "Builder", model, fallback: null, decisionEvidence: null, assignmentSource: "recommended",
  recommendedAssignment: { model, fallback: null, decisionEvidence: null }, overrideEvidence: null
});
const team = (model, extra = {}) => ({
  schema: "kairo.project-strategy/v1", status: "active", profileFingerprint: "fp-1", approvedAt: "2026-09-01T00:00:00.000Z",
  orchestrator: CODEX, activeRoles: ["Builder"], projectTeam: [entry(model)], ...extra
});

function world() {
  const store = { strategy: team(CODEX), pending: null, links: new Map(), launches: [] };
  const service = createConversationService({
    resolveRoot: async () => "/repo", homeDir: "/home/test",
    selectExecutionProvider: () => { throw new Error("legacy router must not be used"); },
    readPlan: async () => ({ status: {}, taskMarkdown: "t", planMarkdown: "# Plan" }),
    verifyExecution: async () => ({ status: {}, taskMarkdown: "t", planMarkdown: "# Plan" }),
    createRunId: (() => { let n = 0; return () => `run_${++n}`; })(),
    readExecution: async (_root, taskId) => store.links.get(taskId) ?? null,
    writeExecution: async (_root, taskId, value) => { store.links.set(taskId, value); },
    updateExecution: async (_root, taskId, value) => { store.links.set(taskId, value); },
    readProjectStrategy: async () => structuredClone(store.strategy),
    writeProjectStrategy: async (_h, _r, next) => { store.strategy = structuredClone(next); return next; },
    readPendingTeamProposal: async () => (store.pending ? structuredClone(store.pending) : null),
    clearPendingTeamProposal: async () => { store.pending = null; },
    // The run stays "running": it is in flight for the whole test.
    startRun: async (input) => {
      store.launches.push({ agentId: input.agentId, model: input.model });
      return { metadata: { state: "running", startedAt: "now", updatedAt: "now" } };
    }
  });
  service.snapshot = async () => ({ modelIntelligence: { eligibility: { codex: { ok: true }, claude: { ok: true } } } });
  return { store, service };
}

const target = (model, fingerprint) => ({ role: "Builder", selection: "assigned", strategyFingerprint: fingerprint, candidateKey: model.candidateKey });

test("T4b: a run in flight keeps its assignment across an approved team apply; later runs use the new team", async () => {
  const { store, service } = world();

  const preview1 = await service.planExecution({ cwd: "/repo", taskId: "task-1", role: "Builder" });
  assert.equal(preview1.provider, "codex");
  const started = await service.executePlan({ cwd: "/repo", taskId: "task-1", confirmationTarget: preview1.confirmationTarget });
  assert.equal(started.execution.provider, "codex");
  assert.equal(started.execution.state, "running");

  // A pending proposal moves Builder to Claude; approve it through the real path.
  const proposal = { ...team(CLAUDE, { status: "suggested", profileFingerprint: "fp-2" }) };
  const basedOn = { profileFingerprint: "fp-1", approvedAt: store.strategy.approvedAt, hash: strategyHash(store.strategy) };
  const id = computeProposalId(proposal, basedOn);
  store.pending = { id, source: "manual-reanalysis", createdAt: "2026-10-01T00:00:00.000Z", basedOn, proposal };
  const approved = await service.approveRecoveryProposal({ cwd: "/repo", proposalId: id });
  assert.equal(approved.outcome, "approved");
  assert.equal(store.strategy.projectTeam[0].model.adapterId, "claude", "the team really changed");

  // The in-flight run still reports (and is still linked to) its original assignment, never relaunched.
  const again = await service.executePlan({ cwd: "/repo", taskId: "task-1", confirmationTarget: preview1.confirmationTarget });
  assert.equal(again.reused, true);
  assert.equal(again.execution.provider, "codex");
  assert.equal(again.execution.runId, started.execution.runId);
  assert.equal(store.links.get("task-1").agentId, "codex");
  assert.equal(store.launches.length, 1, "approval never relaunches or re-routes the in-flight run");

  // A run started after the apply uses the new team.
  const preview2 = await service.planExecution({ cwd: "/repo", taskId: "task-2", role: "Builder" });
  assert.equal(preview2.provider, "claude");
  const next = await service.executePlan({ cwd: "/repo", taskId: "task-2", confirmationTarget: preview2.confirmationTarget });
  assert.equal(next.execution.provider, "claude");
  assert.deepEqual(store.launches.map((l) => l.agentId), ["codex", "claude"]);
  assert.equal(store.links.get("task-1").agentId, "codex", "the first run is still on its original assignment");
});
