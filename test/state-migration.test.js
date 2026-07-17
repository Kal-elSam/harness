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
  assert.deepEqual(normalized.components[0].id, "orchestrator");
  assert.deepEqual(normalized.sdd, { persona: "off", agentIds: [], files: [], lastReceiptId: null, updatedAt: null });
  assert.equal(normalized.stateVersion, 4);
});

test("normalizeGlobalState preserves an existing v4 SDD block", () => {
  const sdd = {
    persona: "teaching",
    agentIds: ["codex", "cursor"],
    files: [{ destinationPath: "/h/.agents/skills/sdd-init/SKILL.md", skillId: "sdd-init", agentIds: ["codex"], hash: "abc", action: "create" }],
    lastReceiptId: "sdd-2026-01-01",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
  const normalized = normalizeGlobalState({ agents: [], components: [], sdd });

  assert.equal(normalized.sdd.persona, "teaching");
  assert.deepEqual(normalized.sdd.agentIds, ["codex", "cursor"]);
  assert.equal(normalized.sdd.files.length, 1);
  assert.equal(normalized.sdd.lastReceiptId, "sdd-2026-01-01");
});

test("normalizeGlobalState preserves explicit empty components array", () => {
  const state = normalizeGlobalState({
    agents: [{ id: "cursor", configFile: ".cursor/AGENTS.md", present: true }],
    components: []
  });

  assert.deepEqual(state.components, []);
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
    components: [{ id: "sdd-core", version: "1.0.0", managedTargets: [".cursor/AGENTS.md"] }],
    coreFiles: { "components/sdd-core/workflow.md": "hash" },
    backups: []
  });

  assert.equal(state.stateVersion, 4);
  assert.equal(state.adapters[0].label, "Cursor");
  assert.equal(state.components[0].id, "sdd-core");
  assert.deepEqual(state.agents, [{ id: "cursor", configFile: ".cursor/AGENTS.md", present: false }]);
});
