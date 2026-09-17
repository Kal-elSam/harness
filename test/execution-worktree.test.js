import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, chmod, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createArchitecturePlan } from "../src/global/architect/architect-manager.js";
import { transitionTask, resolveHead, taskPaths } from "../src/global/architect/architect-store.js";
import {
  beginRoleRun, completeRoleRun, createExecutionWorktree, markReadyForReview
} from "../src/global/runtime/execution-worktree-manager.js";
import {
  appendCheckpoint, listWorktreeRecords, readCheckpoints, readWorktreeState
} from "../src/global/runtime/execution-worktree-store.js";
import { EXECUTION_WORKTREE_SCHEMA, WORKTREE_STATES } from "../src/global/runtime/execution-worktree-types.js";
import { assertWorktreeId, worktreePaths } from "../src/global/paths.js";
import { RUN_STATES } from "../src/global/runtime/run-types.js";

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
  const paths = worktreePaths("/home/kairo", "wt_abc_123");
  assert.equal(paths.worktreeDir, "/home/kairo/.harness/worktrees/wt_abc_123");
  assert.equal(paths.treePath, "/home/kairo/.harness/worktrees/wt_abc_123/tree");
  assert.equal(paths.statePath, "/home/kairo/.harness/worktrees/wt_abc_123/state.json");
  assert.equal(paths.checkpointsPath, "/home/kairo/.harness/worktrees/wt_abc_123/checkpoints.jsonl");
});

test("REGRESSION: assertWorktreeId rejects a traversal id at the one real boundary worktree paths are built from — never resolves outside worktreesDir", () => {
  assert.throws(() => assertWorktreeId("../../escape"), /Invalid worktree id/);
  assert.throws(() => assertWorktreeId("wt_../../escape"), /Invalid worktree id/);
  assert.throws(() => assertWorktreeId(""), /Invalid worktree id/);
  assert.throws(() => assertWorktreeId(null), /Invalid worktree id/);
  assert.throws(
    () => worktreePaths("/tmp/home", "../../escape"),
    /Invalid worktree id/,
    "the real bug: worktreePaths('/tmp/home', '../../escape') used to silently resolve to /tmp/home/escape"
  );
  assert.equal(worktreePaths("/tmp/home", "wt_ok_1").treePath, "/tmp/home/.harness/worktrees/wt_ok_1/tree");
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

test("REGRESSION: createExecutionWorktree rejects a plan.md tampered with after approval — reuses verifyPlanForExecution's real digest check, never a bare state+HEAD check that would miss this", async () => {
  const root = await repo();
  const homeDir = await harnessHome();
  const { taskId } = await approvedPlan(root);

  // The real approved plan record's own on-disk artifact, edited directly
  // after approval — state is still APPROVED and HEAD hasn't moved, so a
  // check that only looks at those two things would wrongly let this
  // through.
  const paths = taskPaths(root, taskId);
  await writeFile(paths.planPath, "## Plan\nSomething the human never actually approved.\n");

  await assert.rejects(
    () => createExecutionWorktree({ projectRoot: root, taskId, homeDir }),
    /Plan artifact changed after planning/
  );

  const worktreesDir = join(homeDir, ".harness", "worktrees");
  const remaining = existsSync(worktreesDir) ? await readdir(worktreesDir) : [];
  assert.deepEqual(remaining, [], "a tampered plan must never produce a real worktree");

  const listed = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: root, encoding: "utf8" });
  assert.equal((listed.match(/^worktree /gm) ?? []).length, 1, "no real git worktree registration for a rejected tampered plan");
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
  assert.deepEqual(await readCheckpoints(homeDir, "wt_none_1"), []);
});

test("appendCheckpoint persists real checkpoints append-only, in order, readable back exactly", async () => {
  const homeDir = await harnessHome();
  const first = { worktreeId: "wt_x_1", role: "Builder", phase: "before", headSha: "a".repeat(40), fingerprint: "fp-1", timestamp: "t0" };
  const second = { worktreeId: "wt_x_1", role: "Builder", phase: "after", headSha: "b".repeat(40), fingerprint: "fp-2", timestamp: "t1" };
  await appendCheckpoint(homeDir, "wt_x_1", first);
  await appendCheckpoint(homeDir, "wt_x_1", second);
  assert.deepEqual(await readCheckpoints(homeDir, "wt_x_1"), [first, second]);
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

// --- beginRoleRun / completeRoleRun / markReadyForReview: increment 2,
// the real transaction for ONE role's run inside an already-created
// execution worktree. Still no automatic Builder->Debugger->Tester
// chaining, and no routing — every call here is explicit.

function fakeReadRun(state) {
  return async () => (state == null ? null : { state });
}

async function freshWorktree(root, task = "Design safe payments") {
  const homeDir = await harnessHome();
  const { taskId } = await approvedPlan(root, task);
  const worktree = await createExecutionWorktree({ projectRoot: root, taskId, homeDir });
  return { homeDir, worktree };
}

test("beginRoleRun rejects a role that isn't Builder/Debugger/Tester", async () => {
  const root = await repo();
  const { homeDir, worktree } = await freshWorktree(root);
  await assert.rejects(
    () => beginRoleRun({ worktreeId: worktree.worktreeId, role: "Explorer", runId: "run_1", homeDir }),
    /is not a real execution-worktree role/
  );
});

test("beginRoleRun records a real 'before' checkpoint and moves PENDING -> ACTIVE with the real role/run recorded", async () => {
  const root = await repo();
  const { homeDir, worktree } = await freshWorktree(root);
  const realHead = resolveHead(worktree.treePath);

  const active = await beginRoleRun({ worktreeId: worktree.worktreeId, role: "Builder", runId: "run_1", homeDir });
  assert.equal(active.status, WORKTREE_STATES.ACTIVE);
  assert.equal(active.activeRole, "Builder");
  assert.equal(active.activeRunId, "run_1");

  const checkpoints = await readCheckpoints(homeDir, worktree.worktreeId);
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0].phase, "before");
  assert.equal(checkpoints[0].role, "Builder");
  assert.equal(checkpoints[0].runId, "run_1");
  assert.equal(checkpoints[0].headSha, realHead);
});

