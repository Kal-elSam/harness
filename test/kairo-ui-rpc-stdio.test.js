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
  assert.deepEqual(transcript.messages, [{ type: "user_message", content: "after reset" }]);

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

test("sidecar project.analyze notices progress then emits team summary and fresh snapshot", async () => {
  const out = [];
  const stdout = new PassThrough();
  stdout.on("data", (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) {
      out.push(JSON.parse(line));
    }
  });
  const stdin = new PassThrough();
  const analyzeCalls = [];

  const runPromise = runKairoUiRpcStdio({
    stdin,
    stdout,
    cwd: "/project",
    openBridge: mockOpenBridge(() =>
      createFakeRpcChild({
        onCommand: (cmd, ctx) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: { sessionId: "s1", model: ctx?.activeModel ?? null }
            };
          }
          if (cmd.type === "set_model") {
            if (ctx?.setModel) ctx.setModel({ id: cmd.modelId, provider: "kairo" });
            return { type: "response", command: "set_model", success: true };
          }
          return null;
        }
      })
    ),
    analyzeProjectTeam: async ({ cwd }) => {
      analyzeCalls.push(cwd);
      return {
        state: "suggested",
        teamRows: 3,
        roles: ["Architect", "Builder", "Reviewer"],
        analyst: "codex · GPT-5",
        projectRoot: cwd,
        notice: null
      };
    },
    loadSnapshot: async () =>
      fakeSnapshot({ team: { state: "suggested", rows: [], assignments: [] } })
  });

  await new Promise((r) => setTimeout(r, 40));
  const before = out.length;
  stdin.write(`${JSON.stringify({ op: "project.analyze" })}\n`);
  await new Promise((r) => setTimeout(r, 80));

  const after = out.slice(before);
  assert.deepEqual(analyzeCalls, ["/project"]);
  assert.match(
    String(after.find((r) => r.type === "notice")?.message ?? ""),
    /Analyzing project team/
  );
  const team = after.find((r) => r.type === "team");
  assert.equal(team?.op, "project.analyze");
  assert.equal(team?.ok, true);
  assert.equal(team?.state, "suggested");
  assert.equal(team?.teamRows, 3);
  const snapshot = after.find((r) => r.type === "snapshot");
  assert.equal(snapshot?.snapshot?.team?.state, "suggested");

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("sidecar project.analyze reports a failure honestly and emits no team snapshot", async () => {
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
    openBridge: mockOpenBridge(() =>
      createFakeRpcChild({
        onCommand: (cmd, ctx) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: { sessionId: "s1", model: ctx?.activeModel ?? null }
            };
          }
          if (cmd.type === "set_model") {
            if (ctx?.setModel) ctx.setModel({ id: cmd.modelId, provider: "kairo" });
            return { type: "response", command: "set_model", success: true };
          }
          return null;
        }
      })
    ),
    analyzeProjectTeam: async () => {
      throw new Error("No ask-capable analyst model in this project's catalog");
    },
    loadSnapshot: async () => {
      throw new Error("snapshot must not be reloaded after a failed analysis");
    }
  });

  await new Promise((r) => setTimeout(r, 40));
  const before = out.length;
  stdin.write(`${JSON.stringify({ op: "project.analyze" })}\n`);
  await new Promise((r) => setTimeout(r, 80));

  const after = out.slice(before);
  assert.match(
    String(after.find((r) => r.type === "error")?.message ?? ""),
    /No ask-capable analyst model/
  );
  const team = after.find((r) => r.type === "team");
  assert.equal(team?.ok, false);
  assert.equal(
    after.some((r) => r.type === "snapshot"),
    false
  );

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("sidecar project.preflight returns the real analyst catalog for the ratatui picker, without touching the engine", async () => {
  const out = [];
  const stdout = new PassThrough();
  stdout.on("data", (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) {
      out.push(JSON.parse(line));
    }
  });
  const stdin = new PassThrough();
  const preflightCalls = [];
  const catalog = {
    recommendedModel: { candidateKey: "codex::gpt-5" },
    models: [
      { candidateKey: "codex::gpt-5", adapterId: "codex", modelId: "gpt-5", displayName: "GPT-5", available: true, recommendationTags: ["quality"] }
    ]
  };

  const runPromise = runKairoUiRpcStdio({
    stdin,
    stdout,
    cwd: "/project",
    openBridge: mockOpenBridge(() =>
      createFakeRpcChild({
        onCommand: (cmd, ctx) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: { sessionId: "s1", model: ctx?.activeModel ?? null }
            };
          }
          if (cmd.type === "set_model") {
            if (ctx?.setModel) ctx.setModel({ id: cmd.modelId, provider: "kairo" });
            return { type: "response", command: "set_model", success: true };
          }
          return null;
        }
      })
    ),
    preflightProjectTeam: async ({ cwd }) => {
      preflightCalls.push(cwd);
      return { analystCatalog: catalog, profile: { fp: "x" }, candidates: { scoredAll: [] }, projectRoot: cwd, unverifiedClaudeNotice: null };
    }
  });

  await new Promise((r) => setTimeout(r, 40));
  stdin.write(`${JSON.stringify({ op: "project.preflight" })}\n`);
  await new Promise((r) => setTimeout(r, 60));

  assert.deepEqual(preflightCalls, ["/project"]);
  const preflight = out.find((r) => r.type === "preflight");
  assert.equal(preflight?.ok, true);
  assert.deepEqual(preflight?.analystCatalog, catalog);
  assert.deepEqual(preflight?.profile, { fp: "x" });

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("sidecar project.preflight reports a real failure honestly, as ok:false — never a crash", async () => {
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
    openBridge: mockOpenBridge(() =>
      createFakeRpcChild({
        onCommand: (cmd, ctx) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: { sessionId: "s1", model: ctx?.activeModel ?? null }
            };
          }
          if (cmd.type === "set_model") {
            if (ctx?.setModel) ctx.setModel({ id: cmd.modelId, provider: "kairo" });
            return { type: "response", command: "set_model", success: true };
          }
          return null;
        }
      })
    ),
    preflightProjectTeam: async () => {
      throw new Error("No provider CLI is authenticated");
    }
  });

  await new Promise((r) => setTimeout(r, 40));
  stdin.write(`${JSON.stringify({ op: "project.preflight" })}\n`);
  await new Promise((r) => setTimeout(r, 60));

  const preflight = out.find((r) => r.type === "preflight");
  assert.equal(preflight?.ok, false);
  assert.match(preflight?.reason ?? "", /No provider CLI is authenticated/);

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("sidecar project.analyze forwards the picker's chosen analyst payload verbatim", async () => {
  const out = [];
  const stdout = new PassThrough();
  stdout.on("data", (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) {
      out.push(JSON.parse(line));
    }
  });
  const stdin = new PassThrough();
  const analyzeCalls = [];
  const chosenAnalyst = {
    model: { adapterId: "claude", modelId: "sonnet", displayName: "Claude Sonnet" },
    selectionSource: "manual",
    recommendationTags: ["efficient"],
    choice: "efficient"
  };

  const runPromise = runKairoUiRpcStdio({
    stdin,
    stdout,
    cwd: "/project",
    openBridge: mockOpenBridge(() =>
      createFakeRpcChild({
        onCommand: (cmd, ctx) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: { sessionId: "s1", model: ctx?.activeModel ?? null }
            };
          }
          if (cmd.type === "set_model") {
            if (ctx?.setModel) ctx.setModel({ id: cmd.modelId, provider: "kairo" });
            return { type: "response", command: "set_model", success: true };
          }
          return null;
        }
      })
    ),
    analyzeProjectTeam: async ({ cwd, analyst }) => {
      analyzeCalls.push({ cwd, analyst });
      return { state: "suggested", teamRows: 1, roles: ["Architect"], analyst: "claude · Claude Sonnet", projectRoot: cwd, notice: null };
    },
    loadSnapshot: async () => fakeSnapshot({ team: { state: "suggested", rows: [], assignments: [] } })
  });

  await new Promise((r) => setTimeout(r, 40));
  stdin.write(`${JSON.stringify({ op: "project.analyze", analyst: chosenAnalyst })}\n`);
  await new Promise((r) => setTimeout(r, 80));

  assert.equal(analyzeCalls.length, 1);
  assert.equal(analyzeCalls[0].cwd, "/project");
  assert.deepEqual(analyzeCalls[0].analyst, chosenAnalyst);
  const team = out.find((r) => r.type === "team");
  assert.equal(team?.ok, true);

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("sidecar project.analyze without an analyst payload keeps the default-pick fallback (analyst omitted)", async () => {
  const out = [];
  const stdout = new PassThrough();
  stdout.on("data", (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) {
      out.push(JSON.parse(line));
    }
  });
  const stdin = new PassThrough();
  const analyzeCalls = [];

  const runPromise = runKairoUiRpcStdio({
    stdin,
    stdout,
    cwd: "/project",
    openBridge: mockOpenBridge(() =>
      createFakeRpcChild({
        onCommand: (cmd, ctx) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: { sessionId: "s1", model: ctx?.activeModel ?? null }
            };
          }
          if (cmd.type === "set_model") {
            if (ctx?.setModel) ctx.setModel({ id: cmd.modelId, provider: "kairo" });
            return { type: "response", command: "set_model", success: true };
          }
          return null;
        }
      })
    ),
    analyzeProjectTeam: async ({ cwd, analyst }) => {
      analyzeCalls.push({ cwd, analyst });
      return { state: "suggested", teamRows: 1, roles: ["Architect"], analyst: "codex · GPT-5", projectRoot: cwd, notice: null };
    },
    loadSnapshot: async () => fakeSnapshot({ team: { state: "suggested", rows: [], assignments: [] } })
  });

  await new Promise((r) => setTimeout(r, 40));
  stdin.write(`${JSON.stringify({ op: "project.analyze" })}\n`);
  await new Promise((r) => setTimeout(r, 80));

  assert.equal(analyzeCalls.length, 1);
  assert.equal(analyzeCalls[0].analyst, null, "no picker payload means the default-analyst fallback stays intact");

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("sidecar team.approve re-applies Architect and republishes models plus snapshot", async () => {
  const setModelCalls = [];
  const out = [];
  const stdout = new PassThrough();
  stdout.on("data", (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) {
      out.push(JSON.parse(line));
    }
  });
  const stdin = new PassThrough();
  // Before approval there is no launchable route; approval makes Architect real.
  let routes = [];

  const runPromise = runKairoUiRpcStdio({
    stdin,
    stdout,
    cwd: "/project",
    loadKairoProviderModels: async () => routes,
    openBridge: async (opts) => {
      const child = createFakeRpcChild({
        onCommand: (cmd, ctx) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: { sessionId: "s1", model: ctx?.activeModel ?? null }
            };
          }
          if (cmd.type === "set_model") {
            setModelCalls.push(cmd);
            if (ctx?.setModel) ctx.setModel({ id: cmd.modelId, provider: "kairo" });
            return {
              type: "response",
              command: "set_model",
              success: true,
              data: { id: cmd.modelId, provider: "kairo" }
            };
          }
          return null;
        }
      });
      return openPiRpcBridge({
        cwd: opts?.cwd ?? "/project",
        loadSnapshot: async () => fakeSnapshot(),
        resolveCliPath: () => "/fake/cli.js",
        loadKairoProviderModels: async () => routes,
        spawnImpl: () => child,
        execPath: "/usr/bin/node",
        connectTimeoutMs: 500
      });
    },
    approveProjectTeam: async ({ cwd }) => {
      routes = [architectModel];
      return {
        state: "active",
        teamRows: 2,
        roles: ["Architect", "Builder"],
        analyst: "codex · GPT-5",
        projectRoot: cwd
      };
    },
    loadSnapshot: async () =>
      fakeSnapshot({ team: { state: "active", rows: [], assignments: [] } })
  });

  await new Promise((r) => setTimeout(r, 40));
  const readyEngine = out.find((r) => r.type === "ready")?.engine;
  assert.equal(readyEngine?.status, "no_model", "no route before approval");
  const setModelsBefore = setModelCalls.length;

  stdin.write(`${JSON.stringify({ op: "team.approve" })}\n`);
  await new Promise((r) => setTimeout(r, 120));

  assert.ok(
    setModelCalls.length > setModelsBefore,
    "approve must re-apply the Architect route via set_model"
  );
  assert.equal(setModelCalls.at(-1)?.provider, "kairo");
  assert.equal(setModelCalls.at(-1)?.modelId, architectModel.id);
  const engineAfter = [...out].reverse().find((r) => r.type === "engine");
  assert.equal(engineAfter?.engine?.status, "connected");
  const models = [...out].reverse().find((r) => r.type === "kairoModels");
  assert.equal(models?.kairoModels?.[0]?.role, "Architect");
  const snapshot = [...out].reverse().find((r) => r.type === "snapshot");
  assert.equal(snapshot?.snapshot?.team?.state, "active");
  const team = [...out].reverse().find((r) => r.type === "team");
  assert.equal(team?.op, "team.approve");
  assert.equal(team?.state, "active");

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("sidecar team.approve failure never re-applies a model", async () => {
  const setModelCalls = [];
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
    openBridge: mockOpenBridge(() =>
      createFakeRpcChild({
        onCommand: (cmd, ctx) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: { sessionId: "s1", model: ctx?.activeModel ?? null }
            };
          }
          if (cmd.type === "set_model") {
            setModelCalls.push(cmd);
            if (ctx?.setModel) ctx.setModel({ id: cmd.modelId, provider: "kairo" });
            return { type: "response", command: "set_model", success: true };
          }
          return null;
        }
      })
    ),
    approveProjectTeam: async () => {
      throw new Error("No suggested project strategy yet");
    }
  });

  await new Promise((r) => setTimeout(r, 40));
  const before = setModelCalls.length;
  stdin.write(`${JSON.stringify({ op: "team.approve" })}\n`);
  await new Promise((r) => setTimeout(r, 80));

  assert.equal(setModelCalls.length, before, "a failed approval must not touch the model");
  assert.ok(
    out.some((r) => r.type === "error" && /No suggested project strategy/.test(r.message)),
    "failure must be reported"
  );

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

