import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import {
  KAIRO_WORKSPACE_SNAPSHOT_SCHEMA,
  openPiRpcBridge
} from "../src/global/host/pi-rpc-bridge.js";
import { runKairoUiRpcStdio, slashDiagnosticLines, projectStatusLines } from "../src/global/host/kairo-ui-rpc-stdio.js";

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

test("sidecar emits ready then routes prompt via submitTask (never Pi prompt)", async () => {
  let childRef = null;
  const out = [];
  const submitted = [];
  const piPromptCalls = [];
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
    submitTask: async (args) => {
      submitted.push(args);
      return { kind: "answer", provider: "claude", model: "opus", answer: "ok" };
    },
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
            piPromptCalls.push(cmd);
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
  const modeEvt = out.find((r) => r.type === "mode");
  assert.equal(modeEvt?.mode, "ask", "fail-closed default mode on ready");

  stdin.write(`${JSON.stringify({ op: "prompt", message: "hello" })}\n`);
  await new Promise((r) => setTimeout(r, 80));

  assert.equal(piPromptCalls.length, 0, "U4a: never forward Enter to Pi prompt");
  assert.deepEqual(submitted, [
    { cwd: "/project", task: "hello", mode: "ask", sessionId: null }
  ]);
  const result = out.find((r) => r.type === "task_result");
  assert.equal(result?.kind, "answer");
  assert.equal(result?.answer, "ok");

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

// ---------------------------------------------------------------------------
// U4a: ASK/PLAN/AGENT work modes (persisted per active Kairo session)
// ---------------------------------------------------------------------------

test("U4a: set_mode persists via service.setMode under activeKairoSessionId and emits mode", async () => {
  const modeCalls = [];
  const sessions = new Map([[KAIRO_ID_A, { id: KAIRO_ID_A, mode: "ask" }]]);
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
    getSession: async (_h, _p, id) => sessions.get(id) ?? null,
    setMode: async (args) => {
      modeCalls.push(args);
      sessions.set(args.sessionId, { id: args.sessionId, mode: args.mode });
      return { mode: args.mode };
    },
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
            return { type: "response", command: "set_model", success: true, data: { id: cmd.modelId } };
          }
          return null;
        }
      })
    )
  });

  await new Promise((r) => setTimeout(r, 50));
  stdin.write(`${JSON.stringify({ op: "set_mode", mode: "plan" })}\n`);
  await new Promise((r) => setTimeout(r, 60));

  assert.deepEqual(modeCalls, [{ cwd: "/project", mode: "plan", sessionId: KAIRO_ID_A }]);
  const modes = out.filter((r) => r.type === "mode").map((r) => r.mode);
  assert.ok(modes.includes("ask"), "ready emits fail-closed ask (or restored)");
  assert.equal(modes.at(-1), "plan");

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("U4a: set_mode persist failure emits cockpit-style notice and does not claim success", async () => {
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
    getSession: async () => ({ id: KAIRO_ID_A, mode: "ask" }),
    setMode: async () => {
      throw new Error("disk full");
    },
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
            return { type: "response", command: "set_model", success: true, data: { id: cmd.modelId } };
          }
          return null;
        }
      })
    )
  });

  await new Promise((r) => setTimeout(r, 50));
  const before = out.filter((r) => r.type === "mode").length;
  stdin.write(`${JSON.stringify({ op: "set_mode", mode: "agent" })}\n`);
  await new Promise((r) => setTimeout(r, 60));

  const notice = [...out].reverse().find((r) => r.type === "notice");
  assert.match(notice?.message ?? "", /Mode change not saved:.*disk full/i);
  assert.equal(
    out.filter((r) => r.type === "mode").length,
    before,
    "failed persist must not emit a successful mode record"
  );

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("U4a: ready restores persisted mode for active Kairo session; switch re-emits destination mode", async () => {
  const sessions = new Map([
    [KAIRO_ID_A, { id: KAIRO_ID_A, mode: "agent" }],
    [KAIRO_ID_B, { id: KAIRO_ID_B, mode: "plan" }]
  ]);
  const bindings = new Map([
    ["pi-a", KAIRO_ID_A],
    ["pi-b", KAIRO_ID_B]
  ]);
  let currentSessionId = "pi-a";
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
      { path: "/x/a.jsonl", sessionId: "pi-a", label: "A" },
      { path: "/x/b.jsonl", sessionId: "pi-b", label: "B" }
    ],
    lookupPiBinding: async (_h, _r, piId) => bindings.get(piId) ?? null,
    getSession: async (_h, _p, id) => sessions.get(id) ?? null,
    loadDraft: async () => "",
    saveDraft: async () => {},
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

  await new Promise((r) => setTimeout(r, 80));
  const readyModes = out.filter((r) => r.type === "mode");
  assert.equal(readyModes[0]?.mode, "agent");

  stdin.write(`${JSON.stringify({ op: "switch_session_index", index: 1, draft: "" })}\n`);
  await new Promise((r) => setTimeout(r, 100));

  const afterSwitch = out.filter((r) => r.type === "mode").at(-1);
  assert.equal(afterSwitch?.mode, "plan");

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("U4a: prompt in PLAN/AGENT calls submitTask with that mode and never Pi prompt", async () => {
  const submitted = [];
  const piPromptCalls = [];
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
    getSession: async () => ({ id: KAIRO_ID_A, mode: "plan" }),
    setMode: async ({ mode }) => ({ mode }),
    submitTask: async (args) => {
      submitted.push(args);
      return { kind: "plan", taskId: "task-42" };
    },
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
            return { type: "response", command: "set_model", success: true, data: { id: cmd.modelId } };
          }
          if (cmd.type === "prompt") {
            piPromptCalls.push(cmd);
            return { type: "response", command: "prompt", success: true };
          }
          return null;
        }
      })
    )
  });

  await new Promise((r) => setTimeout(r, 50));
  assert.equal(out.find((r) => r.type === "mode")?.mode, "plan");

  stdin.write(`${JSON.stringify({ op: "prompt", message: "Add OAuth" })}\n`);
  await new Promise((r) => setTimeout(r, 80));

  assert.equal(piPromptCalls.length, 0);
  assert.deepEqual(submitted, [
    { cwd: "/project", task: "Add OAuth", mode: "plan", sessionId: KAIRO_ID_A }
  ]);
  const result = out.find((r) => r.type === "task_result");
  assert.equal(result?.kind, "plan");
  assert.equal(result?.taskId, "task-42");
  assert.match(
    out.find((r) => r.type === "notice" && /Plan requested/i.test(r.message ?? ""))?.message ?? "",
    /Plan requested from Codex/
  );

  stdin.write(`${JSON.stringify({ op: "set_mode", mode: "agent" })}\n`);
  await new Promise((r) => setTimeout(r, 40));
  stdin.write(`${JSON.stringify({ op: "prompt", message: "What next?" })}\n`);
  await new Promise((r) => setTimeout(r, 80));

  assert.equal(submitted.at(-1)?.mode, "agent");
  assert.equal(piPromptCalls.length, 0);

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("U4a: invalid mode on set_mode fails closed to ask semantics and never persists garbage", async () => {
  const modeCalls = [];
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
    setMode: async (args) => {
      modeCalls.push(args);
      return { mode: args.mode };
    },
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
            return { type: "response", command: "set_model", success: true, data: { id: cmd.modelId } };
          }
          return null;
        }
      })
    )
  });

  await new Promise((r) => setTimeout(r, 50));
  stdin.write(`${JSON.stringify({ op: "set_mode", mode: "yolo" })}\n`);
  await new Promise((r) => setTimeout(r, 40));

  assert.equal(modeCalls.length, 0);
  const err = [...out].reverse().find((r) => r.type === "error");
  assert.match(err?.message ?? "", /Unknown work mode|invalid/i);

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

