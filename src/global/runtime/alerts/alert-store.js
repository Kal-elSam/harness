import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { harnessHomePaths } from "../../paths.js";
import { writeAtomicJson } from "../write-atomic-json.js";
import {
  ALERT_STATES,
  assertSafeAlertId,
  createAlert,
  createAlertFingerprint
} from "./alert-types.js";
import { assertAlertSecretFree } from "./alert-validate.js";

const TERMINAL_ALERT_STATES = new Set([ALERT_STATES.RESOLVED, ALERT_STATES.DISMISSED]);

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
  const expectedFingerprint = basename(indexPath);
  const alert = assertAlertSecretFree(JSON.parse(await readFile(indexPath, "utf8")));
  if (alert.fingerprint !== expectedFingerprint || alert.state !== ALERT_STATES.OPEN) {
    throw new AlertStoreError(`Corrupt open alert claim "${expectedFingerprint}".`, {
      code: "corrupt_alert",
      details: {
        fingerprint: expectedFingerprint,
        payloadFingerprint: alert.fingerprint,
        state: alert.state
      }
    });
  }
  return alert;
}

async function readHistoryAlert(homeDir, alertId) {
  const alert = assertAlertSecretFree(
    JSON.parse(await readFile(alertPaths(homeDir, alertId).alertPath, "utf8"))
  );
  if (alert.alertId !== alertId || !TERMINAL_ALERT_STATES.has(alert.state)) {
    throw new AlertStoreError(`Corrupt history alert "${alertId}".`, {
      code: "corrupt_alert",
      details: {
        alertId,
        payloadAlertId: alert.alertId,
        state: alert.state
      }
    });
  }
  return alert;
}

function wrapCorruptAlert(label, details, error) {
  if (error instanceof AlertStoreError) throw error;
  throw new AlertStoreError(`Corrupt or unreadable ${label}.`, {
    code: "corrupt_alert",
    details: {
      ...details,
      cause: error instanceof Error ? error.message : String(error)
    }
  });
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
      wrapCorruptAlert(`open alert "${name}"`, { fingerprint: name }, error);
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
  return readHistoryAlert(homeDir, alertId);
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

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await writeAtomicJson(indexPath, candidate, { createExclusive: true });
      return { alert: candidate, deduped: false };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        return { alert: await readOpenAlert(indexPath), deduped: true };
      } catch (readError) {
        if (readError?.code !== "ENOENT") throw readError;
        // Claim removed between EEXIST and read (resolve/dismiss race) — retry create.
      }
    }
  }

  throw new AlertStoreError("Unable to claim open alert fingerprint.", {
    code: "claim_failed",
    details: { fingerprint: candidate.fingerprint }
  });
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
      alerts.push(await readHistoryAlert(homeDir, alertId));
    } catch (error) {
      wrapCorruptAlert(`alert "${alertId}"`, { alertId }, error);
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
