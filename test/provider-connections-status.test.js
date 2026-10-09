// All provider CLI behavior in this file is SIMULATED through an injected
// fake runner. No real codex/claude/cursor-agent/opencode process is spawned,
// no network is touched and the real ~/.harness is never read.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProviderConnections, STATUS_ARGV, LOGIN_ARGV, PROVIDER_IDS } from "../src/global/provider-connections/index.js";
import { createFakeRunner } from "./helpers/fake-connection-runner.js";

// Every api gets a throwaway home so default cache readers/store never touch the real ~/.harness.
const tempHome = () => mkdtempSync(join(tmpdir(), "kairo-conn-status-"));

const SECRET_EMAIL = "ada.lovelace@example.com";
const SECRET_ORG = "org-secret-123";

const VERSION = {
  codex: { argv: "codex --version", stdout: "codex-cli 0.159.3\n" },
  claude: { argv: "claude --version", stdout: "2.1.287 (Claude Code)\n" },
  cursor: { argv: "cursor-agent --version", stdout: "2026.10.01-14929f9\n" },
  "opencode-go": { argv: "opencode --version", stdout: "1.18.33\n" }
};
const AUTH_ARGV = {
  codex: "codex login status",
  claude: "claude auth status --json",
  cursor: "cursor-agent status --format json",
  "opencode-go": "opencode auth list"
};

function scriptFor(providerId, authEntry) {
  return {
    [VERSION[providerId].argv]: { stdout: VERSION[providerId].stdout },
    [AUTH_ARGV[providerId]]: authEntry
  };
}

const AUTHENTICATED = {
  codex: { stdout: "Logged in using ChatGPT\n" },
  claude: { stdout: JSON.stringify({ loggedIn: true, email: SECRET_EMAIL, orgId: SECRET_ORG, authMethod: "claude.ai" }) },
  cursor: { stdout: JSON.stringify({ authenticated: true, email: SECRET_EMAIL, userId: "u-1" }) },
  "opencode-go": { stdout: "Credentials\n  OpenCode Go api\n1 credentials\n" }
};
const UNAUTHENTICATED = {
  codex: { code: 1, stderr: "Not logged in\n" },
  claude: { code: 1, stdout: JSON.stringify({ loggedIn: false }) },
  cursor: { code: 1, stdout: "Not logged in\n" },
  "opencode-go": { stdout: "Credentials\n0 credentials\n" }
};

function build(providerId, authEntry, deps = {}) {
  const runner = createFakeRunner(scriptFor(providerId, authEntry));
  const api = createProviderConnections({ runner, homeDir: tempHome(), now: () => 1_000_000, ...deps });
  return { api, runner };
}

async function statusOf(providerId, authEntry, deps, input = {}) {
  const { api, runner } = build(providerId, authEntry, deps);
  const result = await api.status({ providerIds: [providerId], ...input });
  return { provider: result.providers[0], result, runner };
}

