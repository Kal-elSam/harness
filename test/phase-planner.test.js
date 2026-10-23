import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEfficientTeam } from '../src/global/intelligence/model-intelligence.js';
import { buildProjectStrategy } from '../src/global/team/project-strategy.js';

const HOUR = 3600000;
const now = Date.parse('2026-10-23T00:00:00Z');
const iso = t => new Date(t).toISOString();
const roles = ['Explorer', 'Architect', 'Debugger', 'Test Author', 'Docs Writer', 'Refactorer'];
const row = (adapterId, modelId, score = 90) => ({ adapterId, modelId,
  intelligenceIndex: score, codingIndex: score, priceInputPerMTok: 1,
  priceOutputPerMTok: 1, accessMode: 'automatic' });
const window = (kind, remainingPercent, reset, duration) => ({ kind, remainingPercent,
  resetsAtIso: iso(reset), resetsInMs: reset - now, timeLeftFraction: (reset - now) / duration,
  paceFactor: remainingPercent / 100 / ((reset - now) / duration) });
const capacity = () => ({ codex: { quotaWindows: [window('5h', 20, now + HOUR, 5 * HOUR),
  window('weekly', 90, now + 2 * HOUR, 168 * HOUR)] },
  claude: { quotaWindows: [window('5h', 100, now + 5 * HOUR, 5 * HOUR)] } });
function build({ models = [row('codex', 'fast'), row('claude', 'other', 85)], names = ['Explorer'], providerCapacity = capacity(), ...extra } = {}) {
  return buildProjectStrategy({ fingerprint: 'phase', roleRequirements: names.map(role => ({ role, capabilities: ['reasoning', 'coding'] })) },
    { scoredAll: models, eligibility: { codex: { ok: true }, claude: { ok: true } }, providerCapacity, now, ...extra }, { model: models[0] });
}

test('phase boundaries include ordered exhaustion and both window resets', () => {
  const strategy = build();
  const starts = strategy.phasePlan.phases.map(p => Date.parse(p.startsAt));
  // Average burn: 80 points / 4 hours, so the remaining 20 lasts one hour.
  assert.ok(starts.includes(now + HOUR));
  assert.ok(starts.includes(now + 2 * HOUR));
  assert.ok(starts.includes(now + 5 * HOUR));
  assert.deepEqual(starts, [...new Set(starts)].sort((a, b) => a - b));
  assert.ok(strategy.phasePlan.phases.some(p => p.events.some(e => e.type === 'exhaustion')));
});

test('projected exhaustion moves roles to qualified alternatives and reset restores the ideal', () => {
  const providerCapacity = capacity();
  providerCapacity.codex.quotaWindows[0] = window('5h', 10, now + HOUR, 5 * HOUR);
  const strategy = build({ providerCapacity, names: ['Explorer', 'Architect'] });
  const plan = strategy.phasePlan;
  const idealRole = plan.idealTeam.find(entry => entry.model?.adapterId === 'codex').role;
  const exhaustion = now + 10 / (90 / (4 * HOUR));
  const depleted = plan.phases.find(p => Math.abs(Date.parse(p.startsAt) - exhaustion) < 2);
  assert.equal(depleted.team.find(entry => entry.role === idealRole).model.adapterId, 'claude');
  assert.equal(depleted.budgets.codex.remainingPercent, 0);
  const reset = plan.phases.find(p => p.startsAt === iso(now + HOUR));
  assert.equal(reset.team.find(entry => entry.role === idealRole).model.adapterId, 'codex');
});

test('a role without qualified budget waits with its next usable reset, never below floor', () => {
  const providerCapacity = capacity();
  providerCapacity.codex.quotaWindows[0] = window('5h', 0, now + HOUR, 5 * HOUR);
  const strategy = build({ models: [row('codex', 'qualified'), row('claude', 'weak', 20)], providerCapacity });
  const waiting = strategy.phasePlan.phases[0].team[0];
  assert.equal(waiting.model, null);
  assert.equal(waiting.assignmentState, 'waiting');
  assert.equal(waiting.waitUntil, iso(now + HOUR));
  assert.match(waiting.reason, /waiting.*reset/i);
});

test('every phase preserves the strict role cap with qualified overflow explanations', () => {
  const strategy = build({ models: [row('codex', 'one'), row('codex', 'two', 85), row('claude', 'three', 80)], names: roles });
  for (const phase of strategy.phasePlan.phases) {
    const entries = phase.team.filter(e => e.model);
    const counts = new Map();
    for (const entry of entries) counts.set(entry.model.modelId, (counts.get(entry.model.modelId) ?? 0) + 1);
    for (const entry of entries) {
      const cap = entry.selection.modelRoleCap ?? 2;
      assert.ok(counts.get(entry.model.modelId) <= cap || /only qualified|every qualified model is full/i.test(entry.reason), JSON.stringify(phase));
    }
  }
});

test('adding a phase plan does not change today\'s single projectTeam output', () => {
  const withPlan = build();
  assert.deepEqual(withPlan.phasePlan.idealTeam, withPlan.projectTeam);
  const models = [row('codex', 'fast'), row('claude', 'other', 85)];
  const legacy = buildEfficientTeam(models, { codex: { ok: true }, claude: { ok: true } }, null,
    { strictModelCap: true, providerCapacity: capacity(), roleCapabilities: { Explorer: { required: ['reasoning', 'coding'], optional: [] } } });
  assert.deepEqual(withPlan.projectTeam.map(e => [e.model.adapterId, e.model.modelId, e.reason, e.decisionEvidence]),
    legacy.map(e => [e.primary.adapterId, e.primary.modelId, e.reason, e.decisionEvidence]));
});

