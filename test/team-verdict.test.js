import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { appendOutcomeRecord, launchLedgerPath, readOutcomeRecords } from '../src/global/team/launch-ledger.js';
import { buildRoleTelemetry } from '../src/global/intelligence/role-telemetry.js';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'verdict-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cwd = join(dir, 'project'), home = join(dir, 'home');
  await mkdir(join(cwd, '.kairo'), { recursive: true });
  await writeFile(join(cwd, '.kairo', 'roles.json'), JSON.stringify({ roles: [
    { id: 'Builder', agents: [{ name: 'task-builder', adapterId: 'codex' }] }
  ] }));
  assert.equal(spawnSync('git', ['init', '-q', cwd]).status, 0);
  const cli = (...flags) => spawnSync(process.execPath, [resolve('bin/kairo.js'), 'team', ...flags, '--cwd', cwd],
    { encoding: 'utf8', env: { ...process.env, HARNESS_HOME: home } });
  const now = Date.now();
  const outcome = (modelId = 'model-a', extra = {}) => appendOutcomeRecord(home, cwd,
    { role: 'Builder', agent: 'task-builder', adapterId: 'codex', modelId, status: 'completed', ...extra }, { now: () => now });
  const verdict = (...flags) => cli('verdict', '--agent', 'task-builder', ...flags);
  return { cwd, home, cli, outcome, verdict, path: launchLedgerPath(home, cwd), rows: () => readOutcomeRecords(home, cwd) };
}

test('verdict closes latest pending outcome without rewriting history', async t => {
  const f = await fixture(t);
  await f.outcome('older'); await f.outcome('newer');
  const before = await readFile(f.path, 'utf8');
  const ran = f.verdict('--result', 'pass', '--retry', '--json');
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.equal(JSON.parse(ran.stdout).result, 'pass');
  assert.ok((await readFile(f.path, 'utf8')).startsWith(before));
  assert.deepEqual((await f.rows()).map(r => [r.modelId, r.result, r.retry]), [['older', undefined, undefined], ['newer', 'pass', true]]);
});

test('second verdict moves to next older pending outcome even for identical old records', async t => {
  const f = await fixture(t);
  await f.outcome(); await f.outcome();
  assert.equal(f.verdict('--result=fail').status, 0);
  assert.equal(f.verdict('--result=pass').status, 0);
  assert.deepEqual((await f.rows()).map(r => r.result), ['pass', 'fail']);
});

for (const [name, flags, message] of [
  ['no pending outcome', ['--agent', 'task-builder', '--result', 'pass'], /no pending outcome/i],
  ['invalid result', ['--agent', 'task-builder', '--result', 'maybe'], /invalid --result/i],
  ['unknown agent', ['--agent', 'missing', '--result', 'pass'], /unknown agent/i],
]) test(`${name} errors without changing ledger`, async t => {
  const f = await fixture(t);
  await f.outcome('resolved', { result: 'pass' });
  const before = await readFile(f.path, 'utf8');
  const ran = f.cli('verdict', ...flags, '--json');
  assert.equal(ran.status, 1);
  assert.match(JSON.parse(ran.stdout).message, message);
  assert.equal(await readFile(f.path, 'utf8'), before);
});

test('telemetry counts verdict results exactly once', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 5; i++) { await f.outcome(); assert.equal(f.verdict('--result', i ? 'pass' : 'fail').status, 0); }
  const data = buildRoleTelemetry(await f.rows(), [{ adapterId: 'codex', modelId: 'model-a' }]).roles.Builder.get('codex::model-a');
  assert.equal(data.resultRuns, 5); assert.equal(data.successRate, 0.8);
});

test('--pending lists only unresolved outcomes with agent, model and finished time', async t => {
  const f = await fixture(t);
  await f.outcome('older'); await f.outcome('newer'); await f.outcome('already', { result: 'pass' });
  assert.equal(f.verdict('--result', 'fail').status, 0);
  const before = await readFile(f.path, 'utf8');
  const ran = f.cli('verdict', '--pending', '--json');
  assert.equal(ran.status, 0, ran.stdout);
  const rows = JSON.parse(ran.stdout);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].agent, 'task-builder'); assert.equal(rows[0].modelId, 'older'); assert.ok(Date.parse(rows[0].at));
  const table = f.cli('verdict', '--pending');
  assert.equal(table.status, 0); assert.match(table.stdout, /task-builder.*older/);
  assert.equal(await readFile(f.path, 'utf8'), before);
});

test('old record-outcome CLI remains unchanged and has no inferred result', async t => {
  const f = await fixture(t);
  const ran = f.cli('record-outcome', '--agent', 'task-builder', '--adapter', 'codex', '--model', 'model-a', '--status', 'completed');
  assert.equal(ran.status, 0, ran.stdout);
  assert.deepEqual(Object.keys((await f.rows())[0]).sort(), ['adapterId', 'agent', 'at', 'modelId', 'role', 'source', 'status']);
});

test('an exhausted outcome did no work: it never waits for a verdict and is never claimed', async t => {
  const f = await fixture(t);
  await f.outcome('worked'); await f.outcome('quota', { status: 'exhausted' });
  const pending = f.cli('verdict', '--pending', '--json');
  assert.deepEqual(JSON.parse(pending.stdout).map(r => r.modelId), ['worked']);
  assert.equal(f.verdict('--result', 'pass').status, 0);
  assert.deepEqual((await f.rows()).map(r => [r.modelId, r.result]), [['worked', 'pass'], ['quota', undefined]]);
});

test('verdict accepts an agent name that only the ledger knows when it has a pending outcome', async t => {
  const f = await fixture(t);
  await appendOutcomeRecord(f.home, f.cwd, { role: 'Builder', agent: 'kairo-codex', adapterId: 'codex', modelId: 'model-w', status: 'completed' });
  const ran = f.cli('verdict', '--agent', 'kairo-codex', '--result', 'pass', '--json');
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.deepEqual((await f.rows()).map(r => [r.agent, r.result]), [['kairo-codex', 'pass']]);
});
