// Disk cache for Claude per-model entitlement probes. Mirrors the
// artificial-analysis-models.js pattern (read→null on any failure, mkdir +
// writeAtomicJson, fetchedAt / ageLabel) — not usage-store.js, whose
// whitelist is for real billing providers.

import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { harnessHomePaths } from "../paths.js";
import { writeAtomicJson } from "../runtime/write-atomic-json.js";
import { ENTITLEMENT } from "./claude-model-entitlement.js";

export const DEFAULT_ENTITLEMENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function ageLabel(fetchedAtIso, nowMs = Date.now()) {
  const fetchedAt = new Date(fetchedAtIso ?? "").getTime();
  if (!Number.isFinite(fetchedAt)) return null;
  const hours = (nowMs - fetchedAt) / 3_600_000;
  if (hours < 1) return "<1h";
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function isPersistableStatus(status) {
  return status === ENTITLEMENT.ALLOWED || status === ENTITLEMENT.DENIED;
}

function emptyDoc(subscriptionType, fetchedAt = new Date().toISOString()) {
  return {
    subscriptionType: subscriptionType ?? null,
    fetchedAt,
    models: Object.create(null)
  };
}

/**
 * @param {string} homeDir
 * @param {object} [deps]
 * @returns {Promise<object|null>}
 */
export async function readClaudeEntitlementCache(homeDir, deps = {}) {
  const read = deps.readFile ?? readFile;
  try {
    const raw = await read(harnessHomePaths(homeDir).claudeEntitlementPath, "utf8");
    const doc = JSON.parse(raw);
    if (!doc || typeof doc !== "object") return null;
    if (typeof doc.fetchedAt !== "string") return null;
    if (!doc.models || typeof doc.models !== "object" || Array.isArray(doc.models)) return null;
    return doc;
  } catch {
    return null;
  }
}

/**
 * @param {string} homeDir
 * @param {object} doc
 * @param {object} [deps]
 */
export async function writeClaudeEntitlementCache(homeDir, doc, deps = {}) {
  const mkdirImpl = deps.mkdir ?? mkdir;
  const writeJson = deps.writeAtomicJson ?? writeAtomicJson;
  const path = harnessHomePaths(homeDir).claudeEntitlementPath;
  await mkdirImpl(dirname(path), { recursive: true });
  await writeJson(path, doc);
}

/**
 * Pure resolver: map catalog ids → live entitlement view from cache.
 * Invalidates the entire cache when subscriptionType differs.
 *
 * @param {{
 *   cache: object|null,
 *   subscriptionType: string|null,
 *   catalogIds: string[],
 *   now?: number,
 *   ttlMs?: number
 * }} options
 * @returns {Record<string, { status: string, reason: string|null, age: string|null, probedAt: string|null }>}
 */
export function resolveClaudeEntitlements({
  cache,
  subscriptionType,
  catalogIds = [],
  now = Date.now(),
  ttlMs = DEFAULT_ENTITLEMENT_TTL_MS
} = {}) {
  const usable = cache
    && typeof cache === "object"
    && cache.subscriptionType === subscriptionType
    && cache.models
    && typeof cache.models === "object"
    ? cache
    : null;

  const resolved = Object.create(null);
  for (const modelId of catalogIds) {
    const entry = usable?.models?.[modelId] ?? null;
    if (!entry || !isPersistableStatus(entry.status)) {
      resolved[modelId] = {
        status: ENTITLEMENT.UNVERIFIED,
        reason: null,
        age: null,
        probedAt: null
      };
      continue;
    }

    const probedAtMs = new Date(entry.probedAt ?? "").getTime();
    if (!Number.isFinite(probedAtMs) || now - probedAtMs > ttlMs) {
      resolved[modelId] = {
        status: ENTITLEMENT.UNVERIFIED,
        reason: null,
        age: ageLabel(entry.probedAt, now),
        probedAt: entry.probedAt ?? null
      };
      continue;
    }

    resolved[modelId] = {
      status: entry.status,
      reason: entry.reason ?? null,
      age: ageLabel(entry.probedAt, now),
      probedAt: entry.probedAt
    };
  }
  return resolved;
}

/**
 * Merge fresh probe results into a cache doc. Discards status "unknown"
 * (and unverified) — only allowed/denied evidence is persisted.
 *
 * @param {object|null} cache
 * @param {{ subscriptionType: string|null, catalogIds?: string[], results: Array<{ modelId: string, status: string, reason?: string|null, probedAt?: string }> }} payload
 */
export function mergeEntitlementResults(cache, { subscriptionType, results = [] } = {}) {
  const base = cache
    && typeof cache === "object"
    && cache.subscriptionType === subscriptionType
    && cache.models
    && typeof cache.models === "object"
    ? {
      subscriptionType: cache.subscriptionType,
      fetchedAt: cache.fetchedAt,
      models: { ...cache.models }
    }
    : emptyDoc(subscriptionType);

  let newestProbedAt = base.fetchedAt;
  for (const result of results) {
    if (!result || typeof result.modelId !== "string") continue;
    if (result.status === "unknown" || !isPersistableStatus(result.status)) continue;
    const probedAt = typeof result.probedAt === "string"
      ? result.probedAt
      : new Date().toISOString();
    base.models[result.modelId] = {
      status: result.status,
      reason: result.reason ?? null,
      probedAt
    };
    if (!newestProbedAt || probedAt > newestProbedAt) newestProbedAt = probedAt;
  }

  base.fetchedAt = newestProbedAt ?? new Date().toISOString();
  base.subscriptionType = subscriptionType ?? null;
  return base;
}
