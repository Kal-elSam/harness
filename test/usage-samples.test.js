import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOUR = 3600000;
const now = Date.parse('2026-10-22T12:00:00Z');
const usage = (at = now) => ({ status: 'measured', primary: { name: '5h', remainingPercent: 18, resetsAt: (at + HOUR) / 1000 }, secondary: { name: 'weekly', remainingPercent: 87, resetsAt: (at + 100 * HOUR) / 1000 } });
async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'kairo-samples-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}

test('sample store appends both normalized windows and isolates providers', async t => {
  const { appendUsageSamples, readUsageSamples, usageSamplesPath } = await import('../src/global/observability/usage-samples.js');
  const home = await fixture(t);
  await appendUsageSamples(home, 'codex', usage(), { now: () => now });
  const first = await readFile(usageSamplesPath(home, 'codex'), 'utf8');
  await appendUsageSamples(home, 'codex', usage(), { now: () => now + 1000 });
  assert.ok((await readFile(usageSamplesPath(home, 'codex'), 'utf8')).startsWith(first));
  const rows = await readUsageSamples(home, 'codex', { now: () => now + 1000 });
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], { provider: 'codex', window: '5h', remainingPercent: 18, resetsAt: now + HOUR, timestamp: now });
  assert.deepEqual(await readUsageSamples(home, 'claude', { now: () => now }), []);
});

test('store prunes after eight days, recovers stale locks and serializes concurrent appends', async t => {
  const { appendUsageSamples, readUsageSamples, usageSamplesPath } = await import('../src/global/observability/usage-samples.js');
  const home = await fixture(t);
  await appendUsageSamples(home, 'codex', usage(now - 9 * 24 * HOUR), { now: () => now - 9 * 24 * HOUR });
  const lock = usageSamplesPath(home, 'codex') + '.lock';
  await mkdir(lock);
  await utimes(lock, new Date(now - 60000), new Date(now - 60000));
  await Promise.all(Array.from({ length: 5 }, () => appendUsageSamples(home, 'codex', usage(), { now: () => now })));
  const rows = await readUsageSamples(home, 'codex', { now: () => now });
  assert.equal(rows.length, 10);
  assert.equal((await readFile(usageSamplesPath(home, 'codex'), 'utf8')).trim().split('\n').length, 10);
});

test('store ignores unknown readings and model-only weekly limits; rejects path traversal', async t => {
  const { appendUsageSamples, readUsageSamples } = await import('../src/global/observability/usage-samples.js');
  const home = await fixture(t);
  await appendUsageSamples(home, 'claude', { windows: [
    { label: 'Current session', remainingPercent: 80, resetsAt: (now + HOUR) / 1000 },
    { label: 'Current week (all models)', remainingPercent: 17, resetsAt: (now + 100 * HOUR) / 1000 },
    { label: 'Current week (Sonnet only)', remainingPercent: 1, resetsAt: (now + 100 * HOUR) / 1000 }
  ] }, { now: () => now });
  await appendUsageSamples(home, 'claude', { status: 'unknown' }, { now: () => now });
  assert.equal((await readUsageSamples(home, 'claude', { now: () => now })).length, 2);
  await assert.rejects(appendUsageSamples(home, '../outside', usage(), { now: () => now }));
});

test('fresh service refresh records observations; cached polls do not; storage failures stay fail-open', async t => {
  const { readUsageSamples } = await import('../src/global/observability/usage-samples.js');
  const { createConversationService } = await import('../src/global/team/service.js');
  const home = await fixture(t);
  let clock = now;
  let reads = 0;
  const unknown = async () => ({ status: 'unknown', models: [], entries: [] });
  const service = createConversationService({
    homeDir: home, now: () => clock, resolveRoot: async () => home,
    enableProviderProbes: true, codexUsageTtlMs: 1000,
    listPlans: async () => [], listRunRecords: async () => [], recoverRuns: async () => {},
    inspectExecutionAdapters: () => [], inspectEngramIntegration: () => ({ status: 'unavailable' }),
    readCodexUsage: async () => { reads++; return usage(clock); }, readClaudeUsage: unknown,
    readCodexModels: unknown, readClaudeModels: unknown, readOpenCodeModels: unknown, readCursorModels: unknown,
    readArtificialAnalysisModels: unknown, readHuggingFaceLeaderboard: unknown,
    readGentleContext: async () => null, verifyClaudeSubscriptionAuth: unknown
  });
  await service.snapshot({ cwd: home });
  await service.snapshot({ cwd: home });
  assert.equal(reads, 1);
  assert.equal((await readUsageSamples(home, 'codex', { now: () => clock })).length, 2);
  clock += 1001;
  await service.snapshot({ cwd: home });
  assert.equal(reads, 2);
  assert.equal((await readUsageSamples(home, 'codex', { now: () => clock })).length, 4);
  // Replace the cache directory with a file: persistence must not break fresh usage.
  await rm(join(home, '.harness', 'sessions', 'usage-samples'), { recursive: true });
  await writeFile(join(home, '.harness', 'sessions', 'usage-samples'), 'unwritable cache');
  clock += 1001;
  const snapshot = await service.snapshot({ cwd: home });
  assert.equal(snapshot.usage.codex.primary.remainingPercent, 18);
});

test('out-of-order append acquisition cannot prune a newer observation', async t => {
  const { appendUsageSamples, readUsageSamples } = await import('../src/global/observability/usage-samples.js');
  const home = await fixture(t);
  await appendUsageSamples(home, 'codex', usage(now + 1000), { now: () => now + 1000 });
  await appendUsageSamples(home, 'codex', usage(now), { now: () => now });
  assert.equal((await readUsageSamples(home, 'codex', { now: () => now + 1000 })).length, 4);
});
