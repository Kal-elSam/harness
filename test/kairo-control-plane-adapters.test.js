import assert from "node:assert/strict";
import test from "node:test";
import {
  extractJsonPayload,
  mapReviewStatusToReview,
  mapSddStatusToWorkflow
} from "../src/global/control-plane/gentle-adapters.js";
import {
  NO_ACTIVE_WORKFLOW,
  WORKFLOW_KIND
} from "../src/global/control-plane/constants.js";

test("extractJsonPayload reads fenced gentle sdd-status JSON", () => {
  const text = `## SDD Status\n\n### JSON\n\`\`\`json\n{"schemaName":"gentle-ai.sdd-status","changeName":null,"next":"sdd-new"}\n\`\`\`\n`;
  assert.deepEqual(extractJsonPayload(text), {
    schemaName: "gentle-ai.sdd-status",
    changeName: null,
    next: "sdd-new"
  });
});

test("mapSddStatusToWorkflow stays none without active change", () => {
  const workflow = mapSddStatusToWorkflow({
    schemaName: "gentle-ai.sdd-status",
    changeName: null,
    next: "sdd-new"
  });
  assert.equal(workflow.kind, WORKFLOW_KIND.NONE);
  assert.equal(workflow.active, false);
  assert.equal(workflow.label, NO_ACTIVE_WORKFLOW);
});

test("mapSddStatusToWorkflow surfaces active SDD phase and next", () => {
  const workflow = mapSddStatusToWorkflow({
    changeName: "control-plane",
    phase: "sdd-spec",
    next: "sdd-design"
  });
  assert.equal(workflow.kind, WORKFLOW_KIND.SDD);
  assert.equal(workflow.active, true);
  assert.equal(workflow.phase, "sdd-spec");
  assert.equal(workflow.nextTransition, "sdd-design");
});

test("mapSddStatusToWorkflow accepts explicit Gentle direct/delegated route only", () => {
  assert.equal(mapSddStatusToWorkflow({ route: "direct" }).kind, WORKFLOW_KIND.DIRECT);
  assert.equal(mapSddStatusToWorkflow({ route: "delegated" }).kind, WORKFLOW_KIND.DELEGATED);
  assert.equal(mapSddStatusToWorkflow({ goal: "x" }).kind, WORKFLOW_KIND.NONE);
});

test("mapReviewStatusToReview requires authoritative receipt evidence", () => {
  assert.equal(mapReviewStatusToReview({ authoritative: false, entries: [] }), null);
  assert.equal(mapReviewStatusToReview({
    authoritative: true,
    entries: [{ status: "superseded", state: "approved" }]
  }), null);
  const review = mapReviewStatusToReview({
    authoritative: true,
    entries: [{
      status: "active",
      state: "approved",
      lineage_id: "rev-1",
      revision: "sha256:abc",
      gate: "pre-commit"
    }]
  });
  assert.equal(review.receipt, "sha256:abc");
  assert.equal(review.gate, "pre-commit");
  assert.equal(review.lineageId, "rev-1");
});
