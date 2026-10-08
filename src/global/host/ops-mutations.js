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
import { isRunCancellable } from "../operations/run-cancellable.js";
import { listAlerts } from "../runtime/alerts/alert-store.js";
import { controlledDismissAlert } from "../runtime/alerts/controlled-alert-actions.js";
import { stopRun } from "../runtime/run-manager.js";
import { buildRuntimeDashboardData } from "../runtime/run-cli.js";
import { listReviewReceipts, loadReviewReceipt } from "../runtime/review/review-receipts.js";
import { readRunEvents, readRunState } from "../runtime/run-store.js";
import { redactObject, redactString } from "../runtime/run-redact.js";
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

const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const SAFE_REVIEW_ID = /^rev-[a-f0-9]{16,32}$/;
const DEFAULT_EVENT_LIMIT = 50;
const MAX_SUMMARY_CHARS = 160;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isSafeRunId(runId) {
  return typeof runId === "string" && SAFE_RUN_ID.test(runId) && !runId.includes("..");
}

function truncate(text) {
  return text.length > MAX_SUMMARY_CHARS ? `${text.slice(0, MAX_SUMMARY_CHARS - 1)}…` : text;
}

/** Short one-line summary from an already-redacted event. */
function summarizeRunEvent(event) {
  const data = event?.data;
  if (data && typeof data === "object") {
    const tool = data.tool_name ?? data.name;
    if (typeof tool === "string" && tool) return truncate(tool);
    if (typeof data.line === "string") return truncate(data.line);
    if (typeof data.message === "string") return truncate(data.message);
  }
  return "";
}

function projectRunEvent(raw) {
  if (raw?.parseError) {
    return {
      parseError: true,
      line: Number.isFinite(raw.line) ? raw.line : 0,
      message: redactString(typeof raw.message === "string" ? raw.message : "parse error")
    };
  }
  const event = redactObject(raw);
  return {
    timestamp: typeof event?.timestamp === "string" ? event.timestamp : null,
    type: typeof event?.type === "string" ? event.type : "unknown",
    summary: summarizeRunEvent(event)
  };
}

function projectRunState(state) {
  const pick = (key) => (typeof state?.[key] === "string" ? state[key] : null);
  const num = (key) => (Number.isFinite(state?.[key]) ? state[key] : null);
  const safe = redactObject({
    tokenUsage: state?.tokenUsage ?? null,
    diffSummary: state?.diffSummary ?? null
  });
  return {
    runId: pick("runId"),
    agentId: pick("agentId"),
    provider: pick("provider"),
    model: pick("model"),
    state: pick("state") ?? "unknown",
    strategy: pick("strategy"),
    cwd: pick("cwd"),
    startedAt: pick("startedAt"),
    completedAt: pick("completedAt"),
    // Digest only: task text is never stored or returned.
    taskDigest: pick("taskDigest"),
    taskLength: num("taskLength"),
    error: state?.error == null ? null : redactString(String(state.error)),
    tokenUsage: safe.tokenUsage,
    diffSummary: safe.diffSummary
  };
}

/**
 * Read-only run detail: redacted state projection + bounded recent events.
 *
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function showOpsRun({
  homeDir = resolveHomeDir(),
  runId,
  eventLimit = DEFAULT_EVENT_LIMIT,
  readState = readRunState,
  readEvents = readRunEvents
} = {}) {
  if (!isSafeRunId(runId)) {
    return {
      ok: false,
      reason: "invalid_id",
      error: `Invalid run id "${typeof runId === "string" ? runId.slice(0, 64) : ""}".`
    };
  }
  try {
    const state = await readState(homeDir, runId);
    if (!state) {
      return { ok: false, reason: "not_found", error: `Run "${runId}" not found.` };
    }
    const limit = Number.isInteger(eventLimit) && eventLimit > 0 ? eventLimit : DEFAULT_EVENT_LIMIT;
    // Ask for one extra so truncation is detectable; the store keeps the tail.
    const raw = await readEvents(homeDir, runId, { limit: limit + 1 });
    const list = Array.isArray(raw) ? raw : [];
    const eventsTruncated = list.length > limit;
    const events = list.slice(-limit).map(projectRunEvent);
    return { ok: true, run: projectRunState(state), events, eventsTruncated };
  } catch (error) {
    return { ok: false, reason: "read_failed", error: errorMessage(error) };
  }
}

function projectFinding(finding) {
  const str = (key) => (typeof finding?.[key] === "string" ? finding[key] : null);
  return {
    id: str("id"),
    severity: str("severity") ?? "unknown",
    title: str("title") ?? "",
    path: str("path"),
    line: Number.isFinite(finding?.line) ? finding.line : null,
    problem: str("problem"),
    recommendation: str("recommendation")
  };
}

/**
 * Read-only review receipt detail. Allowlisted fields only: never invents
 * approval or authority.
 *
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function showOpsReview({
  homeDir = resolveHomeDir(),
  receiptId,
  loadReceipt = loadReviewReceipt
} = {}) {
  if (typeof receiptId !== "string" || !SAFE_REVIEW_ID.test(receiptId)) {
    return {
      ok: false,
      reason: "invalid_id",
      error: `Invalid review id "${typeof receiptId === "string" ? receiptId.slice(0, 64) : ""}".`
    };
  }
  try {
    const receipt = await loadReceipt(receiptId, { homeDir });
    const snapshot = receipt?.snapshot ?? {};
    const review = {
      reviewId: receipt?.reviewId ?? receiptId,
      agentId: typeof receipt?.agentId === "string" ? receipt.agentId : null,
      model: typeof receipt?.model === "string" ? receipt.model : null,
      state: typeof receipt?.state === "string" ? receipt.state : "unknown",
      createdAt: typeof receipt?.createdAt === "string" ? receipt.createdAt : null,
      cliVersion: typeof receipt?.cliVersion === "string" ? receipt.cliVersion : null,
      snapshot: {
        mode: typeof snapshot.mode === "string" ? snapshot.mode : null,
        headSha: typeof snapshot.headSha === "string" ? snapshot.headSha : null,
        fileCount: Array.isArray(snapshot.files) ? snapshot.files.length : 0,
        totals: snapshot.totals ?? null
      },
      findings: Array.isArray(receipt?.findings) ? receipt.findings.map(projectFinding) : [],
      warnings: Array.isArray(receipt?.warnings)
        ? receipt.warnings.filter((w) => typeof w === "string")
        : [],
      usage: receipt?.usage ?? null,
      timings: receipt?.timings ?? null,
      readOnly: true
    };
    return { ok: true, review };
  } catch (error) {
    const message = errorMessage(error);
    const reason = /not found/i.test(message) ? "not_found" : "read_failed";
    return { ok: false, reason, error: message };
  }
}
