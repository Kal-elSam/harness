/**
 * Read-only association between a work/minion result and Gentle review state.
 * Advisory Kairo review receipts never become Gentle authority.
 * Approval provenance is explicit and never invents approve/reject verdicts.
 */
import { PROVIDER } from "./constants.js";

export const REVIEW_REF_SCHEMA = "kairo.review-ref/v1";

export const REVIEW_ASSOCIATION = Object.freeze({
  PENDING: "pending",
  OFFICIAL: "official",
  INCOMPATIBLE: "incompatible",
  UNAVAILABLE: "unavailable",
  RDD_OFF: "rdd_off"
});

export const REVIEW_AUTHORITY = Object.freeze({
  GENTLE: "gentle",
  NONE: "none"
});

/** Where an approval signal came from — never a Kairo-invented verdict. */
export const APPROVAL_PROVENANCE = Object.freeze({
  NONE: "none",
  GENTLE_RECEIPT: "gentle_receipt",
  ADVISORY: "advisory",
  TEAM_STRATEGY: "team_strategy"
});

const RDD_MODES = new Set(["on", "off", "unknown"]);

function normalizeRddMode(value) {
  const mode = typeof value === "string" ? value.trim().toLowerCase() : "unknown";
  return RDD_MODES.has(mode) ? mode : "unknown";
}

function advisoryId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Kernel WorkResult statuses (Claude contract). Association accepts them; never treats them as approval. */
export const WORK_RESULT_STATUSES = Object.freeze({
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled"
});

const WORK_RESULT_STATUS_SET = new Set(Object.values(WORK_RESULT_STATUSES));

/**
 * Host-neutral WorkResult recognizer.
 * Compatible with `{ok, workerId, summary}` and validated contract shapes
 * (`status` completed|failed|cancelled, optional `error`) without mutating kernel.
 * Does not re-implement kernel validation; association only needs a stable object.
 */
export function isHostNeutralWorkResult(value) {
  if (
    value == null
    || typeof value !== "object"
    || Array.isArray(value)
    || typeof value.ok !== "boolean"
    || typeof value.workerId !== "string"
    || value.workerId.trim() === ""
    || !(value.summary === null || typeof value.summary === "string")
  ) {
    return false;
  }
  if (value.status != null && !WORK_RESULT_STATUS_SET.has(value.status)) return false;
  if (value.error != null && typeof value.error !== "string") return false;
  return true;
}

/**
 * @returns {Readonly<{
 *   schema: string,
 *   association: string,
 *   authority: string,
 *   receipt: string|null,
 *   gate: string|null,
 *   nextTransition: object|null,
 *   advisoryReceiptId: string|null
 * }>}
 */
export function createReviewRef({
  association,
  authority = REVIEW_AUTHORITY.NONE,
  receipt = null,
  gate = null,
  nextTransition = null,
  advisoryReceiptId = null
} = {}) {
  if (!Object.values(REVIEW_ASSOCIATION).includes(association)) {
    throw new Error(`Unknown review association "${association}".`);
  }
  if (!Object.values(REVIEW_AUTHORITY).includes(authority)) {
    throw new Error(`Unknown review authority "${authority}".`);
  }
  if (authority === REVIEW_AUTHORITY.GENTLE && association !== REVIEW_ASSOCIATION.OFFICIAL) {
    throw new Error("Gentle authority requires an official association.");
  }
  if (authority === REVIEW_AUTHORITY.GENTLE && (typeof receipt !== "string" || !receipt)) {
    throw new Error("Gentle authority requires a published receipt id.");
  }
  return Object.freeze({
    schema: REVIEW_REF_SCHEMA,
    association,
    authority,
    receipt: typeof receipt === "string" && receipt ? receipt : null,
    gate: typeof gate === "string" && gate ? gate : null,
    nextTransition: nextTransition == null ? null : nextTransition,
    advisoryReceiptId: advisoryId(advisoryReceiptId)
  });
}

function incompatibleRef(advisoryReceiptId) {
  return createReviewRef({
    association: REVIEW_ASSOCIATION.INCOMPATIBLE,
    authority: REVIEW_AUTHORITY.NONE,
    advisoryReceiptId
  });
}

/**
 * Resolve approval provenance without inventing approve/reject.
 * `gentleStatus` is Gentle's receipt.status pass-through only.
 */
