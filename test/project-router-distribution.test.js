import test from "node:test";
import assert from "node:assert/strict";
import { resolveProjectRoute } from "../src/global/team/project-router.js";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const model = (adapterId, modelId, extra = {}) => ({
  candidateKey: `${adapterId}::${modelId}`, adapterId, modelId, displayName: modelId, accessMode: "automatic", utility: 1, ...extra
});
const approved = model("codex", "gpt-a", { utility: 3 });
const pool = [approved, model("claude", "son-a", { utility: 2 }), model("claude", "son-b"), model("opencode-go", "go-a")];
const eligibility = { codex: { ok: true }, claude: { ok: true }, "opencode-go": { ok: true } };
const capacity = { codex: { quotaRemainingPercent: 50 }, claude: { quotaRemainingPercent: 30 }, "opencode-go": { quotaRemainingPercent: 20 } };
const strategy = { status: "active", profileFingerprint: "fp", projectTeam: [{ role: "Builder", model: approved, assignmentSource: "recommended", fallback: pool[1] }] };
const base = { role: "Builder", strategy, eligibility, providerCapacity: capacity };

function simulate(runs, extra = {}) {
  const ledger = [];
  const counts = {};
  for (let i = 0; i < runs; i++) {
    const route = resolveProjectRoute({ ...base, pool, ledger, now: NOW, ...extra });
    const k = `${route.provider}/${route.model.modelId}`;
    counts[k] = (counts[k] ?? 0) + 1;
    ledger.push({ adapterId: route.provider, modelId: route.model.modelId, status: "completed", at: NOW - 1000 });
  }
  return counts;
}

test("every qualified model of every provider receives work, shares approach headroom", () => {
  const counts = simulate(200);
  assert.deepEqual(Object.keys(counts).sort(), ["claude/son-a", "claude/son-b", "codex/gpt-a", "opencode-go/go-a"]);
  assert.ok(Math.abs(counts["codex/gpt-a"] / 200 - 0.5) < 0.03);
  assert.ok(Math.abs(counts["claude/son-a"] / 200 - 0.15) < 0.03);
  assert.ok(Math.abs(counts["opencode-go/go-a"] / 200 - 0.2) < 0.03);
});

test("distribution explanation is added without removing existing fields", () => {
  const route = resolveProjectRoute({ ...base, pool, ledger: [], now: NOW });
  const today = resolveProjectRoute(base);
  for (const key of Object.keys(today)) assert.ok(key in route, key);
  assert.equal(route.distribution.applied, true);
  assert.equal(route.distribution.poolSize, 4);
  assert.ok(route.distribution.targets["codex/gpt-a"] > 0.49);
  assert.ok("actuals" in route.distribution && "deficits" in route.distribution);
  assert.match(route.distribution.reason, /picked/);
  assert.equal(route.decision, "ROUTED");
});

test("non-entitled, ineligible or manual pool members are never chosen despite a large deficit", () => {
  const modelEntitlement = { claude: { "son-a": { status: "denied" }, "son-b": { status: "unverified" } } };
  const manual = model("cursor", "manual-m", { accessMode: "manual" });
  const counts = simulate(60, {
    pool: [...pool, manual, model("gone", "g-1")], modelEntitlement,
    eligibility: { ...eligibility, cursor: { ok: true } }
  });
  assert.deepEqual(Object.keys(counts).sort(), ["codex/gpt-a", "opencode-go/go-a"]);
});

test("pool of one and absent pool/ledger keep today's result byte for byte", () => {
  const today = resolveProjectRoute(base);
  assert.deepEqual(resolveProjectRoute({ ...base, pool: [approved], ledger: [], now: NOW }), today);
  assert.deepEqual(resolveProjectRoute({ ...base, pool: undefined, ledger: undefined }), today);
  assert.equal(JSON.stringify(resolveProjectRoute({ ...base, pool: [], ledger: [] })), JSON.stringify(today));
});

test("a distribution error keeps today's result and states the reason", () => {
  const route = resolveProjectRoute({ ...base, pool: [approved, null, { adapterId: "x" }], ledger: "not-a-list" });
  assert.equal(route.decision, "ROUTED");
  assert.equal(route.model.modelId, "gpt-a");
  assert.equal(route.distribution.applied, false);
  assert.match(route.distribution.reason, /ledger/i);
});
