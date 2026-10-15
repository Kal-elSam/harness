import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import claude from "../src/global/runtime/execution-adapters/claude.js";
import { supervisePreparedRun } from "../src/global/runtime/run-supervisor.js";
import { writeRunHandoff } from "../src/global/runtime/run-handoff.js";
import { readRunState, writeRunState } from "../src/global/runtime/run-store.js";
import { createRunMetadata, RUN_STATES } from "../src/global/runtime/run-types.js";

async function runFake(t, { effective = "default", permissions = [], model = "claude-haiku-4-5",
  initModel = "claude-haiku-4-5", withoutHook = false, trailingInit = false } = {}) {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-permission-mode-"));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  const runId = "run_permission_mode";
  const handoff = { agentId: "claude", task: "Implement", cwd: homeDir, permissions, model };
  await writeRunState(homeDir, createRunMetadata({ ...handoff, runId, provider: "claude" }));
  await writeRunHandoff(homeDir, runId, handoff);
  const adapter = { ...claude, preflight: async () => ({ ok: true }) };
  if (withoutHook) delete adapter.checkLaunchEvent;
  let child;
  let launch;
  let killed = false;
  const state = await supervisePreparedRun({
    homeDir, runId, resolveAdapterImpl: () => adapter,
    spawnImpl(command, args) {
      launch = { command, args };
      child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.pid = 9191;
      child.kill = () => { killed = true; return true; };
      setImmediate(() => {
        const init = { type: "system", subtype: "init", permissionMode: effective, model: initModel };
        const result = { type: "result", subtype: "success", result: "Done", permission_denials: [] };
        const events = trailingInit ? [result, init] : [init, result];
        child.stdout.emit("data", Buffer.from(events.map(JSON.stringify).join("\n") + (trailingInit ? "" : "\n")));
        child.emit("close", 0);
      });
      return child;
    }
  });
  assert.deepEqual(await readRunState(homeDir, runId), state);
  assert.equal(state.exitCode, 0);
  assert.equal(killed, false, "validation must not kill the child");
  return { state, launch };
}

test("Claude permission-mode downgrade fails despite success result and exit zero", async (t) => {
  const { state, launch } = await runFake(t, { model: "haiku-alias" });
  assert.equal(state.state, RUN_STATES.FAILED);
  assert.match(state.error, /permission mode "default" instead of "auto"/);
  assert.match(state.error, /claude-haiku-4-5/);
  assert.match(state.error, /Sonnet or Opus/);
  assert.deepEqual(launch.args, ["--model", "haiku-alias", "-p", "--output-format", "stream-json",
    "--verbose", "--permission-mode", "auto", "--permission-prompts", "none", "Implement"]);
});

test("matching Claude auto init preserves completion", async (t) => {
  const { state } = await runFake(t, { effective: "auto", initModel: "claude-sonnet-5-5" });
  assert.equal(state.state, RUN_STATES.COMPLETED);
  assert.equal(state.error, null);
});

test("adapter without launch-event hook preserves completion", async (t) => {
  const { state } = await runFake(t, { withoutHook: true });
  assert.equal(state.state, RUN_STATES.COMPLETED);
  assert.equal(state.error, null);
});

test("Claude yolo launch without explicit permission-mode is not checked", async (t) => {
  const { state, launch } = await runFake(t, { permissions: ["yolo"] });
  assert.equal(launch.args.includes("--permission-mode"), false);
  assert.equal(launch.args.includes("--dangerously-skip-permissions"), true);
  assert.equal(state.state, RUN_STATES.COMPLETED);
  assert.equal(state.error, null);
});

test("read-only dontAsk mismatch is checked even in final unterminated init", async (t) => {
  const { state } = await runFake(t, { permissions: ["read-only"], trailingInit: true });
  assert.equal(state.state, RUN_STATES.FAILED);
  assert.match(state.error, /permission mode "default" instead of "dontAsk"/);
});

test("matching read-only dontAsk preserves completion", async (t) => {
  const { state } = await runFake(t, { permissions: ["read-only"], effective: "dontAsk" });
  assert.equal(state.state, RUN_STATES.COMPLETED);
  assert.equal(state.error, null);
});

test("mismatch without init model names the launched model", async (t) => {
  const { state } = await runFake(t, { initModel: null, model: "launch-model" });
  assert.equal(state.state, RUN_STATES.FAILED);
  assert.match(state.error, /launch-model/);
});