for (const providerId of PROVIDER_IDS) {
  test(`status: ${providerId} account absent is unauthenticated, not unknown`, async () => {
    const { provider } = await statusOf(providerId, UNAUTHENTICATED[providerId]);
    assert.equal(provider.installation.state, "installed");
    assert.equal(provider.authentication.state, "unauthenticated");
    assert.equal(provider.authentication.accountFingerprint, null);
  });

  test(`status: ${providerId} authenticated keeps four separate layers`, async () => {
    const { provider } = await statusOf(providerId, AUTHENTICATED[providerId]);
    assert.equal(provider.installation.state, "installed");
    assert.ok(provider.installation.version);
    assert.equal(provider.authentication.state, "authenticated");
    assert.equal(provider.modelAccess.state, "unknown");
    assert.equal(provider.quota.state, "unknown");
    for (const layer of ["installation", "authentication", "modelAccess", "quota"]) {
      assert.equal(provider[layer].network, "unverified", `${layer} must not claim offline safety`);
    }
  });

  test(`status: ${providerId} unparseable output is unknown, never authenticated`, async () => {
    const { provider } = await statusOf(providerId, { stdout: "\u0000??weird{{ output 42\n" });
    assert.equal(provider.authentication.state, "unknown");
    assert.equal(provider.authentication.reason, "unparseable");
  });

  test(`status: ${providerId} missing binary is installation missing and auth unknown`, async () => {
    const runner = createFakeRunner({});
    const api = createProviderConnections({ runner, homeDir: tempHome(), now: () => 1 });
    const { providers } = await api.status({ providerIds: [providerId] });
    assert.equal(providers[0].installation.state, "missing");
    assert.equal(providers[0].authentication.state, "unknown");
    assert.notEqual(providers[0].authentication.state, "unauthenticated");
  });

  test(`status: ${providerId} timeout yields unknown with reason timeout and kills the process`, async () => {
    const script = scriptFor(providerId, { hang: true });
    const runner = createFakeRunner(script);
    const api = createProviderConnections({ runner, homeDir: tempHome(), now: () => 1 });
    const { providers } = await api.status({ providerIds: [providerId], timeoutMs: 20 });
    assert.equal(providers[0].authentication.state, "unknown");
    assert.equal(providers[0].authentication.reason, "timeout");
    assert.ok(runner.kills.includes(AUTH_ARGV[providerId]));
  });

  test(`status: ${providerId} results contain no raw stdout/stderr or raw identifiers`, async () => {
    const { result } = await statusOf(providerId, AUTHENTICATED[providerId]);
    const text = JSON.stringify(result);
    for (const forbidden of [SECRET_EMAIL, SECRET_ORG, "Logged in using", "Credentials", "stdout", "stderr"]) {
      assert.ok(!text.includes(forbidden), `result leaked ${forbidden}`);
    }
  });
}

test("status: identified accounts expose only a hash fingerprint (claude, cursor)", async () => {
  for (const providerId of ["claude", "cursor"]) {
    const { provider } = await statusOf(providerId, AUTHENTICATED[providerId]);
    assert.match(provider.authentication.accountFingerprint, /^[0-9a-f]{32}$/);
  }
});

test("status: cursor identity is read generically (email/userId/id) and null when absent, never fabricated", async () => {
  const withId = await statusOf("cursor", { stdout: JSON.stringify({ loggedIn: true, user: { id: "abc" } }) });
  assert.match(withId.provider.authentication.accountFingerprint, /^[0-9a-f]{32}$/);
  const without = await statusOf("cursor", { stdout: JSON.stringify({ loggedIn: true }) });
  assert.equal(without.provider.authentication.state, "authenticated");
  assert.equal(without.provider.authentication.accountFingerprint, null);
});

test("status: account change produces a different fingerprint with no raw identifier anywhere", async () => {
  const a = await statusOf("claude", { stdout: JSON.stringify({ loggedIn: true, email: "a@example.com", orgId: "o1" }) });
  const b = await statusOf("claude", { stdout: JSON.stringify({ loggedIn: true, email: "b@example.com", orgId: "o1" }) });
  assert.notEqual(a.provider.authentication.accountFingerprint, b.provider.authentication.accountFingerprint);
  assert.ok(!JSON.stringify([a.result, b.result]).includes("example.com"));
});

test("status: only fixed allowlisted argv are ever run, with no shell", async () => {
  const { runner } = await statusOf("claude", AUTHENTICATED.claude);
  assert.deepEqual(runner.calls.map((c) => c.argv), [["claude", "--version"], ["claude", "auth", "status", "--json"]]);
});

