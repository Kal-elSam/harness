// T9/T10/shim tests. Everything is simulated: fake runners, temp homes.
// The real ~/.harness and every real provider CLI are never touched.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createProviderConnections } from "../src/global/provider-connections/index.js";
import { parseOpenCodeGoAuth } from "../src/global/provider-connections/parsers.js";
import { createFakeRunner } from "./helpers/fake-connection-runner.js";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const NOW = Date.parse("2026-10-01T12:00:00Z");
const CLAUDE_AUTH = JSON.stringify({ loggedIn: true, email: "ada@example.com", orgId: "o1", subscriptionType: "max" });

const SCRIPT = {
  "claude --version": { stdout: "2.1.287\n" },
  "claude auth status --json": { stdout: CLAUDE_AUTH },
  "codex --version": { stdout: "codex-cli 0.159.3\n" },
  "codex login status": { stdout: "Logged in using ChatGPT\n" },
  "cursor-agent --version": { stdout: "2026.10.01\n" },
  "cursor-agent status --format json": { stdout: JSON.stringify({ authenticated: true, email: "ada@example.com" }) },
  "opencode --version": { stdout: "1.18.33\n" },
  "opencode auth list": { stdout: "Credentials\n  OpenCode Go api\n1 credentials\n" }
};

function homeWith(files = {}) {
  const home = mkdtempSync(join(tmpdir(), "kairo-conn-home-"));
  mkdirSync(join(home, ".harness"), { recursive: true });
  for (const [name, doc] of Object.entries(files)) writeFileSync(join(home, ".harness", name), JSON.stringify(doc));
  return home;
}

const byId = (rows) => Object.fromEntries(rows.map((row) => [row.providerId, row]));

test("shim: src/global/provider-connections.js resolves from src/global/host via ../provider-connections.js", async () => {
  const fromHost = pathToFileURL(join(REPO, "src/global/host/consumer.js"));
  const specifier = new URL("../provider-connections.js", fromHost);
  const mod = await import(specifier.href);
  assert.equal(typeof mod.createProviderConnections, "function");
  const index = await import("../src/global/provider-connections/index.js");
  assert.equal(mod.createProviderConnections, index.createProviderConnections);
  assert.deepEqual(Object.keys(mod).sort(), Object.keys(index).sort());
});

test("defaults: construction without injected pieces works (injected homeDir + runner only) and unknown evidence stays unknown", async () => {
  const api = createProviderConnections({ runner: createFakeRunner(SCRIPT), homeDir: homeWith(), now: () => NOW });
  const rows = byId((await api.status()).providers);
  assert.equal(rows.codex.installation.state, "installed");
  assert.deepEqual(rows.codex.modelAccess, { state: "unknown", source: null, network: "unverified" });
  assert.equal(rows["opencode-go"].modelAccess.state, "unknown");
  assert.equal(rows["opencode-go"].modelAccess.source, null);
  assert.equal(rows["opencode-go"].modelAccess.models, undefined);
  assert.equal(rows.codex.quota.state, "unknown");
  assert.equal(rows["opencode-go"].quota.state, "unknown");
  assert.equal(rows.cursor.quota.state, "unknown");
  // Claude: documented catalog, no cache => every model is catalogued, never allowed.
  assert.equal(rows.claude.modelAccess.state, "unknown");
  assert.ok(rows.claude.modelAccess.models.length > 0);
  assert.ok(rows.claude.modelAccess.models.every((m) => m.state === "catalogued"));
  // Cursor: pool-level only, no cache => unverified.
  assert.equal(rows.cursor.modelAccess.state, "unknown");
  assert.deepEqual(rows.cursor.modelAccess.models.map((m) => [m.modelId, m.state]), [["cursor_models", "unverified"], ["other_models", "unverified"]]);
  assert.ok(rows.cursor.modelAccess.models.every((m) => m.scope === "pool"));
});

