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

test('independent reviewers wait for the other provider instead of using Builder provider', () => {
  for (const role of ['Reviewer', 'Security Reviewer']) {
    const route = resolveProjectRoute({ ...args, role });
    assert.equal(route.decision, 'WAIT_FOR_PROJECT_TEAM', role);
    assert.equal(route.provider, null);
    assert.equal(route.admission.waitUntil, reset);
    assert.ok(route.admission.candidates.every(candidate => candidate.provider !== 'codex'));
  }
});

test('non-review roles still route to an admitted provider', () => {
  const route = resolveProjectRoute({ ...args, role: 'Planner' });
  assert.equal(route.decision, 'ROUTED');
  assert.equal(route.provider, 'codex');
});
