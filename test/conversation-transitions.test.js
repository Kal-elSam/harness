import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArchitecturePlan } from "../src/global/architect/architect-manager.js";
import { taskPaths, transitionTask } from "../src/global/architect/architect-store.js";
import { createConversationService } from "../src/global/conversation/service.js";
import {
  TRANSITION_KINDS, appendTransition, deriveNextTransition, readTransitions
} from "../src/global/conversation/transition-store.js";

const RUN = "run_test_1";
const TARGET = Object.freeze({ role: "Builder", selection: "assigned", strategyFingerprint: "fp-1", candidateKey: "codex:m1" });

async function gitRepo() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "kairo-trans-repo-")));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "T"], { cwd: root });
  await writeFile(join(root, "README.md"), "hi\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: root });
  return root;
}

async function approvedTask(root) {
  const created = await createArchitecturePlan({
    task: "Do a thing", cwd: root, runCodex: async () => ({ plan: "## Plan\nDo it.", usage: null })
  });
  await transitionTask(root, created.status.taskId, "approved");
  return created.status.taskId;
}

async function realService({ runState = "completed", events } = {}) {
  const root = await gitRepo();
  const home = await mkdtemp(join(tmpdir(), "kairo-trans-home-"));
  const taskId = await approvedTask(root);
  const counters = { startRun: 0 };
  const state = { runState, events: events ?? [{ type: "run.transcript", source: "codex", data: { text: "Done." } }] };
  const service = createConversationService({
    resolveRoot: async () => root,
    homeDir: home,
    createRunId: () => RUN,
    startRun: async () => {
      counters.startRun += 1;
      return { metadata: { state: "running", startedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" } };
    },
    readRun: async () => ({ runId: RUN, agentId: "codex", state: state.runState, error: null }),
    readRunEvents: async () => state.events,
    gentle: { probe: async () => ({ state: "missing", evidence: [] }), runCommand: () => { throw new Error("must not run"); } }
  });
  service.routeProjectExecution = async () => ({
    decision: "ROUTED", strategyFingerprint: "fp-1",
    model: { adapterId: "codex", modelId: "m1", candidateKey: "codex:m1" }
  });
  return { service, root, home, taskId, counters, state };
}

const linesOf = async (root, taskId) => (await readFile(taskPaths(root, taskId).transitionsPath, "utf8")).trim().split("\n");

test("fixed circuit enum, frozen", () => {
  assert.deepEqual([...TRANSITION_KINDS], [
    "delegated", "result_observed", "review_authorized", "comments_recorded", "correction_recorded"
  ]);
  assert.throws(() => { TRANSITION_KINDS.push("x"); });
});

test("append is idempotent per (kind, run) and never rewrites the file", async () => {
  const root = await gitRepo();
  const taskId = await approvedTask(root);
  const first = await appendTransition(root, taskId, { runId: RUN, kind: "delegated", evidence: `run:${RUN}` });
  assert.equal(first.recorded, true);
  const before = await readFile(taskPaths(root, taskId).transitionsPath, "utf8");
  const second = await appendTransition(root, taskId, { runId: RUN, kind: "delegated", evidence: `run:${RUN}` });
  assert.equal(second.recorded, false);
  assert.equal(await readFile(taskPaths(root, taskId).transitionsPath, "utf8"), before);
  const read = await readTransitions(root, taskId);
  assert.equal(read.state, "ok");
  assert.equal(read.entries.length, 1);
  assert.deepEqual(Object.keys(read.entries[0]).sort(), ["at", "evidence", "kind", "runId", "schema", "taskId"]);
  assert.equal(read.next, "result_observed");
});

test("append rejects unknown kinds, unsafe evidence and out-of-order steps with typed codes", async () => {
  const root = await gitRepo();
  const taskId = await approvedTask(root);
  const code = async (input) => appendTransition(root, taskId, input).then(() => null, (e) => e.code);
  assert.equal(await code({ runId: RUN, kind: "merge", evidence: `run:${RUN}` }), "TRANSITION_KIND_INVALID");
  assert.equal(await code({ runId: RUN, kind: "delegated", evidence: "/Users/x/secret.txt" }), "TRANSITION_EVIDENCE_INVALID");
  assert.equal(await code({ runId: RUN, kind: "delegated", evidence: "token=abc" }), "TRANSITION_EVIDENCE_INVALID");
  assert.equal(await code({ runId: "../x", kind: "delegated", evidence: "run:x" }), "TRANSITION_RUN_INVALID");
  assert.equal(await code({ runId: RUN, kind: "review_authorized", evidence: "review:r1" }), "TRANSITION_OUT_OF_ORDER");
});

test("derived next walks the circuit and is null when complete; nothing is executed", () => {
  assert.equal(deriveNextTransition([]), "delegated");
  const kinds = ["delegated", "result_observed", "review_authorized", "comments_recorded", "correction_recorded"];
  assert.equal(deriveNextTransition([{ kind: kinds[0] }, { kind: kinds[1] }]), "review_authorized");
  assert.equal(deriveNextTransition(kinds.map((kind) => ({ kind }))), null);
});

test("corrupt or unsafe transition file -> typed corrupt, never thrown, never overwritten", async () => {
  const root = await gitRepo();
  const taskId = await approvedTask(root);
  const path = taskPaths(root, taskId).transitionsPath;
  await writeFile(path, "{not json\n");
  const read = await readTransitions(root, taskId);
  assert.equal(read.state, "corrupt");
  assert.equal(read.error, "transitions_corrupt");
  assert.equal(read.next, null);
  const err = await appendTransition(root, taskId, { runId: RUN, kind: "delegated", evidence: `run:${RUN}` }).then(() => null, (e) => e);
  assert.equal(err.code, "TRANSITION_CORRUPT");
  assert.equal(await readFile(path, "utf8"), "{not json\n");

  const root2 = await gitRepo();
  const task2 = await approvedTask(root2);
  const target = join(root2, "elsewhere.jsonl");
  await writeFile(target, "");
  await symlink(target, taskPaths(root2, task2).transitionsPath);
  assert.equal((await readTransitions(root2, task2)).state, "corrupt");
});

test("REAL service: executePlan repeated with the same confirmation launches once and records one delegated transition", async () => {
  const { service, root, taskId, counters } = await realService({ runState: "running" });
  const first = await service.executePlan({ cwd: root, taskId, confirmationTarget: { ...TARGET } });
  assert.equal(first.reused, false);
  const second = await service.executePlan({ cwd: root, taskId, confirmationTarget: { ...TARGET } });
  const third = await service.executePlan({ cwd: root, taskId, confirmationTarget: { ...TARGET } });
  assert.equal(second.reused, true);
  assert.equal(third.reused, true);
  assert.equal(counters.startRun, 1);
  const lines = await linesOf(root, taskId);
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).kind, "delegated");
  assert.equal(JSON.parse(lines[0]).evidence, `run:${RUN}`);
  assert.equal(lines[0].includes(root), false, "no absolute paths persisted");
});

