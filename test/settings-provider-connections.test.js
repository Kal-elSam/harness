import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ACCESS_LABEL,
  CONNECT_ACTION,
  adaptProviderConnectionsApi,
  buildProviderInventory,
  classifyModelAccess,
  connectionsConnect,
  connectionsPreview,
  connectionsStatus,
  createIncompleteConnectionsBackend,
  formatConnectResultLabel,
  loadConnectionsBackend,
  resolveConnectAction
} from "../src/global/host/settings-provider-connections.js";
import { createFakeCliInteractiveRunner } from "../src/global/host/connections-interactive-pty.js";
import { createProviderConnections } from "../src/global/provider-connections/index.js";
import { createFakeRunner } from "./helpers/fake-connection-runner.js";

function tempHome() {
  const home = mkdtempSync(join(tmpdir(), "kairo-settings-conn-"));
  mkdirSync(join(home, ".harness"), { recursive: true });
  return home;
}

test("CLI missing resolves to existing setup action", () => {
  assert.equal(
    resolveConnectAction({ installation: { state: "missing" }, authentication: { state: "unknown" } }),
    CONNECT_ACTION.SETUP
  );
});

test("unauthenticated with CLI installed resolves to Connect", () => {
  assert.equal(
    resolveConnectAction({
      installation: { state: "installed" },
      authentication: { state: "unauthenticated" }
    }),
    CONNECT_ACTION.CONNECT
  );
});

test("authenticated account resolves to refresh, not Connect", () => {
  assert.equal(
    resolveConnectAction({
      installation: { state: "installed" },
      authentication: { state: "authenticated" }
    }),
    CONNECT_ACTION.REFRESH
  );
});

test("temporarily_limited maps to quota_limited, not unverified", () => {
  assert.equal(classifyModelAccess({ state: "temporarily_limited", retryAfterMs: 60_000 }), ACCESS_LABEL.QUOTA_LIMITED);
  assert.notEqual(classifyModelAccess({ state: "temporarily_limited" }), ACCESS_LABEL.UNVERIFIED);
  assert.equal(classifyModelAccess({ state: "rate_limited" }), ACCESS_LABEL.QUOTA_LIMITED);
  assert.equal(classifyModelAccess({ state: "mixed" }), ACCESS_LABEL.MIXED);
  assert.equal(classifyModelAccess({ state: "exhausted" }), ACCESS_LABEL.EXHAUSTED);
});

test("auth_not_confirmed formats as No conectado", () => {
  assert.equal(
    formatConnectResultLabel({ ok: false, outcome: "failed", reason: "auth_not_confirmed" }),
    "No conectado"
  );
  assert.equal(
    formatConnectResultLabel({ ok: false, outcome: "failed", reason: "auth_check_incomplete" }),
    "Not confirmed — retry the check"
  );
  assert.equal(
    formatConnectResultLabel({ ok: true, outcome: "connected", reason: "login_completed" }),
    "Connected — refresh inventory to see verified models."
  );
});

test("inventory keeps catalogued models after login — never auto-verified", () => {
  const inventory = buildProviderInventory({
    ok: true,
    providers: [{
      providerId: "claude",
      installation: { state: "installed" },
      authentication: { state: "authenticated", accountFingerprint: "abc" },
      quota: { state: "available" },
      modelAccess: {
        state: "unknown",
        source: "entitlement-cache",
        models: [
          { modelId: "claude-opus-5-5", label: "Opus", state: "catalogued" },
          { modelId: "claude-haiku-4-5", label: "Haiku", state: "rate_limited", retryAfterMs: 120_000 }
        ]
      }
    }]
  });
  assert.equal(inventory[0].action, CONNECT_ACTION.REFRESH);
  assert.equal(inventory[0].models[0].access, ACCESS_LABEL.CATALOGUED);
  assert.equal(inventory[0].models[1].access, ACCESS_LABEL.QUOTA_LIMITED);
});

test("loadConnectionsBackend without interactiveRunner is incomplete", async () => {
  const backend = loadConnectionsBackend({ homeDir: tempHome() });
  assert.equal(backend.incomplete, true);
  assert.match(backend.reason, /missing_interactive_runner/);
});

test("evidenceStore null merges defaults against a temp HOME (never real ~/.harness)", async () => {
  const home = tempHome();
  const statusRunner = createFakeRunner({
    "claude --version": { stdout: "2.1.287\n" },
    "claude auth status --json": {
      stdout: JSON.stringify({ loggedIn: true, email: "a@example.com", orgId: "o1" })
    }
  });
  const interactive = createFakeRunner({ "claude auth login --claudeai": { code: 0 } });
  const backend = loadConnectionsBackend({
    runner: statusRunner,
    interactiveRunner: interactive,
    accessReaders: {},
    quotaReaders: {},
    evidenceStore: null,
    homeDir: home,
    now: () => 1_700_000_000_000
  });
  assert.equal(backend.incomplete, false);
  const status = await connectionsStatus({ backend, provider: "claude" });
  assert.equal(status.inventory[0].authentication, "authenticated");
  // Default readers attached: Claude models are catalogued with empty cache, not missing.
  assert.ok(Array.isArray(status.providers[0].modelAccess?.models));
  assert.ok(status.providers[0].modelAccess.models.length > 0);
  assert.ok(status.providers[0].modelAccess.models.every((m) => m.state === "catalogued"));
});

