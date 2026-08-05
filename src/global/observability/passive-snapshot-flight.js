import { buildObservabilitySnapshot } from "./build-observability-snapshot.js";
import { listObservabilityProbes } from "./probe-registry.js";

/** Short TTL for passive Cockpit/MCP observability only — never suite authority. */
export const PASSIVE_SNAPSHOT_TTL_MS = 5_000;
export const PASSIVE_SNAPSHOT_MAX_ENTRIES = 8;

/** @type {Map<string, { promise?: Promise<unknown>, value?: unknown, expiresAt?: number }>} */
const entries = new Map();

export function resetPassiveSnapshotFlightForTests() {
  entries.clear();
}

export function passiveSnapshotFlightSizeForTests() {
  return entries.size;
}

export function buildPassiveSnapshotKey(context = {}, {
  listProviders = listObservabilityProbes
} = {}) {
  const workspace = String(context.workspaceRoot ?? context.cwd ?? "");
  const head = String(context.headSha ?? "");
  const providers = listProviders().map((p) => p.id).sort().join(",");
  return `${workspace}\0${head}\0${providers}`;
}

function touch(key, entry) {
  entries.delete(key);
  entries.set(key, entry);
}

function evictOldest(maxEntries) {
  while (entries.size > maxEntries) {
    const oldest = entries.keys().next().value;
    if (oldest == null) break;
    entries.delete(oldest);
  }
}

/**
 * Single-flight + short TTL for passive observability snapshots.
 * force skips completed hits but joins identical in-flight work.
 * Errors delete the entry so the next call retries.
 */
export async function runPassiveObservabilitySnapshot(context = {}, {
  force = false,
  build = buildObservabilitySnapshot,
  now = Date.now,
  listProviders = listObservabilityProbes,
  ttlMs = PASSIVE_SNAPSHOT_TTL_MS,
  maxEntries = PASSIVE_SNAPSHOT_MAX_ENTRIES
} = {}) {
  const key = buildPassiveSnapshotKey(context, { listProviders });
  const current = entries.get(key);

  if (current?.promise) return current.promise;

  if (!force && current && current.value !== undefined && (current.expiresAt ?? 0) > now()) {
    touch(key, current);
    return current.value;
  }

  const promise = Promise.resolve()
    .then(() => build(context))
    .then((value) => {
      touch(key, { value, expiresAt: now() + ttlMs });
      evictOldest(maxEntries);
      return value;
    })
    .catch((err) => {
      entries.delete(key);
      throw err;
    });

  touch(key, { promise });
  evictOldest(maxEntries);
  return promise;
}
