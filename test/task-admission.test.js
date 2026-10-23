import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateTaskCost, admit } from '../src/global/intelligence/task-admission.js';

const now = Date.parse('2026-10-22T12:00:00Z');
const reset = now + 900000;
const capacity = (burst = 18, weekly = 80) => ({ quotaWindows: [
  { kind: '5h', remainingPercent: burst, resetsAtIso: new Date(reset).toISOString() },
  { kind: 'weekly', remainingPercent: weekly, resetsAtIso: new Date(now + 86400000).toISOString() }
] });
const candidate = { adapterId: 'codex' };

test('18% cannot fund a 30% task, but can fund a light task', () => {
  const rejected = admit({ candidate, cost: { fiveHourPercent: 30, weeklyPercentPerBurst: 20 }, capacity: capacity(), now });
  assert.equal(rejected.admitted, false);
  assert.equal(rejected.waitUntil, reset);
  assert.match(rejected.reason, /5h.*18.*30/);
  assert.equal(admit({ candidate, cost: { fiveHourPercent: 10, weeklyPercentPerBurst: 20 }, capacity: capacity(), now }).admitted, true);
});

test('weekly exhaustion cannot be solved by a 5h reset; unknown conversion is conservative', () => {
  const result = admit({ candidate, cost: { fiveHourPercent: 30, weeklyPercentPerBurst: 20 }, capacity: capacity(80, 5), now });
  assert.equal(result.admitted, false);
  assert.equal(result.waitUntil, now + 86400000);
  assert.match(result.reason, /weekly/);
  assert.equal(admit({ candidate, cost: { fiveHourPercent: 30 }, capacity: capacity(80, 20), now }).admitted, false);
});

test('no history returns conservative tier defaults explicitly marked', () => {
  for (const [role, expected] of [['Explorer', 10], ['Builder', 30], ['Architect', 40], ['Custom', 40]]) {
    const cost = estimateTaskCost({ role, ledger: [], samples: [] });
    assert.equal(cost.defaultCost.fiveHourPercent, expected);
    assert.equal(cost.defaultCost.withoutHistory, true);
  }
});

function history() {
  const ledger = [], samples = [];
  for (let i = 0; i < 3; i++) {
    const start = now - (10 - i * 2) * 60000;
    ledger.push({ adapterId: 'codex', role: 'Builder', at: start, endAt: start + 10000, status: 'completed' });
    for (const [timestamp, remainingPercent] of [[start - 1000, 90], [start + 11000, 60 - i]]) {
      samples.push({ provider: 'codex', window: '5h', timestamp, remainingPercent, resetsAt: reset });
    }
  }
  return { ledger, samples };
}
test('per-provider median joins completed runs and launch-only intervals', () => {
  const { ledger, samples } = history();
  delete ledger[1].endAt;
  const cost = estimateTaskCost({ role: 'Builder', ledger, samples });
  assert.equal(cost.byProvider.codex.fiveHourPercent, 31);
  assert.equal(cost.byProvider.codex.observations, 3);
  assert.equal(cost.byProvider.codex.withoutHistory, false);
  assert.equal(cost.byProvider.claude, undefined);
});
test('reset crossings, overlaps and unrelated roles do not establish cheap history', () => {
  const { ledger, samples } = history();
  samples[1].resetsAt++;
  ledger.push({ ...ledger[1], role: 'Explorer' });
  ledger[2].role = 'Explorer';
  const cost = estimateTaskCost({ role: 'Builder', ledger, samples });
  assert.equal(cost.byProvider.codex.withoutHistory, true);
  assert.equal(cost.byProvider.codex.fiveHourPercent, 30);
});

test('stale or missing capacity cannot authorize a launch or invent a reset', () => {
  assert.equal(admit({ candidate, cost: { fiveHourPercent: 30 }, capacity: {}, now }).admitted, false);
  const stale = capacity();
  stale.quotaWindows[0].resetsAtIso = new Date(now - 1).toISOString();
  const result = admit({ candidate, cost: { fiveHourPercent: 30 }, capacity: stale, now });
  assert.equal(result.admitted, false);
  assert.equal(result.waitUntil, null);
});