// The Settings consumer builds the api with exactly these deps (all "empty"):
// the defaults must MERGE with them, never be replaced by them.
test("defaults merge: the consumer's deps ({runner, interactiveRunner, accessReaders:{}, quotaReaders:{}, evidenceStore:null, now}) still get real default readers", async () => {
  const { computeAccountFingerprint } = await import("../src/global/observability/account-fingerprint.js");
  const probedAt = new Date(NOW - 60_000).toISOString();
  const home = homeWith({
    "claude-entitlement.json": { subscriptionType: "max", accountFingerprint: computeAccountFingerprint("ada@example.com|o1"), fetchedAt: probedAt, models: { "claude-opus-5-5": { status: "allowed", probedAt } } },
    "cursor-access.json": { fetchedAt: probedAt, accountFingerprint: computeAccountFingerprint("ada@example.com"), pools: { cursor_models: { status: "exhausted", probedAt } } },
    "workspace-usage-cache.json": { schema: "kairo.workspace-usage-cache/v1", savedAt: NOW - 1000, value: { usage: { claude: { primary: { remainingPercent: 55 } } } } }
  });
  const previous = process.env.HARNESS_HOME;
  process.env.HARNESS_HOME = home; // resolveHomeDir() default, as in production
  try {
    const api = createProviderConnections({
      runner: createFakeRunner(SCRIPT), interactiveRunner: createFakeRunner({}),
      accessReaders: {}, quotaReaders: {}, evidenceStore: null, now: () => NOW
    });
    const rows = byId((await api.status()).providers);
    assert.equal(rows.claude.modelAccess.models.find((m) => m.modelId === "claude-opus-5-5").state, "allowed");
    assert.equal(rows.cursor.modelAccess.state, "exhausted");
    assert.equal(rows.claude.quota.state, "available");
    assert.equal(rows.claude.quota.remainingPercent, 55);
  } finally {
    if (previous === undefined) delete process.env.HARNESS_HOME; else process.env.HARNESS_HOME = previous;
  }
});

test("defaults merge: an injected reader overrides only its own provider; evidenceStore null/undefined means the default store", async () => {
  const home = homeWith();
  const api = createProviderConnections({
    runner: createFakeRunner(SCRIPT), homeDir: home, now: () => NOW,
    accessReaders: { claude: () => [{ status: "denied" }] }, quotaReaders: { codex: () => ({ remainingPercent: 9 }) }, evidenceStore: undefined
  });
  const rows = byId((await api.status()).providers);
  assert.equal(rows.claude.modelAccess.state, "denied"); // injected wins for claude
  assert.equal(rows.cursor.modelAccess.source, "entitlement-cache"); // default kept for cursor
  assert.equal(rows.codex.quota.remainingPercent, 9);
  // default store: connect on a temp home writes an invalidation doc instead of throwing
  const interactive = createFakeRunner({ "codex login": { code: 0 } });
  const apiConnect = createProviderConnections({ runner: createFakeRunner(SCRIPT), interactiveRunner: interactive, homeDir: home, now: () => NOW, evidenceStore: null });
  const result = await apiConnect.connect({ preview: apiConnect.preview({ providerId: "codex", action: "login" }), confirm: true });
  assert.ok(["connected", "failed"].includes(result.outcome));
  assert.equal(typeof result.evidenceInvalidated, "boolean");
});

test("defaults: createProviderConnections() with no args constructs (production wiring) without spawning", () => {
  const api = createProviderConnections();
  assert.equal(typeof api.status, "function");
  assert.deepEqual(Object.keys(api.methods), ["connections.status", "connections.preview", "connections.connect"]);
});

