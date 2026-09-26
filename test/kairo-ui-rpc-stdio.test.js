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
  let activeModel = null;
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
      const response = onCommand(cmd, {
        activeModel,
        setModel: (model) => {
          activeModel = model;
        }
      });
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

const architectModel = {
  id: "codex::m1",
  kairoRoute: { role: "Architect", adapterId: "codex", modelId: "m1" }
};

function mockOpenBridge(factory) {
  return async (opts) => {
    const child = factory();
    return openPiRpcBridge({
      cwd: opts?.cwd ?? "/project",
      loadSnapshot: async () => fakeSnapshot(),
      resolveCliPath: () => "/fake/cli.js",
      loadKairoProviderModels: async () => [architectModel],
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
        onCommand: (cmd, ctx) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: {
                sessionId: "s1",
                model: ctx?.activeModel ?? null
              }
            };
          }
          if (cmd.type === "set_model") {
            if (ctx?.setModel) ctx.setModel({ id: cmd.modelId, provider: "kairo" });
            return {
              type: "response",
              command: "set_model",
              success: true,
              data: { id: cmd.modelId, provider: "kairo" }
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

test("sidecar ready carries unavailable engine reason when Pi CLI cannot resolve", async () => {
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
    openBridge: async () =>
      openPiRpcBridge({
        cwd: "/project",
        loadSnapshot: async () => fakeSnapshot(),
        resolveCliPath: () => {
          throw new Error("Cannot find package '@kal-elsam/kairo-pi-coding-agent'");
        },
        spawnImpl: () => {
          throw new Error("spawn must not run when CLI resolve fails");
        },
        connectTimeoutMs: 200
      })
  });

  await new Promise((r) => setTimeout(r, 40));
  assert.equal(out[0]?.type, "ready");
  assert.equal(out[0]?.engine?.status, "unavailable");
  assert.match(
    String(out[0]?.engine?.reason ?? ""),
    /kairo-pi-coding-agent/
  );
  assert.equal(out[0]?.snapshot?.schema, KAIRO_WORKSPACE_SNAPSHOT_SCHEMA);

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
        onCommand: (cmd, ctx) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: { model: ctx?.activeModel ?? { id: "m" } }
            };
          }
          if (cmd.type === "set_model") {
            if (ctx?.setModel) ctx.setModel({ id: cmd.modelId });
            return { type: "response", command: "set_model", success: true };
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
        onCommand: (cmd, ctx) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: {
                sessionId: "live",
                model: ctx?.activeModel ?? { id: "m" }
              }
            };
          }
          if (cmd.type === "set_model") {
            if (ctx?.setModel) ctx.setModel({ id: cmd.modelId });
            return { type: "response", command: "set_model", success: true };
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

test("sidecar cycle_model calls set_model for next Kairo route", async () => {
  const setModelCalls = [];
  const models = [
    architectModel,
    {
      id: "claude::m2",
      kairoRoute: { role: "Builder", adapterId: "claude", modelId: "m2" }
    }
  ];
  const stdout = new PassThrough();
  const out = [];
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
    loadKairoProviderModels: async () => models,
    openBridge: async (opts) => {
      const child = createFakeRpcChild({
        onCommand: (cmd, ctx) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: {
                sessionId: "s1",
                model: ctx?.activeModel ?? { id: architectModel.id }
              }
            };
          }
          if (cmd.type === "set_model") {
            setModelCalls.push(cmd);
            if (ctx?.setModel) ctx.setModel({ id: cmd.modelId, name: cmd.modelId });
            return { type: "response", command: "set_model", success: true };
          }
          if (cmd.type === "get_messages") {
            return {
              type: "response",
              command: "get_messages",
              success: true,
              data: { messages: [] }
            };
          }
          return null;
        }
      });
      return openPiRpcBridge({
        cwd: opts?.cwd ?? "/project",
        loadSnapshot: async () => fakeSnapshot(),
        resolveCliPath: () => "/fake/cli.js",
        loadKairoProviderModels: async () => models,
        spawnImpl: () => child,
        execPath: "/usr/bin/node",
        connectTimeoutMs: 500
      });
    }
  });

  await new Promise((r) => setTimeout(r, 40));
  stdin.write(`${JSON.stringify({ op: "cycle_model" })}\n`);
  await new Promise((r) => setTimeout(r, 80));
  assert.ok(setModelCalls.length >= 1, "open + cycle should call set_model");
  const last = setModelCalls.at(-1);
  assert.equal(last.provider, "kairo");
  assert.equal(last.modelId, "claude::m2");
  assert.ok(out.some((r) => r.type === "engine"));

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("sidecar new_session reloads transcript from get_messages", async () => {
  const stdout = new PassThrough();
  const out = [];
  stdout.on("data", (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) {
      out.push(JSON.parse(line));
    }
  });
  const stdin = new PassThrough();

  const runPromise = runKairoUiRpcStdio({
    stdin,
    stdout,
    openBridge: mockOpenBridge(() =>
      createFakeRpcChild({
        onCommand: (cmd, ctx) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: {
                sessionId: "fresh",
                model: ctx?.activeModel ?? { id: architectModel.id }
              }
            };
          }
          if (cmd.type === "set_model") {
            if (ctx?.setModel) ctx.setModel({ id: cmd.modelId });
            return { type: "response", command: "set_model", success: true };
          }
          if (cmd.type === "new_session") {
            return {
              type: "response",
              command: "new_session",
              success: true,
              data: { cancelled: false }
            };
          }
          if (cmd.type === "get_messages") {
            return {
              type: "response",
              command: "get_messages",
              success: true,
              data: {
                messages: [
                  {
                    role: "user",
                    content: [{ type: "text", text: "after reset" }]
                  }
                ]
              }
            };
          }
          return null;
        }
      })
    )
  });

  await new Promise((r) => setTimeout(r, 30));
  stdin.write(`${JSON.stringify({ op: "new_session" })}\n`);
  await new Promise((r) => setTimeout(r, 80));
  const transcript = out.find((r) => r.type === "transcript");
  assert.ok(transcript);
  assert.deepEqual(transcript.messages, [{ role: "user", content: "after reset" }]);

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("sidecar new_session re-applies Architect set_model when get_state has no model", async () => {
  const setModelCalls = [];
  let afterNewSession = false;
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
    loadKairoProviderModels: async () => [architectModel],
    openBridge: async (opts) => {
      const child = createFakeRpcChild({
        onCommand: (cmd, ctx) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: {
                sessionId: afterNewSession ? "fresh" : "s1",
                model: ctx?.activeModel ?? null
              }
            };
          }
          if (cmd.type === "set_model") {
            setModelCalls.push(cmd);
            if (ctx?.setModel) {
              ctx.setModel({ id: cmd.modelId, provider: "kairo", name: cmd.modelId });
            }
            return {
              type: "response",
              command: "set_model",
              success: true,
              data: { id: cmd.modelId, provider: "kairo" }
            };
          }
          if (cmd.type === "new_session") {
            afterNewSession = true;
            if (ctx?.setModel) ctx.setModel(null);
            return {
              type: "response",
              command: "new_session",
              success: true,
              data: { cancelled: false }
            };
          }
          if (cmd.type === "get_messages") {
            return {
              type: "response",
              command: "get_messages",
              success: true,
              data: { messages: [] }
            };
          }
          return null;
        }
      });
      return openPiRpcBridge({
        cwd: opts?.cwd ?? "/project",
        loadSnapshot: async () => fakeSnapshot(),
        resolveCliPath: () => "/fake/cli.js",
        loadKairoProviderModels: async () => [architectModel],
        spawnImpl: () => child,
        execPath: "/usr/bin/node",
        connectTimeoutMs: 500
      });
    }
  });

  await new Promise((r) => setTimeout(r, 40));
  const setModelsBeforeNewSession = setModelCalls.length;
  assert.ok(setModelsBeforeNewSession >= 1, "open bridge should set Architect once");
  assert.equal(setModelCalls.at(-1)?.modelId, architectModel.id);

  stdin.write(`${JSON.stringify({ op: "new_session" })}\n`);
  await new Promise((r) => setTimeout(r, 100));

  assert.ok(
    setModelCalls.length > setModelsBeforeNewSession,
    "new_session must re-apply Architect via set_model"
  );
  assert.equal(setModelCalls.at(-1)?.provider, "kairo");
  assert.equal(setModelCalls.at(-1)?.modelId, architectModel.id);
  const engineAfter = [...out].reverse().find((r) => r.type === "engine");
  assert.equal(engineAfter?.engine?.status, "connected");
  assert.equal(engineAfter?.engine?.model?.id, architectModel.id);

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("sidecar cycle_model does not re-apply Architect after the cycle", async () => {
  const setModelCalls = [];
  const models = [
    architectModel,
    {
      id: "claude::m2",
      kairoRoute: { role: "Builder", adapterId: "claude", modelId: "m2" }
    }
  ];
  const stdout = new PassThrough();
  const stdin = new PassThrough();

  const runPromise = runKairoUiRpcStdio({
    stdin,
    stdout,
    cwd: "/project",
    loadKairoProviderModels: async () => models,
    openBridge: async (opts) => {
      const child = createFakeRpcChild({
        onCommand: (cmd, ctx) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: {
                sessionId: "s1",
                model: ctx?.activeModel ?? { id: architectModel.id }
              }
            };
          }
          if (cmd.type === "set_model") {
            setModelCalls.push(cmd);
            if (ctx?.setModel) ctx.setModel({ id: cmd.modelId, name: cmd.modelId });
            return { type: "response", command: "set_model", success: true };
          }
          return null;
        }
      });
      return openPiRpcBridge({
        cwd: opts?.cwd ?? "/project",
        loadSnapshot: async () => fakeSnapshot(),
        resolveCliPath: () => "/fake/cli.js",
        loadKairoProviderModels: async () => models,
        spawnImpl: () => child,
        execPath: "/usr/bin/node",
        connectTimeoutMs: 500
      });
    }
  });

  await new Promise((r) => setTimeout(r, 40));
  const beforeCycle = setModelCalls.length;
  stdin.write(`${JSON.stringify({ op: "cycle_model" })}\n`);
  await new Promise((r) => setTimeout(r, 80));
  const afterCycle = setModelCalls.slice(beforeCycle);
  assert.equal(afterCycle.length, 1, "cycle_model must set_model once, not re-apply Architect");
  assert.equal(afterCycle[0]?.modelId, "claude::m2");

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});
