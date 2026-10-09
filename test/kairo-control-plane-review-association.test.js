import assert from "node:assert/strict";
import test from "node:test";
import { SUPPORTED_CONTRACT } from "../src/global/observability/gentle-probe.js";
import { PROVIDER } from "../src/global/control-plane/constants.js";
import { mapOfficialReviewStatus } from "../src/global/control-plane/review-status.js";
import { createMinionResult } from "../src/global/runtime/orchestration/orch-types.js";
import { createWorkResult } from "../src/global/kernel/contracts.js";
import {
  APPROVAL_PROVENANCE,
  REVIEW_ASSOCIATION,
  REVIEW_AUTHORITY,
  REVIEW_REF_SCHEMA,
  associateResultWithGentleReview,
  isHostNeutralWorkResult
} from "../src/global/control-plane/review-association.js";

const nextTransition = {
  kind: "execute",
  reason_code: "fresh_target_ready",
  execute: {
    operation: "review.start",
    command: "gentle-ai review start --contract=gentle-ai.review-integration/v2 --consent=relay"
  }
};

const publishedCandidates = [
  { id: "cand-1", path: "src/a.js" }
];

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
    candidates: publishedCandidates,
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
    candidates: publishedCandidates,
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
  assert.equal(linked.approval.provenance, APPROVAL_PROVENANCE.ADVISORY);
  assert.equal(linked.approval.gentleStatus, null);
  assert.equal(linked.approval.teamStrategyApproved, false);
  assert.equal("approved" in linked.approval, false);
  assert.deepEqual(linked.gentleContext, {
    applicability: "candidate",
    action: "start",
    candidates: publishedCandidates
  });
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
  assert.equal(linked.approval.provenance, APPROVAL_PROVENANCE.GENTLE_RECEIPT);
  assert.equal(linked.approval.gentleStatus, "bound");
  assert.equal("approved" in linked.approval, false);
  assert.deepEqual(linked.gentleContext.candidates, publishedCandidates);
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
  assert.equal(linked.approval.provenance, APPROVAL_PROVENANCE.ADVISORY);
  assert.equal(linked.gentleContext, null);
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
  assert.equal(linked.approval.provenance, APPROVAL_PROVENANCE.ADVISORY);
  assert.equal(linked.gentleContext, null);
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
  assert.equal(linked.approval.provenance, APPROVAL_PROVENANCE.ADVISORY);
  assert.equal(linked.approval.gentleStatus, null);
  assert.equal(linked.gentleContext, null);
});

test("team strategy approve is orthogonal and never invents a review verdict", () => {
  const linked = associateResultWithGentleReview({
    result: minion(),
    provider: PROVIDER.CONNECTED,
    mappedStatus: pendingStatus(),
    rddMode: "on",
    teamStrategyApproved: true
  });
  assert.equal(linked.reviewRef.authority, REVIEW_AUTHORITY.NONE);
  assert.equal(linked.approval.provenance, APPROVAL_PROVENANCE.TEAM_STRATEGY);
  assert.equal(linked.approval.teamStrategyApproved, true);
  assert.equal(linked.approval.gentleStatus, null);
  assert.equal("approved" in linked.approval, false);
});

test("official Gentle receipt outranks team strategy for provenance, keeps the flag", () => {
  const linked = associateResultWithGentleReview({
    result: minion(),
    provider: PROVIDER.CONNECTED,
    mappedStatus: officialStatus(),
    rddMode: "on",
    teamStrategyApproved: true
  });
  assert.equal(linked.approval.provenance, APPROVAL_PROVENANCE.GENTLE_RECEIPT);
  assert.equal(linked.approval.teamStrategyApproved, true);
  assert.equal(linked.approval.gentleStatus, "bound");
});

test("host-neutral WorkResult associates without inventing summary or verdict", () => {
  const work = createWorkResult({
    ok: true,
    workerId: "worker_claude_1",
    summary: "Unit finished under host-neutral contract"
  });
  assert.equal(isHostNeutralWorkResult(work), true);
  const linked = associateResultWithGentleReview({
    result: work,
    provider: PROVIDER.CONNECTED,
    mappedStatus: officialStatus(),
    rddMode: "on"
  });
  assert.equal(linked.result.summary, "Unit finished under host-neutral contract");
  assert.equal(linked.result.workerId, "worker_claude_1");
  assert.equal(linked.reviewRef.authority, REVIEW_AUTHORITY.GENTLE);
  assert.equal(linked.approval.provenance, APPROVAL_PROVENANCE.GENTLE_RECEIPT);
  assert.equal(linked.approval.gentleStatus, "bound");
  assert.equal(linked.gentleContext.applicability, "candidate");
});

test("advisoryReceiptId accepts any non-empty string, not only rev-*", () => {
  const linked = associateResultWithGentleReview({
    result: minion(),
    provider: PROVIDER.CONNECTED,
    mappedStatus: pendingStatus(),
    rddMode: "on",
    advisoryReceiptId: "note-local-1"
  });
  assert.equal(linked.reviewRef.advisoryReceiptId, "note-local-1");
  assert.equal(linked.approval.provenance, APPROVAL_PROVENANCE.ADVISORY);
  assert.equal(linked.reviewRef.authority, REVIEW_AUTHORITY.NONE);
});

