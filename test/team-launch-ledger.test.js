import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture, tree } from './team-route-fixture.test.js';

const ledgerPath = f => join(dirname(f.path), 'launch-ledger.jsonl');
const record = (f, agent = 'team-builder-codex') => spawnSync(process.execPath, [
  resolve('bin/kairo.js'), 'team', 'record-launch', '--agent', agent,
  '--adapter', 'codex', '--model', 'gpt-a', '--cwd', f.cwd,
], { env: { ...process.env, HARNESS_HOME: f.home }, encoding: 'utf8' });
async function setup(t) {
  const f = await fixture(t);
  await mkdir(join(f.cwd, '.kairo'));
  await writeFile(join(f.cwd, '.kairo', 'roles.json'), JSON.stringify({ roles: [
    { id: 'Builder', agents: [{ name: 'team-builder-codex', adapterId: 'codex' }] },
  ] }));
  return f;
}

test('record-launch appends one JSON line, retains recent work and prunes records older than eight days', async t => {
  const f = await setup(t);
  const recent = { at: new Date().toISOString(), role: 'Builder', agent: 'team-builder-codex', adapterId: 'codex', modelId: 'gpt-a', source: 'launch' };
  await writeFile(ledgerPath(f), [ { ...recent, at: new Date(Date.now() - 9 * 86400000).toISOString() }, recent ].map(JSON.stringify).join('\n') + '\n');
  const result = record(f);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const text = await readFile(ledgerPath(f), 'utf8');
  assert.ok(text.endsWith('\n'));
  const rows = text.trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], recent);
  assert.deepEqual({ ...rows[1], at: recent.at }, recent);
  assert.ok(Math.abs(Date.now() - Date.parse(rows[1].at)) < 5000);
  assert.equal(record(f).status, 0);
  assert.equal((await readFile(ledgerPath(f), 'utf8')).trim().split('\n').length, 3);
});

test('unknown agent exits nonzero, explains error and writes nothing', async t => {
  const f = await setup(t);
  const before = await tree(f.home);
  const result = record(f, 'missing-agent');
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /Unknown agent.*missing-agent/);
  assert.deepEqual(await tree(f.home), before);
});

test('recorded launches shift route toward under-served model without route writes', async t => {
  const f = await setup(t);
  await f.cache();
  assert.equal(JSON.parse(f.cli('--role', 'Builder').stdout).provider, 'codex');
  assert.equal(record(f).status, 0);
  const before = await tree(f.home);
  const result = f.cli('--role', 'Builder');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).provider, 'claude');
  assert.deepEqual(await tree(f.home), before);
});

test('readTeamRoute merges run and launch work and scopes launches by role', async t => {
  const f = await setup(t);
  await f.cache();
  const { createRunRecord } = await import('../src/global/runtime/run-store.js');
  await createRunRecord(f.home, { runId: 'run_launch_merge', cwd: f.cwd, role: 'Builder', agentId: 'claude', model: 'son-a', state: 'completed', startedAt: new Date().toISOString() });
  const { readTeamRoute } = await import('../src/global/team/routing-input-cache.js');
  assert.equal((await readTeamRoute({ homeDir: f.home, cwd: f.cwd, role: 'Builder' })).provider, 'codex');
  assert.equal(record(f).status, 0);
  assert.equal(record(f).status, 0);
  const before = await tree(f.home);
  assert.equal((await readTeamRoute({ homeDir: f.home, cwd: f.cwd, role: 'Builder' })).provider, 'claude');
  assert.deepEqual(await tree(f.home), before);
});

test('help advertises record-launch required flags', async t => {
  const f = await fixture(t);
  assert.match(f.cli('--help').stdout, /team record-launch --agent NAME --adapter ID --model ID/);
});

test('T3 service merges launch records with run-store work', async t => {
  const f = await setup(t);
  const { createConversationService } = await import('../src/global/team/service.js');
  // S3: II stays under the frozen frontier cutoff (54.5) so the Builder labor seat is eligible; coding/gpqa/hle carry the level.
  const models = f.inputs.models.map((m, i) => ({ ...m, intelligenceIndex: 50, codingIndex: 100 - i * 5, gpqa: (100 - i * 5) / 100, hle: (100 - i * 5) / 100, priceInputPerMTok: 1, priceOutputPerMTok: 1 }));
  const strategy = { ...f.strategy, roleCapabilities: { Builder: { required: ['reasoning'] } } };
  const service = createConversationService({ homeDir: f.home, resolveRoot: async () => f.cwd,
    readProjectStrategy: async () => strategy, listRunRecords: async () => [
      { cwd: f.cwd, role: 'Builder', agentId: 'claude', model: 'son-a', state: 'completed', startedAt: new Date().toISOString() }
    ] });
  service.snapshot = async () => ({ modelIntelligence: { eligibility: f.inputs.eligibility, scoredAll: models, providerCapacity: f.inputs.providerCapacity } });
  assert.equal((await service.routeProjectExecution('Builder', f.cwd)).provider, 'codex');
  assert.equal(record(f).status, 0);
  assert.equal(record(f).status, 0);
  assert.equal((await service.routeProjectExecution('Builder', f.cwd)).provider, 'claude');
});

