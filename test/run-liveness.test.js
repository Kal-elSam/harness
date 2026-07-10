import test from "node:test";
import assert from "node:assert/strict";
import { isProcessAlive, isRunAlive } from "../src/global/runtime/run-liveness.js";

test("isProcessAlive detects current process", () => {
  assert.equal(isProcessAlive(process.pid), true);
  assert.equal(isProcessAlive(999999999), false);
});

test("isRunAlive checks agent pid from supervisor lock", async () => {
  const alive = await isRunAlive("/tmp", { pid: null }, {
    readSupervisorLockImpl: async () => ({ agentPid: process.pid })
  });
  assert.equal(alive, true);
});
