import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";

export function backupTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

export async function backupFileBeforeChange({ backupsDir, homeDir, filePath, timestamp, dryRun = false }) {
  if (!existsSync(filePath)) return null;

  const relativeName = relative(homeDir, filePath).split(sep).join("__");
  const backupName = relativeName.startsWith("..") ? basename(filePath) : relativeName;
  const backupPath = join(backupsDir, timestamp, backupName);

  if (!dryRun) {
    await mkdir(join(backupsDir, timestamp), { recursive: true });
    await copyFile(filePath, backupPath);
  }

  return backupPath;
}

export async function listBackupSnapshots(backupsDir) {
  if (!existsSync(backupsDir)) return [];

  const entries = await readdir(backupsDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}
