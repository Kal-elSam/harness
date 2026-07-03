import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import {
  backupFileBeforeChange,
  backupTimestamp,
  listBackupSnapshots,
  resolveSnapshotDir
} from "./backups.js";
import { harnessHomePaths } from "./paths.js";

const BLOCKED_RELATIVE_PATHS = new Set([".harness/state.json"]);

export function backupNameToRelativePath(backupName) {
  return backupName.split("__").join("/");
}

export function resolveBackupTarget(backupName, homeDir) {
  if (!backupName || backupName.includes("..")) return null;

  const relativePath = backupNameToRelativePath(backupName);
  if (relativePath.includes("..")) return null;

  const normalizedRelative = relativePath.split("/").join(sep);
  if (BLOCKED_RELATIVE_PATHS.has(relativePath.replace(/\\/g, "/"))) return null;

  const targetPath = join(homeDir, normalizedRelative);
  const withinHome = relative(homeDir, targetPath);

  if (withinHome.startsWith("..") || withinHome === "") return null;

  return targetPath;
}

export function formatHomePath(homeDir, filePath) {
  const rel = relative(homeDir, filePath);
  return `~/${rel.split(sep).join("/")}`;
}

export async function listSnapshotFiles(snapshotDir) {
  if (!existsSync(snapshotDir)) return [];

  const entries = await readdir(snapshotDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

export async function describeBackupSnapshots(backupsDir) {
  const names = await listBackupSnapshots(backupsDir);
  const snapshots = [];

  for (const name of names) {
    const files = await listSnapshotFiles(join(backupsDir, name));
    snapshots.push({ name, fileCount: files.length });
  }

  return snapshots;
}

function buildRestorePlans(snapshotDir, homeDir) {
  return listSnapshotFiles(snapshotDir).then((files) =>
    files
      .map((backupName) => {
        const targetPath = resolveBackupTarget(backupName, homeDir);
        if (!targetPath) return null;

        return {
          backupName,
          targetPath,
          displayPath: formatHomePath(homeDir, targetPath),
          backupPath: join(snapshotDir, backupName)
        };
      })
      .filter(Boolean)
  );
}

export async function previewRollback({ homeDir, snapshot }) {
  const paths = harnessHomePaths(homeDir);
  const snapshotDir = resolveSnapshotDir(paths.backupsDir, snapshot);
  const plans = await buildRestorePlans(snapshotDir, homeDir);

  return {
    snapshot,
    plans,
    noop: plans.length === 0
  };
}

export async function applyRollback({ homeDir, snapshot }) {
  const paths = harnessHomePaths(homeDir);
  const snapshotDir = resolveSnapshotDir(paths.backupsDir, snapshot);
  const plans = await buildRestorePlans(snapshotDir, homeDir);

  if (plans.length === 0) {
    return { snapshot, restored: [], safetyBackup: null, noop: true };
  }

  const safetyTimestamp = backupTimestamp();
  let safetyBackup = null;

  for (const plan of plans) {
    if (existsSync(plan.targetPath)) {
      await backupFileBeforeChange({
        backupsDir: paths.backupsDir,
        homeDir,
        filePath: plan.targetPath,
        timestamp: safetyTimestamp
      });
      safetyBackup ??= safetyTimestamp;
    }

    await mkdir(dirname(plan.targetPath), { recursive: true });
    await copyFile(plan.backupPath, plan.targetPath);
  }

  return {
    snapshot,
    restored: plans.map((plan) => plan.displayPath),
    safetyBackup,
    noop: false
  };
}
