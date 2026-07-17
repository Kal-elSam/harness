import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  assertExplicitApplyConsent,
  promptApplyConfirmation,
  shouldPromptApplyConfirmation
} from "../apply-confirmation.js";
import {
  assertBackupPathContained,
  assertSafePathChain,
  deleteRegularFileIfHash,
  hashRegularFile,
  parentRealpath,
  refuseSymlink,
  replaceRegularFile,
  resolveExpectedSddDestination,
  snapshotRegularFile
} from "./sdd-fs-guard.js";
import { assertSafeSddReceiptId, loadSddReceipt, sddIntegrationsDir } from "./sdd-receipts.js";

export function sddReceiptBackupDir(homeDir, receiptId) {
  assertSafeSddReceiptId(receiptId);
  return join(sddIntegrationsDir(homeDir), "backups", receiptId);
}

export function sddBackupPathFor(homeDir, receiptId, destinationPath) {
  return join(sddReceiptBackupDir(homeDir, receiptId), Buffer.from(destinationPath).toString("base64url"));
}

export async function backupSddDestination(destinationPath, {
  homeDir, receiptId, managedRoot = null, snapshot = null, parentRealpath: knownParent = null
} = {}) {
  if (!existsSync(destinationPath) && !snapshot) return null;
  if (managedRoot) {
    const chain = await assertSafePathChain(destinationPath, managedRoot, homeDir);
    if (!chain.ok) throw new Error(chain.reason);
  }
  const snap = snapshot ?? await snapshotRegularFile(destinationPath);
  const backupDir = sddReceiptBackupDir(homeDir, receiptId);
  await mkdir(backupDir, { recursive: true });
  const backupPath = sddBackupPathFor(homeDir, receiptId, destinationPath);
  const chain = await assertSafePathChain(backupPath, backupDir, homeDir);
  if (!chain.ok) throw new Error(chain.reason);
  const planted = await refuseSymlink(backupPath, "Backup");
  if (planted) throw new Error(planted);
  if (existsSync(backupPath)) throw new Error("Backup already exists; refusing overwrite.");
  await replaceRegularFile(backupPath, snap.bytes, { createExclusive: true, managedRoot: backupDir, expectedParentRealpath: await parentRealpath(backupPath), trustedAnchor: homeDir });
  return {
    path: destinationPath, backupPath, beforeHash: snap.hash, ino: snap.ino,
    parentRealpath: knownParent ?? await parentRealpath(destinationPath)
  };
}

/** Bounded rollback: require complete evidence, then delete/restore only when afterHash matches. */
export async function rollbackSddReceipt({
  receiptId,
  homeDir,
  dryRun = false,
  yes = false,
  json = false,
  interactive = null,
  confirm = promptApplyConfirmation
} = {}) {
  assertExplicitApplyConsent({
    applying: !dryRun, dryRun, json, yes, interactive, command: "components rollback sdd-core"
  });
  const receipt = await loadSddReceipt(receiptId, { homeDir });

  if (shouldPromptApplyConfirmation({ applying: true, dryRun, json, confirm: yes, interactive })) {
    const accepted = await confirm({
      command: `components rollback sdd-core --receipt ${receiptId}`,
      question: `Rollback SDD receipt ${receiptId}? [Y/n]: `
    });
    if (!accepted) return { dryRun, cancelled: true, receiptId, actions: [] };
  }

  const evidence = await assessRollbackEvidence(receipt, { homeDir, receiptId });
  if (!evidence.complete) {
    return {
      dryRun,
      cancelled: false,
      receiptId,
      ok: false,
      blocked: true,
      reason: "Incomplete or unsafe rollback evidence; refusing all mutations.",
      actions: evidence.actions
    };
  }

  const actions = [];
  for (const step of evidence.steps) {
    if (step.action === "delete") {
      actions.push(await executeDelete(step, { dryRun, homeDir }));
      continue;
    }
    if (step.action === "restore") {
      actions.push(await executeRestore(step, { dryRun, homeDir }));
    }
  }

  return {
    dryRun,
    cancelled: false,
    receiptId,
    blocked: false,
    ok: actions.every((entry) => entry.ok !== false),
    actions
  };
}

