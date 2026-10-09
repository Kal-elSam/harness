// All provider CLI behavior in this file is SIMULATED through injected fake
// runners/clocks/stores. No real login is performed, no process is spawned,
// no network is touched and no real file under ~/.harness is read or written.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProviderConnections,
  createAccessEvidenceStore,
  LOGIN_ARGV,
  PROVIDER_IDS
} from "../src/global/provider-connections/index.js";
import { createFakeRunner } from "./helpers/fake-connection-runner.js";

const T0 = 1_700_000_000_000;

function claudeStatus(email) {
  return { stdout: JSON.stringify({ loggedIn: true, email, orgId: "o1" }) };
}

function setup({ interactive, status = {}, evidenceStore, now = { t: T0 } } = {}) {
  const runner = createFakeRunner({
    "claude --version": { stdout: "2.1.287\n" },
    "claude auth status --json": claudeStatus("new@example.com"),
    "codex --version": { stdout: "codex-cli 0.159.3\n" },
    "codex login status": { stdout: "Logged in using ChatGPT\n" },
    ...status
  });
  const interactiveRunner = interactive ?? createFakeRunner({ "claude auth login --claudeai": { code: 0 }, "codex login": { code: 0 } });
  const api = createProviderConnections({
    runner,
    interactiveRunner,
    homeDir: mkdtempSync(join(tmpdir(), "kairo-conn-connect-")),
    now: () => now.t,
    evidenceStore
  });
  return { api, runner, interactiveRunner, now };
}

test("preview: is pure, never spawns, and returns exact argv, command and honest surfaces", () => {
  const { api, runner, interactiveRunner } = setup();
  const preview = api.preview({ providerId: "claude", action: "login" });
  assert.deepEqual(preview.argv, ["claude", "auth", "login", "--claudeai"]);
  assert.equal(preview.command, "claude auth login --claudeai");
  assert.ok(preview.surfaces.includes("terminal"));
  assert.ok(preview.surfaces.includes("network"));
  assert.equal(preview.networkVerification, "unverified");
  assert.match(preview.previewId, /^[0-9a-f]{64}$/);
  assert.ok(Date.parse(preview.expiresAt) > Date.parse(preview.createdAt));
  assert.equal(runner.calls.length, 0);
  assert.equal(interactiveRunner.calls.length, 0);
});

test("preview: is deterministic for the same instant and covers every provider", () => {
  const { api } = setup();
  for (const providerId of PROVIDER_IDS) {
    const a = api.preview({ providerId, action: "login" });
    const b = api.preview({ providerId, action: "login" });
    assert.deepEqual(a, b);
    assert.deepEqual(a.argv, LOGIN_ARGV[providerId]);
  }
});

test("preview: login allowlist is exactly the four fixed argv", () => {
  assert.deepEqual(LOGIN_ARGV, {
    codex: ["codex", "login"],
    claude: ["claude", "auth", "login", "--claudeai"],
    cursor: ["cursor-agent", "login"],
    "opencode-go": ["opencode", "auth", "login"]
  });
});

test("preview: unknown provider, unknown action and arbitrary argv/command input are rejected", () => {
  const { api } = setup();
  assert.throws(() => api.preview({ providerId: "bash", action: "login" }), /unknown provider/i);
  assert.throws(() => api.preview({ providerId: "codex", action: "logout" }), /unsupported action/i);
  assert.throws(() => api.preview({ providerId: "codex; rm -rf /", action: "login" }), /unknown provider/i);
  assert.throws(() => api.preview({ providerId: "codex", action: "login", argv: ["codex", "login", "--with-api-key"] }), /argv/i);
  assert.throws(() => api.preview({ providerId: "codex", action: "login", command: "sh -c id" }), /argv|command/i);
});

