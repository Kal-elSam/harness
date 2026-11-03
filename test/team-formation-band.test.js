import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectStrategy } from '../src/global/team/project-strategy.js';
import { resolveProjectRoute } from '../src/global/team/project-router.js';

const model = (adapterId, modelId, price, score = 100, intelligenceIndex = 50) => ({ adapterId, modelId, displayName: modelId, accessMode: 'automatic', intelligenceIndex, codingIndex: score, agenticIndex: score, gpqa: Math.min(score, 100) / 100, hle: Math.min(score, 100) / 100, priceInputPerMTok: price, priceOutputPerMTok: price });
const fleet = [model('codex', 'luna', 1), model('codex', 'sol', 3), model('codex', 'terra', 4), model('codex', 'astra', 10, 120, 60), model('claude', 'haiku', 1), model('claude', 'sonnet', 3), model('claude', 'opus', 10, 100, 60)];
const eligibility = { codex: { ok: true }, claude: { ok: true } };

test('formation assigns Backend Builder and Planner within their stamped bands', () => {
  const profile = { fingerprint: 'fixture', roleRequirements: ['Backend Builder', 'Planner'].map(role => ({ role, capabilities: ['reasoning'] })) };
  const strategy = buildProjectStrategy(profile, { scoredAll: fleet, eligibility, teamShape: true }, { model: fleet[0], selectionSource: 'manual' });
  for (const entry of strategy.projectTeam) {
    if (entry.role === 'Backend Builder') assert.ok(!entry.pool.some(m => m.modelId === 'astra'), entry.role);
    else assert.ok(entry.pool.some(m => m.modelId === 'astra'), 'analysis may use qualified frontier evidence');
    assert.ok(entry.pool.some(m => m.adapterId === entry.model.adapterId && m.modelId === entry.model.modelId), `${entry.role}: ${entry.model.modelId} outside band`);
  }
});


// Same shape as the team-rebuild fixture: codex has no standard-priced model (its Builder steps down to the light band), claude-30 is in the Reviewer band but fails the floor.
const row = (adapterId, score, price) => ({ adapterId, modelId: `${adapterId}-${score}`, intelligenceIndex: score / 2, codingIndex: score, gpqa: score / 100, hle: score / 100, priceInputPerMTok: price, priceOutputPerMTok: price, accessMode: 'automatic' });
const caps = ['reasoning', 'coding'];
const lowFleet = [row('codex', 80, .1), row('codex', 40, .2), row('claude', 30, 2)];
const lowProfile = { fingerprint: 'band', roleRequirements: ['Architect', 'Builder', 'Reviewer'].map(role => ({ role, capabilities: caps })) };
const lowStrategy = () => buildProjectStrategy(lowProfile, { scoredAll: lowFleet, eligibility, teamShape: true }, { model: lowFleet[0], selectionSource: 'manual' });
const keyOf = m => `${m.adapterId}::${m.modelId}`;

test('formation rejects review on the Builder provider when independent evidence is below floor', () => {
  const before = JSON.stringify(lowFleet);
  assert.throws(lowStrategy, error => error.code === 'reviewer_independence' && error.role === 'Reviewer');
  assert.equal(JSON.stringify(lowFleet), before);
});

test('evaluated rows outside the role band stay listed as outside_band and are never assigned', () => {
  const profile = { ...lowProfile, roleRequirements: lowProfile.roleRequirements.filter(entry => entry.role !== 'Reviewer') };
  const strategy = buildProjectStrategy(profile, { scoredAll: lowFleet, eligibility, teamShape: true }, { model: lowFleet[0] });
  for (const team of [strategy.qualityTeam, strategy.efficientTeam]) {
    for (const entry of team) {
      const projected = strategy.projectTeam.find(e => e.role === entry.role);
      const band = new Set(projected.pool.map(keyOf));
      const outside = entry.selection.evaluated.filter(r => !band.has(r.candidateKey));
      assert.ok(outside.length > 0, `${entry.role}: rows outside the band are listed`);
      for (const r of outside) {
        assert.equal(r.blockedBy, 'outside_band', `${entry.role} ${r.candidateKey}`);
        assert.equal(r.inBand, false);
      }
      assert.ok(band.has(keyOf(entry.model)), `${entry.role}: assigned model is in band`);
      assert.ok(!outside.some(r => r.candidateKey === keyOf(entry.model)));
    }
  }
});

