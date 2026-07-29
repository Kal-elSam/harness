import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { harnessHomePaths } from "../../paths.js";
import { writeAtomicJson } from "../write-atomic-json.js";
import {
  ALERT_STATES,
  assertSafeAlertId,
  createAlert,
  createAlertFingerprint
} from "./alert-types.js";
import { assertAlertSecretFree } from "./alert-validate.js";

export class AlertStoreError extends Error {
  constructor(message, { code = "alert_store_error", details = null } = {}) {
    super(message);
    this.name = "AlertStoreError";
    this.code = code;
    this.details = details;
  }
}

export function alertPaths(homeDir, alertId) {
  assertSafeAlertId(alertId);
  const alertDir = join(harnessHomePaths(homeDir).alertsDir, alertId);
  return { alertDir, alertPath: join(alertDir, "alert.json") };
}

function openIndexPath(homeDir, fingerprint) {
  if (typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw new AlertStoreError(`Invalid alert fingerprint "${fingerprint}".`, {
      code: "invalid_fingerprint"
    });
  }
  return join(harnessHomePaths(homeDir).alertsDir, "open", fingerprint);
}

export async function loadAlert(alertId, { homeDir } = {}) {
  const { alertPath } = alertPaths(homeDir, alertId);
  if (!existsSync(alertPath)) throw new Error(`Alert not found: ${alertId}`);
  return assertAlertSecretFree(JSON.parse(await readFile(alertPath, "utf8")));
}

async function writeAlert(alert, { homeDir, createExclusive = false } = {}) {
  const sanitized = assertAlertSecretFree(alert);
  const { alertDir, alertPath } = alertPaths(homeDir, sanitized.alertId);
  await mkdir(alertDir, { recursive: true });
  await writeAtomicJson(alertPath, sanitized, { createExclusive });
  return sanitized;
}

/** Persist alert; exclusive open/<fingerprint> claim makes dedupe atomic. */
export async function saveAlert(input, { homeDir } = {}) {
  const draft = input?.version === 1 ? { ...input } : createAlert(input);
  draft.fingerprint = createAlertFingerprint(draft);
  const candidate = assertAlertSecretFree(draft);
  const indexPath = openIndexPath(homeDir, candidate.fingerprint);
  await mkdir(join(harnessHomePaths(homeDir).alertsDir, "open"), { recursive: true });
  try {
    await writeAtomicJson(indexPath, candidate, { createExclusive: true });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = assertAlertSecretFree(JSON.parse(await readFile(indexPath, "utf8")));
    return { alert: existing, deduped: true };
  }
  try {
    const alert = await writeAlert(candidate, { homeDir, createExclusive: true });
    return { alert, deduped: false };
  } catch (error) {
    await unlink(indexPath).catch(() => {});
    throw error;
  }
}

/**
 * List alerts. Fail-closed: any unreadable/corrupt record throws
 * instead of pretending the inbox is empty.
 */
export async function listAlerts({ homeDir, state = null, limit = null } = {}) {
  const dir = harnessHomePaths(homeDir).alertsDir;
  if (!existsSync(dir)) return [];
  const ids = (await readdir(dir)).filter((n) => /^alt-[a-f0-9]{16,32}$/.test(n));
  const alerts = [];
  for (const alertId of ids) {
    try {
      alerts.push(await loadAlert(alertId, { homeDir }));
    } catch (error) {
      throw new AlertStoreError(`Corrupt or unreadable alert "${alertId}".`, {
        code: "corrupt_alert",
        details: { alertId, cause: error instanceof Error ? error.message : String(error) }
      });
    }
  }
  alerts.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))
    || String(a.alertId).localeCompare(String(b.alertId)));
  const filtered = state ? alerts.filter((a) => a.state === state) : alerts;
  return Number.isInteger(limit) && limit >= 0 ? filtered.slice(0, limit) : filtered;
}

async function transitionAlert(alertId, nextState, { homeDir } = {}) {
  const current = await loadAlert(alertId, { homeDir });
  if (current.state !== ALERT_STATES.OPEN) return current;
  const now = new Date().toISOString();
  const updated = await writeAlert({
    ...current, state: nextState, updatedAt: now, resolvedAt: now
  }, { homeDir });
  const indexPath = openIndexPath(homeDir, current.fingerprint);
  if (existsSync(indexPath)) await unlink(indexPath);
  return updated;
}

export async function resolveAlert(alertId, { homeDir } = {}) {
  return transitionAlert(alertId, ALERT_STATES.RESOLVED, { homeDir });
}

export async function dismissAlert(alertId, { homeDir } = {}) {
  return transitionAlert(alertId, ALERT_STATES.DISMISSED, { homeDir });
}
