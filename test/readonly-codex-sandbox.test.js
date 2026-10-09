// Real, no-model write canaries using `codex sandbox` (seatbelt, no model
// call) with the built-in `:read-only` permissions profile. Honest limit: this
// proves the read-only profile contains writes; it does not execute
// `codex exec --sandbox read-only` itself (that would call a model).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { verifyCodexReadOnlySandbox } from "../src/global/runtime/readonly-containment.js";
import codex from "../src/global/runtime/execution-adapters/codex.js";
import {
  EXPECTED_DENIED, WRITE_PROBE, makeTempGitRepo, parseProbe, snapshotTree
} from "./helpers/readonly-canary.js";

const probeVersion = spawnSync("codex", ["sandbox", "--help"], { encoding: "utf8" });
const skip = process.platform !== "darwin" || probeVersion.status !== 0
  ? "macOS and a codex CLI with the `sandbox` subcommand are required" : false;

const underCodex = (root, command, args) => spawnSync(
  "codex", ["sandbox", "-P", ":read-only", "-C", root, "--", command, ...args], { encoding: "utf8" }
);

test("codex :read-only profile: source, new file and .git writes fail with EPERM and the tree is unchanged", { skip }, () => {
  const root = makeTempGitRepo();
  try {
    const before = snapshotTree(root);
    const result = underCodex(root, process.execPath, ["-e", WRITE_PROBE, root]);
    assert.equal(result.status, 0, result.stderr);
    const probe = parseProbe(result.stdout);
    for (const name of EXPECTED_DENIED) assert.equal(probe[name], "EPERM", `${name} -> ${probe[name]}`);
    assert.equal(probe["read-source"], "OK");
    assert.deepEqual(snapshotTree(root), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("codex :read-only profile: git commit fails and changes nothing", { skip }, () => {
  const root = makeTempGitRepo();
  try {
    const before = snapshotTree(root);
    const commit = underCodex(root, "git", ["-C", root, "-c", "user.name=x", "-c", "user.email=x@example.invalid", "commit", "--allow-empty", "-m", "x"]);
    assert.notEqual(commit.status, 0);
    assert.deepEqual(snapshotTree(root), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("real codex preflight canary passes and leaves no file behind", { skip }, async () => {
  const root = makeTempGitRepo();
  try {
    const before = snapshotTree(root);
    assert.equal((await verifyCodexReadOnlySandbox({ cwd: root })).verified, true);
    assert.deepEqual(snapshotTree(root), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the adapter argv uses the same read-only policy the canary exercises", () => {
  const { args } = codex.buildLaunch({ task: "t", cwd: "/repo", permissions: ["read-only"] });
  assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
});
