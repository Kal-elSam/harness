import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "../src/cli.js";
import {
  REVIEW_SCOPE_MODES, REVIEW_STATES,
  buildReviewReceipt, createReviewId, detectReviewSnapshotDrift,
  loadReviewReceipt, resolveReviewSnapshot, saveReviewReceipt,
  verifyStagedReviewReceipt
} from "../src/global/runtime/review/index.js";
import { runGlobalReviews } from "../src/global/runtime/review/review-cli.js";

async function tempRepo() {
  const root = await mkdtemp(join(tmpdir(), "kairo-rdd-01-"));
  for (const args of [
    ["init", "--template="],
    ["config", "user.email", "t@e.com"],
    ["config", "user.name", "T"]
  ]) {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr || r.stdout);
  }
  return root;
}

function git(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r.stdout.trim();
}

async function commitAll(cwd, message) {
  git(cwd, ["add", "-A"]);
  git(cwd, ["commit", "-m", message]);
  return git(cwd, ["rev-parse", "HEAD"]);
}

test("RDD01: --commit hashes come from requested sha, not HEAD", async () => {
  const root = await tempRepo();
  await writeFile(join(root, "a.js"), "v1\n");
  const sha1 = await commitAll(root, "one");
  await writeFile(join(root, "a.js"), "v2\n");
  await commitAll(root, "two");

  const snap = await resolveReviewSnapshot({ cwd: root, commit: sha1 });
  assert.equal(snap.mode, REVIEW_SCOPE_MODES.COMMIT);
  const file = snap.files.find((f) => f.path === "a.js");
  assert.ok(file, "a.js in commit snapshot");
  const expected = git(root, ["rev-parse", `${sha1}:a.js`]);
  const headBlob = git(root, ["rev-parse", "HEAD:a.js"]);
  assert.notEqual(expected, headBlob);
  assert.equal(file.hash, expected);
});

test("RDD01: staged candidate ignores unstaged-only edits; staged edits invalidate", async () => {
  const root = await tempRepo();
  await writeFile(join(root, "a.js"), "base\n");
  await commitAll(root, "seed");
  await writeFile(join(root, "a.js"), "staged\n");
  git(root, ["add", "a.js"]);
  await writeFile(join(root, "b.js"), "new-staged\n");
  git(root, ["add", "b.js"]);

  const first = await resolveReviewSnapshot({ cwd: root, staged: true });
  assert.equal(first.mode, REVIEW_SCOPE_MODES.STAGED);
  assert.ok(first.files.some((f) => f.path === "a.js"));
  assert.ok(first.files.some((f) => f.path === "b.js"));
  assert.ok(first.files.every((f) => typeof f.mode === "string" && f.mode.length > 0));
  assert.ok(first.files.every((f) => typeof f.hash === "string" && f.hash.length > 0));

  await writeFile(join(root, "a.js"), "unstaged-only\n");
  const afterUnstaged = await resolveReviewSnapshot({ cwd: root, staged: true });
  assert.equal(afterUnstaged.fingerprint, first.fingerprint);
  assert.equal((await detectReviewSnapshotDrift(first)).stale, false);

  await writeFile(join(root, "b.js"), "staged-changed\n");
  git(root, ["add", "b.js"]);
  assert.equal((await detectReviewSnapshotDrift(first)).stale, true);
});

test("RDD01: add/delete/rename/modes bind into staged fingerprint", async () => {
  const root = await tempRepo();
  await writeFile(join(root, "keep.js"), "k\n");
  await writeFile(join(root, "gone.js"), "g\n");
  await writeFile(join(root, "old.js"), "o\n");
  await writeFile(join(root, "mode.js"), "m\n");
  await commitAll(root, "seed");

  await writeFile(join(root, "added.js"), "a\n");
  git(root, ["add", "added.js"]);
  git(root, ["rm", "gone.js"]);
  git(root, ["mv", "old.js", "renamed.js"]);
  await chmod(join(root, "mode.js"), 0o755);
  git(root, ["add", "mode.js"]);

  const snap = await resolveReviewSnapshot({ cwd: root, staged: true });
  const byPath = Object.fromEntries(snap.files.map((f) => [f.path, f]));
  assert.ok(byPath["added.js"]);
  assert.ok(byPath["gone.js"]);
  assert.match(byPath["gone.js"].status, /D/);
  assert.ok(byPath["renamed.js"]);
  assert.equal(byPath["renamed.js"].sourcePath, "old.js");
  assert.ok(byPath["mode.js"]);
  assert.match(byPath["mode.js"].mode, /755$/);

  const fp = snap.fingerprint;
  git(root, ["reset", "HEAD", "mode.js"]);
  await chmod(join(root, "mode.js"), 0o644);
  git(root, ["add", "mode.js"]);
  const afterMode = await resolveReviewSnapshot({ cwd: root, staged: true });
  assert.notEqual(afterMode.fingerprint, fp);
});

