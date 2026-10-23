import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/cli.js";
import { runPlansCli } from "../src/global/architect/architect-cli.js";

function fakeService(preview) {
  const calls = [];
  return {
    calls,
    planExecution: async (a) => { calls.push(["planExecution", a]); return preview; },
    executePlan: async (a) => { calls.push(["executePlan", a]); return { started: true }; },
    cancelExecution: async (a) => { calls.push(["cancelExecution", a]); return { cancelled: true }; },
    readTaskResult: async (a) => { calls.push(["readTaskResult", a]); return { result: "ok" }; }
  };
}

const base = { cwd: "/p", taskId: "T1", json: true };
const deps = (service) => ({ service, resolveRoot: async () => "/p" });

async function quiet(fn) {
  const orig = console.log;
  console.log = () => {};
  try { return await fn(); } finally { console.log = orig; }
}

test("parser accepts plans execute with --role and --confirm", () => {
  const { command, options } = parseArgs(["plans", "execute", "T1", "--role", "dev", "--confirm", "--json"]);
  assert.equal(command, "plans");
  assert.equal(options.plansAction, "execute");
  assert.equal(options.taskId, "T1");
  assert.equal(options.role, "dev");
  assert.equal(options.confirm, true);
  for (const a of ["cancel", "result"]) assert.equal(parseArgs(["plans", a, "T1"]).options.plansAction, a);
});

test("execute without --confirm only previews", async () => {
  const service = fakeService({ confirmationTarget: "x", why: "w" });
  const out = await quiet(() => runPlansCli({ ...base, plansAction: "execute", role: "dev" }, deps(service)));
  assert.deepEqual(out, { confirmationTarget: "x", why: "w" });
  assert.deepEqual(service.calls.map((c) => c[0]), ["planExecution"]);
  assert.deepEqual(service.calls[0][1], { cwd: "/p", taskId: "T1", role: "dev" });
});

test("execute --confirm passes the fresh confirmationTarget", async () => {
  const service = fakeService({ confirmationTarget: "tgt", why: "w" });
  const out = await quiet(() => runPlansCli({ ...base, plansAction: "execute", role: "dev", confirm: true }, deps(service)));
  assert.deepEqual(out, { started: true });
  assert.deepEqual(service.calls[1], ["executePlan", { cwd: "/p", taskId: "T1", confirmationTarget: "tgt" }]);
});

test("execute --confirm without confirmationTarget throws", async () => {
  const service = fakeService({ why: "role not allowed" });
  await assert.rejects(
    runPlansCli({ ...base, plansAction: "execute", role: "dev", confirm: true }, deps(service)),
    { message: 'Cannot execute "T1": role not allowed' }
  );
  assert.deepEqual(service.calls.map((c) => c[0]), ["planExecution"]);
});

test("execute without --role throws before calling the service", async () => {
  const service = fakeService({});
  await assert.rejects(
    runPlansCli({ ...base, plansAction: "execute" }, deps(service)),
    /^Error: Missing --role\. PROJECT TEAM is the sole authority for execution/
  );
  assert.equal(service.calls.length, 0);
});

test("cancel and result call their service methods", async () => {
  const service = fakeService({});
  assert.deepEqual(await quiet(() => runPlansCli({ ...base, plansAction: "cancel" }, deps(service))), { cancelled: true });
  assert.deepEqual(await quiet(() => runPlansCli({ ...base, plansAction: "result" }, deps(service))), { result: "ok" });
  assert.deepEqual(service.calls, [
    ["cancelExecution", { cwd: "/p", taskId: "T1" }],
    ["readTaskResult", { cwd: "/p", taskId: "T1" }]
  ]);
});

test("list, show, approve, reject keep their behavior", async () => {
  const rec = { taskId: "T1", state: "awaiting_approval", artifacts: { plan: "p.md" } };
  const d = {
    resolveRoot: async () => "/p",
    listRecords: async () => [rec],
    readRecord: async () => ({ status: rec, planMarkdown: "# plan" }),
    transition: async (_r, _id, state) => ({ status: { ...rec, state } }),
    service: fakeService({})
  };
  assert.deepEqual((await quiet(() => runPlansCli({ ...base, plansAction: "list" }, d))).plans, [rec]);
  assert.equal((await quiet(() => runPlansCli({ ...base, plansAction: "show" }, d))).taskId, "T1");
  assert.equal((await quiet(() => runPlansCli({ ...base, plansAction: "approve" }, d))).state, "approved");
  assert.equal((await quiet(() => runPlansCli({ ...base, plansAction: "reject" }, d))).state, "rejected");
  assert.equal(d.service.calls.length, 0);
});
