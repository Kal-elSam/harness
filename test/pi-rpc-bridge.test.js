import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import {
  KAIRO_WORKSPACE_SNAPSHOT_SCHEMA,
  classifyPiEngineFromState,
  openPiRpcBridge
} from "../src/global/host/pi-rpc-bridge.js";

function fakeSnapshot(overrides = {}) {
  return {
    schema: KAIRO_WORKSPACE_SNAPSHOT_SCHEMA,
    project: { label: "demo" },
    agents: [],
    ...overrides
  };
}

/** Minimal child_process stand-in: JSONL on stdout, records stdin writes. */
function createFakeRpcChild({
  onCommand = () => ({ type: "response", command: "get_state", success: true, data: { model: { id: "m1" } } }),
  exitAfterMs = null,
  failSpawn = false
} = {}) {
  if (failSpawn) {
    const child = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdin.write = () => true;
    child.stdin.end = () => {};
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = () => {
      child.killed = true;
    };
    queueMicrotask(() => child.emit("error", new Error("spawn ENOENT")));
    return child;
  }

  const child = new EventEmitter();
  const stdinChunks = [];
  child.stdin = new EventEmitter();
  child.stdin.write = (chunk) => {
    stdinChunks.push(String(chunk));
    const lines = String(chunk).split("\n").filter(Boolean);
    for (const line of lines) {
      let cmd;
      try {
        cmd = JSON.parse(line);
      } catch {
        continue;
      }
      const response = onCommand(cmd);
      if (response) {
        const body = { ...response };
        if (cmd.id != null && body.id == null) body.id = cmd.id;
        queueMicrotask(() => child.stdout.emit("data", Buffer.from(`${JSON.stringify(body)}\n`)));
      }
    }
    return true;
  };
  child.stdin.end = () => {};
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = (signal) => {
    child.killed = true;
    child.emit("exit", 0, signal ?? null);
  };
  child._stdinChunks = stdinChunks;
  if (exitAfterMs != null) {
    setTimeout(() => child.emit("exit", 1, null), exitAfterMs);
  }
  return child;
}

test("classifyPiEngineFromState: missing model is no_model when RPC already answered get_state", () => {
  assert.deepEqual(classifyPiEngineFromState({}), {
    status: "no_model",
    reason: "No model selected",
    sessionId: null,
    model: null
  });
  assert.equal(classifyPiEngineFromState({ model: { id: "x" } }).status, "connected");
});

test("openPiRpcBridge always returns hostOpen with workspace-shell/v1 snapshot even when Pi spawn fails", async () => {
  const bridge = await openPiRpcBridge({
    cwd: "/project",
    loadSnapshot: async () => fakeSnapshot(),
    resolveCliPath: () => "/fake/cli.js",
    spawnImpl: () => createFakeRpcChild({ failSpawn: true }),
    execPath: "/usr/bin/node",
    connectTimeoutMs: 200
  });

  assert.equal(bridge.hostOpen, true);
  assert.equal(bridge.snapshot.schema, KAIRO_WORKSPACE_SNAPSHOT_SCHEMA);
  assert.equal(bridge.engine.status, "unavailable");
  assert.match(bridge.engine.reason, /spawn|ENOENT|Agent process/i);
  await bridge.stop();
});

test("openPiRpcBridge reports simulated get_state-without-model as no_model (not real Pi cold-start)", async () => {
  const bridge = await openPiRpcBridge({
    cwd: "/project",
    loadSnapshot: async () => fakeSnapshot({ agents: [{ id: "orch", state: "idle" }] }),
    resolveCliPath: () => "/fake/cli.js",
    spawnImpl: () =>
      createFakeRpcChild({
        onCommand: (cmd) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: { sessionId: "sess-1" }
            };
          }
          return { type: "response", command: cmd.type, success: false, error: "unexpected" };
        }
      }),
    execPath: "/usr/bin/node",
    connectTimeoutMs: 500
  });

  assert.equal(bridge.hostOpen, true);
  assert.equal(bridge.engine.status, "no_model");
  assert.equal(bridge.engine.sessionId, "sess-1");
  assert.equal(bridge.snapshot.agents[0].id, "orch");
  await bridge.stop();
});

