/**
 * Official Gentle review status v2/v3 only. Never read authority inventory.
 */
import { SUPPORTED_CONTRACT } from "../observability/gentle-probe.js";

export const REVIEW_STATUS_SCHEMAS = Object.freeze([
  "gentle-ai.review-integration.status/v2",
  "gentle-ai.review-integration.status/v3"
]);

const INVENTORY_SCHEMA = "gentle-ai.review-authority-status/v1";

export const REVIEW_STATUS_ARGS = Object.freeze([
  "review",
  "status",
  "--contract",
  SUPPORTED_CONTRACT,
  "--next-transition"
]);

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function publishedReceipt(receiptField) {
  if (typeof receiptField === "string" && receiptField) return receiptField;
  if (!isObject(receiptField)) return null;
  if (typeof receiptField.id === "string" && receiptField.id) return receiptField.id;
  if (typeof receiptField.digest === "string" && receiptField.digest) return receiptField.digest;
  return null;
}

function publishedGate(payload) {
  if (typeof payload.gate === "string" && payload.gate) return payload.gate;
  if (isObject(payload.receipt) && typeof payload.receipt.gate === "string" && payload.receipt.gate) {
    return payload.receipt.gate;
  }
  return null;
}

/**
 * Fail closed unless schema/contract are official. Pass next_transition through unaltered.
 */
export function mapOfficialReviewStatus(payload) {
  if (!isObject(payload)) {
    return { ok: false, error: "gentle_incompatible", review: null, nextTransition: null };
  }
  if (
    payload.schema === INVENTORY_SCHEMA
    || payload.authoritative === true
    || Array.isArray(payload.entries)
  ) {
    return { ok: false, error: "gentle_incompatible", review: null, nextTransition: null };
  }
  if (!REVIEW_STATUS_SCHEMAS.includes(payload.schema)) {
    return { ok: false, error: "gentle_incompatible", review: null, nextTransition: null };
  }
  if (payload.contract != null && payload.contract !== SUPPORTED_CONTRACT) {
    return { ok: false, error: "gentle_incompatible", review: null, nextTransition: null };
  }

  const nextTransition = Object.prototype.hasOwnProperty.call(payload, "next_transition")
    ? payload.next_transition
    : null;
  const receipt = publishedReceipt(payload.receipt);
  const gate = publishedGate(payload);
  const applicability = typeof payload.applicability === "string" ? payload.applicability : null;
  const action = typeof payload.action === "string" ? payload.action : null;
  const receiptStatus = isObject(payload.receipt) && typeof payload.receipt.status === "string"
    ? payload.receipt.status
    : null;

  const review = (receipt || gate || applicability || action)
    ? {
        lineageId: null,
        state: applicability ?? action,
        status: receiptStatus,
        receipt,
        gate
      }
    : null;

  return { ok: true, error: null, review, nextTransition };
}