test("defaults: claude reads the entitlement cache per model (cache only), bound to the account fingerprint", async () => {
  const { computeAccountFingerprint } = await import("../src/global/observability/account-fingerprint.js");
  const probedAt = new Date(NOW - 60_000).toISOString();
  const cache = {
    subscriptionType: "max",
    accountFingerprint: computeAccountFingerprint("ada@example.com|o1"),
    fetchedAt: probedAt,
    models: {
      "claude-opus-5-5": { status: "allowed", reason: null, probedAt },
      "claude-sonnet-5-5": { status: "denied", reason: "http_403", probedAt },
      "claude-haiku-4-5": { status: "unverified", limit: "temporary", retryAfterMs: 300_000, reason: null, probedAt }
    }
  };
  const home = homeWith({ "claude-entitlement.json": cache });
  const api = createProviderConnections({ runner: createFakeRunner(SCRIPT), homeDir: home, now: () => NOW });
  const claude = (await api.status({ providerIds: ["claude"] })).providers[0];
  assert.equal(claude.modelAccess.state, "mixed");
  const state = Object.fromEntries(claude.modelAccess.models.map((m) => [m.modelId, m]));
  assert.equal(state["claude-opus-5-5"].state, "allowed");
  assert.equal(state["claude-sonnet-5-5"].state, "denied");
  assert.equal(state["claude-haiku-4-5"].state, "rate_limited");
  assert.equal(state["claude-haiku-4-5"].retryAfterMs, 300_000);
  assert.equal(state["claude-fable-5-1"].state, "catalogued");
  assert.equal(claude.modelAccess.source, "entitlement-cache");

  // Another account on the same machine: the cached evidence must not be reused.
  const other = { ...SCRIPT, "claude auth status --json": { stdout: JSON.stringify({ loggedIn: true, email: "bob@example.com", orgId: "o2", subscriptionType: "max" }) } };
  const api2 = createProviderConnections({ runner: createFakeRunner(other), homeDir: home, now: () => NOW });
  const claude2 = (await api2.status({ providerIds: ["claude"] })).providers[0];
  assert.equal(claude2.modelAccess.state, "unknown");
  assert.ok(claude2.modelAccess.models.every((m) => m.state === "catalogued"));
});

test("defaults: an unidentifiable Claude account never reuses cached evidence", async () => {
  const probedAt = new Date(NOW - 1000).toISOString();
  const home = homeWith({ "claude-entitlement.json": { subscriptionType: "max", accountFingerprint: "a".repeat(32), fetchedAt: probedAt, models: { "claude-opus-5-5": { status: "allowed", probedAt } } } });
  const script = { ...SCRIPT, "claude auth status --json": { stdout: JSON.stringify({ loggedIn: true, subscriptionType: "max" }) } };
  const api = createProviderConnections({ runner: createFakeRunner(script), homeDir: home, now: () => NOW });
  const claude = (await api.status({ providerIds: ["claude"] })).providers[0];
  assert.notEqual(claude.modelAccess.state, "allowed");
  assert.ok(claude.modelAccess.models.every((m) => m.state !== "allowed"));
});

test("defaults: cursor reports per-pool evidence from the access cache; exhausted pool is limited", async () => {
  const { computeAccountFingerprint } = await import("../src/global/observability/account-fingerprint.js");
  const probedAt = new Date(NOW - 60_000).toISOString();
  const home = homeWith({
    "cursor-access.json": {
      fetchedAt: probedAt,
      accountFingerprint: computeAccountFingerprint("ada@example.com"),
      pools: { cursor_models: { status: "available", probedAt }, other_models: { status: "exhausted", probedAt } }
    }
  });
  const api = createProviderConnections({ runner: createFakeRunner(SCRIPT), homeDir: home, now: () => NOW });
  const cursor = (await api.status({ providerIds: ["cursor"] })).providers[0];
  assert.equal(cursor.modelAccess.state, "mixed");
  assert.deepEqual(cursor.modelAccess.models.map((m) => [m.modelId, m.state]), [["cursor_models", "allowed"], ["other_models", "limited"]]);
  assert.equal(cursor.authentication.advisory, true);
});

