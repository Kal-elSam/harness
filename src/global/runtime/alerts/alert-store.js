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

function openDirPath(homeDir) {
  return join(harnessHomePaths(homeDir).alertsDir, "open");
}

async function readOpenAlert(indexPath) {
  return assertAlertSecretFree(JSON.parse(await readFile(indexPath, "utf8")));
}

async function listOpenAlerts(homeDir) {
  const dir = openDirPath(homeDir);
  if (!existsSync(dir)) return [];
  const alerts = [];
  for (const name of await readdir(dir)) {
    if (!/^[a-f0-9]{64}$/.test(name)) continue;
    try {
      alerts.push(await readOpenAlert(join(dir, name)));
    } catch (error) {
      throw new AlertStoreError(`Corrupt or unreadable open alert "${name}".`, {
        code: "corrupt_alert",
        details: { fingerprint: name, cause: error instanceof Error ? error.message : String(error) }
      });
    }
  }
  return alerts;
}

async function findOpenAlert(homeDir, alertId) {
  assertSafeAlertId(alertId);
  for (const alert of await listOpenAlerts(homeDir)) {
    if (alert.alertId === alertId) return alert;
  }
  return null;
}

export async function loadAlert(alertId, { homeDir } = {}) {
  const open = await findOpenAlert(homeDir, alertId);
  if (open) return open;
  const { alertPath } = alertPaths(homeDir, alertId);
  if (!existsSync(alertPath)) throw new Error(`Alert not found: ${alertId}`);
  return assertAlertSecretFree(JSON.parse(await readFile(alertPath, "utf8")));
}

async function writeHistoryAlert(alert, { homeDir } = {}) {
  const sanitized = assertAlertSecretFree(alert);
  const { alertDir, alertPath } = alertPaths(homeDir, sanitized.alertId);
  await mkdir(alertDir, { recursive: true });
  await writeAtomicJson(alertPath, sanitized);
  return sanitized;
}

/**
 * Persist an open alert. `open/<fingerprint>` is the authoritative open record
 * (exclusive create); no secondary mutex.
 */
export async function saveAlert(input, { homeDir } = {}) {
  const draft = input?.version === 1 ? { ...input } : createAlert(input);
  draft.fingerprint = createAlertFingerprint(draft);
  const candidate = assertAlertSecretFree(draft);
  const indexPath = openIndexPath(homeDir, candidate.fingerprint);
  await mkdir(openDirPath(homeDir), { recursive: true });
  try {
    await writeAtomicJson(indexPath, candidate, { createExclusive: true });
    return { alert: candidate, deduped: false };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    return { alert: await readOpenAlert(indexPath), deduped: true };
  }
}

/**
 * List alerts. Open records come from open/<fingerprint>;
 * terminal history comes from alt-<id>/alert.json.
 * Corrupt records fail closed.
 */
export async function listAlerts({ homeDir, state = null, limit = null } = {}) {
  const dir = harnessHomePaths(homeDir).alertsDir;
  if (!existsSync(dir)) return [];

  const open = await listOpenAlerts(homeDir);
  const openIds = new Set(open.map((alert) => alert.alertId));
  const alerts = [...open];

  for (const alertId of (await readdir(dir)).filter((n) => /^alt-[a-f0-9]{16,32}$/.test(n))) {
    if (openIds.has(alertId)) continue;
    try {
      const alert = assertAlertSecretFree(
        JSON.parse(await readFile(alertPaths(homeDir, alertId).alertPath, "utf8"))
      );
      if (alert.state === ALERT_STATES.OPEN) continue;
      alerts.push(alert);
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
  const updated = await writeHistoryAlert({
    ...current,
    state: nextState,
    updatedAt: now,
    resolvedAt: now
  }, { homeDir });
  const indexPath = openIndexPath(homeDir, current.fingerprint);
  await unlink(indexPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  return updated;
}

export async function resolveAlert(alertId, { homeDir } = {}) {
  return transitionAlert(alertId, ALERT_STATES.RESOLVED, { homeDir });
}

export async function dismissAlert(alertId, { homeDir } = {}) {
  return transitionAlert(alertId, ALERT_STATES.DISMISSED, { homeDir });
}
