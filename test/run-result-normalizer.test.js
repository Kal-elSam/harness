import assert from "node:assert/strict";
import { test } from "node:test";
import { isWorkResult } from "../src/global/kernel/contracts.js";
import { normalizeRunResult } from "../src/global/kernel/run-result-normalizer.js";

const RUN_ID = "run-123";

const transcript = (data) => ({ type: "run.transcript", source: "claude", data });
const meta = (state, extra = {}) => ({ runId: RUN_ID, state, error: null, ...extra });

test("completed run with real transcript text is a completed WorkResult keyed by runId", () => {
  const result = normalizeRunResult({
    runId: RUN_ID,
    metadata: meta("completed"),
    events: [transcript({ text: "  All done.  " })]
  });
  assert.deepEqual(result, { ok: true, workerId: RUN_ID, status: "completed", summary: "All done.", error: null });
  assert.equal(isWorkResult(result), true);
});

test("the LAST run.transcript event wins, other event types are ignored", () => {
  const result = normalizeRunResult({
    runId: RUN_ID,
    metadata: meta("completed"),
    events: [
      transcript({ text: "first" }),
      transcript({ text: "second" }),
      { type: "run.completed", data: { exitCode: 0 } },
      { parseError: true, line: 4, message: "bad json" }
    ]
  });
  assert.equal(result.summary, "second");
});

test("a last transcript without real text does not fall back to an earlier one", () => {
  const result = normalizeRunResult({
    runId: RUN_ID,
    metadata: meta("completed"),
    events: [transcript({ text: "earlier" }), transcript({ usage: { tokens: 3 } })]
  });
  assert.equal(result.status, "failed");
  assert.equal(result.error, "no summary produced");
});

test("accepted text shapes: data.content string, data.result string, text content blocks", () => {
  const cases = [
    [{ content: "from content" }, "from content"],
    [{ result: "from result" }, "from result"],
    [{ content: [{ type: "text", text: "Hello " }, { type: "tool_use", id: "x" }, { type: "text", text: "world" }] }, "Hello world"]
  ];
  for (const [data, expected] of cases) {
    const result = normalizeRunResult({ runId: RUN_ID, metadata: meta("completed"), events: [transcript(data)] });
    assert.equal(result.summary, expected);
    assert.equal(result.status, "completed");
  }
});

test("a JSON-dump-only transcript is NOT accepted as a summary", () => {
  for (const data of [{ usage: { input: 1 } }, { message: { role: "assistant" } }, {}, null, "raw string", { content: [{ type: "image" }] }]) {
    const result = normalizeRunResult({ runId: RUN_ID, metadata: meta("completed"), events: [transcript(data)] });
    assert.equal(result.status, "failed");
    assert.equal(result.ok, false);
    assert.equal(result.workerId, RUN_ID);
    assert.equal(result.error, "no summary produced");
    assert.equal(result.summary, null);
  }
});

test("whitespace-only text and no transcript events count as no summary", () => {
  for (const events of [[transcript({ text: "   \n " })], [], [{ type: "run.completed" }]]) {
    const result = normalizeRunResult({ runId: RUN_ID, metadata: meta("completed"), events });
    assert.deepEqual(result, { ok: false, workerId: RUN_ID, status: "failed", summary: null, error: "no summary produced" });
  }
});

test("failed run passes the supervisor error through verbatim: exit code vs idle timeout", () => {
  const exit = "Process exited with code 2";
  const idle = "No real output for 60000ms (idle timeout) — likely hung, not a normal completion";
  const a = normalizeRunResult({ runId: RUN_ID, metadata: meta("failed", { error: exit }), events: [] });
  const b = normalizeRunResult({ runId: RUN_ID, metadata: meta("failed", { error: idle }), events: [] });
  assert.deepEqual(a, { ok: false, workerId: RUN_ID, status: "failed", summary: null, error: exit });
  assert.deepEqual(b, { ok: false, workerId: RUN_ID, status: "failed", summary: null, error: idle });
  assert.notEqual(a.error, b.error);
});

test("failed run includes a real transcript summary when one exists", () => {
  const result = normalizeRunResult({
    runId: RUN_ID,
    metadata: meta("failed", { error: "Process exited with code 1" }),
    events: [transcript({ text: "partial output" })]
  });
  assert.equal(result.status, "failed");
  assert.equal(result.summary, "partial output");
  assert.equal(result.error, "Process exited with code 1");
});

test("failed run without a recorded error gets a neutral message", () => {
  for (const error of [null, undefined, "", "   ", 42]) {
    const result = normalizeRunResult({ runId: RUN_ID, metadata: meta("failed", { error }), events: [] });
    assert.equal(result.status, "failed");
    assert.equal(result.error, "Run failed without a recorded error.");
  }
});

test("cancelled run reports status cancelled, ok false, error null", () => {
  const bare = normalizeRunResult({ runId: RUN_ID, metadata: meta("cancelled"), events: [] });
  assert.deepEqual(bare, { ok: false, workerId: RUN_ID, status: "cancelled", summary: null, error: null });
  const withText = normalizeRunResult({
    runId: RUN_ID,
    metadata: meta("cancelled", { error: "ignored" }),
    events: [transcript({ text: "stopped midway" })]
  });
  assert.deepEqual(withText, { ok: false, workerId: RUN_ID, status: "cancelled", summary: "stopped midway", error: null });
});

test("non-terminal or unknown states fail with an error naming the state", () => {
  for (const state of ["running", "pending", "starting", "interrupted", "bogus", undefined]) {
    const result = normalizeRunResult({ runId: RUN_ID, metadata: { runId: RUN_ID, state }, events: [] });
    assert.equal(result.status, "failed");
    assert.equal(result.workerId, RUN_ID);
    assert.match(result.error, new RegExp(String(state)));
  }
});

test("missing metadata or non-array events yield a failed WorkResult keeping runId", () => {
  for (const metadata of [undefined, null, "completed", 7]) {
    const result = normalizeRunResult({ runId: RUN_ID, metadata, events: [] });
    assert.equal(result.status, "failed");
    assert.equal(result.workerId, RUN_ID);
    assert.match(result.error, /metadata/i);
  }
  for (const events of [undefined, null, {}, "x"]) {
    const result = normalizeRunResult({ runId: RUN_ID, metadata: meta("completed"), events });
    assert.equal(result.status, "failed");
    assert.equal(result.workerId, RUN_ID);
    assert.match(result.error, /events/i);
  }
});

test("an invalid runId is the only thing that throws", () => {
  for (const runId of [undefined, null, "", "   ", 5]) {
    assert.throws(() => normalizeRunResult({ runId, metadata: meta("completed"), events: [] }), /runId/);
  }
  assert.throws(() => normalizeRunResult(), /runId/);
});

test("normalization is pure: frozen inputs are not mutated and no extra state is touched", () => {
  const events = Object.freeze([
    Object.freeze({ type: "run.transcript", data: Object.freeze({ content: Object.freeze([Object.freeze({ type: "text", text: "ok" })]) }) })
  ]);
  const metadata = Object.freeze({ runId: RUN_ID, state: "completed", error: null });
  const snapshot = JSON.stringify({ events, metadata });
  const result = normalizeRunResult({ runId: RUN_ID, metadata, events });
  assert.equal(result.summary, "ok");
  assert.equal(JSON.stringify({ events, metadata }), snapshot);
});
