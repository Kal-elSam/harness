import { existsSync } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
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

export function alertPaths(homeDir, alertId) {
  assertSafeAlertId(alertId);
  const alertDir = join(harnessHomePaths(homeDir).alertsDir, alertId);
  return { alertDir, alertPath: join(alertDir, "alert.json") };
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

/** Persist alert; open same fingerprint returns existing (dedupe). */
export async function saveAlert(input, { homeDir } = {}) {
  const candidate = assertAlertSecretFree(
    input?.version === 1 ? input : createAlert(input)
  );
  const fingerprint = candidate.fingerprint || createAlertFingerprint(candidate);
  const existing = (await listAlerts({ homeDir, state: ALERT_STATES.OPEN }))
    .find((alert) => alert.fingerprint === fingerprint);
  if (existing) return { alert: existing, deduped: true };
  const alert = await writeAlert({ ...candidate, fingerprint }, {
    homeDir,
    createExclusive: true
  });
  return { alert, deduped: false };
}

export async function listAlerts({ homeDir, state = null, limit = null } = {}) {
  const dir = harnessHomePaths(homeDir).alertsDir;
  if (!existsSync(dir)) return [];
  const alerts = [];
  for (const alertId of (await readdir(dir)).filter((n) => /^alt-[a-f0-9]{16,32}$/.test(n))) {
    try { alerts.push(await loadAlert(alertId, { homeDir })); } catch { /* skip corrupt */ }
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
  return writeAlert({
    ...current, state: nextState, updatedAt: now, resolvedAt: now
  }, { homeDir });
}

export async function resolveAlert(alertId, { homeDir } = {}) {
  return transitionAlert(alertId, ALERT_STATES.RESOLVED, { homeDir });
}

export async function dismissAlert(alertId, { homeDir } = {}) {
  return transitionAlert(alertId, ALERT_STATES.DISMISSED, { homeDir });
}
