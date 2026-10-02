// T11/R3 end to end: the real verify/probe/merge/write path stamps the Cursor
// access cache with an account fingerprint, and the default reader reads it back.
// Fake probe, fake identity resolver, temp home: no CLI is ever run.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConversationService } from "../src/global/conversation/service.js";
import { createProviderConnections } from "../src/global/provider-connections/index.js";
import { readCursorAccountIdentifier } from "../src/global/provider-connections/readers.js";
import { createFakeRunner } from "./helpers/fake-connection-runner.js";

const NOW = Date.parse("2026-09-30T12:00:00.000Z");
const iso = (ms) => new Date(NOW + ms).toISOString();

function build({ home, identifier, resolverCalls }) {
  return createConversationService({
    resolveRoot: async () => "/repo", homeDir: home, enableProviderProbes: true, now: () => NOW,
    listPlans: async () => [], recoverRuns: async () => {},
    inspectExecutionAdapters: () => [{ id: "cursor", available: true, launchable: true, reason: null }],
    inspectEngramIntegration: () => ({ status: "configured" }),
    readCodexUsage: async () => null, readClaudeUsage: async () => null,
    readCodexModels: async () => ({ status: "measured", models: [] }),
    readClaudeModels: () => ({ status: "documented", models: [] }),
    readOpenCodeModels: async () => ({ status: "measured", models: [] }),
    readCursorModels: async () => ({ status: "measured", models: [
      { id: "composer-2.5", displayName: "Composer 2.5" }, { id: "gpt-5.4", displayName: "GPT 5.4" }
    ] }),
    probeCursorPoolAccess: async ({ pool }) => ({ pool, status: "available", reason: null, probedAt: iso(0) }),
    resolveCursorAccountIdentifier: async () => { resolverCalls.n += 1; return identifier; }
  });
}

const reader = (home, email = "ada@example.com") => createProviderConnections({
  runner: createFakeRunner({
    "cursor-agent --version": { stdout: "1.0.0\n" },
    "cursor-agent status --format json": { stdout: JSON.stringify({ authenticated: true, email }) }
  }),
  homeDir: home, now: () => NOW
});
const cursorRow = async (home, email) => (await reader(home, email).status({ providerIds: ["cursor"] })).providers[0];

test("R3: probe-write stamps the fingerprint (hash only) and the default reader resolves pools; another account is unknown", async () => {
  const home = mkdtempSync(join(tmpdir(), "kairo-cursor-id-"));
  const resolverCalls = { n: 0 };
  const service = build({ home, identifier: "ada@example.com", resolverCalls });
  await service.verifyAccess({ cwd: "/repo", confirmed: true });
  assert.equal(resolverCalls.n, 1, "identity resolved once per sweep, not per pool");
  const raw = readFileSync(join(home, ".harness", "cursor-access.json"), "utf8");
  assert.ok(!raw.includes("ada@example.com"));
  assert.match(JSON.parse(raw).accountFingerprint, /^[0-9a-f]{32}$/);
  const row = await cursorRow(home);
  assert.equal(row.modelAccess.state, "allowed");
  assert.ok(row.modelAccess.models.every((m) => m.state === "allowed"));
  // The account changes afterwards: evidence of the previous account must not be reused.
  assert.equal((await cursorRow(home, "bob@example.com")).modelAccess.state, "unknown");
});

test("R3: no identity => evidence written without fingerprint, and the reader says why", async () => {
  const home = mkdtempSync(join(tmpdir(), "kairo-cursor-noid-"));
  await build({ home, identifier: null, resolverCalls: { n: 0 } }).verifyAccess({ cwd: "/repo", confirmed: true });
  assert.equal(JSON.parse(readFileSync(join(home, ".harness", "cursor-access.json"), "utf8")).accountFingerprint ?? null, null);
  const row = await cursorRow(home);
  assert.equal(row.modelAccess.state, "unknown");
  assert.ok(row.modelAccess.models.every((m) => m.reason === "cursor_identity_not_recorded"));
});

test("R3: default identity resolver runs only the allowlisted status argv and never guesses", async () => {
  const ok = createFakeRunner({ "cursor-agent status --format json": { stdout: JSON.stringify({ authenticated: true, email: "ada@example.com" }) } });
  assert.equal(await readCursorAccountIdentifier({ runner: ok }), "ada@example.com");
  assert.deepEqual(ok.calls.map((c) => c.argv), [["cursor-agent", "status", "--format", "json"]]);
  for (const script of [{ "cursor-agent status --format json": { errorCode: "ENOENT" } }, { "cursor-agent status --format json": { stdout: "garbage" } }]) {
    assert.equal(await readCursorAccountIdentifier({ runner: createFakeRunner(script) }), null);
  }
});
