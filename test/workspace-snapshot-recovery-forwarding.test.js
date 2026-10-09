import test from "node:test";
import assert from "node:assert/strict";
import { approveKairoRecovery, recoverKairoProjectTeam, rejectKairoRecovery } from "../src/global/host/workspace-snapshot.js";

// The host wrappers sit between the Ratatui sidecar and the conversation
// service. If they drop the human's analyst pick, the reopen flag or the
// viewed proposal id, the service silently falls back to its unsafe-by-default
// legacy behavior - so each argument is asserted to arrive.

function spyService() {
  const calls = [];
  const create = () => ({
    recoverProjectTeam: async (args) => { calls.push(["recover", args]); return { outcome: "proposed" }; },
    approveRecoveryProposal: async (args) => { calls.push(["approve", args]); return { outcome: "approved" }; },
    rejectRecoveryProposal: async (args) => { calls.push(["reject", args]); return { outcome: "rejected" }; }
  });
  return { calls, deps: { createConversationService: create } };
}

test("recoverKairoProjectTeam forwards the human's analyst pick and the reopen flag", async () => {
  const { calls, deps } = spyService();
  const analyst = { model: { adapterId: "claude", modelId: "m" } };
  await recoverKairoProjectTeam({ cwd: "/p", analyst, reopenPending: true }, deps);
  assert.deepEqual(calls, [["recover", { cwd: "/p", analyst, reopenPending: true }]]);
});

test("recoverKairoProjectTeam keeps the legacy call shape when nothing extra is given", async () => {
  const { calls, deps } = spyService();
  await recoverKairoProjectTeam({ cwd: "/p" }, deps);
  assert.deepEqual(calls, [["recover", { cwd: "/p" }]]);
});

test("approve and reject forward the viewed proposal id", async () => {
  const { calls, deps } = spyService();
  await approveKairoRecovery({ cwd: "/p", proposalId: "p-1" }, deps);
  await rejectKairoRecovery({ cwd: "/p", proposalId: "p-2" }, deps);
  await approveKairoRecovery({ cwd: "/p" }, deps);
  assert.deepEqual(calls, [
    ["approve", { cwd: "/p", proposalId: "p-1" }],
    ["reject", { cwd: "/p", proposalId: "p-2" }],
    ["approve", { cwd: "/p" }]
  ]);
});
