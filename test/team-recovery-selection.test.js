import test from "node:test";
import assert from "node:assert/strict";
import { proposalWorld } from "./helpers/team-proposal-world.js";

// D3 at the service boundary: recovery highlights a suggestion but only
// analyzes after the human's own pick, and only a STARTED analysis consumes
// a retry. The active strategy file is never touched by any of it.

const pick = (modelId, adapterId) => ({ model: { adapterId, modelId, displayName: modelId }, selectionSource: "manual", recommendationTags: [], choice: null });

async function suggestion(service) {
  const result = await service.recoverProjectTeam({ cwd: "/repo" });
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
