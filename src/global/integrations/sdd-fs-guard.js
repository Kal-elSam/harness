import { randomBytes } from "node:crypto";
import { constants as fsConstants, existsSync } from "node:fs";
import { link, lstat, open, realpath, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { hashBuffer } from "../../hash.js";
import { isPathInside } from "../component-paths.js";
import { SDD_SKILL_IDS, resolveSddSkillRoot } from "./sdd-destinations.js";

/** Threat model: local CLI accidental TOCTOU/symlinks — not a malicious same-uid peer. */
const PLATFORM_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;
export let openNoFollowFlag = PLATFORM_NOFOLLOW;
let beforeFinalGateForTests = null, afterTombRenameForTests = null;
export function setOpenNoFollowFlagForTests(flag) { openNoFollowFlag = flag; }
export function setBeforeFinalGateForTests(fn) { beforeFinalGateForTests = fn; }
export function setAfterTombRenameForTests(fn) { afterTombRenameForTests = fn; }
export function resetOpenNoFollowFlagForTests() {
  openNoFollowFlag = PLATFORM_NOFOLLOW; beforeFinalGateForTests = null; afterTombRenameForTests = null;
}
export function resolveExpectedSddDestination(file, homeDir) {
  if (!SDD_SKILL_IDS.includes(file?.skillId)) {
    return { ok: false, reason: `Unknown skillId "${file?.skillId}".` };
  }
  const agentId = file?.agentIds?.[0];
  if (!agentId) return { ok: false, reason: "Receipt file missing agentIds." };
  const relativePath = String(file?.relativePath ?? "SKILL.md");
  const parts = relativePath.split(/[/\\]/).filter(Boolean);
  if (parts.length === 0 || parts.includes("..")) {
    return { ok: false, reason: "Receipt relativePath is invalid." };
  }
  const managedRoot = resolve(resolveSddSkillRoot(agentId, homeDir));
  const expectedPath = resolve(join(managedRoot, file.skillId, ...parts));
  const claimedPath = resolve(String(file.destinationPath ?? ""));
  if (claimedPath !== expectedPath) {
    return { ok: false, reason: "Receipt destinationPath does not match managed skill path." };
  }
  return { ok: true, path: expectedPath, managedRoot };
}
export function assertBackupPathContained(backupPath, backupDir) {
  const expectedDir = resolve(backupDir);
  const claimed = resolve(String(backupPath ?? ""));
  if (!isPathInside(expectedDir, claimed) && claimed !== expectedDir) {
    return { ok: false, reason: "Backup path escapes receipt backup directory." };
  }
  return { ok: true, path: claimed };
}
export async function assertSafePathChain(targetPath, managedRoot, trustedAnchor = null) {
  const root = resolve(managedRoot);
  const target = resolve(targetPath);
  const anchor = resolve(trustedAnchor ?? root);
  if (!isPathInside(root, target) && target !== root) {
    return { ok: false, reason: "Path escapes managed root." };
  }
  for (let current = target; ; current = dirname(current)) {
    if (existsSync(current) && (await lstat(current)).isSymbolicLink()) {
      return { ok: false, reason: current === root ? "Managed root is a symlink; refusing." : `Symlink in path chain at ${current}; refusing.` };
    }
    if (current === anchor) break;
    if (dirname(current) === current) return { ok: false, reason: "Path chain never reached trusted anchor." };
  }
  return { ok: true, path: target, managedRoot: root };
}
export async function parentRealpath(path) {
  const parent = dirname(resolve(path));
  return existsSync(parent) ? realpath(parent) : resolve(parent);
}
export async function refuseSymlink(path, label = "path") {
  if (!existsSync(path)) return null;
  if ((await lstat(path)).isSymbolicLink()) return `${label} is a symlink; refusing.`;
  return null;
}
async function assertMutableTarget(path, { managedRoot = null, expectedParentRealpath = null, trustedAnchor = null } = {}) {
  if (managedRoot) { const c = await assertSafePathChain(path, managedRoot, trustedAnchor); if (!c.ok) throw new Error(c.reason); }
  if (expectedParentRealpath != null && (await parentRealpath(path)) !== expectedParentRealpath) {
    throw new Error("Parent realpath changed before write; refusing.");
  }
}
export async function openNoFollow(path, flags) {
  let beforeIno = null;
  if (existsSync(path)) {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) throw new Error("Path is a symlink; refusing.");
    beforeIno = stats.ino;
  }
  const handle = await open(path, flags | openNoFollowFlag);
  try {
    const after = await lstat(path);
    if (after.isSymbolicLink()) throw new Error("Path became a symlink during open; refusing.");
    if (beforeIno != null && (after.ino !== beforeIno || (await handle.stat()).ino !== beforeIno)) {
      throw new Error("Path changed during open; refusing.");
    }
  } catch (error) { await handle.close(); throw error; }
  return handle;
}
export async function snapshotRegularFile(path) {
  const handle = await openNoFollow(path, fsConstants.O_RDONLY);
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new Error("Path is not a regular file.");
    const bytes = await handle.readFile();
    const again = await handle.stat();
    if (!again.isFile() || again.ino !== stats.ino || again.size !== stats.size) {
      throw new Error("File changed during read; refusing.");
    }
    return { bytes, hash: hashBuffer(bytes), ino: stats.ino, size: stats.size };
  } finally {
    await handle.close();
  }
}
export async function readRegularFile(path) {
  return (await snapshotRegularFile(path)).bytes;
}
export async function hashRegularFile(path) {
  return (await snapshotRegularFile(path)).hash;
}
export async function replaceRegularFile(destinationPath, bytes, {
  expectedIno = null, expectedHash = null, createExclusive = false,
  managedRoot = null, expectedParentRealpath = null, trustedAnchor = null
} = {}) {
  const symlink = await refuseSymlink(destinationPath, "Destination");
  if (symlink) throw new Error(symlink);
  const tempPath = join(dirname(destinationPath), `.sdd-write-${randomBytes(16).toString("hex")}.tmp`);
  const handle = await open(tempPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
  const gate = { managedRoot, expectedParentRealpath, trustedAnchor };
  try {
    if (createExclusive) {
      await assertMutableTarget(destinationPath, gate);
      if (existsSync(destinationPath)) throw new Error("Destination appeared before create; refusing overwrite.");
      await link(tempPath, destinationPath);
      await rm(tempPath, { force: true });
      return;
    }
    if (expectedIno != null || expectedHash != null) {
      const current = await snapshotRegularFile(destinationPath);
      if (expectedIno != null && current.ino !== expectedIno) throw new Error("Destination inode changed before write; refusing.");
      if (expectedHash != null && current.hash !== expectedHash) throw new Error("Destination hash changed before write; refusing.");
    }
    if (beforeFinalGateForTests) await beforeFinalGateForTests(destinationPath);
    await assertMutableTarget(destinationPath, gate);
    await rename(tempPath, destinationPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}
async function restoreTombExclusive(path, tomb) {
  try { await link(tomb, path); await rm(tomb, { force: true }); return { restored: true }; }
  catch (error) { return { restored: false, tombPath: tomb, reason: error.message }; }
}
export async function deleteRegularFileIfHash(path, expectedHash, {
  managedRoot = null, expectedParentRealpath = null, trustedAnchor = null
} = {}) {
  const symlink = await refuseSymlink(path, "Path");
  if (symlink) return { ok: false, reason: symlink };
  let snap;
  try { snap = await snapshotRegularFile(path); }
  catch (error) { return { ok: false, reason: error.message }; }
  if (snap.hash !== expectedHash) {
    return { ok: true, skipped: true, reason: "Created file edited after apply; refusing delete." };
  }
  const tomb = join(dirname(path), `.sdd-del-${randomBytes(16).toString("hex")}.tmp`);
  try {
    await assertMutableTarget(path, { managedRoot, expectedParentRealpath, trustedAnchor });
    await rename(path, tomb);
    if (afterTombRenameForTests) await afterTombRenameForTests(path, tomb);
  } catch (error) { return { ok: false, reason: error.message }; }
  try {
    const moved = await snapshotRegularFile(tomb);
    if (moved.ino !== snap.ino || moved.hash !== expectedHash) {
      const recovery = await restoreTombExclusive(path, tomb);
      return { ok: false, tombPath: recovery.restored ? null : recovery.tombPath,
        reason: recovery.restored ? "File swapped before delete; refusing."
          : `File swapped before delete; tomb retained at ${recovery.tombPath}` };
    }
    await rm(tomb, { force: true });
    return { ok: true, skipped: false };
  } catch (error) {
    const recovery = await restoreTombExclusive(path, tomb);
    return { ok: false, tombPath: recovery.restored ? null : recovery.tombPath,
      reason: recovery.restored ? error.message : `${error.message}; tomb retained at ${recovery.tombPath}` };
  }
}