test("RDD01: receipt v2 for staged; v1 still loads; verify --staged fail-closed", async () => {
  const root = await tempRepo();
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-rdd-home-"));
  await writeFile(join(root, "a.js"), "base\n");
  await commitAll(root, "seed");
  await writeFile(join(root, "a.js"), "staged\n");
  git(root, ["add", "a.js"]);

  const snapshot = await resolveReviewSnapshot({ cwd: root, staged: true });
  const v2 = buildReviewReceipt({
    reviewId: createReviewId(), agentId: "codex", snapshot, findings: []
  });
  assert.equal(v2.version, 2);
  assert.equal(v2.snapshot.mode, REVIEW_SCOPE_MODES.STAGED);
  assert.ok(v2.snapshot.files[0].mode);
  await saveReviewReceipt(v2, { homeDir });

  const v1Id = createReviewId();
  const v1 = {
    version: 1,
    reviewId: v1Id,
    agentId: "pi",
    model: null,
    state: REVIEW_STATES.COMPLETED,
    snapshot: {
      mode: "working-tree",
      headSha: "abc",
      base: null,
      commit: null,
      fingerprint: "fp",
      totals: { fileCount: 1, changedLines: 1, diffBytes: 10 },
      files: [{ path: "a.js", sourcePath: null, status: "M", hash: "h", changedLines: 1 }],
      excluded: []
    },
    findings: [],
    warnings: [],
    usage: null,
    timings: null,
    cliVersion: null,
    createdAt: "2026-01-01T00:00:00.000Z"
  };
  await saveReviewReceipt(v1, { homeDir });
  const loadedV1 = await loadReviewReceipt(v1Id, { homeDir });
  assert.equal(loadedV1.version, 1);
  assert.equal(loadedV1.snapshot.files[0].mode, undefined);

  const ok = await verifyStagedReviewReceipt(v2, { cwd: root });
  assert.equal(ok.ok, true);
  assert.equal(ok.stale, false);

  await writeFile(join(root, "a.js"), "index-changed\n");
  git(root, ["add", "a.js"]);
  const bad = await verifyStagedReviewReceipt(v2, { cwd: root });
  assert.equal(bad.ok, false);
  assert.equal(bad.stale, true);

  const parsed = parseArgs(["reviews", "verify", v2.reviewId, "--staged", "--json"]);
  assert.equal(parsed.options.reviewsAction, "verify");
  assert.equal(parsed.options.reviewId, v2.reviewId);
  assert.equal(parsed.options.staged, true);
  assert.equal(parseArgs(["review", "--agent", "pi", "--staged"]).options.staged, true);

  const prev = process.exitCode;
  process.exitCode = undefined;
  const verified = await runGlobalReviews({
    reviewsAction: "verify", reviewId: v2.reviewId, staged: true, json: true, cwd: root
  }, {}, { homeDir });
  assert.equal(verified.ok, false);
  assert.equal(verified.stale, true);
  assert.equal(process.exitCode, 2);
  process.exitCode = prev;
});

test("RDD01: concurrent receipt writes remain atomic write-once", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-rdd-race-"));
  const reviewId = createReviewId();
  const mk = (w) => buildReviewReceipt({
    reviewId,
    agentId: "codex",
    snapshot: {
      mode: REVIEW_SCOPE_MODES.STAGED,
      headSha: "abc",
      base: null,
      commit: null,
      fingerprint: "fp",
      totals: { fileCount: 1, changedLines: 1, diffBytes: 10 },
      files: [{
        path: "a.js", sourcePath: null, status: "M", hash: "h", mode: "100644", changedLines: 1
      }],
      excluded: []
    },
    findings: [],
    warnings: [w]
  });
  const settled = await Promise.allSettled([
    saveReviewReceipt(mk("a"), { homeDir }),
    saveReviewReceipt(mk("b"), { homeDir })
  ]);
  assert.equal(settled.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(settled.filter((r) => r.status === "rejected").length, 1);
  const loaded = await loadReviewReceipt(reviewId, { homeDir });
  assert.equal(loaded.version, 2);
  assert.ok(loaded.warnings[0] === "a" || loaded.warnings[0] === "b");
});