test("sidecar team.revalidate re-probes availability and emits a fresh snapshot from real evidence", async () => {
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
    openBridge: mockOpenBridge(() =>
      createFakeRpcChild({
        onCommand: (cmd, ctx) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: { sessionId: "s1", model: ctx?.activeModel ?? null }
            };
          }
          if (cmd.type === "set_model") {
            if (ctx?.setModel) ctx.setModel({ id: cmd.modelId, provider: "kairo" });
            return { type: "response", command: "set_model", success: true, data: { id: cmd.modelId, provider: "kairo" } };
          }
          return null;
        }
      })
    ),
    revalidateTeamAvailability: async ({ cwd }) => ({
      ok: true,
      reason: null,
      snapshot: fakeSnapshot({ team: { state: "active", rows: [], assignments: [] }, project: { label: cwd } })
    })
  });

  await new Promise((r) => setTimeout(r, 40));
  stdin.write(`${JSON.stringify({ op: "team.revalidate" })}\n`);
  await new Promise((r) => setTimeout(r, 80));

  const availability = [...out].reverse().find((r) => r.type === "availability");
  assert.equal(availability?.ok, true);
  assert.equal(availability?.reason, null);
  const snapshot = [...out].reverse().find((r) => r.type === "snapshot");
  assert.equal(snapshot?.snapshot?.team?.state, "active");

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("sidecar team.revalidate reports a failed probe honestly (ok:false, real reason)", async () => {
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
    openBridge: mockOpenBridge(() =>
      createFakeRpcChild({
        onCommand: (cmd, ctx) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: { sessionId: "s1", model: ctx?.activeModel ?? null }
            };
          }
          if (cmd.type === "set_model") {
            if (ctx?.setModel) ctx.setModel({ id: cmd.modelId, provider: "kairo" });
            return { type: "response", command: "set_model", success: true, data: { id: cmd.modelId, provider: "kairo" } };
          }
          return null;
        }
      })
    ),
    revalidateTeamAvailability: async () => ({
      ok: false,
      reason: "Live availability probe failed — team status shown from the last-known state.",
      snapshot: fakeSnapshot()
    })
  });

  await new Promise((r) => setTimeout(r, 40));
  stdin.write(`${JSON.stringify({ op: "team.revalidate" })}\n`);
  await new Promise((r) => setTimeout(r, 80));

  const availability = [...out].reverse().find((r) => r.type === "availability");
  assert.equal(availability?.ok, false);
  assert.match(availability?.reason ?? "", /Live availability/);

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("sidecar team.recovery.preview surfaces a proposal and refreshes the snapshot", async () => {
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
    openBridge: mockOpenBridge(() =>
      createFakeRpcChild({
        onCommand: (cmd, ctx) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: { sessionId: "s1", model: ctx?.activeModel ?? null }
            };
          }
          if (cmd.type === "set_model") {
            if (ctx?.setModel) ctx.setModel({ id: cmd.modelId, provider: "kairo" });
            return { type: "response", command: "set_model", success: true, data: { id: cmd.modelId, provider: "kairo" } };
          }
          return null;
        }
      })
    ),
    recoverProjectTeam: async () => ({
      outcome: "proposed",
      fingerprint: "fp-1",
      affected: [{ role: "Orchestrator", model: "Kimi K3", reason: "rate-limited" }],
      proposal: { projectTeam: [{ role: "Orchestrator", model: { displayName: "GPT-6" } }] }
    }),
    loadSnapshot: async () => fakeSnapshot({ team: { state: "stale", rows: [], assignments: [] } })
  });

  await new Promise((r) => setTimeout(r, 40));
  stdin.write(`${JSON.stringify({ op: "team.recovery.preview" })}\n`);
  await new Promise((r) => setTimeout(r, 80));

  const recovery = [...out].reverse().find((r) => r.type === "recovery" && r.op === "preview");
  assert.equal(recovery?.outcome, "proposed");
  assert.equal(recovery?.fingerprint, "fp-1");
  assert.equal(recovery?.affected?.[0]?.role, "Orchestrator");
  const snapshot = [...out].reverse().find((r) => r.type === "snapshot");
  assert.equal(snapshot?.snapshot?.team?.state, "stale");

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("sidecar team.recovery.apply activates a fresh proposal, re-applies Architect and refreshes routes", async () => {
  const setModelCalls = [];
  const out = [];
  const stdout = new PassThrough();
  stdout.on("data", (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) {
      out.push(JSON.parse(line));
    }
  });
  const stdin = new PassThrough();
  let routes = [];

  const runPromise = runKairoUiRpcStdio({
    stdin,
    stdout,
    cwd: "/project",
    loadKairoProviderModels: async () => routes,
    openBridge: async (opts) => {
      const child = createFakeRpcChild({
        onCommand: (cmd, ctx) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: { sessionId: "s1", model: ctx?.activeModel ?? null }
            };
          }
          if (cmd.type === "set_model") {
            setModelCalls.push(cmd);
            if (ctx?.setModel) ctx.setModel({ id: cmd.modelId, provider: "kairo" });
            return { type: "response", command: "set_model", success: true, data: { id: cmd.modelId, provider: "kairo" } };
          }
          return null;
        }
      });
      return openPiRpcBridge({
        cwd: opts?.cwd ?? "/project",
        loadSnapshot: async () => fakeSnapshot(),
        resolveCliPath: () => "/fake/cli.js",
        loadKairoProviderModels: async () => routes,
        spawnImpl: () => child,
        execPath: "/usr/bin/node",
        connectTimeoutMs: 500
      });
    },
    approveRecoveryProposal: async () => {
      routes = [architectModel];
      return { outcome: "approved", fingerprint: "fp-1", strategy: { projectTeam: [] } };
    },
    loadSnapshot: async () => fakeSnapshot({ team: { state: "active", rows: [], assignments: [] } })
  });

  await new Promise((r) => setTimeout(r, 40));
  stdin.write(`${JSON.stringify({ op: "team.recovery.apply" })}\n`);
  await new Promise((r) => setTimeout(r, 80));

  const recovery = [...out].reverse().find((r) => r.type === "recovery" && r.op === "apply");
  assert.equal(recovery?.outcome, "approved");
  assert.ok(setModelCalls.length > 0, "apply must re-apply Architect via set_model");
  assert.equal(setModelCalls.at(-1)?.provider, "kairo");
  const engineAfter = [...out].reverse().find((r) => r.type === "engine");
  assert.equal(engineAfter?.engine?.status, "connected");
  const snapshot = [...out].reverse().find((r) => r.type === "snapshot");
  assert.equal(snapshot?.snapshot?.team?.state, "active");

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("sidecar team.recovery.apply refuses a stale proposal and mutates nothing (no set_model, no reactivation)", async () => {
  const setModelCalls = [];
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
    openBridge: async (opts) => {
      const child = createFakeRpcChild({
        onCommand: (cmd, ctx) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: { sessionId: "s1", model: ctx?.activeModel ?? null }
            };
          }
          if (cmd.type === "set_model") {
            setModelCalls.push(cmd);
            return { type: "response", command: "set_model", success: true };
          }
          return null;
        }
      });
      return openPiRpcBridge({
        cwd: opts?.cwd ?? "/project",
        loadSnapshot: async () => fakeSnapshot(),
        resolveCliPath: () => "/fake/cli.js",
        loadKairoProviderModels: async () => [],
        spawnImpl: () => child,
        execPath: "/usr/bin/node",
        connectTimeoutMs: 500
      });
    },
    // The real workspace-snapshot.js wrapper never throws — a stale
    // proposal comes back as {outcome: "error", reason} (see
    // team-recovery.js's approveRecoveryProposal staleness checks).
    approveRecoveryProposal: async () => ({
      outcome: "error",
      reason: "The active team changed since the proposal was built — run a fresh recovery analysis instead of approving."
    })
  });

  await new Promise((r) => setTimeout(r, 40));
  stdin.write(`${JSON.stringify({ op: "team.recovery.apply" })}\n`);
  await new Promise((r) => setTimeout(r, 80));

  const recovery = [...out].reverse().find((r) => r.type === "recovery" && r.op === "apply");
  assert.equal(recovery?.outcome, "error");
  assert.match(recovery?.reason ?? "", /changed since the proposal was built/);
  assert.equal(setModelCalls.length, 0, "a stale/refused apply must never touch the model");

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("sidecar team.recovery.reject only closes the proposal, mutating nothing else", async () => {
  const setModelCalls = [];
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
    openBridge: async (opts) => {
      const child = createFakeRpcChild({
        onCommand: (cmd, ctx) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: { sessionId: "s1", model: ctx?.activeModel ?? null }
            };
          }
          if (cmd.type === "set_model") {
            setModelCalls.push(cmd);
            return { type: "response", command: "set_model", success: true };
          }
          return null;
        }
      });
      return openPiRpcBridge({
        cwd: opts?.cwd ?? "/project",
        loadSnapshot: async () => fakeSnapshot(),
        resolveCliPath: () => "/fake/cli.js",
        loadKairoProviderModels: async () => [],
        spawnImpl: () => child,
        execPath: "/usr/bin/node",
        connectTimeoutMs: 500
      });
    },
    rejectRecoveryProposal: async () => ({ outcome: "rejected", fingerprint: "fp-1" }),
    loadSnapshot: async () => fakeSnapshot({ team: { state: "active", rows: [], assignments: [] } })
  });

  await new Promise((r) => setTimeout(r, 40));
  stdin.write(`${JSON.stringify({ op: "team.recovery.reject" })}\n`);
  await new Promise((r) => setTimeout(r, 80));

  const recovery = [...out].reverse().find((r) => r.type === "recovery" && r.op === "reject");
  assert.equal(recovery?.outcome, "rejected");
  assert.equal(setModelCalls.length, 0, "reject must never touch the model");
  const snapshot = [...out].reverse().find((r) => r.type === "snapshot");
  assert.ok(snapshot, "reject still refreshes the snapshot (closing the fingerprint is a real state change)");

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

