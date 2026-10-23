// Explicit authorization for operational role-aptitude runs (E5/E6).
// Choosing an implementation scope never counts as a grant — a concrete
// authorization object plus bridge receipts for identity and billing are
// required per execution. Self-declared fields alone never authorize invoke.

import { createFailClosedOperationalBridge } from "./role-aptitude-bridge.js";
import { getOperationalProviderPolicy } from "./role-aptitude-providers.js";

export const BILLING_NO_ADDITIONAL_CHARGE = "no_additional_charge";

/**
 * @typedef {{
 *   provider: string,
 *   modelId: string,
 *   accountKey: string,
 *   roles: string[],
 *   maxCalls: number,
 *   absoluteTimeoutMs: number,
 *   maxOutputBytes: number,
 *   billingCertainty: string,
 *   verifiedIdentity: { provider: string, modelId: string, accountKey: string },
 *   authorizationId?: string|null,
 *   sessionInspection?: boolean
 * }} RoleAptitudeAuthorization
 */

/**
 * Structural claim checks (sync). Bridge verification is async and required
 * separately via {@link assertOperationalAuthorization}.
 * @param {Partial<RoleAptitudeAuthorization>|null|undefined} auth
 * @param {{ role?: string, providerPolicy?: object }} context
 */
export function assertOperationalAuthorizationClaims(auth, context = {}) {
  if (!auth || typeof auth !== "object") {
    return { ok: false, code: "authorization_missing", reason: "explicit operational authorization is required" };
  }
  const provider = String(auth.provider ?? "").trim();
  const modelId = String(auth.modelId ?? "").trim();
  const accountKey = String(auth.accountKey ?? "").trim();
  if (!provider || !modelId || !accountKey) {
    return {
      ok: false,
      code: "identity_incomplete",
      reason: "authorization must name provider, modelId, and accountKey"
    };
  }

  const verified = auth.verifiedIdentity;
  if (!verified || typeof verified !== "object") {
    return { ok: false, code: "identity_unverified", reason: "verifiedIdentity claim is required" };
  }
  if (
    verified.provider !== provider
    || verified.modelId !== modelId
    || verified.accountKey !== accountKey
  ) {
    return {
      ok: false,
      code: "identity_mismatch",
      reason: "verifiedIdentity claim does not match authorization provider/model/account"
    };
  }

  if (auth.billingCertainty !== BILLING_NO_ADDITIONAL_CHARGE) {
    return {
      ok: false,
      code: "billing_uncertain",
      reason: "billingCertainty must be no_additional_charge; PAYG or unknown billing is blocked"
    };
  }

  if (!Number.isFinite(auth.absoluteTimeoutMs) || auth.absoluteTimeoutMs <= 0) {
    return {
      ok: false,
      code: "limits_incomplete",
      reason: "absoluteTimeoutMs must be an explicit positive number before execution"
    };
  }
  if (!Number.isFinite(auth.maxOutputBytes) || auth.maxOutputBytes <= 0) {
    return {
      ok: false,
      code: "limits_incomplete",
      reason: "maxOutputBytes must be an explicit positive number before execution"
    };
  }
  if (!Number.isFinite(auth.maxCalls) || auth.maxCalls < 1) {
    return {
      ok: false,
      code: "limits_incomplete",
      reason: "maxCalls must be an explicit integer ≥ 1 (first grant uses 1, no automatic retries)"
    };
  }

  const roles = Array.isArray(auth.roles) ? auth.roles.map(String) : [];
  if (!roles.length) {
    return { ok: false, code: "roles_missing", reason: "authorization.roles must list allowed probe roles" };
  }
  if (context?.role && !roles.includes(context.role)) {
    return {
      ok: false,
      code: "role_not_authorized",
      reason: `role ${context.role} is not in authorization.roles`
    };
  }

  const providerPolicy = getOperationalProviderPolicy(provider, context?.providerPolicy);
  if (!providerPolicy.admitted) {
    return {
      ok: false,
      code: "provider_blocked",
      reason: providerPolicy.reason
    };
  }

  if (auth.sessionInspection === true && context?.sessionInspectionPermission !== true) {
    return {
      ok: false,
      code: "session_inspection_denied",
      reason: "session inspection requires explicit sessionInspectionPermission; refused by default"
    };
  }

  return {
    ok: true,
    claim: {
      provider,
      modelId,
      accountKey,
      roles: [...roles],
      maxCalls: Math.floor(auth.maxCalls),
      absoluteTimeoutMs: auth.absoluteTimeoutMs,
      maxOutputBytes: auth.maxOutputBytes,
      billingCertainty: BILLING_NO_ADDITIONAL_CHARGE,
      verifiedIdentity: {
        provider: verified.provider,
        modelId: verified.modelId,
        accountKey: verified.accountKey
      },
      authorizationId: auth.authorizationId ?? null,
      sessionInspection: auth.sessionInspection === true
    }
  };
}

