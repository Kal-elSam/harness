import test from 'node:test';
import assert from 'node:assert/strict';
import { rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { harness, draftTeam } from './helpers/setup-harness.js';
import { createConversationService } from '../src/global/team/service.js';
import { readProjectStrategy, readTeamReform } from '../src/global/team/project-strategy-store.js';
import { activateCatalogRoles } from '../src/global/intelligence/role-registry.js';
import { harnessHomePaths } from '../src/global/paths.js';
import { projectKeyForPath } from '../src/global/next/project-key.js';
import { runTeamRouteCli } from '../src/global/team/routing-input-cache.js';

async function world(t, extraDeps = {}) {
  const state = { signals: {}, entitlement: 'allowed', auth: 'authenticated', calls: 0,
    codexCatalog: { status: 'measured', models: [{ id: 'codex-model' }] } };
  const profile = () => ({ projectName: 'repo', stack: ['Node.js'], architecture: { pattern: 'x' },
    quality: {}, hotspots: [], workflowCapabilities: [], risks: [], fingerprint: 'fp-1', signals: state.signals,
    roleRequirements: activateCatalogRoles([{ role: 'Explorer', capabilities: ['reasoning'], reason: '' }], { signals: state.signals }) });
  const h = await harness({ git: true, diskStrategy: true, serviceDeps: { enableProviderProbes: true, computeProjectProfile: async () => profile() } });
  t.after(async () => { await rm(h.root, { recursive: true, force: true }); await rm(h.home, { recursive: true, force: true }); });
  const evidence = { codex: { terminalBenchV2: 0.8, ifBench: 0.9, endToEndSeconds: 10 }, claude: { terminalBenchV2: 0.6, ifBench: 0.8, endToEndSeconds: 20 } };
  h.modelIntelligence.scoredAll = h.modelIntelligence.scoredAll.map(row => ({ ...row, ...evidence[row.adapterId] }));
  h.modelIntelligence.manualSelectionScoredPool = h.modelIntelligence.scoredAll;
  await draftTeam(h);
  await h.service.approveProjectStrategy({ cwd: h.root });
  const timestamp = new Date().toISOString();
  const service = createConversationService({ homeDir: h.home, resolveRoot: async () => h.root, enableProviderProbes: true,
    computeProjectProfile: async () => profile(), listPlans: async () => [], recoverRuns: async () => {}, listRunRecords: async () => [],
    inspectExecutionAdapters: () => ['claude', 'codex'].map(id => ({ id, available: true, launchable: true })),
    inspectEngramIntegration: () => ({}), readCodexUsage: async () => null, readClaudeUsage: async () => null,
    readOpenCodeUsage: async () => null, readCodexModels: async () => state.codexCatalog,
    readClaudeModels: () => ({ models: [{ id: 'claude-model' }] }), readOpenCodeModels: async () => ({ models: [] }),
    readCursorModels: async () => ({ models: [] }), readCursorAccessCache: async () => null,
    readArtificialAnalysisModels: async () => ({ models: [
      { slug: 'codex-model', name: 'Codex Model', intelligenceIndex: 50, gpqa: 0.9, hle: 0.9, codingIndex: 40, terminalBenchV2: 0.8 },
      { slug: 'claude-model', name: 'Claude Model', intelligenceIndex: 40, gpqa: 0.4, hle: 0.4, codingIndex: 90, terminalBenchV2: 0.6 }
    ] }),
    verifyClaudeSubscriptionAuth: async () => ({ mode: 'subscription', subscriptionType: 'pro' }),
    readClaudeEntitlementCache: async () => ({ fetchedAt: timestamp, subscriptionType: 'pro', models: {
      'claude-model': { status: state.entitlement, probedAt: timestamp }
    } }),
    readHuggingFaceLeaderboard: async () => ({ entries: [] }), readAgentSessionTelemetry: async () => null,
    ...extraDeps,
    providerStatus: async () => { state.calls++; return { providers: ['claude', 'codex'].map(providerId => ({ providerId,
      installation: { state: 'installed' }, authentication: { state: providerId === 'codex' ? state.auth : 'authenticated' } })) }; }
  });
  return { h, state, service };
}

test('typed logged-out status records not_authenticated on refresh', async t => {
  const { h, state, service } = await world(t);
  state.auth = 'unauthenticated';
  const result = await service.refreshRoutingInputs({ cwd: h.root });
  assert.equal(result.reformError, undefined);
  assert.equal(result.reform?.reasons.find(r => r.provider === 'codex')?.reason, 'not_authenticated');
  assert.equal(state.calls, 1);
  const strategy = await readProjectStrategy(h.home, h.root);
  for (const entry of strategy.projectTeam) {
    assert.notEqual(entry.model?.adapterId, 'codex', `${entry.role} assignment`);
    assert.equal(entry.pool.some(member => member.adapterId === 'codex'), false, `${entry.role} pool`);
  }
  const second = await service.refreshRoutingInputs({ cwd: h.root });
  assert.equal(second.reformError, undefined);
  assert.equal(second.reform ?? null, null);
  assert.equal((await readTeamReform(h.home, h.root)).entries.length, 1);
});

test('structural change persists re-form, announces once, and routes next role', async t => {
  const { h, state, service } = await world(t);
  state.signals.gitRemote = true;
  const result = await service.refreshRoutingInputs({ cwd: h.root });
  assert.equal(result.reformError, undefined);
  assert.ok(result.reform, 'refresh returns a re-form');
  const strategy = await readProjectStrategy(h.home, h.root);
  assert.equal(strategy.status, 'active');
  assert.ok(strategy.projectTeam.some(entry => entry.role === 'Deliverer'));
  const log = await readTeamReform(h.home, h.root);
  assert.equal(log.entries.length, 1);
  assert.deepEqual(log.entries[0], result.reform);
  assert.ok(log.entries[0].reasons.some(reason => reason.kind === 'role_activated' && reason.role === 'Deliverer'));
  const lines = [];
  const route = await runTeamRouteCli({ role: 'Deliverer', cwd: h.root }, { homeDir: h.home, log: line => lines.push(line) });
  assert.equal(route?.decision, 'ROUTED');
  assert.ok(route.provider);
  assert.equal(lines.filter(line => /re-formed/i.test(line)).length, 1);
  lines.length = 0;
  await runTeamRouteCli({ role: 'Deliverer', cwd: h.root }, { homeDir: h.home, log: line => lines.push(line) });
  assert.equal(lines.filter(line => /re-formed/i.test(line)).length, 0);
});

test('entitlement-only changes do not re-form', async t => {
  const { h, state, service } = await world(t);
  const before = await readProjectStrategy(h.home, h.root);
  for (const status of ['denied', 'allowed']) {
    state.entitlement = status;
    const result = await service.refreshRoutingInputs({ cwd: h.root });
    assert.equal(result.reformError, undefined);
    assert.equal(result.reform ?? null, null);
    assert.deepEqual(await readProjectStrategy(h.home, h.root), before);
    assert.deepEqual((await readTeamReform(h.home, h.root)).entries, []);
  }
});

test('old-format strategy stays byte-identical and never re-forms', async t => {
  const { h, state, service } = await world(t);
  const fixture = await readFile(new URL('./fixtures/strategy-old-format.json', import.meta.url), 'utf8');
  const path = join(harnessHomePaths(h.home).sessionsDir, projectKeyForPath(h.root), 'project-strategy.json');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, fixture);
  state.signals.gitRemote = true;
  const result = await service.refreshRoutingInputs({ cwd: h.root });
  assert.equal(result.reformError, undefined);
  assert.equal(result.reform ?? null, null);
  assert.equal(await readFile(path, 'utf8'), fixture);
  assert.deepEqual((await readTeamReform(h.home, h.root)).entries, []);
});

