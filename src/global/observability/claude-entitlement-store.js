// Disk cache for Claude per-model entitlement probes. Mirrors the
// artificial-analysis-models.js pattern (read→null on any failure, mkdir +
// writeAtomicJson, fetchedAt / ageLabel) — not usage-store.js, whose
// whitelist is for real billing providers.

import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { harnessHomePaths } from "../paths.js";
import { writeAtomicJson } from "../runtime/write-atomic-json.js";
import { ENTITLEMENT, TEMPORARY_LIMIT, clampRetryAfterMs } from "./claude-model-entitlement.js";
import { accountEvidenceUsable, computeAccountFingerprint } from "./account-fingerprint.js";

export const DEFAULT_ENTITLEMENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Short TTL for plain UNVERIFIED probe attempts — avoids re-probing on every analyze. */
export const DEFAULT_UNVERIFIED_ENTITLEMENT_TTL_MS = 60 * 60 * 1000;

function ageLabel(fetchedAtIso, nowMs = Date.now()) {
  const fetchedAt = new Date(fetchedAtIso ?? "").getTime();
  if (!Number.isFinite(fetchedAt)) return null;
  const hours = (nowMs - fetchedAt) / 3_600_000;
  if (hours < 1) return "<1h";
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function isPersistableStatus(status) {
  return status === ENTITLEMENT.ALLOWED
    || status === ENTITLEMENT.DENIED
    || status === ENTITLEMENT.UNVERIFIED;
}

// A temporary-limit result (429) is evidence with its own short TTL: stored
// as unverified + limit marker, never as a denial.
function isTemporaryLimit(entry) {
  return entry?.status === ENTITLEMENT.UNVERIFIED && entry?.limit === TEMPORARY_LIMIT;
}

function subscriptionTypeMatches(cache, subscriptionType) {
  if (!cache) return false;
  const cached = cache.subscriptionType ?? null;
  const current = subscriptionType ?? null;
  if (cached === current) return true;
  // A transient null auth read must not wipe a real cached sweep.
  return current === null;
}

function ttlForStatus(status, { ttlMs, unverifiedTtlMs }) {
  return status === ENTITLEMENT.UNVERIFIED ? unverifiedTtlMs : ttlMs;
}

function emptyDoc(subscriptionType, fetchedAt = new Date().toISOString(), accountFingerprint = null) {
  return {
    subscriptionType: subscriptionType ?? null,
    accountFingerprint,
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
 * Invalidates when subscriptionType differs (null auth keeps cache) or when
 * the caller enforces account identity and the fingerprint does not match.
 * Temporary 429 evidence uses Retry-After TTL; plain UNVERIFIED uses the
 * short verify-once TTL; allowed/denied use the long TTL.
 *
 * @param {{
 *   cache: object|null,
 *   subscriptionType: string|null,
 *   catalogIds: string[],
 *   now?: number,
 *   ttlMs?: number,
 *   unverifiedTtlMs?: number
 * }} options
 * @returns {Record<string, { status: string, reason: string|null, age: string|null, probedAt: string|null }>}
 */
export function resolveClaudeEntitlements({
  cache,
  subscriptionType,
  catalogIds = [],
  now = Date.now(),
  ttlMs = DEFAULT_ENTITLEMENT_TTL_MS,
  unverifiedTtlMs = DEFAULT_UNVERIFIED_ENTITLEMENT_TTL_MS,
  ...identity
} = {}) {
  const usable = cache
    && typeof cache === "object"
    && subscriptionTypeMatches(cache, subscriptionType)
    && accountEvidenceUsable(cache, identity)
    && cache.models
    && typeof cache.models === "object"
    ? cache
    : null;

  const resolved = Object.create(null);
  for (const modelId of catalogIds) {
    const entry = usable?.models?.[modelId] ?? null;
    if (isTemporaryLimit(entry)) {
      const probedAtMs = new Date(entry.probedAt ?? "").getTime();
      const retryMs = clampRetryAfterMs((entry.retryAfterMs ?? 0) / 1000);
      if (Number.isFinite(probedAtMs) && now - probedAtMs <= retryMs) {
        resolved[modelId] = {
          status: ENTITLEMENT.UNVERIFIED,
          reason: entry.reason ?? null,
          limit: TEMPORARY_LIMIT,
          retryAfterMs: retryMs,
          age: ageLabel(entry.probedAt, now),
          probedAt: entry.probedAt
        };
        continue;
      }
      resolved[modelId] = {
        status: ENTITLEMENT.UNVERIFIED,
        reason: null,
        age: ageLabel(entry.probedAt, now),
        probedAt: entry.probedAt ?? null
      };
      continue;
    }
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
    const entryTtl = ttlForStatus(entry.status, { ttlMs, unverifiedTtlMs });
    if (!Number.isFinite(probedAtMs) || now - probedAtMs > entryTtl) {
      resolved[modelId] = {
        status: ENTITLEMENT.UNVERIFIED,
        reason: entry.probedAt ? "stale" : null,
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
 * Merge fresh probe results into a cache doc. Persists allowed, denied,
 * plain unverified (verify-once short TTL), and temporary-limit (429)
 * evidence. Discards status "unknown". A transient null subscriptionType
 * keeps the existing cache account type and models. Never stores raw
 * account identifiers, only the one-way `accountFingerprint`.
 *
 * @param {object|null} cache
 * @param {{ subscriptionType: string|null, catalogIds?: string[], results: Array<{ modelId: string, status: string, reason?: string|null, probedAt?: string }> }} payload
 */
export function mergeEntitlementResults(cache, { subscriptionType, results = [], ...identity } = {}) {
  const enforcing = Object.hasOwn(identity, "accountIdentifier");
  const fingerprint = enforcing ? computeAccountFingerprint(identity.accountIdentifier) : null;
  const sameAccount = !enforcing || (fingerprint !== null && cache?.accountFingerprint === fingerprint);
  const keepCache = cache
    && typeof cache === "object"
    && subscriptionTypeMatches(cache, subscriptionType)
    && sameAccount
    && cache.models
    && typeof cache.models === "object";
  const base = keepCache
    ? {
      subscriptionType: cache.subscriptionType ?? null,
      accountFingerprint: cache.accountFingerprint ?? null,
      fetchedAt: cache.fetchedAt,
      models: { ...cache.models }
    }
    : emptyDoc(subscriptionType, undefined, fingerprint);
  if (enforcing) base.accountFingerprint = fingerprint;

  let newestProbedAt = base.fetchedAt;
  for (const result of results) {
    if (!result || typeof result.modelId !== "string") continue;
    if (result.status === "unknown") continue;
    const temporary = isTemporaryLimit(result);
    if (!temporary && !isPersistableStatus(result.status)) continue;
    const probedAt = typeof result.probedAt === "string"
      ? result.probedAt
      : new Date().toISOString();
    base.models[result.modelId] = temporary
      ? {
        status: ENTITLEMENT.UNVERIFIED,
        limit: TEMPORARY_LIMIT,
        retryAfterMs: clampRetryAfterMs((result.retryAfterMs ?? 0) / 1000),
        reason: result.reason ?? null,
        probedAt
      }
      : {
        status: result.status,
        reason: result.reason ?? null,
        probedAt
      };
    if (!newestProbedAt || probedAt > newestProbedAt) newestProbedAt = probedAt;
  }

  base.fetchedAt = newestProbedAt ?? new Date().toISOString();
  // Preserve the known account type when auth briefly returns null.
  base.subscriptionType = subscriptionType ?? base.subscriptionType ?? null;
  return base;
}
