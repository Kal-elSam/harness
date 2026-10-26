import test from "node:test";
import assert from "node:assert/strict";
import { selectDistributedModel } from "../src/global/intelligence/model-distribution.js";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const DAY = 86_400_000;
const m = (adapterId, modelId, utility = 1) => ({ adapterId, modelId, utility });
const key = c => `${c.adapterId}/${c.modelId}`;

// Simulates sequential runs, feeding each pick back into the ledger.
function simulate(candidates, capacity, runs, seed = []) {
  const ledger = [...seed];
  const counts = new Map();
  for (let i = 0; i < runs; i++) {
    const { pick } = selectDistributedModel({ role: "builder", candidates, capacity, ledger, now: NOW });
    ledger.push({ adapterId: pick.adapterId, modelId: pick.modelId, at: NOW - 1000, status: "completed" });
    counts.set(key(pick), (counts.get(key(pick)) ?? 0) + 1);
  }
  return counts;
}

test("provider targets are equal whatever the remaining quota (S1)", () => {
  const r = selectDistributedModel({
    role: "builder", now: NOW, ledger: [],
    candidates: [m("claude", "sonnet"), m("codex", "gpt")],
    capacity: { claude: { quotaRemainingPercent: 75 }, codex: { quotaRemainingPercent: 25, quotaPaceFactor: 1 } }
  });
  assert.ok(Math.abs(r.targets["claude/sonnet"] - 0.5) < 1e-9);
  assert.ok(Math.abs(r.targets["codex/gpt"] - 0.5) < 1e-9);
});

test("pace factor never weights the share", () => {
  const r = selectDistributedModel({
    role: "builder", now: NOW, ledger: [],
    candidates: [m("a", "x"), m("b", "y")],
    capacity: { a: { quotaRemainingPercent: 50, quotaPaceFactor: 2 }, b: { quotaRemainingPercent: 50, quotaPaceFactor: 1 } }
  });
  assert.ok(Math.abs(r.targets["a/x"] - 0.5) < 1e-9);
});

test("provider share splits equally among its models, so aliases gain nothing", () => {
  const r = selectDistributedModel({
    role: "builder", now: NOW, ledger: [],
    candidates: [m("claude", "opus"), m("claude", "sonnet"), m("claude", "haiku"), m("codex", "gpt")],
    capacity: { claude: { quotaRemainingPercent: 50 }, codex: { quotaRemainingPercent: 50 } }
  });
  assert.ok(Math.abs(r.targets["claude/opus"] - 1 / 6) < 1e-9);
  assert.ok(Math.abs(r.targets["claude/haiku"] - 1 / 6) < 1e-9);
  assert.ok(Math.abs(r.targets["codex/gpt"] - 0.5) < 1e-9);
});

test("deficit-based pick rotates and converges near target share", () => {
  const candidates = [m("claude", "opus"), m("claude", "sonnet"), m("codex", "gpt")];
  const capacity = { claude: { quotaRemainingPercent: 60 }, codex: { quotaRemainingPercent: 40 } };
  const runs = 200;
  const counts = simulate(candidates, capacity, runs);
  assert.ok(Math.abs(counts.get("claude/opus") / runs - 0.25) < 0.05);
  assert.ok(Math.abs(counts.get("claude/sonnet") / runs - 0.25) < 0.05);
  assert.ok(Math.abs(counts.get("codex/gpt") / runs - 0.5) < 0.05);
});

test("failed and cancelled runs are ignored, in-flight runs count", () => {
  const candidates = [m("a", "x"), m("b", "y")];
  const capacity = { a: { quotaRemainingPercent: 50 }, b: { quotaRemainingPercent: 50 } };
  const noisy = selectDistributedModel({
    role: "builder", now: NOW, candidates, capacity,
    ledger: [
      { adapterId: "a", modelId: "x", at: NOW - 1000, status: "failed" },
      { adapterId: "a", modelId: "x", at: NOW - 1000, status: "cancelled" }
    ]
  });
  assert.equal(noisy.actuals["a/x"], 0);
  assert.equal(noisy.pick.modelId, "x");
  const inflight = selectDistributedModel({
    role: "builder", now: NOW, candidates, capacity,
    ledger: [{ adapterId: "a", modelId: "x", at: NOW - 1000, status: "running" }]
  });
  assert.equal(inflight.actuals["a/x"], 1);
  assert.equal(inflight.pick.modelId, "y");
});

test("runs outside the rolling window are ignored", () => {
  const r = selectDistributedModel({
    role: "builder", now: NOW,
    candidates: [m("a", "x"), m("b", "y")],
    capacity: { a: { quotaRemainingPercent: 50 }, b: { quotaRemainingPercent: 50 } },
    ledger: [{ adapterId: "a", modelId: "x", at: NOW - 8 * DAY, status: "completed" }]
  });
  assert.equal(r.actuals["a/x"], 0);
});

test("zero-headroom adapter gets target 0 and is not picked while others exist", () => {
  const r = selectDistributedModel({
    role: "builder", now: NOW, ledger: [],
    candidates: [m("a", "x", 9), m("b", "y", 1)],
    capacity: { a: { quotaRemainingPercent: 0 }, b: { quotaRemainingPercent: 40 } }
  });
  assert.equal(r.targets["a/x"], 0);
  assert.equal(r.pick.modelId, "y");
});

test("zero-headroom sole candidate is picked and flagged", () => {
  const r = selectDistributedModel({
    role: "builder", now: NOW, ledger: [],
    candidates: [m("a", "x")], capacity: { a: { quotaRemainingPercent: 0 } }
  });
  assert.equal(r.pick.modelId, "x");
  assert.match(r.explanation, /exhausted/);
});