test("connect: rejected without confirm === true and never runs anything", async () => {
  for (const confirm of [undefined, false, "true", 1]) {
    const { api, interactiveRunner } = setup();
    const preview = api.preview({ providerId: "claude", action: "login" });
    const result = await api.connect({ preview, confirm });
    assert.equal(result.outcome, "rejected");
    assert.equal(result.reason, "confirmation_required");
    assert.equal(interactiveRunner.calls.length, 0);
  }
});

test("connect: expired preview is rejected", async () => {
  const { api, interactiveRunner, now } = setup();
  const preview = api.preview({ providerId: "claude", action: "login" });
  now.t += 10 * 60 * 1000;
  const result = await api.connect({ preview, confirm: true });
  assert.equal(result.outcome, "rejected");
  assert.equal(result.reason, "preview_expired");
  assert.equal(interactiveRunner.calls.length, 0);
});

test("connect: tampered argv, tampered id, forged expiry and unknown provider are rejected", async () => {
  const { api, interactiveRunner } = setup();
  const good = api.preview({ providerId: "claude", action: "login" });
  const tampered = [
    { ...good, argv: ["claude", "auth", "login", "--console"] },
    { ...good, argv: [...good.argv, "--with-api-key"] },
    { ...good, previewId: "0".repeat(64) },
    { ...good, expiresAt: new Date(T0 + 24 * 3600 * 1000).toISOString() },
    { ...good, providerId: "bash" },
    { ...good, action: "logout" },
    null,
    "claude auth login"
  ];
  for (const preview of tampered) {
    const result = await api.connect({ preview, confirm: true });
    assert.equal(result.outcome, "rejected", JSON.stringify(preview));
  }
  assert.equal(interactiveRunner.calls.length, 0);
});

test("connect: caller-supplied argv is ignored; only the allowlist argv runs, with inherit-style interactive run", async () => {
  const { api, interactiveRunner } = setup();
  const preview = api.preview({ providerId: "claude", action: "login" });
  const result = await api.connect({ preview, confirm: true, argv: ["rm", "-rf", "/"] });
  assert.equal(result.outcome, "connected");
  assert.deepEqual(interactiveRunner.calls.map((c) => c.argv), [["claude", "auth", "login", "--claudeai"]]);
  assert.equal(interactiveRunner.calls[0].opts.interactive, true);
});

test("connect: success re-runs status for that provider only", async () => {
  const { api, runner } = setup();
  const preview = api.preview({ providerId: "claude", action: "login" });
  const result = await api.connect({ preview, confirm: true });
  assert.equal(result.outcome, "connected");
  assert.equal(result.status.providerId, "claude");
  assert.equal(result.status.authentication.state, "authenticated");
  assert.deepEqual(runner.calls.map((c) => c.argv[0]), ["claude", "claude"]);
});

// T8: exit code 0 is NOT success; a fresh status re-check decides.
test("T8: exit 0 + unauthenticated => failed / auth_not_confirmed", async () => {
  const { api } = setup({ status: { "claude auth status --json": { stdout: JSON.stringify({ loggedIn: false }) } } });
  const result = await api.connect({ preview: api.preview({ providerId: "claude", action: "login" }), confirm: true });
  assert.equal(result.outcome, "failed");
  assert.equal(result.reason, "auth_not_confirmed");
  assert.equal(result.status.authentication.state, "unauthenticated");
});

test("T8: exit 0 + unknown status (and Cursor's advisory status) => failed / auth_not_confirmed", async () => {
  const unknown = setup({ status: { "claude auth status --json": { stdout: "not json" } } });
  const a = await unknown.api.connect({ preview: unknown.api.preview({ providerId: "claude", action: "login" }), confirm: true });
  assert.equal(a.outcome, "failed");
  assert.equal(a.reason, "auth_not_confirmed");
  const cursor = setup({ interactive: createFakeRunner({ "cursor-agent login": { code: 0 } }), status: { "cursor-agent --version": { stdout: "2026.10.01\n" }, "cursor-agent status --format json": { stdout: "???" } } });
  const b = await cursor.api.connect({ preview: cursor.api.preview({ providerId: "cursor", action: "login" }), confirm: true });
  assert.equal(b.outcome, "failed");
  assert.equal(b.reason, "auth_not_confirmed");
});

