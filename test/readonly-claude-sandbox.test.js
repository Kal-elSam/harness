// Real, no-model write canaries for the Claude read-only wrapper. Skipped on
// non-darwin (the wrapper is macOS sandbox-exec only; elsewhere the launch is
// refused with isolation_unavailable, covered in readonly-containment.test.js).
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SANDBOX_EXEC_PATH, buildReadOnlyWriteProfile, verifyClaudeReadOnlySandbox
} from "../src/global/runtime/readonly-containment.js";
import claude from "../src/global/runtime/execution-adapters/claude.js";
import {
  EXPECTED_DENIED, WRITE_PROBE, makeTempGitRepo, parseProbe, snapshotTree
} from "./helpers/readonly-canary.js";

const skip = process.platform !== "darwin" || !existsSync(SANDBOX_EXEC_PATH)
  ? "macOS sandbox-exec is required for the real Claude write-containment canary" : false;

const underProfile = (root, command, args, options = {}) => spawnSync(
  SANDBOX_EXEC_PATH, ["-p", buildReadOnlyWriteProfile(root), command, ...args], { encoding: "utf8", ...options }
);

test("claude wrapper profile: source, new file and .git writes all fail with EPERM and the tree is unchanged", { skip }, () => {
  const root = makeTempGitRepo();
  try {
    const before = snapshotTree(root);
    const result = underProfile(root, process.execPath, ["-e", WRITE_PROBE, root]);
    assert.equal(result.status, 0, result.stderr);
    const probe = parseProbe(result.stdout);
    for (const name of EXPECTED_DENIED) assert.equal(probe[name], "EPERM", `${name} -> ${probe[name]}`);
    assert.equal(probe["read-source"], "OK", "reads stay allowed");
    assert.deepEqual(snapshotTree(root), before, "bytes of every file (including .git) unchanged");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("claude wrapper profile: git commit and git add inside the repo fail and change nothing", { skip }, () => {
  const root = makeTempGitRepo();
  try {
    writeFileSync(join(root, "untracked.txt"), "u");
    const before = snapshotTree(root);
    const add = underProfile(root, "git", ["-C", root, "add", "untracked.txt"]);
    const commit = underProfile(root, "git", ["-C", root, "-c", "user.name=x", "-c", "user.email=x@example.invalid", "commit", "--allow-empty", "-m", "x"]);
    assert.notEqual(add.status, 0);
    assert.notEqual(commit.status, 0);
    assert.deepEqual(snapshotTree(root), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("claude wrapper profile: writes outside the repository still succeed (Claude config/cache/tmp stay usable)", { skip }, () => {
  const root = makeTempGitRepo();
  const outside = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "kairo-outside-")));
  try {
    const target = join(outside, "ok.txt");
    const result = underProfile(root, process.execPath, ["-e", `require("fs").writeFileSync(${JSON.stringify(target)}, "fine")`]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(target, "utf8"), "fine");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("real preflight canary passes for a temp repo and leaves no canary file behind", { skip }, async () => {
  const root = makeTempGitRepo();
  try {
    const before = snapshotTree(root);
    const result = await verifyClaudeReadOnlySandbox({ cwd: root });
    assert.equal(result.verified, true);
    assert.deepEqual(snapshotTree(root), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a symlinked repository root is contained through its real path", { skip }, () => {
  const root = makeTempGitRepo();
  const link = `${root}-link`;
  try {
    spawnSync("ln", ["-s", root, link]);
    const launch = claude.buildLaunch({ task: "t", cwd: link, permissions: ["read-only"] });
    assert.equal(launch.args[1], buildReadOnlyWriteProfile(root));
    const before = snapshotTree(root);
    const result = spawnSync(launch.command, ["-p", launch.args[1], process.execPath, "-e", WRITE_PROBE, link], { encoding: "utf8" });
    const probe = parseProbe(result.stdout);
    for (const name of EXPECTED_DENIED) assert.equal(probe[name], "EPERM", `${name} via symlink -> ${probe[name]}`);
    assert.deepEqual(snapshotTree(root), before);
  } finally {
    rmSync(link, { force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("sandbox-exec execs the target: the spawned pid is the target process (liveness stays valid)", { skip }, async () => {
  const root = makeTempGitRepo();
  try {
    const child = spawn(SANDBOX_EXEC_PATH, ["-p", buildReadOnlyWriteProfile(root), "/bin/sleep", "30"], { stdio: "ignore" });
    try {
      await new Promise((resolve) => setTimeout(resolve, 400));
      const comm = spawnSync("ps", ["-o", "comm=", "-p", String(child.pid)], { encoding: "utf8" }).stdout.trim();
      assert.match(comm, /sleep$/, `tracked pid ${child.pid} is "${comm}", expected the exec'd sleep`);
      assert.doesNotThrow(() => process.kill(child.pid, 0), "pid is alive");
      const ppid = spawnSync("ps", ["-o", "ppid=", "-p", String(child.pid)], { encoding: "utf8" }).stdout.trim();
      assert.equal(Number(ppid), process.pid, "the tracked process is our direct child (no extra wrapper process)");
    } finally { child.kill("SIGKILL"); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