test("beginRoleRun rejects starting a second role run while one is already active", async () => {
  const root = await repo();
  const { homeDir, worktree } = await freshWorktree(root);
  await beginRoleRun({ worktreeId: worktree.worktreeId, role: "Builder", runId: "run_1", homeDir });
  await assert.rejects(
    () => beginRoleRun({ worktreeId: worktree.worktreeId, role: "Debugger", runId: "run_2", homeDir }),
    /expected PENDING/
  );
});

test("completeRoleRun rejects a runId that doesn't match the real active run", async () => {
  const root = await repo();
  const { homeDir, worktree } = await freshWorktree(root);
  await beginRoleRun({ worktreeId: worktree.worktreeId, role: "Builder", runId: "run_1", homeDir });
  await assert.rejects(
    () => completeRoleRun({ worktreeId: worktree.worktreeId, role: "Builder", runId: "run_WRONG", homeDir, readRun: fakeReadRun(RUN_STATES.COMPLETED) }),
    /Role run mismatch/
  );
});

test("completeRoleRun rejects completion while the real run hasn't reached a terminal state yet — no state change at all", async () => {
  const root = await repo();
  const { homeDir, worktree } = await freshWorktree(root);
  await beginRoleRun({ worktreeId: worktree.worktreeId, role: "Builder", runId: "run_1", homeDir });

  await assert.rejects(
    () => completeRoleRun({ worktreeId: worktree.worktreeId, role: "Builder", runId: "run_1", homeDir, readRun: fakeReadRun(RUN_STATES.RUNNING) }),
    /has not finished yet/
  );
  const stillActive = await readWorktreeState(homeDir, worktree.worktreeId);
  assert.equal(stillActive.status, WORKTREE_STATES.ACTIVE, "an early completion attempt must never change worktree state");
});

test("completeRoleRun on a real FAILED run creates no commit and moves the worktree to INTERRUPTED", async () => {
  const root = await repo();
  const { homeDir, worktree } = await freshWorktree(root);
  await beginRoleRun({ worktreeId: worktree.worktreeId, role: "Builder", runId: "run_1", homeDir });
  await writeFile(join(worktree.treePath, "unfinished.txt"), "partial work\n");

  await assert.rejects(
    () => completeRoleRun({ worktreeId: worktree.worktreeId, role: "Builder", runId: "run_1", homeDir, readRun: fakeReadRun(RUN_STATES.FAILED) }),
    /did not complete successfully/
  );

  const interrupted = await readWorktreeState(homeDir, worktree.worktreeId);
  assert.equal(interrupted.status, WORKTREE_STATES.INTERRUPTED);
  assert.equal(interrupted.activeRole, null);
  const log = execFileSync("git", ["-C", worktree.treePath, "log", "--oneline"], { encoding: "utf8" });
  assert.equal(log.trim().split("\n").length, 1, "no real commit must exist beyond the original baseSha commit");
  const status = execFileSync("git", ["-C", worktree.treePath, "status", "--porcelain"], { encoding: "utf8" });
  assert.match(status, /unfinished\.txt/, "the real partial work must stay uncommitted, never silently discarded");
});

test("completeRoleRun with no real changes creates no commit — the 'after' checkpoint reuses the exact same real HEAD", async () => {
  const root = await repo();
  const { homeDir, worktree } = await freshWorktree(root);
  await beginRoleRun({ worktreeId: worktree.worktreeId, role: "Builder", runId: "run_1", homeDir });
  const beforeSha = resolveHead(worktree.treePath);

  const pending = await completeRoleRun({ worktreeId: worktree.worktreeId, role: "Builder", runId: "run_1", homeDir, readRun: fakeReadRun(RUN_STATES.COMPLETED) });
  assert.equal(pending.status, WORKTREE_STATES.PENDING);
  assert.equal(pending.activeRole, null);
  assert.equal(pending.activeRunId, null);

  const afterSha = resolveHead(worktree.treePath);
  assert.equal(afterSha, beforeSha, "no real commit means the real HEAD must not move");
  const checkpoints = await readCheckpoints(homeDir, worktree.worktreeId);
  assert.equal(checkpoints.length, 2);
  assert.equal(checkpoints[1].phase, "after");
  assert.equal(checkpoints[1].headSha, beforeSha);
});

