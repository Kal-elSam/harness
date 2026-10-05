import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createWorkRequest,
  createWorkResult,
  isWorkRequest,
  isWorkResult
} from "../src/global/kernel/contracts.js";
import { createKernelService, normalizeWorkerLine } from "../src/global/kernel/service.js";
import { requestKernelSnapshot } from "../src/global/host/extension/index.js";
import { PROJECT_ROUTE_DECISION } from "../src/global/conversation/project-router.js";

test("createWorkRequest requires role, task, projectRoot, and sessionId", () => {
  const request = createWorkRequest({
    role: "Builder",
    task: "Add host launch",
    projectRoot: "/repo",
    sessionId: "11111111-1111-4111-8111-111111111111"
  });
  assert.equal(isWorkRequest(request), true);
  assert.equal(request.role, "Builder");
});

test("isWorkRequest rejects a missing sessionId", () => {
  assert.equal(isWorkRequest({ role: "Builder", task: "x", projectRoot: "/repo" }), false);
});

test("kernel snapshot does not import ink or cockpit", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/global/kernel/service.js"), "utf8");
  assert.doesNotMatch(src, /global\/ink\/|global\/cockpit\//);
  const snapshot = createKernelService({
    readStrategy: () => null,
    readAvailability: () => ({})
  }).snapshot();
  assert.equal(snapshot.strategy, null);
  assert.deepEqual(snapshot.availability, {});
});

test("route without an active strategy is WAIT_FOR_PROJECT_TEAM", () => {
  const request = createWorkRequest({
    role: "Builder",
    task: "Ship kernel",
    projectRoot: "/repo",
    sessionId: "11111111-1111-4111-8111-111111111111"
  });
  const decision = createKernelService({ readStrategy: () => null }).route(request);
  assert.equal(decision.decision, PROJECT_ROUTE_DECISION.WAIT_FOR_PROJECT_TEAM);
});

test("unknown worker lines become opaque events and do not fabricate tools tests or diffs", () => {
  const event = normalizeWorkerLine("not-json noise", "worker-1");
  assert.equal(event.type, "opaque");
  assert.equal(event.workerId, "worker-1");
  assert.equal(event.payload.raw, "not-json noise");
  assert.equal(event.type === "tool_call", false);
});

test("extension requests snapshots through the in-process kernel API", () => {
  const snapshot = requestKernelSnapshot({
    readStrategy: () => ({ status: "active" }),
    readAvailability: () => ({ claude: { ok: true } })
  });
  assert.equal(snapshot.strategy.status, "active");
  assert.equal(snapshot.availability.claude.ok, true);
});

test("createWorkResult accepts completed, failed, and cancelled results", () => {
  assert.deepEqual(
    createWorkResult({ ok: true, workerId: "w1", status: "completed", summary: "  Done  " }),
    { ok: true, workerId: "w1", status: "completed", summary: "Done", error: null }
  );
  assert.deepEqual(
    createWorkResult({ ok: false, workerId: "w1", status: "failed", error: " boom " }),
    { ok: false, workerId: "w1", status: "failed", summary: null, error: "boom" }
  );
  assert.deepEqual(
    createWorkResult({ ok: false, workerId: "w1", status: "failed", summary: "Partial notes" }),
    { ok: false, workerId: "w1", status: "failed", summary: "Partial notes", error: null }
  );
  assert.deepEqual(
    createWorkResult({ ok: false, workerId: "w1", status: "cancelled" }),
    { ok: false, workerId: "w1", status: "cancelled", summary: null, error: null }
  );
});

test("createWorkResult infers status from ok when absent", () => {
  assert.equal(createWorkResult({ ok: true, workerId: "w1", summary: "Done" }).status, "completed");
  assert.equal(createWorkResult({ ok: false, workerId: "w1", error: "boom" }).status, "failed");
});

test("completed WorkResult requires a non-empty summary", () => {
  for (const summary of [null, undefined, "", "   "]) {
    assert.throws(() => createWorkResult({ ok: true, workerId: "w1", status: "completed", summary }), /summary/i);
  }
  assert.throws(() => createWorkResult({ ok: true, workerId: "w1" }), /summary/i);
});

test("failed WorkResult requires a summary or a non-empty error", () => {
  assert.throws(() => createWorkResult({ ok: false, workerId: "w1", status: "failed" }), /error/i);
  assert.throws(() => createWorkResult({ ok: false, workerId: "w1", status: "failed", error: "  " }), /error/i);
});

test("contradictory WorkResult states are rejected", () => {
  assert.throws(() => createWorkResult({ ok: false, workerId: "w1", status: "completed", summary: "Done" }), /ok/i);
  assert.throws(() => createWorkResult({ ok: true, workerId: "w1", status: "cancelled" }), /ok/i);
  assert.throws(() => createWorkResult({ ok: true, workerId: "w1", status: "failed", error: "boom" }), /ok/i);
  assert.throws(() => createWorkResult({ ok: true, workerId: "w1", status: "bogus", summary: "Done" }), /status/i);
});

test("WorkResult rejects non-boolean ok and empty workerId", () => {
  assert.throws(() => createWorkResult({ ok: "yes", workerId: "w1", summary: "Done" }), /ok/i);
  assert.throws(() => createWorkResult({ ok: undefined, workerId: "w1", summary: "Done" }), /ok/i);
  assert.throws(() => createWorkResult({ ok: true, workerId: "", summary: "Done" }), /workerId/i);
  assert.throws(() => createWorkResult({ ok: true, workerId: "  ", summary: "Done" }), /workerId/i);
  assert.throws(() => createWorkResult({ ok: true, workerId: 7, summary: "Done" }), /workerId/i);
});

test("isWorkResult accepts valid results and rejects invalid ones without throwing", () => {
  assert.equal(isWorkResult(createWorkResult({ ok: true, workerId: "w1", summary: "Done" })), true);
  assert.equal(isWorkResult({ status: 0 }), false);
  assert.equal(isWorkResult(null), false);
  assert.equal(isWorkResult({ ok: true, workerId: "w1", status: "completed", summary: null, error: null }), false);
  assert.equal(isWorkResult({ ok: true, workerId: "w1", status: "cancelled", summary: null, error: null }), false);
});