/**
 * Full authorization: structural claims + bridge receipts. Self-declared
 * identity/billing never suffice alone.
 *
 * @param {Partial<RoleAptitudeAuthorization>|null|undefined} auth
 * @param {{
 *   role?: string,
 *   providerPolicy?: object,
 *   bridge?: import("./role-aptitude-bridge.js").OperationalBridge|null,
 *   sessionInspectionPermission?: boolean
 * }} context
 */
export async function assertOperationalAuthorization(auth, context = {}) {
  const claims = assertOperationalAuthorizationClaims(auth, context);
  if (!claims.ok) return claims;

  const bridge = context.bridge ?? createFailClosedOperationalBridge();
  if (typeof bridge.verifyIdentity !== "function" || typeof bridge.verifyBilling !== "function") {
    return {
      ok: false,
      code: "bridge_missing",
      reason: "operational bridge with verifyIdentity and verifyBilling is required"
    };
  }

  const sessionInspection = claims.claim.sessionInspection === true
    && context.sessionInspectionPermission === true;

  const identity = await bridge.verifyIdentity({
    provider: claims.claim.provider,
    modelId: claims.claim.modelId,
    accountKey: claims.claim.accountKey,
    sessionInspection
  });
  if (!identity?.ok) {
    return {
      ok: false,
      code: identity?.code ?? "identity_unverifiable",
      reason: identity?.reason ?? "bridge could not verify identity"
    };
  }
  if (
    identity.verifiedIdentity.provider !== claims.claim.provider
    || identity.verifiedIdentity.modelId !== claims.claim.modelId
    || identity.verifiedIdentity.accountKey !== claims.claim.accountKey
  ) {
    return {
      ok: false,
      code: "identity_mismatch",
      reason: "bridge identity receipt does not match authorization claim"
    };
  }

  const billing = await bridge.verifyBilling({
    provider: claims.claim.provider,
    accountKey: claims.claim.accountKey,
    billingCertainty: claims.claim.billingCertainty,
    sessionInspection
  });
  if (!billing?.ok) {
    return {
      ok: false,
      code: billing?.code ?? "billing_unverifiable",
      reason: billing?.reason ?? "bridge could not verify billing path"
    };
  }
  if (billing.billingCertainty !== BILLING_NO_ADDITIONAL_CHARGE) {
    return {
      ok: false,
      code: "billing_uncertain",
      reason: "bridge billing receipt is not no_additional_charge"
    };
  }

  return {
    ok: true,
    grant: {
      ...claims.claim,
      verifiedIdentity: { ...identity.verifiedIdentity },
      bridgeReceipts: {
        identity: identity.receiptId ?? null,
        billing: billing.receiptId ?? null
      }
    }
  };
}

/** First-call claim helper for tests/docs — still requires bridge receipts at assert time. */
export function buildSingleCallAuthorization({
  provider,
  modelId,
  accountKey,
  roles,
  absoluteTimeoutMs,
  maxOutputBytes,
  authorizationId = null,
  sessionInspection = false,
  maxCalls = 1
}) {
  return {
    provider,
    modelId,
    accountKey,
    roles,
    maxCalls: Number.isFinite(maxCalls) ? Math.floor(maxCalls) : 1,
    absoluteTimeoutMs,
    maxOutputBytes,
    billingCertainty: BILLING_NO_ADDITIONAL_CHARGE,
    verifiedIdentity: { provider, modelId, accountKey },
    authorizationId,
    sessionInspection: sessionInspection === true
  };
}
