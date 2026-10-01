// Access-evidence helpers: aggregate cached per-model evidence into one
// modelAccess state, and bind/invalidate the T3 caches by account fingerprint.
// Only hashes are ever read or written here, never raw identifiers.

import { readClaudeEntitlementCache, writeClaudeEntitlementCache } from "../observability/claude-entitlement-store.js";
import { readCursorAccessCache, writeCursorAccessCache } from "../observability/cursor-entitlement-store.js";

function kindOf(entry) {
  const status = entry?.status;
  if (status === "allowed" || status === "available") return "allowed";
  if (status === "denied") return "denied";
  if (status === "exhausted") return "exhausted";
  if (status === "unverified" && entry?.limit === "temporary") return "temporarily_limited";
  return null;
}

/**
 * @param {unknown} evidence one entry or an array of entries from an injected reader
 * @returns {{state: string, retryAfterMs?: number}}
 */
export function aggregateModelAccess(evidence) {
  const entries = (Array.isArray(evidence) ? evidence : [evidence]).filter(Boolean);
  const kinds = new Set();
  let retryAfterMs = null;
  for (const entry of entries) {
    const kind = kindOf(entry);
    if (!kind) continue;
    kinds.add(kind);
    if (kind === "temporarily_limited" && Number.isFinite(entry.retryAfterMs)) {
      retryAfterMs = Math.max(retryAfterMs ?? 0, entry.retryAfterMs);
    }
  }
  if (kinds.size === 0) return { state: "unknown" };
  if (kinds.size > 1) return { state: "mixed" };
  const [state] = kinds;
  return state === "temporarily_limited" && retryAfterMs !== null ? { state, retryAfterMs } : { state };
}

// ADDITIVE per-model vocabulary (modelAccess.models[]); the aggregate fields above are the original contract. Anything that is not clear
// evidence collapses to "unverified"/"catalogued"; it is never upgraded.
export const MODEL_ACCESS_STATES = Object.freeze([
  "allowed", "denied", "unverified", "catalogued", "rate_limited", "limited"
]);

const SAFE_REASON = /^[A-Za-z0-9_.:-]{1,64}$/;

function stateOf(raw) {
  const status = raw?.status;
  if (status === "allowed" || status === "available") return "allowed";
  if (status === "denied") return "denied";
  if (status === "exhausted") return "limited"; // Cursor pool quota exhausted
  if (status === "unverified" && raw?.limit === "temporary") return "rate_limited"; // T2: a 429 is a temporary limit
  if (raw?.catalogued === true) return "catalogued";
  return "unverified";
}

/**
 * Normalize raw evidence from an injected/default reader into the optional
 * per-model array `modelAccess.models`: {modelId, label, state, reusable?, retryAfterMs?,
 * reason?, scope?}. Entries without a model id are dropped (they cannot be
 * keyed); free-text reasons are dropped (only short codes are exposed).
 * @param {unknown} evidence one entry or an array of raw entries
 */
export function normalizeModelAccess(evidence) {
  const entries = (Array.isArray(evidence) ? evidence : [evidence]).filter(Boolean);
  const rows = [];
  for (const raw of entries) {
    if (typeof raw.modelId !== "string" || raw.modelId.trim() === "") continue;
    const state = stateOf(raw);
    const row = { modelId: raw.modelId, label: typeof raw.label === "string" && raw.label ? raw.label : raw.modelId, state };
    if (state === "allowed") row.reusable = true;
    if (state === "rate_limited" && Number.isFinite(raw.retryAfterMs)) row.retryAfterMs = raw.retryAfterMs;
    if (typeof raw.reason === "string" && SAFE_REASON.test(raw.reason)) row.reason = raw.reason;
    if (raw.scope === "pool") row.scope = "pool";
    rows.push(row);
  }
  return rows;
}

/**
 * Evidence store over the real caches, with every I/O dep injectable.
 * `invalidate` writes an empty, fingerprint-only doc: prior allowed/denied/
 * limit evidence is dropped, and a null fingerprint keeps it unusable under
 * identity enforcement until the account is identifiable again.
 */
export function createAccessEvidenceStore({ homeDir, deps = {} } = {}) {
  return {
    async getFingerprint(providerId) {
      if (providerId === "claude") return (await readClaudeEntitlementCache(homeDir, deps))?.accountFingerprint ?? null;
      if (providerId === "cursor") return (await readCursorAccessCache(homeDir, deps))?.accountFingerprint ?? null;
      return null;
    },
    async invalidate(providerId, newFingerprint) {
      const fetchedAt = new Date().toISOString();
      if (providerId === "claude") {
        await writeClaudeEntitlementCache(homeDir, {
          subscriptionType: null, accountFingerprint: newFingerprint ?? null, fetchedAt, models: {}
        }, deps);
      } else if (providerId === "cursor") {
        await writeCursorAccessCache(homeDir, {
          fetchedAt, accountFingerprint: newFingerprint ?? null, pools: {}
        }, deps);
      }
    }
  };
}
