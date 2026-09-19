import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  readClaudeEntitlementCache,
  writeClaudeEntitlementCache,
  resolveClaudeEntitlements,
  mergeEntitlementResults,
  DEFAULT_ENTITLEMENT_TTL_MS
} from "../src/global/observability/claude-entitlement-store.js";
import { harnessHomePaths } from "../src/global/paths.js";
import { ENTITLEMENT } from "../src/global/observability/claude-model-entitlement.js";

async function tempHome() {
  return mkdtemp(join(tmpdir(), "kairo-entitlement-"));
}

test("readClaudeEntitlementCache returns null on missing or corrupt JSON without throwing", async () => {
  const homeDir = await tempHome();
  assert.equal(await readClaudeEntitlementCache(homeDir), null);

  const path = harnessHomePaths(homeDir).claudeEntitlementPath;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "{not-json", "utf8");
  assert.equal(await readClaudeEntitlementCache(homeDir), null);
});

test("writeClaudeEntitlementCache persists a doc that readClaudeEntitlementCache round-trips", async () => {
  const homeDir = await tempHome();
  const doc = {
    subscriptionType: "pro",
    fetchedAt: "2026-09-19T18:00:00.000Z",
    models: {
      "claude-fable-5-1": {
        status: ENTITLEMENT.DENIED,
        reason: "Fable 5.1 requires usage credits.",
        probedAt: "2026-09-19T18:00:00.000Z"
      }
    }
  };
  await writeClaudeEntitlementCache(homeDir, doc);
  const onDisk = JSON.parse(await readFile(harnessHomePaths(homeDir).claudeEntitlementPath, "utf8"));
  assert.equal(onDisk.subscriptionType, "pro");
  assert.equal(onDisk.models["claude-fable-5-1"].status, ENTITLEMENT.DENIED);
  assert.deepEqual(await readClaudeEntitlementCache(homeDir), onDisk);
});

test("resolveClaudeEntitlements discards the whole cache when subscriptionType differs (pro → max)", () => {
  const cache = {
    subscriptionType: "pro",
    fetchedAt: "2026-09-19T18:00:00.000Z",
    models: {
      "claude-haiku-4-5": {
        status: ENTITLEMENT.ALLOWED,
        reason: null,
        probedAt: "2026-09-19T18:00:00.000Z"
      }
    }
  };
  const resolved = resolveClaudeEntitlements({
    cache,
    subscriptionType: "max",
    catalogIds: ["claude-haiku-4-5", "claude-fable-5-1"],
    now: Date.parse("2026-09-19T18:01:00.000Z"),
    ttlMs: DEFAULT_ENTITLEMENT_TTL_MS
  });
  assert.equal(resolved["claude-haiku-4-5"].status, ENTITLEMENT.UNVERIFIED);
  assert.equal(resolved["claude-fable-5-1"].status, ENTITLEMENT.UNVERIFIED);
});

test("resolveClaudeEntitlements expires per-entry TTL after 7 days", () => {
  const probedAt = "2026-09-01T00:00:00.000Z";
  const cache = {
    subscriptionType: "pro",
    fetchedAt: probedAt,
    models: {
      "claude-haiku-4-5": {
        status: ENTITLEMENT.ALLOWED,
        reason: null,
        probedAt
      }
    }
  };
  const fresh = resolveClaudeEntitlements({
    cache,
    subscriptionType: "pro",
    catalogIds: ["claude-haiku-4-5"],
    now: Date.parse("2026-09-05T00:00:00.000Z"),
    ttlMs: DEFAULT_ENTITLEMENT_TTL_MS
  });
  assert.equal(fresh["claude-haiku-4-5"].status, ENTITLEMENT.ALLOWED);

  const stale = resolveClaudeEntitlements({
    cache,
    subscriptionType: "pro",
    catalogIds: ["claude-haiku-4-5"],
    now: Date.parse("2026-09-09T00:00:01.000Z"),
    ttlMs: DEFAULT_ENTITLEMENT_TTL_MS
  });
  assert.equal(stale["claude-haiku-4-5"].status, ENTITLEMENT.UNVERIFIED);
});

test("mergeEntitlementResults drops status unknown and keeps allowed/denied under the new subscriptionType", () => {
  const cache = {
    subscriptionType: "pro",
    fetchedAt: "2026-09-19T10:00:00.000Z",
    models: {
      "claude-opus-5": {
        status: ENTITLEMENT.ALLOWED,
        reason: null,
        probedAt: "2026-09-19T10:00:00.000Z"
      }
    }
  };
  const merged = mergeEntitlementResults(cache, {
    subscriptionType: "pro",
    catalogIds: ["claude-opus-5", "claude-fable-5-1", "claude-haiku-4-5"],
    results: [
      {
        modelId: "claude-fable-5-1",
        status: ENTITLEMENT.DENIED,
        reason: "Fable 5.1 requires usage credits.",
        probedAt: "2026-09-19T18:00:00.000Z"
      },
      {
        modelId: "claude-haiku-4-5",
        status: "unknown",
        reason: "spawn failed",
        probedAt: "2026-09-19T18:00:00.000Z"
      },
      {
        modelId: "claude-sonnet-4-6",
        status: ENTITLEMENT.UNVERIFIED,
        reason: "timeout",
        probedAt: "2026-09-19T18:00:00.000Z"
      }
    ]
  });
  assert.equal(merged.subscriptionType, "pro");
  assert.equal(merged.models["claude-opus-5"].status, ENTITLEMENT.ALLOWED);
  assert.equal(merged.models["claude-fable-5-1"].status, ENTITLEMENT.DENIED);
  assert.equal(merged.models["claude-haiku-4-5"], undefined);
  assert.equal(merged.models["claude-sonnet-4-6"], undefined);
});
