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

test("every qualified model of every provider receives work, providers share equally", () => {
  const counts = simulate(200);
  assert.deepEqual(Object.keys(counts).sort(), ["claude/son-a", "claude/son-b", "codex/gpt-a", "opencode-go/go-a"]);
  assert.ok(Math.abs(counts["codex/gpt-a"] / 200 - 1 / 3) < 0.03);
  assert.ok(Math.abs(counts["claude/son-a"] / 200 - 1 / 6) < 0.03);
  assert.ok(Math.abs(counts["opencode-go/go-a"] / 200 - 1 / 3) < 0.03);
});

test("distribution explanation is added without removing existing fields", () => {
  const route = resolveProjectRoute({ ...base, pool, ledger: [], now: NOW });
  const today = resolveProjectRoute(base);
  for (const key of Object.keys(today)) assert.ok(key in route, key);
  assert.equal(route.distribution.applied, true);
  assert.equal(route.distribution.poolSize, 4);
  assert.ok(Math.abs(route.distribution.targets["codex/gpt-a"] - 1 / 3) < 1e-9);
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

test("distribution excludes a pressured alternative despite its larger deficit", () => {
  const providerCapacity = {
    codex: { quotaRemainingPercent: 80, quotaPaceFactor: 1 },
    claude: { quotaRemainingPercent: 90, quotaPaceFactor: 0.4 }
  };
  const route = resolveProjectRoute({
    ...base, providerCapacity, pool: pool.slice(0, 2), now: NOW,
    ledger: [{ adapterId: "codex", modelId: approved.modelId, status: "completed", at: NOW - 1000 }]
  });
  assert.equal(route.decision, "ROUTED");
  assert.equal(route.provider, "codex");
  assert.equal(route.model.modelId, approved.modelId);
  assert.equal(route.distribution.applied, true);
  assert.deepEqual(route.distribution.excludedForPressure, ["claude/son-a"]);
  assert.match(route.why, /excluded.*claude\/son-a.*pressure/i);
});

test("a pressured approved provider distributes equally across all safe providers", () => {
  const candidates = [approved, pool[1], pool[3]].map(m => ({
    ...m, intelligenceIndex: 100, priceInputPerMTok: 1, priceOutputPerMTok: 1
  }));
  for (const openCodeRemaining of [80, 40]) {
    const providerCapacity = {
      codex: { quotaRemainingPercent: 20, quotaPaceFactor: 0.4 },
      claude: { quotaRemainingPercent: 80, quotaPaceFactor: 1 },
      "opencode-go": { quotaRemainingPercent: openCodeRemaining, quotaPaceFactor: 1 }
    };
    const ledger = [];
    const counts = { claude: 0, "opencode-go": 0 };
    let lastRoute;
    for (let i = 0; i < 60; i++) {
      const route = resolveProjectRoute({
        ...base, role: "Explorer",
        strategy: { ...strategy, projectTeam: [{ ...strategy.projectTeam[0], role: "Explorer", model: candidates[0] }] },
        roleCapabilities: { Explorer: { required: ["reasoning"] } },
        pool: candidates, models: candidates, providerCapacity, ledger, now: NOW
      });
      assert.equal(route.decision, "ROUTED");
      assert.notEqual(route.provider, "codex");
      counts[route.provider]++;
      ledger.push({ adapterId: route.provider, modelId: route.model.modelId, status: "completed", at: NOW - 1000 });
      lastRoute = route;
    }
    assert.ok(Math.abs(counts.claude / 60 - 0.5) < 0.03, JSON.stringify(counts));
    assert.ok(Math.abs(counts["opencode-go"] / 60 - 0.5) < 0.03, JSON.stringify(counts));
    assert.equal(lastRoute.distribution.applied, true);
    assert.deepEqual(lastRoute.distribution.excludedForPressure, ["codex/gpt-a"]);
    assert.match(lastRoute.why, /excluded.*codex\/gpt-a.*pressure/i);
  }
});

test("no pressure-safe candidate preserves the pre-change quota reroute result", () => {
  const providerCapacity = {
    codex: { quotaRemainingPercent: 20, quotaPaceFactor: 0.4 },
    claude: { quotaRemainingPercent: 90, quotaPaceFactor: 0.4 },
    "opencode-go": { quotaRemainingPercent: 0, quotaPaceFactor: 1 }
  };
  const options = { ...base, providerCapacity, models: pool };
  const before = resolveProjectRoute(options);
  const { distribution, ...route } = resolveProjectRoute({ ...options, pool, ledger: [], now: NOW });
  assert.deepEqual(route, before);
  assert.equal(route.rerouted, false);
  assert.equal(distribution.applied, false);
  assert.deepEqual(distribution.excludedForPressure, pool.map(m => `${m.adapterId}/${m.modelId}`));
  assert.match(distribution.reason, /no pressure-safe candidate/i);
});

const admissionCapacity = (resetDelay = 900000) => Object.fromEntries(['codex', 'claude'].map(provider => [provider, {
  quotaRemainingPercent: provider === 'codex' ? 18 : 80,
  quotaWindows: [{ kind: '5h', remainingPercent: provider === 'codex' ? 18 : 80, resetsAt: NOW + resetDelay },
    { kind: 'weekly', remainingPercent: 90, resetsAt: NOW + 86400000 }]
}]));
const admissionSamples = [{ provider: 'codex', window: '5h', timestamp: NOW - 1000, remainingPercent: 18, resetsAt: NOW + 900000 }];

test('admission rejects 18% Codex for a 30% Builder and chooses admitted close-quality Claude', () => {
  const candidates = [approved, model('claude', 'son-a', { utility: 2.99 })];
  const route = resolveProjectRoute({ ...base, pool: candidates, ledger: [], samples: admissionSamples, providerCapacity: admissionCapacity(), now: NOW });
  assert.equal(route.provider, 'claude');
  assert.equal(route.admission.candidates[0].admitted, false);
  assert.equal(route.admission.decision, 'admitted');
  assert.match(route.why, /5h.*18.*30/);
});
test('admission waits for imminent Codex reset rather than a large quality drop', () => {
  const route = resolveProjectRoute({ ...base, pool: pool.slice(0, 2), ledger: [], samples: admissionSamples, providerCapacity: admissionCapacity(), now: NOW });
  assert.equal(route.decision, 'WAIT_FOR_PROJECT_TEAM');
  assert.equal(route.provider, null);
  assert.equal(route.admission.waitUntil, NOW + 900000);
  assert.match(route.why, /quality.*wait/i);
});
test('no admitted candidate waits, never falls through legacy pressure rerouting', () => {
  const providerCapacity = admissionCapacity();
  providerCapacity.claude.quotaWindows[0].remainingPercent = 0;
  const route = resolveProjectRoute({ ...base, pool: pool.slice(0, 2), models: pool, ledger: [], samples: admissionSamples, providerCapacity, now: NOW });
  assert.equal(route.provider, null);
  assert.equal(route.admission.waitUntil, NOW + 900000);
});
test('light role fits 18%; absent samples or ledger leaves old route byte-equivalent', () => {
  const args = { ...base, pool: [approved], ledger: [], providerCapacity: admissionCapacity(), now: NOW };
  const explorer = { ...strategy, projectTeam: [{ ...strategy.projectTeam[0], role: 'Explorer' }] };
  assert.equal(resolveProjectRoute({ ...args, role: 'Explorer', strategy: explorer, samples: admissionSamples }).admission.candidates[0].admitted, true);
  assert.deepEqual(resolveProjectRoute({ ...args, samples: [] }), resolveProjectRoute(args));
  const { ledger, ...noLedger } = args;
  assert.deepEqual(resolveProjectRoute({ ...noLedger, samples: admissionSamples }), resolveProjectRoute(noLedger));
});

test('distribution cannot choose a worse admitted ladder member than waiting policy allows', () => {
  const candidates = [approved, model('claude', 'close', { utility: 2.99 }), model('claude', 'poor', { utility: 1 })];
  const ledger = [{ adapterId: 'claude', modelId: 'close', role: 'Builder', status: 'completed', at: NOW - 1000 }];
  const route = resolveProjectRoute({ ...base, pool: candidates, ledger, samples: admissionSamples, providerCapacity: admissionCapacity(), now: NOW });
  assert.equal(route.model.modelId, 'close');
});
 test('sole quality-qualified admitted alternative replaces lower-quality approved member', () => {
  const low = model('claude', 'approved-low', { utility: 1 });
  const high = model('codex', 'best-waiting', { utility: 3 });
  const close = model('claude', 'close-now', { utility: 2.99 });
  const s = { ...strategy, projectTeam: [{ role: 'Builder', model: low, assignmentSource: 'recommended' }] };
  const r = resolveProjectRoute({ ...base, strategy: s, pool: [low, high, close], ledger: [], samples: admissionSamples, providerCapacity: admissionCapacity(), now: NOW });
  assert.equal(r.admission.decision, 'admitted');
  assert.equal(r.model.modelId, 'close-now', JSON.stringify(r));
});

test("an approved model outside the role's pool is replaced by the best pool member", () => {
  const opus = model("claude", "opus", { utility: 5 });
  const cheap = [model("claude", "haiku", { utility: 2 }), model("codex", "luna", { utility: 1 })];
  const route = resolveProjectRoute({ role: "Tester", eligibility, providerCapacity: capacity, pool: [cheap[0]], ledger: [], now: NOW,
    strategy: { status: "active", profileFingerprint: "fp", projectTeam: [{ role: "Tester", model: opus, assignmentSource: "recommended" }] } });
  assert.equal(route.model.modelId, "haiku");
  assert.equal(route.assignmentSource, "tier-band");
  const rotated = resolveProjectRoute({ role: "Tester", eligibility, providerCapacity: capacity, pool: cheap, ledger: [], now: NOW,
    strategy: { status: "active", profileFingerprint: "fp", projectTeam: [{ role: "Tester", model: opus, assignmentSource: "recommended" }] } });
  assert.ok(["haiku", "luna"].includes(rotated.model.modelId));
});
