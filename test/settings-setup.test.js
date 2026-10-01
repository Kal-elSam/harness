/**
 * U2: native setup inside Settings — load / preview / confirmed apply.
 * All tests use a temp homeDir; the real HOME is never touched.
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import {
  applySetup,
  loadSetupOptions,
  previewSetup
} from "../src/global/host/settings-setup.js";
import { DEFAULT_COMPONENT_IDS } from "../src/global/component-registry.js";
import { GLOBAL_AGENT_IDS } from "../src/global/registry.js";

async function tempHome() {
  return mkdtemp(join(tmpdir(), "kairo-settings-setup-"));
}

async function snapshotTree(root) {
  const out = {};
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        out[`${relative(root, full)}/`] = "dir";
        await walk(full);
      } else {
        out[relative(root, full)] = (await readFile(full)).toString("base64");
      }
    }
  }
  await walk(root);
  return out;
}

test("settings.setup.load reports agents with detected flags and component defaults", async () => {
  const homeDir = await tempHome();
  try {
    await mkdir(join(homeDir, ".claude"), { recursive: true });
    const load = await loadSetupOptions({ homeDir, workspaceRoot: null });
    assert.equal(load.ok, true);
    assert.deepEqual(
      load.agents.map((a) => a.id).sort(),
      [...GLOBAL_AGENT_IDS].sort()
    );
    const claude = load.agents.find((a) => a.id === "claude");
    assert.equal(claude.detected, true);
    assert.equal(typeof claude.label, "string");
    assert.equal(load.agents.find((a) => a.id === "codex").detected, false);
    assert.ok(load.components.length >= DEFAULT_COMPONENT_IDS.length);
    for (const id of DEFAULT_COMPONENT_IDS) {
      const entry = load.components.find((c) => c.id === id);
      assert.ok(entry, `component ${id}`);
      assert.equal(entry.defaultEnabled, true);
      assert.equal(typeof entry.label, "string");
    }
    assert.deepEqual(load.defaults.agents, ["claude"]);
    assert.deepEqual(load.defaults.components, [...DEFAULT_COMPONENT_IDS]);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("settings.setup.load defaults to every agent when none is detected", async () => {
  const homeDir = await tempHome();
  try {
    const load = await loadSetupOptions({ homeDir, workspaceRoot: null });
    assert.deepEqual(load.defaults.agents, [...GLOBAL_AGENT_IDS]);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("settings.setup.preview returns plan summary + fingerprint and writes nothing", async () => {
  const homeDir = await tempHome();
  try {
    await mkdir(join(homeDir, ".claude"), { recursive: true });
    const before = await snapshotTree(homeDir);
    const preview = await previewSetup({
      homeDir,
      workspaceRoot: null,
      agents: ["claude"],
      components: [...DEFAULT_COMPONENT_IDS]
    });
    assert.equal(preview.ok, true);
    assert.match(preview.fingerprint, /^[0-9a-f]{64}$/);
    assert.deepEqual(preview.agents, ["claude"]);
    assert.ok(preview.changes.length > 0);
    assert.match(preview.summary, /managed change/);
    assert.deepEqual(await snapshotTree(homeDir), before);
    const again = await previewSetup({
      homeDir,
      workspaceRoot: null,
      agents: ["claude"],
      components: [...DEFAULT_COMPONENT_IDS]
    });
    assert.equal(again.fingerprint, preview.fingerprint);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("settings.setup.preview rejects unknown agent / component / empty selection honestly", async () => {
  const homeDir = await tempHome();
  try {
    const badAgent = await previewSetup({ homeDir, agents: ["nope"], components: [] });
    assert.equal(badAgent.ok, false);
    assert.equal(badAgent.reason, "invalid_selection");
    assert.match(badAgent.error, /Unknown agent "nope"/);
    const badComponent = await previewSetup({
      homeDir,
      agents: ["claude"],
      components: ["ghost-component"]
    });
    assert.equal(badComponent.ok, false);
    assert.equal(badComponent.reason, "invalid_selection");
    assert.match(badComponent.error, /Unknown component "ghost-component"/);
    const noAgents = await previewSetup({ homeDir, agents: [], components: [] });
    assert.equal(noAgents.ok, false);
    assert.equal(noAgents.reason, "invalid_selection");
    assert.deepEqual(await readdir(homeDir), []);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("settings.setup.apply without confirm applies nothing", async () => {
  const homeDir = await tempHome();
  const calls = [];
  try {
    const preview = await previewSetup({ homeDir, agents: ["claude"], components: [] });
    const result = await applySetup({
      homeDir,
      agents: ["claude"],
      components: [],
      fingerprint: preview.fingerprint,
      installFn: async (args) => {
        calls.push(args);
        return {};
      }
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "not_confirmed");
    assert.equal(calls.length, 0);
    const falsy = await applySetup({
      homeDir,
      agents: ["claude"],
      components: [],
      fingerprint: preview.fingerprint,
      confirm: "yes",
      installFn: async (args) => {
        calls.push(args);
        return {};
      }
    });
    assert.equal(falsy.reason, "not_confirmed");
    assert.equal(calls.length, 0);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("settings.setup.apply with missing or mismatched fingerprint applies nothing (stale_preview)", async () => {
  const homeDir = await tempHome();
  const calls = [];
  const installFn = async (args) => {
    calls.push(args);
    return {};
  };
  try {
    const missing = await applySetup({
      homeDir,
      agents: ["claude"],
      components: [],
      confirm: true,
      installFn
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, "stale_preview");
    const wrong = await applySetup({
      homeDir,
      agents: ["claude"],
      components: [],
      confirm: true,
      fingerprint: "0".repeat(64),
      installFn
    });
    assert.equal(wrong.reason, "stale_preview");
    // Fingerprint of a different selection must not authorize this one.
    const other = await previewSetup({ homeDir, agents: ["codex"], components: [] });
    const crossed = await applySetup({
      homeDir,
      agents: ["claude"],
      components: [],
      confirm: true,
      fingerprint: other.fingerprint,
      installFn
    });
    assert.equal(crossed.reason, "stale_preview");
    assert.equal(calls.length, 0);
    assert.deepEqual(await readdir(homeDir), []);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("settings.setup.apply confirmed calls installGlobalHarness with the previewed selection", async () => {
  const homeDir = await tempHome();
  const calls = [];
  try {
    const preview = await previewSetup({
      homeDir,
      agents: ["claude", "codex"],
      components: ["orchestrator"]
    });
    assert.equal(preview.ok, true);
    const result = await applySetup({
      homeDir,
      agents: ["claude", "codex"],
      components: ["orchestrator"],
      fingerprint: preview.fingerprint,
      confirm: true,
      installFn: async (args) => {
        calls.push(args);
        return { configsCreated: [".claude/CLAUDE.md"], configsUpdated: [] };
      }
    });
    assert.equal(result.ok, true);
    assert.equal(result.reason, "applied");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].dryRun, false);
    assert.equal(calls[0].homeDir, homeDir);
    assert.deepEqual(calls[0].agents, ["claude", "codex"]);
    assert.deepEqual(calls[0].components, ["orchestrator"]);
    assert.equal(calls[0].noDefaultComponents, false);
    assert.deepEqual(result.agents, ["claude", "codex"]);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("settings.setup.apply with empty component selection maps to noDefaultComponents", async () => {
  const homeDir = await tempHome();
  const calls = [];
  try {
    const preview = await previewSetup({ homeDir, agents: ["claude"], components: [] });
    assert.equal(preview.noDefaultComponents, true);
    const result = await applySetup({
      homeDir,
      agents: ["claude"],
      components: [],
      fingerprint: preview.fingerprint,
      confirm: true,
      installFn: async (args) => {
        calls.push(args);
        return {};
      }
    });
    assert.equal(result.ok, true);
    assert.equal(calls[0].noDefaultComponents, true);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("settings.setup.apply surfaces installer failures as a visible error", async () => {
  const homeDir = await tempHome();
  try {
    const preview = await previewSetup({ homeDir, agents: ["claude"], components: [] });
    const result = await applySetup({
      homeDir,
      agents: ["claude"],
      components: [],
      fingerprint: preview.fingerprint,
      confirm: true,
      installFn: async () => {
        throw new Error("disk full");
      }
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "apply_failed");
    assert.match(result.error, /disk full/);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("settings.setup.apply integration: confirmed apply writes into the temp home only", async () => {
  const homeDir = await tempHome();
  try {
    const preview = await previewSetup({ homeDir, agents: ["claude"], components: [] });
    assert.equal(preview.ok, true);
    const result = await applySetup({
      homeDir,
      agents: ["claude"],
      components: [],
      fingerprint: preview.fingerprint,
      confirm: true
    });
    assert.equal(result.ok, true, result.error);
    const claudeMd = await stat(join(homeDir, ".claude", "CLAUDE.md"));
    assert.ok(claudeMd.isFile());
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});
