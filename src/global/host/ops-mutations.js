/**
 * U5b: Ops mutation adapters for the ratatui host.
 *
 * Reuses existing governance / runtime helpers — no new routers or stores.
 * Confirm gates live in the host UI; these helpers fail closed when inputs
 * are incomplete (missing fingerprint / runId / confirm).
 */

import {
  applyGovernanceRollback,
  applyGovernanceSync,
  previewGovernanceRollback,
  previewGovernanceSync
} from "../governance-actions.js";
import { isRunCancellable } from "../ink/orchestrator-state.js";
import { listAlerts } from "../runtime/alerts/alert-store.js";
import { controlledDismissAlert } from "../runtime/alerts/controlled-alert-actions.js";
import { stopRun } from "../runtime/run-manager.js";
import { buildRuntimeDashboardData } from "../runtime/run-cli.js";
import { listReviewReceipts } from "../runtime/review/review-receipts.js";
import { assertReceiptSecretFree } from "../runtime/review/review-validate.js";
import { resolveHomeDir } from "../paths.js";

function fail(reason, extra = {}) {
  return { ok: false, reason, wrote: false, receipt: null, ...extra };
}

/**
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function previewOpsSync({
  homeDir = resolveHomeDir(),
  workspaceRoot = null,
  packageName,
  packageRoot,
  cliVersion,
  previewSync = previewGovernanceSync
} = {}) {
  try {
    const preview = await previewSync({
      homeDir,
      workspaceRoot,
      packageName,
      packageRoot,
      cliVersion
    });
    return { ok: true, ...preview };
  } catch (error) {
    return fail("preview-failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * @param {object} options
 * @returns {Promise<object>}
 */