test('a below-floor off-provider Reviewer cannot enter the operational pool', () => {
  assert.throws(lowStrategy, error => error.code === 'reviewer_independence' && /different provider/i.test(error.message));
});

test('model caps cannot rescue a below-floor or same-provider Reviewer', () => {
  const fleet3 = [row('codex', 80, .1), row('codex', 40, .2), row('claude', 30, 2)];
  assert.throws(() => buildProjectStrategy(lowProfile, { scoredAll: fleet3, eligibility, teamShape: true },
    { model: fleet3[0], selectionSource: 'manual' }), error => error.code === 'reviewer_independence');
});

test('the S9 cap counts the admitted band models without re-banding their prices', () => {
  const codex = [model('codex', 'luna', 1), model('codex', 'sol', 3), model('codex', 'terra', 4), model('codex', 'astra', 10)];
  const profile = { fingerprint: 'cap', roleRequirements: ['Builder', 'Planner', 'DevOps', 'Refactorer'].map(role => ({ role, capabilities: ['reasoning'] })) };
  const strategy = buildProjectStrategy(profile, { scoredAll: codex, eligibility, teamShape: true }, { model: codex[0], selectionSource: 'manual' });
  assert.deepEqual(strategy.projectTeam.map(e => e.role).sort(), ['Builder', 'DevOps', 'Planner', 'Refactorer']);
  const counts = {};
  for (const entry of strategy.projectTeam) {
    assert.ok(entry.pool.some(m => keyOf(m) === keyOf(entry.model)), `${entry.role} in band`);
    counts[entry.model.modelId] = (counts[entry.model.modelId] ?? 0) + 1;
  }
  assert.ok(Math.max(...Object.values(counts)) <= 2, `no model holds more than two roles: ${JSON.stringify(counts)}`);
});

test('primary and fallback of every role stay inside the stamped band, and an unavailable primary never routes to an out-of-band fallback', () => {
  const profile = { fingerprint: 'fb', roleRequirements: ['Builder', 'Backend Builder', 'Planner'].map(role => ({ role, capabilities: ['reasoning'] })) };
  const strategy = buildProjectStrategy(profile, { scoredAll: fleet, eligibility, teamShape: true }, { model: fleet[0], selectionSource: 'manual' });
  let fallbacks = 0;
  for (const entry of strategy.projectTeam) {
    const band = new Set(entry.pool.map(keyOf));
    assert.ok(band.has(keyOf(entry.model)), `${entry.role} primary in band`);
    if (entry.fallback) { fallbacks++; assert.ok(band.has(keyOf(entry.fallback)), `${entry.role} fallback ${entry.fallback.modelId} in band`); }
  }
  for (const team of [strategy.qualityTeam, strategy.efficientTeam]) {
    for (const entry of team) {
      const band = new Set(strategy.projectTeam.find(e => e.role === entry.role).pool.map(keyOf));
      const primary = entry.model ?? entry.primary;
      assert.ok(band.has(keyOf(primary)), `${entry.role} primary in band`);
      if (entry.fallback) assert.ok(band.has(keyOf(entry.fallback)), `${entry.role} fallback in band`);
    }
  }
  assert.ok(fallbacks > 0, 'fixture exercises fallbacks');
  const built = strategy.projectTeam.find(e => e.role === 'Backend Builder');
  const forced = { ...strategy, status: 'active', approvedAt: '2026-10-22T10:00:00Z', profileFingerprint: 'fb',
    projectTeam: strategy.projectTeam.map(e => e === built ? { ...e, model: fleet.find(m => m.modelId === 'sonnet'), assignmentSource: 'recommended' } : e) };
  const route = resolveProjectRoute({ role: 'Backend Builder', strategy: forced,
    eligibility: { claude: { ok: false, reason: 'quota' }, codex: { ok: true } } });
  const band = new Set(built.pool.map(keyOf));
  assert.notEqual(route.model?.modelId ?? route.suggestedAlternative?.model?.modelId, 'astra');
  const picked = route.model ?? route.suggestedAlternative?.model;
  if (picked) assert.ok(band.has(keyOf(picked)), `routed ${picked.modelId} in band`);
});
