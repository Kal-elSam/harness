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
