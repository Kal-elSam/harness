import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readCachedUsage,
  writeCachedUsage,
  readCachedAvailability,
  writeCachedAvailability
} from "../src/global/host/workspace-cache.js";

async function tempHome() {
  return mkdtemp(join(tmpdir(), "kairo-workspace-cache-"));
}

test("writeCachedUsage then readCachedUsage round-trips the last-known usage value with a real timestamp", async () => {
  const homeDir = await tempHome();
  const value = { usage: { codex: { primary: { remainingPercent: 58 } } }, providers: {} };

  await writeCachedUsage(homeDir, value, { now: () => 1_700_000_000_000 });
  const cached = await readCachedUsage(homeDir);

  assert.deepEqual(cached, { value, savedAt: 1_700_000_000_000 });
});

test("readCachedUsage returns null when no usage has ever been cached", async () => {
  const homeDir = await tempHome();
  assert.equal(await readCachedUsage(homeDir), null);
});

test("readCachedUsage returns null for a malformed or wrong-schema cache file, never a fabricated value", async () => {
  const homeDir = await tempHome();
  await writeCachedUsage(homeDir, { usage: {}, providers: {} }, { now: () => 1 });
  const cached = await readCachedUsage(homeDir, {
    readFile: async () => "{ not json"
  });
  assert.equal(cached, null);
});

test("usage cache is global — not scoped to any one project", async () => {
  const homeDir = await tempHome();
  await writeCachedUsage(homeDir, { usage: { codex: null }, providers: {} }, { now: () => 42 });
  const fromProjectA = await readCachedUsage(homeDir);
  assert.equal(fromProjectA.savedAt, 42);
});

test("writeCachedAvailability then readCachedAvailability round-trips per project", async () => {
  const homeDir = await tempHome();
  const value = { eligibility: { codex: { ok: true } }, claudeEntitlement: {}, cursorAccess: {} };

  await writeCachedAvailability(homeDir, "/work/project-a", value, { now: () => 1_700_000_000_000 });
  const cached = await readCachedAvailability(homeDir, "/work/project-a");

  assert.deepEqual(cached, { value, savedAt: 1_700_000_000_000 });
});

test("readCachedAvailability returns null for a project that has never had a live probe cached", async () => {
  const homeDir = await tempHome();
  assert.equal(await readCachedAvailability(homeDir, "/work/never-probed"), null);
});

test("availability cache is per project — one project's cache never leaks into another's", async () => {
  const homeDir = await tempHome();
  await writeCachedAvailability(homeDir, "/work/project-a", { eligibility: { codex: { ok: true } } }, { now: () => 1 });

  const otherProject = await readCachedAvailability(homeDir, "/work/project-b");
  assert.equal(otherProject, null);

  const sameProject = await readCachedAvailability(homeDir, "/work/project-a");
  assert.ok(sameProject);
});

test("writeCachedUsage persists real bytes to disk under the Kairo home, atomically", async () => {
  const homeDir = await tempHome();
  await writeCachedUsage(homeDir, { usage: {}, providers: {} }, { now: () => 99 });
  const path = join(homeDir, ".harness", "workspace-usage-cache.json");
  const raw = JSON.parse(await readFile(path, "utf8"));
  assert.equal(raw.savedAt, 99);
  assert.ok(raw.schema);
});
