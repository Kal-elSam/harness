import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createWorkRequest } from "../src/global/kernel/contracts.js";
import { createRunSpawnAdapter } from "../src/global/kernel/run-spawn-adapter.js";
import { createKernelService } from "../src/global/kernel/service.js";
import { PROJECT_ROUTE_DECISION } from "../src/global/conversation/project-router.js";
import { startRun } from "../src/global/runtime/run-manager.js";
import { readCancelSignal } from "../src/global/runtime/run-cancel-signal.js";
import { createRunRecord, readRunEvents, readRunState, writeRunState } from "../src/global/runtime/run-store.js";
import { createRunMetadata, RUN_STATES } from "../src/global/runtime/run-types.js";
import { DelegatedWriteAdmissionError } from "../src/global/runtime/delegated-write-admission.js";

const HOME = "/tmp/fake-home";
const request = () => createWorkRequest({
  role: "Builder",
  task: "Do the work",
  projectRoot: "/repo",
  sessionId: "11111111-1111-4111-8111-111111111111"
});
const decision = (overrides = {}) => ({
  decision: PROJECT_ROUTE_DECISION.ROUTED,
  role: "Builder",
  provider: "claude",
  model: { adapterId: "claude", modelId: "opus-x", displayName: "Opus X" },
  why: "strategy assigned it",
  ...overrides
});
const transcript = (text) => ({ type: "run.transcript", data: { text } });

function fakes({ metadata = { state: "completed", error: null }, events = [transcript("Done")], runId = "run-1" } = {}) {
  const calls = { start: [], read: [] };
  return {
    calls,
    startRunImpl: async (args) => {
      calls.start.push(args);
      return { runId, completion: Promise.resolve(metadata) };
    },
    readRunEventsImpl: async (...args) => {
      calls.read.push(args);
      return events;
    }
  };
}
const make = (f, extra = {}) => createRunSpawnAdapter({
  homeDir: HOME,
  cliVersion: "9.9.9",
  startRunImpl: f.startRunImpl,
  readRunEventsImpl: f.readRunEventsImpl,
  ...extra
});

test("constructor rejects bad homeDir, cliVersion and impls", () => {
  const f = fakes();
  for (const bad of [{ homeDir: "" }, { homeDir: 3 }, { cliVersion: " " }, { cliVersion: null }, { startRunImpl: "x" }, { readRunEventsImpl: null }]) {
    assert.throws(() => createRunSpawnAdapter({
      homeDir: HOME, cliVersion: "1", startRunImpl: f.startRunImpl, readRunEventsImpl: f.readRunEventsImpl, ...bad
    }), Error);
  }
  assert.throws(() => createRunSpawnAdapter(), Error);
});

test("startRun receives exactly the strict-floor argument object", async () => {
  const f = fakes();
  const req = request();
  await make(f)(decision(), req);
  assert.equal(f.calls.start.length, 1);
  assert.deepEqual(f.calls.start[0], {
    homeDir: HOME,
    agentId: "claude",
    task: "Do the work",
    cwd: "/repo",
    model: "opus-x",
    permissions: [],
    allowUnsafePermissions: false,
    requireVerifiedWriteContainment: true,
    captureTranscript: true,
    cliVersion: "9.9.9",
    wait: true,
    strategy: "direct"
  });
});

test("success with a real summary returns a completed WorkResult keyed by runId", async () => {
  const f = fakes({ runId: "run-ok" });
  const result = await make(f)(decision(), request());
  assert.deepEqual(result, { ok: true, workerId: "run-ok", status: "completed", summary: "Done", error: null });
  assert.deepEqual(f.calls.read, [[HOME, "run-ok"]]);
});

test("completed run without a summary is failed and keeps the runId", async () => {
  const f = fakes({ runId: "run-empty", events: [] });
  const result = await make(f)(decision(), request());
  assert.deepEqual(result, { ok: false, workerId: "run-empty", status: "failed", summary: null, error: "no summary produced" });
});

test("failed run surfaces the supervisor error verbatim", async () => {
  const f = fakes({ runId: "run-bad", metadata: { state: "failed", error: "Process exited with code 3" }, events: [] });
  const result = await make(f)(decision(), request());
  assert.deepEqual(result, { ok: false, workerId: "run-bad", status: "failed", summary: null, error: "Process exited with code 3" });
});

