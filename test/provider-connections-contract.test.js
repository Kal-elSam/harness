// Conformance test for the provider-connections contract (original shapes plus
// additive fields) as read by the Settings consumer's adaptProviderConnectionsApi.
// The consumer's field list is EMBEDDED as data; nothing is imported from the
// other worktree. Everything is simulated: fake runners and a temp home.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProviderConnections } from "../src/global/provider-connections.js";
import { createFakeRunner } from "./helpers/fake-connection-runner.js";

const ADAPTER = {
  providers: ["codex", "claude", "cursor", "opencode-go"],
  rowKeys: ["providerId", "installation", "authentication", "modelAccess", "quota"],
  installation: ["installed", "missing", "unknown"],
  authentication: ["authenticated", "unauthenticated", "unknown"],
  modelAccessStates: ["allowed", "denied", "mixed", "exhausted", "temporarily_limited", "unknown"],
  quota: ["available", "exhausted", "unknown"],
  previewKeys: ["providerId", "action", "argv", "command", "surfaces", "networkVerification", "createdAt", "expiresAt", "previewId"],
  surfaceValues: ["browser", "credential-store", "network", "terminal"],
  connectKeys: ["outcome", "reason", "status", "accountChanged", "evidenceInvalidated"],
  connectOutcomes: ["connected", "cancelled", "timeout", "failed", "rejected"]
};

const T0 = 1_700_000_000_000;
const SCRIPT = {
  "claude --version": { stdout: "2.1.287\n" },
  "claude auth status --json": { stdout: JSON.stringify({ loggedIn: true, email: "x@example.com", orgId: "o", subscriptionType: "max" }) },
  "codex --version": { stdout: "codex-cli 0.159.3\n" }, "codex login status": { code: 1, stderr: "Not logged in\n" },
  "cursor-agent --version": { stdout: "2026.10.01\n" }, "cursor-agent status --format json": { stdout: "garbled" },
  "opencode --version": { stdout: "1.18.33\n" }, "opencode auth list": { stdout: "Credentials\n  OpenCode Go api\n1 credentials\n" }
};

function build(overrides = {}) {
  return createProviderConnections({
    runner: createFakeRunner({ ...SCRIPT, ...overrides.script }),
    interactiveRunner: createFakeRunner({ "claude auth login --claudeai": {}, "codex login": {}, ...overrides.logins }),
    now: () => T0,
    homeDir: mkdtempSync(join(tmpdir(), "kairo-conn-contract-")),
    ...overrides.deps
  });
}

test("contract: methods map is keyed connections.* and status/preview/connect exist", () => {
  const api = build();
  assert.deepEqual(Object.keys(api.methods), ["connections.status", "connections.preview", "connections.connect"]);
});

test("contract: status rows keep the original keys and vocabularies the adapter reads", async () => {
  const api = build({ deps: {
    accessReaders: { claude: () => [{ modelId: "a", status: "allowed" }, { modelId: "b", status: "unverified", limit: "temporary", retryAfterMs: 5 }] },
    quotaReaders: { claude: () => ({ remainingPercent: 3 }), codex: () => ({ remainingPercent: 0 }) }
  } });
  const { providers } = await api.status({ providerIds: ADAPTER.providers });
  assert.deepEqual(providers.map((row) => row.providerId), ADAPTER.providers);
  for (const row of providers) {
    for (const key of ADAPTER.rowKeys) assert.ok(key in row, `${row.providerId} lacks ${key}`);
    assert.ok(ADAPTER.installation.includes(row.installation.state));
    assert.ok(ADAPTER.authentication.includes(row.authentication.state));
    assert.ok(ADAPTER.modelAccessStates.includes(row.modelAccess.state), row.modelAccess.state);
    assert.ok(ADAPTER.quota.includes(row.quota.state));
    assert.ok(row.authentication.accountFingerprint === null || /^[0-9a-f]{32}$/.test(row.authentication.accountFingerprint));
    for (const layer of [row.installation, row.authentication, row.modelAccess, row.quota]) assert.equal(layer.network, "unverified");
  }
  const claude = providers.find((row) => row.providerId === "claude");
  assert.equal(claude.modelAccess.state, "mixed");
  assert.equal(claude.modelAccess.source, "entitlement-cache");
  assert.deepEqual(claude.modelAccess.models.map((m) => m.state), ["allowed", "rate_limited"]); // additive per-model rows
  assert.equal(providers.find((row) => row.providerId === "codex").quota.state, "unknown"); // unauthenticated: no quota claim
  const limited = await build({ deps: { accessReaders: { claude: () => [{ status: "unverified", limit: "temporary", retryAfterMs: 9 }] } } }).status({ providerIds: ["claude"] });
  assert.equal(limited.providers[0].modelAccess.state, "temporarily_limited");
  assert.equal(limited.providers[0].modelAccess.retryAfterMs, 9);
});

