import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProjectRoute } from '../src/global/team/project-router.js';

const NOW = Date.parse('2026-10-26T20:00:00Z');
const CODEX_RESET = NOW + 32 * 60000;
const CLAUDE_RESET = NOW + 4.5 * 3600000;
const model = (adapterId, modelId, utility) => ({
  candidateKey: `${adapterId}::${modelId}`, adapterId, modelId, displayName: modelId,
  accessMode: 'automatic', utility
});
const codex = model('codex', 'gpt-6-astra', 3);
const claude = model('claude', 'claude-opus-5-5', 2.9);
const windows = (remainingPercent, resetsAt) => [
  { kind: '5h', remainingPercent, resetsAt },
  { kind: 'weekly', remainingPercent: 80, resetsAt: NOW + 5 * 86400000 }
];
const base = () => ({
  role: 'Reviewer', strategy: { status: 'active', projectTeam: [{ role: 'Reviewer', model: codex, assignmentSource: 'recommended' }] },
  pool: [claude], models: [codex, claude], ledger: [], now: NOW,
  eligibility: { codex: { ok: false, cause: 'quota_exhausted', reason: '5h quota exhausted', limit: { resetsAt: new Date(CODEX_RESET).toISOString() } }, claude: { ok: true } },
  providerCapacity: { codex: { quotaRemainingPercent: 0, quotaWindows: windows(0, CODEX_RESET) }, claude: { quotaRemainingPercent: 25, quotaWindows: windows(25, CLAUDE_RESET) } },
  samples: [{ provider: 'claude', window: '5h', timestamp: NOW - 1000, remainingPercent: 25, resetsAt: CLAUDE_RESET }]
});

test('exhausted approved provider contributes its earlier reset', () => {
  const route = resolveProjectRoute(base());
  assert.equal(route.decision, 'WAIT_FOR_PROJECT_TEAM');
  assert.equal(route.provider, null);
  assert.equal(route.admission.waitUntil, CODEX_RESET);
  assert.equal(route.admission.candidates.find(row => row.provider === 'codex').admitted, false);
  assert.ok(route.admission.reason.includes(`Wait until ${new Date(CODEX_RESET).toISOString()}`));
});

test('quota reserve provider is never routed even when affordable', () => {
  const args = base();
  args.eligibility.codex = { ok: false, cause: 'quota_reserve', reason: 'quota reserve', limit: { resetsAt: new Date(CODEX_RESET).toISOString() } };
  args.providerCapacity.codex = { quotaRemainingPercent: 3, quotaWindows: windows(3, CODEX_RESET) };
  args.providerCapacity.claude = { quotaRemainingPercent: 80, quotaWindows: windows(80, CLAUDE_RESET) };
  for (let i = 0; i < 3; i++) {
    const start = NOW - (10 - i * 2) * 60000;
    args.ledger.push({ adapterId: 'codex', role: 'Reviewer', at: start, endAt: start + 10000, status: 'completed' });
    args.samples.push(...[[start - 1000, 5], [start + 11000, 4]].map(([timestamp, remainingPercent]) => ({ provider: 'codex', window: '5h', timestamp, remainingPercent, resetsAt: CODEX_RESET })));
  }
  const route = resolveProjectRoute(args);
  assert.notEqual(route.provider, 'codex');
  const rows = route.admission.candidates.filter(row => row.provider === 'codex');
  assert.equal(rows.length, 1);
  assert.ok(rows.every(row => !row.admitted));
});

test('other ineligibility does not contribute a wait', () => {
  const args = base();
  args.eligibility.codex = { ok: false, cause: 'unavailable_verified', reason: 'unavailable' };
  const route = resolveProjectRoute(args);
  assert.equal(route.admission.waitUntil, CLAUDE_RESET);
  assert.equal(route.admission.candidates.some(row => row.provider === 'codex'), false);
});