test("T8: exit 0 + authenticated => connected; the status is fresh, not the one seen before login", async () => {
  const statuses = [{ stdout: JSON.stringify({ loggedIn: false }) }, claudeStatus("a@example.com")];
  let index = 0;
  const runner = (argv) => {
    const reply = argv.join(" ") === "claude --version" ? { stdout: "2.1.287\n" } : statuses[Math.min(index++, 1)];
    return { done: Promise.resolve({ code: 0, stdout: reply.stdout, stderr: "" }), kill() {} };
  };
  const api = createProviderConnections({
    runner, interactiveRunner: createFakeRunner({ "claude auth login --claudeai": { code: 0 } }),
    homeDir: mkdtempSync(join(tmpdir(), "kairo-conn-fresh-")), now: () => T0, evidenceStore: null
  });
  assert.equal((await api.status({ providerIds: ["claude"] })).providers[0].authentication.state, "unauthenticated");
  const result = await api.connect({ preview: api.preview({ providerId: "claude", action: "login" }), confirm: true });
  assert.equal(result.outcome, "connected");
});

test("T8: evidence is invalidated even when auth is not confirmed after an account loss", async () => {
  const lost = [];
  const { api } = setup({
    status: { "claude auth status --json": { stdout: JSON.stringify({ loggedIn: false }) } },
    evidenceStore: { getFingerprint: async () => "a".repeat(32), invalidate: async (...a) => { lost.push(a); } }
  });
  const result = await api.connect({ preview: api.preview({ providerId: "claude", action: "login" }), confirm: true });
  assert.equal(result.reason, "auth_not_confirmed");
  assert.equal(result.evidenceInvalidated, true);
  assert.equal(lost.length, 1);
});

test("connect: non-zero exit is failed with a classified reason and no output", async () => {
  const interactive = createFakeRunner({ "claude auth login --claudeai": { code: 1, stderr: "secret-token-xyz" } });
  const { api } = setup({ interactive });
  const result = await api.connect({ preview: api.preview({ providerId: "claude", action: "login" }), confirm: true });
  assert.equal(result.outcome, "failed");
  assert.equal(result.reason, "exit_nonzero");
  assert.ok(!JSON.stringify(result).includes("secret-token-xyz"));
});

test("connect: cancellation aborts, kills the process and reports cancelled", async () => {
  const interactive = createFakeRunner({ "claude auth login --claudeai": { hang: true } });
  const { api } = setup({ interactive });
  const controller = new AbortController();
  const pending = api.connect({ preview: api.preview({ providerId: "claude", action: "login" }), confirm: true, signal: controller.signal, timeoutMs: 5000 });
  setTimeout(() => controller.abort(), 10);
  const result = await pending;
  assert.equal(result.outcome, "cancelled");
  assert.deepEqual(interactive.kills, ["claude auth login --claudeai"]);
});

test("connect: an already-aborted signal never starts the process", async () => {
  const interactive = createFakeRunner({ "codex login": { hang: true } });
  const { api } = setup({ interactive });
  const controller = new AbortController();
  controller.abort();
  const result = await api.connect({ preview: api.preview({ providerId: "codex", action: "login" }), confirm: true, signal: controller.signal });
  assert.equal(result.outcome, "cancelled");
  assert.equal(interactive.calls.length, 0);
});

test("connect: timeout kills the process and reports timeout", async () => {
  const interactive = createFakeRunner({ "codex login": { hang: true } });
  const { api } = setup({ interactive });
  const result = await api.connect({ preview: api.preview({ providerId: "codex", action: "login" }), confirm: true, timeoutMs: 20 });
  assert.equal(result.outcome, "timeout");
  assert.deepEqual(interactive.kills, ["codex login"]);
});

