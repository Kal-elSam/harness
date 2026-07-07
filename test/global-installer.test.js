import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installGlobalHarness, uninstallGlobalHarness, updateGlobalHarness } from "../src/global/global-installer.js";
import { hasManagedSection } from "../src/global/managed-section.js";
import { readGlobalState } from "../src/global/state.js";
import { harnessHomePaths } from "../src/global/paths.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const baseOptions = { packageRoot, packageName: "@kal-elsam/kairo-runtime", cliVersion: "0.4.0" };

async function createFakeHome({ withCursorConfig = false } = {}) {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-home-"));
  await mkdir(join(homeDir, ".cursor"), { recursive: true });
  await mkdir(join(homeDir, ".codex"), { recursive: true });

  if (withCursorConfig) {
    await writeFile(join(homeDir, ".cursor", "AGENTS.md"), "# My cursor rules\n\nuser content\n");
  }

  return homeDir;
}

test("dry-run plans agents without writing anything", async () => {
  const homeDir = await createFakeHome();
  const paths = harnessHomePaths(homeDir);

  const result = await installGlobalHarness({ ...baseOptions, homeDir, dryRun: true });

  assert.deepEqual(result.agents, ["cursor", "codex"]);
  assert.ok(result.coreFiles.includes("components/orchestrator/orchestrator.md"));
  assert.ok(result.coreFiles.includes("components/sdd-core/workflow.md"));
  assert.equal(existsSync(paths.root), false);
  assert.equal(existsSync(join(homeDir, ".cursor", "AGENTS.md")), false);
});

test("install writes state, core files and managed configs under the home", async () => {
  const homeDir = await createFakeHome();
  const paths = harnessHomePaths(homeDir);

  const result = await installGlobalHarness({ ...baseOptions, homeDir });

  assert.ok(existsSync(paths.statePath));
  assert.ok(existsSync(join(paths.coreDir, "orchestrator.md")) === false);
  assert.ok(existsSync(join(paths.root, "components", "orchestrator", "orchestrator.md")));

  const state = await readGlobalState(paths.statePath);
  assert.equal(state.scope, "agent-global");
  assert.equal(state.cliVersion, "0.4.0");
  assert.deepEqual(state.agents.map((agent) => agent.id), ["cursor", "codex"]);
  assert.equal(state.adapters[0].label, "Cursor");
  assert.deepEqual(state.adapters[0].managedTargets, [".cursor/AGENTS.md"]);
  assert.match(state.coreFiles["components/orchestrator/orchestrator.md"], /^[0-9a-f]{64}$/);

  const cursorConfig = await readFile(join(homeDir, ".cursor", "AGENTS.md"), "utf8");
  assert.ok(hasManagedSection(cursorConfig));
  assert.deepEqual(result.configsCreated, [".cursor/AGENTS.md", ".codex/AGENTS.md"]);
});

test("preserves existing config content around managed markers", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });

  await installGlobalHarness({ ...baseOptions, homeDir });

  const content = await readFile(join(homeDir, ".cursor", "AGENTS.md"), "utf8");
  assert.ok(content.startsWith("# My cursor rules"));
  assert.ok(content.includes("user content"));
  assert.ok(hasManagedSection(content));
});

test("creates a backup before modifying an existing config", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);

  const result = await installGlobalHarness({ ...baseOptions, homeDir });

  assert.equal(result.backups.length, 1);
  const snapshots = await readdir(paths.backupsDir);
  assert.equal(snapshots.length, 1);

  const backupFiles = await readdir(join(paths.backupsDir, snapshots[0]));
  const backupContent = await readFile(join(paths.backupsDir, snapshots[0], backupFiles[0]), "utf8");
  assert.equal(backupContent, "# My cursor rules\n\nuser content\n");
});

test("reinstall is idempotent and does not duplicate managed sections", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });

  await installGlobalHarness({ ...baseOptions, homeDir });
  const result = await installGlobalHarness({ ...baseOptions, homeDir });

  assert.deepEqual(result.configsUnchanged, [".cursor/AGENTS.md", ".codex/AGENTS.md"]);

  const content = await readFile(join(homeDir, ".cursor", "AGENTS.md"), "utf8");
  assert.equal(content.match(/harness:managed:start/g).length, 1);
});

test("update requires an existing global state", async () => {
  const homeDir = await createFakeHome();

  await assert.rejects(
    updateGlobalHarness({ ...baseOptions, homeDir }),
    /Run "kairo install" first/
  );
});

test("update refreshes managed content for the installed agents", async () => {
  const homeDir = await createFakeHome();

  await installGlobalHarness({ ...baseOptions, homeDir });
  const result = await updateGlobalHarness({ ...baseOptions, homeDir, cliVersion: "0.5.0" });

  assert.deepEqual(result.agents, ["cursor", "codex"]);

  const state = await readGlobalState(harnessHomePaths(homeDir).statePath);
  assert.equal(state.cliVersion, "0.5.0");
});

test("uninstall removes managed sections and state but keeps backups and user content", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);

  await installGlobalHarness({ ...baseOptions, homeDir });
  const result = await uninstallGlobalHarness({ homeDir });

  assert.equal(result.stateRemoved, true);
  assert.ok(result.configsCleaned.includes(".cursor/AGENTS.md"));
  assert.equal(existsSync(paths.statePath), false);
  assert.equal(existsSync(paths.coreDir), false);
  assert.ok(existsSync(paths.backupsDir));

  const content = await readFile(join(homeDir, ".cursor", "AGENTS.md"), "utf8");
  assert.ok(!hasManagedSection(content));
  assert.ok(content.includes("user content"));
});

test("explicit agent selection installs only those agents", async () => {
  const homeDir = await createFakeHome();

  const result = await installGlobalHarness({ ...baseOptions, homeDir, agents: ["claude"] });

  assert.deepEqual(result.agents, ["claude"]);
  assert.ok(existsSync(join(homeDir, ".claude", "CLAUDE.md")));
  assert.equal(existsSync(join(homeDir, ".cursor", "AGENTS.md")), false);
});

test("rejects unknown agents", async () => {
  const homeDir = await createFakeHome();

  await assert.rejects(
    installGlobalHarness({ ...baseOptions, homeDir, agents: ["gemini"] }),
    /Unknown agent "gemini"/
  );
});