test("login exit 0 + unknown auth → not connected (auth_not_confirmed)", async () => {
  const home = tempHome();
  // After login, status still returns unknown/unparseable — must not become connected.
  const statusRunner = createFakeRunner({
    "claude --version": { stdout: "2.1.287\n" },
    "claude auth status --json": { stdout: "\u0000??weird{{" }
  });
  const interactive = createFakeRunner({ "claude auth login --claudeai": { code: 0 } });
  const api = createProviderConnections({
    runner: statusRunner,
    interactiveRunner: interactive,
    homeDir: home,
    now: () => 1_700_000_000_000
  });
  const backend = adaptProviderConnectionsApi(api);
  const preview = await connectionsPreview({ backend, provider: "claude" });
  const connected = await connectionsConnect({
    backend,
    provider: "claude",
    preview: preview.preview,
    fingerprint: preview.previewId,
    confirm: true
  });
  assert.equal(connected.ok, false);
  assert.equal(connected.outcome, "failed");
  assert.equal(connected.reason, "auth_not_confirmed");
  assert.equal(connected.label, "No conectado");
});

test("login + authenticated → connected without auto-enabling models", async () => {
  const home = tempHome();
  const auth = { code: 1, stdout: JSON.stringify({ loggedIn: false }) };
  const statusRunner = createFakeRunner({
    "claude --version": { stdout: "2.1.287\n" },
    "claude auth status --json": auth
  });
  const interactive = createFakeCliInteractiveRunner({
    exitCode: 0,
    script: async (session) => {
      session.writeOutput("Login?\n");
      await session.readLine({ timeoutMs: 500 });
      auth.code = 0;
      auth.stdout = JSON.stringify({ loggedIn: true, email: "a@example.com", orgId: "o1" });
      session.writeOutput("ok\n");
    }
  });
  const api = createProviderConnections({
    runner: statusRunner,
    interactiveRunner: interactive,
    homeDir: home,
    evidenceStore: null,
    accessReaders: {},
    quotaReaders: {},
    now: () => 1_700_000_000_000
  });
  const backend = adaptProviderConnectionsApi(api);
  const preview = await connectionsPreview({ backend, provider: "claude" });
  const drive = (async () => {
    for (let i = 0; i < 80; i++) {
      if (interactive.sessions[0]) {
        await new Promise((r) => setTimeout(r, 5));
        interactive.sessions[0].writeInput("y\n");
        return;
      }
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error("no session");
  })();
  const connected = await connectionsConnect({
    backend,
    provider: "claude",
    preview: preview.preview,
    fingerprint: preview.previewId,
    confirm: true
  });
  await drive;
  assert.equal(connected.ok, true);
  assert.equal(connected.outcome, "connected");
  assert.equal(connected.status.authentication.state, "authenticated");
  // Empty cache → catalogued models, never auto-allowed / verified.
  const models = connected.status.modelAccess?.models ?? [];
  assert.ok(models.length > 0);
  assert.ok(models.every((m) => m.state === "catalogued"));
  const inventory = buildProviderInventory({ providers: [connected.status] });
  assert.ok(inventory[0].models.every((m) => m.access === ACCESS_LABEL.CATALOGUED));
});

test("cancel ends the interactive process without false success", async () => {
  const home = tempHome();
  const auth = { code: 1, stdout: JSON.stringify({ loggedIn: false }) };
  const statusRunner = createFakeRunner({
    "claude --version": { stdout: "2.1.287\n" },
    "claude auth status --json": auth
  });
  const interactive = createFakeCliInteractiveRunner({
    script: async (session) => {
      session.writeOutput("waiting\n");
      await session.readLine({ timeoutMs: 2000 });
    }
  });
  const api = createProviderConnections({
    runner: statusRunner,
    interactiveRunner: interactive,
    homeDir: home,
    now: () => 1_700_000_000_000
  });
  const backend = adaptProviderConnectionsApi(api);
  const preview = await connectionsPreview({ backend, provider: "claude" });
  const pending = connectionsConnect({
    backend,
    provider: "claude",
    preview: preview.preview,
    fingerprint: preview.previewId,
    confirm: true
  });
  await new Promise((r) => setTimeout(r, 20));
  interactive.sessions[0].cancel();
  const out = await pending;
  assert.equal(out.ok, false);
  assert.notEqual(out.outcome, "connected");
});

test("timeout kills the interactive process without false success", async () => {
  const home = tempHome();
  const interactive = createFakeRunner({ "claude auth login --claudeai": { hang: true } });
  const api = createProviderConnections({
    runner: createFakeRunner({
      "claude --version": { stdout: "2.1.287\n" },
      "claude auth status --json": { stdout: JSON.stringify({ loggedIn: false }) }
    }),
    interactiveRunner: interactive,
    homeDir: home,
    now: () => 1_700_000_000_000
  });
  const backend = adaptProviderConnectionsApi(api);
  const preview = await connectionsPreview({ backend, provider: "claude" });
  const out = await connectionsConnect({
    backend,
    provider: "claude",
    preview: preview.preview,
    fingerprint: preview.previewId,
    confirm: true,
    timeoutMs: 30
  });
  assert.equal(out.ok, false);
  assert.equal(out.outcome, "timeout");
  assert.deepEqual(interactive.kills, ["claude auth login --claudeai"]);
});

test("incomplete backend stays rejected", async () => {
  const backend = createIncompleteConnectionsBackend("missing_interactive_runner");
  const preview = await connectionsPreview({ backend, provider: "claude" });
  assert.equal(preview.ok, false);
  assert.equal(preview.incomplete, true);
});