test("REAL service: readTaskResult x2 is stable, records result_observed once, launches nothing", async () => {
  const { service, root, taskId, counters } = await realService();
  await service.executePlan({ cwd: root, taskId, confirmationTarget: { ...TARGET } });
  const first = await service.readTaskResult({ cwd: root, taskId });
  const bytes = (await readFile(taskPaths(root, taskId).transitionsPath, "utf8"));
  const second = await service.readTaskResult({ cwd: root, taskId });
  assert.deepEqual(second, first);
  assert.equal(await readFile(taskPaths(root, taskId).transitionsPath, "utf8"), bytes);
  assert.equal(counters.startRun, 1);
  assert.equal(first.status, "terminal");
  assert.equal(first.gentle.state, "unavailable");
  assert.equal(first.gentle.reason, "gentle_binary_missing");
  assert.deepEqual(first.transitions.entries.map((e) => e.kind), ["delegated", "result_observed"]);
  assert.equal(first.transitions.next, "review_authorized");
});

test("REAL service: a running task records nothing beyond delegated and reports result_observed next", async () => {
  const { service, root, taskId } = await realService({ runState: "running" });
  await service.executePlan({ cwd: root, taskId, confirmationTarget: { ...TARGET } });
  const out = await service.readTaskResult({ cwd: root, taskId });
  assert.equal(out.status, "running");
  assert.deepEqual(out.transitions.entries.map((e) => e.kind), ["delegated"]);
  assert.equal(out.transitions.next, "result_observed");
});

