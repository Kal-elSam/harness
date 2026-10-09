import assert from "node:assert/strict";
import { test } from "node:test";
import { composeTaskResult } from "../src/global/conversation/task-result.js";
import { associateResultWithGentleReview } from "../src/global/control-plane/review-association.js";
import { PROVIDER } from "../src/global/control-plane/constants.js";
import { mapOfficialReviewStatus } from "../src/global/control-plane/review-status.js";
import { normalizeRunResult } from "../src/global/kernel/run-result-normalizer.js";

const TASK = "task-1";
const RUN = "run-1";
const LINK = { runId: RUN, agentId: "claude" };
const transcript = (text) => ({ type: "run.transcript", source: "claude", data: { text } });
const run = (state, extra = {}) => ({ runId: RUN, state, agentId: "claude", error: null, ...extra });

function setup({ link = LINK, readRun = async () => run("completed"), events = [transcript("Done.")], gentle } = {}) {
  const calls = { association: 0, gentle: 0, events: 0 };
  const deps = {
    link,
    readRun,
    readEvents: async () => { calls.events += 1; return events; },
    normalize: normalizeRunResult,
    associate: (args) => { calls.association += 1; return associateResultWithGentleReview(args); },
    readGentleContext: async () => {
      calls.gentle += 1;
      return gentle ?? { provider: PROVIDER.CONNECTED, mappedStatus: { ok: true, review: null, nextTransition: null }, rddMode: "on" };
    }
  };
  return { calls, compose: () => composeTaskResult({ taskId: TASK, projectRoot: "/p", ...deps }) };
}

const official = (payload) => mapOfficialReviewStatus({
  schema: "gentle-ai.review-integration.status/v2",
  contract: "gentle-ai.review-integration/v2",
  ...payload
});

test("no link -> not_started with nothing else", async () => {
  const { compose, calls } = setup({ link: null });
  assert.deepEqual(await compose(), {
    taskId: TASK, runId: null, provider: null, status: "not_started", runState: null, result: null, gentle: null
  });
  assert.equal(calls.association + calls.gentle + calls.events, 0);
});

for (const state of ["pending", "starting", "running"]) {
  test(`active state ${state} -> running, no result, no association`, async () => {
    const { compose, calls } = setup({ readRun: async () => run(state) });
    const out = await compose();
    assert.equal(out.status, "running");
    assert.equal(out.runId, RUN);
    assert.equal(out.runState, state);
    assert.equal(out.result, null);
    assert.equal(out.gentle, null);
    assert.equal(calls.association, 0);
    assert.equal(calls.gentle, 0);
  });
}

test("link but run record absent -> evidence_missing keeps runId", async () => {
  const { compose } = setup({ readRun: async () => null });
  const out = await compose();
  assert.equal(out.status, "evidence_missing");
  assert.equal(out.runId, RUN);
  assert.equal(out.result, null);
  assert.equal(out.gentle, null);
});

test("run record read throws -> evidence_unreadable keeps runId and message", async () => {
  const { compose } = setup({ readRun: async () => { throw new Error("Invalid run state at x"); } });
  const out = await compose();
  assert.equal(out.status, "evidence_unreadable");
  assert.equal(out.runId, RUN);
  assert.match(out.error, /Invalid run state/);
  assert.equal(out.result, null);
});

test("events with unparseable lines -> evidence_unreadable (a lost line may be the final summary)", async () => {
  const { compose } = setup({ events: [transcript("ok"), { parseError: true, line: 2, message: "bad" }] });
  const out = await compose();
  assert.equal(out.status, "evidence_unreadable");
  assert.equal(out.runId, RUN);
  assert.equal(out.result, null);
  assert.equal(out.gentle, null);
});

test("unknown state -> unrecognized_state, result null, original state kept", async () => {
  const { compose, calls } = setup({ readRun: async () => run("weird") });
  const out = await compose();
  assert.equal(out.status, "unrecognized_state");
  assert.equal(out.runState, "weird");
  assert.equal(out.result, null);
  assert.equal(calls.association, 0);
});

test("completed with summary -> completed result", async () => {
  const out = await setup().compose();
  assert.equal(out.status, "terminal");
  assert.equal(out.runState, "completed");
  assert.equal(out.provider, "claude");
  assert.equal(out.result.status, "completed");
  assert.equal(out.result.summary, "Done.");
});

test("completed without summary -> failed 'no summary produced'", async () => {
  const out = await setup({ events: [] }).compose();
  assert.equal(out.runState, "completed");
  assert.equal(out.result.status, "failed");
  assert.equal(out.result.error, "no summary produced");
});

test("failed run -> failed result", async () => {
  const out = await setup({ readRun: async () => run("failed", { error: "boom" }) }).compose();
  assert.equal(out.result.status, "failed");
  assert.equal(out.runState, "failed");
});

test("cancelled run -> cancelled result", async () => {
  const out = await setup({ readRun: async () => run("cancelled") }).compose();
  assert.equal(out.result.status, "cancelled");
});

