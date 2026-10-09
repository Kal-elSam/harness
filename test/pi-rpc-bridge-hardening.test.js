/**
 * Hardening of the Pi RPC bridge (findings from the /code-review of src/global/host/pi-rpc-bridge.js):
 * async stdin errors, a child left running after a failed handshake, SIGTERM-only stop, unbounded
 * stdout line and event buffers.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { test } from "node:test";
import { KAIRO_WORKSPACE_SNAPSHOT_SCHEMA, openPiRpcBridge } from "../src/global/host/pi-rpc-bridge.js";

const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeChild({ answerState = true, ignoreSigterm = true } = {}) {
  const child = new EventEmitter();
  child.signals = [];
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.failWrites = false;
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of String(chunk).split("\n").filter(Boolean)) {
        const cmd = JSON.parse(line);
        if (answerState && cmd.type === "get_state") {
          queueMicrotask(() => child.stdout.emit("data", Buffer.from(`${JSON.stringify({
            type: "response", id: cmd.id, command: "get_state", success: true, data: { sessionId: "s1", model: null }
          })}\n`)));
        }
      }
      callback(child.failWrites ? new Error("EPIPE: broken pipe") : undefined);
    }
  });
  child.kill = (signal) => {
    child.signals.push(signal);
    child.killed = true;
    if (!ignoreSigterm || signal === "SIGKILL") queueMicrotask(() => child.emit("exit", null, signal));
    return true;
  };
  return child;
}

async function open(child, options = {}) {
  return openPiRpcBridge({
    cwd: "/project",
    loadSnapshot: async () => ({
      schema: KAIRO_WORKSPACE_SNAPSHOT_SCHEMA, project: { label: "demo" }, agents: [], subscriptions: { state: "ready", segments: [] }
    }),
    resolveCliPath: () => "/fake/cli.js",
    loadKairoProviderModels: async () => [],
    spawnImpl: () => child,
    execPath: "/usr/bin/node",
    connectTimeoutMs: 200,
    ...options
  });
}

const line = (record) => Buffer.from(`${JSON.stringify(record)}\n`);

test("an asynchronous stdin error (EPIPE) does not crash the host: the bridge becomes unavailable and later requests reject", async () => {
  const child = fakeChild();
  const bridge = await open(child);
  assert.notEqual(bridge.engine.status, "unavailable");
  child.failWrites = true;
  bridge.sendRaw({ type: "extension_ui_response", id: "x" });
  await settle(40);
  assert.equal(bridge.engine.status, "unavailable");
  assert.match(bridge.engine.reason, /stdin/i);
  await assert.rejects(() => bridge.request({ type: "get_state" }, 50), /stdin|EPIPE/i);
});

test("a second child 'error' event is also absorbed instead of becoming an uncaught exception", async () => {
  const child = fakeChild();
  const bridge = await open(child);
  child.emit("error", new Error("first"));
  child.emit("error", new Error("second"));
  assert.equal(bridge.engine.status, "unavailable");
});

test("request and sendRaw after stop() fail immediately instead of registering work nothing will answer", async () => {
  const child = fakeChild();
  const bridge = await open(child);
  await bridge.stop();
  await assert.rejects(() => bridge.request({ type: "get_state" }, 5000), /stopped/);
  assert.throws(() => bridge.sendRaw({ type: "extension_ui_response", id: "x" }), /stopped/);
});

test("a failed handshake does not leave the Pi child running, and keeps the real reason", async () => {
  const child = fakeChild({ answerState: false });
  const bridge = await open(child, { connectTimeoutMs: 40 });
  assert.equal(bridge.engine.status, "unavailable");
  assert.match(bridge.engine.reason, /timed out/i);
  assert.ok(child.signals.includes("SIGTERM"), "the wedged child was terminated");
  await assert.rejects(() => bridge.request({ type: "get_state" }, 50), /timed out/i);
  assert.match(bridge.engine.reason, /timed out/i, "the original reason survives the child's own exit");
});

test("stop() escalates to SIGKILL when the child ignores SIGTERM, and does not when it exits in time", async () => {
  const stubborn = fakeChild({ ignoreSigterm: true });
  const bridge = await open(stubborn, { stopKillGraceMs: 30 });
  await bridge.stop();
  assert.deepEqual(stubborn.signals, ["SIGTERM"]);
  await settle(90);
  assert.deepEqual(stubborn.signals, ["SIGTERM", "SIGKILL"]);

  const polite = fakeChild({ ignoreSigterm: false });
  const bridge2 = await open(polite, { stopKillGraceMs: 30 });
  await bridge2.stop();
  await settle(90);
  assert.deepEqual(polite.signals, ["SIGTERM"], "an exited child is never SIGKILLed");
});

test("a stdout line without a newline is capped: dropped with a warning, and the stream recovers on the next line", async () => {
  const child = fakeChild();
  const bridge = await open(child, { maxLineBytes: 64 });
  const seen = [];
  bridge.onEvent((record) => seen.push(record));
  child.stdout.emit("data", Buffer.alloc(200, "x"));
  child.stdout.emit("data", Buffer.from("still-the-same-oversized-line\n"));
  child.stdout.emit("data", line({ type: "message_update", n: 1 }));
  await settle(10);
  assert.equal(seen.filter((r) => r.type === "bridge_warning").length, 1);
  assert.deepEqual(seen.filter((r) => r.type === "message_update").map((r) => r.n), [1]);
});

test("the buffered event queue is bounded and keeps the newest events", async () => {
  const child = fakeChild();
  const bridge = await open(child, { maxBufferedEvents: 5 });
  for (let n = 1; n <= 12; n += 1) child.stdout.emit("data", line({ type: "message_update", n }));
  const taken = bridge.takeEvents();
  assert.equal(taken.length, 5);
  assert.deepEqual(taken.map((r) => r.n), [8, 9, 10, 11, 12]);
});
