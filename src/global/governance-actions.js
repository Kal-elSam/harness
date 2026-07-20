import { createHash } from "node:crypto";
import { buildChangesFromPlan } from "./diff.js";
import { buildCheckSnapshot, recordRollbackHistory, recordSyncHistory } from "./history.js";
import { harnessHomePaths } from "./paths.js";
import { applyRollback, previewRollback } from "./rollback.js";
import { buildStatusReport } from "./status.js";
import { runHarnessSync } from "./sync.js";
import { needsManagedRepair } from "./governance-repair.js";

function stableJson(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

export function fingerprintGovernancePreview(payload) {
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

function summarizeIntegrations(result) {
  const sdd = result?.integrations?.sdd ?? null;
  if (!sdd) return null;
  return {
    status: sdd.status ?? null,
    partial: Boolean(sdd.partial),
    conflicts: sdd.conflicts ?? [],
    receiptId: sdd.receipt?.id ?? null,
    sessionRefreshRequired: Boolean(result?.sessionRefreshRequired ?? sdd.sessionRefreshRequired)
  };
}

function buildSyncPreviewBody({ action, report, result }) {
  const changes = result ? buildChangesFromPlan(result) : [];
  const integrations = summarizeIntegrations(result);
  const hasIntegrationWork = Boolean(
    integrations
    && integrations.status
    && integrations.status !== "skipped"
    && integrations.status !== "noop"
  );
  return {
    kind: "sync",
    action,
    setupRequired: action === "setup-required",
    hasChanges: changes.length > 0 || hasIntegrationWork || needsManagedRepair(report),
    changes,
    integrations,
    checksBefore: buildCheckSnapshot(report?.counts),
    overall: report?.overall ?? null
  };
}

async function captureSyncPreview(options) {
  const outcome = await runHarnessSync({
    ...options,
    dryRun: true,
    yes: false,
    confirm: false,
    json: true,
    interactive: false,
    preflight: false
  });
  const body = buildSyncPreviewBody({
    action: outcome.action,
    report: outcome.report,
    result: outcome.result
  });
  const fingerprint = fingerprintGovernancePreview(body);
  return { ...body, fingerprint, wrote: false };
}

export async function previewGovernanceSync(options) {
  return captureSyncPreview(options);
}

export async function applyGovernanceSync({
  preview,
  packageRoot,
  packageName,
  cliVersion,
  homeDir,
  workspaceRoot = null
}) {
  if (!preview?.fingerprint) {
    return { ok: false, reason: "missing-preview", wrote: false, receipt: null };
  }

  const paths = harnessHomePaths(homeDir);
  const checksBefore = preview.checksBefore
    ?? buildCheckSnapshot((await buildStatusReport(homeDir, { packageRoot, workspaceRoot }))?.counts);

  const fresh = await captureSyncPreview({
    packageRoot, packageName, cliVersion, homeDir, workspaceRoot
  });

  if (fresh.setupRequired) {
    return { ok: false, reason: "setup-required", wrote: false, receipt: null, preview: fresh };
  }

  if (fresh.fingerprint !== preview.fingerprint) {
    return { ok: false, reason: "stale-preview", wrote: false, receipt: null, preview: fresh };
  }

  if (!fresh.hasChanges) {
    return {
      ok: true,
      reason: "noop",
      wrote: false,
      receipt: {
        action: "noop",
        backups: [],
        checksBefore,
        checksAfter: fresh.checksBefore,
        integrations: fresh.integrations
      }
    };
  }

  const outcome = await runHarnessSync({
    packageRoot,
    packageName,
    cliVersion,
    homeDir,
    workspaceRoot,
    dryRun: false,
    yes: true,
    confirm: false,
    json: true,
    interactive: false,
    preflight: false
  });

  await recordSyncHistory(homeDir, {
    cliVersion,
    options: { dryRun: false, yes: true, json: true, interactive: false, preflight: false },
    outcome,
    checksBefore,
    packageRoot,
    workspaceRoot
  });

  const afterReport = outcome.report
    ?? await buildStatusReport(homeDir, { packageRoot, workspaceRoot });
  const receipt = {
    action: outcome.action,
    backups: outcome.result?.backups ?? [],
    checksBefore,
    checksAfter: buildCheckSnapshot(afterReport?.counts),
    integrations: summarizeIntegrations(outcome.result),
    sessionRefreshRequired: Boolean(outcome.result?.sessionRefreshRequired),
    historyPath: paths.historyPath
  };

  return {
    ok: outcome.action === "repaired" || outcome.action === "noop",
    reason: outcome.action,
    wrote: Boolean(outcome.wrote),
    receipt,
    partial: Boolean(outcome.result?.integrations?.sdd?.partial)
  };
}

function buildRollbackPreviewBody(preview) {
  return {
    kind: "rollback",
    snapshot: preview.snapshot,
    noop: Boolean(preview.noop),
    files: (preview.plans ?? []).map((plan) => ({
      backupName: plan.backupName,
      displayPath: plan.displayPath
    }))
  };
}

export async function previewGovernanceRollback({ homeDir, snapshot }) {
  const raw = await previewRollback({ homeDir, snapshot });
  const body = buildRollbackPreviewBody(raw);
  return { ...body, fingerprint: fingerprintGovernancePreview(body), wrote: false };
}

export async function applyGovernanceRollback({
  preview,
  homeDir,
  cliVersion
}) {
  if (!preview?.fingerprint || !preview?.snapshot) {
    return { ok: false, reason: "missing-preview", wrote: false, receipt: null };
  }

  const fresh = await previewGovernanceRollback({ homeDir, snapshot: preview.snapshot });
  if (fresh.fingerprint !== preview.fingerprint) {
    return { ok: false, reason: "stale-preview", wrote: false, receipt: null, preview: fresh };
  }

  const result = await applyRollback({ homeDir, snapshot: preview.snapshot });
  await recordRollbackHistory(homeDir, { cliVersion, snapshot: preview.snapshot, result });

  const afterReport = await buildStatusReport(homeDir, {});
  return {
    ok: true,
    reason: result.noop ? "noop" : "applied",
    wrote: !result.noop,
    receipt: {
      action: result.noop ? "noop" : "rollback",
      snapshot: preview.snapshot,
      restored: result.restored ?? [],
      safetyBackup: result.safetyBackup ?? null,
      checksAfter: buildCheckSnapshot(afterReport?.counts)
    }
  };
}
