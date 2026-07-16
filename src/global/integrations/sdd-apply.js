import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { assertExplicitApplyConsent, promptApplyConfirmation, shouldPromptApplyConfirmation } from "../apply-confirmation.js";
import { hashBuffer } from "../../hash.js";
import { SDD_PLAN_ACTIONS } from "./sdd-evidence.js";
import { planSddConfigure } from "./sdd-plan.js";
import { resolveCanonicalSddSkillPath } from "./sdd-destinations.js";
import { saveSddReceipt } from "./sdd-receipts.js";
import { backupSddDestination } from "./sdd-rollback.js";

const APPLYING_ACTIONS = new Set([SDD_PLAN_ACTIONS.CREATE, SDD_PLAN_ACTIONS.UPDATE]);

export async function applySddConfigure({
  requestedAgentIds = null, detectedAgentIds = [], homeDir, packageRoot, persona = "off",
  trackedFiles = {}, dryRun = false, yes = false, json = false, interactive = null,
  receiptId = null, plan = planSddConfigure, confirm = promptApplyConfirmation,
  saveReceipt = saveSddReceipt, now = () => new Date().toISOString()
} = {}) {
  assertExplicitApplyConsent({
    applying: !dryRun, dryRun, json, yes, interactive, command: "components configure sdd-core"
  });

  const planned = await plan({
    requestedAgentIds, detectedAgentIds, homeDir, packageRoot, persona, trackedFiles, dryRun: true
  });
  if (dryRun) return { ...planned, applied: false, cancelled: false, receipt: null };

  if (shouldPromptApplyConfirmation({ applying: true, dryRun, json, confirm: yes, interactive })) {
    const accepted = await confirm({
      command: "components configure sdd-core",
      question: "Materialize SDD skills for the planned agents? [Y/n]: "
    });
    if (!accepted) return { ...planned, applied: false, cancelled: true, receipt: null };
  }

  const startedAt = now();
  const resolvedReceiptId = receiptId ?? `sdd-${startedAt.replace(/[:.]/g, "-")}`;
  const files = [];
  const backups = [];
  let failed = null;

  for (const action of planned.actions) {
    const record = buildFileRecord(action);
    if (!APPLYING_ACTIONS.has(action.action)) {
      files.push({ ...record, applied: false, skipped: true, afterHash: action.diskHash });
      continue;
    }
    try {
      const guard = await guardBeforeWrite(action);
      if (guard) {
        files.push({ ...record, action: SDD_PLAN_ACTIONS.CONFLICT, reason: guard, applied: false, skipped: true });
        continue;
      }
      if (action.action === SDD_PLAN_ACTIONS.UPDATE) {
        const backup = await backupSddDestination(action.destinationPath, {
          homeDir, receiptId: resolvedReceiptId
        });
        if (backup) backups.push(backup);
      }
      const bytes = await readFile(resolveCanonicalSddSkillPath(action.skillId, packageRoot));
      await mkdir(dirname(action.destinationPath), { recursive: true });
      await writeFile(action.destinationPath, bytes);
      files.push({ ...record, applied: true, skipped: false, afterHash: hashBuffer(bytes) });
    } catch (error) {
      failed = { skillId: action.skillId, destinationPath: action.destinationPath, error: error.message };
      files.push({ ...record, applied: false, skipped: false, error: error.message });
      break;
    }
  }

  const appliedCount = files.filter((entry) => entry.applied).length;
  const receipt = {
    id: resolvedReceiptId,
    provider: "sdd-core", componentId: "sdd-core", startedAt, finishedAt: now(),
    persona, personaActive: persona === "teaching", agentIds: planned.agentIds, files, backups,
    summary: planned.summary,
    conflicts: files
      .filter((entry) => entry.action === SDD_PLAN_ACTIONS.CONFLICT)
      .map((entry) => ({ destinationPath: entry.destinationPath, reason: entry.reason })),
    ok: failed == null, partial: failed != null && appliedCount > 0, failed,
    sessionRefreshRequired: appliedCount > 0, persisted: false
  };

  const saved = await saveReceipt(receipt, { homeDir });
  return {
    ...planned, dryRun: false, executes: true, writes: appliedCount > 0,
    applied: failed == null, cancelled: false,
    sessionRefreshRequired: receipt.sessionRefreshRequired,
    receipt: saved.receipt, receiptPath: saved.path
  };
}

function buildFileRecord(action) {
  return {
    skillId: action.skillId, destinationPath: action.destinationPath, agentIds: [...action.agentIds],
    action: action.action, reason: action.reason, canonicalHash: action.canonicalHash,
    beforeHash: action.diskHash, trackedHash: action.trackedHash
  };
}

/** Re-read disk before write; plan-time hashes alone cannot catch TOCTOU. */
async function guardBeforeWrite(action) {
  if (action.action === SDD_PLAN_ACTIONS.CREATE && existsSync(action.destinationPath)) {
    return "Destination appeared after planning; preserving byte-for-byte.";
  }
  if (action.action !== SDD_PLAN_ACTIONS.UPDATE) return null;
  if (!existsSync(action.destinationPath)) {
    return "Managed destination disappeared after planning; preserving byte-for-byte.";
  }
  if (hashBuffer(await readFile(action.destinationPath)) !== action.trackedHash) {
    return "Managed file changed after planning; preserving byte-for-byte.";
  }
  return null;
}