test("contract: preview is synchronous and pure, with exactly the fields the adapter reads", () => {
  const runner = createFakeRunner(SCRIPT);
  const api = createProviderConnections({ runner, now: () => T0, homeDir: mkdtempSync(join(tmpdir(), "kairo-conn-contract-")) });
  for (const providerId of ADAPTER.providers) {
    const preview = api.preview({ providerId, action: "login" });
    assert.ok(!(preview instanceof Promise));
    for (const key of ADAPTER.previewKeys) assert.ok(key in preview, `${providerId} preview lacks ${key}`);
    assert.ok(Array.isArray(preview.surfaces) && preview.surfaces.every((s) => ADAPTER.surfaceValues.includes(s)));
    assert.equal(typeof preview.expiresAt, "string");
    assert.ok(Date.parse(preview.expiresAt) > T0);
  }
  assert.equal(runner.calls.length, 0);
  assert.throws(() => api.preview({ providerId: "nope", action: "login" }), (error) => typeof error.code === "string");
});

test("contract: connect({preview, confirm, signal}) is stateless and returns the adapter's fields", async () => {
  const api = build();
  const preview = api.preview({ providerId: "claude", action: "login" });
  const result = await api.connect({ preview, confirm: true, signal: undefined });
  for (const key of ADAPTER.connectKeys) assert.ok(key in result, key);
  assert.equal(result.outcome, "connected");
  assert.equal(result.status.providerId, "claude");
  assert.equal(result.needsTerminal, true); // additive
  // stateless: the same preview object can be passed again (no held/one-shot state)
  assert.equal((await api.connect({ preview, confirm: true })).outcome, "connected");
  const outcomes = new Set([result.outcome]);
  outcomes.add((await api.connect({ preview, confirm: false })).outcome);
  outcomes.add((await build({ logins: { "claude auth login --claudeai": { code: 2 } } }).connect({ preview, confirm: true })).outcome);
  outcomes.add((await build({ logins: { "claude auth login --claudeai": { hang: true } } }).connect({ preview, confirm: true, timeoutMs: 10 })).outcome);
  const aborted = new AbortController();
  aborted.abort();
  outcomes.add((await build().connect({ preview, confirm: true, signal: aborted.signal })).outcome);
  assert.deepEqual([...outcomes].sort(), [...ADAPTER.connectOutcomes].sort());
});

test("contract: T8 reasons — non-zero exit is failed/exit_nonzero, unconfirmed auth is failed/auth_not_confirmed", async () => {
  const preview = build().preview({ providerId: "claude", action: "login" });
  const nonzero = await build({ logins: { "claude auth login --claudeai": { code: 1 } } }).connect({ preview, confirm: true });
  assert.deepEqual([nonzero.outcome, nonzero.reason], ["failed", "exit_nonzero"]);
  const unconfirmed = await build({ script: { "claude auth status --json": { stdout: JSON.stringify({ loggedIn: false }) } } }).connect({ preview, confirm: true });
  assert.deepEqual([unconfirmed.outcome, unconfirmed.reason], ["failed", "auth_not_confirmed"]);
});
