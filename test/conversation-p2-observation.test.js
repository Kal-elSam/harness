import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArchitecturePlan } from "../src/global/architect/architect-manager.js";
import { taskPaths, transitionTask } from "../src/global/architect/architect-store.js";
import { createConversationService } from "../src/global/conversation/service.js";
import { appendTransition } from "../src/global/conversation/transition-store.js";
import { composeTaskResult } from "../src/global/conversation/task-result.js";
import { pubTaskResult } from "../src/global/conversation/operations.js";
import { associateResultWithGentleReview } from "../src/global/control-plane/review-association.js";
import { PROVIDER } from "../src/global/control-plane/constants.js";
import { mapOfficialReviewStatus } from "../src/global/control-plane/review-status.js";
import { normalizeRunResult } from "../src/global/kernel/run-result-normalizer.js";

const RUN = "run_test_1";
const TARGET = Object.freeze({ role: "Builder", selection: "assigned", strategyFingerprint: "fp-1", candidateKey: "codex:m1" });

async function realService({ runState = "completed" } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "kairo-p2-repo-")));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "T"], { cwd: root });
  await writeFile(join(root, "README.md"), "hi\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: root });
  const home = await mkdtemp(join(tmpdir(), "kairo-p2-home-"));
  const created = await createArchitecturePlan({
    task: "Do a thing", cwd: root, runCodex: async () => ({ plan: "## Plan\nDo it.", usage: null })
  });
  const taskId = created.status.taskId;
  await transitionTask(root, taskId, "approved");
  const counters = { startRun: 0 };
  const service = createConversationService({
    resolveRoot: async () => root, homeDir: home, createRunId: () => RUN,
    startRun: async () => { counters.startRun += 1; return { metadata: { state: "running", startedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" } }; },
    readRun: async () => ({ runId: RUN, agentId: "codex", state: runState, error: null }),
    readRunEvents: async () => [{ type: "run.transcript", source: "codex", data: { text: "Done." } }],
    gentle: { probe: async () => ({ state: "missing", evidence: [] }), runCommand: () => { throw new Error("must not run"); } }
  });
  service.routeProjectExecution = async () => ({
    decision: "ROUTED", strategyFingerprint: "fp-1",
    model: { adapterId: "codex", modelId: "m1", candidateKey: "codex:m1" }
  });
  return { service, root, taskId, counters };
}

const seedRunA = async (root, taskId) => {
  for (const [kind, evidence] of [["delegated", "run:run_a"], ["result_observed", "run:run_a"], ["review_authorized", "gentle:r1"], ["comments_recorded", "gentle:r2"]]) {
    await appendTransition(root, taskId, { runId: "run_a", kind, evidence });
  }
};

test("REAL service: another run's history never advances the current run's circuit", async () => {
  const { service, root, taskId } = await realService();
  await service.executePlan({ cwd: root, taskId, confirmationTarget: { ...TARGET } });
  await seedRunA(root, taskId);
  const out = await service.readTaskResult({ cwd: root, taskId });
  assert.deepEqual(out.transitions.entries.map((e) => e.kind), ["delegated", "result_observed"]);
  assert.ok(out.transitions.entries.every((e) => e.runId === RUN));
  assert.equal(out.transitions.next, "review_authorized");
  const work = await service.readWork({ cwd: root });
  assert.equal(work.tasks.find((t) => t.taskId === taskId).nextTransition, "review_authorized");
});

test("REAL service: no current execution -> old progress is not shown as the circuit", async () => {
  const { service, root, taskId, counters } = await realService();
  await seedRunA(root, taskId);
  const before = await readFile(taskPaths(root, taskId).transitionsPath, "utf8");
  const out = await service.readTaskResult({ cwd: root, taskId });
  assert.equal(out.status, "not_started");
  assert.deepEqual(out.transitions.entries, []);
  assert.equal(out.transitions.next, "delegated");
  const work = await service.readWork({ cwd: root });
  assert.equal(work.tasks.find((t) => t.taskId === taskId).nextTransition, "delegated");
  assert.equal(await readFile(taskPaths(root, taskId).transitionsPath, "utf8"), before);
  assert.equal(counters.startRun, 0);
});

test("REAL service: corruption in the log still reads as corrupt with no current execution", async () => {
  const { service, root, taskId } = await realService();
  await writeFile(taskPaths(root, taskId).transitionsPath, "garbage\n");
  const out = await service.readTaskResult({ cwd: root, taskId });
  assert.equal(out.transitions.state, "corrupt");
  assert.equal(out.transitions.next, null);
});

test("REAL service: terminal state + project gentle context keep legacy behavior, no review advance", async () => {
  const { service, root, taskId } = await realService({ runState: "interrupted" });
  await service.executePlan({ cwd: root, taskId, confirmationTarget: { ...TARGET } });
  const out = await service.readTaskResult({ cwd: root, taskId });
  assert.equal(out.status, "terminal");
  assert.equal(out.gentle.taskReview, "not_established");
  assert.deepEqual(out.transitions.entries.map((e) => e.kind), ["delegated", "result_observed"]);
});

// --- projection (task-result + operations) ---
const LINK = { runId: "run-1", agentId: "claude" };
const official = (payload) => mapOfficialReviewStatus({
  schema: "gentle-ai.review-integration.status/v2", contract: "gentle-ai.review-integration/v2", ...payload
});
const compose = (gentle) => composeTaskResult({
  taskId: "task-1", projectRoot: "/p", link: LINK,
  readRun: async () => ({ runId: "run-1", state: "completed", agentId: "claude", error: null }),
  readEvents: async () => [{ type: "run.transcript", source: "claude", data: { text: "Done." } }],
  normalize: normalizeRunResult, associate: associateResultWithGentleReview,
  readGentleContext: async () => gentle
});
const CONNECTED = { provider: PROVIDER.CONNECTED, rddMode: "on" };

test("valid project status without a task binding -> task_binding_unavailable, never approval", async () => {
  for (const mappedStatus of [official({ applicability: "unrelated", receipt: { id: "rcpt-9", status: "approved" }, gate: "g1" }), official({})]) {
    const pub = pubTaskResult({ ...(await compose({ ...CONNECTED, mappedStatus })), transitions: null });
    assert.equal(pub.gentle.scope, "project_context");
    assert.equal(pub.gentle.taskReview, "not_established");
    assert.deepEqual(pub.gentle.diagnostics, ["task_binding_unavailable"]);
    assert.equal(pub.gentle.actionsEnabled, false);
  }
});

test("project receipt and gate are exposed as project context only", async () => {
  const pub = pubTaskResult(await compose({ ...CONNECTED, mappedStatus: official({ applicability: "unrelated", receipt: { id: "rcpt-9", status: "approved" }, gate: "g1" }) }));
  assert.equal(pub.gentle.receipt, "rcpt-9");
  assert.equal(pub.gentle.gate, "g1");
  assert.equal(pub.gentle.state, "project_receipt");
});

test("incompatible, unavailable or RDD-off Gentle -> actions disabled, no binding diagnostic", async () => {
  const cases = {
    incompatible: { provider: PROVIDER.INCOMPATIBLE, mappedStatus: null, rddMode: "on", error: "gentle_parse_failed" },
    unavailable: { provider: PROVIDER.UNAVAILABLE, mappedStatus: null, rddMode: "unknown", error: "gentle_binary_missing" },
    rdd_off: { provider: PROVIDER.CONNECTED, mappedStatus: official({}), rddMode: "off" }
  };
  for (const [name, gentle] of Object.entries(cases)) {
    const pub = pubTaskResult(await compose(gentle));
    assert.equal(pub.gentle.state, name === "rdd_off" ? "rdd_off" : name);
    assert.equal(pub.gentle.actionsEnabled, false, name);
    assert.deepEqual(pub.gentle.diagnostics, [], name);
    assert.equal(pub.gentle.taskReview, "not_established");
  }
});

test("projection never publishes next_transition or executable command fields", async () => {
  const pub = pubTaskResult(await compose({
    ...CONNECTED,
    mappedStatus: official({ applicability: "unrelated", receipt: { id: "rcpt-9", status: "approved" }, next_transition: { kind: "execute", execute: { command: "gentle-ai review start" } } })
  }));
  const blob = JSON.stringify(pub);
  assert.equal("nextTransition" in pub.gentle, false);
  assert.equal(/next_transition|nextTransition|"command"|"execute"|gentle-ai review/.test(blob), false);
});