test('blended recent and mature burn determines the exhaustion boundary', () => {
  const providerCapacity = capacity();
  providerCapacity.codex.quotaWindows[0] = window('5h', 30, now + 2 * HOUR, 5 * HOUR);
  const reset = now + 2 * HOUR;
  const quotaSamples = { codex: [
    { provider: 'codex', window: '5h', remainingPercent: 50, resetsAt: reset, timestamp: now - HOUR },
    { provider: 'codex', window: '5h', remainingPercent: 30, resetsAt: reset, timestamp: now }
  ] };
  const plan = build({ providerCapacity, quotaSamples }).phasePlan;
  const expected = now + Math.ceil(30 / ((70 / (3 * HOUR) + 20 / HOUR) / 2));
  assert.ok(plan.phases.some(phase => phase.startsAt === iso(expected)
    && phase.events.some(event => event.type === 'exhaustion' && event.provider === 'codex')));
});

test('a weekly exhaustion stays depleted through a five-hour reset', () => {
  const providerCapacity = capacity();
  providerCapacity.codex.quotaWindows[1] = window('weekly', 0, now + 2 * HOUR, 168 * HOUR);
  const plan = build({ providerCapacity, models: [row('codex', 'qualified'), row('claude', 'weak', 20)] }).phasePlan;
  const phase = plan.phases.find(p => p.startsAt === iso(now + HOUR));
  assert.equal(phase.team[0].model, null);
  assert.equal(phase.team[0].waitUntil, iso(now + 2 * HOUR));
});

test('measured quality below the role floor never becomes a phase alternative', () => {
  const providerCapacity = capacity();
  providerCapacity.codex.quotaWindows[0] = window('5h', 0, now + HOUR, 5 * HOUR);
  const strategy = build({ providerCapacity, roleTelemetry: { roles: { Explorer: new Map([
    ['claude::other', { resultRuns: 5, successRate: .1 }]
  ]) } } });
  assert.equal(strategy.phasePlan.phases[0].team[0].model, null);
  assert.ok(strategy.phasePlan.phases.every(phase => phase.team.every(entry => entry.model?.modelId !== 'other')));
});

test('phase selection receives refreshed aggregate quota pace after a reset', async () => {
  const { buildPhasePlan } = await import('../src/global/intelligence/phase-planner.js');
  const providerCapacity = capacity();
  providerCapacity.codex.quotaPaceFactor = 0;
  providerCapacity.codex.quotaRemainingPercent = 0;
  providerCapacity.codex.quotaWindows[0] = window('5h', 0, now + HOUR, 5 * HOUR);
  const seen = [];
  const plan = buildPhasePlan({ idealTeam: [], providerCapacity, now, selectTeam: projected => { seen.push(projected); return []; } });
  const resetIndex = plan.phases.findIndex(phase => phase.startsAt === iso(now + HOUR));
  assert.ok(seen[resetIndex].codex.quotaPaceFactor > 0);
  assert.equal(seen[resetIndex].codex.quotaPaceFactor,
    Math.min(...seen[resetIndex].codex.quotaWindows.map(w => w.paceFactor)));
});

test('phase fallbacks are qualified and budgeted, including ideal-team restoration', () => {
  for (const weak of [false, true]) {
    const providerCapacity = capacity();
    providerCapacity.codex.quotaWindows[0] = window('5h', weak ? 20 : 0, now + HOUR, 5 * HOUR);
    const plan = build({ providerCapacity, models: [row('codex', 'qualified'), row('claude', 'other', weak ? 20 : 85)] }).phasePlan;
    for (const phase of plan.phases) {
      for (const entry of phase.team) {
        if (!entry.fallback) continue;
        assert.ok(entry.qualifiedAlternatives.some(candidate => candidate.modelId === entry.fallback.modelId));
        assert.notEqual(phase.budgets[entry.fallback.adapterId]?.remainingPercent, 0);
      }
    }
  }
});

test('rebuild loads observations even through catalog preflight', async t => {
  const { harness } = await import('./helpers/setup-harness.js');
  const { rm } = await import('node:fs/promises');
  const samples = [
    { provider: 'codex', window: '5h', remainingPercent: 50, resetsAt: now + 2 * HOUR, timestamp: now - HOUR },
    { provider: 'codex', window: '5h', remainingPercent: 30, resetsAt: now + 2 * HOUR, timestamp: now }
  ];
  const h = await harness({ strategy: { status: 'suggested', projectTeam: [], bootstrapAnalyst: row('codex', 'qualified'),
    roleCapabilities: { Explorer: { required: ['reasoning', 'coding'], optional: [] } } },
    serviceDeps: { now: () => now, readUsageSamples: async (_home, provider) => provider === 'codex' ? samples : [] } });
  t.after(async () => { await rm(h.root, { recursive: true, force: true }); await rm(h.home, { recursive: true, force: true }); });
  h.modelIntelligence.scoredAll = [row('codex', 'qualified'), row('claude', 'other', 85)];
  h.modelIntelligence.manualSelectionScoredPool = h.modelIntelligence.scoredAll;
  h.modelIntelligence.registry = null;
  h.modelIntelligence.providerCapacity = capacity();
  h.modelIntelligence.providerCapacity.codex.quotaWindows[0] = window('5h', 30, now + 2 * HOUR, 5 * HOUR);
  await h.service.rebuildProjectTeam({ cwd: h.root, yes: true });
  const expected = now + Math.ceil(30 / ((70 / (3 * HOUR) + 20 / HOUR) / 2));
  assert.ok(h.store.strategy.phasePlan.phases.some(phase => phase.startsAt === iso(expected)));
});