test("cancelled run reports cancelled", async () => {
  const f = fakes({ runId: "run-c", metadata: { state: "cancelled", error: null }, events: [] });
  const result = await make(f)(decision(), request());
  assert.deepEqual(result, { ok: false, workerId: "run-c", status: "cancelled", summary: null, error: null });
});

test("completion rejection returns a failed WorkResult with the runId, never throws", async () => {
  const f = fakes();
  f.startRunImpl = async () => ({ runId: "run-boom", completion: Promise.reject(new Error("supervisor crashed")) });
  const result = await make(f)(decision(), request());
  assert.equal(result.status, "failed");
  assert.equal(result.workerId, "run-boom");
  assert.match(result.error, /supervisor crashed/);
  assert.equal(f.calls.read.length, 0);
});

test("events read rejection returns a failed WorkResult with the runId", async () => {
  const f = fakes({ runId: "run-ev" });
  f.readRunEventsImpl = async () => { throw new Error("disk gone"); };
  const result = await make(f)(decision(), request());
  assert.equal(result.status, "failed");
  assert.equal(result.workerId, "run-ev");
  assert.match(result.error, /disk gone/);
});

test("startRun rejection propagates unchanged, creates no result and never reads events", async () => {
  const f = fakes();
  const denial = new DelegatedWriteAdmissionError("denied", { code: "delegated_write_admission_denied" });
  f.startRunImpl = async () => { throw denial; };
  await assert.rejects(() => make(f)(decision(), request()), (error) => error === denial);
  assert.equal(f.calls.read.length, 0);
});

test("a startRun result without a runId is an executor contract violation", async () => {
  for (const bad of [{}, { runId: "" }, { runId: "  " }, null, undefined, { runId: 4 }]) {
    const f = fakes();
    f.startRunImpl = async () => bad;
    await assert.rejects(() => make(f)(decision(), request()), /runId/);
    assert.equal(f.calls.read.length, 0);
  }
});

test("argument errors throw a coded error before startRun is called", async () => {
  const cases = [
    ["invalid request", decision(), { role: "Builder" }, "run_spawn_invalid_request"],
    ["null request", decision(), null, "run_spawn_invalid_request"],
    ["missing provider", decision({ provider: undefined }), request(), "run_spawn_invalid_provider"],
    ["empty provider", decision({ provider: " " }), request(), "run_spawn_invalid_provider"],
    ["string model", decision({ model: "opus-x" }), request(), "run_spawn_invalid_model"],
    ["empty modelId", decision({ model: { adapterId: "claude", modelId: "" } }), request(), "run_spawn_invalid_model"],
    ["adapter mismatch", decision({ model: { adapterId: "codex", modelId: "m" } }), request(), "run_spawn_adapter_mismatch"],
    ["null decision", null, request(), "run_spawn_invalid_provider"]
  ];
  for (const [label, dec, req, code] of cases) {
    const f = fakes();
    await assert.rejects(() => make(f)(dec, req), (error) => error instanceof Error && error.code === code, label);
    assert.equal(f.calls.start.length, 0, label);
    assert.equal(f.calls.read.length, 0, label);
  }
});

test("two concurrent invocations stay independent", async () => {
  const calls = [];
  const startRunImpl = async (args) => {
    const runId = `run-${calls.length + 1}`;
    calls.push(args.task);
    return runId === "run-1"
      ? { runId, completion: new Promise((resolve) => setTimeout(() => resolve({ state: "failed", error: "Process exited with code 1" }), 10)) }
      : { runId, completion: Promise.resolve({ state: "completed", error: null }) };
  };
  const readRunEventsImpl = async (_home, runId) => [transcript(`summary of ${runId}`)];
  const adapter = createRunSpawnAdapter({ homeDir: HOME, cliVersion: "1", startRunImpl, readRunEventsImpl });
  const [a, b] = await Promise.all([adapter(decision(), request()), adapter(decision(), request())]);
  assert.equal(a.workerId, "run-1");
  assert.equal(a.status, "failed");
  assert.equal(a.summary, "summary of run-1");
  assert.equal(b.workerId, "run-2");
  assert.equal(b.status, "completed");
  assert.equal(b.summary, "summary of run-2");
});

