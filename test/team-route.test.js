import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fixture, tree } from './team-route-fixture.test.js';
import { resolveProjectRoute } from '../src/global/team/project-router.js';
import { createConversationService } from '../src/global/team/service.js';

for (const mode of ['fresh', 'pressured']) test(`CLI ${mode} cache equals T3 and writes nothing`, async t => {
  const f = await fixture(t);
  if (mode === 'pressured') f.inputs.providerCapacity.codex.quotaPaceFactor = 0.3;
  await f.cache();
  const before = await tree(f.home);
  const started = performance.now();
  const result = f.cli('--role', 'Builder');
  t.diagnostic(`route call ${ (performance.now() - started).toFixed(2) } ms`);
  assert.equal(result.status, 0, result.stderr);
  const actual = JSON.parse(result.stdout);
  const expected = resolveProjectRoute({ role: 'Builder', strategy: f.strategy, ...f.inputs, pool: f.inputs.roles.Builder.pool, ledger: [], capacity: f.inputs.providerCapacity, now: Date.now() });
  assert.deepEqual(actual, { ...expected, agentName: 'team-builder-' + expected.provider });
  assert.deepEqual(await tree(f.home), before);
});
for (const mode of ['missing', 'old', 'approval', 'invalid']) test(`CLI ${mode} cache returns approved STALE without writes`, async t => {
  const f = await fixture(t);
  if (mode !== 'missing') await f.cache(mode === 'old' ? { generatedAt: Date.now() - 31 * 60000 } : mode === 'approval' ? { approvedAt: 'different' } : { generatedAt: 'bad' });
  const before = await tree(f.home);
  const result = f.cli('--role', 'Builder');
  assert.equal(result.status, 0, result.stderr);
  const route = JSON.parse(result.stdout);
  assert.equal(route.decision, 'STALE');
  assert.deepEqual(route.model, f.model);
  assert.match(route.why, /kairo team route --refresh/);
  assert.deepEqual(await tree(f.home), before);
});
test('CLI unknown role and no approved team fail as JSON', async t => {
  const f = await fixture(t);
  for (const role of ['Unknown', 'Builder']) {
    if (role === 'Builder') {
      const { writeProjectStrategy } = await import('../src/global/team/project-strategy-store.js');
      await writeProjectStrategy(f.home, f.cwd, { ...f.strategy, status: 'suggested' });
    }
    const r = f.cli('--role', role);
    assert.notEqual(r.status, 0);
    assert.match(JSON.parse(r.stdout).message, role === 'Unknown' ? /unknown role/i : /approved team/i);
  }
});
test('refresh public CLI path uses snapshot and atomically publishes cache', async t => {
  const f = await fixture(t);
  const service = createConversationService({ homeDir: f.home, resolveRoot: async () => f.cwd, enableProviderProbes: true,
    listPlans: async () => [], recoverRuns: async () => {}, listRunRecords: async () => [],
    inspectExecutionAdapters: () => [], inspectEngramIntegration: () => ({}),
    readCodexUsage: async () => null, readClaudeUsage: async () => null, readOpenCodeUsage: async () => null,
    readCodexModels: async () => ({ models: [] }), readOpenCodeModels: async () => ({ models: [] }), readClaudeModels: () => ({ models: [] }), readCursorModels: async () => ({ models: [] }),
    readArtificialAnalysisModels: async () => ({ models: [] }), readClaudeEntitlementCache: async () => null,
    verifyClaudeSubscriptionAuth: async () => null, readCursorAccessCache: async () => null,
    readHuggingFaceLeaderboard: async () => ({ entries: [] }), readAgentSessionTelemetry: async () => null });
  const { runTeamRouteCli } = await import('../src/global/team/routing-input-cache.js');
  const outputs = [];
  await runTeamRouteCli({ cwd: f.cwd, refresh: true, json: true }, { homeDir: f.home, service, log: text => outputs.push(text) });
  const doc = JSON.parse(await readFile(f.path, 'utf8'));
  assert.equal(doc.approvedAt, f.strategy.approvedAt);
  assert.ok(Date.now() - doc.generatedAt < 5000);
  assert.ok(Array.isArray(doc.roles.Builder.pool));
  assert.deepEqual((await readdir(dirname(f.path))).sort(), ['project-strategy.json', 'routing-input-cache.json']);
  assert.equal(JSON.parse(outputs[0]).refreshed, true);
  // A second snapshot also maintains the cache through normal use.
  await service.snapshot({ cwd: f.cwd });
  assert.ok(JSON.parse(await readFile(f.path, 'utf8')).generatedAt >= doc.generatedAt);
});
test('help advertises role, cwd, json and explicit refresh', async t => {
  const f = await fixture(t);
  const r = f.cli('--help');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /team route.*--role.*--cwd.*--json/);
  assert.match(r.stdout, /team route --refresh/);
});
test('persistent cache round-trips capability registry evidence and atomic replacement', async t => {
  const f = await fixture(t);
  const { createCapabilityRegistry } = await import('../src/global/intelligence/model-capability-registry.js');
  const { writeRoutingInputCache, readTeamRoute } = await import('../src/global/team/routing-input-cache.js');
  const { writeAtomicText } = await import('../src/global/runtime/write-atomic-json.js');
  const { rename } = await import('node:fs/promises');
  const registry = createCapabilityRegistry();
  const id = registry.registerIdentity('codex', 'gpt-a');
  registry.addEvidence(id, { metric: 'codingIndex', value: 95, source: 'fixture', verified: true });
  await f.cache();
  const original = await readFile(f.path, 'utf8');
  let published = false;
  await writeRoutingInputCache(f.home, f.cwd, { ...f.inputs, registry }, {
    writeAtomicText: (path, text) => writeAtomicText(path, text, { rename: async (temp, target) => {
      assert.equal(await readFile(target, 'utf8'), original);
      const staged = JSON.parse(await readFile(temp, 'utf8'));
      assert.equal(staged.registry[0].evidence[0].source, 'fixture');
      await rename(temp, target);
      published = true;
    } })
  });
  assert.equal(published, true);
  const route = await readTeamRoute({ homeDir: f.home, cwd: f.cwd, role: 'Builder' });
  assert.equal(route.decision, 'ROUTED');
  assert.deepEqual((await readdir(dirname(f.path))).sort(), ['project-strategy.json', 'routing-input-cache.json']);
});
test('fresh CLI route uses live run-store ledger without recovering dead runs', async t => {
  const f = await fixture(t);
  await f.cache();
  const { createRunRecord, runRecordsToLedger } = await import('../src/global/runtime/run-store.js');
  const records = [{ runId: 'run_fixture', cwd: f.cwd, role: 'Builder', agentId: 'codex', model: 'gpt-a', state: 'running', pid: 99999999, startedAt: new Date().toISOString() }];
  await createRunRecord(f.home, records[0]);
  const before = await tree(f.home);
  const r = f.cli('--role', 'Builder');
  assert.equal(r.status, 0, r.stderr);
  const expected = resolveProjectRoute({ role: 'Builder', strategy: f.strategy, ...f.inputs, pool: f.inputs.roles.Builder.pool, ledger: runRecordsToLedger(records, { projectRoot: f.cwd, role: 'Builder' }), capacity: f.inputs.providerCapacity, now: Date.now() });
  assert.equal(expected.provider, 'claude');
  assert.deepEqual(JSON.parse(r.stdout), { ...expected, agentName: 'team-builder-claude' });
  assert.deepEqual(await tree(f.home), before);
});