test("unknown capacity gets the median known share and is explicit", () => {
  const r = selectDistributedModel({
    role: "builder", now: NOW, ledger: [],
    candidates: [m("a", "x"), m("b", "y"), m("c", "z")],
    capacity: { a: { quotaRemainingPercent: 80 }, b: { quotaRemainingPercent: 20 } }
  });
  // known raw weights 0.8 and 0.2 -> shares .8/.2; median .5; normalised over 1.5.
  assert.ok(Math.abs(r.targets["c/z"] - 0.5 / 1.5) < 1e-9);
  assert.match(r.explanation, /c[^.]*capacity: "unknown"|capacity: "unknown"[^.]*c/);
  assert.ok(Math.abs(Object.values(r.targets).reduce((s, v) => s + v, 0) - 1) < 1e-9);
});

test("single-provider user splits among that provider's models", () => {
  const candidates = [m("claude", "opus"), m("claude", "sonnet")];
  const capacity = { claude: { quotaRemainingPercent: 70 } };
  const counts = simulate(candidates, capacity, 100);
  assert.equal(counts.get("claude/opus"), 50);
  assert.equal(counts.get("claude/sonnet"), 50);
});

test("ties break by higher utility, then stable order", () => {
  const capacity = { a: { quotaRemainingPercent: 50 }, b: { quotaRemainingPercent: 50 } };
  const byUtility = selectDistributedModel({
    role: "builder", now: NOW, ledger: [], capacity, candidates: [m("a", "x", 1), m("b", "y", 5)]
  });
  assert.equal(byUtility.pick.modelId, "y");
  const byOrder = selectDistributedModel({
    role: "builder", now: NOW, ledger: [], capacity, candidates: [m("a", "x", 3), m("b", "y", 3)]
  });
  assert.equal(byOrder.pick.modelId, "x");
});

test("empty candidates yields null pick", () => {
  const r = selectDistributedModel({ role: "builder", now: NOW, candidates: [], capacity: {}, ledger: [] });
  assert.equal(r.pick, null);
});

const proven = (adapterId, modelId) => ({ adapterId, modelId, utility: 1, ownedEvidence: { verdict: "pass" } });

test("T35: a provider with unknown capacity and no own evidence is not picked for its deficit", () => {
  const r = selectDistributedModel({
    role: "builder", now: NOW, ledger: [{ adapterId: "a", modelId: "x", at: NOW - 1000, status: "completed" }],
    candidates: [m("a", "x"), m("go", "mimo")],
    capacity: { a: { quotaRemainingPercent: 50 } }
  });
  assert.equal(r.pick.modelId, "x");
});

test("T35: an unverified candidate is only a last resort, and the reason says so", () => {
  const r = selectDistributedModel({
    role: "builder", now: NOW, ledger: [],
    candidates: [m("go", "mimo")], capacity: {}
  });
  assert.equal(r.pick.modelId, "mimo");
  assert.match(r.explanation, /last resort/);
});

test("T35: unknown capacity with a passed own probe or measured success stays eligible; known capacity deficit pick still works", () => {
  const withProbe = selectDistributedModel({
    role: "builder", now: NOW, ledger: [{ adapterId: "a", modelId: "x", at: NOW - 1000, status: "completed" }],
    candidates: [m("a", "x"), proven("go", "mimo")], capacity: { a: { quotaRemainingPercent: 50 } }
  });
  assert.equal(withProbe.pick.modelId, "mimo");
  const measured = selectDistributedModel({
    role: "builder", now: NOW, ledger: [{ adapterId: "a", modelId: "x", at: NOW - 1000, status: "completed" }],
    candidates: [m("a", "x"), { ...m("go", "mimo"), measuredQuality: { successRate: 0.9 } }], capacity: { a: { quotaRemainingPercent: 50 } }
  });
  assert.equal(measured.pick.modelId, "mimo");
  const known = selectDistributedModel({
    role: "builder", now: NOW, ledger: [{ adapterId: "a", modelId: "x", at: NOW - 1000, status: "completed" }],
    candidates: [m("a", "x"), m("b", "y")], capacity: { a: { quotaRemainingPercent: 50 }, b: { quotaRemainingPercent: 50 } }
  });
  assert.equal(known.pick.modelId, "y");
  assert.doesNotMatch(known.explanation, /last resort/);
});

test("providers share a role equally whatever their headroom; an exhausted provider gets none", () => {
  const c = (adapterId, modelId) => ({ adapterId, modelId });
  const two = selectDistributedModel({ role: "Tester", candidates: [c("claude", "haiku"), c("codex", "luna")], now: 0,
    capacity: { claude: { quotaRemainingPercent: 90, quotaPaceFactor: 1.5 }, codex: { quotaRemainingPercent: 20, quotaPaceFactor: .6 } } });
  assert.deepEqual(two.targets, { "claude/haiku": .5, "codex/luna": .5 });
  const three = selectDistributedModel({ role: "Tester", candidates: [c("claude", "haiku"), c("codex", "luna"), c("opencode-go", "go")], now: 0,
    capacity: { claude: { quotaRemainingPercent: 90 }, codex: { quotaRemainingPercent: 20 } } });
  for (const share of Object.values(three.targets)) assert.ok(Math.abs(share - 1 / 3) < 1e-9);
  const exhausted = selectDistributedModel({ role: "Tester", candidates: [c("claude", "haiku"), c("codex", "luna")], now: 0,
    capacity: { claude: { quotaRemainingPercent: 0 }, codex: { quotaRemainingPercent: 20 } } });
  assert.deepEqual(exhausted.targets, { "claude/haiku": 0, "codex/luna": 1 });
});