async function assessRollbackEvidence(receipt, { homeDir, receiptId }) {
  const backups = new Map((receipt.backups ?? []).map((entry) => [entry.path, entry]));
  const actions = [];
  const steps = [];

  for (const file of receipt.files ?? []) {
    if (!file.applied) continue;
    const expected = resolveExpectedSddDestination(file, homeDir);
    if (!expected.ok) {
      actions.push({ path: file.destinationPath, action: "block", ok: false, reason: expected.reason });
      continue;
    }
    if (!file.afterHash) {
      actions.push({ path: expected.path, action: "block", ok: false, reason: "Missing afterHash evidence." });
      continue;
    }
    const chain = await assertSafePathChain(expected.path, expected.managedRoot, homeDir);
    if (!chain.ok) {
      actions.push({ path: expected.path, action: "block", ok: false, reason: chain.reason });
      continue;
    }
    const backup = backups.get(file.destinationPath) ?? backups.get(expected.path);
    const expectedParent = file.parentRealpath ?? backup?.parentRealpath ?? null;
    if (!expectedParent) {
      actions.push({
        path: expected.path, action: "block", ok: false,
        reason: "Missing parentRealpath evidence from apply."
      });
      continue;
    }
    if ((await parentRealpath(expected.path)) !== expectedParent) {
      actions.push({
        path: expected.path, action: "block", ok: false,
        reason: "Parent realpath changed since apply; refusing."
      });
      continue;
    }

    if (file.action === "create") {
      steps.push({
        action: "delete", path: expected.path, afterHash: file.afterHash,
        managedRoot: expected.managedRoot, expectedParentRealpath: expectedParent
      });
      continue;
    }

    if (file.action === "update") {
      const backupCheck = await validateUpdateBackup(file, backup, {
        homeDir, receiptId, expectedPath: expected.path
      });
      if (!backupCheck.ok) {
        actions.push({ path: expected.path, action: "block", ok: false, reason: backupCheck.reason });
        continue;
      }
      steps.push({
        action: "restore",
        path: expected.path,
        afterHash: file.afterHash,
        beforeHash: backupCheck.beforeHash,
        backupPath: backupCheck.backupPath,
        managedRoot: expected.managedRoot,
        expectedParentRealpath: expectedParent
      });
    }
  }

  return { complete: actions.length === 0, actions, steps };
}

async function validateUpdateBackup(file, backup, { homeDir, receiptId, expectedPath }) {
  if (!backup?.backupPath) return { ok: false, reason: "Backup missing." };
  const contained = assertBackupPathContained(backup.backupPath, sddReceiptBackupDir(homeDir, receiptId));
  if (!contained.ok) return contained;
  const expectedBackup = sddBackupPathFor(homeDir, receiptId, expectedPath);
  if (contained.path !== expectedBackup) {
    return { ok: false, reason: "Backup path does not match receipt destination encoding." };
  }
  const beforeHash = backup.beforeHash ?? file.beforeHash;
  if (!beforeHash) return { ok: false, reason: "Missing beforeHash evidence for backup." };
  if (!existsSync(contained.path)) return { ok: false, reason: "Backup missing." };
  try {
    const backupHash = await hashRegularFile(contained.path);
    if (backupHash !== beforeHash) {
      return { ok: false, reason: "Backup hash does not match beforeHash." };
    }
  } catch (error) {
    return { ok: false, reason: error.message };
  }
  return { ok: true, backupPath: contained.path, beforeHash };
}

async function executeDelete(step, { dryRun, homeDir }) {
  if (!existsSync(step.path)) {
    return { path: step.path, action: "skip", ok: true, reason: "Already absent." };
  }
  if (dryRun) return { path: step.path, action: "delete", ok: true, dryRun: true };
  try {
    const result = await deleteRegularFileIfHash(step.path, step.afterHash, {
      managedRoot: step.managedRoot, expectedParentRealpath: step.expectedParentRealpath, trustedAnchor: homeDir
    });
    if (result.skipped) return { path: step.path, action: "skip", ok: true, reason: result.reason };
    if (!result.ok) return { path: step.path, action: "skip", ok: false, reason: result.reason };
    return { path: step.path, action: "delete", ok: true };
  } catch (error) {
    return { path: step.path, action: "skip", ok: false, reason: error.message };
  }
}

async function executeRestore(step, { dryRun, homeDir }) {
  if (!existsSync(step.path)) {
    return { path: step.path, action: "skip", ok: false, reason: "Updated destination missing." };
  }
  try {
    const chain = await assertSafePathChain(step.path, step.managedRoot, homeDir);
    if (!chain.ok) return { path: step.path, action: "skip", ok: false, reason: chain.reason };
    if ((await parentRealpath(step.path)) !== step.expectedParentRealpath) {
      return { path: step.path, action: "skip", ok: false, reason: "Parent realpath changed before restore; refusing." };
    }
    const destination = await snapshotRegularFile(step.path);
    if (destination.hash !== step.afterHash) {
      return { path: step.path, action: "skip", ok: true, reason: "File changed after apply; refusing restore." };
    }
    if (!existsSync(step.backupPath)) {
      return { path: step.path, action: "skip", ok: false, reason: "Backup missing." };
    }
    const backup = await snapshotRegularFile(step.backupPath);
    if (backup.hash !== step.beforeHash) {
      return { path: step.path, action: "skip", ok: false, reason: "Backup hash does not match beforeHash." };
    }
    if (dryRun) {
      return { path: step.path, action: "restore", ok: true, dryRun: true, backupPath: step.backupPath };
    }
    await replaceRegularFile(step.path, backup.bytes, { expectedIno: destination.ino, expectedHash: destination.hash, managedRoot: step.managedRoot, expectedParentRealpath: step.expectedParentRealpath, trustedAnchor: homeDir });
    return { path: step.path, action: "restore", ok: true, backupPath: step.backupPath };
  } catch (error) {
    return { path: step.path, action: "skip", ok: false, reason: error.message };
  }
}
