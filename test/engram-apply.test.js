import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { assertSafeSetupInvocation, redactEngramLog, runEngramSetup } from "../src/global/integrations/engram-exec.js";
import { applyEngramConfigure } from "../src/global/integrations/engram-apply.js";
import { ENGRAM_INTEGRATION_STATUS } from "../src/global/integrations/engram-evidence.js";

function fakeChild({ exitStatus = 0, stdout = "ok", stderr = "", hang = false } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => true;
  child.unref = () => {};
  queueMicrotask(() => {
    if (hang) return;
    child.stdout.emit("data", stdout);
    if (stderr) child.stderr.emit("data", stderr);
    child.emit("close", exitStatus, null);
  });
  return child;
}

test("executor safety, timeout, consent, and partial stop", async () => {
  assert.throws(() => assertSafeSetupInvocation("engram", "codex"), /absolute/);
  assert.throws(() => assertSafeSetupInvocation("/tmp/engram.db", "codex"), /memory database/);
  assert.match(redactEngramLog("OPENAI_API_KEY=sk-secret Bearer abc"), /REDACTED/);

  const ok = await runEngramSetup({
    binaryPath: "/opt/engram",
    slug: "codex",
    spawnImpl: () => fakeChild({ stdout: "OPENAI_API_KEY=sk-live setup done" })
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.command, ["/opt/engram", "setup", "codex"]);
  assert.match(ok.stdout, /REDACTED/);

  const timed = await runEngramSetup({
    binaryPath: "/opt/engram",
    slug: "cursor",
    timeoutMs: 20,
    terminationGraceMs: 5,
    killGraceMs: 5,
    spawnImpl: () => fakeChild({ hang: true })
  });
  assert.equal(timed.timedOut, true);

  await assert.rejects(
    () => applyEngramConfigure({
      requestedAgentIds: ["codex"], dryRun: false, yes: false, interactive: false,
      plan: () => ({
        blocked: false, guidance: null,
        binary: { path: "/opt/engram", version: "1.19.0", supported: true },
        actions: [{ agentId: "codex", slug: "codex", action: "setup", command: ["/opt/engram", "setup", "codex"] }]
      })
    }),
    /requires --yes/
  );

  let calls = 0;
  const partial = await applyEngramConfigure({
    requestedAgentIds: ["codex", "opencode"],
    dryRun: false, yes: true, interactive: false,
    plan: () => ({
      blocked: false,
      binary: { path: "/opt/engram", version: "1.19.0", supported: true },
      actions: [
        { agentId: "codex", slug: "codex", action: "setup", command: ["/opt/engram", "setup", "codex"] },
        { agentId: "opencode", slug: "opencode", action: "setup", command: ["/opt/engram", "setup", "opencode"] }
      ]
    }),
    runSetup: async ({ slug }) => {
      calls += 1;
      return slug === "codex"
        ? { ok: true, command: ["/opt/engram", "setup", "codex"], slug, status: 0, signal: null, timedOut: false, terminationFailed: false, stdout: "ok", stderr: "" }
        : { ok: false, command: ["/opt/engram", "setup", "opencode"], slug, status: 2, signal: null, timedOut: false, terminationFailed: false, stdout: "", stderr: "boom" };
    }
  });
  assert.equal(calls, 2);
  assert.equal(partial.receipt.partial, true);
  assert.deepEqual(partial.receipt.agentsCompleted, ["codex"]);
  assert.deepEqual(partial.receipt.agentsRemaining, ["opencode"]);
  assert.equal(partial.receipt.touchedMemoryDb, false);
  assert.equal(partial.receipt.status, ENGRAM_INTEGRATION_STATUS.CONFLICT);
});