test("openPiRpcBridge spawns Pi with --mode rpc and connects when model is present", async () => {
  let spawnArgs = null;
  const bridge = await openPiRpcBridge({
    cwd: "/project",
    loadSnapshot: async () => fakeSnapshot(),
    resolveCliPath: () => "/abs/kairo-pi/dist/bundle/cli.js",
    spawnImpl: (command, args, options) => {
      spawnArgs = { command, args, options };
      return createFakeRpcChild({
        onCommand: (cmd) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: {
                sessionId: "abc",
                model: { provider: "opencode", id: "flash" }
              }
            };
          }
          return null;
        }
      });
    },
    execPath: "/usr/bin/node",
    connectTimeoutMs: 500
  });

  assert.equal(bridge.hostOpen, true);
  assert.equal(bridge.engine.status, "connected");
  assert.equal(bridge.engine.model.id, "flash");
  assert.equal(spawnArgs.command, "/usr/bin/node");
  assert.ok(spawnArgs.args.includes("--mode"));
  assert.ok(spawnArgs.args.includes("rpc"));
  assert.equal(spawnArgs.args[0], "/abs/kairo-pi/dist/bundle/cli.js");
  assert.equal(spawnArgs.options.stdio[0], "pipe");
  assert.equal(spawnArgs.options.stdio[1], "pipe");
  assert.equal(spawnArgs.options.cwd, "/project");
  await bridge.stop();
});

test("openPiRpcBridge still opens when get_state fails after spawn", async () => {
  const bridge = await openPiRpcBridge({
    cwd: "/project",
    loadSnapshot: async () => fakeSnapshot(),
    resolveCliPath: () => "/fake/cli.js",
    spawnImpl: () =>
      createFakeRpcChild({
        onCommand: (cmd) => ({
          type: "response",
          command: cmd.type,
          success: false,
          error: "Model catalog empty"
        })
      }),
    execPath: "/usr/bin/node",
    connectTimeoutMs: 500
  });

  assert.equal(bridge.hostOpen, true);
  assert.equal(bridge.engine.status, "unavailable");
  assert.match(bridge.engine.reason, /Model catalog empty|get_state/i);
  await bridge.stop();
});

test("R3: session events are consumable via onEvent and takeEvents", async () => {
  let childRef = null;
  const seen = [];
  const bridge = await openPiRpcBridge({
    cwd: "/project",
    loadSnapshot: async () => fakeSnapshot(),
    resolveCliPath: () => "/fake/cli.js",
    spawnImpl: () => {
      childRef = createFakeRpcChild({
        onCommand: (cmd) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: { sessionId: "s", model: { id: "m" } }
            };
          }
          return null;
        }
      });
      return childRef;
    },
    execPath: "/usr/bin/node",
    connectTimeoutMs: 500
  });

  assert.equal(bridge.engine.status, "connected");
  const unsubscribe = bridge.onEvent((ev) => seen.push(ev));
  childRef.stdout.emit(
    "data",
    Buffer.from(`${JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hi" } })}\n`)
  );
  await new Promise((r) => queueMicrotask(r));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].type, "message_update");
  const drained = bridge.takeEvents();
  assert.equal(drained.length, 1);
  assert.equal(drained[0].type, "message_update");
  assert.deepEqual(bridge.takeEvents(), []);
  unsubscribe();
  childRef.stdout.emit(
    "data",
    Buffer.from(`${JSON.stringify({ type: "agent_end" })}\n`)
  );
  await new Promise((r) => queueMicrotask(r));
  assert.equal(seen.length, 1); // unsubscribed
  assert.equal(bridge.takeEvents().length, 1);
  await bridge.stop();
});

test("R3: unexpected Pi exit after connect flips engine off connected; host stays open", async () => {
  let childRef = null;
  const bridge = await openPiRpcBridge({
    cwd: "/project",
    loadSnapshot: async () => fakeSnapshot(),
    resolveCliPath: () => "/fake/cli.js",
    spawnImpl: () => {
      childRef = createFakeRpcChild({
        onCommand: (cmd) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: { sessionId: "live", model: { id: "m" } }
            };
          }
          return null;
        }
      });
      return childRef;
    },
    execPath: "/usr/bin/node",
    connectTimeoutMs: 500
  });

  assert.equal(bridge.engine.status, "connected");
  childRef.emit("exit", 1, null);
  await new Promise((r) => queueMicrotask(r));
  assert.equal(bridge.hostOpen, true);
  assert.equal(bridge.engine.status, "unavailable");
  assert.match(bridge.engine.reason, /exited with code 1/);
  assert.equal(bridge.engine.sessionId, "live");
  await bridge.stop();
});

test("R3: intentional stop does not mark engine unavailable as a crash", async () => {
  const bridge = await openPiRpcBridge({
    cwd: "/project",
    loadSnapshot: async () => fakeSnapshot(),
    resolveCliPath: () => "/fake/cli.js",
    spawnImpl: () =>
      createFakeRpcChild({
        onCommand: (cmd) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: { sessionId: "s", model: { id: "m" } }
            };
          }
          return null;
        }
      }),
    execPath: "/usr/bin/node",
    connectTimeoutMs: 500
  });

  assert.equal(bridge.engine.status, "connected");
  await bridge.stop();
  assert.equal(bridge.engine.status, "stopped");
  assert.equal(bridge.hostOpen, true);
});
