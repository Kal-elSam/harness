import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  assertExplicitApplyConsent,
  promptApplyConfirmation,
  shouldPromptApplyConfirmation
} from "../apply-confirmation.js";
import { hashBuffer } from "../../hash.js";
import { assertSafeSddReceiptId, loadSddReceipt, sddIntegrationsDir } from "./sdd-receipts.js";

export function sddReceiptBackupDir(homeDir, receiptId) {
  assertSafeSddReceiptId(receiptId);
  return join(sddIntegrationsDir(homeDir), "backups", receiptId);
}

export function sddBackupPathFor(homeDir, receiptId, destinationPath) {
  return join(sddReceiptBackupDir(homeDir, receiptId), Buffer.from(destinationPath).toString("base64url"));
}

export async function backupSddDestination(destinationPath, { homeDir, receiptId } = {}) {
  if (!existsSync(destinationPath)) return null;
  const backupPath = sddBackupPathFor(homeDir, receiptId, destinationPath);
  await mkdir(dirname(backupPath), { recursive: true });
  await copyFile(destinationPath, backupPath);
  return { path: destinationPath, backupPath, beforeHash: hashBuffer(await readFile(destinationPath)) };
}

/** Bounded rollback: delete/restore only when current hash still matches afterHash. */
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

  const backups = new Map((receipt.backups ?? []).map((entry) => [entry.path, entry]));
  const actions = [];

  for (const file of receipt.files ?? []) {
    if (!file.applied) continue;
    if (file.action === "create") {
      actions.push(await deleteCreated(file, { dryRun }));
      continue;
    }
    if (file.action === "update") {
      actions.push(await restoreUpdated(file, backups.get(file.destinationPath), { dryRun }));
    }
  }

  return {
    dryRun,
    cancelled: false,
    receiptId,
    ok: actions.every((entry) => entry.ok !== false),
    actions
  };
}

async function deleteCreated(file, { dryRun }) {
  if (!existsSync(file.destinationPath)) {
    return { path: file.destinationPath, action: "skip", ok: true, reason: "Already absent." };
  }
  const currentHash = hashBuffer(await readFile(file.destinationPath));
  if (currentHash !== file.afterHash) {
    return { path: file.destinationPath, action: "skip", ok: true, reason: "Created file edited after apply; refusing delete." };
  }
  if (!dryRun) await rm(file.destinationPath, { force: true });
  return { path: file.destinationPath, action: "delete", ok: true };
}

async function restoreUpdated(file, backup, { dryRun }) {
  if (!existsSync(file.destinationPath)) {
    return { path: file.destinationPath, action: "skip", ok: false, reason: "Updated destination missing." };
  }
  const currentHash = hashBuffer(await readFile(file.destinationPath));
  if (currentHash !== file.afterHash) {
    return { path: file.destinationPath, action: "skip", ok: true, reason: "File changed after apply; refusing restore." };
  }
  if (!backup?.backupPath || !existsSync(backup.backupPath)) {
    return { path: file.destinationPath, action: "skip", ok: false, reason: "Backup missing." };
  }
  if (!dryRun) {
    await mkdir(dirname(file.destinationPath), { recursive: true });
    await copyFile(backup.backupPath, file.destinationPath);
  }
  return { path: file.destinationPath, action: "restore", ok: true, backupPath: backup.backupPath };
}
