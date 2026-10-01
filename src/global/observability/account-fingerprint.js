// One-way account fingerprint used to bind cached access evidence (Claude
// entitlements, Cursor pool access) to the account that produced it. Only
// the hash is ever persisted: never the raw email, org id, token or any
// response body. The caller supplies the stable identifier; this module
// never spawns a CLI or reads credentials.

import { createHash } from "node:crypto";

const FINGERPRINT_SALT = "kairo-account-fingerprint-v1:";
const FINGERPRINT_HEX_LENGTH = 32;

/**
 * @param {unknown} identifier stable account identifier (e.g. email + org id)
 * @returns {string|null} 32-char hex digest, or null when the account is unidentifiable
 */
export function computeAccountFingerprint(identifier) {
  if (typeof identifier !== "string") return null;
  const normalized = identifier.trim().toLowerCase();
  if (!normalized) return null;
  return createHash("sha256").update(FINGERPRINT_SALT + normalized).digest("hex").slice(0, FINGERPRINT_HEX_LENGTH);
}

/**
 * Decide whether a cache's recorded fingerprint may be reused.
 * Identity enforcement is opt-in per call: it only applies when the caller
 * passes the `accountIdentifier` key (even as null/undefined). Callers that
 * omit the key keep the legacy subscription-only behavior.
 *
 * Enforced: reusable only when the current account is identifiable AND equals
 * the cached fingerprint. A legacy cache without `accountFingerprint` is
 * therefore unidentifiable and is not reused once identity is enforced.
 *
 * @param {object|null} cache
 * @param {object} options the caller's options bag
 */
export function accountEvidenceUsable(cache, options) {
  if (!Object.hasOwn(options ?? {}, "accountIdentifier")) return true;
  const current = computeAccountFingerprint(options.accountIdentifier);
  if (!current) return false;
  return typeof cache?.accountFingerprint === "string" && cache.accountFingerprint === current;
}
