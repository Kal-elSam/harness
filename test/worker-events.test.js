import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkRequest } from "../src/global/kernel/contracts.js";
import { createKernelService, normalizeWorkerLine, selectableModels } from "../src/global/kernel/service.js";
import { workerCardFromEvent } from "../src/global/host/extension/index.js";
import { ENTITLEMENT } from "../src/global/observability/claude-model-entitlement.js";
import { PROJECT_ROUTE_DECISION } from "../src/global/conversation/project-router.js";

function request(role) {
  return createWorkRequest({
    role,
    task: "Do the work",
    projectRoot: "/repo",
    sessionId: "11111111-1111-4111-8111-111111111111"
  });
}

test("ordinary conversation does not spawn Claude Codex Cursor or OpenCode", async () => {
  const spawned = [];
  const kernel = createKernelService({
    spawnAdapter: async (provider) => { spawned.push(provider); return { status: 0 }; }
  });
  await kernel.conversationTurn({ text: "hello" });
  assert.deepEqual(spawned, []);
});

test("two routed WorkRequests may run in parallel", async () => {
  const started = [];
  const kernel = createKernelService({
    routeProject: ({ role }) => ({ decision: PROJECT_ROUTE_DECISION.ROUTED, role, provider: role }),
    spawnAdapter: async (provider) => {
      started.push(provider);
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { status: 0, provider };
    }
  });
  const results = await Promise.all([
    kernel.delegate(request("Builder")),
    kernel.delegate(request("Tester"))
  ]);
  assert.equal(started.sort().join(","), "Builder,Tester");
  assert.equal(results.length, 2);
});

test("denied and unverified models stay out of selectors", () => {
  const models = selectableModels([
    { modelId: "ok", entitlement: ENTITLEMENT.ALLOWED },
    { modelId: "no", entitlement: ENTITLEMENT.DENIED },
    { modelId: "maybe", entitlement: ENTITLEMENT.UNVERIFIED },
    { modelId: "na", entitlement: ENTITLEMENT.NOT_APPLICABLE }
  ]);
  assert.deepEqual(models.map((model) => model.modelId), ["ok", "na"]);
});

test("worker cards come from WorkEvents and are not Gentle Agents", () => {
  const event = normalizeWorkerLine(JSON.stringify({ type: "tool_execution_start" }), "claude-1");
  const card = workerCardFromEvent(event);
  assert.equal(card.kind, "kairo-worker");
  assert.equal(card.workerId, "claude-1");
  assert.notEqual(card.kind, "gentle-agent");
});
