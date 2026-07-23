import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../src/cli.js";
import {
  REVIEW_STATES, createReviewId, listReviewReceipts, runReview
} from "../src/global/runtime/review/index.js";
import { runGlobalReview, runGlobalReviews } from "../src/global/runtime/review/review-cli.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const kairoBin = join(packageRoot, "bin/kairo.js");
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

function runKairo(args, homeDir) {
  return spawnSync(process.execPath, [kairoBin, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    env: { ...process.env, HOME: homeDir, HARNESS_HOME: homeDir }
  });
}

test("cli: parse flags, consent cancel, list/show, exit codes", async () => {
  const parsed = parseArgs([
    "review", "--agent", "codex", "--base", "main", "--fail-on", "medium", "--json"
  ]);
  assert.equal(parsed.command, "review");
  assert.equal(parsed.options.agent, "codex");
  assert.equal(parsed.options.base, "main");
  assert.equal(parsed.options.failOn, "medium");
  assert.equal(parseArgs(["review", "--agent", "pi", "--commit", "abc"]).options.commit, "abc");
  assert.throws(() => parseArgs(["review", "--agent", "pi", "--base"]), /Missing value for --base/);
  assert.throws(() => parseArgs(["review", "--agent", "pi", "--commit="]), /Missing value for --commit/);
  assert.throws(() => parseArgs(["review", "--agent", "pi", "--fail-on", "--json"]), /Missing value/);

  const show = parseArgs(["reviews", "show", "rev-aaaaaaaaaaaaaaaa"]);
  assert.equal(show.command, "reviews");
  assert.equal(show.options.reviewsAction, "show");
  assert.equal(show.options.reviewId, "rev-aaaaaaaaaaaaaaaa");

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

  process.exitCode = undefined;
  const badId = await runGlobalReviews({ reviewsAction: "show", reviewId: "bad-id", json: true }, {}, { homeDir });
  assert.equal(badId.exitCode, 2);
  assert.match(String(badId.error?.message ?? ""), /Invalid review id/);

  process.exitCode = undefined;
  const missing = await runGlobalReviews({
    reviewsAction: "show", reviewId: createReviewId(), json: true
  }, {}, { homeDir });
  assert.equal(missing.exitCode, 2);
  assert.match(String(missing.error?.message ?? ""), /not found/);

  process.exitCode = undefined;
  const yesPath = await runGlobalReview({
    cwd: "/repo", agent: "pi", includePrivate: true, yes: true, json: true, failOn: "high"
  }, { version: "0.7.0" }, {
    homeDir,
    runReview: async (opts) => {
      assert.equal(opts.privateConfirmed, true);
      return { receipt: seeded.receipt, exitCode: 1 };
    }
  });
  assert.equal(yesPath.exitCode, 1);
  process.exitCode = prev;
});

test("cli binary: reviews show JSON exit 2; missing flag values", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-review-bin-"));
  const bad = runKairo(["reviews", "show", "bad-id", "--json"], homeDir);
  assert.equal(bad.status, 2, bad.stderr);
  assert.equal(bad.stderr.trim(), "");
  const body = JSON.parse(bad.stdout);
  assert.equal(body.ok, false);
  assert.equal(body.exitCode, 2);
  assert.match(body.error, /Invalid review id/);
  assert.doesNotMatch(bad.stdout, /prompt|transcript|diff --git/);

  for (const flag of ["--base", "--commit", "--fail-on"]) {
    const r = runKairo(["review", "--agent", "pi", flag, "--json"], homeDir);
    assert.notEqual(r.status, 0, r.stderr || r.stdout);
    assert.match(`${r.stderr}${r.stdout}`, /Missing value/);
  }
});