// A transient model/list failure (app-server timeout) once emptied the Codex catalog,
// re-formed the team as provider_lost codex catalog_unknown, and re-formed it back seconds later.
test('a transient Codex catalog failure keeps the last good catalog and does not re-form', async t => {
  const { h, state, service } = await world(t);
  assert.equal((await service.refreshRoutingInputs({ cwd: h.root })).reform ?? null, null);
  state.codexCatalog = { status: 'unknown', models: [], error: 'codex app-server timeout' };
  const result = await service.refreshRoutingInputs({ cwd: h.root });
  assert.equal(result.reformError, undefined);
  assert.equal(result.reform ?? null, null);
  assert.equal((await readTeamReform(h.home, h.root)).entries.length, 0);
  const strategy = await readProjectStrategy(h.home, h.root);
  assert.ok(strategy.projectTeam.some(entry => entry.model?.adapterId === 'codex'), 'codex stays assigned');
});

test('a Codex catalog failure without a recent good read still reports the provider lost', async t => {
  const { h, state, service } = await world(t);
  state.codexCatalog = { status: 'unknown', models: [], error: 'codex app-server timeout' };
  const result = await service.refreshRoutingInputs({ cwd: h.root });
  assert.equal(result.reform?.reasons.find(r => r.provider === 'codex')?.reason, 'catalog_unknown');
});

test('a last good Codex catalog older than a day no longer stands in for a failed read', async t => {
  const { h, state, service } = await world(t);
  await service.refreshRoutingInputs({ cwd: h.root });
  const path = harnessHomePaths(h.home).codexModelsLastGoodPath;
  const saved = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...saved, savedAt: Date.now() - 25 * 60 * 60_000 }));
  state.codexCatalog = { status: 'unknown', models: [], error: 'codex app-server timeout' };
  const result = await service.refreshRoutingInputs({ cwd: h.root });
  assert.equal(result.reform?.reasons.find(r => r.provider === 'codex')?.reason, 'catalog_unknown');
});

// S15 / risk item 2: the routing cache holds no evidence records and no account label (the evidence file is the only store).
test('routing-input-cache.json carries no evidence records, modelContext, error, artifact paths or account label', async t => {
  const { createRoleAptitudeEvidenceStore } = await import('../src/global/intelligence/role-aptitude-evidence.js');
  const { currentProbeForRole } = await import('../src/global/intelligence/role-aptitude-selection.js');
  const { routingInputCachePath } = await import('../src/global/team/routing-input-cache.js');
  const probe = currentProbeForRole('Explorer');
  const store = createRoleAptitudeEvidenceStore();
  store.recordAttempt({ adapterId: 'codex', modelId: 'codex-model', accountKey: 'user@example.com', role: 'Explorer', probeId: probe.probeId,
    probeVersion: probe.probeVersion, validatorId: probe.validatorId, validatorVersion: probe.validatorVersion, verdict: 'pass', origin: 'operational',
    executionKind: 'real-bridge', modelContext: 'auth-SECRET-123', error: 'boom /Users/x/secret', artifactRefs: ['/Users/x/artifact'] });
  const { h, service } = await world(t, { ownedEvidenceStore: store, ownedEvidenceAccountKey: 'user@example.com' });
  await service.refreshRoutingInputs({ cwd: h.root });
  const text = await readFile(routingInputCachePath(h.home, h.root), 'utf8');
  for (const leak of ['user@example.com', 'auth-SECRET-123', '/Users/x', 'ownedEvidence']) assert.ok(!text.includes(leak), leak);
});