test("interrupted keeps runState and normalizes to failed", async () => {
  const out = await setup({ readRun: async () => run("interrupted"), events: [transcript("partial")] }).compose();
  assert.equal(out.status, "terminal");
  assert.equal(out.runState, "interrupted");
  assert.equal(out.result.status, "failed");
  assert.match(out.result.error, /unexpected state "interrupted"/);
  assert.equal(out.result.summary, "partial");
});

test("gentle pending when no receipt; read-only context fields exposed", async () => {
  const gentle = {
    provider: PROVIDER.CONNECTED,
    mappedStatus: official({ applicability: "applicable", next_transition: { kind: "execute" } }),
    rddMode: "on"
  };
  const out = await setup({ gentle }).compose();
  assert.equal(out.gentle.state, "pending");
  assert.equal(out.gentle.scope, "project_context");
  assert.equal(out.gentle.taskReview, "not_established");
  assert.equal(out.gentle.applicability, "applicable");
  assert.deepEqual(out.gentle.nextTransition, { kind: "execute" });
  assert.equal(out.gentle.receipt, null);
});

test("foreign receipt is project_receipt, never task review, and no approval key anywhere", async () => {
  const gentle = {
    provider: PROVIDER.CONNECTED,
    mappedStatus: official({ applicability: "unrelated", receipt: { id: "rcpt-9", status: "approved" }, gate: "g1" }),
    rddMode: "on"
  };
  const out = await setup({ gentle }).compose();
  assert.equal(out.gentle.state, "project_receipt");
  assert.equal(out.gentle.receipt, "rcpt-9");
  assert.equal(out.gentle.gate, "g1");
  assert.equal(out.gentle.taskReview, "not_established");
  assert.equal(out.gentle.scope, "project_context");
  assert.equal(JSON.stringify(out).includes("approval"), false);
});

test("rdd off", async () => {
  const out = await setup({ gentle: { provider: PROVIDER.CONNECTED, mappedStatus: null, rddMode: "off" } }).compose();
  assert.equal(out.gentle.state, "rdd_off");
});

test("rdd unknown is not off", async () => {
  const out = await setup({ gentle: { provider: PROVIDER.CONNECTED, mappedStatus: official({}), rddMode: "unknown" } }).compose();
  assert.notEqual(out.gentle.state, "rdd_off");
});

const incompatibleCases = {
  "bad schema": { provider: PROVIDER.CONNECTED, mappedStatus: mapOfficialReviewStatus({ schema: "nope" }), rddMode: "on" },
  "inventory schema": { provider: PROVIDER.CONNECTED, mappedStatus: mapOfficialReviewStatus({ schema: "x", entries: [] }), rddMode: "on" },
  "parse failure": { provider: PROVIDER.INCOMPATIBLE, mappedStatus: null, rddMode: "on", error: "gentle_parse_failed" },
  "non-zero without payload": { provider: PROVIDER.INCOMPATIBLE, mappedStatus: null, rddMode: "on", error: "gentle_exit_nonzero" },
  "upgrade required": { provider: PROVIDER.UPGRADE_REQUIRED, mappedStatus: null, rddMode: "on", error: "gentle_upgrade_required" }
};
for (const [name, gentle] of Object.entries(incompatibleCases)) {
  test(`gentle incompatible: ${name}`, async () => {
    const out = await setup({ gentle }).compose();
    assert.equal(out.gentle.state, "incompatible");
    assert.equal(out.gentle.receipt, null);
  });
}

test("incompatible keeps the original error code in reason", async () => {
  const out = await setup({ gentle: incompatibleCases["parse failure"] }).compose();
  assert.equal(out.gentle.reason, "gentle_parse_failed");
});

test("gentle unavailable on spawn failure, with reason", async () => {
  const gentle = { provider: PROVIDER.UNAVAILABLE, mappedStatus: null, rddMode: "unknown", error: "ENOENT" };
  const out = await setup({ gentle }).compose();
  assert.equal(out.gentle.state, "unavailable");
  assert.equal(out.gentle.reason, "ENOENT");
});

test("reader throwing degrades to unavailable, result still returned", async () => {
  const s = setup();
  const out = await composeTaskResult({
    taskId: TASK, projectRoot: "/p", link: LINK, readRun: async () => run("completed"),
    readEvents: async () => [transcript("ok")], normalize: normalizeRunResult, associate: associateResultWithGentleReview,
    readGentleContext: async () => { throw new Error("kaboom"); }
  });
  assert.equal(out.result.status, "completed");
  assert.equal(out.gentle.state, "unavailable");
  assert.match(out.gentle.reason, /kaboom/);
  assert.ok(s);
});

test("gentle reader is invoked only for terminal runs", async () => {
  const running = setup({ readRun: async () => run("running") });
  await running.compose();
  assert.equal(running.calls.gentle, 0);
  const done = setup();
  await done.compose();
  assert.equal(done.calls.gentle, 1);
});
