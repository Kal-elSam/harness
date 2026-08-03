import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  REVIEW_SCOPE_MODES, REVIEW_SNAPSHOT_ERROR_CODES, ReviewSnapshotError,
  resolveReviewSnapshot, verifyStagedReviewReceipt,
  buildReviewReceipt, createReviewId
} from "../src/global/runtime/review/index.js";

const baseExec = promisify(execFile);
async function tempRepo() {
  const root = await mkdtemp(join(tmpdir(), "kairo-full-oid-"));
  for (const args of [
    ["init", "--template="],
    ["config", "user.email", "t@e.com"],
    ["config", "user.name", "T"],
    ["config", "core.abbrev", "7"]
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

function oidLength(cwd) {
  const fmt = git(cwd, ["rev-parse", "--show-object-format"]);
  return fmt === "sha256" ? 64 : 40;
}

test("staged receipts use full object IDs even when core.abbrev=7", async () => {
  const root = await tempRepo();
  const len = oidLength(root);
  assert.equal(git(root, ["config", "core.abbrev"]), "7");
  await writeFile(join(root, "a.js"), "base\n");
  await commitAll(root, "seed");
  await writeFile(join(root, "a.js"), "staged\n");
  git(root, ["add", "a.js"]);

  const snap = await resolveReviewSnapshot({ cwd: root, staged: true });
  assert.equal(snap.mode, REVIEW_SCOPE_MODES.STAGED);
  const file = snap.files.find((f) => f.path === "a.js");
  assert.ok(file);
  assert.equal(file.hash.length, len);
  assert.match(file.hash, new RegExp(`^[a-f0-9]{${len}}$`));
  const expected = git(root, ["rev-parse", ":a.js"]);
  assert.equal(file.hash, expected);
  assert.equal(expected.length, len);
});

test("changing core.abbrev does not change staged fingerprint", async () => {
  const root = await tempRepo();
  await writeFile(join(root, "a.js"), "base\n");
  await commitAll(root, "seed");
  await writeFile(join(root, "a.js"), "staged\n");
  git(root, ["add", "a.js"]);

  const first = await resolveReviewSnapshot({ cwd: root, staged: true });
  git(root, ["config", "core.abbrev", "4"]);
  const second = await resolveReviewSnapshot({ cwd: root, staged: true });
  git(root, ["config", "core.abbrev", "12"]);
  const third = await resolveReviewSnapshot({ cwd: root, staged: true });
  assert.equal(second.fingerprint, first.fingerprint);
  assert.equal(third.fingerprint, first.fingerprint);
  assert.equal(first.files[0].hash, second.files[0].hash);
  assert.equal(first.files[0].hash, third.files[0].hash);
});

test("add/delete/rename/modes keep full object identity", async () => {
  const root = await tempRepo();
  const len = oidLength(root);
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
  for (const f of snap.files) {
    assert.equal(f.hash.length, len, f.path);
    assert.match(f.hash, new RegExp(`^[a-f0-9]{${len}}$`), f.path);
  }
  assert.equal(byPath["added.js"].hash, git(root, ["rev-parse", ":added.js"]));
  assert.equal(byPath["gone.js"].hash, git(root, ["rev-parse", "HEAD:gone.js"]));
  assert.equal(byPath["renamed.js"].hash, git(root, ["rev-parse", ":renamed.js"]));
  assert.equal(byPath["renamed.js"].sourcePath, "old.js");
  assert.match(byPath["mode.js"].mode, /755$/);
});

test("verify --staged detects any differing full blob", async () => {
  const root = await tempRepo();
  await writeFile(join(root, "a.js"), "base\n");
  await commitAll(root, "seed");
  await writeFile(join(root, "a.js"), "staged\n");
  git(root, ["add", "a.js"]);

  const snapshot = await resolveReviewSnapshot({ cwd: root, staged: true });
  const receipt = buildReviewReceipt({
    reviewId: createReviewId(), agentId: "codex", snapshot, findings: []
  });
  assert.equal((await verifyStagedReviewReceipt(receipt, { cwd: root })).ok, true);

  await writeFile(join(root, "a.js"), "other-blob\n");
  git(root, ["add", "a.js"]);
  const bad = await verifyStagedReviewReceipt(receipt, { cwd: root });
  assert.equal(bad.ok, false);
  assert.equal(bad.stale, true);
  assert.notEqual(bad.nextFingerprint, snapshot.fingerprint);
});

test("truncated staged object IDs fail closed", async () => {
  const root = await tempRepo();
  await writeFile(join(root, "a.js"), "base\n");
  await commitAll(root, "seed");
  await writeFile(join(root, "a.js"), "staged\n");
  git(root, ["add", "a.js"]);

  async function abbreviatingExec(cmd, args, opts) {
    const result = await baseExec(cmd, args, opts);
    if (cmd === "git" && args.includes("--raw") && args.includes("--cached")) {
      const stdout = String(result.stdout ?? "").replace(
        /([0-9a-f]{40,64})/gi,
        (m) => m.slice(0, 7)
      );
      return { ...result, stdout };
    }
    return result;
  }

  await assert.rejects(
    () => resolveReviewSnapshot({ cwd: root, staged: true, execFileImpl: abbreviatingExec }),
    (e) => e instanceof ReviewSnapshotError
      && e.code === REVIEW_SNAPSHOT_ERROR_CODES.TRUNCATED_OBJECT_ID
  );
});
