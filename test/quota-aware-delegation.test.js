import test from "node:test";
import assert from "node:assert/strict";
import { resolveProjectRoute } from "../src/global/conversation/project-router.js";
import { buildProviderCapacity } from "../src/global/intelligence/subscription-pressure-source.js";
import { resolveModelCost } from "../src/global/intelligence/model-cost.js";
const rows = [
  { adapterId: "codex", modelId: "assigned", accessMode: "automatic", intelligenceIndex: 100, priceInputPerMTok: 2, priceOutputPerMTok: 2 },
  { adapterId: "claude", modelId: "qualified", accessMode: "automatic", intelligenceIndex: 95, priceInputPerMTok: 1, priceOutputPerMTok: 1 },
  { adapterId: "claude", modelId: "too-weak", accessMode: "automatic", intelligenceIndex: 30, priceInputPerMTok: .01, priceOutputPerMTok: .01 }
];
const strategy = { status: "active", projectTeam: [{ role: "Explorer", model: rows[0], assignmentSource: "quality" }] };
const args = { role: "Explorer", strategy, eligibility: { codex: { ok: true }, claude: { ok: true } }, models: rows, roleCapabilities: { Explorer: { required: ["reasoning"] } } };
test("unknown reset keeps 45 percent on assigned provider and preserves raw cost weighting", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  for (const resetsAt of [null, "invalid", (now - 1000) / 1000]) {
    const providerCapacity = buildProviderCapacity({ codex: 45 }, { codex: {
      primary: { name: "5h", remainingPercent: 45, resetsAt }
    } }, now);
    assert.deepEqual(resolveProjectRoute({ ...args, providerCapacity }), resolveProjectRoute(args));
    assert.equal(resolveModelCost(rows[0], providerCapacity).weight, 4 / .45);
  }
});
test("unknown reset still reroutes exhaustion; timed 30 percent with 90 percent time left reroutes", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  for (const [remainingPercent, resetsAt] of [[0, null], [30, (now + 4.5 * 3600000) / 1000]]) {
    const providerCapacity = buildProviderCapacity({ codex: remainingPercent }, { codex: {
      primary: { name: "5h", remainingPercent, resetsAt }
    } }, now);
    const route = resolveProjectRoute({ ...args, providerCapacity });
    assert.equal(route.model.modelId, "qualified");
    assert.equal(route.rerouted, true);
  }
});
test("exhaustion re-routes to cheapest qualified alternative and explains from/to/quota/reset", () => {
  const route = resolveProjectRoute({ ...args, providerCapacity: { codex: { quotaRemainingPercent: 0, quotaPaceFactor: 0, quotaWindows: [{ remainingPercent: 0, resetsAtIso: "2026-10-16T00:00:00Z" }] } } });
  assert.equal(route.model.modelId, "qualified");
  assert.equal(route.rerouted, true);
  assert.equal(route.reroutedFrom.modelId, "assigned");
  assert.match(route.why, /assigned.*qualified/);
  assert.match(route.why, /0%.*2026-10-16/);
});
test("no qualified alternative preserves original route with notice", () => {
  const route = resolveProjectRoute({ ...args, models: [rows[0], rows[2]], providerCapacity: { codex: { quotaRemainingPercent: 0 } } });
  assert.equal(route.model.modelId, "assigned");
  assert.match(route.why, /no qualified alternative/i);
});
test("healthy quota leaves route unchanged; context is informational only", () => {
  const base = resolveProjectRoute(args);
  assert.deepEqual(resolveProjectRoute({ ...args, providerCapacity: { codex: { quotaRemainingPercent: 50, quotaPaceFactor: 1 } } }), base);
  const route = resolveProjectRoute({ ...args, contextRemainingPercent: 73 });
  assert.equal(route.model.modelId, "assigned");
  assert.match(route.why, /Context 73% left/);
});
test("pace below half sustainable burn re-routes, threshold itself remains healthy", () => {
  assert.equal(resolveProjectRoute({ ...args, providerCapacity: { codex: { quotaRemainingPercent: 40, quotaPaceFactor: .49 } } }).model.modelId, "qualified");
  assert.equal(resolveProjectRoute({ ...args, providerCapacity: { codex: { quotaRemainingPercent: 40, quotaPaceFactor: .5 } } }).model.modelId, "assigned");
});
test("quota routing never bypasses entitlement or chooses another pressured provider", () => {
  const providerCapacity = { codex: { quotaRemainingPercent: 0 }, claude: { quotaRemainingPercent: 10, quotaPaceFactor: .1 } };
  assert.equal(resolveProjectRoute({ ...args, providerCapacity }).model.modelId, "assigned");
  assert.equal(resolveProjectRoute({ ...args, providerCapacity, modelEntitlement: { codex: { assigned: { status: "denied" } } } }).decision, "WAIT_FOR_PROJECT_TEAM");
  assert.equal(resolveProjectRoute({ ...args, providerCapacity: { codex: { quotaRemainingPercent: 0 } }, modelEntitlement: { claude: { qualified: { status: "denied" } } } }).model.modelId, "assigned");
});
test("quota notice does not bypass an unavailable assigned provider's existing gate", () => {
  const route = resolveProjectRoute({ ...args, models: [rows[0]], eligibility: { codex: { ok: false, reason: "CLI unavailable" } }, providerCapacity: { codex: { quotaRemainingPercent: 0 } } });
  assert.equal(route.decision, "WAIT_FOR_PROJECT_TEAM");
  assert.match(route.why, /CLI unavailable.*no qualified alternative/);
});

test("service forwards live quota into preview explanation shown by conversation", async () => {
  const { createConversationService } = await import("../src/global/conversation/service.js");
  const service = createConversationService({
    homeDir: "/unused", resolveRoot: async () => "/repo",
    readPlan: async () => ({ status: {} }), readProjectStrategy: async () => ({ ...strategy, roleCapabilities: args.roleCapabilities })
  });
  service.snapshot = async () => ({ modelIntelligence: { eligibility: args.eligibility, scoredAll: rows,
    providerCapacity: { codex: { quotaRemainingPercent: 0 } } } });
  const preview = await service.planExecution({ cwd: "/repo", taskId: "task", role: "Explorer" });
  assert.equal(preview.model, "qualified");
  assert.equal(preview.rerouted, true);
  assert.match(preview.why, /assigned.*qualified.*0%/);
});
