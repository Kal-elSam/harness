import assert from "node:assert/strict";
import test from "node:test";
import { SUPPORTED_CONTRACT } from "../src/global/observability/gentle-probe.js";
import { WORKFLOW_KIND } from "../src/global/control-plane/constants.js";
import {
  GENTLE_224_BOOTSTRAP,
  GENTLE_230_BOOTSTRAP,
  argvFromBootstrap,
  mapOfficialReviewStatus
} from "../src/global/control-plane/review-status.js";
import { loadGentleWorkflow } from "../src/global/control-plane/gentle-adapters.js";

const BIN = "/usr/bin/gentle-ai";
const REPO = "/tmp/repo";
const connectedProbe = {
  state: "available",
  contractCompatible: true,
  diagnostics: [],
  evidence: [{ kind: "binary", path: BIN }, { kind: "bootstrap", command: GENTLE_224_BOOTSTRAP }]
};

const nextTransition = {
  kind: "execute",
  reason_code: "fresh_target_ready",
  execute: {
    operation: "review.start",
    command: "gentle-ai review start --contract=gentle-ai.review-integration/v2 --consent=relay"
  }
};

function v3Status(extra = {}) {
  return {
    schema: "gentle-ai.review-integration.status/v3",
    contract: SUPPORTED_CONTRACT,
    applicability: "unrelated",
    receipt: { status: "not_applicable" },
    action: "start",
    candidates: [],
    next_transition: nextTransition,
    ...extra
  };
}

test("mapOfficialReviewStatus passes next_transition through unaltered", () => {
  const mapped = mapOfficialReviewStatus(v3Status());
  assert.equal(mapped.ok, true);
  assert.deepEqual(mapped.nextTransition, nextTransition);
  assert.equal(mapped.review.receipt, null);
  assert.equal(mapped.review.lineageId, null);
  assert.equal(mapped.review.state, "unrelated");
});

test("mapOfficialReviewStatus fails closed on inventory and unknown schema", () => {
  assert.equal(mapOfficialReviewStatus({
    authoritative: true,
    entries: [{ revision: "sha256:abc", lineage_id: "rev-1", status: "recovered" }]
  }).ok, false);
  assert.equal(mapOfficialReviewStatus({
    schema: "gentle-ai.review-authority-status/v1",
    entries: []
  }).ok, false);
  assert.equal(mapOfficialReviewStatus({
    schema: "gentle-ai.review-integration.status/v9",
    contract: SUPPORTED_CONTRACT
  }).ok, false);
  assert.equal(mapOfficialReviewStatus(null).ok, false);
});

test("mapOfficialReviewStatus publishes receipt only from Gentle fields", () => {
  const mapped = mapOfficialReviewStatus(v3Status({
    receipt: { id: "sha256:published", status: "bound", gate: "pre-commit" }
  }));
  assert.equal(mapped.review.receipt, "sha256:published");
  assert.equal(mapped.review.gate, "pre-commit");
  assert.equal(mapped.review.status, "bound");
});

test("loadGentleWorkflow uses contracted review status and ignores inventory", async () => {
  const expected = argvFromBootstrap(GENTLE_224_BOOTSTRAP, { repo: REPO, binaryPath: BIN });
  const result = await loadGentleWorkflow({
    cwd: REPO,
    probe: async () => connectedProbe,
    runCommand(args) {
      if (args[0] === "sdd-status") {
        return { ok: true, payload: { schemaName: "gentle-ai.sdd-status", changeName: null } };
      }
      assert.deepEqual(args, expected.argv);
      return { ok: true, payload: v3Status() };
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.workflow.kind, WORKFLOW_KIND.REVIEW);
  assert.deepEqual(result.workflow.nextTransition, nextTransition);
  assert.equal(result.workflow.review.lineageId, null);
});

test("argvFromBootstrap: 2.2.4 v2.0, 2.3.0 v2.1, fail closed", () => {
  const opts = { repo: REPO, binaryPath: BIN };
  const v20 = argvFromBootstrap(GENTLE_224_BOOTSTRAP, opts);
  assert.equal(v20.argv.includes("--agent"), false);
  assert.deepEqual(v20.argv, ["review", "status", "--cwd", REPO, "--contract", "gentle-ai.review-integration/v2", "--next-transition"]);
  assert.deepEqual(
    argvFromBootstrap(GENTLE_230_BOOTSTRAP, opts).argv,
    ["review", "status", "--cwd", REPO, "--contract", "gentle-ai.review-integration/v2", "--agent", "claude-code", "--next-transition"]
  );
  assert.equal(argvFromBootstrap("gentle-ai review start --cwd <repo>", opts).ok, false);
  assert.equal(argvFromBootstrap("gentle-ai review status --cwd <repo> | rm", opts).ok, false);
  assert.equal(argvFromBootstrap(GENTLE_224_BOOTSTRAP, { repo: REPO, binaryPath: "gentle-ai" }).ok, false);
});
