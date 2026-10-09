import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFile, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArchitecturePlan } from "../src/global/architect/architect-manager.js";
import { taskPaths, transitionTask } from "../src/global/architect/architect-store.js";
import { appendTransition, readTransitions } from "../src/global/conversation/transition-store.js";

const A = "run_a";
const B = "run_b";

async function repoWithTask() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "kairo-iso-repo-")));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "T"], { cwd: root });
  await writeFile(join(root, "README.md"), "hi\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: root });
  const created = await createArchitecturePlan({
    task: "Do a thing", cwd: root, runCodex: async () => ({ plan: "## Plan\nDo it.", usage: null })
  });
  await transitionTask(root, created.status.taskId, "approved");
  return { root, taskId: created.status.taskId };
}

const ev = (runId) => `run:${runId}`;
const code = (fn) => fn().then(() => null, (e) => e.code);

test("run A's predecessor never satisfies run B's append", async () => {
  const { root, taskId } = await repoWithTask();
  for (const kind of ["delegated", "result_observed"]) await appendTransition(root, taskId, { runId: A, kind, evidence: ev(A) });
  await appendTransition(root, taskId, { runId: B, kind: "delegated", evidence: ev(B) });
  assert.equal(
    await code(() => appendTransition(root, taskId, { runId: B, kind: "review_authorized", evidence: "gentle:x1" })),
    "TRANSITION_OUT_OF_ORDER"
  );
});

test("run-scoped read computes progress for that run only", async () => {
  const { root, taskId } = await repoWithTask();
  for (const kind of ["delegated", "result_observed", "review_authorized"]) {
    await appendTransition(root, taskId, { runId: A, kind, evidence: kind === "review_authorized" ? "gentle:x1" : ev(A) });
  }
  await appendTransition(root, taskId, { runId: B, kind: "delegated", evidence: ev(B) });
  const b = await readTransitions(root, taskId, { runId: B });
  assert.deepEqual(b.entries.map((e) => e.kind), ["delegated"]);
  assert.equal(b.next, "result_observed");
  const a = await readTransitions(root, taskId, { runId: A });
  assert.equal(a.next, "comments_recorded");
  const none = await readTransitions(root, taskId, { runId: "run_zzz" });
  assert.deepEqual(none.entries, []);
  assert.equal(none.next, "delegated");
});

test("legacy read without the option keeps the historical mixed view", async () => {
  const { root, taskId } = await repoWithTask();
  await appendTransition(root, taskId, { runId: A, kind: "delegated", evidence: ev(A) });
  await appendTransition(root, taskId, { runId: B, kind: "delegated", evidence: ev(B) });
  const all = await readTransitions(root, taskId);
  assert.equal(all.entries.length, 2);
  assert.equal(all.next, "result_observed");
});

test("corruption in another run's line still fails the run-scoped read closed", async () => {
  const { root, taskId } = await repoWithTask();
  await appendTransition(root, taskId, { runId: B, kind: "delegated", evidence: ev(B) });
  await appendFile(taskPaths(root, taskId).transitionsPath, `${JSON.stringify({ schema: "kairo.transition/v1", taskId, runId: A, kind: "bogus", at: "x", evidence: ev(A) })}\n`);
  const b = await readTransitions(root, taskId, { runId: B });
  assert.equal(b.state, "corrupt");
  assert.deepEqual(b.entries, []);
  assert.equal(b.next, null);
});

test("re-reading and idempotent re-append leave the log byte-identical", async () => {
  const { root, taskId } = await repoWithTask();
  await appendTransition(root, taskId, { runId: A, kind: "delegated", evidence: ev(A) });
  await appendTransition(root, taskId, { runId: B, kind: "delegated", evidence: ev(B) });
  const path = taskPaths(root, taskId).transitionsPath;
  const before = await readFile(path, "utf8");
  await readTransitions(root, taskId, { runId: A });
  await readTransitions(root, taskId, { runId: B });
  assert.equal((await appendTransition(root, taskId, { runId: B, kind: "delegated", evidence: ev(B) })).recorded, false);
  assert.equal(await readFile(path, "utf8"), before);
});

test("historical mixed-run records are not progress for another run", async () => {
  const { root, taskId } = await repoWithTask();
  // Legacy shape: run A's delegated + run B's result_observed (B never delegated).
  const path = taskPaths(root, taskId).transitionsPath;
  const line = (runId, kind) => `${JSON.stringify({ schema: "kairo.transition/v1", taskId, runId, kind, at: "t", evidence: ev(runId) })}\n`;
  await appendFile(path, line(A, "delegated") + line(B, "result_observed"));
  const before = await readFile(path, "utf8");
  const b = await readTransitions(root, taskId, { runId: B });
  assert.equal(b.state, "ok");
  assert.equal(b.next, "delegated", "B's own progress is not inferred from A");
  assert.equal(await readFile(path, "utf8"), before);
});
