import { buildObservabilitySnapshot } from "./build-observability-snapshot.js";
import { listObservabilityProbes } from "./probe-registry.js";

/** Short TTL for passive Cockpit/MCP observability only — never suite authority. */
export const PASSIVE_SNAPSHOT_TTL_MS = 5_000;
export const PASSIVE_SNAPSHOT_MAX_ENTRIES = 8;

/** @type {Map<string, Promise<unknown>>} */
const flights = new Map();
/** @type {Map<string, { value: unknown, expiresAt: number }>} */
const completed = new Map();

export function resetPassiveSnapshotFlightForTests() {
  flights.clear();
  completed.clear();
}

export function passiveSnapshotFlightSizeForTests() {
  return completed.size;
}

export function passiveSnapshotInFlightSizeForTests() {
  return flights.size;
}

export function buildPassiveSnapshotKey(context = {}, {
  listProviders = listObservabilityProbes
} = {}) {
  const workspace = String(context.workspaceRoot ?? context.cwd ?? "");
  const head = String(context.headSha ?? "");
  const providers = listProviders().map((p) => p.id).sort().join(",");
  return `${workspace}\0${head}\0${providers}`;
}

function touchCompleted(key, entry) {
  completed.delete(key);
  completed.set(key, entry);
}

function evictOldestCompleted(maxEntries) {
  while (completed.size > maxEntries) {
    const oldest = completed.keys().next().value;
    if (oldest == null) break;
    completed.delete(oldest);
  }
}

/**
 * Single-flight + short TTL for passive observability snapshots.
 * force skips completed hits but joins identical in-flight work.
 * Errors clear that key's flight and completed entry so the next call rebuilds
 * (a failed force refresh must not leave a stale completed hit).
 * LRU applies only to completed values — never evicts active flights.
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
  const inflight = flights.get(key);
  if (inflight) return inflight;

  const cached = completed.get(key);
  if (!force && cached && cached.expiresAt > now()) {
    touchCompleted(key, cached);
    return cached.value;
  }

  const promise = Promise.resolve()
    .then(() => build(context))
    .then((value) => {
      if (flights.get(key) === promise) {
        flights.delete(key);
        touchCompleted(key, { value, expiresAt: now() + ttlMs });
        evictOldestCompleted(maxEntries);
      }
      return value;
    })
    .catch((err) => {
      if (flights.get(key) === promise) {
        flights.delete(key);
        completed.delete(key);
      }
      throw err;
    });

  flights.set(key, promise);
  return promise;
}
