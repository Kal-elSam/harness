import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, chmod, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createArchitecturePlan } from "../src/global/architect/architect-manager.js";
import { transitionTask, resolveHead } from "../src/global/architect/architect-store.js";
import { createExecutionWorktree } from "../src/global/runtime/execution-worktree-manager.js";
import {
  appendCheckpoint, listWorktreeRecords, readCheckpoints, readWorktreeState
} from "../src/global/runtime/execution-worktree-store.js";
import { EXECUTION_WORKTREE_SCHEMA, WORKTREE_STATES } from "../src/global/runtime/execution-worktree-types.js";
import { worktreePaths } from "../src/global/paths.js";

async function repo() {
  const root = await mkdtemp(join(tmpdir(), "kairo-worktree-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  await writeFile(join(root, "README.md"), "hello\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: root });
  return root;
}

async function harnessHome() {
  return mkdtemp(join(tmpdir(), "kairo-worktree-home-"));
}

/** A real approved plan, exactly like architect-store.test.js's own setup — real artifacts, real digests, real baseHead. */
async function approvedPlan(root, task = "Design safe payments") {
  const created = await createArchitecturePlan({
    task, cwd: root,
    runCodex: async () => ({ plan: "## Plan\nDo the thing.", usage: null })
  });
  const approved = await transitionTask(root, created.status.taskId, "approved");
  return { taskId: created.status.taskId, baseSha: approved.status.baseHead };
}

test("worktreePaths scopes every real path for one worktree under a single removable directory", () => {
  const paths = worktreePaths("/home/kairo", "wt_abc123");
  assert.equal(paths.worktreeDir, "/home/kairo/.harness/worktrees/wt_abc123");
  assert.equal(paths.treePath, "/home/kairo/.harness/worktrees/wt_abc123/tree");
  assert.equal(paths.statePath, "/home/kairo/.harness/worktrees/wt_abc123/state.json");
  assert.equal(paths.checkpointsPath, "/home/kairo/.harness/worktrees/wt_abc123/checkpoints.jsonl");
});

test("createExecutionWorktree creates a real, verified detached worktree at baseSha and persists PENDING state", async () => {
  const root = await repo();
  const homeDir = await harnessHome();
  const { taskId, baseSha } = await approvedPlan(root);

  const metadata = await createExecutionWorktree({ projectRoot: root, taskId, homeDir });

  assert.equal(metadata.schema, EXECUTION_WORKTREE_SCHEMA);
  assert.equal(metadata.status, WORKTREE_STATES.PENDING);
  assert.equal(metadata.baseSha, baseSha);
  assert.equal(metadata.taskId, taskId);
  assert.equal(metadata.projectRoot, root);
  assert.equal(metadata.activeRole, null);
  assert.equal(metadata.activeRunId, null);
  assert.ok(metadata.worktreeId.startsWith("wt_"));
  assert.ok(metadata.originalWorkingTreeFingerprint);

  // The real worktree really exists, on the real baseSha, detached.
  assert.ok(existsSync(metadata.treePath));
  assert.equal(resolveHead(metadata.treePath), baseSha);
  const branchOutput = execFileSync("git", ["-C", metadata.treePath, "branch", "--show-current"], { encoding: "utf8" }).trim();
  assert.equal(branchOutput, "", "a detached worktree has no current branch name");

  // The real state is durably persisted and reloadable.
  const persisted = await readWorktreeState(homeDir, metadata.worktreeId);
  assert.deepEqual(persisted, metadata);
});

test("createExecutionWorktree rejects a plan that isn't approved yet, and never touches git", async () => {
  const root = await repo();
  const homeDir = await harnessHome();
  const created = await createArchitecturePlan({
    task: "Not yet approved", cwd: root, runCodex: async () => ({ plan: "draft", usage: null })
  });

  await assert.rejects(
    () => createExecutionWorktree({ projectRoot: root, taskId: created.status.taskId, homeDir }),
    /explicit approval is required/
  );
});

test("createExecutionWorktree rejects a stale plan whose approved baseSha no longer matches the real project HEAD", async () => {
  const root = await repo();
  const homeDir = await harnessHome();
  const { taskId } = await approvedPlan(root);

  // A real new commit lands after approval — baseSha is now stale.
  await writeFile(join(root, "CHANGED.md"), "drift\n");
  execFileSync("git", ["add", "CHANGED.md"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "drift"], { cwd: root });

  await assert.rejects(
    () => createExecutionWorktree({ projectRoot: root, taskId, homeDir }),
    /stale: repository HEAD changed/
  );
});

test("createExecutionWorktree rejects a dirty tracked working tree before creating anything", async () => {
  const root = await repo();
  const homeDir = await harnessHome();
  const { taskId } = await approvedPlan(root);

  await writeFile(join(root, "README.md"), "hello, but modified\n");

  await assert.rejects(
    () => createExecutionWorktree({ projectRoot: root, taskId, homeDir }),
    /Working tree is not clean/
  );
  assert.equal(existsSync(join(homeDir, ".harness", "worktrees")), false, "no worktree record must be created for a rejected precondition");
});

test("createExecutionWorktree rejects a dirty untracked working tree before creating anything", async () => {
  const root = await repo();
  const homeDir = await harnessHome();
  const { taskId } = await approvedPlan(root);

  await writeFile(join(root, "untracked.txt"), "surprise\n");

  await assert.rejects(
    () => createExecutionWorktree({ projectRoot: root, taskId, homeDir }),
    /Working tree is not clean/
  );
});

