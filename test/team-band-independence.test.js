import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProjectRoute } from '../src/global/team/project-router.js';

const now = Date.parse('2026-10-22T12:00:00Z');
const model = (adapterId, modelId, price, score = 100) => ({ adapterId, modelId, displayName: modelId, accessMode: 'automatic', intelligenceIndex: score, codingIndex: score, agenticIndex: score, priceInputPerMTok: price, priceOutputPerMTok: price });
const fleet = [model('codex', 'luna', 1), model('codex', 'sol', 3), model('codex', 'terra', 4), model('codex', 'astra', 10, 120), model('claude', 'haiku', 1), model('claude', 'sonnet', 3), model('claude', 'opus', 10)];
const eligibility = { codex: { ok: true }, claude: { ok: true } };

const reset = now + 3600000;
const builder = fleet[1], reviewer = fleet[5];
const strategy = { status: 'active', profileFingerprint: 'fixture', projectTeam: [
  { role: 'Builder', model: builder }, { role: 'Reviewer', model: reviewer }, { role: 'Security Reviewer', model: reviewer }, { role: 'Planner', model: reviewer }
] };
const args = { strategy, eligibility, pool: [builder, reviewer], ledger: [], now,
  samples: [{ provider: 'claude', window: '5h', timestamp: now - 1000, remainingPercent: 0, resetsAt: reset }],
  providerCapacity: { codex: { quotaRemainingPercent: 80, quotaWindows: [{ kind: '5h', remainingPercent: 80, resetsAt: reset }, { kind: 'weekly', remainingPercent: 90, resetsAt: now + 86400000 }] }, claude: { quotaRemainingPercent: 0, quotaWindows: [{ kind: '5h', remainingPercent: 0, resetsAt: reset }, { kind: 'weekly', remainingPercent: 90, resetsAt: now + 86400000 }] } } };

test('independent reviewers use the Builder provider when independent providers cannot fund the task', () => {
  for (const role of ['Reviewer', 'Security Reviewer']) {
    const route = resolveProjectRoute({ ...args, role });
    assert.equal(route.decision, 'ROUTED', role);
    assert.equal(route.provider, 'codex');
    assert.equal(route.independence, 'builder-provider');
    assert.match(route.why, /Not provider-independent: codex also holds the Builder; independent providers unavailable until 2026-10-22T13:00:00.000Z/);
  }
});

test('independent provider wins when admitted', () => {
  const route = resolveProjectRoute({ ...args, role: 'Reviewer', providerCapacity: { ...args.providerCapacity, claude: args.providerCapacity.codex } });
  assert.equal(route.decision, 'ROUTED');
  assert.equal(route.provider, 'claude');
  assert.equal(route.independence, 'independent');
});

test('waits until the earliest reset when no provider is admitted', () => {
  const earlier = now + 1800000;
  const route = resolveProjectRoute({ ...args, role: 'Reviewer', providerCapacity: { ...args.providerCapacity, codex: { quotaRemainingPercent: 0, quotaWindows: [{ kind: '5h', remainingPercent: 0, resetsAt: earlier }, { kind: 'weekly', remainingPercent: 90, resetsAt: now + 86400000 }] } } });
  assert.equal(route.decision, 'WAIT_FOR_PROJECT_TEAM');
  assert.equal(route.admission.waitUntil, earlier);
});

test('non-review roles still route to an admitted provider', () => {
  const route = resolveProjectRoute({ ...args, role: 'Planner' });
  assert.equal(route.decision, 'ROUTED');
  assert.equal(route.provider, 'codex');
});
