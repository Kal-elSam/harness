import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './team-route-fixture.test.js';
import { createConversationService } from '../src/global/team/service.js';
import { readTeamRoute } from '../src/global/team/routing-input-cache.js';
import { writeProjectStrategy } from '../src/global/team/project-strategy-store.js';

for (const path of ['service', 'cache']) {
  for (const role of ['Builder', 'Frontend Builder', 'Explorer']) {
    test(`${path} ${role} fallback applies S26 only to Builders`, async t => {
      const f = await fixture(t);
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
      const providerCapacity = Object.fromEntries(['claude', 'codex'].map(provider => [provider, {
        quotaRemainingPercent: provider === 'claude' ? 0 : 80,
        quotaWindows: [{ kind: '5h', remainingPercent: provider === 'claude' ? 0 : 80, resetsAt: Date.now() + 4 * 3600000 },
          { kind: 'weekly', remainingPercent: 90, resetsAt: Date.now() + 86400000 }]
      }]));
      const readUsageSamples = async (_home, provider) => [{ provider, window: '5h',
        timestamp: Date.now(), remainingPercent: provider === 'claude' ? 0 : 80,
        resetsAt: providerCapacity[provider].quotaWindows[0].resetsAt }];
      const eligibility = { claude: { ok: false, reason: 'quota blocked' }, codex: { ok: true } };
      let route;
      if (path === 'service') {
        const service = createConversationService({ homeDir: f.home, resolveRoot: async () => f.cwd,
          readProjectStrategy: async () => strategy, listRunRecords: async () => [],
          readUsageSamples });
        service.snapshot = async () => ({ modelIntelligence: {
          scoredAll: models, eligibility, providerCapacity
        } });
        route = await service.routeProjectExecution(role, f.cwd);
      } else {
        await f.cache({ roles: { [role]: { pool: models } }, models, eligibility, providerCapacity });
        route = await readTeamRoute({ homeDir: f.home, cwd: f.cwd, role }, { readUsageSamples });
      }
      assert.equal(route.decision, 'ROUTED', JSON.stringify(route));
      assert.equal(route.provider, 'codex');
      const candidates = route.admission.candidates.filter(row => row.provider === 'codex').map(row => row.modelId);
      const expected = role === 'Explorer' ? ['gpt-6-astra', 'gpt-5.6-terra'] : ['gpt-5.6-terra'];
      assert.deepEqual(candidates, expected);
      assert.equal(route.model.modelId, expected[0]);
    });
  }
}
