import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { runKairoUiRpcStdio } from "../src/global/host/kairo-ui-rpc-stdio.js";
import { adaptProviderConnectionsApi } from "../src/global/host/settings-provider-connections.js";
import {
  createFakeCliInteractiveRunner
} from "../src/global/host/connections-interactive-pty.js";
import { createProviderConnections } from "../src/global/provider-connections/index.js";
import { createFakeRunner } from "./helpers/fake-connection-runner.js";

const KAIRO_ID = "aaaaaaaa-0000-4000-8000-000000000001";

function tempHome() {
  const home = mkdtempSync(join(tmpdir(), "kairo-rpc-conn-"));
  mkdirSync(join(home, ".harness"), { recursive: true });
  return home;
}

function openBridgeStub() {
  return async () => ({
    request: async () => ({}),
    stop: async () => {},
    sendRaw: () => {},
    onEvent: () => {},
    getState: async () => ({})
  });
}

async function runRpc(options, script) {
  const home = options.homeDir ?? tempHome();
  const out = [];
  const stdout = new PassThrough();
  stdout.on("data", (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) {
      try {
        out.push(JSON.parse(line));
      } catch {
        /* ignore */
      }
    }
  });
  const stdin = new PassThrough();
  const runPromise = runKairoUiRpcStdio({
    stdin,
    stdout,
    cwd: "/project",
    env: { KAIRO_SESSION_ID: KAIRO_ID, HARNESS_HOME: home },
    resolveHomeDir: () => home,
    getSession: async () => ({ id: KAIRO_ID, mode: "ask" }),
    openBridge: openBridgeStub(),
    loadKairoProviderModels: async () => [],
    loadSnapshot: async () => ({ ok: true }),
    listPiSessionFilesForCwd: () => [],
    resolveProjectRoot: async () => null,
    buildSettingsSnapshot: async () => ({
      ok: true,
      profile: [],
      integrations: [],
      connections: [],
      catalog: [],
      setup: { wired: true, label: "x" },
      hints: ""
    }),
    ...options
  });
  await new Promise((r) => setTimeout(r, 50));
  await script({ stdin, out, home });
  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await runPromise;
  return out;
}

function claudeBackend({ auth, interactive, homeDir }) {
  const runner = createFakeRunner({
    "claude --version": { stdout: "2.1.287\n" },
    "claude auth status --json": auth
  });
  const api = createProviderConnections({
    runner,
    interactiveRunner: interactive,
    homeDir: homeDir ?? tempHome(),
    now: () => 1_700_000_000_000
  });
  return adaptProviderConnectionsApi(api);
}

