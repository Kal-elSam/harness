import test from "node:test";
import assert from "node:assert/strict";
import { ELIGIBILITY_GO_LIMITED, proposalWorld } from "./helpers/team-proposal-world.js";
import { availabilityFingerprint } from "../src/global/team/availability-fingerprint.js";

// D3 at the service boundary: recovery highlights a suggestion but only
// analyzes after the human's own pick, and only a STARTED analysis consumes
// a retry. The active strategy file is never touched by any of it.

const pick = (modelId, adapterId) => ({ model: { adapterId, modelId, displayName: modelId }, selectionSource: "manual", recommendationTags: [], choice: null });

async function suggestion(service) {
  const result = await service.recoverProjectTeam({ cwd: "/repo", explicit: true });
  assert.equal(result.outcome, "analyst_selection_required");
  return result;
}

test("D3 service: recovery without a pick suggests an analyst and runs nothing", async () => {
  const world = proposalWorld();
  const before = JSON.stringify(world.store.strategy);
  const result = await suggestion(world.createService());
  assert.ok(result.suggestedAnalyst, "an eligible suggestion is offered");
  assert.ok(result.analystCatalog.models.length > 0);
  assert.equal(world.store.analyses, 0);
  assert.equal(world.store.locks, 0);
  assert.deepEqual(world.store.recoveryWrites, []);
  assert.equal(JSON.stringify(world.store.strategy), before);
});

test("D3 service: the human's Enter on the suggested (or another) row runs exactly one analysis and yields a proposal bound to its id", async () => {
  const world = proposalWorld();
  const service = world.createService();
  const { analystCatalog } = await suggestion(service);
  const row = analystCatalog.models[0];
  const before = JSON.stringify(world.store.strategy);
  const result = await service.recoverProjectTeam({ cwd: "/repo", analyst: pick(row.modelId, row.adapterId) });
  assert.equal(result.outcome, "proposed", result.reason);
  assert.equal(world.store.analyses, 1);
  assert.equal(JSON.stringify(world.store.strategy), before, "choosing an analyst never replaces the active team");
  assert.equal(world.store.recoveryWrites[0].outcome, "started");
  assert.equal(world.store.recovery.outcome, "proposed");
  assert.equal(world.store.strategyWrites, 0, "and it does not approve the proposal");
  // Approval stays a separate, explicit act bound to the viewed id.
  await assert.rejects(service.approveRecoveryProposal({ cwd: "/repo", proposalId: "other" }), /not the pending proposal/);
  const approved = await service.approveRecoveryProposal({ cwd: "/repo", proposalId: result.proposalId });
  assert.equal(approved.outcome, "approved");
});

test("D3 service: open/cancel/empty/denied cost no retry; a started analysis that fails costs exactly one", async () => {
  const world = proposalWorld();
  const service = world.createService();
  const { analystCatalog } = await suggestion(service);
  await suggestion(service);
  const ghost = await service.recoverProjectTeam({ cwd: "/repo", analyst: pick("ghost-model", "claude") });
  assert.deepEqual({ outcome: ghost.outcome, reason: ghost.reason }, { outcome: "kept-previous", reason: "analyst-unavailable" });
  assert.deepEqual(world.store.recoveryWrites, [], "no attempt recorded so far");

  world.store.failAnalysis = true;
  const row = analystCatalog.models[0];
  const failed = await service.recoverProjectTeam({ cwd: "/repo", analyst: pick(row.modelId, row.adapterId) });
  assert.equal(failed.outcome, "kept-previous");
  assert.equal(world.store.recovery.attempts, 1);
  assert.equal(world.store.analyses, 1);
});

// D5 at the service boundary: the explicit request reaches the picker even
// when the stored record is throttled; the automatic refresh never does.
const throttledRecord = (world, attempts) => ({
  fingerprint: availabilityFingerprint(ELIGIBILITY_GO_LIMITED).key, outcome: "analysis-failed", attempts, updatedAt: new Date().toISOString()
});

test("D5 service: R during backoff and after the 3rd failure opens the selection with no attempt, lock or analysis; automatic stays closed", async () => {
  for (const attempts of [1, 3]) {
    const world = proposalWorld();
    world.store.recovery = throttledRecord(world, attempts);
    const service = world.createService();
    const before = JSON.stringify(world.store.recovery);

    const auto = await service.recoverProjectTeam({ cwd: "/repo" });
    assert.equal(auto.outcome, "skipped", `automatic attempts=${attempts}`);
    assert.equal(auto.analystCatalog, undefined);

    const explicit = await service.recoverProjectTeam({ cwd: "/repo", explicit: true, reopenPending: true });
    assert.equal(explicit.outcome, "analyst_selection_required", `attempts=${attempts}`);
    assert.equal(explicit.throttled, attempts === 1 ? "retry-later" : "retries-exhausted");
    assert.ok(explicit.analystCatalog.models.length > 0);
    assert.equal(world.store.analyses, 0);
    assert.equal(world.store.locks, 0);
    assert.deepEqual(world.store.recoveryWrites, []);
    assert.equal(JSON.stringify(world.store.recovery), before, "attempts unchanged");

    const row = explicit.analystCatalog.models[0];
    const run = await service.recoverProjectTeam({ cwd: "/repo", analyst: pick(row.modelId, row.adapterId) });
    assert.equal(run.outcome, "proposed", run.reason);
    assert.equal(world.store.analyses, 1);
    assert.equal(world.store.recovery.attempts, attempts + 1);
    assert.equal(world.store.recovery.origin, "manual");
  }
});

test("D5 service: with a pending proposal an explicit request reopens it - no new analysis", async () => {
  const world = proposalWorld();
  const service = world.createService();
  const { analystCatalog } = await service.recoverProjectTeam({ cwd: "/repo", explicit: true });
  const row = analystCatalog.models[0];
  const proposed = await service.recoverProjectTeam({ cwd: "/repo", analyst: pick(row.modelId, row.adapterId) });
  assert.equal(proposed.outcome, "proposed");
  const analyses = world.store.analyses;
  const reopened = await service.recoverProjectTeam({ cwd: "/repo", explicit: true, reopenPending: true });
  assert.equal(reopened.outcome, "proposed");
  assert.equal(reopened.proposalId, proposed.proposalId);
  assert.equal(world.store.analyses, analyses, "reopening never analyzes again");
});
