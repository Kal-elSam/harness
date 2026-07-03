import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installGlobalHarness } from "../src/global/global-installer.js";
import { harnessHomePaths } from "../src/global/paths.js";
import {
  applyRollback,
  backupNameToRelativePath,
  describeBackupSnapshots,
  listSnapshotFiles,
  previewRollback,
  resolveBackupTarget
} from "../src/global/rollback.js";
import { assertValidSnapshotName } from "../src/global/backups.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const baseOptions = { packageRoot, packageName: "@kal-elsam/harness", cliVersion: "0.4.0" };

async function createFakeHome({ withCursorConfig = false } = {}) {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-rollback-home-"));
  await mkdir(join(homeDir, ".cursor"), { recursive: true });
  await mkdir(join(homeDir, ".codex"), { recursive: true });

  if (withCursorConfig) {
    await writeFile(join(homeDir, ".cursor", "AGENTS.md"), "# Original cursor rules\n\nuser content\n");
  }

  return homeDir;
}

test("backup name maps back to a home path", () => {
  const homeDir = "/Users/me";
  assert.equal(backupNameToRelativePath(".cursor__AGENTS.md"), ".cursor/AGENTS.md");
  assert.equal(
    resolveBackupTarget(".cursor__AGENTS.md", homeDir),
    join(homeDir, ".cursor", "AGENTS.md")
  );
});

test("backup target rejects paths outside home and state.json", () => {
  const homeDir = "/Users/me";
  assert.equal(resolveBackupTarget("..__secret", homeDir), null);
  assert.equal(resolveBackupTarget(".harness__state.json", homeDir), null);
});

test("invalid snapshot name fails clearly", () => {
  assert.throws(() => assertValidSnapshotName("../escape"), /Invalid snapshot/);
  assert.throws(() => assertValidSnapshotName("snap/sub"), /Invalid snapshot/);
});

test("backups lists available snapshots with file counts", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);

  await installGlobalHarness({ ...baseOptions, homeDir });

  const snapshots = await describeBackupSnapshots(paths.backupsDir);

  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].fileCount, 1);
});

test("rollback preview writes nothing", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);

  await installGlobalHarness({ ...baseOptions, homeDir });
  const before = await readFile(join(homeDir, ".cursor", "AGENTS.md"), "utf8");

  const [snapshotName] = await readdir(paths.backupsDir);
  const preview = await previewRollback({ homeDir, snapshot: snapshotName });

  assert.equal(preview.plans.length, 1);
  assert.equal(preview.plans[0].displayPath, "~/.cursor/AGENTS.md");

  const after = await readFile(join(homeDir, ".cursor", "AGENTS.md"), "utf8");
  assert.equal(after, before);
});

test("rollback apply restores backed-up config content", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);

  await installGlobalHarness({ ...baseOptions, homeDir });

  const [snapshotName] = await readdir(paths.backupsDir);
  const snapshotDir = join(paths.backupsDir, snapshotName);
  const [backupFile] = await readdir(snapshotDir);
  const originalContent = await readFile(join(snapshotDir, backupFile), "utf8");

  await writeFile(join(homeDir, ".cursor", "AGENTS.md"), "# Changed content\n");

  const result = await applyRollback({ homeDir, snapshot: snapshotName });

  assert.equal(result.restored.length, 1);
  const restored = await readFile(join(homeDir, ".cursor", "AGENTS.md"), "utf8");
  assert.equal(restored, originalContent);
});

test("rollback apply creates a fresh safety backup first", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);

  await installGlobalHarness({ ...baseOptions, homeDir });

  const snapshotsBefore = await readdir(paths.backupsDir);
  assert.equal(snapshotsBefore.length, 1);

  const snapshotName = snapshotsBefore[0];
  await writeFile(join(homeDir, ".cursor", "AGENTS.md"), "# Changed before rollback\n");

  const result = await applyRollback({ homeDir, snapshot: snapshotName });

  assert.ok(result.safetyBackup);
  const snapshotsAfter = await readdir(paths.backupsDir);
  assert.equal(snapshotsAfter.length, 2);
  assert.ok(snapshotsAfter.includes(result.safetyBackup));

  const safetyFiles = await listSnapshotFiles(join(paths.backupsDir, result.safetyBackup));
  assert.equal(safetyFiles.length, 1);
  const safetyContent = await readFile(
    join(paths.backupsDir, result.safetyBackup, safetyFiles[0]),
    "utf8"
  );
  assert.equal(safetyContent, "# Changed before rollback\n");
});

test("invalid snapshot fails clearly", async () => {
  const homeDir = await createFakeHome();

  await assert.rejects(
    previewRollback({ homeDir, snapshot: "does-not-exist" }),
    /Snapshot not found/
  );
});

test("empty snapshot is a safe no-op", async () => {
  const homeDir = await createFakeHome();
  const paths = harnessHomePaths(homeDir);
  await mkdir(join(paths.backupsDir, "empty-snapshot"), { recursive: true });

  const preview = await previewRollback({ homeDir, snapshot: "empty-snapshot" });
  assert.equal(preview.noop, true);
  assert.deepEqual(preview.plans, []);

  const applied = await applyRollback({ homeDir, snapshot: "empty-snapshot" });
  assert.equal(applied.noop, true);
  assert.deepEqual(applied.restored, []);
  assert.equal(applied.safetyBackup, null);
});

test("rollback does not touch harness state.json even if present in snapshot", async () => {
  const homeDir = await createFakeHome();
  const paths = harnessHomePaths(homeDir);
  const snapshotName = "manual-snapshot";

  await mkdir(join(paths.backupsDir, snapshotName), { recursive: true });
  await mkdir(paths.root, { recursive: true });
  await writeFile(paths.statePath, '{"scope":"agent-global"}\n');
  await writeFile(
    join(paths.backupsDir, snapshotName, ".harness__state.json"),
    '{"scope":"tampered"}\n'
  );

  const preview = await previewRollback({ homeDir, snapshot: snapshotName });
  assert.equal(preview.plans.length, 0);

  await applyRollback({ homeDir, snapshot: snapshotName });
  const state = await readFile(paths.statePath, "utf8");
  assert.equal(state, '{"scope":"agent-global"}\n');
  assert.equal(existsSync(paths.statePath), true);
});
