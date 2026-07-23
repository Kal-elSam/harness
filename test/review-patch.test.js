import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  REVIEW_SCOPE_MODES, filterDiffToAdmittedPaths, buildScopedReviewPatch,
  resolveReviewSnapshot
} from "../src/global/runtime/review/index.js";

async function tempRepo() {
  const root = await mkdtemp(join(tmpdir(), "kairo-review-patch-"));
  for (const args of [["init"], ["config", "user.email", "t@e.com"], ["config", "user.name", "T"]]) {
    assert.equal(spawnSync("git", args, { cwd: root, encoding: "utf8" }).status, 0);
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

test("filterDiffToAdmittedPaths drops non-admitted and empty sets", () => {
  const raw = [
    "diff --git a/keep.js b/keep.js", "--- a/keep.js", "+++ b/keep.js", "@@ -1 +1 @@", "-a", "+b",
    "diff --git a/.env b/.env", "--- a/.env", "+++ b/.env", "@@ -1 +1 @@", "-x", "+SECRET=1",
    "diff --git a/old.js b/new.js", "--- a/old.js", "+++ b/new.js", "@@ -1 +1 @@", "-1", "+2", ""
  ].join("\n");
  const filtered = filterDiffToAdmittedPaths(raw, ["keep.js", "new.js"]);
  assert.match(filtered, /keep\.js/);
  assert.doesNotMatch(filtered, /\.env|SECRET|old\.js|new\.js/);
  assert.equal(filterDiffToAdmittedPaths(raw, []), "");
  assert.match(filterDiffToAdmittedPaths(raw, [".env"]), /\.env|SECRET=1/);
});

test("scoped patch: WT/base/commit cover changes; private/excluded never appear", async () => {
  const root = await tempRepo();
  await writeFile(join(root, "keep.js"), "one\n");
  await writeFile(join(root, "gone.js"), "bye\n");
  const baseSha = await commitAll(root, "base");

  await writeFile(join(root, "keep.js"), "two\n");
  await writeFile(join(root, "fresh.js"), "new\n");
  await unlink(join(root, "gone.js"));
  await writeFile(join(root, ".env"), "SECRET=1\n");

  const wtSnap = await resolveReviewSnapshot({ cwd: root });
  assert.ok(wtSnap.excluded.some((e) => e.path === ".env" && e.reason === "private"));
  const wtPatch = await buildScopedReviewPatch(wtSnap);
  assert.match(wtPatch, /keep\.js/);
  assert.match(wtPatch, /fresh\.js/);
  assert.match(wtPatch, /gone\.js/);
  assert.doesNotMatch(wtPatch, /\.env|SECRET=1/);

  git(root, ["add", "keep.js", "fresh.js", "gone.js"]);
  const stagedSnap = await resolveReviewSnapshot({ cwd: root });
  const stagedPatch = await buildScopedReviewPatch(stagedSnap);
  assert.match(stagedPatch, /keep\.js|fresh\.js|gone\.js/);
  assert.doesNotMatch(stagedPatch, /\.env|SECRET=1/);

  await commitAll(root, "tip");
  const tip = git(root, ["rev-parse", "HEAD"]);
  const baseSnap = await resolveReviewSnapshot({ cwd: root, base: baseSha });
  assert.equal(baseSnap.mode, REVIEW_SCOPE_MODES.BASE);
  const basePatch = await buildScopedReviewPatch(baseSnap);
  assert.match(basePatch, /keep\.js|fresh\.js|gone\.js/);
  assert.doesNotMatch(basePatch, /\.env|SECRET/);

  const commitSnap = await resolveReviewSnapshot({ cwd: root, commit: tip });
  assert.equal(commitSnap.mode, REVIEW_SCOPE_MODES.COMMIT);
  const commitPatch = await buildScopedReviewPatch(commitSnap);
  assert.match(commitPatch, /keep\.js|fresh\.js|gone\.js/);
  assert.doesNotMatch(commitPatch, /\.env|SECRET/);

  assert.doesNotMatch(
    filterDiffToAdmittedPaths(
      "diff --git a/.env b/.env\n--- a/.env\n+++ b/.env\n@@ -0,0 +1 @@\n+SECRET=9\n",
      stagedSnap.files.map((f) => f.path)
    ),
    /SECRET|\.env/
  );
});

test("private consent: excluded without consent, present in patch with consent", async () => {
  const root = await tempRepo();
  await writeFile(join(root, "ok.js"), "1\n");
  await commitAll(root, "seed");
  await writeFile(join(root, ".env"), "SECRET=consent\n");

  const denied = await resolveReviewSnapshot({ cwd: root });
  assert.ok(denied.excluded.some((e) => e.path === ".env" && e.reason === "private"));
  assert.equal(denied.files.some((f) => f.path === ".env"), false);
  assert.doesNotMatch(await buildScopedReviewPatch(denied), /SECRET=consent|\.env/);

  const allowed = await resolveReviewSnapshot({
    cwd: root, includePrivate: true, privateConfirmed: true
  });
  assert.ok(allowed.files.some((f) => f.path === ".env"));
  const allowedPatch = await buildScopedReviewPatch(allowed);
  assert.match(allowedPatch, /\.env/);
  assert.match(allowedPatch, /SECRET=consent/);
  assert.ok(allowedPatch.length > 0);
});
