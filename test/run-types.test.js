import test from "node:test";
import assert from "node:assert/strict";
import {
  RUN_STATES,
  createRunId,
  createRunMetadata,
  createTaskFingerprint,
  formatTaskLabel,
  isActiveRunState,
  isTerminalRunState
} from "../src/global/runtime/run-types.js";

test("createRunId returns unique prefixed ids", () => {
  const a = createRunId();
  const b = createRunId();
  assert.match(a, /^run_/);
  assert.notEqual(a, b);
});

test("run state helpers classify active and terminal states", () => {
  assert.equal(isActiveRunState(RUN_STATES.RUNNING), true);
  assert.equal(isActiveRunState(RUN_STATES.STARTING), true);
  assert.equal(isActiveRunState(RUN_STATES.COMPLETED), false);
  assert.equal(isTerminalRunState(RUN_STATES.FAILED), true);
  assert.equal(isTerminalRunState(RUN_STATES.RUNNING), false);
});

test("createRunMetadata stores digest and length without raw task", () => {
  const metadata = createRunMetadata({
    runId: "run_test",
    agentId: "cursor",
    provider: "Cursor",
    model: "gpt-5",
    task: "Fix the failing test",
    cwd: "/tmp/project",
    permissions: ["force"],
    cliVersion: "0.2.1"
  });

  assert.equal(metadata.state, RUN_STATES.PENDING);
  assert.equal(metadata.taskDigest, createTaskFingerprint("Fix the failing test").taskDigest);
  assert.equal(metadata.taskLength, 20);
  assert.equal(metadata.taskSummary, undefined);
  assert.equal(metadata.captureTranscript, false);
  assert.deepEqual(metadata.permissions, ["force"]);
});

test("createTaskFingerprint normalizes whitespace and hashes content", () => {
  const first = createTaskFingerprint("  hello   world  ");
  const second = createTaskFingerprint("hello world");

  assert.equal(first.taskLength, 11);
  assert.equal(first.taskDigest, second.taskDigest);
  assert.match(first.taskDigest, /^[a-f0-9]{16}$/);
});

test("formatTaskLabel never includes prompt text", () => {
  const label = formatTaskLabel({
    taskDigest: "abc123",
    taskLength: 42
  });

  assert.match(label, /abc123/);
  assert.match(label, /content not stored/);
  assert.doesNotMatch(label, /Fix the/);
});
