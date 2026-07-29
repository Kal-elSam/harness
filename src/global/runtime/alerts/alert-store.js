import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rmdir, stat, unlink, writeFile } from "node:fs/promises";
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

const LOCK_STALE_MS = 2000;
const LOCK_WAIT_MS = 5000;

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

function openLockPath(homeDir, fingerprint) {
  return join(harnessHomePaths(homeDir).alertsDir, "open", `.${fingerprint}.lock`);
}

function lockOwnerPath(lockDir) {
  return join(lockDir, "owner.json");
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function isLockStale(lockDir) {
  try {
    const owner = JSON.parse(await readFile(lockOwnerPath(lockDir), "utf8"));
    if (!owner || !Number.isFinite(owner.startedAt)) return true;
    if (Date.now() - owner.startedAt > LOCK_STALE_MS) return true;
    return !isPidAlive(owner.pid);
  } catch {
    try {
      const info = await stat(lockDir);
      return Date.now() - info.mtimeMs > LOCK_STALE_MS;
    } catch {
      return true;
    }
  }
}

async function removeLockDir(lockDir) {
  await unlink(lockOwnerPath(lockDir)).catch(() => {});
  await rmdir(lockDir).catch(() => {});
}

/** Cross-process mutex with owner lease — crashed owners are reclaimable. */
async function withOpenFingerprintLock(homeDir, fingerprint, fn) {
  const lockDir = openLockPath(homeDir, fingerprint);
  await mkdir(join(harnessHomePaths(homeDir).alertsDir, "open"), { recursive: true });
  const started = Date.now();
  for (;;) {
    try {
      await mkdir(lockDir);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (await isLockStale(lockDir)) {
        await removeLockDir(lockDir);
        continue;
      }
      if (Date.now() - started > LOCK_WAIT_MS) {
        throw new AlertStoreError("Timed out waiting for alert fingerprint lock.", {
          code: "claim_lock_timeout", details: { fingerprint }
        });
      }
      await new Promise((r) => setTimeout(r, 5 + Math.floor(Math.random() * 10)));
      continue;
    }
    try {
      await writeFile(lockOwnerPath(lockDir), `${JSON.stringify({
        pid: process.pid,
        startedAt: Date.now()
      })}\n`);
      break;
    } catch (error) {
      await removeLockDir(lockDir);
      if (error?.code === "ENOENT") continue;
      throw error;
    }
  }
  try { return await fn(); } finally { await removeLockDir(lockDir); }
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

/** Under lock: heal, accept open match, or drop stale claim. */
async function resolveExistingClaim(homeDir, indexPath, fingerprint) {
  let claim;
  try {
    claim = assertAlertSecretFree(JSON.parse(await readFile(indexPath, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  const { alertPath } = alertPaths(homeDir, claim.alertId);

  if (!existsSync(alertPath)) {
    try {
      return { alert: await writeAlert(claim, { homeDir, createExclusive: true }), deduped: true };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }

  try {
    const existing = await loadAlert(claim.alertId, { homeDir });
    if (existing.state === ALERT_STATES.OPEN && existing.fingerprint === fingerprint) {
      return { alert: existing, deduped: true };
    }
  } catch {
    // unreadable canonical — reclaim
  }

  await unlink(indexPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  return null;
}

/** Persist alert; fingerprint lock + exclusive claim make dedupe atomic. */
export async function saveAlert(input, { homeDir } = {}) {
  const draft = input?.version === 1 ? { ...input } : createAlert(input);
  draft.fingerprint = createAlertFingerprint(draft);
  const candidate = assertAlertSecretFree(draft);

  return withOpenFingerprintLock(homeDir, candidate.fingerprint, async () => {
    const indexPath = openIndexPath(homeDir, candidate.fingerprint);
    if (existsSync(indexPath)) {
      const resolved = await resolveExistingClaim(homeDir, indexPath, candidate.fingerprint);
      if (resolved) return resolved;
    }
    await writeAtomicJson(indexPath, candidate, { createExclusive: true });
    try {
      return { alert: await writeAlert(candidate, { homeDir, createExclusive: true }), deduped: false };
    } catch (error) {
      await unlink(indexPath).catch(() => {});
      throw error;
    }
  });
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
  return withOpenFingerprintLock(homeDir, current.fingerprint, async () => {
    const latest = await loadAlert(alertId, { homeDir });
    if (latest.state !== ALERT_STATES.OPEN) return latest;
    const now = new Date().toISOString();
    const updated = await writeAlert({
      ...latest, state: nextState, updatedAt: now, resolvedAt: now
    }, { homeDir });
    await unlink(openIndexPath(homeDir, latest.fingerprint)).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
    return updated;
  });
}

export async function resolveAlert(alertId, { homeDir } = {}) {
  return transitionAlert(alertId, ALERT_STATES.RESOLVED, { homeDir });
}

export async function dismissAlert(alertId, { homeDir } = {}) {
  return transitionAlert(alertId, ALERT_STATES.DISMISSED, { homeDir });
}