for (const mode of ['objects', 'plain', 'stale']) test(`CLI agent resolves role with ${mode} without writes`, async t => {
  const f = await fixture(t);
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  await mkdir(join(f.cwd, '.kairo'));
  await writeFile(join(f.cwd, '.kairo', 'roles.json'), JSON.stringify({ roles: [{ id: 'Builder', agents: mode === 'plain' ? ['team-builder'] : [
    { name: 'team-builder', adapterId: 'claude' }, { name: 'team-builder-codex', adapterId: 'codex' }
  ] }] }));
  if (mode !== 'stale') await f.cache();
  const before = await tree(f.home);
  const result = f.cli('--agent', 'team-builder');
  assert.equal(result.status, 0, result.stderr);
  const route = JSON.parse(result.stdout);
  const normal = JSON.parse(f.cli('--role', 'Builder').stdout);
  assert.deepEqual(route, { ...normal, targetAgent: mode === 'plain' ? null : 'team-builder-codex', targetModel: normal.model.modelId });
  assert.equal(route.role, 'Builder');
  assert.equal(route.decision, mode === 'stale' ? 'STALE' : 'ROUTED');
  assert.deepEqual(await tree(f.home), before);
});

// kairo-router launched a Codex-host agent name ("explorer") inside Claude Code, where it does
// not exist; Sam's team-enforce hook then denied the launch.
test('claude-code host only gets a provider agent that exists as a Claude agent', async t => {
  const f = await fixture(t);
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  await mkdir(join(f.cwd, '.kairo'));
  await writeFile(join(f.cwd, '.kairo', 'roles.json'), JSON.stringify({ roles: [{ id: 'Builder', agents: [
    { name: 'team-builder', adapterId: 'claude' }, { name: 'builder', adapterId: 'codex' }
  ] }] }));
  await f.cache();
  const normal = JSON.parse(f.cli('--role', 'Builder').stdout);
  assert.equal(normal.provider, 'codex');
  const missing = JSON.parse(f.cli('--agent', 'team-builder', '--host', 'claude-code').stdout);
  assert.equal(missing.targetAgent, null);
  assert.equal(missing.targetModel, normal.model.modelId);
  await mkdir(join(f.home, '.claude', 'agents'), { recursive: true });
  await writeFile(join(f.home, '.claude', 'agents', 'builder.md'), '---\nname: builder\n---\n');
  assert.equal(JSON.parse(f.cli('--agent', 'team-builder', '--host', 'claude-code').stdout).targetAgent, 'builder');
  assert.equal(JSON.parse(f.cli('--agent', 'team-builder').stdout).targetAgent, 'builder');
  const { rm } = await import('node:fs/promises');
  await rm(join(f.home, '.claude', 'agents', 'builder.md'));
  await mkdir(join(f.cwd, '.claude', 'agents'), { recursive: true });
  await writeFile(join(f.cwd, '.claude', 'agents', 'builder.md'), '---\nname: builder\n---\n');
  assert.equal(JSON.parse(f.cli('--agent', 'team-builder', '--host', 'claude-code').stdout).targetAgent, 'builder');
});