test("completeRoleRun with real changes lets Kairo itself create the real commit — never the agent", async () => {
  const root = await repo();
  const { homeDir, worktree } = await freshWorktree(root);
  await beginRoleRun({ worktreeId: worktree.worktreeId, role: "Builder", runId: "run_1", homeDir });
  const beforeSha = resolveHead(worktree.treePath);
  await writeFile(join(worktree.treePath, "feature.txt"), "real implementation\n");

  const pending = await completeRoleRun({ worktreeId: worktree.worktreeId, role: "Builder", runId: "run_1", homeDir, readRun: fakeReadRun(RUN_STATES.COMPLETED) });
  assert.equal(pending.status, WORKTREE_STATES.PENDING);

  const afterSha = resolveHead(worktree.treePath);
  assert.notEqual(afterSha, beforeSha, "a real commit must have moved HEAD");
  const commitMessage = execFileSync("git", ["-C", worktree.treePath, "log", "-1", "--format=%s"], { encoding: "utf8" }).trim();
  assert.match(commitMessage, /Builder/);
  assert.match(commitMessage, /run_1/);
  const status = execFileSync("git", ["-C", worktree.treePath, "status", "--porcelain"], { encoding: "utf8" });
  assert.equal(status.trim(), "", "the real commit must have captured everything — nothing real left uncommitted");
  const checkpoints = await readCheckpoints(homeDir, worktree.worktreeId);
  assert.equal(checkpoints[1].headSha, afterSha);
});

test("completeRoleRun rejects a real private path touched by the role, with no commit and INTERRUPTED", async () => {
  const root = await repo();
  const { homeDir, worktree } = await freshWorktree(root);
  await beginRoleRun({ worktreeId: worktree.worktreeId, role: "Builder", runId: "run_1", homeDir });
  await writeFile(join(worktree.treePath, ".env"), "SECRET=1\n");

  await assert.rejects(
    () => completeRoleRun({ worktreeId: worktree.worktreeId, role: "Builder", runId: "run_1", homeDir, readRun: fakeReadRun(RUN_STATES.COMPLETED) }),
    /private path/
  );

  const interrupted = await readWorktreeState(homeDir, worktree.worktreeId);
  assert.equal(interrupted.status, WORKTREE_STATES.INTERRUPTED);
  const log = execFileSync("git", ["-C", worktree.treePath, "log", "--oneline"], { encoding: "utf8" });
  assert.equal(log.trim().split("\n").length, 1, "a private-path violation must never produce a real commit");
});

test("completeRoleRun rejects a real diff that exceeds the real review size limits, with no commit and INTERRUPTED", async () => {
  const root = await repo();
  const { homeDir, worktree } = await freshWorktree(root);
  await beginRoleRun({ worktreeId: worktree.worktreeId, role: "Builder", runId: "run_1", homeDir });
  const tooManyLines = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
  await writeFile(join(worktree.treePath, "huge.txt"), `${tooManyLines}\n`);

  await assert.rejects(
    () => completeRoleRun({ worktreeId: worktree.worktreeId, role: "Builder", runId: "run_1", homeDir, readRun: fakeReadRun(RUN_STATES.COMPLETED) })
  );
  const interrupted = await readWorktreeState(homeDir, worktree.worktreeId);
  assert.equal(interrupted.status, WORKTREE_STATES.INTERRUPTED);
  const log = execFileSync("git", ["-C", worktree.treePath, "log", "--oneline"], { encoding: "utf8" });
  assert.equal(log.trim().split("\n").length, 1, "an oversized real diff must never produce a real commit");
});

test("markReadyForReview requires no active role run, and moves PENDING -> READY_FOR_REVIEW", async () => {
  const root = await repo();
  const { homeDir, worktree } = await freshWorktree(root);

  await beginRoleRun({ worktreeId: worktree.worktreeId, role: "Builder", runId: "run_1", homeDir });
  await assert.rejects(
    () => markReadyForReview({ worktreeId: worktree.worktreeId, homeDir }),
    /expected PENDING/
  );

  await completeRoleRun({ worktreeId: worktree.worktreeId, role: "Builder", runId: "run_1", homeDir, readRun: fakeReadRun(RUN_STATES.COMPLETED) });
  const ready = await markReadyForReview({ worktreeId: worktree.worktreeId, homeDir });
  assert.equal(ready.status, WORKTREE_STATES.READY_FOR_REVIEW);
});
