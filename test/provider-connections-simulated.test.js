// SIMULATED contract double only — never a production backend.
// Does not spawn provider CLIs, touch the network, or read ~/.harness.
// Production path: createProviderConnections + host-bridged interactive runner.
import test from "node:test";
import assert from "node:assert/strict";
import { createSimulatedConnectionsBackend } from "../src/global/host/provider-connections-simulated.js";

test("simulated double: success authenticates without verifying catalogued models", async () => {
  const backend = createSimulatedConnectionsBackend({ scenario: "success", now: () => 1_700_000_000_000 });
  const preview = await backend.preview({ provider: "claude" });
  assert.equal(preview.ok, true);
  const connected = await backend.connect({
    provider: "claude",
    fingerprint: preview.fingerprint,
    confirm: true
  });
  assert.equal(connected.ok, true);
  const status = await backend.status({ provider: "claude" });
  assert.equal(status.providers[0].authentication.state, "authenticated");
  assert.ok(status.providers[0].modelAccess.some((m) => m.state === "catalogued"));
});

test("simulated double: cancel and fail never report connected", async () => {
  for (const scenario of ["cancel", "fail"]) {
    const backend = createSimulatedConnectionsBackend({ scenario, now: () => 1_700_000_000_000 });
    const preview = await backend.preview({ provider: "claude" });
    const connected = await backend.connect({
      provider: "claude",
      fingerprint: preview.fingerprint,
      confirm: true
    });
    assert.equal(connected.ok, false, scenario);
    assert.notEqual(connected.reason, "connected", scenario);
  }
});
