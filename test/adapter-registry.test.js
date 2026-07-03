import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GLOBAL_AGENT_IDS,
  detectInstalledAdapters,
  listAdapters,
  resolveAdapter,
  resolveTargetAdapters,
  validateAdapterIds
} from "../src/global/registry.js";
import { buildAdapterContext } from "../src/global/adapter-context.js";

test("registry lists all four supported adapters", () => {
  const adapters = listAdapters();

  assert.equal(adapters.length, 4);
  assert.deepEqual(adapters.map((adapter) => adapter.id), GLOBAL_AGENT_IDS);
  assert.deepEqual(GLOBAL_AGENT_IDS, ["cursor", "codex", "opencode", "claude"]);
});

test("registry resolves adapters by id", () => {
  const cursor = resolveAdapter("cursor");

  assert.equal(cursor.id, "cursor");
  assert.equal(cursor.label, "Cursor");
  assert.equal(cursor.assets.configFile, ".cursor/AGENTS.md");
  assert.deepEqual(cursor.assets.managedTargets, [".cursor/AGENTS.md"]);
  assert.equal(typeof cursor.detect, "function");
  assert.equal(typeof cursor.plan, "function");
  assert.equal(typeof cursor.apply, "function");
  assert.equal(typeof cursor.doctor, "function");
  assert.equal(typeof cursor.uninstall, "function");
});

test("unknown adapter fails clearly", () => {
  assert.throws(() => resolveAdapter("gemini"), /Unknown agent "gemini"/);
  assert.throws(() => validateAdapterIds(["cursor", "gemini"]), /Unknown agent "gemini"/);
});

test("detection returns only present agent roots", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-registry-home-"));
  await mkdir(join(homeDir, ".cursor"), { recursive: true });
  await mkdir(join(homeDir, ".codex"), { recursive: true });

  const context = buildAdapterContext({ homeDir, packageName: "@kal-elsam/harness" });
  const detected = detectInstalledAdapters(context);

  assert.deepEqual(detected, ["cursor", "codex"]);
});

test("resolveTargetAdapters falls back to all adapters when none detected", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-registry-empty-"));
  const context = buildAdapterContext({ homeDir, packageName: "@kal-elsam/harness" });

  const targets = resolveTargetAdapters(context);

  assert.equal(targets.length, 4);
});

test("resolveTargetAdapters honors explicit adapter selection", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-registry-select-"));
  const context = buildAdapterContext({ homeDir, packageName: "@kal-elsam/harness" });

  const targets = resolveTargetAdapters(context, ["claude"]);

  assert.deepEqual(targets.map((adapter) => adapter.id), ["claude"]);
});
