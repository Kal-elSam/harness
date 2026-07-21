import { existsSync } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { harnessHomePaths } from "../../paths.js";
import { writeAtomicJson } from "../write-atomic-json.js";
import { REVIEW_STATES } from "./review-types.js";
import { assertReceiptSecretFree } from "./review-validate.js";

export function assertSafeReviewId(reviewId) {
  if (typeof reviewId !== "string" || !/^rev-[a-f0-9]{16,32}$/.test(reviewId)) {
    throw new Error(`Invalid review id "${reviewId}".`);
  }
}

export function createReviewId() {
  return `rev-${randomBytes(12).toString("hex")}`;
}

export function reviewPaths(homeDir, reviewId) {
  assertSafeReviewId(reviewId);
  const reviewDir = join(harnessHomePaths(homeDir).reviewsDir, reviewId);
  return {
    reviewDir,
    receiptPath: join(reviewDir, "receipt.json")
  };
}

function snapshotProvenance(snapshot) {
  return {
    mode: snapshot.mode,
    headSha: snapshot.headSha,
    base: snapshot.base ?? null,
    commit: snapshot.commit ?? null,
    fingerprint: snapshot.fingerprint,
    totals: snapshot.totals,
    files: (snapshot.files ?? []).map((f) => ({
      path: f.path, status: f.status, hash: f.hash, changedLines: f.changedLines
    })),
    excluded: (snapshot.excluded ?? []).map((e) => ({ path: e.path, reason: e.reason }))
  };
}

/**
 * Build a v1 receipt: findings + provenance only (no prompt/diff/transcript/raw).
 */
export function buildReviewReceipt({
  reviewId,
  agentId,
  model = null,
  snapshot,
  state = REVIEW_STATES.COMPLETED,
  findings = [],
  warnings = [],
  usage = null,
  timings = null,
  cliVersion = null
} = {}) {
  assertSafeReviewId(reviewId);
  const receipt = {
    version: 1,
    reviewId,
    agentId,
    model,
    state,
    snapshot: snapshotProvenance(snapshot),
    findings,
    warnings,
    usage,
    timings: timings && typeof timings === "object"
      ? {
        startedAt: timings.startedAt ?? null,
        finishedAt: timings.finishedAt ?? null,
        durationMs: Number.isFinite(timings.durationMs) ? timings.durationMs : null
      }
      : null,
    cliVersion,
    createdAt: new Date().toISOString()
  };
  return assertReceiptSecretFree(receipt);
}

export async function saveReviewReceipt(receipt, { homeDir } = {}) {
  const sanitized = assertReceiptSecretFree(receipt);
  assertSafeReviewId(sanitized.reviewId);
  const { reviewDir, receiptPath } = reviewPaths(homeDir, sanitized.reviewId);
  await mkdir(reviewDir, { recursive: true });
  await writeAtomicJson(receiptPath, sanitized);
  return { path: receiptPath, receipt: sanitized };
}

export async function loadReviewReceipt(reviewId, { homeDir } = {}) {
  const { receiptPath } = reviewPaths(homeDir, reviewId);
  if (!existsSync(receiptPath)) throw new Error(`Review receipt not found: ${reviewId}`);
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  return assertReceiptSecretFree(receipt);
}

export async function listReviewReceipts({ homeDir, limit = null } = {}) {
  const dir = harnessHomePaths(homeDir).reviewsDir;
  if (!existsSync(dir)) return [];
  const ids = (await readdir(dir))
    .filter((name) => /^rev-[a-f0-9]{16,32}$/.test(name))
    .sort()
    .reverse();
  const selected = limit == null ? ids : ids.slice(0, Math.max(0, Number(limit) || 0));
  const receipts = [];
  for (const reviewId of selected) {
    try {
      receipts.push(await loadReviewReceipt(reviewId, { homeDir }));
    } catch {
      // Skip corrupt/partial directories fail-closed for list readers.
    }
  }
  return receipts;
}