test("REAL service: corrupt transition file -> typed corrupt, result still returned, nothing relaunched", async () => {
  const { service, root, taskId, counters } = await realService();
  await service.executePlan({ cwd: root, taskId, confirmationTarget: { ...TARGET } });
  await writeFile(taskPaths(root, taskId).transitionsPath, "garbage\n");
  const out = await service.readTaskResult({ cwd: root, taskId });
  assert.equal(out.status, "terminal");
  assert.equal(out.transitions.state, "corrupt");
  assert.equal(out.transitions.next, null);
  const again = await service.executePlan({ cwd: root, taskId, confirmationTarget: { ...TARGET } });
  assert.equal(again.reused, true);
  assert.equal(counters.startRun, 1);
  assert.equal(await readFile(taskPaths(root, taskId).transitionsPath, "utf8"), "garbage\n");
});

test("REAL service: corrupt run events -> typed result_corrupt, no result fabricated", async () => {
  const { service, root, taskId } = await realService({ events: [{ parseError: true, line: 3 }] });
  await service.executePlan({ cwd: root, taskId, confirmationTarget: { ...TARGET } });
  const out = await service.readTaskResult({ cwd: root, taskId });
  assert.equal(out.status, "evidence_unreadable");
  assert.equal(out.errorCode, "result_corrupt");
  assert.equal(out.result, null);
  assert.deepEqual(out.transitions.entries.map((e) => e.kind), ["delegated"]);
});

test("REAL service: recordTransition only appends review-side kinds in order and launches nothing", async () => {
  const { service, root, taskId, counters } = await realService();
  await service.executePlan({ cwd: root, taskId, confirmationTarget: { ...TARGET } });
  const reject = (input) => service.recordTransition({ cwd: root, taskId, ...input }).then(() => null, (e) => e.code);
  assert.equal(await reject({ kind: "merge", evidence: "review:r1" }), "TRANSITION_KIND_INVALID");
  assert.equal(await reject({ kind: "delegated", evidence: "run:x" }), "TRANSITION_KIND_NOT_EXTERNAL");
  assert.equal(await reject({ kind: "review_authorized", evidence: "review:r1" }), "TRANSITION_OUT_OF_ORDER");
  await service.readTaskResult({ cwd: root, taskId });
  const rec = await service.recordTransition({ cwd: root, taskId, kind: "review_authorized", evidence: "review:r1" });
  assert.equal(rec.recorded, true);
  const dup = await service.recordTransition({ cwd: root, taskId, kind: "review_authorized", evidence: "review:r1" });
  assert.equal(dup.recorded, false);
  const out = await service.readTaskResult({ cwd: root, taskId });
  assert.equal(out.transitions.next, "comments_recorded");
  assert.equal(counters.startRun, 1);
});

test("recordTransition without an execution is a typed refusal", async () => {
  const { service, root, taskId } = await realService();
  const code = await service.recordTransition({ cwd: root, taskId, kind: "review_authorized", evidence: "review:r1" })
    .then(() => null, (e) => e.code);
  assert.equal(code, "TRANSITION_NO_EXECUTION");
});

test("readTeam shows the derived pending next transition per task, read-only", async () => {
  const plan = {
    taskId: "t1", state: "approved", provider: "codex", model: null, sessionId: null, baseHead: "a".repeat(40),
    createdAt: "c", updatedAt: "u", artifacts: {}
  };
  const calls = [];
  const service = createConversationService({
    resolveRoot: async (cwd) => cwd, listPlans: async () => [plan],
    readExecution: async () => ({ runId: "run_x", agentId: "codex" }),
    readRun: async () => ({ runId: "run_x", agentId: "codex", state: "completed", error: null }),
    recoverRuns: async () => {}, inspectExecutionAdapters: () => [], inspectEngramIntegration: () => ({ status: "configured" }),
    readProjectStrategy: async () => null, listSessions: async () => [],
    startRun: async () => { throw new Error("no launch"); },
    transitionStore: {
      read: async (_root, id, opts) => { calls.push([id, opts?.runId]); return { state: "ok", entries: [{ kind: "delegated" }], next: "result_observed" }; },
      append: async () => { throw new Error("readTeam must not write"); }
    }
  });
  const team = await service.readTeam({ cwd: "/repo" });
  assert.equal(team.tasks[0].nextTransition, "result_observed");
  assert.deepEqual(calls, [["t1", "run_x"]], "progress is read for the current execution run only");
});
