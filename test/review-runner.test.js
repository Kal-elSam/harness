import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  REVIEW_STATES, REVIEW_VALIDATION_ERROR_CODES, REVIEW_SNAPSHOT_ERROR_CODES,
  ReviewValidationError, ReviewSnapshotError, assertReceiptSecretFree, loadReviewReceipt,
  resolveReviewAgent, resolveReviewExitCode, runReview, REVIEW_RUNNER_ERROR_CODES
} from "../src/global/runtime/review/index.js";

const snap = (over = {}) => ({
  version: 1, mode: "working-tree", cwd: "/repo", headSha: "abc", base: null, commit: null,
  fingerprint: "fp1234567890abcd",
  totals: { fileCount: 1, changedLines: 1, diffBytes: 10 },
  files: [{ path: "a.js", sourcePath: null, status: "M", hash: "h", changedLines: 1 }],
  excluded: [], ...over
});
const finding = (severity = "medium") => ({
  id: "f1", severity, title: "t", path: "a.js", line: null, problem: "p", recommendation: "r"
});

test("runner: agent gate before snapshot, exits, drift stale, secret-free", async () => {
  assert.equal(resolveReviewAgent("codex"), "codex");
  assert.equal(resolveReviewAgent("pi"), "pi");
  assert.throws(() => resolveReviewAgent("cursor"), (e) => e.code === REVIEW_RUNNER_ERROR_CODES.UNKNOWN_AGENT);
  assert.equal(resolveReviewExitCode({ state: REVIEW_STATES.COMPLETED, findings: [finding("low")] }), 0);
  assert.equal(resolveReviewExitCode({
    state: REVIEW_STATES.COMPLETED, findings: [finding("medium")], failOn: "medium"
  }), 1);
  assert.equal(resolveReviewExitCode({
    state: REVIEW_STATES.COMPLETED, findings: [finding("low")], failOn: "high"
  }), 0);
  assert.equal(resolveReviewExitCode({ state: REVIEW_STATES.STALE, findings: [finding("high")] }), 2);

  const homeDir = await mkdtemp(join(tmpdir(), "kairo-review-runner-"));
  let snapCalls = 0;
  await assert.rejects(
    () => runReview({
      cwd: "/repo", agent: "cursor",
      resolveSnapshot: async () => { snapCalls += 1; return snap(); }
    }),
    (e) => e.code === REVIEW_RUNNER_ERROR_CODES.UNKNOWN_AGENT
  );
  assert.equal(snapCalls, 0);

  const ok = await runReview({
    cwd: "/repo", agent: "pi", homeDir, failOn: "high",
    resolveSnapshot: async () => { snapCalls += 1; return snap(); },
    detectDrift: async () => ({ stale: false }),
    runPi: async () => ({ findings: [finding("medium")], warnings: [], usage: null, model: "m" }),
    runCodex: async () => { throw new Error("codex must not run"); }
  });
  assert.equal(snapCalls, 1);
  assert.equal(ok.receipt.state, REVIEW_STATES.COMPLETED);
  assert.equal(ok.exitCode, 0);
  assert.equal(ok.receipt.agentId, "pi");
  assert.equal(ok.receipt.model, "m");
  assert.doesNotMatch(JSON.stringify(ok), /prompt|transcript|diff --git|"patch"/);
  assertReceiptSecretFree(ok.receipt);

  const threshold = await runReview({
    cwd: "/repo", agent: "codex", homeDir, failOn: "low",
    resolveSnapshot: async () => snap(),
    detectDrift: async () => ({ stale: false }),
    runCodex: async () => ({ findings: [finding("low")], warnings: [], usage: null, model: null })
  });
  assert.equal(threshold.exitCode, 1);

  const stale = await runReview({
    cwd: "/repo", agent: "codex", homeDir, failOn: "low",
    resolveSnapshot: async () => snap(),
    detectDrift: async () => ({ stale: true }),
    runCodex: async () => ({ findings: [finding("low")], warnings: [], usage: null, model: null })
  });
  assert.equal(stale.receipt.state, REVIEW_STATES.STALE);
  assert.equal(stale.exitCode, 2);
  assert.equal((await loadReviewReceipt(stale.receipt.reviewId, { homeDir })).state, "stale");

  const invalid = await runReview({
    cwd: "/repo", agent: "pi", homeDir,
    resolveSnapshot: async () => snap(),
    detectDrift: async () => ({ stale: false }),
    runPi: async () => {
      throw new ReviewValidationError("bad", { code: REVIEW_VALIDATION_ERROR_CODES.INVALID_OUTPUT });
    }
  });
  assert.equal(invalid.receipt.state, REVIEW_STATES.INVALID);
  assert.equal(invalid.exitCode, 2);

  await assert.rejects(
    () => runReview({
      cwd: "/repo", agent: "pi", base: "main", commit: "deadbeef",
      resolveSnapshot: async ({ base, commit }) => {
        if (base && commit) {
          throw new ReviewSnapshotError("mutex", { code: REVIEW_SNAPSHOT_ERROR_CODES.INVALID_SCOPE });
        }
        return snap();
      }
    }),
    (e) => e.code === REVIEW_SNAPSHOT_ERROR_CODES.INVALID_SCOPE
  );
});