test('parallel appends preserve every launch while pruning', async t => {
  const f = await setup(t);
  const { appendLaunchRecord } = await import('../src/global/team/launch-ledger.js');
  const row = { role: 'Builder', agent: 'team-builder-codex', adapterId: 'codex', modelId: 'gpt-a' };
  await writeFile(ledgerPath(f), JSON.stringify({ ...row, at: '2000-01-01T00:00:00Z', source: 'launch' }) + '\n');
  await Promise.all(Array.from({ length: 12 }, () => appendLaunchRecord(f.home, f.cwd, row)));
  const lines = (await readFile(ledgerPath(f), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(lines.length, 12);
  assert.ok(lines.every(r => r.source === 'launch' && Date.parse(r.at) > Date.now() - 5000));
});

test('a lock left by a crashed writer is recovered instead of blocking every later launch', async () => {
  const { mkdtemp, utimes } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { appendLaunchRecord, launchLedgerPath } = await import('../src/global/team/launch-ledger.js');
  const homeDir = await mkdtemp(join(tmpdir(), 'kairo-ledger-home-'));
  const projectRoot = await mkdtemp(join(tmpdir(), 'kairo-ledger-project-'));
  const path = launchLedgerPath(homeDir, projectRoot);
  await mkdir(path + '.lock', { recursive: true });
  const old = new Date(Date.now() - 120000);
  await utimes(path + '.lock', old, old);
  const row = await appendLaunchRecord(homeDir, projectRoot, { role: 'Builder', agent: 'team-builder', adapterId: 'claude', modelId: 'sonnet' });
  assert.equal(row.agent, 'team-builder');
  assert.match(await readFile(path, 'utf8'), /"agent":"team-builder"/);
});

const HAIKU_45 = 'claude-haiku-4-5-20251001';
async function claudeSetup(t) {
  const f = await fixture(t);
  await mkdir(join(f.cwd, '.kairo'));
  await writeFile(join(f.cwd, '.kairo', 'roles.json'), JSON.stringify({ roles: [{ id: 'Explorer', agents: [{ name: 'team-explorer', adapterId: 'claude' }] }] }));
  return f;
}
const cliTeam = (f, ...flags) => spawnSync(process.execPath, [resolve('bin/kairo.js'), 'team', ...flags, '--cwd', f.cwd], { env: { ...process.env, HARNESS_HOME: f.home }, encoding: 'utf8' });
const lastRow = async f => (await readFile(ledgerPath(f), 'utf8')).trim().split('\n').map(JSON.parse).at(-1);

test('record-launch with identity tracking keeps modelId as the request and marks the launch unverified', async t => {
  const f = await claudeSetup(t);
  const ran = cliTeam(f, 'record-launch', '--agent', 'team-explorer', '--adapter', 'claude', '--model', HAIKU_45, '--dispatched-alias', 'haiku', '--track-identity');
  assert.equal(ran.status, 0, ran.stderr || ran.stdout); assert.equal(ran.stdout, '');
  const row = await lastRow(f);
  assert.deepEqual([row.source, row.modelId, row.requestedModelId, row.dispatchedModelAlias, row.identityStatus], ['launch', HAIKU_45, HAIKU_45, 'haiku', 'unverified']);
  assert.equal('observedModelId' in row, false);
});

test('record-outcome keeps the requested and the observed model apart', async t => {
  const f = await claudeSetup(t);
  const ran = cliTeam(f, 'record-outcome', '--agent', 'team-explorer', '--adapter', 'claude', '--model', HAIKU_45, '--status', 'completed', '--dispatched-alias', 'haiku', '--observed-model', 'claude-haiku-5-5,claude-haiku-5-5');
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  const row = await lastRow(f);
  assert.deepEqual([row.modelId, row.requestedModelId, row.dispatchedModelAlias, row.observedModelId, row.identityStatus], [HAIKU_45, HAIKU_45, 'haiku', 'claude-haiku-5-5', 'mismatch']);
});

test('record-outcome with tracking but no observation stays unverified', async t => {
  const f = await claudeSetup(t);
  assert.equal(cliTeam(f, 'record-outcome', '--agent', 'team-explorer', '--adapter', 'claude', '--model', HAIKU_45, '--status', 'completed', '--track-identity').status, 0);
  const row = await lastRow(f);
  assert.deepEqual([row.identityStatus, 'observedModelId' in row], ['unverified', false]);
});

test('record-launch and record-outcome without identity options write the exact legacy rows', async t => {
  const f = await claudeSetup(t);
  assert.equal(cliTeam(f, 'record-launch', '--agent', 'team-explorer', '--adapter', 'claude', '--model', 'haiku').status, 0);
  assert.deepEqual(Object.keys(await lastRow(f)).sort(), ['adapterId', 'agent', 'at', 'modelId', 'role', 'source']);
  assert.equal(cliTeam(f, 'record-outcome', '--agent', 'team-explorer', '--adapter', 'claude', '--model', 'haiku', '--status', 'failed').status, 0);
  assert.deepEqual(Object.keys(await lastRow(f)).sort(), ['adapterId', 'agent', 'at', 'modelId', 'role', 'source', 'status']);
});

test('identity rows never change distribution or running pairing', async t => {
  const f = await claudeSetup(t);
  const { readModelDistribution, readRunningLaunches } = await import('../src/global/team/launch-ledger.js');
  assert.equal(cliTeam(f, 'record-launch', '--agent', 'team-explorer', '--adapter', 'claude', '--model', HAIKU_45, '--dispatched-alias', 'haiku', '--track-identity').status, 0);
  assert.equal((await readRunningLaunches(f.home, f.cwd)).running.length, 1);
  assert.equal(cliTeam(f, 'record-outcome', '--agent', 'team-explorer', '--adapter', 'claude', '--model', HAIKU_45, '--status', 'completed', '--observed-model', 'claude-haiku-5-5', '--dispatched-alias', 'haiku').status, 0);
  assert.equal((await readRunningLaunches(f.home, f.cwd)).running.length, 0);
  assert.deepEqual((await readModelDistribution(f.home, f.cwd)).last7Days, [{ modelId: HAIKU_45, adapterId: 'claude', launches: 1 }]);
});
