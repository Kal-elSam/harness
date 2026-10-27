import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { harness, draftTeam } from './helpers/setup-harness.js';
import { createConversationService } from '../src/global/team/service.js';
import { readProjectStrategy, readTeamReform } from '../src/global/team/project-strategy-store.js';
import { activateCatalogRoles } from '../src/global/intelligence/role-registry.js';

async function world(t) {
  const profile = { projectName: 'repo', stack: ['Node.js'], architecture: { pattern: 'x' },
    quality: {}, hotspots: [], workflowCapabilities: [], risks: [], fingerprint: 'fp-1', signals: {},
    roleRequirements: activateCatalogRoles([{ role: 'Explorer', capabilities: ['reasoning'], reason: '' }], { signals: {} }) };
  const h = await harness({ git: true, diskStrategy: true, serviceDeps: { enableProviderProbes: true, computeProjectProfile: async () => profile } });
  t.after(async () => { await rm(h.root, { recursive: true, force: true }); await rm(h.home, { recursive: true, force: true }); });
  await draftTeam(h);
  await h.service.approveProjectStrategy({ cwd: h.root });
  const state = { entitlement: 'allowed', claudeModels: [{ id: 'claude-model' }] };
  const timestamp = new Date().toISOString();
  const service = createConversationService({ homeDir: h.home, resolveRoot: async () => h.root, enableProviderProbes: true,
    computeProjectProfile: async () => profile, listPlans: async () => [], recoverRuns: async () => {}, listRunRecords: async () => [],
    inspectExecutionAdapters: () => ['claude', 'codex'].map(id => ({ id, available: true, launchable: true })),
    inspectEngramIntegration: () => ({}), readCodexUsage: async () => null, readClaudeUsage: async () => null,
    readOpenCodeUsage: async () => null, readCodexModels: async () => ({ models: [{ id: 'codex-model' }] }),
    readClaudeModels: () => ({ models: state.claudeModels }), readOpenCodeModels: async () => ({ models: [] }),
    readCursorModels: async () => ({ models: [] }), readCursorAccessCache: async () => null,
    readArtificialAnalysisModels: async () => ({ models: [
      { slug: 'codex-model', name: 'Codex Model', intelligenceIndex: 90, codingIndex: 40 },
      { slug: 'claude-model', name: 'Claude Model', intelligenceIndex: 40, codingIndex: 90 }
    ] }),
    verifyClaudeSubscriptionAuth: async () => ({ mode: 'subscription', subscriptionType: 'pro' }),
    readClaudeEntitlementCache: async () => ({ fetchedAt: timestamp, subscriptionType: 'pro', models: {
      'claude-model': { status: state.entitlement, probedAt: timestamp }
    } }),
    readHuggingFaceLeaderboard: async () => ({ entries: [] }), readAgentSessionTelemetry: async () => null
  });
  return { h, state, service };
}

test('entitlement changes do not re-form an unchanged provider catalog', async t => {
  const { h, state, service } = await world(t);
  const before = await readProjectStrategy(h.home, h.root);
  for (const status of ['unverified', 'denied', 'allowed', 'denied', 'allowed']) {
    state.entitlement = status;
    const result = await service.refreshRoutingInputs({ cwd: h.root });
    assert.equal(result.reformError, undefined);
    assert.equal((await readTeamReform(h.home, h.root)).entries.length, 0, `no re-form for ${status}`);
    assert.deepEqual(await readProjectStrategy(h.home, h.root), before);
  }
});

test('empty provider catalog still triggers a re-form', async t => {
  const { h, state, service } = await world(t);
  state.claudeModels = [];
  const result = await service.refreshRoutingInputs({ cwd: h.root });
  assert.equal(result.reformError, undefined);
  const entries = (await readTeamReform(h.home, h.root)).entries;
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].reasons.map(({ kind, provider }) => [kind, provider]), [['provider_lost', 'claude']]);
});
