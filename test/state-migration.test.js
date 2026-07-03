import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGlobalState, getInstalledAdapterIds } from "../src/global/state-migration.js";
import { readGlobalState, createGlobalState } from "../src/global/state.js";
import { buildAdapterStateEntry, resolveAdapter } from "../src/global/registry.js";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("normalizeGlobalState migrates legacy agents array", () => {
  const legacy = {
    stateVersion: 1,
    packageName: "@kal-elsam/harness",
    cliVersion: "0.4.0",
    scope: "agent-global",
    agents: [
      { id: "cursor", configFile: ".cursor/AGENTS.md", present: true },
      { id: "codex", configFile: ".codex/AGENTS.md", present: false }
    ],
    coreFiles: { "core/orchestrator.md": "abc" },
    backups: []
  };

  const normalized = normalizeGlobalState(legacy);

  assert.equal(normalized.adapters.length, 2);
  assert.equal(normalized.adapters[0].label, "Cursor");
  assert.equal(normalized.adapters[0].rootDir, ".cursor");
  assert.deepEqual(normalized.adapters[0].managedTargets, [".cursor/AGENTS.md"]);
  assert.deepEqual(normalized.agents, legacy.agents);
});

test("getInstalledAdapterIds reads legacy and adapter-aware state", () => {
  const legacy = normalizeGlobalState({
    agents: [{ id: "cursor", configFile: ".cursor/AGENTS.md", present: true }]
  });

  assert.deepEqual(getInstalledAdapterIds(legacy), ["cursor"]);
});

test("readGlobalState accepts old state and rewrites adapter-aware entries on disk", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-state-home-"));
  const harnessDir = join(homeDir, ".harness");
  await mkdir(harnessDir, { recursive: true });

  const statePath = join(harnessDir, "state.json");
  const legacy = {
    stateVersion: 1,
    packageName: "@kal-elsam/harness",
    cliVersion: "0.4.0",
    scope: "agent-global",
    agents: [{ id: "cursor", configFile: ".cursor/AGENTS.md", present: true }],
    coreFiles: {},
    backups: []
  };

  await writeFile(statePath, `${JSON.stringify(legacy)}\n`, "utf8");

  const loaded = await readGlobalState(statePath);

  assert.ok(loaded.adapters);
  assert.equal(loaded.adapters[0].rootDir, ".cursor");
});

test("createGlobalState writes adapter-aware state with legacy agents mirror", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-state-write-"));
  const adapter = resolveAdapter("cursor");
  const entry = buildAdapterStateEntry(adapter, homeDir);
  const state = createGlobalState({
    packageName: "@kal-elsam/harness",
    cliVersion: "0.5.0",
    adapters: [entry],
    coreFiles: { "core/orchestrator.md": "hash" },
    backups: []
  });

  assert.equal(state.stateVersion, 2);
  assert.equal(state.adapters[0].label, "Cursor");
  assert.deepEqual(state.agents, [{ id: "cursor", configFile: ".cursor/AGENTS.md", present: false }]);
});
