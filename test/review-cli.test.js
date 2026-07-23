import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../src/cli.js";
import {
  REVIEW_STATES, createReviewId, listReviewReceipts, runReview
} from "../src/global/runtime/review/index.js";
import { runGlobalReview, runGlobalReviews } from "../src/global/runtime/review/review-cli.js";

const snap = () => ({
  version: 1, mode: "working-tree", cwd: "/repo", headSha: "abc", base: null, commit: null,
  fingerprint: "fp1234567890abcd",
  totals: { fileCount: 1, changedLines: 1, diffBytes: 10 },
  files: [{ path: "a.js", sourcePath: null, status: "M", hash: "h", changedLines: 1 }],
  excluded: []
});
const finding = (severity = "high") => ({
  id: "f1", severity, title: "t", path: "a.js", line: null, problem: "p", recommendation: "r"
});

test("cli: parse flags, consent cancel, list/show, exit codes", async () => {
  const parsed = parseArgs([
    "review", "--agent", "codex", "--base", "main", "--fail-on", "medium", "--json"
  ]);
  assert.equal(parsed.command, "review");
  assert.equal(parsed.options.agent, "codex");
  assert.equal(parsed.options.base, "main");
  assert.equal(parsed.options.failOn, "medium");
  assert.equal(parseArgs(["review", "--agent", "pi", "--commit", "abc"]).options.commit, "abc");
  const both = parseArgs(["review", "--agent", "pi", "--base", "main", "--commit", "abc"]);
  assert.equal(both.options.base, "main");
  assert.equal(both.options.commit, "abc");

  const show = parseArgs(["reviews", "show", "rev-aaaaaaaaaaaaaaaa"]);
  assert.equal(show.command, "reviews");
  assert.equal(show.options.reviewsAction, "show");
  assert.equal(show.options.reviewId, "rev-aaaaaaaaaaaaaaaa");
  assert.equal(parseArgs(["reviews", "list", "--limit", "3"]).options.limit, 3);

  const homeDir = await mkdtemp(join(tmpdir(), "kairo-review-cli-"));
  const prev = process.exitCode;
  process.exitCode = undefined;
  let ran = false;
  const cancelled = await runGlobalReview({
    cwd: "/repo", agent: "pi", includePrivate: true, interactive: true, json: true
  }, { version: "0.7.0" }, {
    homeDir,
    prompt: async () => false,
    runReview: async () => { ran = true; throw new Error("no"); }
  });
  assert.equal(cancelled.cancelled, true);
  assert.equal(ran, false);
  assert.equal(process.exitCode, 2);
  assert.equal((await listReviewReceipts({ homeDir })).length, 0);

  process.exitCode = undefined;
  const noTty = await runGlobalReview({
    cwd: "/repo", agent: "pi", includePrivate: true, interactive: false, json: true
  }, { version: "0.7.0" }, {
    homeDir,
    runReview: async () => { ran = true; throw new Error("no"); }
  });
  assert.equal(noTty.exitCode, 2);
  assert.match(String(noTty.error?.message ?? ""), /TTY|--yes|--confirm/);
  assert.equal(ran, false);

  process.exitCode = undefined;
  const unknown = await runGlobalReview({
    cwd: "/repo", agent: "cursor", json: true
  }, { version: "0.7.0" }, {
    homeDir,
    runReview: async () => {
      throw Object.assign(new Error('Unknown review agent "cursor".'), { code: "unknown_agent" });
    }
  });
  assert.equal(unknown.exitCode, 2);
  assert.doesNotMatch(JSON.stringify(unknown.error?.message ?? ""), /prompt|transcript/);

  const seeded = await runReview({
    cwd: "/repo", agent: "codex", homeDir, createId: () => "rev-bbbbbbbbbbbbbbbb",
    resolveSnapshot: async () => snap(),
    detectDrift: async () => ({ stale: false }),
    runCodex: async () => ({
      findings: [finding("high")], warnings: [], usage: null, model: null
    })
  });
  assert.equal(seeded.receipt.state, REVIEW_STATES.COMPLETED);

  process.exitCode = undefined;
  const listed = await runGlobalReviews({ reviewsAction: "list", limit: 1, json: true }, {}, { homeDir });
  assert.equal(listed.receipts.length, 1);
  assert.doesNotMatch(JSON.stringify(listed), /prompt|transcript|diff --git/);

  process.exitCode = undefined;
  const shown = await runGlobalReviews({
    reviewsAction: "show", reviewId: seeded.receipt.reviewId, json: true
  }, {}, { homeDir });
  assert.equal(shown.receipt.reviewId, seeded.receipt.reviewId);

  process.exitCode = undefined;
  await assert.rejects(
    () => runGlobalReviews({ reviewsAction: "show", reviewId: "bad-id" }, {}, { homeDir }),
    /Invalid review id/
  );
  assert.equal(process.exitCode, 2);

  process.exitCode = undefined;
  await assert.rejects(
    () => runGlobalReviews({ reviewsAction: "show", reviewId: createReviewId() }, {}, { homeDir }),
    /not found/
  );
  assert.equal(process.exitCode, 2);

  process.exitCode = undefined;
  const yesPath = await runGlobalReview({
    cwd: "/repo", agent: "pi", includePrivate: true, yes: true, json: true, failOn: "high"
  }, { version: "0.7.0" }, {
    homeDir,
    runReview: async (opts) => {
      assert.equal(opts.privateConfirmed, true);
      assert.equal(opts.failOn, "high");
      return { receipt: seeded.receipt, exitCode: 1 };
    }
  });
  assert.equal(yesPath.exitCode, 1);

  process.exitCode = undefined;
  const okPath = await runGlobalReview({
    cwd: "/repo", agent: "codex", json: true
  }, { version: "0.7.0" }, {
    homeDir,
    runReview: async () => ({ receipt: seeded.receipt, exitCode: 0 })
  });
  assert.equal(okPath.exitCode, 0);
  process.exitCode = prev;
});