test("status: abort signal yields reason cancelled and kills the running process", async () => {
  const runner = createFakeRunner(scriptFor("codex", { hang: true }));
  const api = createProviderConnections({ runner, homeDir: tempHome(), now: () => 1 });
  const controller = new AbortController();
  const pending = api.status({ providerIds: ["codex"], signal: controller.signal, timeoutMs: 5000 });
  setTimeout(() => controller.abort(), 10);
  const { providers } = await pending;
  assert.equal(providers[0].authentication.reason, "cancelled");
  assert.ok(runner.kills.length >= 1);
});

test("status: unknown provider ids and arbitrary command strings are rejected", async () => {
  const api = createProviderConnections({ runner: createFakeRunner({}), homeDir: tempHome(), now: () => 1 });
  await assert.rejects(() => api.status({ providerIds: ["rm -rf /"] }), /unknown provider/i);
  await assert.rejects(() => api.status({ providerIds: ["codex; id"] }), /unknown provider/i);
});

test("status: temporary limit (429 evidence) surfaces as temporarily_limited, not denied or allowed", async () => {
  for (const providerId of PROVIDER_IDS) {
    const accessReaders = {
      [providerId]: () => [{ status: "unverified", limit: "temporary", retryAfterMs: 300_000 }]
    };
    const { provider } = await statusOf(providerId, AUTHENTICATED[providerId], { accessReaders });
    assert.equal(provider.modelAccess.state, "temporarily_limited");
    assert.equal(provider.modelAccess.retryAfterMs, 300_000);
  }
});

test("status: explicit denial stays denied and allowed evidence stays allowed", async () => {
  const denied = await statusOf("claude", AUTHENTICATED.claude, { accessReaders: { claude: () => [{ status: "denied" }] } });
  assert.equal(denied.provider.modelAccess.state, "denied");
  const allowed = await statusOf("claude", AUTHENTICATED.claude, { accessReaders: { claude: () => [{ status: "allowed" }] } });
  assert.equal(allowed.provider.modelAccess.state, "allowed");
});

test("status: access evidence is not consulted for an unauthenticated account", async () => {
  let consulted = false;
  const accessReaders = { claude: () => { consulted = true; return [{ status: "allowed" }]; } };
  const { provider } = await statusOf("claude", UNAUTHENTICATED.claude, { accessReaders });
  assert.equal(consulted, false);
  assert.equal(provider.modelAccess.state, "unknown");
});

test("status: the access reader receives the in-memory identifier but results never carry it", async () => {
  let seen = null;
  const accessReaders = { claude: ({ accountIdentifier }) => { seen = accountIdentifier; return [{ status: "allowed" }]; } };
  const { result } = await statusOf("claude", AUTHENTICATED.claude, { accessReaders });
  assert.equal(seen, `${SECRET_EMAIL}|${SECRET_ORG}`);
  assert.ok(!JSON.stringify(result).includes(SECRET_EMAIL));
});

test("status: quota comes from injected readers and stays separate from access", async () => {
  const quotaReaders = { codex: () => ({ remainingPercent: 42 }) };
  const { provider } = await statusOf("codex", AUTHENTICATED.codex, { quotaReaders });
  assert.equal(provider.quota.state, "available");
  assert.equal(provider.quota.remainingPercent, 42);
  assert.equal(provider.modelAccess.state, "unknown");
});

test("allowlists: no secret-bearing flag exists anywhere and argv are fixed arrays", () => {
  const forbidden = ["--with-api-key", "--with-access-token", "--api-key", "CURSOR_API_KEY"];
  const all = [...Object.values(STATUS_ARGV).flatMap((entry) => Object.values(entry)), ...Object.values(LOGIN_ARGV)];
  for (const argv of all) {
    assert.ok(Array.isArray(argv));
    for (const token of argv) {
      assert.equal(typeof token, "string");
      assert.ok(!forbidden.includes(token), `${token} must never be allowlisted`);
      assert.ok(!/api[-_]?key|access-token/i.test(token));
    }
  }
  assert.ok(Object.isFrozen(LOGIN_ARGV));
  assert.ok(Object.isFrozen(STATUS_ARGV));
});
