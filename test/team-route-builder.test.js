import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './team-route-fixture.test.js';
import { createConversationService } from '../src/global/team/service.js';
import { readTeamRoute, ROUTING_INPUT_CACHE_SCHEMA } from '../src/global/team/routing-input-cache.js';
import { writeProjectStrategy } from '../src/global/team/project-strategy-store.js';
import { paceQuotaWindows, providersWithUnusedQuota } from '../src/global/intelligence/quota-pacing.js';

const HOUR = 3600000;
// Codex 5h window, 2h before reset (60% elapsed): 30% left burns out early, 90% left sits unused.
const PACING = { tight: 30, unused: 90 };

async function route(t, { path, role, pacing }) {
  const f = await fixture(t);
  const now = Date.now();
  const model = (adapterId, modelId, codingIndex, cost, utility) => ({
    adapterId, modelId, accessMode: 'automatic', intelligenceIndex: codingIndex,
    codingIndex, priceInputPerMTok: cost, priceOutputPerMTok: cost, utility
  });
  const assigned = model('claude', 'claude-haiku-5-5', 100, .1, 4);
  const astra = model('codex', 'gpt-6-astra', 95, 10, 3);
  const terra = model('codex', 'gpt-5.6-terra', 90, 1, 2);
  const models = [assigned, astra, terra];
  const strategy = { ...f.strategy, roleCapabilities: { [role]: { required: ['coding'], optional: [] } },
    projectTeam: [{ role, model: assigned, assignmentSource: 'recommended' }] };
  await writeProjectStrategy(f.home, f.cwd, strategy);
  const codexWindows = pacing === 'unknown' ? [] : paceQuotaWindows({ windows: [{ name: '5h',
    remainingPercent: PACING[pacing], resetsAt: (now + 2 * HOUR) / 1000 }] }, now);
  const providerCapacity = { claude: { quotaRemainingPercent: 0, quotaWindows: [] },
    codex: { quotaRemainingPercent: PACING[pacing] ?? 80, quotaWindows: codexWindows } };
  const eligibility = { claude: { ok: false, reason: 'quota blocked' }, codex: { ok: true } };
  if (path === 'service') {
    const service = createConversationService({ homeDir: f.home, resolveRoot: async () => f.cwd,
      readProjectStrategy: async () => strategy, listRunRecords: async () => [],
      readUsageSamples: async () => [], now: () => now });
    service.snapshot = async () => ({ modelIntelligence: { scoredAll: models, eligibility, providerCapacity } });
    return service.routeProjectExecution(role, f.cwd);
  }
  await f.cache({ roles: { [role]: { pool: models } }, models, eligibility, providerCapacity, generatedAt: now });
  return readTeamRoute({ homeDir: f.home, cwd: f.cwd, role }, { readUsageSamples: async () => [], now: () => now });
}

for (const path of ['service', 'cache']) {
  for (const role of ['Builder', 'Frontend Builder']) {
    for (const pacing of ['tight', 'unknown']) {
      test(`${path} ${role} takes the cheapest qualified model when quota is ${pacing}`, async t => {
        const r = await route(t, { path, role, pacing });
        assert.equal(r.decision, 'ROUTED', JSON.stringify(r));
        assert.equal(r.provider, 'codex');
        assert.equal(r.model.modelId, 'gpt-5.6-terra');
      });
    }
    test(`${path} ${role} keeps the tier-band model when quota would sit unused`, async t => {
      const r = await route(t, { path, role, pacing: 'unused' });
      assert.equal(r.decision, 'ROUTED', JSON.stringify(r));
      assert.equal(r.model.modelId, 'gpt-6-astra');
    });
  }
  for (const pacing of ['tight', 'unused', 'unknown']) {
    test(`${path} Explorer is unchanged when quota is ${pacing}`, async t => {
      const r = await route(t, { path, role: 'Explorer', pacing });
      assert.equal(r.decision, 'ROUTED', JSON.stringify(r));
      assert.equal(r.model.modelId, 'gpt-5.6-terra', 'Explorer keeps its light band regardless of pacing');
    });
  }
}

