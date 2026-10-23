// Real operational bridge for identity + billing (E6). Self-declared
// authorization fields are claims only — a bridge receipt is required before
// invoke. Default is fail-closed: without a configured bridge, nothing runs.
// Bridges must not inspect provider sessions unless sessionInspectionPermission
// is explicitly granted for that execution.

const NO_ADDITIONAL_CHARGE = "no_additional_charge";

/**
 * @typedef {{
 *   ok: true,
 *   verifiedIdentity: { provider: string, modelId: string, accountKey: string },
 *   receiptId?: string|null
 * } | {
 *   ok: false,
 *   code: string,
 *   reason: string
 * }} BridgeIdentityResult
 *
 * @typedef {{
 *   ok: true,
 *   billingCertainty: string,
 *   receiptId?: string|null
 * } | {
 *   ok: false,
 *   code: string,
 *   reason: string
 * }} BridgeBillingResult
 *
 * @typedef {{
 *   verifyIdentity: (claim: {
 *     provider: string,
 *     modelId: string,
 *     accountKey: string,
 *     sessionInspection?: boolean
 *   }) => Promise<BridgeIdentityResult>|BridgeIdentityResult,
 *   verifyBilling: (claim: {
 *     provider: string,
 *     accountKey: string,
 *     billingCertainty?: string,
 *     sessionInspection?: boolean
 *   }) => Promise<BridgeBillingResult>|BridgeBillingResult
 * }} OperationalBridge
 */

/** Fail-closed default — no real bridge, no session inspection. */
export function createFailClosedOperationalBridge() {
  return {
    async verifyIdentity() {
      return {
        ok: false,
        code: "identity_unverifiable",
        reason: "no operational bridge configured to verify provider/model/account"
      };
    },
    async verifyBilling() {
      return {
        ok: false,
        code: "billing_unverifiable",
        reason: "no operational bridge configured to verify no-additional-charge path"
      };
    }
  };
}

/**
 * Offline scripted bridge for tests. Still fail-closed unless both receipts
 * are supplied and match the claim. Never inspects sessions.
 *
 * @param {{
 *   identity?: BridgeIdentityResult|null,
 *   billing?: BridgeBillingResult|null
 * }} script
 * @returns {OperationalBridge}
 */
export function createScriptedOperationalBridge(script = {}) {
  return {
    async verifyIdentity(claim) {
      if (claim?.sessionInspection === true) {
        return {
          ok: false,
          code: "session_inspection_denied",
          reason: "session inspection is not permitted without explicit permission"
        };
      }
      const identity = script.identity;
      if (!identity?.ok) {
        return identity ?? {
          ok: false,
          code: "identity_unverifiable",
          reason: "scripted bridge has no identity receipt"
        };
      }
      const verified = identity.verifiedIdentity;
      if (
        !verified
        || verified.provider !== claim.provider
        || verified.modelId !== claim.modelId
        || verified.accountKey !== claim.accountKey
      ) {
        return {
          ok: false,
          code: "identity_mismatch",
          reason: "bridge identity receipt does not match authorization claim"
        };
      }
      return {
        ok: true,
        verifiedIdentity: { ...verified },
        receiptId: identity.receiptId ?? null
      };
    },
    async verifyBilling(claim) {
      if (claim?.sessionInspection === true) {
        return {
          ok: false,
          code: "session_inspection_denied",
          reason: "session inspection is not permitted without explicit permission"
        };
      }
      const billing = script.billing;
      if (!billing?.ok) {
        return billing ?? {
          ok: false,
          code: "billing_unverifiable",
          reason: "scripted bridge has no billing receipt"
        };
      }
      if (billing.billingCertainty !== NO_ADDITIONAL_CHARGE) {
        return {
          ok: false,
          code: "billing_uncertain",
          reason: "bridge billing receipt is not no_additional_charge"
        };
      }
      if (
        claim.billingCertainty
        && claim.billingCertainty !== NO_ADDITIONAL_CHARGE
      ) {
        return {
          ok: false,
          code: "billing_uncertain",
          reason: "authorization billingCertainty is not no_additional_charge"
        };
      }
      return {
        ok: true,
        billingCertainty: NO_ADDITIONAL_CHARGE,
        receiptId: billing.receiptId ?? null
      };
    }
  };
}

/**
 * Build matching scripted receipts for a claim (offline tests only).
 * Does not prove a real provider — only that the bridge API was exercised.
 */
export function scriptedReceiptsForClaim({ provider, modelId, accountKey }) {
  return {
    identity: {
      ok: true,
      verifiedIdentity: { provider, modelId, accountKey },
      receiptId: `test-identity:${provider}:${modelId}:${accountKey}`
    },
    billing: {
      ok: true,
      billingCertainty: NO_ADDITIONAL_CHARGE,
      receiptId: `test-billing:${provider}:${accountKey}`
    }
  };
}
