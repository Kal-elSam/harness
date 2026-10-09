import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkRequest } from "../src/global/kernel/contracts.js";
import { createKernelService } from "../src/global/kernel/service.js";
import { PROJECT_ROUTE_DECISION } from "../src/global/conversation/project-router.js";

function request(role = "Builder") {
  return createWorkRequest({
    role,
    task: "Do the work",
    projectRoot: "/repo",
    sessionId: "11111111-1111-4111-8111-111111111111"
  });
}

function routed(role) {
  return {
    decision: PROJECT_ROUTE_DECISION.ROUTED,
    role,
    provider: "claude",
    model: "opus-x",
    assignmentSource: "project-strategy",
    why: "strategy assigned it"
  };
}

const completed = (workerId = "w1") => ({ ok: true, workerId, status: "completed", summary: "Done" });

test("delegate passes the full RouteDecision to the adapter and returns the validated WorkResult", async () => {
  const calls = [];
  const kernel = createKernelService({
    routeProject: ({ role }) => routed(role),
    spawnAdapter: async (decision, req) => { calls.push({ decision, req }); return completed(); }
  });
  const req = request();
  const result = await kernel.delegate(req);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].decision, routed("Builder"));
  assert.equal(calls[0].decision.model, "opus-x");
  assert.equal(calls[0].decision.assignmentSource, "project-strategy");
  assert.equal(calls[0].decision.why, "strategy assigned it");
  assert.equal(calls[0].req, req);
  assert.deepEqual(result, { ok: true, workerId: "w1", status: "completed", summary: "Done", error: null });
});

test("delegate throws when the adapter resolves an invalid WorkResult", async () => {
  for (const bad of [{ status: 0 }, null, undefined, { ok: true, workerId: "w1", summary: "" }]) {
    const kernel = createKernelService({
      routeProject: ({ role }) => routed(role),
      spawnAdapter: async () => bad
    });
    await assert.rejects(() => kernel.delegate(request()), Error);
  }
});

test("delegate propagates adapter rejections unchanged", async () => {
  const failure = new Error("adapter exploded");
  const kernel = createKernelService({
    routeProject: ({ role }) => routed(role),
    spawnAdapter: async () => { throw failure; }
  });
  await assert.rejects(() => kernel.delegate(request()), (error) => error === failure);
});

test("MANUAL_HANDOFF and WAIT_FOR_PROJECT_TEAM return the decision without calling the adapter", async () => {
  for (const kind of [PROJECT_ROUTE_DECISION.MANUAL_HANDOFF, PROJECT_ROUTE_DECISION.WAIT_FOR_PROJECT_TEAM]) {
    let called = 0;
    const decision = { decision: kind, role: "Builder", provider: null, why: "not routed" };
    const kernel = createKernelService({
      routeProject: () => decision,
      spawnAdapter: async () => { called += 1; return completed(); }
    });
    assert.equal(await kernel.delegate(request()), decision);
    assert.equal(called, 0);
  }
});

test("a routed decision without a spawnAdapter returns the decision", async () => {
  const decision = routed("Builder");
  const kernel = createKernelService({ routeProject: () => decision });
  assert.equal(await kernel.delegate(request()), decision);
});

test("two independent delegations stay independent when one fails", async () => {
  const kernel = createKernelService({
    routeProject: ({ role }) => routed(role),
    spawnAdapter: async (decision) => {
      if (decision.role === "Tester") throw new Error("tester failed");
      return completed("builder-1");
    }
  });
  const [builder, tester] = await Promise.allSettled([
    kernel.delegate(request("Builder")),
    kernel.delegate(request("Tester"))
  ]);
  assert.equal(builder.status, "fulfilled");
  assert.equal(builder.value.workerId, "builder-1");
  assert.equal(tester.status, "rejected");
  assert.match(tester.reason.message, /tester failed/);
});

test("a cancelled result reported by an adapter is returned as cancelled", async () => {
  // The kernel only validates what the adapter reports; this does not prove
  // that any process was actually terminated.
  const kernel = createKernelService({
    routeProject: ({ role }) => routed(role),
    spawnAdapter: async () => ({ ok: false, workerId: "w9", status: "cancelled" })
  });
  const result = await kernel.delegate(request());
  assert.deepEqual(result, { ok: false, workerId: "w9", status: "cancelled", summary: null, error: null });
});
