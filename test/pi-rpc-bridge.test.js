import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import {
  KAIRO_WORKSPACE_SNAPSHOT_SCHEMA,
  buildPiRpcSpawnArgs,
  classifyPiEngineFromState,
  missingArchitectRouteReason,
  openPiRpcBridge,
  selectArchitectKairoModel
} from "../src/global/host/pi-rpc-bridge.js";
import { DEFAULT_EXTENSION_DIR } from "../src/global/host/launch-gentle-shell.js";

function fakeSnapshot(overrides = {}) {
  return {
    schema: KAIRO_WORKSPACE_SNAPSHOT_SCHEMA,
    project: { label: "demo" },
    agents: [],
    ...overrides
  };
}

function architectRoute(id = "codex::gpt-6-astra") {
  return {
    id,
    name: "GPT-6 Astra · Architect",
    kairoRoute: { adapterId: "codex", modelId: "gpt-6-astra", role: "Architect" }
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
  let activeModel = null;
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
      const response = onCommand(cmd, { activeModel, setModel: (m) => { activeModel = m; } });
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
  child._getActiveModel = () => activeModel;
  if (exitAfterMs != null) {
    setTimeout(() => child.emit("exit", 1, null), exitAfterMs);
  }
  return child;
}

function defaultGetStateHandler(ctx) {
  return {
    type: "response",
    command: "get_state",
    success: true,
    data: {
      sessionId: "sess-1",
      model: ctx.activeModel ?? null
    }
  };
}

function rpcChildWithArchitect(architectId, overrides = {}) {
  return createFakeRpcChild({
    onCommand: (cmd, ctx) => {
      if (cmd.type === "get_state") {
        return defaultGetStateHandler(ctx);
      }
      if (cmd.type === "set_model") {
        assert.equal(cmd.provider, "kairo");
        ctx.setModel({ provider: "kairo", id: cmd.modelId });
        return {
          type: "response",
          command: "set_model",
          success: true,
          data: { provider: "kairo", id: cmd.modelId }
        };
      }
      return overrides.onCommand?.(cmd, ctx) ?? null;
    },
    ...overrides
  });
}

const noArchitectModels = async () => [];

test("selectArchitectKairoModel picks Architect role only", () => {
  const models = [
    { id: "a::b", kairoRoute: { role: "Builder" } },
    architectRoute("codex::arch")
  ];
  assert.equal(selectArchitectKairoModel(models)?.id, "codex::arch");
  assert.equal(selectArchitectKairoModel([]), null);
  assert.match(missingArchitectRouteReason([]), /active strategy/i);
  assert.match(missingArchitectRouteReason(models.slice(0, 1)), /Architect/i);
});

test("buildPiRpcSpawnArgs includes extension resource flags and rpc mode", () => {
  const args = buildPiRpcSpawnArgs({
    cliPath: "/abs/cli.js",
    extensionDir: DEFAULT_EXTENSION_DIR
  });
  assert.equal(args[0], "/abs/cli.js");
  assert.ok(args.includes("-e"));
  assert.equal(args[args.indexOf("-e") + 1], DEFAULT_EXTENSION_DIR);
  for (const flag of [
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files",
    "--mode",
    "rpc",
    "--no-session"
  ]) {
    assert.ok(args.includes(flag), `missing ${flag}`);
  }
  assert.equal(args.includes("--tui-mode"), false);
});

test("classifyPiEngineFromState: missing model is no_model when RPC already answered get_state", () => {
  assert.deepEqual(classifyPiEngineFromState({}), {
    status: "no_model",
    reason: "No model selected",
    sessionId: null,
    model: null
  });
  assert.equal(classifyPiEngineFromState({ model: { id: "x" } }).status, "connected");
});

test("classifyPiEngineFromState: the placeholder model real Pi reports with no model is no_model", () => {
  // Captured from the real @kal-elsam/kairo-pi-coding-agent 0.87.1-kairo.5 RPC
  // cold start with no provider configured: get_state returns this placeholder
  // instead of null, and the following prompt fails with "No API key found".
  const placeholder = {
    id: "unknown",
    name: "unknown",
    api: "unknown",
    provider: "unknown",
    baseUrl: "",
    reasoning: false,
    input: [],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 0,
    maxTokens: 0
  };
  assert.deepEqual(
    classifyPiEngineFromState({ model: placeholder, sessionId: "s1" }),
    { status: "no_model", reason: "No model selected", sessionId: "s1", model: null }
  );
  // A real model that merely lacks metadata stays connected.
  assert.equal(
    classifyPiEngineFromState({ model: { id: "unknown", provider: "anthropic" } }).status,
    "connected"
  );
});

test("openPiRpcBridge always returns hostOpen with workspace-shell/v1 snapshot even when Pi spawn fails", async () => {
  const bridge = await openPiRpcBridge({
    cwd: "/project",
    loadSnapshot: async () => fakeSnapshot(),
    resolveCliPath: () => "/fake/cli.js",
    loadKairoProviderModels: noArchitectModels,
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

test("openPiRpcBridge reports no_model when Architect route is missing", async () => {
  const bridge = await openPiRpcBridge({
    cwd: "/project",
    loadSnapshot: async () => fakeSnapshot({ agents: [{ id: "orch", state: "idle" }] }),
    resolveCliPath: () => "/fake/cli.js",
    loadKairoProviderModels: noArchitectModels,
    spawnImpl: () => rpcChildWithArchitect("codex::x"),
    execPath: "/usr/bin/node",
    connectTimeoutMs: 500
  });

  assert.equal(bridge.hostOpen, true);
  assert.equal(bridge.engine.status, "no_model");
  assert.match(bridge.engine.reason, /Architect|projectTeam/i);
  assert.equal(bridge.engine.sessionId, "sess-1");
  await bridge.stop();
});

test("openPiRpcBridge spawns Pi with extension flags and set_model Architect", async () => {
  let spawnArgs = null;
  const setModelCalls = [];
  const architectId = "codex::gpt-6-astra";
  const bridge = await openPiRpcBridge({
    cwd: "/project",
    loadSnapshot: async () => fakeSnapshot(),
    resolveCliPath: () => "/abs/kairo-pi/dist/bundle/cli.js",
    loadKairoProviderModels: async () => [architectRoute(architectId)],
    spawnImpl: (command, args, options) => {
      spawnArgs = { command, args, options };
      return createFakeRpcChild({
        onCommand: (cmd, ctx) => {
          if (cmd.type === "get_state") {
            return defaultGetStateHandler(ctx);
          }
          if (cmd.type === "set_model") {
            setModelCalls.push(cmd);
            ctx.setModel({ provider: "kairo", id: cmd.modelId });
            return {
              type: "response",
              command: "set_model",
              success: true,
              data: { provider: "kairo", id: cmd.modelId }
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
  assert.equal(bridge.engine.model.id, architectId);
  assert.equal(bridge.engine.model.provider, "kairo");
  assert.equal(spawnArgs.command, "/usr/bin/node");
  assert.ok(spawnArgs.args.includes("-e"));
  assert.ok(spawnArgs.args.includes("--no-extensions"));
  assert.ok(spawnArgs.args.includes("--mode"));
  assert.ok(spawnArgs.args.includes("rpc"));
  assert.equal(spawnArgs.args[0], "/abs/kairo-pi/dist/bundle/cli.js");
  assert.equal(setModelCalls.length, 1);
  assert.equal(setModelCalls[0].provider, "kairo");
  assert.equal(setModelCalls[0].modelId, architectId);
  assert.equal(spawnArgs.options.stdio[0], "pipe");
  assert.equal(spawnArgs.options.cwd, "/project");
  await bridge.stop();
});

test("openPiRpcBridge still opens when get_state fails after spawn", async () => {
  const bridge = await openPiRpcBridge({
    cwd: "/project",
    loadSnapshot: async () => fakeSnapshot(),
    resolveCliPath: () => "/fake/cli.js",
    loadKairoProviderModels: noArchitectModels,
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

test("openPiRpcBridge no_model when set_model fails; no fallback provider", async () => {
  const setModelCalls = [];
  const bridge = await openPiRpcBridge({
    cwd: "/project",
    loadSnapshot: async () => fakeSnapshot(),
    resolveCliPath: () => "/fake/cli.js",
    loadKairoProviderModels: async () => [architectRoute()],
    spawnImpl: () =>
      createFakeRpcChild({
        onCommand: (cmd) => {
          if (cmd.type === "get_state") {
            return {
              type: "response",
              command: "get_state",
              success: true,
              data: { sessionId: "s" }
            };
          }
          if (cmd.type === "set_model") {
            setModelCalls.push(cmd);
            return {
              type: "response",
              command: "set_model",
              success: false,
              error: "Model not found: kairo/codex::gpt-6-astra"
            };
          }
          return null;
        }
      }),
    execPath: "/usr/bin/node",
    connectTimeoutMs: 500
  });

  assert.equal(bridge.hostOpen, true);
  assert.equal(bridge.engine.status, "no_model");
  assert.match(bridge.engine.reason, /set_model failed/i);
  assert.equal(setModelCalls.length, 1);
  assert.equal(setModelCalls[0].provider, "kairo");
  await bridge.stop();
});

test("R3: session events are consumable via onEvent and takeEvents", async () => {
  let childRef = null;
  const seen = [];
  const bridge = await openPiRpcBridge({
    cwd: "/project",
    loadSnapshot: async () => fakeSnapshot(),
    resolveCliPath: () => "/fake/cli.js",
    loadKairoProviderModels: async () => [architectRoute("codex::m")],
    spawnImpl: () => {
      childRef = rpcChildWithArchitect("codex::m");
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
  assert.equal(seen.length, 1);
  assert.equal(bridge.takeEvents().length, 1);
  await bridge.stop();
});

test("R3: unexpected Pi exit after connect flips engine off connected; host stays open", async () => {
  let childRef = null;
  const bridge = await openPiRpcBridge({
    cwd: "/project",
    loadSnapshot: async () => fakeSnapshot(),
    resolveCliPath: () => "/fake/cli.js",
    loadKairoProviderModels: async () => [architectRoute("codex::m")],
    spawnImpl: () => {
      childRef = rpcChildWithArchitect("codex::m");
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
  assert.equal(bridge.engine.sessionId, "sess-1");
  await bridge.stop();
});

test("R3: intentional stop does not mark engine unavailable as a crash", async () => {
  const bridge = await openPiRpcBridge({
    cwd: "/project",
    loadSnapshot: async () => fakeSnapshot(),
    resolveCliPath: () => "/fake/cli.js",
    loadKairoProviderModels: async () => [architectRoute("codex::m")],
    spawnImpl: () => rpcChildWithArchitect("codex::m"),
    execPath: "/usr/bin/node",
    connectTimeoutMs: 500
  });

  assert.equal(bridge.engine.status, "connected");
  await bridge.stop();
  assert.equal(bridge.engine.status, "stopped");
  assert.equal(bridge.hostOpen, true);
});

// ---------------------------------------------------------------------------
// U3b: extension_ui_response is fire-and-forget stdin — never bridge.request
// ---------------------------------------------------------------------------

test("U3b: bridge.sendRaw writes a line without registering a pending request id", async () => {
  let childRef = null;
  const bridge = await openPiRpcBridge({
    cwd: "/project",
    loadSnapshot: async () => fakeSnapshot(),
    resolveCliPath: () => "/fake/cli.js",
    loadKairoProviderModels: async () => [architectRoute("codex::m")],
    spawnImpl: () => {
      childRef = rpcChildWithArchitect("codex::m");
      return childRef;
    },
    execPath: "/usr/bin/node",
    connectTimeoutMs: 500
  });

  assert.equal(typeof bridge.sendRaw, "function", "bridge must expose sendRaw for one-way writes");
  const before = childRef._stdinChunks.length;
  bridge.sendRaw({
    type: "extension_ui_response",
    id: "uuid-ext-1",
    value: "Allow"
  });
  const written = childRef._stdinChunks.slice(before).join("");
  const lines = written.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0], {
    type: "extension_ui_response",
    id: "uuid-ext-1",
    value: "Allow"
  });
  // Must NOT mint a kairo-* request id or wait for a response envelope.
  assert.equal(lines[0].id, "uuid-ext-1");
  assert.ok(!String(lines[0].id).startsWith("kairo-"));

  // An unrelated pending request must still be resolvable after sendRaw.
  const pending = bridge.request({ type: "get_state" }, 500);
  const settled = await pending;
  assert.ok(settled == null || typeof settled === "object");
  await bridge.stop();
});

test("U3b: bridge.sendRaw cancelled response preserves the exact request id", async () => {
  let childRef = null;
  const bridge = await openPiRpcBridge({
    cwd: "/project",
    loadSnapshot: async () => fakeSnapshot(),
    resolveCliPath: () => "/fake/cli.js",
    loadKairoProviderModels: async () => [architectRoute("codex::m")],
    spawnImpl: () => {
      childRef = rpcChildWithArchitect("codex::m");
      return childRef;
    },
    execPath: "/usr/bin/node",
    connectTimeoutMs: 500
  });

  bridge.sendRaw({
    type: "extension_ui_response",
    id: "keep-me-id",
    cancelled: true
  });
  const last = childRef._stdinChunks.at(-1);
  const parsed = JSON.parse(String(last).trim());
  assert.equal(parsed.id, "keep-me-id");
  assert.equal(parsed.cancelled, true);
  assert.equal(parsed.type, "extension_ui_response");
  await bridge.stop();
});

test("U3 no-model cold start: startup stderr is surfaced verbatim in the exit reason", async () => {
  const bridge = await openPiRpcBridge({
    cwd: "/project",
    loadSnapshot: async () => fakeSnapshot(),
    resolveCliPath: () => "/fake/cli.js",
    loadKairoProviderModels: noArchitectModels,
    spawnImpl: () => {
      const child = createFakeRpcChild({ onCommand: () => null });
      setTimeout(() => {
        child.stderr.emit("data", Buffer.from("Error: No models available. Run /login first.\n"));
        child.emit("exit", 1, null);
      }, 10);
      return child;
    },
    execPath: "/usr/bin/node",
    connectTimeoutMs: 500
  });

  assert.equal(bridge.hostOpen, true);
  assert.equal(bridge.engine.status, "unavailable");
  assert.match(bridge.engine.reason, /code 1/);
  assert.match(bridge.engine.reason, /No models available\. Run \/login first\./);
  await bridge.stop();
});

test("U3 no-model cold start: stderr tail is bounded and later exits keep the diagnostic", async () => {
  let childRef = null;
  const bridge = await openPiRpcBridge({
    cwd: "/project",
    loadSnapshot: async () => fakeSnapshot(),
    resolveCliPath: () => "/fake/cli.js",
    loadKairoProviderModels: noArchitectModels,
    spawnImpl: () => {
      childRef = rpcChildWithArchitect("codex::x");
      return childRef;
    },
    execPath: "/usr/bin/node",
    connectTimeoutMs: 500
  });
  assert.equal(bridge.engine.status, "no_model");
  const events = [];
  bridge.onEvent((e) => events.push(e));
  childRef.stderr.emit("data", Buffer.from(`${"x".repeat(20000)}FINAL-LINE\n`));
  childRef.emit("exit", 2, null);
  const notice = events.find((e) => e.type === "engine_unavailable");
  assert.ok(notice, "engine_unavailable notice");
  assert.match(notice.reason, /code 2/);
  assert.match(notice.reason, /FINAL-LINE/);
  assert.ok(notice.reason.length < 5000, "stderr tail bounded");
  await bridge.stop();
});

async function exitReasonAfterStderr(chunks, code = 1) {
  let childRef = null;
  const bridge = await openPiRpcBridge({
    cwd: "/project",
    loadSnapshot: async () => fakeSnapshot(),
    resolveCliPath: () => "/fake/cli.js",
    loadKairoProviderModels: noArchitectModels,
    spawnImpl: () => {
      childRef = rpcChildWithArchitect("codex::x");
      return childRef;
    },
    execPath: "/usr/bin/node",
    connectTimeoutMs: 500
  });
  const events = [];
  bridge.onEvent((e) => events.push(e));
  for (const chunk of chunks) childRef.stderr.emit("data", Buffer.from(chunk));
  childRef.emit("exit", code, null);
  const notice = events.find((e) => e.type === "engine_unavailable");
  await bridge.stop();
  assert.ok(notice, "engine_unavailable notice");
  return notice.reason;
}

const FAKE_SECRETS = [
  "sk-test-FAKEFAKEFAKEFAKEFAKE1234",
  "Bearer fake.jwt.token.value",
  "ANTHROPIC_API_KEY=fake-key-value-123",
  "https://user:fakepass@example.invalid/x"
];
const FAKE_SECRET_PAYLOADS = [
  "sk-test-FAKEFAKEFAKEFAKEFAKE1234",
  "fake.jwt.token.value",
  "fake-key-value-123",
  "fakepass"
];

test("stderr tail is redacted: every secret form is masked, diagnostics survive", async () => {
  for (let i = 0; i < FAKE_SECRETS.length; i++) {
    const reason = await exitReasonAfterStderr([
      `Error: cannot load config /tmp/x/settings.json using ${FAKE_SECRETS[i]} now\n`
    ]);
    assert.ok(!reason.includes(FAKE_SECRET_PAYLOADS[i]), `secret ${i} leaked: ${reason}`);
    assert.match(reason, /\[REDACTED\]/);
    assert.match(reason, /Error: cannot load config \/tmp\/x\/settings\.json/);
    assert.match(reason, /code 1/);
  }
});

test("stderr tail redaction catches a secret split across two chunks", async () => {
  const reason = await exitReasonAfterStderr([
    "boot failed: key sk-test-FAKEFAKEF",
    "AKEFAKEFAKE1234 rejected\n"
  ]);
  assert.ok(!reason.includes("FAKEFAKEF"), reason);
  assert.ok(!reason.includes("AKEFAKEFAKE1234"), reason);
  assert.match(reason, /\[REDACTED\]/);
  assert.match(reason, /rejected/);
});

test("stderr tail redaction: a secret straddling the 2000-char boundary is not partially revealed", async () => {
  for (const pad of [1980, 1990, 2000, 2010, 2020, 8000 - 10, 8000 + 10]) {
    const secret = "sk-test-FAKEFAKEFAKEFAKEFAKE1234";
    const reason = await exitReasonAfterStderr([`${"a ".repeat(pad / 2)}${secret} tail-end-text\n`]);
    assert.ok(!reason.includes("FAKEFAKE"), `pad ${pad} leaked: ${reason.slice(0, 120)}`);
    assert.ok(!reason.includes("1234"), `pad ${pad} leaked tail: ${reason.slice(0, 120)}`);
    assert.match(reason, /tail-end-text/);
    assert.ok(reason.length < 2300, "bounded");
  }
});

test("stderr tail redaction keeps the tail bounded under heavy output", async () => {
  const reason = await exitReasonAfterStderr([`${"y".repeat(50000)}\nlast ANTHROPIC_API_KEY=fake-key-value-123\n`]);
  assert.ok(reason.length < 2300, `length ${reason.length}`);
  assert.ok(!reason.includes("fake-key-value-123"));
});