// ---------------------------------------------------------------------------
// U4b: plans list / show / decide (conversation service; never execute)
// ---------------------------------------------------------------------------

function fakePlanRow(overrides = {}) {
  return {
    taskId: "task-1",
    taskText: "Add OAuth",
    state: "awaiting_approval",
    provider: "codex",
    model: null,
    sessionId: KAIRO_ID_A,
    planReady: true,
    approval: "not_decided",
    execution: { state: "not_started", provider: "claude", message: "Approval is required before execution." },
    ...overrides
  };
}

test("U4b: plans.list returns timeline via snapshot scoped to activeKairoSessionId", async () => {
  const snapshotCalls = [];
  const timeline = [fakePlanRow(), fakePlanRow({ taskId: "task-2", state: "approved", approval: "approved" })];
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
    getSession: async () => ({ id: KAIRO_ID_A, mode: "plan" }),
    snapshot: async (args) => {
      snapshotCalls.push(args);
      return { timeline };
    },
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
            return { type: "response", command: "set_model", success: true, data: { id: cmd.modelId } };
          }
          return null;
        }
      })
    )
  });

  await new Promise((r) => setTimeout(r, 50));
  stdin.write(`${JSON.stringify({ op: "plans.list" })}\n`);
  await new Promise((r) => setTimeout(r, 60));

  assert.deepEqual(snapshotCalls, [{ cwd: "/project", sessionId: KAIRO_ID_A }]);
  const plans = out.find((r) => r.type === "plans");
  assert.ok(plans, "plans.list must emit a plans record");
  assert.equal(plans.timeline.length, 2);
  assert.equal(plans.timeline[0].taskId, "task-1");
  assert.equal(plans.timeline[0].state, "awaiting_approval");

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("U4b: plans.show returns taskMarkdown+planMarkdown with sessionId ownership", async () => {
  const showCalls = [];
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
    getSession: async () => ({ id: KAIRO_ID_A, mode: "plan" }),
    showPlan: async (args) => {
      showCalls.push(args);
      return {
        ...fakePlanRow({ taskId: args.taskId }),
        taskMarkdown: "# Task\n\nAdd OAuth\n",
        planMarkdown: "# Plan\n\n1. Wire auth\n"
      };
    },
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
            return { type: "response", command: "set_model", success: true, data: { id: cmd.modelId } };
          }
          return null;
        }
      })
    )
  });

  await new Promise((r) => setTimeout(r, 50));
  stdin.write(`${JSON.stringify({ op: "plans.show", taskId: "task-1" })}\n`);
  await new Promise((r) => setTimeout(r, 60));

  assert.deepEqual(showCalls, [{ cwd: "/project", taskId: "task-1", sessionId: KAIRO_ID_A }]);
  const detail = out.find((r) => r.type === "plan_detail");
  assert.ok(detail, "plans.show must emit plan_detail");
  assert.equal(detail.taskId, "task-1");
  assert.equal(detail.taskMarkdown, "# Task\n\nAdd OAuth\n");
  assert.equal(detail.planMarkdown, "# Plan\n\n1. Wire auth\n");
  assert.equal(detail.state, "awaiting_approval");

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("U4b: plans.decide approved|rejected then refreshes plans list; never executePlan", async () => {
  const decideCalls = [];
  const snapshotCalls = [];
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
    getSession: async () => ({ id: KAIRO_ID_A, mode: "agent" }),
    decidePlan: async (args) => {
      decideCalls.push(args);
      return fakePlanRow({
        taskId: args.taskId,
        state: args.decision,
        approval: args.decision === "approved" ? "approved" : "rejected"
      });
    },
    snapshot: async (args) => {
      snapshotCalls.push(args);
      return {
        timeline: [
          fakePlanRow({
            taskId: "task-1",
            state: decideCalls.at(-1)?.decision ?? "awaiting_approval",
            approval:
              decideCalls.at(-1)?.decision === "approved"
                ? "approved"
                : decideCalls.at(-1)?.decision === "rejected"
                  ? "rejected"
                  : "not_decided"
          })
        ]
      };
    },
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
            return { type: "response", command: "set_model", success: true, data: { id: cmd.modelId } };
          }
          return null;
        }
      })
    )
  });

  await new Promise((r) => setTimeout(r, 50));
  stdin.write(`${JSON.stringify({ op: "plans.decide", taskId: "task-1", decision: "approved" })}\n`);
  await new Promise((r) => setTimeout(r, 80));

  assert.deepEqual(decideCalls, [
    { cwd: "/project", taskId: "task-1", decision: "approved", sessionId: KAIRO_ID_A }
  ]);
  const decision = out.find((r) => r.type === "plan_decision");
  assert.ok(decision, "plans.decide must emit plan_decision");
  assert.equal(decision.taskId, "task-1");
  assert.equal(decision.decision, "approved");
  assert.equal(decision.state, "approved");
  assert.ok(
    out.some((r) => r.type === "plans" && r.timeline?.[0]?.state === "approved"),
    "decide must refresh plans list"
  );
  assert.equal(snapshotCalls.length, 1);
  assert.ok(!out.some((r) => /execute/i.test(JSON.stringify(r))));

  stdin.write(`${JSON.stringify({ op: "plans.decide", taskId: "task-1", decision: "rejected" })}\n`);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(decideCalls.at(-1)?.decision, "rejected");

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("U4b: plan task_result refreshes plans list and advertises y/n keys (not a)", async () => {
  const snapshotCalls = [];
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
    getSession: async () => ({ id: KAIRO_ID_A, mode: "plan" }),
    submitTask: async () => ({ kind: "plan", taskId: "task-99" }),
    snapshot: async (args) => {
      snapshotCalls.push(args);
      return { timeline: [fakePlanRow({ taskId: "task-99" })] };
    },
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
            return { type: "response", command: "set_model", success: true, data: { id: cmd.modelId } };
          }
          if (cmd.type === "prompt") {
            return { type: "response", command: "prompt", success: true };
          }
          return null;
        }
      })
    )
  });

  await new Promise((r) => setTimeout(r, 50));
  stdin.write(`${JSON.stringify({ op: "prompt", message: "Add OAuth" })}\n`);
  await new Promise((r) => setTimeout(r, 100));

  assert.equal(out.find((r) => r.type === "task_result")?.taskId, "task-99");
  assert.ok(snapshotCalls.length >= 1, "plan task_result must refresh plans via snapshot");
  const plans = [...out].reverse().find((r) => r.type === "plans");
  assert.ok(plans, "plan task_result must emit plans");
  assert.equal(plans.timeline[0].taskId, "task-99");
  const notice = [...out].reverse().find((r) => r.type === "notice" && /Plan requested/i.test(r.message ?? ""));
  assert.match(notice?.message ?? "", /y to approve/i);
  assert.match(notice?.message ?? "", /n to reject/i);
  assert.doesNotMatch(notice?.message ?? "", /press a to approve/i);

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("U4b: plans.decide rejects invalid decision without calling decidePlan", async () => {
  const decideCalls = [];
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
    decidePlan: async (args) => {
      decideCalls.push(args);
      return fakePlanRow();
    },
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
            return { type: "response", command: "set_model", success: true, data: { id: cmd.modelId } };
          }
          return null;
        }
      })
    )
  });

  await new Promise((r) => setTimeout(r, 50));
  stdin.write(`${JSON.stringify({ op: "plans.decide", taskId: "task-1", decision: "execute" })}\n`);
  await new Promise((r) => setTimeout(r, 40));

  assert.equal(decideCalls.length, 0);
  const err = [...out].reverse().find((r) => r.type === "error");
  assert.match(err?.message ?? "", /approved|rejected/i);

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

