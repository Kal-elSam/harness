import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { proposalWorld, chosenAnalyst, ELIGIBILITY_ALL_OK, ACTIVE_TEAM } from "./helpers/team-proposal-world.js";
import {
  readPendingTeamProposal, writePendingTeamProposal, clearPendingTeamProposal, computeProposalId
} from "../src/global/conversation/pending-team-proposal-store.js";

// D1: a manual re-analysis while a team is ACTIVE never touches the active
// team. The result is a separate pending proposal that survives Esc and a
// restart; approval is bound to the proposal the human viewed AND to the
// exact base team it was built against.

async function reanalyze(world) {
  const service = world.createService();
  const { preflight, analyst } = await chosenAnalyst(service);
  const result = await service.runBootstrapAnalysis({ cwd: "/repo", profile: preflight.profile, candidates: preflight.candidates, analyst });
  return { service, result };
}

test("D1: re-analysis with an active team leaves the active strategy byte-identical and stores a pending proposal", async () => {
  const world = proposalWorld();
  const before = JSON.stringify(world.store.strategy);
  const { result } = await reanalyze(world);

  assert.equal(world.store.strategyWrites, 0, "the strategy file is never written");
  assert.equal(JSON.stringify(world.store.strategy), before, "active team byte-identical");
  assert.equal(world.store.analyses, 1);
  assert.equal(result.pending, true);
  assert.equal(typeof result.proposalId, "string");
  assert.equal(world.store.pending.id, result.proposalId);
  assert.equal(world.store.pending.proposal.status, "suggested");
  assert.equal(world.store.pending.source, "manual-reanalysis");
});

test("D1: a failed re-analysis keeps the active team untouched and stores no proposal", async () => {
  const world = proposalWorld({ failAnalysis: true });
  const before = JSON.stringify(world.store.strategy);
  const service = world.createService();
  const { preflight, analyst } = await chosenAnalyst(service);
  await assert.rejects(service.runBootstrapAnalysis({ cwd: "/repo", profile: preflight.profile, candidates: preflight.candidates, analyst }), /did not answer/);
  assert.equal(JSON.stringify(world.store.strategy), before);
  assert.equal(world.store.strategyWrites, 0);
  assert.equal(world.store.pending, null);
});

test("D1: first bootstrap (no active team) keeps today's suggested -> approve flow and creates no pending proposal", async () => {
  const world = proposalWorld({ strategy: null });
  const { result } = await reanalyze(world);
  assert.equal(world.store.strategyWrites, 1, "the suggested strategy is persisted as before");
  assert.equal(world.store.strategy.status, "suggested");
  assert.equal(world.store.pending, null);
  assert.notEqual(result.pending, true);
});

test("D1: a still-SUGGESTED (never approved) strategy is replaced by a new analysis exactly as before", async () => {
  const world = proposalWorld({ strategy: { ...structuredClone(ACTIVE_TEAM), status: "suggested", approvedAt: undefined } });
  await reanalyze(world);
  assert.equal(world.store.strategyWrites, 1);
  assert.equal(world.store.pending, null);
});

test("D1: approve with a stale/other proposal id refuses and writes nothing", async () => {
  const world = proposalWorld();
  const { service } = await reanalyze(world);
  const before = JSON.stringify(world.store.strategy);
  for (const proposalId of ["not-the-viewed-one", "", undefined, null]) {
    await assert.rejects(service.approveRecoveryProposal({ cwd: "/repo", proposalId }), /proposal/i, String(proposalId));
  }
  assert.equal(JSON.stringify(world.store.strategy), before);
  assert.ok(world.store.pending, "the pending proposal is still there");
});

test("D1: approve when the base team changed since the proposal refuses and requires a new review", async () => {
  const world = proposalWorld();
  const { service, result } = await reanalyze(world);
  // A human edit / newer approval changed the active team meanwhile.
  world.store.strategy = { ...world.store.strategy, approvedAt: "2026-10-02T00:00:00.000Z" };
  const before = JSON.stringify(world.store.strategy);
  world.store.eligibility = ELIGIBILITY_ALL_OK;
  await assert.rejects(
    service.approveRecoveryProposal({ cwd: "/repo", proposalId: result.proposalId }),
    /active team changed since the proposal/i
  );
  assert.equal(JSON.stringify(world.store.strategy), before, "nothing overwritten");
  assert.equal(world.store.strategyWrites, 0);
});

test("D1: approving THE viewed proposal activates it atomically and clears the pending proposal", async () => {
  const world = proposalWorld();
  const { service, result } = await reanalyze(world);
  world.store.eligibility = ELIGIBILITY_ALL_OK;
  const approved = await service.approveRecoveryProposal({ cwd: "/repo", proposalId: result.proposalId });
  assert.equal(approved.outcome, "approved");
  assert.equal(world.store.strategy.status, "active");
  assert.equal(world.store.strategy.activation.source, "reanalysis-approved");
  assert.equal(world.store.pending, null);
  assert.equal(world.store.strategyWrites, 1);
});

