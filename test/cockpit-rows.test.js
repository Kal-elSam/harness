import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTaskRows, clampSelection, derivePhase, formatRowText, isActionAvailable, keyHintsLine
} from "../src/global/cockpit/rows.js";

const TIMELINE = [
  {
    taskId: "task-a", state: "awaiting_approval", approval: "not_decided", provider: "codex", model: null,
    execution: { state: "not_started", active: false, message: "Approval is required." }
  },
  {
    taskId: "task-b", state: "approved", approval: "approved", provider: "codex", model: null,
    execution: { state: "running", active: true, message: "Claude run is running.", provider: "claude" }
  },
  { taskId: "task-c", state: "rejected", approval: "rejected", execution: { state: "not_started", active: false } }
];

test("buildTaskRows maps a conversation snapshot timeline into display rows", () => {
  const rows = buildTaskRows(TIMELINE);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    taskId: "task-a", taskText: null, planState: "awaiting_approval", approval: "not_decided",
    execState: "not_started", execActive: false, execMessage: "Approval is required.",
    planProvider: "codex", planModel: null, execProvider: null
  });
  assert.equal(rows[1].execActive, true);
  assert.equal(rows[1].execState, "running");
  assert.equal(rows[1].execProvider, "claude");
});

test("derivePhase reflects real plan/execution state, never a fabricated step", () => {
  assert.equal(derivePhase(null), "IDLE");
  assert.equal(derivePhase({ planState: "awaiting_approval", execState: "not_started", execActive: false }), "WAITING APPROVAL");
  assert.equal(derivePhase({ planState: "approved", execState: "not_started", execActive: false }), "READY");
  assert.equal(derivePhase({ planState: "rejected", execState: "not_started", execActive: false }), "REJECTED");
  assert.equal(derivePhase({ planState: "approved", execState: "running", execActive: true }), "IMPLEMENTING");
  assert.equal(derivePhase({ planState: "approved", execState: "done", execActive: false }), "COMPLETE");
  assert.equal(derivePhase({ planState: "approved", execState: "failed", execActive: false }), "ERROR");
  assert.equal(derivePhase({ planState: "draft", execState: "not_started", execActive: false }), "PLANNING");
});

test("buildTaskRows tolerates a missing/empty timeline", () => {
  assert.deepEqual(buildTaskRows(undefined), []);
  assert.deepEqual(buildTaskRows([]), []);
});

test("clampSelection keeps the index inside [0, length-1], or 0 when empty", () => {
  assert.equal(clampSelection(5, 3), 2);
  assert.equal(clampSelection(-2, 3), 0);
  assert.equal(clampSelection(1, 0), 0);
  assert.equal(clampSelection(1, 3), 1);
});

test("formatRowText marks the selected row and includes plan/exec/taskId columns", () => {
  const rows = buildTaskRows(TIMELINE);
  const selected = formatRowText(rows[0], { selected: true });
  const unselected = formatRowText(rows[0], { selected: false });
  assert.match(selected, /^>/);
  assert.match(unselected, /^ /);
  assert.match(selected, /awaiting_approval/);
  assert.match(selected, /not_started/);
  assert.match(selected, /task-a/);
});

test("isActionAvailable reflects plan/execution state transitions", () => {
  const rows = buildTaskRows(TIMELINE);
  assert.equal(isActionAvailable("approve", rows[0]), true);
  assert.equal(isActionAvailable("reject", rows[0]), true);
  assert.equal(isActionAvailable("execute", rows[0]), false);
  assert.equal(isActionAvailable("execute", { planState: "approved", execState: "not_started" }), true);
  assert.equal(isActionAvailable("cancel", rows[1]), true);
  assert.equal(isActionAvailable("approve", null), false);
});

test("keyHintsLine only advertises actions that are actually available", () => {
  const rows = buildTaskRows(TIMELINE);
  const awaiting = keyHintsLine(rows[0]);
  assert.match(awaiting, /a approve/);
  assert.match(awaiting, /j reject/);
  assert.doesNotMatch(awaiting, /x execute/);

  const running = keyHintsLine(rows[1]);
  assert.match(running, /c cancel/);
  assert.doesNotMatch(running, /a approve/);

  const none = keyHintsLine(null);
  assert.doesNotMatch(none, /approve|reject|execute|cancel/);
  assert.match(none, /q quit/);
});
