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
