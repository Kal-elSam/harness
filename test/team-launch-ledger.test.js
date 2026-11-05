import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from '../src/cli.js';
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
  const { taskId, taskIdStatus, executionId, ...legacy } = rows[1];
  assert.deepEqual({ ...legacy, at: recent.at }, recent);
  assert.deepEqual([taskId, taskIdStatus], [null, 'absent']);
  assert.match(executionId, /^[0-9a-f-]{36}$/);
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

test('record-launch and record-outcome without model identity options add only task observability columns', async t => {
  const f = await claudeSetup(t);
  assert.equal(cliTeam(f, 'record-launch', '--agent', 'team-explorer', '--adapter', 'claude', '--model', 'haiku').status, 0);
  assert.deepEqual(Object.keys(await lastRow(f)).sort(), ['adapterId', 'agent', 'at', 'executionId', 'modelId', 'role', 'source', 'taskId', 'taskIdStatus']);
  assert.equal(cliTeam(f, 'record-outcome', '--agent', 'team-explorer', '--adapter', 'claude', '--model', 'haiku', '--status', 'failed').status, 0);
  assert.deepEqual(Object.keys(await lastRow(f)).sort(), ['adapterId', 'agent', 'at', 'executionId', 'modelId', 'role', 'source', 'status', 'taskId', 'taskIdStatus']);
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

test('record-launch rejects --observed-model: nonzero exit, clear error, no row written', async t => {
  const f = await claudeSetup(t);
  assert.equal(cliTeam(f, 'record-launch', '--agent', 'team-explorer', '--adapter', 'claude', '--model', HAIKU_45, '--track-identity').status, 0);
  const before = await readFile(ledgerPath(f), 'utf8');
  const ran = cliTeam(f, 'record-launch', '--agent', 'team-explorer', '--adapter', 'claude', '--model', HAIKU_45, '--observed-model', 'claude-haiku-5-5');
  assert.notEqual(ran.status, 0);
  assert.match(ran.stderr + ran.stdout, /--observed-model is only valid with record-outcome/);
  assert.equal(await readFile(ledgerPath(f), 'utf8'), before);
});

test('C2/C3 task columns are additive, CLI failures stay non-blocking, and outcome keys ignore them', async t => {
  const f = await setup(t);
  const { identityTask } = await import('./task-identity.test.js');
  const { readLaunchLedger, readOutcomeRecords, readModelDistribution, readRunningLaunches } = await import('../src/global/team/launch-ledger.js');
  const { createHash } = await import('node:crypto');
  await identityTask(f.cwd);
  await mkdir(join(f.cwd, '.ai/tasks/unreadable'));
  const cli = (action, ...flags) => spawnSync(process.execPath, [resolve('bin/kairo.js'), 'team', action,
    '--agent', 'team-builder-codex', '--adapter', 'codex', '--model', 'gpt-a', '--cwd', f.cwd, ...flags],
  { env: { ...process.env, HARNESS_HOME: f.home }, encoding: 'utf8' });
  for (const flags of [[], ['--task-id', 'bad/id'], ['--task-id', 'missing'], ['--task-id', 'unreadable'], ['--task-id', 'task-1'], ['--task-id=task-1']]) {
    const result = cli('record-launch', ...flags, '--execution-id', 'bad/id');
    assert.equal(result.status, 0, result.stdout + result.stderr); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
  }
  const rows = (await readFile(ledgerPath(f), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(r => r.taskIdStatus), ['absent', 'invalid', 'not_found', 'unreadable', 'linked', 'linked']);
  assert.deepEqual(rows.map(r => r.taskId), [null, null, null, null, 'task-1', 'task-1']);
  assert.equal(new Set(rows.map(r => r.executionId)).size, 6);
  assert.ok(rows.every(r => /^[0-9a-f-]{36}$/.test(r.executionId)));
  const before = await readLaunchLedger(f.home, f.cwd, 'Builder');
  const distribution = await readModelDistribution(f.home, f.cwd);
  const now = Date.now();
  const running = await readRunningLaunches(f.home, f.cwd, { now: () => now });
  const strip = ({ taskId, taskIdStatus, executionId, ...rest }) => rest;
  await writeFile(ledgerPath(f), rows.map(r => JSON.stringify(strip(r))).join('\n') + '\n');
  assert.deepEqual(await readLaunchLedger(f.home, f.cwd, 'Builder'), before);
  assert.deepEqual(await readModelDistribution(f.home, f.cwd), distribution);
  assert.deepEqual(await readRunningLaunches(f.home, f.cwd, { now: () => now }), running);
  for (const execution of [[], ['--execution-id', 'bad/id'], ['--execution-id=execution-123']]) {
    const result = cli('record-outcome', '--status', 'completed', '--task-id', 'task-1', ...execution);
    assert.equal(result.status, 0, result.stdout + result.stderr); assert.equal(result.stdout, '');
  }
  const raw = (await readFile(ledgerPath(f), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(raw.slice(-3).map(r => r.executionId), [null, null, 'execution-123']);
  const outcomes = await readOutcomeRecords(f.home, f.cwd);
  const verdict = spawnSync(process.execPath, [resolve('bin/kairo.js'), 'team', 'verdict', '--agent', 'team-builder-codex', '--result', 'pass', '--cwd', f.cwd, '--json'], { env: { ...process.env, HARNESS_HOME: f.home }, encoding: 'utf8' });
  assert.equal(verdict.status, 0, verdict.stdout);
  assert.equal(JSON.parse(verdict.stdout).outcomeKey, createHash('sha256').update(JSON.stringify(strip(raw.at(-1)))).digest('hex') + ':0');
  assert.equal('taskId' in JSON.parse(verdict.stdout), false);
  await writeFile(ledgerPath(f), raw.map(r => JSON.stringify(strip(r))).join('\n') + '\n');
  assert.deepEqual(await readOutcomeRecords(f.home, f.cwd), outcomes);
});


test('record-launch treats a double-dash task marker as an invalid value with equals argv', async t => {
  const f = await setup(t);
  const args = ['team', 'record-launch', '--agent', 'team-builder-codex',
    '--adapter', 'codex', '--model', 'gpt-a', '--cwd', f.cwd];
  assert.equal(parseArgs([...args, '--task-id=--foo']).options.taskId, '--foo');
  assert.throws(() => parseArgs([...args, '--task-id', '--foo']), /Unknown option "--foo"/);
  const baseline = cliTeam(f, ...args.slice(1));
  const result = cliTeam(f, ...args.slice(1), '--task-id=--foo');
  assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
  assert.equal(result.status, baseline.status, result.stdout + result.stderr);
  assert.equal(result.stdout, baseline.stdout);
  assert.equal(result.stderr, baseline.stderr);
  const row = await lastRow(f);
  assert.equal(row.taskId, null);
  assert.equal(row.taskIdStatus, 'invalid');
});
