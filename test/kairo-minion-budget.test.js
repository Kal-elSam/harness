import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  BUDGET_EXCEEDED, MAX_TASK_ATTEMPTS, createBudgetAttemptState, createConcurrencyGate,
  createProcessRegistry, evaluateContextBudget, registerBudgetGuard, runMinionWithRetries,
  spawnMinionProcess
} from "../global-template/components/orchestrator/extensions/pi/kairo-minion.js";

const brief = {
  taskId: "task_1", parentTaskId: "task_root", objective: "o",
  constraints: [], admittedPaths: [], exitCriteria: []
};

function handoffLine(payload) {
  return JSON.stringify({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: JSON.stringify(payload) }] }
  });
}

function stubChild({ exitCode = 0, signal = null, lines = [], hang = false } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = (sig) => {
    child.killed = true;
    child.emit("close", null, sig);
  };
  queueMicrotask(() => {
    if (hang) return;
    for (const line of lines) child.stdout.emit("data", `${line}\n`);
    child.emit("close", exitCode, signal);
  });
  return child;
}

test("budget thresholds: 69.9 continue, 70/89.9 compact, 90 stop", () => {
  assert.equal(evaluateContextBudget({ percent: 69.9 }).action, "continue");
  assert.equal(evaluateContextBudget({ percent: 70 }).action, "compact");
  assert.equal(evaluateContextBudget({ percent: 89.9 }).action, "compact");
  assert.equal(evaluateContextBudget({ percent: 90 }).action, "stop");
  assert.equal(evaluateContextBudget({ tokens: 699, contextWindow: 1000 }).action, "continue");
  assert.equal(evaluateContextBudget({ tokens: 900, contextWindow: 1000 }).action, "stop");
});

test("budget guard: single compact; ≥90 aborts with budget_exceeded", async () => {
  const state = createBudgetAttemptState();
  const handlers = {};
  registerBudgetGuard({ on(ev, fn) { handlers[ev] = fn; } }, { state, statusPath: null });
  const compactCalls = [];
  await handlers.turn_end({}, {
    getContextUsage: () => ({ percent: 75 }),
    compact: (opts) => { compactCalls.push(1); opts?.onComplete?.(); }
  });
  await handlers.turn_end({}, {
    getContextUsage: () => ({ percent: 75 }),
    compact: (opts) => { compactCalls.push(1); opts?.onComplete?.(); }
  });
  assert.equal(compactCalls.length, 1);
  assert.equal(state.compactObserved, true);

  await handlers.turn_end({}, {
    getContextUsage: () => ({ percent: 90 }),
    abort() { this.aborted = true; }
  });
  assert.equal(state.stopReason, BUDGET_EXCEEDED);
});

test("retries: second attempt succeeds; budget_exceeded and cancel never retry", async () => {
  let calls = 0;
  const ok = handoffLine({
    taskId: "task_1", summary: "ok", decisions: [], files: [], risks: [], evidence: []
  });
  const out = await runMinionWithRetries({
    brief,
    gate: createConcurrencyGate(),
    registry: createProcessRegistry({ abortGraceMs: 0 }),
    spawnImpl: () => {
      calls += 1;
      return stubChild(calls === 1 ? { exitCode: 2 } : { lines: [ok] });
    }
  });
  assert.equal(out.summary, "ok");
  assert.equal(calls, 2);
  assert.ok(calls <= MAX_TASK_ATTEMPTS);

  let budgetCalls = 0;
  await assert.rejects(
    () => runMinionWithRetries({
      brief,
      gate: createConcurrencyGate(),
      registry: createProcessRegistry({ abortGraceMs: 0 }),
      readStatus: async () => ({ code: BUDGET_EXCEEDED, compact: true }),
      spawnImpl: () => {
        budgetCalls += 1;
        return stubChild({ exitCode: 0, lines: [] });
      }
    }),
    (e) => e.code === BUDGET_EXCEEDED && e.compact === true
  );
  assert.equal(budgetCalls, 1);

  let cancelCalls = 0;
  const gate = createConcurrencyGate();
  const registry = createProcessRegistry({ abortGraceMs: 5 });
  const pending = runMinionWithRetries({
    brief,
    gate,
    registry,
    abortGraceMs: 5,
    spawnImpl: () => {
      cancelCalls += 1;
      return stubChild({ hang: true });
    }
  });
  const expectCancel = assert.rejects(pending, (e) => e.code === "aborted");
  await new Promise((r) => setTimeout(r, 5));
  gate.cancel();
  await registry.cancelAll();
  await expectCancel;
  assert.equal(cancelCalls, 1);
});

test("observed compact from status overrides model compact:false", async () => {
  const handoff = await spawnMinionProcess({
    brief,
    gate: createConcurrencyGate(),
    registry: createProcessRegistry({ abortGraceMs: 0 }),
    readStatus: async () => ({ code: null, compact: true }),
    spawnImpl: () => stubChild({
      lines: [handoffLine({
        taskId: "task_1", summary: "done", decisions: [], files: [], risks: [], evidence: [],
        compact: false
      })]
    })
  });
  assert.equal(handoff.compact, true);
});

test("cascade cancel: active SIGTERM→SIGKILL; queued never starts", async () => {
  const kills = [];
  const gate = createConcurrencyGate(1);
  const registry = createProcessRegistry({ abortGraceMs: 15 });
  const make = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = (sig) => {
      kills.push(sig);
      child.killed = true; // Node marks killed after SIGTERM is sent
      if (sig === "SIGKILL") child.emit("close", null, sig);
    };
    return child;
  };

  const active = spawnMinionProcess({
    brief, gate, registry, abortGraceMs: 15, spawnImpl: make
  });
  const expectActive = assert.rejects(active, (e) => e.code === "aborted");
  for (let i = 0; i < 40 && registry.size === 0; i += 1) {
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(registry.size, 1);

  let queuedStarted = false;
  const queued = spawnMinionProcess({
    brief: { ...brief, taskId: "task_2" }, gate, registry, abortGraceMs: 15,
    spawnImpl: () => {
      queuedStarted = true;
      return make();
    }
  });
  const expectQueued = assert.rejects(queued, (e) => e.code === "aborted");

  gate.cancel();
  await registry.cancelAll();
  await expectActive;
  await expectQueued;
  assert.equal(queuedStarted, false);
  assert.ok(kills.includes("SIGTERM"));
  assert.ok(kills.includes("SIGKILL"));
});
