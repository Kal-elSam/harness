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

function finding() {
  return validateReviewOutput({
    findings: [{
      severity: "medium", title: "Style", path: "a.js", line: null,
      problem: "p", recommendation: "r"
    }]
  }, snapshot()).findings;
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
  assert.throws(
    () => validateReviewOutput("{", snapshot()),
    (e) => e.code === REVIEW_VALIDATION_ERROR_CODES.INVALID_OUTPUT
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
});

test("assertReceiptSecretFree rejects nested forbidden keys and unknown shapes", () => {
  const base = buildReviewReceipt({
    reviewId: createReviewId(), agentId: "codex", snapshot: snapshot(), findings: finding()
  });
  assert.throws(
    () => assertReceiptSecretFree({ ...base, prompt: "secret" }),
    (e) => e.code === REVIEW_VALIDATION_ERROR_CODES.FORBIDDEN_FIELD
  );
  assert.throws(
    () => assertReceiptSecretFree({
      ...base,
      findings: [{ ...base.findings[0], raw: "leak" }]
    }),
    (e) => e.code === REVIEW_VALIDATION_ERROR_CODES.FORBIDDEN_FIELD
  );
  assert.throws(
    () => assertReceiptSecretFree({
      ...base,
      usage: { ...base.usage, transcript: "nope" }
    }),
    (e) => e.code === REVIEW_VALIDATION_ERROR_CODES.FORBIDDEN_FIELD
  );
  assert.throws(
    () => assertReceiptSecretFree({ ...base, extra: true }),
    (e) => e.code === REVIEW_VALIDATION_ERROR_CODES.FORBIDDEN_FIELD
  );
});

test("receipts are write-once, atomic, and listed by createdAt then limit", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-review-receipts-"));
  assert.equal(harnessHomePaths(homeDir).reviewsDir, join(homeDir, ".harness", "reviews"));
  const older = buildReviewReceipt({
    reviewId: createReviewId(), agentId: "codex", snapshot: snapshot(),
    findings: finding(), createdAt: "2026-01-01T00:00:00.000Z"
  });
  const newer = buildReviewReceipt({
    reviewId: createReviewId(), agentId: "pi", snapshot: snapshot(),
    findings: finding(), createdAt: "2026-06-01T00:00:00.000Z"
  });

  const saved = await saveReviewReceipt(older, { homeDir });
  assert.equal(JSON.parse(await readFile(saved.path, "utf8")).reviewId, older.reviewId);
  assert.equal((await readdir(join(homeDir, ".harness", "reviews", older.reviewId)))
    .filter((n) => n.endsWith(".tmp")).length, 0);

  await assert.rejects(
    () => saveReviewReceipt({ ...older, warnings: ["again"] }, { homeDir }),
    (e) => e instanceof ReviewValidationError
      && e.code === REVIEW_VALIDATION_ERROR_CODES.RECEIPT_EXISTS
  );
  assert.deepEqual((await loadReviewReceipt(older.reviewId, { homeDir })).warnings, []);

  await saveReviewReceipt(newer, { homeDir });
  const listed = await listReviewReceipts({ homeDir, limit: 1 });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].reviewId, newer.reviewId);
  const all = await listReviewReceipts({ homeDir });
  assert.deepEqual(all.map((r) => r.reviewId), [newer.reviewId, older.reviewId]);
});