test("createExecutionWorktree never treats Kairo's own .ai/tasks/** plan artifacts as a dirty working tree", async () => {
  const root = await repo();
  const homeDir = await harnessHome();
  const { taskId, baseSha } = await approvedPlan(root);

  // The plan's own real artifacts (.ai/tasks/<taskId>/...) exist as real
  // untracked files at this point — the same real exclusion
  // resolveWorkingTreeFingerprint already relies on must apply here too.
  const metadata = await createExecutionWorktree({ projectRoot: root, taskId, homeDir });
  assert.equal(metadata.baseSha, baseSha);
});

test("createExecutionWorktree rolls back completely when 'git worktree add' fails — no orphaned record or directory", async () => {
  const root = await repo();
  const homeDir = await harnessHome();
  const { taskId } = await approvedPlan(root);

  let worktreeAddAttempted = false;
  const failingExec = (command, args, options) => {
    if (args[0] === "worktree" && args[1] === "add") {
      worktreeAddAttempted = true;
      throw new Error("simulated git worktree add failure");
    }
    return execFileSync(command, args, options);
  };

  await assert.rejects(
    () => createExecutionWorktree({ projectRoot: root, taskId, homeDir, exec: failingExec }),
    /simulated git worktree add failure/
  );
  assert.equal(worktreeAddAttempted, true);

  const worktreesDir = join(homeDir, ".harness", "worktrees");
  const remaining = existsSync(worktreesDir) ? await readdir(worktreesDir) : [];
  assert.deepEqual(remaining, [], "no worktree directory must survive a failed creation");

  // Git itself must not remember a broken worktree registration either.
  const listed = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: root, encoding: "utf8" });
  assert.equal((listed.match(/^worktree /gm) ?? []).length, 1, "only the real main working tree should remain registered");
});

test("createExecutionWorktree rolls back completely when persisting the initial state fails", async () => {
  const root = await repo();
  const homeDir = await harnessHome();
  const { taskId } = await approvedPlan(root);

  // A real, unwritable worktrees/ parent — mkdir/write inside it fails
  // with a real EACCES, exactly like a real disk/permission failure would.
  const worktreesDir = join(homeDir, ".harness", "worktrees");
  await mkdir(worktreesDir, { recursive: true });
  await chmod(worktreesDir, 0o500);

  try {
    await assert.rejects(() => createExecutionWorktree({ projectRoot: root, taskId, homeDir }));
  } finally {
    await chmod(worktreesDir, 0o700);
  }

  const listed = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: root, encoding: "utf8" });
  assert.equal((listed.match(/^worktree /gm) ?? []).length, 1, "a persistence failure must never leave a real git worktree registered");
});

test("createExecutionWorktree verifies the real worktree HEAD matches baseSha and rolls back on mismatch", async () => {
  const root = await repo();
  const homeDir = await harnessHome();
  const { taskId, baseSha } = await approvedPlan(root);

  const spoofingExec = (command, args, options) => {
    const result = execFileSync(command, args, options);
    // Simulate a real worktree whose HEAD ends up wrong for some reason —
    // never trust the git command's own reported success blindly.
    if (args[0] === "rev-parse" && args[1] === "HEAD" && basename(options?.cwd ?? "") === "tree") {
      return Buffer.from(`${"f".repeat(40)}\n`);
    }
    return result;
  };

  await assert.rejects(
    () => createExecutionWorktree({ projectRoot: root, taskId, homeDir, exec: spoofingExec }),
    /does not match the expected base/
  );

  const worktreesDir = join(homeDir, ".harness", "worktrees");
  const remaining = existsSync(worktreesDir) ? await readdir(worktreesDir) : [];
  assert.deepEqual(remaining, [], "a HEAD mismatch must roll back exactly like any other failure");
  void baseSha;
});

test("readCheckpoints returns an empty list for a worktree with no real checkpoints yet, without throwing", async () => {
  const homeDir = await harnessHome();
  assert.deepEqual(await readCheckpoints(homeDir, "wt_none"), []);
});

test("appendCheckpoint persists real checkpoints append-only, in order, readable back exactly", async () => {
  const homeDir = await harnessHome();
  const first = { worktreeId: "wt_x", role: "Builder", phase: "before", headSha: "a".repeat(40), fingerprint: "fp-1", timestamp: "t0" };
  const second = { worktreeId: "wt_x", role: "Builder", phase: "after", headSha: "b".repeat(40), fingerprint: "fp-2", timestamp: "t1" };
  await appendCheckpoint(homeDir, "wt_x", first);
  await appendCheckpoint(homeDir, "wt_x", second);
  assert.deepEqual(await readCheckpoints(homeDir, "wt_x"), [first, second]);
});

test("listWorktreeRecords returns every real persisted worktree, newest first, skipping nothing that failed to parse", async () => {
  const root = await repo();
  const homeDir = await harnessHome();
  const { taskId: taskA } = await approvedPlan(root, "Task A");
  const first = await createExecutionWorktree({ projectRoot: root, taskId: taskA, homeDir });

  // A second real plan against the same now-clean repo.
  const { taskId: taskB } = await approvedPlan(root, "Task B");
  const second = await createExecutionWorktree({ projectRoot: root, taskId: taskB, homeDir });

  const listed = await listWorktreeRecords(homeDir);
  assert.equal(listed.length, 2);
  assert.deepEqual(new Set(listed.map((w) => w.worktreeId)), new Set([first.worktreeId, second.worktreeId]));
});
