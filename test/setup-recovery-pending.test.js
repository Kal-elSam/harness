import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./helpers/setup-harness.js";
import { computeProposalId, strategyHash } from "../src/global/conversation/pending-team-proposal-store.js";

const activeTeam = (extra = {}) => ({
  status: "active", profileFingerprint: "fp-1", approvedAt: "2026-10-01T00:00:00.000Z",
  orchestrator: { adapterId: "codex", modelId: "codex-model" },
  projectTeam: [{ role: "Architect", model: { adapterId: "codex", modelId: "codex-model" } }], ...extra
});

async function manualHarness({ drift = false } = {}) {
  const base = activeTeam();
  const proposal = { ...activeTeam({ profileFingerprint: "fp-2", status: "suggested" }) };
  const basedOn = { hash: strategyHash(base) };
  const pending = { id: computeProposalId(proposal, basedOn), source: "manual-reanalysis", basedOn, proposal };
  const reads = { pending: 0 };
  const h = await harness({
    strategy: drift ? activeTeam({ approvedAt: "2026-10-02T00:00:00.000Z" }) : base,
    serviceDeps: { readPendingTeamProposal: async () => { reads.pending += 1; return pending; } }
  });
  return { h, pending, reads };
}

test("readSetup: a manual pending proposal is pending", async () => {
  const { h, pending } = await manualHarness();
  const { recovery } = await h.service.readSetup({ cwd: h.root });
  assert.equal(recovery.pending, true);
  assert.equal(recovery.invalidated, false);
  assert.equal(recovery.outcome, "proposed");
  assert.equal(recovery.source, "manual-reanalysis");
  assert.equal(Object.hasOwn(recovery, "baseCheckFailed"), false);
  assert.equal(recovery.proposalId, pending.id);
});

test("readSetup: an automatic pending proposal stays pending", async () => {
  const h = await harness({ recovery: { fingerprint: "f", outcome: "proposed", proposal: { status: "suggested" } } });
  const { recovery } = await h.service.readSetup({ cwd: h.root });
  assert.equal(recovery.pending, true);
  assert.equal(recovery.outcome, "proposed");
  assert.equal(recovery.invalidated, false);
});

test("readSetup: a manual proposal whose base team changed is invalidated before approve, not pending", async () => {
  const { h } = await manualHarness({ drift: true });
  const { recovery } = await h.service.readSetup({ cwd: h.root });
  assert.equal(recovery.pending, false);
  assert.equal(recovery.invalidated, true);
  assert.equal(recovery.outcome, "invalidated");
  assert.match(recovery.invalidReason, /active team changed/);
});

test("readSetup: an automatic proposal whose base team changed is invalidated before approve", async () => {
  const base = { profileFingerprint: "fp-1", approvedAt: "2026-10-01T00:00:00.000Z" };
  const h = await harness({
    strategy: activeTeam({ approvedAt: "2026-10-05T00:00:00.000Z" }),
    recovery: { fingerprint: "f", outcome: "proposed", proposal: { status: "suggested" }, basedOn: base }
  });
  const { recovery } = await h.service.readSetup({ cwd: h.root });
  assert.equal(recovery.pending, false);
  assert.equal(recovery.invalidated, true);
  assert.equal(recovery.outcome, "invalidated");
});

test("readSetup: no proposal keeps today's shape", async () => {
  const none = await harness();
  assert.equal((await none.service.readSetup({ cwd: none.root })).recovery, null);
  const done = await harness({ recovery: { fingerprint: "f", outcome: "approved" } });
  const { recovery } = await done.service.readSetup({ cwd: done.root });
  assert.equal(recovery.pending, false);
  assert.equal(recovery.outcome, "approved");
  assert.equal(recovery.invalidated, false);
});

test("readSetup never analyzes, applies or writes any store", async () => {
  const { h, pending } = await manualHarness({ drift: true });
  const before = JSON.stringify(h.store.strategy);
  await h.service.readSetup({ cwd: h.root });
  await h.service.readSetup({ cwd: h.root });
  assert.equal(JSON.stringify(h.store.strategy), before);
  assert.deepEqual({ ...h.counts, resolveRoot: null }, { startRun: 0, strategyWrites: 0, analyze: 0, recoveryWrites: 0, resolveRoot: null });
  assert.ok(pending.id);
});

test("a proposal shown as valid is still refused on approve when the base changes in between", async () => {
  const { h, pending } = await manualHarness();
  assert.equal((await h.service.readSetup({ cwd: h.root })).recovery.invalidated, false);
  h.store.strategy = activeTeam({ approvedAt: "2026-10-09T00:00:00.000Z" });
  await assert.rejects(h.service.approveRecoveryProposal({ cwd: h.root, proposalId: pending.id }), /active team changed/);
  assert.equal(h.counts.strategyWrites, 0);
});

test("readSetup: a failed base read keeps manual and automatic proposals pending", async (t) => {
  const base = activeTeam();
  const proposal = activeTeam({ status: "suggested" });
  const basedOn = { hash: strategyHash(base) };
  const manual = { id: computeProposalId(proposal, basedOn), basedOn, proposal };
  for (const source of ["manual", "automatic"]) {
    await t.test(source, async () => {
      const h = await harness({
        strategy: base,
        recovery: source === "automatic" ? {
          fingerprint: "f", outcome: "proposed", proposal,
          basedOn: { profileFingerprint: base.profileFingerprint, approvedAt: base.approvedAt }
        } : null,
        serviceDeps: {
          readPendingTeamProposal: async () => source === "manual" ? manual : null,
          readProjectStrategy: async () => { throw new Error("Transient strategy read failure"); }
        }
      });
      const { recovery } = await h.service.readSetup({ cwd: h.root });
      assert.equal(recovery.pending, true, source);
      assert.equal(recovery.outcome, "proposed", source);
      assert.equal(recovery.invalidated, false, source);
      assert.equal(recovery.invalidReason, null, source);
      assert.equal(recovery.baseCheckFailed, true, source);
      assert.equal(h.counts.strategyWrites, 0);
      assert.equal(h.counts.recoveryWrites, 0);
    });
  }
});
