import { existsSync } from "node:fs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import {
  assertExplicitApplyConsent,
  promptApplyConfirmation,
  shouldPromptApplyConfirmation
} from "../apply-confirmation.js";
import { resolveHomeDir } from "../paths.js";
import { applyEngramConfigure } from "./engram-apply.js";
import {
  backupObservedFiles,
  captureEngramObservedFiles,
  diffEngramObservedFiles,
  hashFileIfPresent,
  loadEngramReceipt,
  saveEngramReceipt
} from "./engram-receipts.js";

/** Snapshot+backup before setup, then persist a secret-free receipt. */
export async function applyEngramConfigureWithReceipt(options = {}) {
  const homeDir = options.homeDir ?? resolveHomeDir();
  const plannedAgents = options.requestedAgentIds ?? options.detectedAgentIds ?? [];
  const receiptId = options.receiptId ?? `engram-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const before = options.dryRun ? [] : await captureEngramObservedFiles(plannedAgents, { homeDir });
  const backups = options.dryRun ? [] : await backupObservedFiles(before, { homeDir, receiptId });

  const result = await applyEngramConfigure({ ...options, homeDir, receiptId });
  if (options.dryRun || result.cancelled || !result.receipt) return result;

  const after = await captureEngramObservedFiles(result.receipt.agentsRequested, { homeDir });
  const changes = diffEngramObservedFiles(before, after);
  const receipt = {
    ...result.receipt,
    observedBefore: before,
    observedAfter: after,
    changes,
    backups,
    providerOwnedResidue: changes.filter((c) => c.ownership === "provider")
  };
  const saved = await saveEngramReceipt(receipt, { homeDir });
  return { ...result, receipt: saved.receipt, receiptPath: saved.path };
}

export async function rollbackEngramReceipt({
  receiptId,
  homeDir,
  dryRun = false,
  yes = false,
  json = false,
  interactive = null,
  confirm = promptApplyConfirmation
} = {}) {
  assertExplicitApplyConsent({
    applying: !dryRun, dryRun, json, yes, interactive, command: "components rollback"
  });
  const receipt = await loadEngramReceipt(receiptId, { homeDir });
  if (receipt.touchedMemoryDb) {
    throw new Error("Receipt indicates memory DB access; refusing rollback.");
  }

  if (shouldPromptApplyConfirmation({ applying: true, dryRun, json, confirm: yes, interactive })) {
    const accepted = await confirm({
      command: `components rollback engram-memory --receipt ${receiptId}`,
      question: `Rollback Engram receipt ${receiptId}? [Y/n]: `
    });
    if (!accepted) return { dryRun, cancelled: true, receiptId, actions: [] };
  }

  const actions = [];
  for (const change of receipt.changes ?? []) {
    if (change.ownership === "provider") {
      actions.push({
        path: change.path,
        action: "residue",
        ok: true,
        reason: "Provider-owned plugin/marketplace artifact; not uninstalled automatically."
      });
      continue;
    }
    if (change.change === "modified") {
      actions.push(await restoreModified(change, receipt, { dryRun }));
      continue;
    }
    if (change.change === "created") {
      actions.push(await deleteCreated(change, { dryRun }));
    }
  }

  return {
    dryRun,
    cancelled: false,
    receiptId,
    ok: actions.every((a) => a.ok !== false),
    actions,
    touchedMemoryDb: false
  };
}

async function restoreModified(change, receipt, { dryRun }) {
  const currentHash = await hashFileIfPresent(change.path);
  if (currentHash !== change.afterHash) {
    return { path: change.path, action: "skip", ok: true, reason: "File changed after setup; refusing restore." };
  }
  const backup = (receipt.backups ?? []).find((entry) => entry.path === change.path);
  if (!backup?.backupPath || !existsSync(backup.backupPath)) {
    return { path: change.path, action: "skip", ok: false, reason: "Backup missing." };
  }
  if (!dryRun) {
    await mkdir(dirname(change.path), { recursive: true });
    await copyFile(backup.backupPath, change.path);
  }
  return { path: change.path, action: "restore", ok: true, backupPath: backup.backupPath };
}

async function deleteCreated(change, { dryRun }) {
  const currentHash = await hashFileIfPresent(change.path);
  if (currentHash == null) {
    return { path: change.path, action: "skip", ok: true, reason: "Already absent." };
  }
  if (currentHash !== change.afterHash) {
    return {
      path: change.path,
      action: "skip",
      ok: true,
      reason: "Created file was edited after setup; refusing delete."
    };
  }
  if (!dryRun) await rm(change.path, { force: true });
  return { path: change.path, action: "delete", ok: true };
}