test("mapOfficialReviewStatus passes candidates and split applicability/action", () => {
  const mapped = officialStatus();
  assert.equal(mapped.ok, true);
  assert.equal(mapped.review.applicability, "candidate");
  assert.equal(mapped.review.action, "status");
  assert.deepEqual(mapped.review.candidates, publishedCandidates);
  assert.equal(mapped.review.state, "candidate");
});

function contractResult(status, extra = {}) {
  if (status === "completed") {
    return {
      ok: true,
      workerId: "worker_contract",
      status,
      summary: "Unit finished",
      error: null,
      ...extra
    };
  }
  if (status === "failed") {
    return {
      ok: false,
      workerId: "worker_contract",
      status,
      summary: null,
      error: "adapter failed",
      ...extra
    };
  }
  return {
    ok: false,
    workerId: "worker_contract",
    status: "cancelled",
    summary: null,
    error: null,
    ...extra
  };
}

test("completed/failed/cancelled contract results associate without mutation", () => {
  for (const status of ["completed", "failed", "cancelled"]) {
    const work = contractResult(status);
    assert.equal(isHostNeutralWorkResult(work), true);
    const snapshot = structuredClone(work);
    const linked = associateResultWithGentleReview({
      result: work,
      provider: PROVIDER.CONNECTED,
      mappedStatus: officialStatus(),
      rddMode: "on"
    });
    assert.equal(linked.result, work);
    assert.deepEqual(work, snapshot);
    assert.equal(linked.result.status, status);
    assert.equal(linked.reviewRef.authority, REVIEW_AUTHORITY.GENTLE);
    assert.equal(linked.approval.provenance, APPROVAL_PROVENANCE.GENTLE_RECEIPT);
    assert.equal("approved" in linked.approval, false);
    assert.equal(linked.approval.gentleStatus, "bound");
  }
});

test("terminal work status alone never grants approval provenance", () => {
  for (const status of ["completed", "failed", "cancelled"]) {
    const linked = associateResultWithGentleReview({
      result: contractResult(status),
      provider: PROVIDER.CONNECTED,
      mappedStatus: pendingStatus(),
      rddMode: "on"
    });
    assert.equal(linked.reviewRef.authority, REVIEW_AUTHORITY.NONE);
    assert.equal(linked.approval.provenance, APPROVAL_PROVENANCE.NONE);
    assert.equal(linked.approval.gentleStatus, null);
    assert.equal("approved" in linked.approval, false);
  }
});

test("authority gentle plus completed still does not invent an approved flag", () => {
  const linked = associateResultWithGentleReview({
    result: contractResult("completed"),
    provider: PROVIDER.CONNECTED,
    mappedStatus: officialStatus(),
    rddMode: "on",
    advisoryReceiptId: "rev-ffffffffffffffffffffffff"
  });
  assert.equal(linked.reviewRef.authority, REVIEW_AUTHORITY.GENTLE);
  assert.equal(linked.approval.provenance, APPROVAL_PROVENANCE.GENTLE_RECEIPT);
  assert.equal(linked.reviewRef.advisoryReceiptId, "rev-ffffffffffffffffffffffff");
  assert.notEqual(linked.reviewRef.receipt, linked.reviewRef.advisoryReceiptId);
  assert.equal("approved" in linked.approval, false);
  assert.equal("rejected" in linked.approval, false);
});

test("failed and cancelled stay advisory/official separated under RDD off and unavailable", () => {
  const failed = contractResult("failed");
  const cancelled = contractResult("cancelled");

  const rddOff = associateResultWithGentleReview({
    result: failed,
    provider: PROVIDER.CONNECTED,
    mappedStatus: officialStatus(),
    rddMode: "off",
    advisoryReceiptId: "rev-111111111111111111111111"
  });
  assert.equal(rddOff.reviewRef.association, REVIEW_ASSOCIATION.RDD_OFF);
  assert.equal(rddOff.reviewRef.authority, REVIEW_AUTHORITY.NONE);
  assert.equal(rddOff.approval.provenance, APPROVAL_PROVENANCE.ADVISORY);
  assert.equal(rddOff.gentleContext, null);
  assert.equal(rddOff.result, failed);

  const unavailable = associateResultWithGentleReview({
    result: cancelled,
    provider: PROVIDER.UNAVAILABLE,
    mappedStatus: officialStatus(),
    rddMode: "on",
    advisoryReceiptId: "rev-222222222222222222222222"
  });
  assert.equal(unavailable.reviewRef.association, REVIEW_ASSOCIATION.UNAVAILABLE);
  assert.equal(unavailable.reviewRef.authority, REVIEW_AUTHORITY.NONE);
  assert.equal(unavailable.approval.provenance, APPROVAL_PROVENANCE.ADVISORY);
  assert.equal(unavailable.gentleContext, null);
  assert.equal(unavailable.result, cancelled);
});