export function resolveApprovalProvenance({
  reviewRef,
  teamStrategyApproved = false,
  gentleStatus = null
} = {}) {
  const team = teamStrategyApproved === true;
  const status = typeof gentleStatus === "string" && gentleStatus ? gentleStatus : null;
  let provenance = APPROVAL_PROVENANCE.NONE;
  if (reviewRef?.authority === REVIEW_AUTHORITY.GENTLE && reviewRef.receipt) {
    provenance = APPROVAL_PROVENANCE.GENTLE_RECEIPT;
  } else if (team) {
    provenance = APPROVAL_PROVENANCE.TEAM_STRATEGY;
  } else if (reviewRef?.advisoryReceiptId) {
    provenance = APPROVAL_PROVENANCE.ADVISORY;
  }
  return Object.freeze({
    provenance,
    gentleStatus: provenance === APPROVAL_PROVENANCE.GENTLE_RECEIPT ? status : null,
    teamStrategyApproved: team
  });
}

export function extractGentleContext(mappedStatus) {
  if (mappedStatus?.ok !== true || mappedStatus.review == null) return null;
  const review = mappedStatus.review;
  const applicability = typeof review.applicability === "string" ? review.applicability : null;
  const action = typeof review.action === "string" ? review.action : null;
  const candidates = Array.isArray(review.candidates) ? review.candidates : null;
  if (applicability == null && action == null && candidates == null) return null;
  return Object.freeze({ applicability, action, candidates });
}

function wrapAssociation({
  result,
  reviewRef,
  mappedStatus = null,
  teamStrategyApproved = false,
  includeGentleContext = false
}) {
  const gentleStatus = typeof mappedStatus?.review?.status === "string"
    ? mappedStatus.review.status
    : null;
  return {
    result,
    reviewRef,
    approval: resolveApprovalProvenance({
      reviewRef,
      teamStrategyApproved,
      gentleStatus
    }),
    gentleContext: includeGentleContext ? extractGentleContext(mappedStatus) : null
  };
}

/**
 * Associate an unchanged minion or host-neutral WorkResult with a read-only Gentle reviewRef.
 * Never invents receipt, gate, next_transition, candidates, or approval verdicts.
 */
export function associateResultWithGentleReview({
  result,
  provider,
  mappedStatus = null,
  rddMode = "unknown",
  advisoryReceiptId = null,
  teamStrategyApproved = false
} = {}) {
  if (result == null || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("associateResultWithGentleReview requires a result object.");
  }
  const advisory = advisoryId(advisoryReceiptId);
  const mode = normalizeRddMode(rddMode);
  const team = teamStrategyApproved === true;

  if (mode === "off") {
    return wrapAssociation({
      result,
      reviewRef: createReviewRef({
        association: REVIEW_ASSOCIATION.RDD_OFF,
        authority: REVIEW_AUTHORITY.NONE,
        advisoryReceiptId: advisory
      }),
      teamStrategyApproved: team
    });
  }

  if (provider === PROVIDER.UNAVAILABLE) {
    return wrapAssociation({
      result,
      reviewRef: createReviewRef({
        association: REVIEW_ASSOCIATION.UNAVAILABLE,
        authority: REVIEW_AUTHORITY.NONE,
        advisoryReceiptId: advisory
      }),
      teamStrategyApproved: team
    });
  }

  if (
    provider === PROVIDER.INCOMPATIBLE
    || provider === PROVIDER.UPGRADE_REQUIRED
    || provider !== PROVIDER.CONNECTED
  ) {
    return wrapAssociation({
      result,
      reviewRef: incompatibleRef(advisory),
      teamStrategyApproved: team
    });
  }

  if (mappedStatus == null || mappedStatus.ok !== true) {
    return wrapAssociation({
      result,
      reviewRef: incompatibleRef(advisory),
      teamStrategyApproved: team
    });
  }

  const review = mappedStatus.review;
  const nextTransition = Object.prototype.hasOwnProperty.call(mappedStatus, "nextTransition")
    ? mappedStatus.nextTransition
    : null;
  const receipt = typeof review?.receipt === "string" && review.receipt ? review.receipt : null;
  const gate = typeof review?.gate === "string" && review.gate ? review.gate : null;

  if (receipt) {
    return wrapAssociation({
      result,
      reviewRef: createReviewRef({
        association: REVIEW_ASSOCIATION.OFFICIAL,
        authority: REVIEW_AUTHORITY.GENTLE,
        receipt,
        gate,
        nextTransition,
        advisoryReceiptId: advisory
      }),
      mappedStatus,
      teamStrategyApproved: team,
      includeGentleContext: true
    });
  }

  return wrapAssociation({
    result,
    reviewRef: createReviewRef({
      association: REVIEW_ASSOCIATION.PENDING,
      authority: REVIEW_AUTHORITY.NONE,
      gate,
      nextTransition,
      advisoryReceiptId: advisory
    }),
    mappedStatus,
    teamStrategyApproved: team,
    includeGentleContext: true
  });
}
