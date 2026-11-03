import test from "node:test";
import assert from "node:assert/strict";
import { resolveProjectRoute } from "../src/global/team/project-router.js";
import { buildProviderCapacity } from "../src/global/intelligence/subscription-pressure-source.js";
import { resolveModelCost } from "../src/global/intelligence/model-cost.js";
const rows = [
  { adapterId: "codex", modelId: "assigned", accessMode: "automatic", intelligenceIndex: 54.4, gpqa: 1, hle: 1, priceInputPerMTok: 2, priceOutputPerMTok: 2 },
  { adapterId: "claude", modelId: "qualified", accessMode: "automatic", intelligenceIndex: 54.3, gpqa: .95, hle: .95, priceInputPerMTok: 1, priceOutputPerMTok: 1 },
  { adapterId: "claude", modelId: "too-weak", accessMode: "automatic", intelligenceIndex: 30, gpqa: .30, hle: .30, priceInputPerMTok: .01, priceOutputPerMTok: .01 }
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
test("no qualified alternative waits when the assigned provider is known exhausted", () => {
  const route = resolveProjectRoute({ ...args, models: [rows[0], rows[2]], providerCapacity: { codex: { quotaRemainingPercent: 0 } } });
  // S14: known exhaustion cannot launch the original model when no qualified alternative remains.
  assert.equal(route.decision, "WAIT_FOR_PROJECT_TEAM");
  assert.equal(route.model, null);
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
test("quota routing never bypasses entitlement and tries nonexhausted pressured alternatives before WAIT", () => {
  const providerCapacity = { codex: { quotaRemainingPercent: 0 }, claude: { quotaRemainingPercent: 10, quotaPaceFactor: .1 } };
  // S14: pressure is not exhaustion; a usable alternative is preferable to WAIT.
  assert.equal(resolveProjectRoute({ ...args, providerCapacity }).model.modelId, "qualified");
  assert.equal(resolveProjectRoute({ ...args, providerCapacity, modelEntitlement: { codex: { assigned: { status: "denied" } } } }).model.modelId, "qualified");
  assert.equal(resolveProjectRoute({ ...args, providerCapacity: { codex: { quotaRemainingPercent: 0 } }, modelEntitlement: { claude: { qualified: { status: "denied" } } } }).decision, "WAIT_FOR_PROJECT_TEAM");
});
test("quota notice does not bypass an unavailable assigned provider's existing gate", () => {
  const route = resolveProjectRoute({ ...args, models: [rows[0]], eligibility: { codex: { ok: false, reason: "CLI unavailable" } }, providerCapacity: { codex: { quotaRemainingPercent: 0 } } });
  assert.equal(route.decision, "WAIT_FOR_PROJECT_TEAM");
  assert.match(route.why, /CLI unavailable.*no qualified alternative/);
});

test("service forwards live quota into preview explanation shown by conversation", async () => {
  const { createConversationService } = await import("../src/global/team/service.js");
  const service = createConversationService({
    homeDir: "/unused", resolveRoot: async () => "/repo",
    readPlan: async () => ({ status: {} }), readProjectStrategy: async () => ({ ...strategy, roleCapabilities: args.roleCapabilities })
  });
  service.snapshot = async () => ({ modelIntelligence: { eligibility: args.eligibility, scoredAll: rows,
    providerCapacity: { codex: { quotaRemainingPercent: 0 } } } });
  const preview = await service.planExecution({ cwd: "/repo", taskId: "task", role: "Explorer" });
  // Only capability-qualified alternatives may execute; price cannot rescue the .30 peer.
  assert.equal(preview.model, "qualified");
  assert.notEqual(preview.model, "too-weak");
  assert.equal(preview.rerouted, true);
  assert.match(preview.why, /assigned.*qualified.*0%/);
});

test("reroute prefers qualified known healthy quota over cheaper unknown quota", () => {
  const extra = { ...rows[1], adapterId: "opencode-go", modelId: "unknown-cheap", priceInputPerMTok: .01, priceOutputPerMTok: .01 };
  const options = { ...args, models: [...rows, extra], eligibility: { ...args.eligibility, "opencode-go": { ok: true } }, providerCapacity: { codex: { quotaRemainingPercent: 0 }, claude: { quotaRemainingPercent: 90 } } };
  assert.equal(resolveProjectRoute(options).model.modelId, "qualified");
  assert.equal(resolveProjectRoute({ ...options, models: [rows[0], rows[2], extra] }).model.modelId, "unknown-cheap");
});
test("unknown-quota assignment keeps its provider and model", () => {
  const route = resolveProjectRoute({ ...args, providerCapacity: { claude: { quotaRemainingPercent: 90 } } });
  // S1: unknown quota never drops a provider, so preserve the assigned provider and model.
  assert.equal(route.model.modelId, "assigned");
  assert.notEqual(route.rerouted, true);
});
test("known-exhausted assignment still yields to a qualified known healthy provider", () => {
  const route = resolveProjectRoute({ ...args, providerCapacity: { codex: { quotaRemainingPercent: 0 }, claude: { quotaRemainingPercent: 90 } } });
  assert.equal(route.model.adapterId, "claude");
  assert.equal(route.model.modelId, "qualified");
  assert.equal(route.rerouted, true);
});
test("quota fallback checks the full qualified band beyond a narrowed pool", () => {
  const route = resolveProjectRoute({ ...args, pool: [rows[0]], ledger: [], providerCapacity: { codex: { quotaRemainingPercent: 0 } } });
  // S1/S14: a narrowed cohort cannot hide an otherwise qualified same-band alternative.
  assert.equal(route.model.modelId, "qualified");
  assert.equal(route.rerouted, true);
});
test("entitlement substitution ranks eligible substitutes by quota, not catalog order", () => {
  // S14 blocker: denied assignment must pick the higher-quota Codex copy over catalog-first Claude.
  const high = { ...rows[1], adapterId: "codex", modelId: "high" };
  const route = resolveProjectRoute({ ...args, models: [rows[1], high, rows[0], rows[2]],
    providerCapacity: { claude: { quotaRemainingPercent: 30 }, codex: { quotaRemainingPercent: 90 } },
    modelEntitlement: { codex: { assigned: { status: "denied" } } } });
  assert.equal(route.model.modelId, "high");
});
const REFRESH_HINT = "Run kairo team verify-access --refresh to re-probe.";
test("S7 unverified entitlement block tells the user how to re-probe, in routed and blocked decisions", () => {
  // Observable: route.why ends with the recovery sentence for stale and never-verified evidence.
  for (const reason of ["stale", undefined]) {
    const modelEntitlement = { codex: { assigned: { status: "unverified", ...(reason ? { reason } : {}) } } };
    const routed = resolveProjectRoute({ ...args, modelEntitlement });
    assert.equal(routed.assignmentSource, "availability-fallback");
    assert.ok(routed.why.endsWith(REFRESH_HINT), routed.why);
    const blocked = resolveProjectRoute({ ...args, models: [rows[0]], modelEntitlement });
    assert.ok(blocked.why.endsWith(REFRESH_HINT), blocked.why);
  }
});
test("S7 denied and temporary-limit entitlement blocks keep their existing message", () => {
  // Observable: no re-probe sentence unless the block is a re-probeable unverified state.
  for (const entry of [{ status: "denied", reason: "no access" }, { status: "unverified", limit: "temporary", reason: "rate limited" }]) {
    const modelEntitlement = { codex: { assigned: entry } };
    for (const models of [rows, [rows[0]]]) {
      const route = resolveProjectRoute({ ...args, models, modelEntitlement });
      assert.ok(!route.why.includes("verify-access"), route.why);
    }
  }
});
