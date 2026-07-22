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
  assert.equal((await listReviewReceipts({ homeDir, limit: 1 }))[0].reviewId, newer.reviewId);
  assert.deepEqual(
    (await listReviewReceipts({ homeDir })).map((r) => r.reviewId),
    [newer.reviewId, older.reviewId]
  );
});

test("concurrent same reviewId yields one success and one RECEIPT_EXISTS", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-review-race-"));
  const reviewId = createReviewId();
  const mk = (w) => buildReviewReceipt({
    reviewId, agentId: "codex", snapshot: snapshot(), findings: finding(), warnings: [w]
  });
  const settled = await Promise.allSettled([
    saveReviewReceipt(mk("first"), { homeDir }), saveReviewReceipt(mk("second"), { homeDir })
  ]);
  assert.equal(settled.filter((r) => r.status === "fulfilled").length, 1);
  const rejected = settled.find((r) => r.status === "rejected");
  assert.ok(rejected.reason instanceof ReviewValidationError);
  assert.equal(rejected.reason.code, REVIEW_VALIDATION_ERROR_CODES.RECEIPT_EXISTS);
  const w = (await loadReviewReceipt(reviewId, { homeDir })).warnings[0];
  assert.ok(w === "first" || w === "second");
});

test("listReviewReceipts ties on createdAt break by reviewId ascending", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-review-tie-"));
  const createdAt = "2026-03-01T00:00:00.000Z";
  const highId = "rev-ffffffffffffffffffffffff";
  const lowId = "rev-000000000000000000000001";
  await saveReviewReceipt(buildReviewReceipt({
    reviewId: highId, agentId: "codex", snapshot: snapshot(), findings: finding(), createdAt
  }), { homeDir });
  await saveReviewReceipt(buildReviewReceipt({
    reviewId: lowId, agentId: "pi", snapshot: snapshot(), findings: finding(), createdAt
  }), { homeDir });
  assert.deepEqual((await listReviewReceipts({ homeDir })).map((r) => r.reviewId), [lowId, highId]);
  assert.deepEqual((await listReviewReceipts({ homeDir, limit: 1 })).map((r) => r.reviewId), [lowId]);
});
