import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harnessHomePaths } from "../src/global/paths.js";
import {
  REVIEW_STATES, REVIEW_VALIDATION_ERROR_CODES, ReviewValidationError,
  assertReceiptSecretFree, buildReviewReceipt, createFindingId, createReviewId,
  listReviewReceipts, loadReviewReceipt, saveReviewReceipt, validateReviewOutput
} from "../src/global/runtime/review/index.js";

function snapshot(files = [{ path: "a.js", status: "M", hash: "h", changedLines: 1 }]) {
  return {
    mode: "working-tree", headSha: "abc", base: null, commit: null, fingerprint: "fp",
    totals: { fileCount: files.length, changedLines: 1, diffBytes: 10 },
    files, excluded: []
  };
}

test("validateReviewOutput normalizes findings and rejects broken/out-of-scope", () => {
  const ok = validateReviewOutput({
    findings: [{
      severity: "HIGH", title: "Bug", path: "a.js", line: 2,
      problem: "bad", recommendation: "fix"
    }],
    warnings: ["note"],
    usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, cost: 0.1 }
  }, snapshot());
  assert.equal(ok.findings[0].severity, "high");
  assert.equal(ok.findings[0].id, createFindingId({
    severity: "high", title: "Bug", path: "a.js", line: 2, problem: "bad"
  }));
  assert.equal(ok.warnings[0], "note");

  assert.throws(
    () => validateReviewOutput("{", snapshot()),
    (e) => e instanceof ReviewValidationError
      && e.code === REVIEW_VALIDATION_ERROR_CODES.INVALID_OUTPUT
  );
  assert.throws(
    () => validateReviewOutput({
      findings: [{
        severity: "low", title: "x", path: "missing.js", line: null,
        problem: "p", recommendation: "r"
      }]
    }, snapshot()),
    (e) => e.code === REVIEW_VALIDATION_ERROR_CODES.PATH_OUT_OF_SCOPE
  );
  assert.throws(
    () => validateReviewOutput({
      findings: [{
        severity: "nope", title: "x", path: "a.js", line: 0,
        problem: "p", recommendation: "r"
      }]
    }, snapshot()),
    (e) => e.code === REVIEW_VALIDATION_ERROR_CODES.INVALID_FINDING
  );
});

test("receipts are atomic, secret-free, and listable under reviewsDir", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-review-receipts-"));
  assert.equal(harnessHomePaths(homeDir).reviewsDir, join(homeDir, ".harness", "reviews"));
  const reviewId = createReviewId();
  const validated = validateReviewOutput({
    findings: [{
      severity: "medium", title: "Style", path: "a.js", line: null,
      problem: "p", recommendation: "r"
    }]
  }, snapshot());

  assert.throws(
    () => assertReceiptSecretFree({ reviewId, prompt: "secret" }),
    (e) => e.code === REVIEW_VALIDATION_ERROR_CODES.INVALID_OUTPUT
  );

  const receipt = buildReviewReceipt({
    reviewId,
    agentId: "codex",
    model: "test-model",
    snapshot: snapshot(),
    state: REVIEW_STATES.COMPLETED,
    findings: validated.findings,
    warnings: validated.warnings,
    usage: validated.usage,
    timings: { startedAt: "t0", finishedAt: "t1", durationMs: 12 },
    cliVersion: "0.7.0"
  });
  assert.equal(receipt.version, 1);
  assert.equal(receipt.snapshot.fingerprint, "fp");
  assert.equal(receipt.prompt, undefined);
  assert.equal(receipt.diff, undefined);
  assert.equal(receipt.transcript, undefined);

  const saved = await saveReviewReceipt(receipt, { homeDir });
  const raw = JSON.parse(await readFile(saved.path, "utf8"));
  assert.equal(raw.reviewId, reviewId);
  assert.equal(raw.findings[0].id, validated.findings[0].id);
  assert.equal((await readdir(join(homeDir, ".harness", "reviews", reviewId)))
    .filter((n) => n.endsWith(".tmp")).length, 0);

  const loaded = await loadReviewReceipt(reviewId, { homeDir });
  assert.equal(loaded.agentId, "codex");
  const listed = await listReviewReceipts({ homeDir, limit: 1 });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].reviewId, reviewId);

  // Idempotent overwrite stays parseable.
  await saveReviewReceipt({ ...receipt, warnings: ["again"] }, { homeDir });
  assert.deepEqual((await loadReviewReceipt(reviewId, { homeDir })).warnings, ["again"]);
});