test("boot never starts connections.connect", async () => {
  const auth = { code: 1, stdout: JSON.stringify({ loggedIn: false }) };
  const interactive = createFakeCliInteractiveRunner({ exitCode: 0 });
  const backend = claudeBackend({ auth, interactive });
  await runRpc({ connectionsBackend: backend }, async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
  assert.equal(interactive.calls.length, 0);
});

test("missing interactive runner reports incomplete configuration (no silent simulation)", async () => {
  const out = await runRpc({
    // Force default loader with no interactive runner by stubbing loader.
    connectionsBackend: null,
    loadConnectionsBackend: () => ({
      incomplete: true,
      reason: "missing_interactive_runner",
      async status() {
        return {
          ok: false,
          incomplete: true,
          reason: "missing_interactive_runner",
          providers: [{
            providerId: "claude",
            incomplete: true,
            installation: { state: "unknown" },
            authentication: { state: "unknown" },
            modelAccess: { state: "unknown" },
            quota: { state: "unknown" }
          }]
        };
      },
      preview() {
        return { ok: false, incomplete: true, reason: "missing_interactive_runner" };
      },
      async connect() {
        return { ok: false, reason: "incomplete_configuration" };
      }
    })
  }, async ({ stdin }) => {
    stdin.write(`${JSON.stringify({ op: "connections.status" })}\n`);
    await new Promise((r) => setTimeout(r, 40));
  });
  const status = out.find((r) => r.type === "connections_status");
  assert.equal(status.incomplete, true);
  assert.equal(status.ok, false);
});

test("journey: absent → preview → consent → host-bridged login → inventory confirmed", async () => {
  const auth = { code: 1, stdout: JSON.stringify({ loggedIn: false }) };
  const statusRunner = createFakeRunner({
    "claude --version": { stdout: "2.1.287\n" },
    "claude auth status --json": auth
  });
  const out = await runRpc({
    connectionsBackend: null,
    // Only status runner injected — interactive uses sidecar host-bridge (emits terminal_yield).
    connectionsStatusRunner: statusRunner
  }, async ({ stdin, out }) => {
    stdin.write(`${JSON.stringify({ op: "connections.status", provider: "claude" })}\n`);
    await new Promise((r) => setTimeout(r, 40));
    const status1 = out.find((r) => r.type === "connections_status");
    assert.equal(status1.inventory[0].action, "connect");
    assert.equal(status1.inventory[0].authentication, "unauthenticated");

    stdin.write(`${JSON.stringify({ op: "connections.preview", provider: "claude" })}\n`);
    await new Promise((r) => setTimeout(r, 40));
    const preview = out.find((r) => r.type === "connections_preview");
    assert.equal(preview.ok, true);
    assert.ok(preview.previewId);

    stdin.write(`${JSON.stringify({
      op: "connections.connect",
      provider: "claude",
      fingerprint: preview.previewId,
      confirm: true
    })}\n`);
    await new Promise((r) => setTimeout(r, 50));
    const yieldRec = out.find((r) => r.type === "terminal_yield");
    assert.ok(yieldRec, "terminal_yield must leave RPC stdio");
    assert.deepEqual(yieldRec.argv, ["claude", "auth", "login", "--claudeai"]);
    assert.ok(yieldRec.sessionId);

    auth.code = 0;
    auth.stdout = JSON.stringify({ loggedIn: true, email: "a@example.com", orgId: "o1" });
    stdin.write(`${JSON.stringify({
      op: "terminal.session_result",
      sessionId: yieldRec.sessionId,
      code: 0
    })}\n`);
    await new Promise((r) => setTimeout(r, 80));
  });

  const connected = out.find((r) => r.type === "connections_connect");
  assert.equal(connected?.ok, true);
  assert.equal(connected?.outcome, "connected");
  assert.ok(out.some((r) => r.type === "terminal_restore"));
  // Login confirms auth only — never auto-enables / verifies models.
  const models = connected?.status?.modelAccess?.models ?? [];
  assert.ok(models.length > 0);
  assert.ok(models.every((m) => m.state === "catalogued"));
  assert.notEqual(connected?.status?.modelAccess?.state, "allowed");

  const out2 = await runRpc({
    connectionsBackend: null,
    connectionsStatusRunner: statusRunner
  }, async ({ stdin }) => {
    stdin.write(`${JSON.stringify({ op: "connections.status", provider: "claude" })}\n`);
    await new Promise((r) => setTimeout(r, 40));
  });
  const status2 = out2.find((r) => r.type === "connections_status");
  assert.equal(status2.inventory[0].authentication, "authenticated");
  assert.equal(status2.inventory[0].action, "refresh");
});

test("login exit 0 + unknown auth → not connected", async () => {
  const auth = { code: 1, stdout: JSON.stringify({ loggedIn: false }) };
  const statusRunner = createFakeRunner({
    "claude --version": { stdout: "2.1.287\n" },
    "claude auth status --json": auth
  });
  const out = await runRpc({
    connectionsStatusRunner: statusRunner
  }, async ({ stdin, out }) => {
    stdin.write(`${JSON.stringify({ op: "connections.preview", provider: "claude" })}\n`);
    await new Promise((r) => setTimeout(r, 40));
    const preview = out.find((r) => r.type === "connections_preview");
    stdin.write(`${JSON.stringify({
      op: "connections.connect",
      provider: "claude",
      fingerprint: preview.previewId,
      confirm: true
    })}\n`);
    await new Promise((r) => setTimeout(r, 40));
    const yieldRec = out.find((r) => r.type === "terminal_yield");
    // Exit 0 but auth stays unauthenticated / unknown.
    auth.code = 0;
    auth.stdout = "not-json-status";
    stdin.write(`${JSON.stringify({
      op: "terminal.session_result",
      sessionId: yieldRec.sessionId,
      code: 0
    })}\n`);
    await new Promise((r) => setTimeout(r, 80));
  });
  const connected = out.find((r) => r.type === "connections_connect");
  assert.equal(connected?.ok, false);
  assert.equal(connected?.outcome, "failed");
  assert.equal(connected?.reason, "auth_not_confirmed");
  assert.equal(connected?.label, "No conectado");
  assert.ok(out.some((r) => r.type === "terminal_restore"));
});

test("host-bridged cancel/fail never reports success", async () => {
  for (const code of [1, null]) {
    const auth = { code: 1, stdout: JSON.stringify({ loggedIn: false }) };
    const statusRunner = createFakeRunner({
      "claude --version": { stdout: "2.1.287\n" },
      "claude auth status --json": auth
    });
    const out = await runRpc({
      connectionsStatusRunner: statusRunner
    }, async ({ stdin, out }) => {
      stdin.write(`${JSON.stringify({ op: "connections.preview", provider: "claude" })}\n`);
      await new Promise((r) => setTimeout(r, 40));
      const preview = out.find((r) => r.type === "connections_preview");
      stdin.write(`${JSON.stringify({
        op: "connections.connect",
        provider: "claude",
        fingerprint: preview.previewId,
        confirm: true
      })}\n`);
      await new Promise((r) => setTimeout(r, 40));
      const yieldRec = out.find((r) => r.type === "terminal_yield");
      assert.ok(yieldRec?.sessionId);
      stdin.write(`${JSON.stringify({
        op: "terminal.session_result",
        sessionId: yieldRec.sessionId,
        code
      })}\n`);
      await new Promise((r) => setTimeout(r, 60));
    });
    const connected = out.find((r) => r.type === "connections_connect");
    assert.equal(connected?.ok, false, String(code));
    assert.notEqual(connected?.outcome, "connected", String(code));
    assert.ok(out.some((r) => r.type === "terminal_restore"), String(code));
  }
});

test("host-bridged timeout kills session and restores terminal", async () => {
  const auth = { code: 1, stdout: JSON.stringify({ loggedIn: false }) };
  const statusRunner = createFakeRunner({
    "claude --version": { stdout: "2.1.287\n" },
    "claude auth status --json": auth
  });
  const out = await runRpc({
    connectionsStatusRunner: statusRunner
  }, async ({ stdin, out }) => {
    stdin.write(`${JSON.stringify({ op: "connections.preview", provider: "claude" })}\n`);
    await new Promise((r) => setTimeout(r, 40));
    const preview = out.find((r) => r.type === "connections_preview");
    stdin.write(`${JSON.stringify({
      op: "connections.connect",
      provider: "claude",
      fingerprint: preview.previewId,
      confirm: true,
      timeoutMs: 40
    })}\n`);
    // No terminal.session_result — let execute timeout kill the host-bridged session.
    await new Promise((r) => setTimeout(r, 120));
  });
  const connected = out.find((r) => r.type === "connections_connect");
  assert.equal(connected?.ok, false);
  assert.equal(connected?.outcome, "timeout");
  assert.ok(out.some((r) => r.type === "terminal_cancel"));
  assert.ok(out.some((r) => r.type === "terminal_restore"));
});

test("fake CLI interactive runner keeps IO off RPC stdio", async () => {
  const interactive = createFakeCliInteractiveRunner({
    exitCode: 0,
    script: async (session) => {
      session.writeOutput("prompt>\n");
      const line = await session.readLine({ timeoutMs: 500 });
      assert.equal(line, "token-from-tty");
      session.writeOutput("done\n");
    }
  });
  const handle = interactive(["claude", "auth", "login", "--claudeai"], { interactive: true });
  // RPC stdin is NOT used — write to the dedicated session.
  await new Promise((r) => setTimeout(r, 10));
  handle.session.writeInput("token-from-tty\n");
  const done = await handle.done;
  assert.equal(done.code, 0);
  assert.match(done.stdout, /prompt>/);
  assert.match(done.stdout, /done/);
});