// -----------------------------------------------------------------------
// U3a: Kairo session id <-> Pi file binding, visible selector data, rename,
// fork, and draft persistence across quit/resume.
// -----------------------------------------------------------------------

const KAIRO_ID_A = "aaaaaaaa-0000-4000-8000-000000000001";
const KAIRO_ID_B = "bbbbbbbb-0000-4000-8000-000000000002";

test("U3a: sidecar annotates each listed Pi session with its bound Kairo session id", async () => {
  const out = [];
  const stdout = new PassThrough();
  stdout.on("data", (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) out.push(JSON.parse(line));
  });
  const stdin = new PassThrough();

  const runPromise = runKairoUiRpcStdio({
    stdin,
    stdout,
    cwd: "/project",
    openBridge: async (opts) => {
      const child = createFakeRpcChild({
        onCommand: (cmd, ctx) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: { sessionId: "pi-fresh", model: ctx?.activeModel ?? null }
            };
          }
          if (cmd.type === "set_model") {
            if (ctx?.setModel) ctx.setModel({ id: cmd.modelId, provider: "kairo" });
            return { type: "response", command: "set_model", success: true, data: { id: cmd.modelId } };
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
    },
    resolveProjectRoot: async () => "/project",
    listPiSessionFilesForCwd: () => [
      { path: "/x/pi-fresh.jsonl", sessionId: "pi-fresh", label: "Fresh" },
      { path: "/x/pi-old.jsonl", sessionId: "pi-old", label: "Old" }
    ],
    lookupPiBinding: async (_home, _root, piSessionId) =>
      piSessionId === "pi-old" ? KAIRO_ID_A : null
  });

  await new Promise((r) => setTimeout(r, 40));
  const ready = out.find((r) => r.type === "ready");
  assert.ok(ready);
  assert.deepEqual(
    ready.sessions.map((s) => [s.sessionId, s.kairoSessionId]),
    [["pi-fresh", null], ["pi-old", KAIRO_ID_A]]
  );

  stdin.write(`${JSON.stringify({ op: "list_sessions" })}\n`);
  await new Promise((r) => setTimeout(r, 40));
  const sessions = [...out].reverse().find((r) => r.type === "sessions");
  assert.deepEqual(
    sessions.sessions.map((s) => [s.sessionId, s.kairoSessionId]),
    [["pi-fresh", null], ["pi-old", KAIRO_ID_A]]
  );

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("U3a: sidecar without a resolvable project root reports every session unbound instead of crashing", async () => {
  const out = [];
  const stdout = new PassThrough();
  stdout.on("data", (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) out.push(JSON.parse(line));
  });
  const stdin = new PassThrough();

  const runPromise = runKairoUiRpcStdio({
    stdin,
    stdout,
    cwd: "/project",
    openBridge: async (opts) =>
      openPiRpcBridge({
        cwd: opts?.cwd ?? "/project",
        loadSnapshot: async () => fakeSnapshot(),
        resolveCliPath: () => "/fake/cli.js",
        loadKairoProviderModels: async () => [architectModel],
        spawnImpl: () => createFakeRpcChild({
          onCommand: (cmd, ctx) => {
            if (cmd.type === "get_state") {
              return { type: "response", command: "get_state", success: true, data: { sessionId: "s1", model: ctx?.activeModel ?? null } };
            }
            if (cmd.type === "set_model") {
              if (ctx?.setModel) ctx.setModel({ id: cmd.modelId });
              return { type: "response", command: "set_model", success: true, data: { id: cmd.modelId } };
            }
            return null;
          }
        }),
        execPath: "/usr/bin/node",
        connectTimeoutMs: 500
      }),
    resolveProjectRoot: async () => {
      throw new Error("not a git repo");
    },
    listPiSessionFilesForCwd: () => [{ path: "/x/a.jsonl", sessionId: "pi-a", label: "A" }]
  });

  await new Promise((r) => setTimeout(r, 40));
  const ready = out.find((r) => r.type === "ready");
  assert.equal(ready.sessions[0].kairoSessionId, null);
  assert.equal(ready.draft, null);

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("U3a: `kairo resume <id>` (KAIRO_SESSION_ID) auto-switches Pi to the bound session file before ready", async () => {
  const switchCalls = [];
  const out = [];
  const stdout = new PassThrough();
  stdout.on("data", (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) out.push(JSON.parse(line));
  });
  const stdin = new PassThrough();

  const runPromise = runKairoUiRpcStdio({
    stdin,
    stdout,
    cwd: "/project",
    env: { KAIRO_SESSION_ID: KAIRO_ID_A },
    resolveProjectRoot: async () => "/project",
    listPiSessionFilesForCwd: () => [
      { path: "/x/bound.jsonl", sessionId: "pi-bound", label: "Bound" }
    ],
    lookupPiBinding: async (_home, _root, piSessionId) =>
      piSessionId === "pi-bound" ? KAIRO_ID_A : null,
    openBridge: async (opts) => {
      let currentSessionId = "pi-fresh";
      const child = createFakeRpcChild({
        onCommand: (cmd, ctx) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: { sessionId: currentSessionId, model: ctx?.activeModel ?? null }
            };
          }
          if (cmd.type === "switch_session") {
            switchCalls.push(cmd.sessionPath);
            currentSessionId = "pi-bound";
            return { type: "response", command: "switch_session", success: true, data: { cancelled: false } };
          }
          if (cmd.type === "set_model") {
            if (ctx?.setModel) ctx.setModel({ id: cmd.modelId, provider: "kairo" });
            return { type: "response", command: "set_model", success: true, data: { id: cmd.modelId } };
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

  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(switchCalls, ["/x/bound.jsonl"]);
  const ready = out.find((r) => r.type === "ready");
  assert.equal(ready.engine.sessionId, "pi-bound");

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("U3a: rename_session sends set_session_name and re-emits sessions with the updated label", async () => {
  const renameCalls = [];
  let relistLabel = "Original";
  const out = [];
  const stdout = new PassThrough();
  stdout.on("data", (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) out.push(JSON.parse(line));
  });
  const stdin = new PassThrough();

  const runPromise = runKairoUiRpcStdio({
    stdin,
    stdout,
    cwd: "/project",
    resolveProjectRoot: async () => "/project",
    listPiSessionFilesForCwd: () => [{ path: "/x/s1.jsonl", sessionId: "s1", label: relistLabel }],
    openBridge: async (opts) => {
      const child = createFakeRpcChild({
        onCommand: (cmd, ctx) => {
          if (cmd.type === "get_state") {
            return { type: "response", command: "get_state", success: true, data: { sessionId: "s1", model: ctx?.activeModel ?? null } };
          }
          if (cmd.type === "set_session_name") {
            renameCalls.push(cmd.name);
            relistLabel = cmd.name;
            return { type: "response", command: "set_session_name", success: true };
          }
          return null;
        }
      });
      return openPiRpcBridge({
        cwd: opts?.cwd ?? "/project",
        loadSnapshot: async () => fakeSnapshot(),
        resolveCliPath: () => "/fake/cli.js",
        loadKairoProviderModels: async () => [],
        spawnImpl: () => child,
        execPath: "/usr/bin/node",
        connectTimeoutMs: 500
      });
    }
  });

  await new Promise((r) => setTimeout(r, 40));
  stdin.write(`${JSON.stringify({ op: "rename_session", name: "Investigate the flaky test" })}\n`);
  await new Promise((r) => setTimeout(r, 60));

  assert.deepEqual(renameCalls, ["Investigate the flaky test"]);
  const sessions = [...out].reverse().find((r) => r.type === "sessions");
  assert.equal(sessions.sessions[0].label, "Investigate the flaky test");

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("U3a: rename_session with an empty/blank name refuses instead of calling Pi", async () => {
  const renameCalls = [];
  const out = [];
  const stdout = new PassThrough();
  stdout.on("data", (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) out.push(JSON.parse(line));
  });
  const stdin = new PassThrough();

  const runPromise = runKairoUiRpcStdio({
    stdin,
    stdout,
    cwd: "/project",
    listPiSessionFilesForCwd: () => [],
    openBridge: async (opts) => {
      const child = createFakeRpcChild({
        onCommand: (cmd) => {
          if (cmd.type === "get_state") return { type: "response", command: "get_state", success: true, data: { sessionId: "s1", model: null } };
          if (cmd.type === "set_session_name") {
            renameCalls.push(cmd.name);
            return { type: "response", command: "set_session_name", success: true };
          }
          return null;
        }
      });
      return openPiRpcBridge({
        cwd: opts?.cwd ?? "/project",
        loadSnapshot: async () => fakeSnapshot(),
        resolveCliPath: () => "/fake/cli.js",
        loadKairoProviderModels: async () => [],
        spawnImpl: () => child,
        execPath: "/usr/bin/node",
        connectTimeoutMs: 500
      });
    }
  });

  await new Promise((r) => setTimeout(r, 40));
  stdin.write(`${JSON.stringify({ op: "rename_session", name: "   " })}\n`);
  await new Promise((r) => setTimeout(r, 40));

  assert.deepEqual(renameCalls, []);
  const error = [...out].reverse().find((r) => r.type === "error");
  assert.match(error?.message ?? "", /non-empty name/);

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("U3a: fork_session sends clone (never fork/entryId), refreshes engine + transcript + sessions, source untouched", async () => {
  let cloneCalls = 0;
  let currentSessionId = "s1-source";
  const out = [];
  const stdout = new PassThrough();
  stdout.on("data", (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) out.push(JSON.parse(line));
  });
  const stdin = new PassThrough();

  const runPromise = runKairoUiRpcStdio({
    stdin,
    stdout,
    cwd: "/project",
    listPiSessionFilesForCwd: () => [
      { path: "/x/source.jsonl", sessionId: "s1-source", label: "Source" },
      ...(cloneCalls > 0 ? [{ path: "/x/fork.jsonl", sessionId: "s1-fork", label: "Fork" }] : [])
    ],
    openBridge: async (opts) => {
      const child = createFakeRpcChild({
        onCommand: (cmd, ctx) => {
          if (cmd.type === "get_state") {
            return { type: "response", command: "get_state", success: true, data: { sessionId: currentSessionId, model: ctx?.activeModel ?? null } };
          }
          if (cmd.type === "clone") {
            cloneCalls += 1;
            currentSessionId = "s1-fork";
            return { type: "response", command: "clone", success: true, data: { cancelled: false } };
          }
          if (cmd.type === "fork") {
            throw new Error("must never send the entry-based `fork` command for a whole-session fork");
          }
          if (cmd.type === "get_messages") {
            return { type: "response", command: "get_messages", success: true, data: { messages: [] } };
          }
          return null;
        }
      });
      return openPiRpcBridge({
        cwd: opts?.cwd ?? "/project",
        loadSnapshot: async () => fakeSnapshot(),
        resolveCliPath: () => "/fake/cli.js",
        loadKairoProviderModels: async () => [],
        spawnImpl: () => child,
        execPath: "/usr/bin/node",
        connectTimeoutMs: 500
      });
    }
  });

  await new Promise((r) => setTimeout(r, 40));
  stdin.write(`${JSON.stringify({ op: "fork_session" })}\n`);
  await new Promise((r) => setTimeout(r, 60));

  assert.equal(cloneCalls, 1);
  const sessions = [...out].reverse().find((r) => r.type === "sessions");
  assert.deepEqual(
    sessions.sessions.map((s) => s.sessionId).sort(),
    ["s1-fork", "s1-source"],
    "the fork is a new session distinct from the source — the source stays listed, untouched"
  );

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("U3a: stop persists a non-empty draft for the bound Kairo session before exiting", async () => {
  const saveCalls = [];
  const stdout = new PassThrough();
  const stdin = new PassThrough();

  const runPromise = runKairoUiRpcStdio({
    stdin,
    stdout,
    cwd: "/project",
    env: { KAIRO_SESSION_ID: KAIRO_ID_B },
    resolveProjectRoot: async () => "/project",
    listPiSessionFilesForCwd: () => [],
    saveDraft: async (homeDir, projectRoot, sessionId, text) => {
      saveCalls.push({ homeDir, projectRoot, sessionId, text });
    },
    openBridge: async (opts) =>
      openPiRpcBridge({
        cwd: opts?.cwd ?? "/project",
        loadSnapshot: async () => fakeSnapshot(),
        resolveCliPath: () => "/fake/cli.js",
        loadKairoProviderModels: async () => [],
        spawnImpl: () => createFakeRpcChild({
          onCommand: (cmd) =>
            cmd.type === "get_state"
              ? { type: "response", command: "get_state", success: true, data: { sessionId: "s1", model: null } }
              : null
        }),
        execPath: "/usr/bin/node",
        connectTimeoutMs: 500
      })
  });

  await new Promise((r) => setTimeout(r, 40));
  stdin.write(`${JSON.stringify({ op: "stop", draft: "unsent draft text" })}\n`);
  stdin.end();
  await runPromise;

  assert.equal(saveCalls.length, 1);
  assert.equal(saveCalls[0].sessionId, KAIRO_ID_B);
  assert.equal(saveCalls[0].text, "unsent draft text");
});

test("U3a: ready surfaces a previously saved draft for the bound Kairo session", async () => {
  const out = [];
  const stdout = new PassThrough();
  stdout.on("data", (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) out.push(JSON.parse(line));
  });
  const stdin = new PassThrough();

  const runPromise = runKairoUiRpcStdio({
    stdin,
    stdout,
    cwd: "/project",
    env: { KAIRO_SESSION_ID: KAIRO_ID_A },
    resolveProjectRoot: async () => "/project",
    listPiSessionFilesForCwd: () => [],
    loadDraft: async (_homeDir, _projectRoot, sessionId) =>
      sessionId === KAIRO_ID_A ? "resume me" : null,
    openBridge: async (opts) =>
      openPiRpcBridge({
        cwd: opts?.cwd ?? "/project",
        loadSnapshot: async () => fakeSnapshot(),
        resolveCliPath: () => "/fake/cli.js",
        loadKairoProviderModels: async () => [],
        spawnImpl: () => createFakeRpcChild({
          onCommand: (cmd) =>
            cmd.type === "get_state"
              ? { type: "response", command: "get_state", success: true, data: { sessionId: "s1", model: null } }
              : null
        }),
        execPath: "/usr/bin/node",
        connectTimeoutMs: 500
      })
  });

  await new Promise((r) => setTimeout(r, 40));
  const ready = out.find((r) => r.type === "ready");
  assert.equal(ready.draft, "resume me");

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

// -----------------------------------------------------------------------
// U3a close: activeKairoSessionId owns drafts; fork mints+binds; cancel
// and binding-failure stay fail-closed.
// -----------------------------------------------------------------------

const KAIRO_ID_C = "cccccccc-0000-4000-8000-000000000003";

function draftsStore() {
  /** @type {Map<string, string>} */
  const map = new Map();
  return {
    map,
    saveDraft: async (_h, _p, sessionId, text) => {
      map.set(sessionId, text);
    },
    loadDraft: async (_h, _p, sessionId) => (map.has(sessionId) ? map.get(sessionId) : null)
  };
}

test("U3a close: switch saves outgoing draft under active id then loads destination draft; stop uses active not boot env", async () => {
  const drafts = draftsStore();
  drafts.map.set(KAIRO_ID_A, "draft-A");
  drafts.map.set(KAIRO_ID_B, "draft-B");
  const saveCalls = [];
  const out = [];
  const stdout = new PassThrough();
  stdout.on("data", (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) out.push(JSON.parse(line));
  });
  const stdin = new PassThrough();

  let currentSessionId = "pi-a";
  const bindings = new Map([
    ["pi-a", KAIRO_ID_A],
    ["pi-b", KAIRO_ID_B]
  ]);

  const runPromise = runKairoUiRpcStdio({
    stdin,
    stdout,
    cwd: "/project",
    env: { KAIRO_SESSION_ID: KAIRO_ID_A },
    resolveProjectRoot: async () => "/project",
    listPiSessionFilesForCwd: () => [
      { path: "/x/a.jsonl", sessionId: "pi-a", label: "A" },
      { path: "/x/b.jsonl", sessionId: "pi-b", label: "B" }
    ],
    lookupPiBinding: async (_h, _r, piId) => bindings.get(piId) ?? null,
    saveDraft: async (h, p, sessionId, text) => {
      saveCalls.push({ sessionId, text });
      return drafts.saveDraft(h, p, sessionId, text);
    },
    loadDraft: drafts.loadDraft,
    openBridge: async (opts) => {
      const child = createFakeRpcChild({
        onCommand: (cmd, ctx) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: { sessionId: currentSessionId, model: ctx?.activeModel ?? null }
            };
          }
          if (cmd.type === "switch_session") {
            currentSessionId = cmd.sessionPath.includes("b.jsonl") ? "pi-b" : "pi-a";
            return { type: "response", command: "switch_session", success: true, data: { cancelled: false } };
          }
          if (cmd.type === "get_messages") {
            return { type: "response", command: "get_messages", success: true, data: { messages: [] } };
          }
          if (cmd.type === "set_model") {
            if (ctx?.setModel) ctx.setModel({ id: cmd.modelId, provider: "kairo" });
            return { type: "response", command: "set_model", success: true, data: { id: cmd.modelId } };
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

  await new Promise((r) => setTimeout(r, 60));
  // Switch A → B, carrying the live editor draft for A.
  stdin.write(
    `${JSON.stringify({ op: "switch_session_index", index: 1, draft: "draft-A-edited" })}\n`
  );
  await new Promise((r) => setTimeout(r, 80));

  assert.ok(
    saveCalls.some((c) => c.sessionId === KAIRO_ID_A && c.text === "draft-A-edited"),
    "outgoing draft must be saved under the prior active id before switch"
  );
  const draftEvt = [...out].reverse().find((r) => r.type === "draft");
  assert.ok(draftEvt, "destination draft must be emitted after a successful switch");
  assert.equal(draftEvt.kairoSessionId, KAIRO_ID_B);
  assert.equal(draftEvt.text, "draft-B");

  // Stop must persist under the NEW active id (B), not the boot env (A).
  const stopSavesBefore = saveCalls.length;
  stdin.write(`${JSON.stringify({ op: "stop", draft: "draft-B-final" })}\n`);
  stdin.end();
  await runPromise;
  const stopSaves = saveCalls.slice(stopSavesBefore);
  assert.equal(stopSaves.length, 1);
  assert.equal(stopSaves[0].sessionId, KAIRO_ID_B);
  assert.equal(stopSaves[0].text, "draft-B-final");
  assert.equal(drafts.map.get(KAIRO_ID_A), "draft-A-edited", "A's draft stays isolated");
});

test("U3a close: new_session saves prior draft under active id and emits empty draft; prior preserved", async () => {
  const drafts = draftsStore();
  const saveCalls = [];
  const out = [];
  const stdout = new PassThrough();
  stdout.on("data", (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) out.push(JSON.parse(line));
  });
  const stdin = new PassThrough();

  let currentSessionId = "pi-a";
  let listed = [
    { path: "/x/a.jsonl", sessionId: "pi-a", label: "A" }
  ];
  const bindings = new Map([["pi-a", KAIRO_ID_A]]);

  const runPromise = runKairoUiRpcStdio({
    stdin,
    stdout,
    cwd: "/project",
    env: { KAIRO_SESSION_ID: KAIRO_ID_A },
    resolveProjectRoot: async () => "/project",
    listPiSessionFilesForCwd: () => listed,
    lookupPiBinding: async (_h, _r, piId) => bindings.get(piId) ?? null,
    saveDraft: async (h, p, sessionId, text) => {
      saveCalls.push({ sessionId, text });
      return drafts.saveDraft(h, p, sessionId, text);
    },
    loadDraft: drafts.loadDraft,
    openBridge: async (opts) => {
      const child = createFakeRpcChild({
        onCommand: (cmd, ctx) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: { sessionId: currentSessionId, model: ctx?.activeModel ?? null }
            };
          }
          if (cmd.type === "new_session") {
            currentSessionId = "pi-new";
            listed = [
              { path: "/x/a.jsonl", sessionId: "pi-a", label: "A" },
              { path: "/x/new.jsonl", sessionId: "pi-new", label: "New" }
            ];
            return { type: "response", command: "new_session", success: true, data: { cancelled: false } };
          }
          if (cmd.type === "switch_session") {
            currentSessionId = "pi-a";
            return { type: "response", command: "switch_session", success: true, data: { cancelled: false } };
          }
          if (cmd.type === "get_messages") {
            return { type: "response", command: "get_messages", success: true, data: { messages: [] } };
          }
          if (cmd.type === "set_model") {
            if (ctx?.setModel) ctx.setModel({ id: cmd.modelId, provider: "kairo" });
            return { type: "response", command: "set_model", success: true, data: { id: cmd.modelId } };
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

  await new Promise((r) => setTimeout(r, 60));
  stdin.write(`${JSON.stringify({ op: "new_session", draft: "keep-me-on-A" })}\n`);
  await new Promise((r) => setTimeout(r, 80));

  assert.ok(saveCalls.some((c) => c.sessionId === KAIRO_ID_A && c.text === "keep-me-on-A"));
  const draftEvt = [...out].reverse().find((r) => r.type === "draft");
  assert.ok(draftEvt);
  assert.equal(draftEvt.text, "");
  assert.equal(drafts.map.get(KAIRO_ID_A), "keep-me-on-A");

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("U3a close: fork_session mints+binds a new Kairo id; source binding/draft untouched; fork draft empty", async () => {
  const drafts = draftsStore();
  drafts.map.set(KAIRO_ID_A, "source-draft");
  const saveCalls = [];
  const createCalls = [];
  const recordCalls = [];
  const out = [];
  const stdout = new PassThrough();
  stdout.on("data", (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) out.push(JSON.parse(line));
  });
  const stdin = new PassThrough();

  let currentSessionId = "pi-a";
  let cloneCalls = 0;
  const bindings = new Map([["pi-a", KAIRO_ID_A]]);

  const runPromise = runKairoUiRpcStdio({
    stdin,
    stdout,
    cwd: "/project",
    env: { KAIRO_SESSION_ID: KAIRO_ID_A },
    resolveProjectRoot: async () => "/project",
    listPiSessionFilesForCwd: () => [
      { path: "/x/a.jsonl", sessionId: "pi-a", label: "A" },
      ...(cloneCalls > 0 ? [{ path: "/x/fork.jsonl", sessionId: "pi-fork", label: "Fork" }] : [])
    ],
    lookupPiBinding: async (_h, _r, piId) => bindings.get(piId) ?? null,
    createSession: async (_h, _p, opts) => {
      createCalls.push(opts ?? {});
      return { id: KAIRO_ID_C, mode: opts?.mode ?? "ask" };
    },
    recordPiBinding: async (_h, _p, piSessionId, kairoSessionId) => {
      recordCalls.push({ piSessionId, kairoSessionId });
      bindings.set(piSessionId, kairoSessionId);
    },
    getSession: async (_h, _p, sessionId) =>
      sessionId === KAIRO_ID_A ? { id: KAIRO_ID_A, mode: "agent" } : null,
    saveDraft: async (h, p, sessionId, text) => {
      saveCalls.push({ sessionId, text });
      return drafts.saveDraft(h, p, sessionId, text);
    },
    loadDraft: drafts.loadDraft,
    openBridge: async (opts) => {
      const child = createFakeRpcChild({
        onCommand: (cmd, ctx) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: { sessionId: currentSessionId, model: ctx?.activeModel ?? null }
            };
          }
          if (cmd.type === "clone") {
            cloneCalls += 1;
            currentSessionId = "pi-fork";
            return { type: "response", command: "clone", success: true, data: { cancelled: false } };
          }
          if (cmd.type === "fork") {
            throw new Error("must never send entry-based fork");
          }
          if (cmd.type === "switch_session") {
            currentSessionId = "pi-a";
            return { type: "response", command: "switch_session", success: true, data: { cancelled: false } };
          }
          if (cmd.type === "get_messages") {
            return { type: "response", command: "get_messages", success: true, data: { messages: [] } };
          }
          if (cmd.type === "set_model") {
            if (ctx?.setModel) ctx.setModel({ id: cmd.modelId, provider: "kairo" });
            return { type: "response", command: "set_model", success: true, data: { id: cmd.modelId } };
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

  await new Promise((r) => setTimeout(r, 60));
  stdin.write(`${JSON.stringify({ op: "fork_session", draft: "source-outgoing" })}\n`);
  await new Promise((r) => setTimeout(r, 100));

  assert.ok(saveCalls.some((c) => c.sessionId === KAIRO_ID_A && c.text === "source-outgoing"));
  assert.equal(createCalls.length, 1);
  assert.equal(createCalls[0].mode, "agent", "fork inherits prior Kairo session mode");
  assert.deepEqual(recordCalls, [{ piSessionId: "pi-fork", kairoSessionId: KAIRO_ID_C }]);
  assert.equal(bindings.get("pi-a"), KAIRO_ID_A, "source binding untouched");
  assert.equal(drafts.map.get(KAIRO_ID_A), "source-outgoing", "source draft preserved under A");

  const sessions = [...out].reverse().find((r) => r.type === "sessions");
  const forkRow = sessions.sessions.find((s) => s.sessionId === "pi-fork");
  assert.equal(forkRow?.kairoSessionId, KAIRO_ID_C);

  const draftEvt = [...out].reverse().find((r) => r.type === "draft");
  assert.equal(draftEvt?.text, "");
  assert.equal(draftEvt?.kairoSessionId, KAIRO_ID_C);

  stdin.write(`${JSON.stringify({ op: "stop", draft: "fork-typed" })}\n`);
  stdin.end();
  await runPromise;
  assert.ok(
    saveCalls.some((c) => c.sessionId === KAIRO_ID_C && c.text === "fork-typed"),
    "stop after fork saves under the new active Kairo id"
  );
});

test("U3a close: cancelled switch keeps prior active id and does not load destination draft", async () => {
  const drafts = draftsStore();
  drafts.map.set(KAIRO_ID_B, "should-not-load");
  const saveCalls = [];
  const out = [];
  const stdout = new PassThrough();
  stdout.on("data", (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) out.push(JSON.parse(line));
  });
  const stdin = new PassThrough();

  let currentSessionId = "pi-a";
  const bindings = new Map([
    ["pi-a", KAIRO_ID_A],
    ["pi-b", KAIRO_ID_B]
  ]);

  const runPromise = runKairoUiRpcStdio({
    stdin,
    stdout,
    cwd: "/project",
    env: { KAIRO_SESSION_ID: KAIRO_ID_A },
    resolveProjectRoot: async () => "/project",
    listPiSessionFilesForCwd: () => [
      { path: "/x/a.jsonl", sessionId: "pi-a", label: "A" },
      { path: "/x/b.jsonl", sessionId: "pi-b", label: "B" }
    ],
    lookupPiBinding: async (_h, _r, piId) => bindings.get(piId) ?? null,
    saveDraft: async (h, p, sessionId, text) => {
      saveCalls.push({ sessionId, text });
      return drafts.saveDraft(h, p, sessionId, text);
    },
    loadDraft: drafts.loadDraft,
    openBridge: async (opts) => {
      const child = createFakeRpcChild({
        onCommand: (cmd, ctx) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: { sessionId: currentSessionId, model: ctx?.activeModel ?? null }
            };
          }
          if (cmd.type === "switch_session") {
            // Cancelled: Pi stays on A.
            return { type: "response", command: "switch_session", success: true, data: { cancelled: true } };
          }
          if (cmd.type === "set_model") {
            if (ctx?.setModel) ctx.setModel({ id: cmd.modelId, provider: "kairo" });
            return { type: "response", command: "set_model", success: true, data: { id: cmd.modelId } };
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

  await new Promise((r) => setTimeout(r, 60));
  stdin.write(
    `${JSON.stringify({ op: "switch_session_index", index: 1, draft: "still-on-A" })}\n`
  );
  await new Promise((r) => setTimeout(r, 80));

  assert.ok(saveCalls.some((c) => c.sessionId === KAIRO_ID_A && c.text === "still-on-A"));
  assert.equal(
    out.filter((r) => r.type === "draft").length,
    0,
    "cancelled switch must not emit destination draft"
  );

  stdin.write(`${JSON.stringify({ op: "stop", draft: "final-A" })}\n`);
  stdin.end();
  await runPromise;
  assert.ok(
    saveCalls.some((c) => c.sessionId === KAIRO_ID_A && c.text === "final-A"),
    "after cancel, stop still saves under the prior active id"
  );
});

test("U3a close: binding failure after clone emits error, does not fall back to prior id for the fork, leaves active unbound", async () => {
  const drafts = draftsStore();
  const saveCalls = [];
  const recordCalls = [];
  const out = [];
  const stdout = new PassThrough();
  stdout.on("data", (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) out.push(JSON.parse(line));
  });
  const stdin = new PassThrough();

  let currentSessionId = "pi-a";
  let cloneCalls = 0;
  const bindings = new Map([["pi-a", KAIRO_ID_A]]);

  const runPromise = runKairoUiRpcStdio({
    stdin,
    stdout,
    cwd: "/project",
    env: { KAIRO_SESSION_ID: KAIRO_ID_A },
    resolveProjectRoot: async () => "/project",
    listPiSessionFilesForCwd: () => [
      { path: "/x/a.jsonl", sessionId: "pi-a", label: "A" },
      ...(cloneCalls > 0 ? [{ path: "/x/fork.jsonl", sessionId: "pi-fork", label: "Fork" }] : [])
    ],
    lookupPiBinding: async (_h, _r, piId) => bindings.get(piId) ?? null,
    createSession: async () => ({ id: KAIRO_ID_C, mode: "ask" }),
    recordPiBinding: async (_h, _p, piSessionId, kairoSessionId) => {
      recordCalls.push({ piSessionId, kairoSessionId });
      throw new Error("disk full");
    },
    getSession: async () => ({ id: KAIRO_ID_A, mode: "ask" }),
    saveDraft: async (h, p, sessionId, text) => {
      saveCalls.push({ sessionId, text });
      return drafts.saveDraft(h, p, sessionId, text);
    },
    loadDraft: drafts.loadDraft,
    openBridge: async (opts) => {
      const child = createFakeRpcChild({
        onCommand: (cmd, ctx) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: { sessionId: currentSessionId, model: ctx?.activeModel ?? null }
            };
          }
          if (cmd.type === "clone") {
            cloneCalls += 1;
            currentSessionId = "pi-fork";
            return { type: "response", command: "clone", success: true, data: { cancelled: false } };
          }
          if (cmd.type === "switch_session") {
            currentSessionId = "pi-a";
            return { type: "response", command: "switch_session", success: true, data: { cancelled: false } };
          }
          if (cmd.type === "get_messages") {
            return { type: "response", command: "get_messages", success: true, data: { messages: [] } };
          }
          if (cmd.type === "set_model") {
            if (ctx?.setModel) ctx.setModel({ id: cmd.modelId, provider: "kairo" });
            return { type: "response", command: "set_model", success: true, data: { id: cmd.modelId } };
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

  await new Promise((r) => setTimeout(r, 60));
  stdin.write(`${JSON.stringify({ op: "fork_session", draft: "pre-fork" })}\n`);
  await new Promise((r) => setTimeout(r, 100));

  assert.ok(saveCalls.some((c) => c.sessionId === KAIRO_ID_A && c.text === "pre-fork"));
  assert.equal(recordCalls.length, 1);
  const err = [...out].reverse().find((r) => r.type === "error");
  assert.match(err?.message ?? "", /disk full|binding/i);
  assert.equal(bindings.get("pi-a"), KAIRO_ID_A, "source binding never overwritten as fallback");
  assert.equal(bindings.has("pi-fork"), false, "failed bind must not leave a destination mapping");

  // Fail-closed: active is unbound — stop must NOT save under A as if the
  // fork still owned A's identity.
  const beforeStop = saveCalls.length;
  stdin.write(`${JSON.stringify({ op: "stop", draft: "orphan-editor" })}\n`);
  stdin.end();
  await runPromise;
  const after = saveCalls.slice(beforeStop);
  assert.equal(
    after.filter((c) => c.sessionId === KAIRO_ID_A).length,
    0,
    "fail-closed: do not save the post-fork editor under the previous Kairo id"
  );
});

// ---------------------------------------------------------------------------
// U3b: extension_ui_request forward + one-way extension_ui_response (not RPC)
// ---------------------------------------------------------------------------

test("U3b: sidecar forwards extension_ui_request from Pi to host stdout verbatim", async () => {
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
              data: { sessionId: "s1", model: ctx?.activeModel ?? { id: "m" } }
            };
          }
          if (cmd.type === "set_model") {
            if (ctx?.setModel) ctx.setModel({ id: cmd.modelId, provider: "kairo" });
            return { type: "response", command: "set_model", success: true };
          }
          return null;
        }
      });
      const origWrite = childRef.stdin.write;
      childRef._stdinChunks = [];
      childRef.stdin.write = (chunk) => {
        childRef._stdinChunks.push(String(chunk));
        return origWrite.call(childRef.stdin, chunk);
      };
      return childRef;
    })
  });

  await new Promise((r) => setTimeout(r, 50));
  assert.equal(out[0]?.type, "ready");

  childRef.stdout.emit(
    "data",
    Buffer.from(
      `${JSON.stringify({
        type: "extension_ui_request",
        id: "uuid-select-1",
        method: "select",
        title: "Allow?",
        options: ["Allow", "Block"]
      })}\n`
    )
  );
  await new Promise((r) => setTimeout(r, 40));

  const req = out.find((r) => r.type === "extension_ui_request");
  assert.ok(req, "host must see extension_ui_request");
  assert.equal(req.id, "uuid-select-1");
  assert.equal(req.method, "select");
  assert.deepEqual(req.options, ["Allow", "Block"]);

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("U3b: extension_ui_response op writes to Pi stdin with the same id via sendRaw (never bridge.request)", async () => {
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
              data: { sessionId: "s1", model: ctx?.activeModel ?? { id: "m" } }
            };
          }
          if (cmd.type === "set_model") {
            if (ctx?.setModel) ctx.setModel({ id: cmd.modelId, provider: "kairo" });
            return { type: "response", command: "set_model", success: true };
          }
          // If someone mistakenly used bridge.request for extension_ui_response,
          // Pi would get a kairo-* id and this handler would fire — we assert that
          // never happens by recording raw stdin instead.
          return null;
        }
      });
      childRef._stdinChunks = [];
      const origWrite = childRef.stdin.write;
      childRef.stdin.write = (chunk) => {
        childRef._stdinChunks.push(String(chunk));
        return origWrite.call(childRef.stdin, chunk);
      };
      return childRef;
    })
  });

  await new Promise((r) => setTimeout(r, 50));
  const baseline = childRef._stdinChunks.length;

  stdin.write(
    `${JSON.stringify({
      op: "extension_ui_response",
      id: "uuid-select-1",
      value: "Allow"
    })}\n`
  );
  await new Promise((r) => setTimeout(r, 40));

  const written = childRef._stdinChunks
    .slice(baseline)
    .join("")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const response = written.find((r) => r.type === "extension_ui_response");
  assert.ok(response, "Pi stdin must receive extension_ui_response");
  assert.equal(response.id, "uuid-select-1", "response must preserve the original request id");
  assert.equal(response.value, "Allow");
  assert.ok(
    !String(response.id).startsWith("kairo-"),
    "must not mint a bridge.request pending id"
  );
  assert.ok(
    !out.some((r) => r.type === "error" && /Unknown op/i.test(r.message ?? "")),
    "extension_ui_response must be a known sidecar op"
  );

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("U3b: cancel response correlates by id and does not invent another id", async () => {
  let childRef = null;
  const stdout = new PassThrough();
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
              data: { model: ctx?.activeModel ?? { id: "m" } }
            };
          }
          if (cmd.type === "set_model") {
            if (ctx?.setModel) ctx.setModel({ id: cmd.modelId });
            return { type: "response", command: "set_model", success: true };
          }
          return null;
        }
      });
      childRef._stdinChunks = [];
      const origWrite = childRef.stdin.write;
      childRef.stdin.write = (chunk) => {
        childRef._stdinChunks.push(String(chunk));
        return origWrite.call(childRef.stdin, chunk);
      };
      return childRef;
    })
  });

  await new Promise((r) => setTimeout(r, 50));
  const baseline = childRef._stdinChunks.length;

  stdin.write(
    `${JSON.stringify({
      op: "extension_ui_response",
      id: "dialog-a",
      cancelled: true
    })}\n`
  );
  stdin.write(
    `${JSON.stringify({
      op: "extension_ui_response",
      id: "dialog-b",
      confirmed: false
    })}\n`
  );
  await new Promise((r) => setTimeout(r, 50));

  const written = childRef._stdinChunks
    .slice(baseline)
    .join("")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((r) => r.type === "extension_ui_response");

  assert.equal(written.length, 2);
  assert.equal(written[0].id, "dialog-a");
  assert.equal(written[0].cancelled, true);
  assert.equal(written[1].id, "dialog-b");
  assert.equal(written[1].confirmed, false);
  assert.notEqual(written[0].id, written[1].id);

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("U3b: notify extension_ui_request is forwarded without requiring a host response", async () => {
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
              data: { model: ctx?.activeModel ?? { id: "m" } }
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

  await new Promise((r) => setTimeout(r, 50));
  childRef.stdout.emit(
    "data",
    Buffer.from(
      `${JSON.stringify({
        type: "extension_ui_request",
        id: "uuid-notify-1",
        method: "notify",
        message: "Command blocked",
        notifyType: "warning"
      })}\n`
    )
  );
  await new Promise((r) => setTimeout(r, 40));

  const notify = out.find((r) => r.type === "extension_ui_request" && r.method === "notify");
  assert.ok(notify);
  assert.equal(notify.id, "uuid-notify-1");
  assert.equal(notify.message, "Command blocked");
  // Host is free to display; no extension_ui_response is required for notify.

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});
