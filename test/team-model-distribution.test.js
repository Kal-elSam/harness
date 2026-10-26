import test from "node:test";
import assert from "node:assert/strict";
import { createConversationService } from "../src/global/team/service.js";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const row = (adapterId, modelId, intelligenceIndex) => ({ adapterId, modelId, accessMode: "automatic", intelligenceIndex, priceInputPerMTok: 1, priceOutputPerMTok: 1 });
const catalog = [
  row("codex", "gpt-a", 100), row("claude", "son-a", 95), row("claude", "son-b", 93),
  row("opencode-go", "go-a", 90), row("claude", "too-weak", 30)
];
const eligibility = { codex: { ok: true }, claude: { ok: true }, "opencode-go": { ok: true } };
const providerCapacity = { codex: { quotaRemainingPercent: 50 }, claude: { quotaRemainingPercent: 30 }, "opencode-go": { quotaRemainingPercent: 20 } };
const strategy = {
  status: "active", profileFingerprint: "fp", roleCapabilities: { Explorer: { required: ["reasoning"] } },
  projectTeam: [{ role: "Explorer", model: catalog[0], assignmentSource: "quality" }]
};

function setup({ models = catalog, runs = [], extra = {} } = {}) {
  const service = createConversationService({
    homeDir: "/unused", resolveRoot: async () => "/repo", now: () => NOW,
    readProjectStrategy: async () => strategy, listRunRecords: async () => runs, ...extra
  });
  service.snapshot = async () => ({ modelIntelligence: { eligibility, scoredAll: models, providerCapacity } });
  return service;
}
const record = (agentId, model) => ({ agentId, model, role: "Explorer", cwd: "/repo", state: "completed", startedAt: new Date(NOW - 1000).toISOString() });

test("service spreads tasks over every qualified model, never the one below the floor", async () => {
  const runs = [];
  const service = setup({ runs });
  const counts = {};
  for (let i = 0; i < 100; i++) {
    const route = await service.routeProjectExecution("Explorer", "/repo");
    const k = `${route.provider}/${route.model.modelId}`;
    counts[k] = (counts[k] ?? 0) + 1;
    runs.push(record(route.provider, route.model.modelId));
  }
  assert.deepEqual(Object.keys(counts).sort(), ["claude/son-a", "claude/son-b", "codex/gpt-a", "opencode-go/go-a"]);
  assert.ok(Math.abs(counts["codex/gpt-a"] / 100 - 1 / 3) < 0.05);
});

test("a model added to the catalog joins the pool on the next routing call", async () => {
  let models = catalog.slice(0, 2);
  const service = createConversationService({
    homeDir: "/unused", resolveRoot: async () => "/repo", now: () => NOW,
    readProjectStrategy: async () => strategy, listRunRecords: async () => []
  });
  service.snapshot = async () => ({ modelIntelligence: { eligibility, scoredAll: models, providerCapacity } });
  assert.equal((await service.routeProjectExecution("Explorer", "/repo")).distribution.poolSize, 2);
  models = [...catalog.slice(0, 2), row("opencode-go", "go-new", 91)];
  const route = await service.routeProjectExecution("Explorer", "/repo");
  assert.equal(route.distribution.poolSize, 3);
  assert.ok("opencode-go/go-new" in route.distribution.targets);
});

test("run history from other roles or projects is not counted", async () => {
  const runs = [{ ...record("codex", "gpt-a"), role: "Builder" }, { ...record("codex", "gpt-a"), cwd: "/other" }];
  const route = await setup({ runs }).routeProjectExecution("Explorer", "/repo");
  assert.equal(route.distribution.actuals["codex/gpt-a"], 0);
});

test("run history failure keeps today's route with a stated reason", async () => {
  const service = setup({ extra: { listRunRecords: async () => { throw new Error("disk gone"); } } });
  const route = await service.routeProjectExecution("Explorer", "/repo");
  assert.equal(route.decision, "ROUTED");
  assert.equal(route.model.modelId, "gpt-a");
  assert.equal(route.distribution.applied, false);
  assert.match(route.distribution.reason, /disk gone/);
});

test("a single qualified model keeps today's route", async () => {
  const route = await setup({ models: [catalog[0], catalog[4]] }).routeProjectExecution("Explorer", "/repo");
  assert.equal(route.model.modelId, "gpt-a");
  assert.equal(route.distribution, undefined);
});
