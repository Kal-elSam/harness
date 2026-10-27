import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './team-route-fixture.test.js';
import { createConversationService } from '../src/global/team/service.js';
import { readTeamRoute } from '../src/global/team/routing-input-cache.js';
import { writeProjectStrategy } from '../src/global/team/project-strategy-store.js';
import { paceQuotaWindows } from '../src/global/intelligence/quota-pacing.js';

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