export async function applyOpsSync({
  preview,
  homeDir = resolveHomeDir(),
  workspaceRoot = null,
  packageName,
  packageRoot,
  cliVersion,
  applySync = applyGovernanceSync
} = {}) {
  if (!preview?.fingerprint) {
    return fail("missing-preview");
  }
  try {
    return await applySync({
      preview,
      homeDir,
      workspaceRoot,
      packageName,
      packageRoot,
      cliVersion
    });
  } catch (error) {
    return fail("apply-failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * @param {object} options
 * @returns {Promise<object>}
 */
export async function previewOpsRollback({
  homeDir = resolveHomeDir(),
  snapshot,
  previewRollback = previewGovernanceRollback
} = {}) {
  if (!snapshot || typeof snapshot !== "string") {
    return fail("missing-snapshot");
  }
  try {
    const preview = await previewRollback({ homeDir, snapshot });
    return { ok: true, ...preview };
  } catch (error) {
    return fail("preview-failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * @param {object} options
 * @returns {Promise<object>}
 */
export async function applyOpsRollback({
  preview,
  homeDir = resolveHomeDir(),
  cliVersion,
  applyRollback = applyGovernanceRollback
} = {}) {
  if (!preview?.fingerprint || !preview?.snapshot) {
    return fail("missing-preview");
  }
  try {
    return await applyRollback({ preview, homeDir, cliVersion });
  } catch (error) {
    return fail("apply-failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function normalizeRun(run) {
  if (!run || typeof run !== "object") return null;
  const runId = typeof run.runId === "string" ? run.runId : null;
  if (!runId) return null;
  return {
    runId,
    state: typeof run.state === "string" ? run.state : "unknown",
    agentId: typeof run.agentId === "string" ? run.agentId : null,
    task: typeof run.task === "string" ? run.task : null,
    cancellable: Boolean(isRunCancellable(run))
  };
}

/**
 * @param {object} [options]
 * @returns {Promise<{ ok: boolean, runs: object[], error: string|null }>}
 */
export async function listOpsRuns({
  homeDir = resolveHomeDir(),
  workspaceRoot = null,
  cliVersion,
  buildDashboard = buildRuntimeDashboardData
} = {}) {
  try {
    const dashboard = await buildDashboard({ homeDir, workspaceRoot, cliVersion });
    const active = Array.isArray(dashboard?.activeRuns) ? dashboard.activeRuns : [];
    const recent = Array.isArray(dashboard?.recentRuns) ? dashboard.recentRuns : [];
    const seen = new Set();
    const runs = [];
    for (const raw of [...active, ...recent]) {
      const run = normalizeRun(raw);
      if (!run || seen.has(run.runId)) continue;
      seen.add(run.runId);
      runs.push(run);
    }
    return { ok: true, runs, error: null };
  } catch (error) {
    return {
      ok: false,
      runs: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * @param {object} options
 * @returns {Promise<object>}
 */
export async function cancelOpsRun({
  homeDir = resolveHomeDir(),
  runId,
  stop = stopRun
} = {}) {
  if (!runId || typeof runId !== "string") {
    return fail("missing-runId", { runId: null });
  }
  try {
    const result = await stop(homeDir, runId);
    return {
      ok: true,
      reason: "cancelled",
      runId: result?.runId ?? runId,
      state: result?.state ?? "cancelled",
      wrote: false,
      receipt: null
    };
  } catch (error) {
    return fail("cancel-failed", {
      runId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * @param {object} [options]
 * @returns {Promise<{ ok: boolean, alerts: object[], error: string|null }>}
 */
export async function listOpsAlerts({
  homeDir = resolveHomeDir(),
  limit = 50,
  listAlerts: listAlertsImpl = listAlerts
} = {}) {
  try {
    const alerts = await listAlertsImpl({ homeDir, limit });
    return {
      ok: true,
      alerts: Array.isArray(alerts) ? alerts : [],
      error: null
    };
  } catch (error) {
    return {
      ok: false,
      alerts: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Host UI must confirm first; this still requires confirmed:true (cockpit source).
 *
 * @param {object} options
 * @returns {Promise<object>}
 */
export async function dismissOpsAlert({
  alertId,
  confirmed = false,
  homeDir = resolveHomeDir(),
  dismiss = controlledDismissAlert
} = {}) {
  if (!alertId || typeof alertId !== "string") {
    return fail("missing-alertId", { alert: null });
  }
  if (!confirmed) {
    return fail("confirm-required", { alert: null });
  }
  try {
    const result = await dismiss({
      alertId,
      confirmed: true,
      source: "cockpit",
      homeDir
    });
    if (!result?.ok) {
      return fail(result?.code ?? "dismiss-failed", {
        alert: result?.alert ?? null,
        error: result?.message ?? null
      });
    }
    return {
      ok: true,
      reason: "dismissed",
      alert: result.alert,
      wrote: true,
      receipt: null
    };
  } catch (error) {
    return fail("dismiss-failed", {
      alert: null,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Review receipts are read-only in U5b (already exposed via review-receipts).
 *
 * @param {object} [options]
 * @returns {Promise<{ ok: boolean, reviews: object[], error: string|null }>}
 */
export async function listOpsReviews({
  homeDir = resolveHomeDir(),
  limit = 20,
  listReviews = listReviewReceipts
} = {}) {
  try {
    const receipts = await listReviews({ homeDir, limit });
    const reviews = [];
    for (const receipt of Array.isArray(receipts) ? receipts : []) {
      try {
        reviews.push(assertReceiptSecretFree(receipt));
      } catch {
        // Soft projection when a stub/partial receipt is injected (tests / degrade).
        const reviewId = typeof receipt?.reviewId === "string" ? receipt.reviewId : null;
        if (!reviewId) continue;
        reviews.push({
          reviewId,
          state: typeof receipt.state === "string" ? receipt.state : "unknown",
          createdAt: typeof receipt.createdAt === "string" ? receipt.createdAt : null,
          findingsCount: Array.isArray(receipt.findings) ? receipt.findings.length : 0
        });
      }
    }
    return { ok: true, reviews, error: null };
  } catch (error) {
    return {
      ok: false,
      reviews: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
