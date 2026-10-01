import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { computeAccountFingerprint } from "../src/global/observability/account-fingerprint.js";
import { ENTITLEMENT } from "../src/global/observability/claude-model-entitlement.js";
import {
  mergeEntitlementResults, readClaudeEntitlementCache, resolveClaudeEntitlements, writeClaudeEntitlementCache
} from "../src/global/observability/claude-entitlement-store.js";
import {
  CURSOR_ACCESS_STATUS
} from "../src/global/observability/cursor-entitlement.js";
import {
  mergeCursorAccessResult, readCursorAccessCache, resolveCursorPoolAccess, writeCursorAccessCache
} from "../src/global/observability/cursor-entitlement-store.js";
import { harnessHomePaths } from "../src/global/paths.js";

const NOW = Date.parse("2026-10-01T12:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();
const ALICE = "alice@example.com|org-111";
const BOB = "bob@example.com|org-222";
const allowed = { modelId: "m1", status: ENTITLEMENT.ALLOWED, probedAt: iso(NOW - 1000) };

function claudeView(cache, accountIdentifier) {
  return resolveClaudeEntitlements({ cache, subscriptionType: "pro", catalogIds: ["m1"], now: NOW, accountIdentifier });
}

test("computeAccountFingerprint is a stable one-way hash and null for unidentifiable input", () => {
  const a = computeAccountFingerprint(ALICE);
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.equal(a, computeAccountFingerprint(ALICE));
  assert.notEqual(a, computeAccountFingerprint(BOB));
  assert.ok(!a.includes("alice"));
  for (const bad of [null, undefined, "", "   ", 42, {}]) assert.equal(computeAccountFingerprint(bad), null);
});

test("claude: same account keeps evidence", () => {
  const cache = mergeEntitlementResults(null, { subscriptionType: "pro", accountIdentifier: ALICE, results: [allowed] });
  assert.equal(claudeView(cache, ALICE).m1.status, ENTITLEMENT.ALLOWED);
});

test("claude: account change invalidates previous evidence", () => {
  const cache = mergeEntitlementResults(null, { subscriptionType: "pro", accountIdentifier: ALICE, results: [allowed] });
  assert.equal(claudeView(cache, BOB).m1.status, ENTITLEMENT.UNVERIFIED);
});

test("claude: unidentifiable current account never reuses evidence", () => {
  const cache = mergeEntitlementResults(null, { subscriptionType: "pro", accountIdentifier: ALICE, results: [allowed] });
  assert.equal(claudeView(cache, null).m1.status, ENTITLEMENT.UNVERIFIED);
  assert.equal(claudeView(cache, undefined).m1.status, ENTITLEMENT.UNVERIFIED);
  const anon = mergeEntitlementResults(null, { subscriptionType: "pro", accountIdentifier: null, results: [allowed] });
  assert.equal(claudeView(anon, null).m1.status, ENTITLEMENT.UNVERIFIED);
});

test("claude: merging under a different account drops the old account's models", () => {
  const cache = mergeEntitlementResults(null, { subscriptionType: "pro", accountIdentifier: ALICE, results: [allowed] });
  const next = mergeEntitlementResults(cache, {
    subscriptionType: "pro", accountIdentifier: BOB, results: [{ modelId: "m2", status: ENTITLEMENT.DENIED, probedAt: iso(NOW) }]
  });
  assert.equal(next.models.m1, undefined);
  assert.equal(next.accountFingerprint, computeAccountFingerprint(BOB));
});

test("claude: legacy cache without fingerprint is not reused once identity is supplied, and does not throw", () => {
  const legacy = { subscriptionType: "pro", fetchedAt: iso(NOW), models: { m1: { status: "allowed", reason: null, probedAt: iso(NOW - 1000) } } };
  assert.equal(claudeView(legacy, ALICE).m1.status, ENTITLEMENT.UNVERIFIED);
  assert.equal(resolveClaudeEntitlements({ cache: legacy, subscriptionType: "pro", catalogIds: ["m1"], now: NOW }).m1.status, ENTITLEMENT.ALLOWED);
});

test("claude: serialized cache holds the hash only, no raw identifier", async () => {
  const home = await mkdtemp(join(tmpdir(), "kairo-fp-"));
  try {
    const doc = mergeEntitlementResults(null, { subscriptionType: "pro", accountIdentifier: ALICE, results: [allowed] });
    await writeClaudeEntitlementCache(home, doc);
    const raw = await readFile(harnessHomePaths(home).claudeEntitlementPath, "utf8");
    assert.ok(raw.includes(computeAccountFingerprint(ALICE)));
    for (const leak of ["alice", "example.com", "org-111"]) assert.ok(!raw.includes(leak), leak);
    assert.equal((await readClaudeEntitlementCache(home)).accountFingerprint, computeAccountFingerprint(ALICE));
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("claude: reading an old on-disk cache without fingerprint does not throw", async () => {
  const home = await mkdtemp(join(tmpdir(), "kairo-fp-"));
  try {
    const path = harnessHomePaths(home).claudeEntitlementPath;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ subscriptionType: "pro", fetchedAt: iso(NOW), models: {} }));
    const doc = await readClaudeEntitlementCache(home);
    assert.doesNotThrow(() => claudeView(doc, ALICE));
  } finally { await rm(home, { recursive: true, force: true }); }
});

const poolResult = { pool: "other_models", status: CURSOR_ACCESS_STATUS.AVAILABLE, reason: null, probedAt: iso(NOW - 1000) };
const cursorView = (cache, accountIdentifier) => resolveCursorPoolAccess({ cache, pool: "other_models", now: NOW, accountIdentifier });

test("cursor: same account keeps evidence, change or unknown account invalidates", () => {
  const cache = mergeCursorAccessResult(null, poolResult, { accountIdentifier: ALICE });
  assert.equal(cursorView(cache, ALICE).status, CURSOR_ACCESS_STATUS.AVAILABLE);
  assert.equal(cursorView(cache, BOB).status, CURSOR_ACCESS_STATUS.UNVERIFIED);
  assert.equal(cursorView(cache, null).status, CURSOR_ACCESS_STATUS.UNVERIFIED);
  assert.equal(cursorView(cache, undefined).status, CURSOR_ACCESS_STATUS.UNVERIFIED);
});

test("cursor: merge under another account drops old pools; legacy cache is not reused", () => {
  const cache = mergeCursorAccessResult(null, poolResult, { accountIdentifier: ALICE });
  const next = mergeCursorAccessResult(cache, { ...poolResult, pool: "cursor_models" }, { accountIdentifier: BOB });
  assert.equal(next.pools.other_models, undefined);
  const legacy = { fetchedAt: iso(NOW), pools: { other_models: { status: "available", reason: null, probedAt: iso(NOW - 1000) } } };
  assert.equal(cursorView(legacy, ALICE).status, CURSOR_ACCESS_STATUS.UNVERIFIED);
  assert.equal(resolveCursorPoolAccess({ cache: legacy, pool: "other_models", now: NOW }).status, CURSOR_ACCESS_STATUS.AVAILABLE);
});

test("cursor: serialized cache has no raw identifier; legacy file reads without throwing", async () => {
  const home = await mkdtemp(join(tmpdir(), "kairo-fp-"));
  try {
    await writeCursorAccessCache(home, mergeCursorAccessResult(null, poolResult, { accountIdentifier: ALICE }));
    const raw = await readFile(harnessHomePaths(home).cursorAccessPath, "utf8");
    for (const leak of ["alice", "example.com", "org-111"]) assert.ok(!raw.includes(leak), leak);
    assert.ok(raw.includes(computeAccountFingerprint(ALICE)));
    await writeFile(harnessHomePaths(home).cursorAccessPath, JSON.stringify({ fetchedAt: iso(NOW), pools: {} }));
    assert.equal(cursorView(await readCursorAccessCache(home), ALICE).status, CURSOR_ACCESS_STATUS.UNVERIFIED);
  } finally { await rm(home, { recursive: true, force: true }); }
});
