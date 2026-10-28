import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendOutcomeRecord, readOutcomeRecords } from '../src/global/team/launch-ledger.js';
import { harnessHomePaths } from '../src/global/paths.js';

const roots = [];
test.after(() => Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))));

const entry = status => ({ status, reason: null, probedAt: '2026-10-28T10:00:00.000Z' });
async function world() {
  const home = await mkdtemp(join(tmpdir(), 'cursor-invalidate-'));
  roots.push(home);
  const cwd = join(home, 'project');
  await mkdir(cwd);
  execFileSync('git', ['init', '-q', cwd]);
  const cachePath = harnessHomePaths(home).cursorAccessPath;
  await mkdir(dirname(cachePath), { recursive: true });
  const doc = { fetchedAt: '2026-10-28T10:00:00.000Z', accountFingerprint: null,
    pools: { other_models: entry('available'), cursor_models: entry('available') } };
  await writeFile(cachePath, JSON.stringify(doc));
  return { home, cwd, cachePath };
}
const base = { role: 'Builder', agent: 'kairo-cursor', adapterId: 'cursor', modelId: 'gpt-5', status: 'exhausted', reason: 'usage limit' };
const pools = async path => Object.keys(JSON.parse(await readFile(path, 'utf8')).pools).sort();

test('exhausted cursor outcome for an other_models model invalidates only that pool', async () => {
  const w = await world();
  await appendOutcomeRecord(w.home, w.cwd, base);
  assert.deepEqual(await pools(w.cachePath), ['cursor_models']);
  assert.equal((await readOutcomeRecords(w.home, w.cwd)).length, 1);
});

test('exhausted cursor outcome for a composer model invalidates only cursor_models', async () => {
  const w = await world();
  await appendOutcomeRecord(w.home, w.cwd, { ...base, modelId: 'composer-2' });
  assert.deepEqual(await pools(w.cachePath), ['other_models']);
});

test('other adapters and non-exhausted statuses leave the cache bytes identical', async () => {
  const w = await world();
  const before = await readFile(w.cachePath, 'utf8');
  await appendOutcomeRecord(w.home, w.cwd, { ...base, adapterId: 'codex' });
  await appendOutcomeRecord(w.home, w.cwd, { ...base, status: 'failed' });
  await appendOutcomeRecord(w.home, w.cwd, { ...base, status: 'completed' });
  assert.equal(await readFile(w.cachePath, 'utf8'), before);
});

test('missing, unreadable or unwritable cache never breaks outcome recording', async () => {
  const w = await world();
  await rm(w.cachePath);
  await appendOutcomeRecord(w.home, w.cwd, base);
  await writeFile(w.cachePath, '{not json');
  await appendOutcomeRecord(w.home, w.cwd, base);
  await writeFile(w.cachePath, JSON.stringify({ fetchedAt: 'x', pools: { other_models: entry('available') } }));
  const row = await appendOutcomeRecord(w.home, w.cwd, base, {
    writeCursorAccessCache: async () => { throw new Error('disk full'); },
  });
  assert.equal(row.status, 'exhausted');
  assert.equal((await readOutcomeRecords(w.home, w.cwd)).length, 3);
});

test('kairo team record-outcome exhausted for cursor removes the pool entry', async () => {
  const w = await world();
  await mkdir(join(w.cwd, '.kairo'));
  await writeFile(join(w.cwd, '.kairo', 'roles.json'), JSON.stringify({ roles: [
    { id: 'Builder', agents: [{ name: 'kairo-cursor', adapterId: 'cursor' }] },
  ] }));
  const result = spawnSync(process.execPath, [resolve('bin/kairo.js'), 'team', 'record-outcome',
    '--agent', 'kairo-cursor', '--adapter', 'cursor', '--model', 'gpt-5', '--status', 'exhausted', '--cwd', w.cwd],
  { env: { ...process.env, HARNESS_HOME: w.home }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.deepEqual(await pools(w.cachePath), ['cursor_models']);
});