test("defaults: quota comes from the usage cache only (fresh, worst window), otherwise unknown", async () => {
  const usage = (savedAt) => ({
    schema: "kairo.workspace-usage-cache/v1",
    savedAt,
    value: { usage: { codex: { primary: { remainingPercent: 60 }, secondary: { remainingPercent: 0 } }, claude: { primary: { remainingPercent: 42 } }, opencode: { go: { windows: [{ remainingPercent: 80 }] } } }, providers: {} }
  });
  const fresh = homeWith({ "workspace-usage-cache.json": usage(NOW - 60_000) });
  const rows = byId((await createProviderConnections({ runner: createFakeRunner(SCRIPT), homeDir: fresh, now: () => NOW }).status()).providers);
  assert.equal(rows.codex.quota.state, "exhausted");
  assert.equal(rows.claude.quota.state, "available");
  assert.equal(rows.claude.quota.remainingPercent, 42);
  assert.equal(rows["opencode-go"].quota.state, "available");
  assert.equal(rows.cursor.quota.state, "unknown");

  const stale = homeWith({ "workspace-usage-cache.json": usage(NOW - 24 * 3600 * 1000) });
  const old = byId((await createProviderConnections({ runner: createFakeRunner(SCRIPT), homeDir: stale, now: () => NOW }).status()).providers);
  assert.equal(old.claude.quota.state, "unknown");
});

test("defaults: status never runs anything beyond the allowlisted version/auth argv (no probes, no model listing)", async () => {
  const runner = createFakeRunner(SCRIPT);
  await createProviderConnections({ runner, homeDir: homeWith(), now: () => NOW }).status();
  const ran = runner.calls.map((c) => c.argv.join(" ")).sort();
  assert.deepEqual(ran, Object.keys(SCRIPT).sort());
});

// T10
test("T10: opencode auth list parser counts OpenCode Go only when its entry is present", () => {
  const run = (stdout) => parseOpenCodeGoAuth({ stdout, stderr: "", code: 0 }).state;
  assert.equal(run("┌  Credentials ~/.local/share/opencode/auth.json\n│\n●  OpenCode Go api\n│\n└  1 credentials\n"), "authenticated");
  assert.equal(run("opencode-go\n"), "unknown");
  assert.equal(run("Credentials\n  Anthropic oauth\n1 credentials\n"), "unauthenticated");
  assert.equal(run("Credentials\n  OpenCode Zen api\n1 credentials\n"), "unauthenticated");
  assert.equal(run("Credentials\n  OpenCode Gopher api\n1 credentials\n"), "unauthenticated");
  assert.equal(run("Credentials\n0 credentials\n"), "unauthenticated");
  assert.equal(run(""), "unknown");
  assert.equal(run("something unexpected"), "unknown");
  // Go only under Environment is not a stored credential: ambiguous => unknown.
  assert.equal(run("Credentials\n  Anthropic oauth\nEnvironment\n  OpenCode Go OPENCODE_API_KEY\n1 credentials\n"), "unknown");
});

test("T10: opencode login argv is `opencode auth login` with no -p/-m and connect decides via auth list", async () => {
  const noGo = { ...SCRIPT, "opencode auth list": { stdout: "Credentials\n  Anthropic oauth\n1 credentials\n" } };
  const interactive = createFakeRunner({ "opencode auth login": { code: 0 } });
  const api = createProviderConnections({ runner: createFakeRunner(noGo), interactiveRunner: interactive, homeDir: homeWith(), now: () => NOW });
  const preview = api.preview({ providerId: "opencode-go", action: "login" });
  assert.deepEqual(preview.argv, ["opencode", "auth", "login"]);
  const result = await api.connect({ preview, confirm: true });
  assert.deepEqual(interactive.calls.map((c) => c.argv), [["opencode", "auth", "login"]]);
  assert.equal(result.outcome, "failed");
  assert.equal(result.reason, "auth_not_confirmed");
});