test("D1: a failing strategy write leaves the active team untouched and the proposal pending (no partial apply)", async () => {
  const world = proposalWorld();
  const { service, result } = await reanalyze(world);
  world.store.eligibility = ELIGIBILITY_ALL_OK;
  world.store.failStrategyWrite = true;
  const before = JSON.stringify(world.store.strategy);
  await assert.rejects(service.approveRecoveryProposal({ cwd: "/repo", proposalId: result.proposalId }), /simulated write failure/);
  assert.equal(JSON.stringify(world.store.strategy), before);
  assert.equal(world.store.pending?.id, result.proposalId, "still pending, can be retried");
});

test("D1: the pending proposal reopens after a restart (new service instance) without re-analyzing", async () => {
  const world = proposalWorld();
  const { result } = await reanalyze(world);
  const restarted = proposalWorld({ store: world.store }).createService();
  const reopened = await restarted.recoverProjectTeam({ cwd: "/repo", reopenPending: true });
  assert.equal(reopened.outcome, "proposed");
  assert.equal(reopened.proposalId, result.proposalId);
  assert.equal(reopened.source, "manual-reanalysis");
  assert.ok(reopened.proposal.projectTeam.length >= 0);
  assert.equal(world.store.analyses, 1, "reopening runs no analysis");
  assert.equal(world.store.locks, 1, "reopening takes no analysis lock");
});

test("D1: rejecting the proposal discards it and keeps the active team byte-identical", async () => {
  const world = proposalWorld();
  const { service, result } = await reanalyze(world);
  const before = JSON.stringify(world.store.strategy);
  await assert.rejects(service.rejectRecoveryProposal({ cwd: "/repo", proposalId: "other" }), /proposal/i);
  assert.ok(world.store.pending, "a mismatched id discards nothing");
  const rejected = await service.rejectRecoveryProposal({ cwd: "/repo", proposalId: result.proposalId });
  assert.equal(rejected.outcome, "rejected");
  assert.equal(world.store.pending, null);
  assert.equal(JSON.stringify(world.store.strategy), before);
});

test("D1: the proposal id is a content hash bound to the proposal and its base", () => {
  const base = { hash: "h1" };
  const a = computeProposalId({ status: "suggested", projectTeam: [] }, base);
  assert.equal(a, computeProposalId({ projectTeam: [], status: "suggested" }, base), "key order does not matter");
  assert.notEqual(a, computeProposalId({ status: "suggested", projectTeam: [{ role: "x" }] }, base));
  assert.notEqual(a, computeProposalId({ status: "suggested", projectTeam: [] }, { hash: "h2" }));
});

test("D1: the on-disk pending store round-trips, is written atomically and clears cleanly", async () => {
  const home = await mkdtemp(join(tmpdir(), "kairo-pending-"));
  try {
    assert.equal(await readPendingTeamProposal(home, "/repo"), null);
    const doc = await writePendingTeamProposal(home, "/repo", { id: "abc", source: "manual-reanalysis", proposal: { status: "suggested" }, basedOn: { hash: "h" } });
    assert.equal((await readPendingTeamProposal(home, "/repo")).id, doc.id);
    await clearPendingTeamProposal(home, "/repo");
    assert.equal(await readPendingTeamProposal(home, "/repo"), null);
    await clearPendingTeamProposal(home, "/repo"); // idempotent

    const writes = [];
    await assert.rejects(writePendingTeamProposal(home, "/repo", { id: "x", proposal: {} }, {
      writeAtomicJson: async (path) => { writes.push(path); throw new Error("disk full"); }
    }), /disk full/);
    assert.equal(await readPendingTeamProposal(home, "/repo"), null, "a failed write leaves no partial pending file");
    assert.equal(writes.length, 1);
    const leftovers = [];
    const walk = async (dir) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) await walk(join(dir, entry.name)); else leftovers.push(entry.name);
      }
    };
    await walk(home);
    assert.deepEqual(leftovers.filter((name) => name.endsWith(".tmp")), []);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("D1: re-analysis and approval never launch, stop or recover runs (runs already started keep the assignment they were launched with)", async () => {
  const world = proposalWorld();
  const touched = [];
  const spy = (name) => async () => { touched.push(name); return {}; };
  const service = world.createService({ startRun: spy("startRun"), stopRun: spy("stopRun"), recoverRuns: spy("recoverRuns") });
  const { preflight, analyst } = await chosenAnalyst(service);
  const result = await service.runBootstrapAnalysis({ cwd: "/repo", profile: preflight.profile, candidates: preflight.candidates, analyst });
  world.store.eligibility = ELIGIBILITY_ALL_OK;
  await service.approveRecoveryProposal({ cwd: "/repo", proposalId: result.proposalId });
  assert.deepEqual(touched, [], "a team change only replaces the strategy; no run is started, stopped or recovered");
});