test('CLI unknown agent returns a clear JSON error without writes', async t => {
  const f = await fixture(t);
  const before = await tree(f.home);
  const result = f.cli('--agent', 'missing-agent');
  assert.notEqual(result.status, 0);
  assert.equal(JSON.parse(result.stdout).code, 'unknown_agent');
  assert.match(JSON.parse(result.stdout).message, /Unknown agent.*missing-agent/);
  assert.deepEqual(await tree(f.home), before);
});

test('CLI joins launch history and quota samples, rejects heavy Codex and explains admitted Claude read-only', async t => {
  const f = await fixture(t);
  const { appendLaunchRecord } = await import('../src/global/team/launch-ledger.js');
  const { usageSamplesPath } = await import('../src/global/observability/usage-samples.js');
  const { mkdir, writeFile } = await import('node:fs/promises');
  const now = Date.now();
  const reset = now + 15 * 60000;
  f.inputs.roles.Builder.pool[1].utility = 1.99;
  for (const provider of ['codex', 'claude']) f.inputs.providerCapacity[provider] = {
    quotaRemainingPercent: provider === 'codex' ? 18 : 80,
    quotaWindows: [{ kind: '5h', remainingPercent: provider === 'codex' ? 18 : 80, resetsAt: reset },
      { kind: 'weekly', remainingPercent: 90, resetsAt: now + 86400000 }]
  };
  const samples = [];
  for (let i = 0; i < 3; i++) {
    const at = now - (10 - 2 * i) * 60000;
    await appendLaunchRecord(f.home, f.cwd, { role: 'Builder', adapterId: 'codex', modelId: 'gpt-a' }, { now: () => at });
    for (const [timestamp, remainingPercent] of [[at - 1000, 90], [at + 1000, 60]]) samples.push({ provider: 'codex', window: '5h', timestamp, remainingPercent, resetsAt: reset });
  }
  const path = usageSamplesPath(f.home, 'codex');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, samples.map(row => JSON.stringify(row)).join('\n'));
  await f.cache();
  const before = await tree(f.home);
  const result = f.cli('--role', 'Builder');
  assert.equal(result.status, 0, result.stderr);
  const route = JSON.parse(result.stdout);
  assert.equal(route.provider, 'claude');
  assert.equal(route.admission.candidates[0].cost.fiveHourPercent, 30);
  assert.equal(route.admission.candidates[0].cost.withoutHistory, false);
  assert.match(route.why, /5h.*18.*30/);
  assert.deepEqual(await tree(f.home), before);
});
test('other-role recorded launches prevent same-role cost attribution', async t => {
  const f = await fixture(t);
  const { appendLaunchRecord } = await import('../src/global/team/launch-ledger.js');
  const { usageSamplesPath } = await import('../src/global/observability/usage-samples.js');
  const { mkdir, writeFile } = await import('node:fs/promises');
  const now = Date.now();
  const reset = now + 15 * 60000;
  f.inputs.roles.Builder.pool[1].utility = 1.99;
  for (const provider of ['codex', 'claude']) f.inputs.providerCapacity[provider] = {
    quotaRemainingPercent: provider === 'codex' ? 18 : 80,
    quotaWindows: [{ kind: '5h', remainingPercent: provider === 'codex' ? 18 : 80, resetsAt: reset },
      { kind: 'weekly', remainingPercent: 90, resetsAt: now + 86400000 }]
  };
  const samples = [];
  for (let i = 0; i < 3; i++) {
    const at = now - (10 - 2 * i) * 60000;
    await appendLaunchRecord(f.home, f.cwd, { role: 'Builder', adapterId: 'codex', modelId: 'gpt-a' }, { now: () => at });
    await appendLaunchRecord(f.home, f.cwd, { role: 'Explorer', adapterId: 'codex', modelId: 'gpt-a' }, { now: () => at + 100 });
    for (const [timestamp, remainingPercent] of [[at - 1000, 90], [at + 1000, 60]]) samples.push({ provider: 'codex', window: '5h', timestamp, remainingPercent, resetsAt: reset });
  }
  const path = usageSamplesPath(f.home, 'codex');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, samples.map(row => JSON.stringify(row)).join('\n'));
  await f.cache();
  const before = await tree(f.home);
  const result = f.cli('--role', 'Builder');
  assert.equal(result.status, 0, result.stderr);
  const route = JSON.parse(result.stdout);
  assert.equal(route.provider, 'claude');
  assert.equal(route.admission.candidates[0].cost.fiveHourPercent, 30);
  assert.equal(route.admission.candidates[0].cost.withoutHistory, true);
  assert.match(route.why, /5h.*18.*30/);
  assert.deepEqual(await tree(f.home), before);
});
test('a cached pool from before price bands never routes a light role to a demanding model', async t => {
  const f = await fixture(t);
  const priced = (adapterId, modelId, input, output) => ({ adapterId, modelId, accessMode: 'automatic', utility: 1, priceInputPerMTok: input, priceOutputPerMTok: output });
  const opus = priced('claude', 'opus', 4, 20), haiku = priced('claude', 'haiku', .1, .5);
  const astra = priced('codex', 'astra', 10, 50), luna = priced('codex', 'luna', .1, .5);
  const { writeProjectStrategy } = await import('../src/global/team/project-strategy-store.js');
  await writeProjectStrategy(f.home, f.cwd, { ...f.strategy, projectTeam: [{ role: 'Test Runner', model: opus, assignmentSource: 'recommended' }] });
  await f.cache({ roles: { "Test Runner": { pool: [opus, haiku, astra, luna] } }, models: [opus, haiku, astra, luna] });
  const result = f.cli('--role', 'Test Runner');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(['haiku', 'luna'].includes(JSON.parse(result.stdout).model.modelId), result.stdout);
});
test('cached route uses the project catalog tier and stays in the role band', async t => {
  const f = await fixture(t);
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const priced = (adapterId, modelId, input, output) => ({ adapterId, modelId, accessMode: 'automatic', utility: 1, priceInputPerMTok: input, priceOutputPerMTok: output });
  const opus = priced('claude', 'opus', 4, 20), haiku = priced('claude', 'haiku', .1, .5);
  const astra = priced('codex', 'astra', 10, 50), luna = priced('codex', 'luna', .1, .5);
  const { writeProjectStrategy } = await import('../src/global/team/project-strategy-store.js');
  await writeProjectStrategy(f.home, f.cwd, { ...f.strategy, projectTeam: [{ role: 'Test Runner', model: haiku, assignmentSource: 'recommended' }] });
  await mkdir(join(f.cwd, '.kairo'), { recursive: true });
  await writeFile(join(f.cwd, '.kairo', 'roles.json'), JSON.stringify({ roles: [{ id: 'Test Runner', qualityFloor: 'demanding' }] }));
  await f.cache({ roles: { "Test Runner": { pool: [opus, haiku, astra, luna] } }, models: [opus, haiku, astra, luna] });
  const demanding = JSON.parse(f.cli('--role', 'Test Runner').stdout);
  // S1: Test Runner is a build role, so even a project-declared demanding quality floor never routes it into the demanding price band.
  assert.ok(['haiku', 'luna'].includes(demanding.model.modelId), JSON.stringify(demanding));
  assert.match(demanding.why, /demanding price band/);
  await writeFile(join(f.cwd, '.kairo', 'roles.json'), JSON.stringify({ roles: [] }));
  await f.cache({ roles: { "Test Runner": { pool: [opus, haiku, astra] } }, models: [opus, haiku, astra, luna] });
  // Codex has a light model (Luna) in the catalog: the band rules over the cached pool, so Codex routes to Luna and never escalates to Astra.
  const route = JSON.parse(f.cli('--role', 'Test Runner').stdout);
  assert.equal(route.model.modelId, 'haiku', JSON.stringify(route));
  assert.doesNotMatch(route.why, /demanding band/);
  assert.equal(JSON.parse(f.cli('--role', 'Test Runner', '--provider', 'codex').stdout).model.modelId, 'luna');
});
test('cached route states a nearest-band substitution only for a provider whose catalog has no model in the band', async t => {
  const f = await fixture(t);
  const priced = (adapterId, modelId, input, output) => ({ adapterId, modelId, accessMode: 'automatic', utility: 1, priceInputPerMTok: input, priceOutputPerMTok: output });
  const sonnet = priced('claude', 'sonnet', 2, 10), haiku = priced('claude', 'haiku', .1, .5), opus = priced('claude', 'opus', 4, 20);
  const astra = priced('codex', 'astra', 10, 50), luna = priced('codex', 'luna', .1, .5);
  const { writeProjectStrategy } = await import('../src/global/team/project-strategy-store.js');
  await writeProjectStrategy(f.home, f.cwd, { ...f.strategy, projectTeam: [{ role: 'Planner', model: sonnet, assignmentSource: 'recommended' }] });
  await f.cache({ roles: { Planner: { pool: [sonnet, astra] } }, models: [haiku, sonnet, opus, luna, astra] });
  const route = JSON.parse(f.cli('--role', 'Planner', '--provider', 'codex').stdout);
  // A missing standard band steps down to the provider's light band (Luna), never up to Astra (S6).
  assert.equal(route.model.modelId, 'luna');
  assert.match(route.why, /codex has no standard model; using its light band/);
  assert.doesNotMatch(route.why, /demanding band/);
});