test("wired through createKernelService.delegate: ROUTED reaches the adapter and returns the WorkResult", async () => {
  const f = fakes({ runId: "run-k" });
  const routedDecision = decision();
  const kernel = createKernelService({ routeProject: () => routedDecision, spawnAdapter: make(f) });
  const result = await kernel.delegate(request());
  assert.deepEqual(result, { ok: true, workerId: "run-k", status: "completed", summary: "Done", error: null });
  assert.equal(f.calls.start.length, 1);
  assert.equal(f.calls.start[0].agentId, "claude");
});

test("MANUAL_HANDOFF and WAIT_FOR_PROJECT_TEAM never invoke the adapter", async () => {
  for (const kind of [PROJECT_ROUTE_DECISION.MANUAL_HANDOFF, PROJECT_ROUTE_DECISION.WAIT_FOR_PROJECT_TEAM]) {
    const f = fakes();
    const routed = { decision: kind, role: "Builder", provider: null, why: "not routed" };
    const kernel = createKernelService({ routeProject: () => routed, spawnAdapter: make(f) });
    assert.equal(await kernel.delegate(request()), routed);
    assert.equal(f.calls.start.length, 0);
  }
});

test("real startRun: strict-floor admission rejects every adapter before any run record or preflight", async () => {
  // startRun checks adapter.availability() BEFORE admission and that would probe real CLIs, so the
  // wrapper injects a stub adapter (available, launchable). preflight throws if reached: it runs
  // AFTER admission in prepareRun, so it must never be called. Admission itself is the real one.
  for (const adapterId of ["codex", "claude", "cursor", "opencode", "pi"]) {
    const homeDir = await mkdtemp(join(tmpdir(), "run-spawn-adapter-"));
    let preflights = 0;
    const stubAdapter = {
      id: adapterId,
      label: adapterId,
      availability: () => ({ available: true, launchable: true }),
      preflight: async () => { preflights += 1; throw new Error("preflight must not run"); }
    };
    const startRunImpl = (args) => startRun({ ...args, resolveAdapterImpl: () => stubAdapter });
    const adapter = createRunSpawnAdapter({
      homeDir, cliVersion: "1", startRunImpl, readRunEventsImpl: async () => { throw new Error("must not read"); }
    });
    try {
      const dec = decision({ provider: adapterId, model: { adapterId, modelId: "m1" } });
      await assert.rejects(
        () => adapter(dec, { ...request(), projectRoot: homeDir }),
        (error) => error instanceof DelegatedWriteAdmissionError,
        adapterId
      );
      assert.equal(preflights, 0, adapterId);
      assert.deepEqual(await readdir(homeDir, { recursive: true }), [], `${adapterId}: no run directory or record`);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  }
});

// --- B-3: explicit, caller-driven cancellation through the onStart stop handle ---

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function stopFakes() {
  const stops = [];
  return { stops, stopRunImpl: async (...args) => { stops.push(args); return { state: "cancelled" }; } };
}

test("no onStart: behavior unchanged and stopRunImpl is never needed", async () => {
  const f = fakes({ runId: "run-plain" });
  const s = stopFakes();
  const result = await make(f, { stopRunImpl: s.stopRunImpl })(decision(), request());
  assert.deepEqual(result, { ok: true, workerId: "run-plain", status: "completed", summary: "Done", error: null });
  assert.equal(f.calls.start.length, 1);
  assert.equal(s.stops.length, 0);
});

test("onStart receives { runId, stop, decision, request } while completion is still pending", async () => {
  const completion = deferred();
  const f = fakes({ runId: "run-live" });
  f.startRunImpl = async () => ({ runId: "run-live", completion: completion.promise });
  const seen = [];
  const dec = decision();
  const req = request();
  const pending = make(f, { onStart: (handle) => seen.push(handle) })(dec, req);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(seen.length, 1, "onStart fired before completion resolved");
  assert.deepEqual(Object.keys(seen[0]).sort(), ["decision", "request", "runId", "stop"]);
  assert.equal(seen[0].runId, "run-live");
  assert.equal(typeof seen[0].stop, "function");
  assert.equal(seen[0].decision, dec);
  assert.equal(seen[0].request, req);
  completion.resolve({ state: "completed", error: null });
  assert.equal((await pending).workerId, "run-live");
  assert.equal(seen.length, 1, "onStart called exactly once");
});

test("stopRunImpl is never called when the consumer does not call stop", async () => {
  const scenarios = [
    ["success", fakes({ runId: "r1" })],
    ["failed run", fakes({ runId: "r2", metadata: { state: "failed", error: "boom" }, events: [] })],
    ["cancelled by someone else", fakes({ runId: "r3", metadata: { state: "cancelled", error: null }, events: [] })],
    ["completion rejection", Object.assign(fakes(), { startRunImpl: async () => ({ runId: "r4", completion: Promise.reject(new Error("crash")) }) })],
    ["events rejection", Object.assign(fakes({ runId: "r5" }), { readRunEventsImpl: async () => { throw new Error("disk"); } })]
  ];
  for (const [label, f] of scenarios) {
    for (const withOnStart of [false, true]) {
      const s = stopFakes();
      const extra = { stopRunImpl: s.stopRunImpl, ...(withOnStart ? { onStart: () => {} } : {}) };
      await make(f, extra)(decision(), request());
      assert.equal(s.stops.length, 0, `${label} (onStart=${withOnStart})`);
    }
  }
});

test("stop calls stopRunImpl(homeDir, runId, options) and propagates its rejection", async () => {
  const completion = deferred();
  const f = fakes();
  f.startRunImpl = async () => ({ runId: "run-s", completion: completion.promise });
  const s = stopFakes();
  let handle;
  const pending = make(f, { stopRunImpl: s.stopRunImpl, onStart: (h) => { handle = h; } })(decision(), request());
  await new Promise((resolve) => setImmediate(resolve));
  const opts = { signal: "SIGINT" };
  assert.deepEqual(await handle.stop(opts), { state: "cancelled" });
  await handle.stop();
  assert.equal(s.stops.length, 2);
  assert.equal(s.stops[0][0], HOME);
  assert.equal(s.stops[0][1], "run-s");
  assert.equal(s.stops[0][2], opts);
  assert.equal(s.stops[1][2], undefined);

  const failure = new Error("not found");
  const bad = createRunSpawnAdapter({
    homeDir: HOME, cliVersion: "1", startRunImpl: f.startRunImpl, readRunEventsImpl: f.readRunEventsImpl,
    stopRunImpl: async () => { throw failure; }, onStart: (h) => { handle = h; }
  });
  const pending2 = bad(decision(), request());
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(() => handle.stop(), (error) => error === failure);
  completion.resolve({ state: "completed", error: null });
  await Promise.all([pending, pending2]);
});

test("cancelling one of two concurrent invocations leaves the other untouched and never retries", async () => {
  const completions = new Map();
  const handles = new Map();
  const startCalls = [];
  const startRunImpl = async (args) => {
    const runId = `run-${startCalls.length + 1}`;
    startCalls.push(args.task);
    const d = deferred();
    completions.set(runId, d);
    return { runId, completion: d.promise };
  };
  const stops = [];
  const stopRunImpl = async (home, runId, options) => {
    stops.push([home, runId, options]);
    completions.get(runId).resolve({ state: "cancelled", error: "Run cancelled by user." });
    return { state: "cancelled" };
  };
  const adapter = createRunSpawnAdapter({
    homeDir: HOME, cliVersion: "1", startRunImpl, stopRunImpl,
    readRunEventsImpl: async (_home, runId) => [transcript(`summary of ${runId}`)],
    onStart: (h) => handles.set(h.runId, h)
  });
  const a = adapter(decision(), request());
  await new Promise((resolve) => setImmediate(resolve));
  const b = adapter(decision(), request());
  await new Promise((resolve) => setImmediate(resolve));
  await handles.get("run-1").stop();
  completions.get("run-2").resolve({ state: "completed", error: null });
  const [resA, resB] = await Promise.all([a, b]);
  assert.equal(resA.status, "cancelled");
  assert.equal(resA.workerId, "run-1");
  assert.equal(resB.status, "completed");
  assert.equal(resB.workerId, "run-2");
  assert.equal(stops.length, 1);
  assert.equal(stops[0][1], "run-1");
  assert.equal(startCalls.length, 2, "one startRun per invocation, no retry after cancel");
});

test("stop after the WorkResult resolved is harmless and does not mutate the returned result", async () => {
  const f = fakes({ runId: "run-late" });
  const s = stopFakes();
  let handle;
  const result = await make(f, { stopRunImpl: s.stopRunImpl, onStart: (h) => { handle = h; } })(decision(), request());
  const snapshot = structuredClone(result);
  await handle.stop();
  await handle.stop();
  assert.deepEqual(result, snapshot);
  assert.equal(f.calls.start.length, 1);
});

async function completedRunHome(runId) {
  const homeDir = await mkdtemp(join(tmpdir(), "run-spawn-stop-"));
  const metadata = createRunMetadata({
    runId, agentId: "codex", provider: "Codex", task: "t", cwd: homeDir, cliVersion: "1"
  });
  metadata.state = RUN_STATES.COMPLETED;
  await createRunRecord(homeDir, metadata);
  await writeRunState(homeDir, metadata);
  return homeDir;
}

test("real stopRun on an already COMPLETED run returns the state unchanged and writes no cancel marker or event", async () => {
  const homeDir = await completedRunHome("run_done");
  try {
    const completion = deferred();
    let handle;
    const adapter = createRunSpawnAdapter({
      homeDir, cliVersion: "1",
      startRunImpl: async () => ({ runId: "run_done", completion: completion.promise }),
      readRunEventsImpl: async () => [transcript("Done")],
      onStart: (h) => { handle = h; }
    });
    const pending = adapter(decision(), request());
    await new Promise((resolve) => setImmediate(resolve));
    const before = await readRunState(homeDir, "run_done");
    const eventsBefore = await readRunEvents(homeDir, "run_done");
    const returned = await handle.stop();
    assert.deepEqual(returned, before);
    assert.equal((await readRunState(homeDir, "run_done")).state, RUN_STATES.COMPLETED);
    assert.equal(await readCancelSignal(homeDir, "run_done"), null);
    const eventsAfter = await readRunEvents(homeDir, "run_done");
    assert.deepEqual(eventsAfter, eventsBefore);
    assert.equal(eventsAfter.some((e) => e.type === "run.cancelled"), false);
    completion.resolve({ state: "completed", error: null });
    await pending;
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("real stopRun on an unknown runId rejects with 'not found' through stop", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "run-spawn-stop-"));
  try {
    const completion = deferred();
    let handle;
    const adapter = createRunSpawnAdapter({
      homeDir, cliVersion: "1",
      startRunImpl: async () => ({ runId: "run_ghost", completion: completion.promise }),
      readRunEventsImpl: async () => [],
      onStart: (h) => { handle = h; }
    });
    const pending = adapter(decision(), request());
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(() => handle.stop(), /not found/);
    completion.resolve({ state: "completed", error: null });
    await pending;
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("onStart failures are isolated: sync throw and rejected promise never affect the run", async () => {
  const failures = [
    ["sync throw", () => { throw new Error("hook exploded"); }],
    ["rejected promise", () => Promise.reject(new Error("async hook exploded"))]
  ];
  for (const [label, onStart] of failures) {
    const f = fakes({ runId: "run-iso" });
    const s = stopFakes();
    const result = await make(f, { stopRunImpl: s.stopRunImpl, onStart })(decision(), request());
    assert.deepEqual(result, { ok: true, workerId: "run-iso", status: "completed", summary: "Done", error: null }, label);
    assert.equal(s.stops.length, 0, label);
    assert.equal(f.calls.start.length, 1, label);
  }
});

test("constructor rejects non-function onStart and stopRunImpl", () => {
  const f = fakes();
  for (const bad of [{ onStart: "x" }, { onStart: 3 }, { stopRunImpl: "x" }, { stopRunImpl: null }]) {
    assert.throws(() => make(f, bad), Error, JSON.stringify(bad));
  }
  assert.doesNotThrow(() => make(f, { onStart: null }));
});
