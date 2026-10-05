import assert from "node:assert/strict";
import test from "node:test";
import { SUPPORTED_CONTRACT } from "../src/global/observability/gentle-probe.js";
import { PROVIDER } from "../src/global/control-plane/constants.js";
import { mapOfficialReviewStatus } from "../src/global/control-plane/review-status.js";
import { createMinionResult } from "../src/global/runtime/orchestration/orch-types.js";
import {
  REVIEW_ASSOCIATION,
  REVIEW_AUTHORITY,
  REVIEW_REF_SCHEMA,
  associateResultWithGentleReview
} from "../src/global/control-plane/review-association.js";

const nextTransition = {
  kind: "execute",
  reason_code: "fresh_target_ready",
  execute: {
    operation: "review.start",
    command: "gentle-ai review start --contract=gentle-ai.review-integration/v2 --consent=relay"
  }
};

function minion() {
  return createMinionResult({
    taskId: "task_offline_1",
    summary: "Implemented the unit",
    decisions: ["keep contract"],
    files: ["src/a.js"]
  });
}

function officialStatus(extra = {}) {
  return mapOfficialReviewStatus({
    schema: "gentle-ai.review-integration.status/v3",
    contract: SUPPORTED_CONTRACT,
    applicability: "candidate",
    action: "status",
    receipt: { id: "sha256:official", status: "bound", gate: "pre-commit" },
    next_transition: nextTransition,
    ...extra
  });
}

function pendingStatus() {
  return mapOfficialReviewStatus({
    schema: "gentle-ai.review-integration.status/v3",
    contract: SUPPORTED_CONTRACT,
    applicability: "candidate",
    action: "start",
    receipt: { status: "not_applicable" },
    next_transition: nextTransition
  });
}

test("pending review: read-only reviewRef carries next_transition without inventing a receipt", () => {
  const linked = associateResultWithGentleReview({
    result: minion(),
    provider: PROVIDER.CONNECTED,
    mappedStatus: pendingStatus(),
    rddMode: "on",
    advisoryReceiptId: "rev-aaaaaaaaaaaaaaaaaaaaaaaa"
  });
  assert.equal(linked.reviewRef.schema, REVIEW_REF_SCHEMA);
  assert.equal(linked.reviewRef.association, REVIEW_ASSOCIATION.PENDING);
  assert.equal(linked.reviewRef.authority, REVIEW_AUTHORITY.NONE);
  assert.equal(linked.reviewRef.receipt, null);
  assert.deepEqual(linked.reviewRef.nextTransition, nextTransition);
  assert.equal(linked.reviewRef.advisoryReceiptId, "rev-aaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(linked.result.taskId, "task_offline_1");
  assert.equal(Object.isFrozen(linked.reviewRef), true);
});

test("official result: Gentle receipt is authority; advisory stays separate", () => {
  const linked = associateResultWithGentleReview({
    result: minion(),
    provider: PROVIDER.CONNECTED,
    mappedStatus: officialStatus(),
    rddMode: "on",
    advisoryReceiptId: "rev-bbbbbbbbbbbbbbbbbbbbbbbb"
  });
  assert.equal(linked.reviewRef.association, REVIEW_ASSOCIATION.OFFICIAL);
  assert.equal(linked.reviewRef.authority, REVIEW_AUTHORITY.GENTLE);
  assert.equal(linked.reviewRef.receipt, "sha256:official");
  assert.equal(linked.reviewRef.gate, "pre-commit");
  assert.deepEqual(linked.reviewRef.nextTransition, nextTransition);
  assert.equal(linked.reviewRef.advisoryReceiptId, "rev-bbbbbbbbbbbbbbbbbbbbbbbb");
  assert.notEqual(linked.reviewRef.receipt, linked.reviewRef.advisoryReceiptId);
});

test("incompatible payload: fail closed with no Gentle authority", () => {
  const mapped = mapOfficialReviewStatus({
    schema: "gentle-ai.review-authority-status/v1",
    entries: []
  });
  const linked = associateResultWithGentleReview({
    result: minion(),
    provider: PROVIDER.CONNECTED,
    mappedStatus: mapped,
    rddMode: "on",
    advisoryReceiptId: "rev-cccccccccccccccccccccccc"
  });
  assert.equal(linked.reviewRef.association, REVIEW_ASSOCIATION.INCOMPATIBLE);
  assert.equal(linked.reviewRef.authority, REVIEW_AUTHORITY.NONE);
  assert.equal(linked.reviewRef.receipt, null);
  assert.equal(linked.reviewRef.nextTransition, null);
  assert.equal(linked.reviewRef.advisoryReceiptId, "rev-cccccccccccccccccccccccc");
});

test("unavailable Gentle: association unavailable, advisory never promoted", () => {
  const linked = associateResultWithGentleReview({
    result: minion(),
    provider: PROVIDER.UNAVAILABLE,
    mappedStatus: null,
    rddMode: "on",
    advisoryReceiptId: "rev-dddddddddddddddddddddddd"
  });
  assert.equal(linked.reviewRef.association, REVIEW_ASSOCIATION.UNAVAILABLE);
  assert.equal(linked.reviewRef.authority, REVIEW_AUTHORITY.NONE);
  assert.equal(linked.reviewRef.receipt, null);
  assert.equal(linked.reviewRef.nextTransition, null);
  assert.equal(linked.reviewRef.advisoryReceiptId, "rev-dddddddddddddddddddddddd");
});

test("RDD off: no Gentle authority even when status looks official", () => {
  const linked = associateResultWithGentleReview({
    result: minion(),
    provider: PROVIDER.CONNECTED,
    mappedStatus: officialStatus(),
    rddMode: "off",
    advisoryReceiptId: "rev-eeeeeeeeeeeeeeeeeeeeeeee"
  });
  assert.equal(linked.reviewRef.association, REVIEW_ASSOCIATION.RDD_OFF);
  assert.equal(linked.reviewRef.authority, REVIEW_AUTHORITY.NONE);
  assert.equal(linked.reviewRef.receipt, null);
  assert.equal(linked.reviewRef.nextTransition, null);
  assert.equal(linked.reviewRef.advisoryReceiptId, "rev-eeeeeeeeeeeeeeeeeeeeeeee");
});
