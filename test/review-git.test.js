import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  createFindingId, detectReviewSnapshotDrift, fingerprintReviewSnapshot,
  resolveReviewScopeMode, resolveReviewSnapshot, REVIEW_SCOPE_MODES,
  REVIEW_SNAPSHOT_ERROR_CODES, ReviewSnapshotError, assertReviewPathSafe,
  assertWithinReviewLimits, buildScopedReviewPatch, isBinaryContent,
  isReviewPrivatePath, requirePrivateConsent
} from "../src/global/runtime/review/index.js";
async function tempRepo() {
  const root = await mkdtemp(join(tmpdir(), "kairo-review-git-"));
  for (const args of [["init"], ["config", "user.email", "t@e.com"], ["config", "user.name", "T"]]) {
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
test("contracts: scope, finding id, limits, private, binary, unsafe", () => {
  assert.equal(resolveReviewScopeMode({}), REVIEW_SCOPE_MODES.WORKING_TREE);
  assert.throws(
    () => resolveReviewScopeMode({ base: "a", commit: "b" }),
    (e) => e.code === REVIEW_SNAPSHOT_ERROR_CODES.INVALID_SCOPE
  );
  const id = { severity: "high", title: "t", path: "a.js", line: 1, problem: "p" };
  assert.equal(createFindingId(id), createFindingId(id));
  assert.equal(isReviewPrivatePath(".env"), true);
  assert.equal(isBinaryContent(Buffer.from([0, 1])), true);
  assert.throws(() => assertReviewPathSafe("../x"), (e) => e.code === REVIEW_SNAPSHOT_ERROR_CODES.INVALID_PATH);
  assert.throws(
    () => assertWithinReviewLimits({ fileCount: 101, changedLines: 1, diffBytes: 1 }),
    (e) => e.code === REVIEW_SNAPSHOT_ERROR_CODES.LIMIT_EXCEEDED
  );
  assert.throws(
    () => requirePrivateConsent({ includePrivate: true, privateConfirmed: false, privatePaths: [".env"] }),
    (e) => e.code === REVIEW_SNAPSHOT_ERROR_CODES.PRIVATE_CONSENT_REQUIRED
  );
});
test("snapshots: WT/base/commit, exclusions, consent, drift, file limit", async () => {
  const root = await tempRepo();
  await writeFile(join(root, "a.js"), "one\n");
  const baseSha = await commitAll(root, "base");
  await writeFile(join(root, "a.js"), "two\n");
  await writeFile(join(root, "b.js"), "extra\n");
  await writeFile(join(root, "new.js"), "n\n");
  await writeFile(join(root, ".env"), "SECRET=1\n");
  await writeFile(join(root, "blob.bin"), Buffer.from([0, 1, 2]));

  const wt = await resolveReviewSnapshot({ cwd: root });
  assert.equal(wt.mode, REVIEW_SCOPE_MODES.WORKING_TREE);
  assert.ok(wt.files.some((f) => f.path === "new.js"));
  assert.ok(wt.excluded.some((e) => e.path === ".env" && e.reason === "private"));
  assert.ok(wt.excluded.some((e) => e.path === "blob.bin" && e.reason === "binary"));
  assert.equal(fingerprintReviewSnapshot(wt), wt.fingerprint);

  await commitAll(root, "tip");
  const tip = git(root, ["rev-parse", "HEAD"]);
  const baseSnap = await resolveReviewSnapshot({ cwd: root, base: baseSha });
  assert.equal(baseSnap.mode, REVIEW_SCOPE_MODES.BASE);
  assert.ok(baseSnap.files.some((f) => f.path === "b.js"));
  const commitSnap = await resolveReviewSnapshot({ cwd: root, commit: tip });
  assert.equal(commitSnap.mode, REVIEW_SCOPE_MODES.COMMIT);

  await assert.rejects(
    () => resolveReviewSnapshot({ cwd: root, base: "missing-ref" }),
    (e) => e instanceof ReviewSnapshotError
  );
  await writeFile(join(root, ".env"), "SECRET=2\n");
  await assert.rejects(
    () => resolveReviewSnapshot({ cwd: root, includePrivate: true, privateConfirmed: false }),
    (e) => e.code === REVIEW_SNAPSHOT_ERROR_CODES.PRIVATE_CONSENT_REQUIRED
  );
  assert.ok((await resolveReviewSnapshot({
    cwd: root, includePrivate: true, privateConfirmed: true
  })).files.some((f) => f.path === ".env"));

  await writeFile(join(root, "a.js"), "drift\n");
  const first = await resolveReviewSnapshot({ cwd: root });
  await writeFile(join(root, "a.js"), "drift2\n");
  assert.equal((await detectReviewSnapshotDrift(first)).stale, true);

  await mkdir(join(root, "many"), { recursive: true });
  for (let i = 0; i < 101; i++) await writeFile(join(root, "many", `f${i}.js`), `n=${i}\n`);
  await assert.rejects(
    () => resolveReviewSnapshot({ cwd: root }),
    (e) => e.code === REVIEW_SNAPSHOT_ERROR_CODES.LIMIT_EXCEEDED
  );
});

test("adversarial: symlink leaf and private→public rename do not leak", async () => {
  const symlinkRoot = await tempRepo();
  await writeFile(join(symlinkRoot, "tracked.js"), "ok\n");
  await commitAll(symlinkRoot, "seed");
  const outside = join(await mkdtemp(join(tmpdir(), "kairo-secret-")), "secret.env");
  await writeFile(outside, "SECRET=exfil\n");
  await symlink(outside, join(symlinkRoot, "public.js"));
  const symlinkSnap = await resolveReviewSnapshot({ cwd: symlinkRoot });
  assert.equal(symlinkSnap.files.some((f) => f.path === "public.js"), false);
  assert.ok(symlinkSnap.excluded.some((e) => e.path === "public.js" && e.reason === "symlink"));
  assert.doesNotMatch(await buildScopedReviewPatch(symlinkSnap), /SECRET=exfil/);

  const renameRoot = await tempRepo();
  await writeFile(join(renameRoot, ".env"), "SECRET=rename\n");
  await commitAll(renameRoot, "private");
  git(renameRoot, ["mv", ".env", "public-renamed.js"]);
  const renameSnap = await resolveReviewSnapshot({ cwd: renameRoot });
  assert.equal(renameSnap.files.some((f) => f.path === "public-renamed.js"), false);
  assert.ok(renameSnap.excluded.some((e) => e.path === "public-renamed.js" && e.reason === "private"));
  const renamed = renameSnap.excluded.find((e) => e.path === "public-renamed.js");
  assert.equal(renamed?.reason, "private");
  // Provenance must be known to the snapshot pipeline (source was private).
  assert.doesNotMatch(await buildScopedReviewPatch(renameSnap), /SECRET=rename/);
});