test("connect: missing binary is failed with reason not_installed", async () => {
  const interactive = createFakeRunner({});
  const { api } = setup({ interactive });
  const result = await api.connect({ preview: api.preview({ providerId: "codex", action: "login" }), confirm: true });
  assert.equal(result.outcome, "failed");
  assert.equal(result.reason, "not_installed");
});

test("connect: account change invalidates prior access evidence and exposes only hashes", async () => {
  const invalidated = [];
  const evidenceStore = {
    getFingerprint: async () => "a".repeat(32),
    invalidate: async (providerId, newFingerprint) => { invalidated.push({ providerId, newFingerprint }); }
  };
  const { api } = setup({ evidenceStore });
  const result = await api.connect({ preview: api.preview({ providerId: "claude", action: "login" }), confirm: true });
  assert.equal(result.outcome, "connected");
  assert.equal(result.accountChanged, true);
  assert.equal(result.evidenceInvalidated, true);
  assert.equal(invalidated.length, 1);
  assert.equal(invalidated[0].providerId, "claude");
  assert.match(invalidated[0].newFingerprint, /^[0-9a-f]{32}$/);
  assert.ok(!JSON.stringify(result).includes("example.com"));
});

test("connect: same account keeps evidence; unidentifiable account invalidates it", async () => {
  const probe = setup();
  const first = await probe.api.status({ providerIds: ["claude"] });
  const sameFingerprint = first.providers[0].authentication.accountFingerprint;

  const kept = [];
  const same = setup({ evidenceStore: { getFingerprint: async () => sameFingerprint, invalidate: async (...a) => { kept.push(a); } } });
  const r1 = await same.api.connect({ preview: same.api.preview({ providerId: "claude", action: "login" }), confirm: true });
  assert.equal(r1.evidenceInvalidated, false);
  assert.equal(kept.length, 0);

  const dropped = [];
  const unidentified = setup({
    status: { "claude auth status --json": { stdout: JSON.stringify({ loggedIn: true }) } },
    evidenceStore: { getFingerprint: async () => sameFingerprint, invalidate: async (...a) => { dropped.push(a); } }
  });
  const r2 = await unidentified.api.connect({ preview: unidentified.api.preview({ providerId: "claude", action: "login" }), confirm: true });
  assert.equal(r2.evidenceInvalidated, true);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0][1], null);
});

test("evidence store: invalidation writes empty fingerprint-only docs through injected deps (no real files)", async () => {
  const writes = [];
  const files = {
    claude: { subscriptionType: "max", accountFingerprint: "f".repeat(32), fetchedAt: "x", models: { m: { status: "denied" } } },
    cursor: { fetchedAt: "x", accountFingerprint: "e".repeat(32), pools: { cursor_models: { status: "exhausted" } } }
  };
  const deps = {
    readFile: async (path) => JSON.stringify(path.includes("cursor") ? files.cursor : files.claude),
    mkdir: async () => {},
    writeAtomicJson: async (path, doc) => { writes.push({ path, doc }); }
  };
  const store = createAccessEvidenceStore({ homeDir: "/nonexistent-test-home", deps });
  assert.equal(await store.getFingerprint("claude"), "f".repeat(32));
  assert.equal(await store.getFingerprint("cursor"), "e".repeat(32));
  assert.equal(await store.getFingerprint("codex"), null);
  await store.invalidate("claude", null);
  await store.invalidate("cursor", "d".repeat(32));
  await store.invalidate("codex", null);
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0].doc.models, {});
  assert.equal(writes[0].doc.accountFingerprint, null);
  assert.deepEqual(writes[1].doc.pools, {});
  assert.equal(writes[1].doc.accountFingerprint, "d".repeat(32));
});