// Claude capacity windows carry /usage labels; recorded samples are always '5h' or 'weekly'.
async function claudeRoute(t, path) {
  const f = await fixture(t);
  const now = Date.now();
  const model = (modelId, cost) => ({ adapterId: 'claude', modelId, accessMode: 'automatic', intelligenceIndex: 95,
    codingIndex: 95, priceInputPerMTok: cost, priceOutputPerMTok: cost, utility: 1 });
  const top = model('claude-opus-x', 10), cheap = model('claude-sonnet-x', 1);
  const assigned = { adapterId: 'codex', modelId: 'gpt-x', accessMode: 'automatic', intelligenceIndex: 95, codingIndex: 95, priceInputPerMTok: 1, priceOutputPerMTok: 1, utility: 0 };
  const models = [assigned, top, cheap];
  const strategy = { ...f.strategy, roleCapabilities: { Builder: { required: ['coding'], optional: [] } },
    projectTeam: [{ role: 'Builder', model: assigned, assignmentSource: 'recommended' }] };
  await writeProjectStrategy(f.home, f.cwd, strategy);
  // 60% left, 2h before reset: the window average alone projects unused quota.
  const quotaWindows = paceQuotaWindows({ windows: [{ name: 'Current session', remainingPercent: 60, resetsAt: (now + 2 * HOUR) / 1000 },
    { name: 'Current week (all models)', remainingPercent: 90, resetsAt: (now + 72 * HOUR) / 1000 }] }, now);
  const reset = Date.parse(quotaWindows[0].resetsAtIso);
  // Recent burn: 100% to 60% within the last hour makes the blended projection tight.
  const rows = [100, 60].map((remainingPercent, i) => ({ provider: 'claude', window: '5h', remainingPercent, resetsAt: reset, timestamp: now - (1 - i) * HOUR }));
  const readUsageSamples = async (_home, provider) => provider === 'claude' ? rows : [];
  const providerCapacity = { claude: { quotaRemainingPercent: 60, quotaWindows }, codex: { quotaRemainingPercent: 0, quotaWindows: [] } };
  const eligibility = { claude: { ok: true }, codex: { ok: false, reason: 'quota blocked' } };
  if (path === 'service') {
    const service = createConversationService({ homeDir: f.home, resolveRoot: async () => f.cwd,
      readProjectStrategy: async () => strategy, listRunRecords: async () => [], readUsageSamples, now: () => now });
    service.snapshot = async () => ({ modelIntelligence: { scoredAll: models, eligibility, providerCapacity } });
    return service.routeProjectExecution('Builder', f.cwd);
  }
  await f.cache({ roles: { Builder: { pool: models } }, models, eligibility, providerCapacity, generatedAt: now });
  return readTeamRoute({ homeDir: f.home, cwd: f.cwd, role: 'Builder' }, { readUsageSamples, now: () => now });
}
for (const path of ['service', 'cache']) {
  test(`${path} Claude-labelled windows count recorded recent burn for Builder`, async t => {
    const r = await claudeRoute(t, path);
    assert.equal(r.decision, 'ROUTED', JSON.stringify(r));
    assert.equal(r.model.modelId, 'claude-sonnet-x');
  });
  test(`${path} Architect keeps its band model, which is not the cheapest`, async t => {
    const r = await route(t, { path, role: 'Architect', pacing: 'tight' });
    assert.equal(r.decision, 'ROUTED', JSON.stringify(r));
    assert.equal(r.model.modelId, 'gpt-6-astra');
  });
}

test('an exhausted-marked provider with healthy windows is not counted as unused', () => {
  const now = Date.now();
  const quotaWindows = paceQuotaWindows({ windows: [{ name: '5h', remainingPercent: 90, resetsAt: (now + 2 * HOUR) / 1000 }] }, now);
  const unused = providersWithUnusedQuota({ a: { quotaWindows }, b: { quotaWindows, exhaustion: { reason: 'limit' } } }, [], now);
  assert.deepEqual([...unused], ['a']);
});

test('a routing cache from the previous schema reads as stale', async t => {
  const f = await fixture(t);
  assert.equal(ROUTING_INPUT_CACHE_SCHEMA, 'kairo.routing-input-cache/v2');
  await f.cache({ schema: 'kairo.routing-input-cache/v1' });
  const r = await readTeamRoute({ homeDir: f.home, cwd: f.cwd, role: 'Builder' });
  assert.equal(r.decision, 'STALE');
});
