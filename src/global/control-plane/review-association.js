/**
 * Read-only association between a work/minion result and Gentle review state.
 * Advisory Kairo review receipts never become Gentle authority.
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

const RDD_MODES = new Set(["on", "off", "unknown"]);

function normalizeRddMode(value) {
  const mode = typeof value === "string" ? value.trim().toLowerCase() : "unknown";
  return RDD_MODES.has(mode) ? mode : "unknown";
}

function advisoryId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
 * Associate an unchanged minion/work result with a read-only Gentle reviewRef.
 * Never invents receipt, gate, or next_transition. Never elevates advisory receipts.
 */
export function associateResultWithGentleReview({
  result,
  provider,
  mappedStatus = null,
  rddMode = "unknown",
  advisoryReceiptId = null
} = {}) {
  if (result == null || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("associateResultWithGentleReview requires a result object.");
  }
  const advisory = advisoryId(advisoryReceiptId);
  const mode = normalizeRddMode(rddMode);

  if (mode === "off") {
    return {
      result,
      reviewRef: createReviewRef({
        association: REVIEW_ASSOCIATION.RDD_OFF,
        authority: REVIEW_AUTHORITY.NONE,
        advisoryReceiptId: advisory
      })
    };
  }

  if (provider === PROVIDER.UNAVAILABLE) {
    return {
      result,
      reviewRef: createReviewRef({
        association: REVIEW_ASSOCIATION.UNAVAILABLE,
        authority: REVIEW_AUTHORITY.NONE,
        advisoryReceiptId: advisory
      })
    };
  }

  if (provider === PROVIDER.INCOMPATIBLE || provider === PROVIDER.UPGRADE_REQUIRED) {
    return {
      result,
      reviewRef: incompatibleRef(advisory)
    };
  }

  if (provider !== PROVIDER.CONNECTED) {
    return {
      result,
      reviewRef: incompatibleRef(advisory)
    };
  }

  if (mappedStatus == null || mappedStatus.ok !== true) {
    return {
      result,
      reviewRef: incompatibleRef(advisory)
    };
  }

  const review = mappedStatus.review;
  const nextTransition = Object.prototype.hasOwnProperty.call(mappedStatus, "nextTransition")
    ? mappedStatus.nextTransition
    : null;
  const receipt = typeof review?.receipt === "string" && review.receipt ? review.receipt : null;
  const gate = typeof review?.gate === "string" && review.gate ? review.gate : null;

  if (receipt) {
    return {
      result,
      reviewRef: createReviewRef({
        association: REVIEW_ASSOCIATION.OFFICIAL,
        authority: REVIEW_AUTHORITY.GENTLE,
        receipt,
        gate,
        nextTransition,
        advisoryReceiptId: advisory
      })
    };
  }

  return {
    result,
    reviewRef: createReviewRef({
      association: REVIEW_ASSOCIATION.PENDING,
      authority: REVIEW_AUTHORITY.NONE,
      gate,
      nextTransition,
      advisoryReceiptId: advisory
    })
  };
}