test("spawn runner: no shell, credential env vars stripped, inherit only when interactive (fake spawn)", async () => {
  const { createSpawnRunner } = await import("../src/global/provider-connections/index.js");
  const { EventEmitter } = await import("node:events");
  const seen = [];
  const fakeSpawn = (cmd, args, options) => {
    seen.push({ cmd, args, options });
    const child = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => child.emit("close", 0));
    return child;
  };
  const env = { PATH: "/bin", CURSOR_API_KEY: "k", ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "k" };
  const run = createSpawnRunner({ spawn: fakeSpawn, env });
  await run(["codex", "login"], { interactive: true }).done;
  await run(["codex", "--version"], { interactive: false }).done;
  assert.equal(seen[0].options.stdio, "inherit");
  assert.deepEqual(seen[1].options.stdio, ["ignore", "pipe", "pipe"]);
  for (const call of seen) {
    assert.equal(call.options.shell, false);
    assert.deepEqual(Object.keys(call.options.env), ["PATH"]);
  }
});

// T11/R4: an inconclusive post-login recheck is not a failed login.
function recheckApi({ status, interactive, statusTimeoutMs = 25 }) {
  const runner = createFakeRunner({ "claude --version": { stdout: "2.1.287\n" }, ...status });
  return createProviderConnections({
    runner, interactiveRunner: interactive ?? createFakeRunner({ "claude auth login --claudeai": { code: 0 } }),
    homeDir: mkdtempSync(join(tmpdir(), "kairo-conn-recheck-")), now: () => T0, evidenceStore: null, statusTimeoutMs
  });
}
const loginPreview = (api) => api.preview({ providerId: "claude", action: "login" });

test("T11/R4: caller already cancelled when login exits 0 => cancelled, no recheck", async () => {
  const controller = new AbortController();
  const interactive = (argv) => { controller.abort(); return { done: Promise.resolve({ code: 0, stdout: "", stderr: "" }), kill() {} }; };
  const api = recheckApi({ status: { "claude auth status --json": claudeStatus("a@example.com") }, interactive });
  const result = await api.connect({ preview: loginPreview(api), confirm: true, signal: controller.signal });
  assert.equal(result.outcome, "cancelled");
  assert.equal(result.reason, "cancelled");
});

test("T11/R4: recheck timeout => failed/auth_check_incomplete with status (not auth_not_confirmed)", async () => {
  const api = recheckApi({ status: { "claude auth status --json": { hang: true } } });
  const result = await api.connect({ preview: loginPreview(api), confirm: true, timeoutMs: 5000 });
  assert.equal(result.outcome, "failed");
  assert.equal(result.reason, "auth_check_incomplete");
  assert.equal(result.status.authentication.state, "unknown");
});

test("T11/R4: recheck spawn error => auth_check_incomplete; unparseable output stays auth_not_confirmed", async () => {
  const broken = recheckApi({ status: { "claude auth status --json": { errorCode: "EIO" } } });
  assert.equal((await broken.connect({ preview: loginPreview(broken), confirm: true })).reason, "auth_check_incomplete");
  const garbled = recheckApi({ status: { "claude auth status --json": { stdout: "not json" } } });
  assert.equal((await garbled.connect({ preview: loginPreview(garbled), confirm: true })).reason, "auth_not_confirmed");
});

test("T11/R4: cancel during the recheck => cancelled; recheck gets its own budget (tiny login timeout does not matter)", async () => {
  const controller = new AbortController();
  const api = recheckApi({ status: { "claude auth status --json": { hang: true } }, statusTimeoutMs: 5000 });
  const pending = api.connect({ preview: loginPreview(api), confirm: true, signal: controller.signal, timeoutMs: 1 });
  setTimeout(() => controller.abort(), 20);
  assert.equal((await pending).outcome, "cancelled");
  const ok = recheckApi({ status: { "claude auth status --json": claudeStatus("a@example.com") } });
  assert.equal((await ok.connect({ preview: loginPreview(ok), confirm: true, timeoutMs: 1 })).outcome, "connected");
});