// ---------------------------------------------------------------------------
// U4c: role → planExecution preview → confirm execute / cancel / MANUAL_HANDOFF
// ---------------------------------------------------------------------------

const CONFIRM_TARGET = {
  role: "Builder",
  selection: "assigned",
  strategyFingerprint: "fp-1",
  candidateKey: "codex::gpt-6-astra"
};

function openBridgeWithModel() {
  return mockOpenBridge(() =>
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
          return { type: "response", command: "set_model", success: true, data: { id: cmd.modelId } };
        }
        return null;
      }
    })
  );
}

test("U4c: plans.preview calls planExecution with role+sessionId and emits plan_preview", async () => {
  const previewCalls = [];
  const executeCalls = [];
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
    getSession: async () => ({ id: KAIRO_ID_A, mode: "agent" }),
    planExecution: async (args) => {
      previewCalls.push(args);
      return {
        decision: "ROUTED",
        role: "Builder",
        provider: "codex",
        model: "gpt-6-astra",
        why: "reasoning task",
        confirmationTarget: CONFIRM_TARGET,
        taskPrompt: null
      };
    },
    executePlan: async (args) => {
      executeCalls.push(args);
      return { taskId: args.taskId };
    },
    openBridge: openBridgeWithModel()
  });

  await new Promise((r) => setTimeout(r, 50));
  stdin.write(`${JSON.stringify({ op: "plans.preview", taskId: "task-1", role: "Builder" })}\n`);
  await new Promise((r) => setTimeout(r, 60));

  assert.deepEqual(previewCalls, [
    { cwd: "/project", taskId: "task-1", role: "Builder", sessionId: KAIRO_ID_A }
  ]);
  assert.equal(executeCalls.length, 0, "ROUTED preview must never auto-execute");
  const preview = out.find((r) => r.type === "plan_preview");
  assert.ok(preview, "plans.preview must emit plan_preview");
  assert.equal(preview.decision, "ROUTED");
  assert.equal(preview.taskId, "task-1");
  assert.deepEqual(preview.confirmationTarget, CONFIRM_TARGET);
  assert.equal(preview.autoExecuted, false);

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("U4c: WAIT_FOR_PROJECT_TEAM + suggested-alternative auto-executes without y/n gate", async () => {
  const altTarget = {
    role: "Builder",
    selection: "suggested-alternative",
    strategyFingerprint: "fp-1",
    candidateKey: "claude::claude-opus-5"
  };
  const executeCalls = [];
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
    getSession: async () => ({ id: KAIRO_ID_A, mode: "agent" }),
    planExecution: async () => ({
      decision: "WAIT_FOR_PROJECT_TEAM",
      role: "Builder",
      provider: null,
      model: null,
      why: "assigned unavailable",
      confirmationTarget: altTarget,
      blockedAssignment: { provider: "codex", model: { displayName: "GPT-6 Astra" } },
      suggestedAlternative: { provider: "claude", model: { displayName: "Claude Opus" } },
      taskPrompt: null
    }),
    executePlan: async (args) => {
      executeCalls.push(args);
      return {
        taskId: args.taskId,
        execution: { state: "starting", active: true, runId: "run-1" }
      };
    },
    snapshot: async () => ({
      timeline: [
        fakePlanRow({
          taskId: "task-1",
          state: "approved",
          approval: "approved",
          execution: { state: "starting", active: true, runId: "run-1", provider: "claude" }
        })
      ],
      projectStrategy: {
        status: "active",
        projectTeam: [{ role: "Builder" }, { role: "Reviewer" }]
      }
    }),
    openBridge: openBridgeWithModel()
  });

  await new Promise((r) => setTimeout(r, 50));
  stdin.write(`${JSON.stringify({ op: "plans.preview", taskId: "task-1", role: "Builder" })}\n`);
  await new Promise((r) => setTimeout(r, 100));

  assert.equal(executeCalls.length, 1, "suggested-alternative must auto-executePlan");
  assert.deepEqual(executeCalls[0].confirmationTarget, altTarget);
  const preview = out.find((r) => r.type === "plan_preview");
  assert.equal(preview?.autoExecuted, true);
  assert.ok(out.some((r) => r.type === "plan_execute"));
  assert.ok(
    out.some((r) => r.type === "notice" && /falling back/i.test(r.message ?? "")),
    "must narrate the automatic fallback"
  );
  assert.ok(out.some((r) => r.type === "plans"), "must refresh plans after auto-execute");

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("U4c: MANUAL_HANDOFF preview emits taskPrompt and never calls executePlan", async () => {
  const executeCalls = [];
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
    getSession: async () => ({ id: KAIRO_ID_A, mode: "agent" }),
    planExecution: async () => ({
      decision: "MANUAL_HANDOFF",
      role: "Builder",
      provider: "cursor",
      model: "cursor-model",
      why: "cursor isn't executable by Kairo automatically",
      confirmationTarget: null,
      taskPrompt: "# Plan\n\nImplement the explicitly approved architecture plan\n",
      modelRef: { displayName: "Cursor Composer" }
    }),
    executePlan: async (args) => {
      executeCalls.push(args);
      return {};
    },
    openBridge: openBridgeWithModel()
  });

  await new Promise((r) => setTimeout(r, 50));
  stdin.write(`${JSON.stringify({ op: "plans.preview", taskId: "task-1", role: "Builder" })}\n`);
  await new Promise((r) => setTimeout(r, 60));

  assert.equal(executeCalls.length, 0);
  const preview = out.find((r) => r.type === "plan_preview");
  assert.equal(preview?.decision, "MANUAL_HANDOFF");
  assert.equal(preview?.confirmationTarget, null);
  assert.match(preview?.taskPrompt ?? "", /# Plan/);
  assert.equal(preview?.autoExecuted, false);

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("U4c: plans.execute requires confirmationTarget; stale reject surfaces error; success refreshes plans", async () => {
  const executeCalls = [];
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
    getSession: async () => ({ id: KAIRO_ID_A, mode: "agent" }),
    executePlan: async (args) => {
      executeCalls.push(args);
      if (!args.confirmationTarget) {
        throw new Error("confirmationTarget from a fresh planExecution is required");
      }
      if (args.confirmationTarget.strategyFingerprint === "stale") {
        throw new Error("confirmationTarget no longer matches the current route");
      }
      return {
        taskId: args.taskId,
        execution: { state: "starting", active: true, runId: "run-9" }
      };
    },
    snapshot: async () => ({
      timeline: [
        fakePlanRow({
          taskId: "task-1",
          state: "approved",
          approval: "approved",
          execution: { state: "starting", active: true, runId: "run-9", provider: "codex" }
        })
      ],
      projectStrategy: { status: "active", projectTeam: [{ role: "Builder" }] }
    }),
    openBridge: openBridgeWithModel()
  });

  await new Promise((r) => setTimeout(r, 50));
  stdin.write(`${JSON.stringify({ op: "plans.execute", taskId: "task-1" })}\n`);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(executeCalls.length, 0);
  assert.match(
    [...out].reverse().find((r) => r.type === "error")?.message ?? "",
    /confirmationTarget/i
  );

  stdin.write(
    `${JSON.stringify({
      op: "plans.execute",
      taskId: "task-1",
      confirmationTarget: { ...CONFIRM_TARGET, strategyFingerprint: "stale" }
    })}\n`
  );
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(executeCalls.length, 1);
  assert.match(
    [...out].reverse().find((r) => r.type === "error")?.message ?? "",
    /no longer matches|confirmationTarget/i
  );

  stdin.write(
    `${JSON.stringify({
      op: "plans.execute",
      taskId: "task-1",
      confirmationTarget: CONFIRM_TARGET
    })}\n`
  );
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(executeCalls.length, 2);
  assert.deepEqual(executeCalls[1], {
    cwd: "/project",
    taskId: "task-1",
    confirmationTarget: CONFIRM_TARGET,
    sessionId: KAIRO_ID_A
  });
  assert.ok(out.some((r) => r.type === "plan_execute" && r.taskId === "task-1"));
  assert.ok(out.some((r) => r.type === "plans"));

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("U4c: plans.cancel calls cancelExecution and refreshes plans", async () => {
  const cancelCalls = [];
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
    getSession: async () => ({ id: KAIRO_ID_A, mode: "agent" }),
    cancelExecution: async (args) => {
      cancelCalls.push(args);
      return { taskId: args.taskId, execution: { state: "cancelled", active: false } };
    },
    snapshot: async () => ({
      timeline: [
        fakePlanRow({
          taskId: "task-1",
          state: "approved",
          approval: "approved",
          execution: { state: "cancelled", active: false, provider: "claude" }
        })
      ],
      projectStrategy: { status: "active", projectTeam: [{ role: "Builder" }] }
    }),
    openBridge: openBridgeWithModel()
  });

  await new Promise((r) => setTimeout(r, 50));
  stdin.write(`${JSON.stringify({ op: "plans.cancel", taskId: "task-1" })}\n`);
  await new Promise((r) => setTimeout(r, 80));

  assert.deepEqual(cancelCalls, [{ cwd: "/project", taskId: "task-1" }]);
  assert.ok(out.some((r) => r.type === "plan_cancel" && r.taskId === "task-1"));
  assert.ok(out.some((r) => r.type === "plans"));

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("U4c: plans.transcript tails readRunTranscript entries", async () => {
  const transcriptCalls = [];
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
    getSession: async () => ({ id: KAIRO_ID_A, mode: "agent" }),
    readRunTranscript: async (args) => {
      transcriptCalls.push(args);
      return {
        runId: args.runId,
        nextIndex: 2,
        entries: [
          { provider: "claude", timestamp: "t1", text: "line one" },
          { provider: "claude", timestamp: "t2", text: "line two" }
        ]
      };
    },
    openBridge: openBridgeWithModel()
  });

  await new Promise((r) => setTimeout(r, 50));
  stdin.write(`${JSON.stringify({ op: "plans.transcript", runId: "run-1", sinceIndex: 0 })}\n`);
  await new Promise((r) => setTimeout(r, 60));

  assert.deepEqual(transcriptCalls, [{ runId: "run-1", sinceIndex: 0 }]);
  const tr = out.find((r) => r.type === "run_transcript");
  assert.ok(tr);
  assert.equal(tr.runId, "run-1");
  assert.equal(tr.nextIndex, 2);
  assert.equal(tr.entries.length, 2);
  assert.equal(tr.entries[0].text, "line one");

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("U4c: plans.list includes projectTeamRoles from active strategy", async () => {
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
    getSession: async () => ({ id: KAIRO_ID_A, mode: "agent" }),
    snapshot: async () => ({
      timeline: [fakePlanRow({ state: "approved", approval: "approved" })],
      projectStrategy: {
        status: "active",
        projectTeam: [{ role: "Builder" }, { role: "Reviewer" }]
      }
    }),
    openBridge: openBridgeWithModel()
  });

  await new Promise((r) => setTimeout(r, 50));
  stdin.write(`${JSON.stringify({ op: "plans.list" })}\n`);
  await new Promise((r) => setTimeout(r, 60));

  const plans = out.find((r) => r.type === "plans");
  assert.deepEqual(plans?.projectTeamRoles, ["Builder", "Reviewer"]);

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("U4c: plans.preview requires taskId and role", async () => {
  const previewCalls = [];
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
    planExecution: async (args) => {
      previewCalls.push(args);
      return {};
    },
    openBridge: openBridgeWithModel()
  });

  await new Promise((r) => setTimeout(r, 50));
  stdin.write(`${JSON.stringify({ op: "plans.preview", taskId: "task-1" })}\n`);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(previewCalls.length, 0);
  assert.match([...out].reverse().find((r) => r.type === "error")?.message ?? "", /role/i);

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("U4d: slashDiagnosticLines formats usage/providers/why from a snapshot", () => {
  const snap = {
    usage: {
      codex: { windows: [{ name: "5h", remainingPercent: 80 }], source: "measured" },
      claude: { windows: [] },
      opencode: { go: { windows: [{ name: "daily", remainingPercent: 10, status: "ok" }], source: "measured" } }
    },
    providers: { Cursor: { status: "READY" } },
    integrations: { engram: { status: "available" } },
    modelIntelligence: { coverage: [] }
  };
  const usage = slashDiagnosticLines(snap, "usage").join("\n");
  assert.match(usage, /Codex/);
  assert.match(usage, /Go/);
  const providers = slashDiagnosticLines(snap, "providers").join("\n");
  assert.match(providers, /Cursor/);
  const status = slashDiagnosticLines(snap, "status").join("\n");
  assert.match(status, /Engram/);
});

test("U4d: projectStatusLines reports not-analyzed and SUGGESTED team", () => {
  assert.match(projectStatusLines({}).join("\n"), /not analyzed/i);
  const lines = projectStatusLines({
    projectStrategy: {
      status: "suggested",
      projectTeam: [{ role: "Builder", model: { displayName: "GPT", adapterId: "codex" } }]
    }
  });
  assert.match(lines.join("\n"), /SUGGESTED/);
  assert.match(lines.join("\n"), /Builder/);
});

test("U4d: slash.info emits slash_lines for usage", async () => {
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
    getSession: async () => ({ id: KAIRO_ID_A, mode: "ask" }),
    snapshot: async () => ({
      usage: { codex: { windows: [{ name: "5h", remainingPercent: 50 }], source: "measured" } },
      providers: {},
      integrations: {}
    }),
    openBridge: openBridgeWithModel()
  });
  await new Promise((r) => setTimeout(r, 50));
  stdin.write(`${JSON.stringify({ op: "slash.info", kind: "usage" })}\n`);
  await new Promise((r) => setTimeout(r, 60));
  const lines = out.find((r) => r.type === "slash_lines");
  assert.equal(lines?.kind, "usage");
  assert.ok(Array.isArray(lines?.lines) && lines.lines.length > 0);
  assert.match(lines.lines.join("\n"), /Codex/);
  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("U4d: team.edit.catalog returns models; team.edit.assign persists SUGGESTED only", async () => {
  const assignCalls = [];
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
    getSession: async () => ({ id: KAIRO_ID_A, mode: "ask" }),
    snapshot: async () => ({
      projectStrategy: {
        status: "suggested",
        projectTeam: [
          {
            role: "Builder",
            model: { candidateKey: "codex::a", displayName: "A", adapterId: "codex" },
            recommendedAssignment: { model: { candidateKey: "codex::a" } }
          }
        ]
      }
    }),
    getProjectTeamEditCatalog: async ({ role }) => ({
      role,
      models: [
        { candidateKey: "codex::a", displayName: "A", adapterId: "codex" },
        { candidateKey: "claude::b", displayName: "B", adapterId: "claude" }
      ]
    }),
    setProjectTeamAssignment: async (args) => {
      assignCalls.push(args);
      return { status: "suggested", projectTeam: [{ role: args.role }] };
    },
    loadSnapshot: async () => fakeSnapshot(),
    openBridge: openBridgeWithModel()
  });
  await new Promise((r) => setTimeout(r, 50));
  stdin.write(`${JSON.stringify({ op: "team.edit.catalog", role: "Builder" })}\n`);
  await new Promise((r) => setTimeout(r, 60));
  const catalog = out.find((r) => r.type === "team_edit_catalog");
  assert.equal(catalog?.role, "Builder");
  assert.equal(catalog?.models?.length, 2);
  assert.equal(catalog?.currentCandidateKey, "codex::a");

  stdin.write(
    `${JSON.stringify({ op: "team.edit.assign", role: "Builder", candidateKey: "claude::b" })}\n`
  );
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(assignCalls, [
    { cwd: "/project", role: "Builder", candidateKey: "claude::b" }
  ]);
  assert.ok(out.some((r) => r.type === "team_edit_saved" && r.role === "Builder"));

  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("U4d: team.edit.assign refuses ACTIVE/STALE via service error", async () => {
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
    setProjectTeamAssignment: async () => {
      throw new Error("Cannot edit a ACTIVE project strategy — only a SUGGESTED one is editable.");
    },
    openBridge: openBridgeWithModel()
  });
  await new Promise((r) => setTimeout(r, 50));
  stdin.write(
    `${JSON.stringify({ op: "team.edit.assign", role: "Builder", candidateKey: "codex::a" })}\n`
  );
  await new Promise((r) => setTimeout(r, 60));
  assert.match(
    [...out].reverse().find((r) => r.type === "error")?.message ?? "",
    /ACTIVE|SUGGESTED/
  );
  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("U4d: slash.clear clears transcript via DI", async () => {
  const clearCalls = [];
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
    getSession: async () => ({ id: KAIRO_ID_A, mode: "ask" }),
    clearTranscript: async (args) => {
      clearCalls.push(args);
    },
    openBridge: openBridgeWithModel()
  });
  await new Promise((r) => setTimeout(r, 50));
  stdin.write(`${JSON.stringify({ op: "slash.clear" })}\n`);
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(clearCalls, [{ cwd: "/project", sessionId: KAIRO_ID_A }]);
  assert.ok(out.some((r) => r.type === "transcript" && Array.isArray(r.messages) && r.messages.length === 0));
  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("U5a: ops.snapshot emits ops_snapshot with honest fleet label", async () => {
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
    getSession: async () => ({ id: KAIRO_ID_A, mode: "ask" }),
    snapshot: async () => ({
      usage: { codex: { windows: [{ name: "5h", remainingPercent: 40 }], source: "measured" } }
    }),
    buildOpsSnapshot: async () => ({
      ok: true,
      error: null,
      health: ["Control plane · HEALTHY"],
      fleet: [
        "Fleet topology (kairo fleet) — not slash /providers",
        "",
        "Fleet floor",
        "opencode · gentle-orchestrator · deepseek"
      ],
      usage: ["Provider usage (/usage)", "Codex · 40%"],
      diagnostics: ["Agents", "Detected: 1/1"],
      hints: "Esc → Work · r refresh"
    }),
    openBridge: openBridgeWithModel()
  });
  await new Promise((r) => setTimeout(r, 50));
  stdin.write(`${JSON.stringify({ op: "ops.snapshot" })}\n`);
  await new Promise((r) => setTimeout(r, 60));
  const ops = out.find((r) => r.type === "ops_snapshot");
  assert.equal(ops?.ok, true);
  assert.equal(ops?.health?.[0], "Control plane · HEALTHY");
  assert.match(ops?.fleet?.[0] ?? "", /kairo fleet/);
  assert.doesNotMatch(ops?.fleet?.[0] ?? "", /^\/providers/);
  assert.match(ops?.usage?.join("\n") ?? "", /Codex|usage/i);
  assert.match(ops?.diagnostics?.join("\n") ?? "", /Agents/);
  assert.match(ops?.hints ?? "", /Esc/);
  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("U5b: ops.sync.preview/apply and ops.runs.cancel wire through DI", async () => {
  const out = [];
  const stdout = new PassThrough();
  stdout.on("data", (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) out.push(JSON.parse(line));
  });
  const stdin = new PassThrough();
  const syncCalls = [];
  const cancelCalls = [];
  const runPromise = runKairoUiRpcStdio({
    stdin,
    stdout,
    cwd: "/project",
    env: { KAIRO_SESSION_ID: KAIRO_ID_A },
    getSession: async () => ({ id: KAIRO_ID_A, mode: "ask" }),
    previewOpsSync: async () => {
      syncCalls.push("preview");
      return {
        ok: true,
        fingerprint: "fp-1",
        hasChanges: true,
        changes: [{ action: "write", target: "x" }]
      };
    },
    applyOpsSync: async ({ preview }) => {
      syncCalls.push(preview?.fingerprint);
      return { ok: true, reason: "repaired", wrote: true, receipt: { action: "repaired" } };
    },
    cancelOpsRun: async ({ runId }) => {
      cancelCalls.push(runId);
      return { ok: true, reason: "cancelled", runId, state: "cancelled" };
    },
    openBridge: openBridgeWithModel()
  });
  await new Promise((r) => setTimeout(r, 50));
  stdin.write(`${JSON.stringify({ op: "ops.sync.preview" })}\n`);
  await new Promise((r) => setTimeout(r, 40));
  stdin.write(
    `${JSON.stringify({
      op: "ops.sync.apply",
      preview: { fingerprint: "fp-1", hasChanges: true }
    })}\n`
  );
  await new Promise((r) => setTimeout(r, 40));
  stdin.write(`${JSON.stringify({ op: "ops.runs.cancel", runId: "run-9" })}\n`);
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(syncCalls, ["preview", "fp-1"]);
  assert.deepEqual(cancelCalls, ["run-9"]);
  assert.equal(out.find((r) => r.type === "ops_sync_preview")?.fingerprint, "fp-1");
  assert.equal(out.find((r) => r.type === "ops_sync_result")?.ok, true);
  assert.equal(out.find((r) => r.type === "ops_run_cancel")?.runId, "run-9");
  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("U5b: ops.alerts.dismiss refuses without confirmed; settings.snapshot + integration confirm", async () => {
  const out = [];
  const stdout = new PassThrough();
  stdout.on("data", (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) out.push(JSON.parse(line));
  });
  const stdin = new PassThrough();
  const dismissCalls = [];
  const runPromise = runKairoUiRpcStdio({
    stdin,
    stdout,
    cwd: "/project",
    env: { KAIRO_SESSION_ID: KAIRO_ID_A },
    getSession: async () => ({ id: KAIRO_ID_A, mode: "ask" }),
    dismissOpsAlert: async (args) => {
      dismissCalls.push(args);
      if (!args.confirmed) return { ok: false, reason: "confirm-required" };
      return { ok: true, reason: "dismissed", alert: { alertId: args.alertId } };
    },
    buildSettingsSnapshot: async () => ({
      ok: true,
      error: null,
      profile: ["PROFILE", "applyMode · prompt"],
      integrations: ["CURATED", "available · Pi usage widget"],
      connections: ["CONNECTIONS", "ok · Cursor MCP"],
      catalog: [],
      setup: { wired: false, label: "Interactive setup · not wired — use `kairo setup`" },
      hints: "Esc → Work · ↑↓ browse"
    }),
    openBridge: openBridgeWithModel()
  });
  await new Promise((r) => setTimeout(r, 50));
  stdin.write(
    `${JSON.stringify({ op: "ops.alerts.dismiss", alertId: "alt-aaaaaaaaaaaaaaaa" })}\n`
  );
  await new Promise((r) => setTimeout(r, 40));
  stdin.write(
    `${JSON.stringify({
      op: "ops.alerts.dismiss",
      alertId: "alt-aaaaaaaaaaaaaaaa",
      confirmed: true
    })}\n`
  );
  await new Promise((r) => setTimeout(r, 40));
  stdin.write(`${JSON.stringify({ op: "settings.snapshot" })}\n`);
  await new Promise((r) => setTimeout(r, 40));
  stdin.write(
    `${JSON.stringify({ op: "settings.integration.confirm", id: "pi-usage-widget" })}\n`
  );
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(dismissCalls[0]?.confirmed, false);
  assert.equal(dismissCalls[1]?.confirmed, true);
  const denied = out.filter((r) => r.type === "ops_alert_dismiss");
  assert.equal(denied[0]?.ok, false);
  assert.equal(denied[1]?.ok, true);
  const settings = out.find((r) => r.type === "settings_snapshot");
  assert.equal(settings?.ok, true);
  assert.match(settings?.setup?.label ?? "", /not wired/);
  assert.match(settings?.profile?.join("\n") ?? "", /applyMode/);
  const intent = out.find((r) => r.type === "settings_integration_result");
  assert.equal(intent?.ok, true);
  assert.equal(intent?.wroteFiles, false);
  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});

test("U5b: ops.rollback.preview/apply wire through DI", async () => {
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
    getSession: async () => ({ id: KAIRO_ID_A, mode: "ask" }),
    previewOpsRollback: async ({ snapshot }) => ({
      ok: true,
      fingerprint: "fp-rb",
      snapshot,
      files: [{ displayPath: "~/.cursor/AGENTS.md" }]
    }),
    applyOpsRollback: async ({ preview }) => ({
      ok: true,
      reason: "applied",
      wrote: true,
      receipt: { action: "rollback", snapshot: preview.snapshot }
    }),
    openBridge: openBridgeWithModel()
  });
  await new Promise((r) => setTimeout(r, 50));
  stdin.write(`${JSON.stringify({ op: "ops.rollback.preview", snapshot: "snap-a" })}\n`);
  await new Promise((r) => setTimeout(r, 40));
  stdin.write(
    `${JSON.stringify({
      op: "ops.rollback.apply",
      preview: { fingerprint: "fp-rb", snapshot: "snap-a" }
    })}\n`
  );
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(out.find((r) => r.type === "ops_rollback_preview")?.snapshot, "snap-a");
  assert.equal(out.find((r) => r.type === "ops_rollback_result")?.ok, true);
  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
});
