import { existsSync } from "node:fs";
import { lstat, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { hashBuffer } from "../../hash.js";
import { isPathInside } from "../component-paths.js";
import { SDD_SKILL_IDS, resolveSddSkillPath } from "./sdd-destinations.js";

/** Recompute managed destination; refuse receipt-supplied path escapes. */
export function resolveExpectedSddDestination(file, homeDir) {
  if (!SDD_SKILL_IDS.includes(file?.skillId)) {
    return { ok: false, reason: `Unknown skillId "${file?.skillId}".` };
  }
  const agentId = file?.agentIds?.[0];
  if (!agentId) return { ok: false, reason: "Receipt file missing agentIds." };
  const expectedPath = resolve(resolveSddSkillPath(file.skillId, agentId, homeDir));
  const claimedPath = resolve(String(file.destinationPath ?? ""));
  if (claimedPath !== expectedPath) {
    return { ok: false, reason: "Receipt destinationPath does not match managed skill path." };
  }
  return { ok: true, path: expectedPath };
}

export function assertBackupPathContained(backupPath, backupDir) {
  const expectedDir = resolve(backupDir);
  const claimed = resolve(String(backupPath ?? ""));
  if (!isPathInside(expectedDir, claimed) && claimed !== expectedDir) {
    return { ok: false, reason: "Backup path escapes receipt backup directory." };
  }
  return { ok: true, path: claimed };
}

export async function refuseSymlink(path, label = "path") {
  if (!existsSync(path)) return null;
  const stats = await lstat(path);
  if (stats.isSymbolicLink()) {
    return `${label} is a symlink; refusing.`;
  }
  return null;
}

/** Read regular file bytes with symlink refusal and a post-read lstat check. */
export async function readRegularFile(path) {
  const symlink = await refuseSymlink(path, "Path");
  if (symlink) throw new Error(symlink);
  const before = await lstat(path);
  if (!before.isFile()) throw new Error("Path is not a regular file.");
  const bytes = await readFile(path);
  const after = await lstat(path);
  if (after.isSymbolicLink() || !after.isFile() || after.ino !== before.ino || after.size !== before.size) {
    throw new Error("File changed during read; refusing.");
  }
  return bytes;
}

export async function hashRegularFile(path) {
  return hashBuffer(await readRegularFile(path));
}

/** Replace destination via temp+rename so symlinks are not followed on write. */
export async function replaceRegularFile(destinationPath, bytes) {
  const symlink = await refuseSymlink(destinationPath, "Destination");
  if (symlink) throw new Error(symlink);
  const dir = dirname(destinationPath);
  const tempPath = join(dir, `.sdd-write-${process.pid}-${Date.now()}.tmp`);
  await writeFile(tempPath, bytes);
  try {
    await rename(tempPath, destinationPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

/** Unlink only after confirming regular file + matching hash on same inode snapshot. */
export async function deleteRegularFileIfHash(path, expectedHash) {
  const symlink = await refuseSymlink(path, "Path");
  if (symlink) return { ok: false, reason: symlink };
  const handle = await open(path, "r");
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) return { ok: false, reason: "Path is not a regular file." };
    const bytes = await handle.readFile();
    if (hashBuffer(bytes) !== expectedHash) {
      return { ok: true, skipped: true, reason: "Created file edited after apply; refusing delete." };
    }
    const again = await lstat(path);
    if (again.isSymbolicLink() || !again.isFile() || again.ino !== stats.ino) {
      return { ok: false, reason: "File changed before delete; refusing." };
    }
  } finally {
    await handle.close();
  }
  await rm(path, { force: true });
  return { ok: true, skipped: false };
}
