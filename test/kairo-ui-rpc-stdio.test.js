import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import {
  KAIRO_WORKSPACE_SNAPSHOT_SCHEMA,
  openPiRpcBridge
} from "../src/global/host/pi-rpc-bridge.js";
import { runKairoUiRpcStdio } from "../src/global/host/kairo-ui-rpc-stdio.js";

function fakeSnapshot(overrides = {}) {
  return {
    schema: KAIRO_WORKSPACE_SNAPSHOT_SCHEMA,
    project: { label: "demo" },
    agents: [{ label: "Orchestrator", state: "idle", provider: "mock" }],
    subscriptions: { state: "checking", segments: [] },
    ...overrides
  };
}

function createFakeRpcChild({ onCommand = () => null } = {}) {
  const child = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdin.write = (chunk) => {
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
  child.kill = () => {
    child.killed = true;
    child.emit("exit", 0, null);
  };
  return child;
}

function mockOpenBridge(factory) {
  return async (opts) => {
    const child = factory();
    return openPiRpcBridge({
      cwd: opts?.cwd ?? "/project",
      loadSnapshot: async () => fakeSnapshot(),
      resolveCliPath: () => "/fake/cli.js",
      spawnImpl: () => child,
      execPath: "/usr/bin/node",
      connectTimeoutMs: 500
    });
  };
}

test("sidecar emits ready then forwards prompt stream and agent_settled", async () => {
  let childRef = null;
  const out = [];
  const stdout = new PassThrough();
  stdout.on("data", (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) {
      out.push(JSON.parse(line));
    }
  });
  const stdin = new PassThrough();

  const runPromise = runKairoUiRpcStdio({
    stdin,
    stdout,
    cwd: "/project",
    openBridge: mockOpenBridge(() => {
      childRef = createFakeRpcChild({
        onCommand: (cmd) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: { sessionId: "s1", model: { id: "m1" } }
            };
          }
          if (cmd.type === "prompt") {
            queueMicrotask(() => {
              childRef.stdout.emit(
                "data",
                Buffer.from(
                  `${JSON.stringify({
                    type: "message_update",
                    assistantMessageEvent: { type: "text_delta", delta: "ok" }
                  })}\n`
                )
              );
              childRef.stdout.emit(
                "data",
                Buffer.from(`${JSON.stringify({ type: "agent_settled" })}\n`)
              );
            });
            return { type: "response", command: "prompt", success: true };
          }
          return null;
        }
      });
      return childRef;
    })
  });

  await new Promise((r) => setTimeout(r, 50));
  assert.equal(out[0]?.type, "ready");
  assert.equal(out[0]?.engine?.status, "connected");
  assert.equal(out[0]?.snapshot?.schema, KAIRO_WORKSPACE_SNAPSHOT_SCHEMA);
  assert.ok(Array.isArray(out[0]?.snapshot?.agents));
  assert.equal(out[0]?.snapshot?.agents?.length, 1);
  assert.deepEqual(out[0]?.snapshot?.subscriptions, {
    state: "checking",
    segments: []
  });

  stdin.write(`${JSON.stringify({ op: "prompt", message: "hello" })}\n`);
  await new Promise((r) => setTimeout(r, 80));

  const types = out.map((r) => r.type);
  assert.ok(types.includes("message_update"));
  assert.ok(types.includes("agent_settled"));

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("sidecar abort forwards abort command to Pi", async () => {
  const abortCalls = [];
  const stdout = new PassThrough();
  const stdin = new PassThrough();

  const runPromise = runKairoUiRpcStdio({
    stdin,
    stdout,
    openBridge: mockOpenBridge(() =>
      createFakeRpcChild({
        onCommand: (cmd) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: { model: { id: "m" } }
            };
          }
          if (cmd.type === "abort") {
            abortCalls.push(cmd);
            return { type: "response", command: "abort", success: true };
          }
          return null;
        }
      })
    )
  });

  await new Promise((r) => setTimeout(r, 30));
  stdin.write(`${JSON.stringify({ op: "abort" })}\n`);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(abortCalls.length, 1);

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("sidecar stays alive and emits engine_unavailable after Pi exit", async () => {
  let childRef = null;
  const out = [];
  const stdout = new PassThrough();
  stdout.on("data", (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) {
      out.push(JSON.parse(line));
    }
  });
  const stdin = new PassThrough();

  const runPromise = runKairoUiRpcStdio({
    stdin,
    stdout,
    openBridge: mockOpenBridge(() => {
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
    })
  });

  await new Promise((r) => setTimeout(r, 30));
  childRef.emit("exit", 1, null);
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(out.some((r) => r.type === "engine_unavailable"));

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});
