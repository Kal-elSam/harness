import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture, tree } from './team-route-fixture.test.js';
import { admit } from '../src/global/intelligence/task-admission.js';

const now = Date.parse('2026-10-22T12:00:00Z');
const reset = now + 900000;
async function setup(t) {
  const f = await fixture(t);
  await mkdir(join(f.cwd, '.kairo'));
  await writeFile(join(f.cwd, '.kairo', 'roles.json'), JSON.stringify({ roles: [
    { id: 'Builder', agents: [{ name: 'team-builder-codex', adapterId: 'codex' }] },
  ] }));
  return f;
}
function outcome(f, status, extra = []) {
  return spawnSync(process.execPath, [resolve('bin/kairo.js'), 'team', 'record-outcome',
    '--agent', 'team-builder-codex', '--adapter', 'codex', '--model', 'gpt-a',
    '--status', status, '--cwd', f.cwd, ...extra],
  { env: { ...process.env, HARNESS_HOME: f.home }, encoding: 'utf8' });
}
const record = { role: 'Builder', agent: 'team-builder-codex', adapterId: 'codex', modelId: 'gpt-a', status: 'exhausted', reason: 'usage limit' };

test('detector recognizes provider limits, Codex exit quota and wrapper fallback lines', async () => {
  const { detectExhaustion } = await import('../src/global/team/exhaustion.js');
  for (const [text, info, provider] of [
    ["You've hit your usage limit. Try again later.", { provider: 'codex', exitCode: 1 }, 'codex'],
    ["Claude usage limit reached; resets at 5pm", {}, 'claude'],
    ["Rate limit reached", { adapterId: 'claude' }, 'claude'],
    ['insufficient_quota', { adapterId: 'codex', exitCode: 1 }, 'codex'],
    ['You exceeded your current quota, please check your plan and billing details.', { provider: 'codex', exitCode: 1 }, 'codex'],
    ['fallback: Codex unavailable (usage limit); resume on Claude', {}, 'codex'],
  ]) {
    const result = detectExhaustion(text, info);
    assert.equal(result?.provider, provider, text);
    assert.ok(result.reason.length > 0);
  }
});
test('detector ignores normal success, generic failures and prose mentioning limits', async () => {
  const { detectExhaustion } = await import('../src/global/team/exhaustion.js');
  for (const text of ['Completed successfully.', 'SyntaxError: missing bracket', 'Add rate limit tests.', 'Add usage limit tests.', 'Discuss fallback: no runtime marker.', 'The quota calculation is correct.']) {
    assert.equal(detectExhaustion(text, { provider: 'codex', exitCode: 1 }), null, text);
  }
});
test('record-outcome validates status and appends outcome rows without launch double counting', async t => {
  const f = await setup(t);
  for (const status of ['completed', 'failed', 'exhausted']) {
    const result = outcome(f, status, ['--reason', 'provider usage limit']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
  const { launchLedgerPath, readLaunchLedger } = await import('../src/global/team/launch-ledger.js');
  const rows = (await readFile(launchLedgerPath(f.home, f.cwd), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(row => row.status), ['completed', 'failed', 'exhausted']);
  assert.ok(rows.every(row => row.source === 'outcome' && row.reason === 'provider usage limit'));
  assert.deepEqual(await readLaunchLedger(f.home, f.cwd, 'Builder'), []);
  const before = await tree(f.home);
  assert.notEqual(outcome(f, 'oops').status, 0);
  assert.deepEqual(await tree(f.home), before);
});
test('record-outcome rejects missing values and unknown agents without writes', async t => {
  const f = await setup(t);
  const before = await tree(f.home);
  const bad = outcome(f, 'exhausted', ['--reason']);
  assert.notEqual(bad.status, 0);
  assert.deepEqual(await tree(f.home), before);
  const unknown = outcome(f, 'exhausted', ['--agent', 'missing-agent']);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stdout + unknown.stderr, /Unknown agent/);
  assert.deepEqual(await tree(f.home), before);
});
test('exhaustion expiry uses latest current 5h sample; exact reset boundary clears marker read-only', async t => {
  const f = await setup(t);
  const { appendOutcomeRecord, readExhaustionMarkers } = await import('../src/global/team/launch-ledger.js');
  const { appendUsageSamples } = await import('../src/global/observability/usage-samples.js');
  await appendUsageSamples(f.home, 'codex', { windows: [
    { name: '5h', remainingPercent: 30, resetsAtIso: new Date(reset).toISOString() }
  ] }, { now: () => now - 60000 });
  const row = await appendOutcomeRecord(f.home, f.cwd, record, { now: () => now });
  assert.equal(Date.parse(row.expiresAt), reset);
  const before = await tree(f.home);
  assert.equal((await readExhaustionMarkers(f.home, f.cwd, { now: () => reset - 1 })).codex.expiresAt, reset);
  assert.deepEqual(await readExhaustionMarkers(f.home, f.cwd, { now: () => reset }), {});
  assert.deepEqual(await tree(f.home), before);
});
test('exhaustion falls back to cached 5h reset, then 30 minutes without valid evidence', async t => {
  const f = await setup(t);
  const { appendOutcomeRecord } = await import('../src/global/team/launch-ledger.js');
  await f.cache({ generatedAt: now, providerCapacity: { codex: { quotaWindows: [
    { kind: '5h', remainingPercent: 30, resetsAtIso: new Date(reset).toISOString() }
  ] } } });
  assert.equal(Date.parse((await appendOutcomeRecord(f.home, f.cwd, record, { now: () => now })).expiresAt), reset);
  await f.cache({ generatedAt: now, providerCapacity: {} });
  assert.equal(Date.parse((await appendOutcomeRecord(f.home, f.cwd, record, { now: () => now })).expiresAt), now + 1800000);
});
test('active exhaustion overrides apparently healthy admission until exact expiry', () => {
  const capacity = { exhaustion: { expiresAt: reset, reason: 'usage limit' }, quotaWindows: [
    { kind: '5h', remainingPercent: 100, resetsAtIso: new Date(now + 18000000).toISOString() },
    { kind: 'weekly', remainingPercent: 100, resetsAtIso: new Date(now + 86400000).toISOString() },
  ] };
  const args = { candidate: { adapterId: 'codex' }, cost: { fiveHourPercent: 10 }, capacity };
  const blocked = admit({ ...args, now });
  assert.equal(blocked.admitted, false);
  assert.equal(blocked.waitUntil, reset);
  assert.match(blocked.reason, /exhausted.*usage limit/i);
  assert.equal(admit({ ...args, now: reset }).admitted, true);
});
test('route excludes all exhausted provider models even without samples; no writes on route', async t => {
  const f = await setup(t);
  const { appendOutcomeRecord } = await import('../src/global/team/launch-ledger.js');
  const { readTeamRoute } = await import('../src/global/team/routing-input-cache.js');
  const healthy = { quotaWindows: [
    { kind: '5h', remainingPercent: 100, resetsAtIso: new Date(reset).toISOString() },
    { kind: 'weekly', remainingPercent: 100, resetsAtIso: new Date(now + 86400000).toISOString() },
  ] };
  const models = f.inputs.models.map(model => ({ ...model, utility: 1 }));
  await f.cache({ generatedAt: now, roles: { Builder: { pool: models } }, providerCapacity: { codex: healthy, claude: healthy } });
  await appendOutcomeRecord(f.home, f.cwd, record, { now: () => now });
  const before = await tree(f.home);
  const route = await readTeamRoute({ homeDir: f.home, cwd: f.cwd, role: 'Builder' }, { now: () => now });
  assert.equal(route.provider, 'claude');
  assert.equal(route.admission.candidates.find(row => row.provider === 'codex').admitted, false);
  assert.deepEqual(await tree(f.home), before);
});
test('single exhausted provider cannot route, and later completed outcome cannot clear marker', async t => {
  const f = await setup(t);
  const { appendOutcomeRecord } = await import('../src/global/team/launch-ledger.js');
  const { readTeamRoute } = await import('../src/global/team/routing-input-cache.js');
  await f.cache({ generatedAt: now, roles: { Builder: { pool: [f.model] } } });
  await appendOutcomeRecord(f.home, f.cwd, record, { now: () => now });
  await appendOutcomeRecord(f.home, f.cwd, { ...record, status: 'completed' }, { now: () => now + 1 });
  const before = await tree(f.home);
  const route = await readTeamRoute({ homeDir: f.home, cwd: f.cwd, role: 'Builder' }, { now: () => now + 2 });
  assert.equal(route.decision, 'WAIT_FOR_PROJECT_TEAM');
  assert.deepEqual(await tree(f.home), before);
});
test('help documents outcome statuses and optional reason', async t => {
  const f = await fixture(t);
  assert.match(f.cli('--help').stdout, /team record-outcome --agent NAME --adapter ID --model ID --status completed\|failed\|exhausted/);
  assert.match(f.cli('--help').stdout, /\[--reason TEXT\]/);
});

test('detector CLI shares pure classification with no home writes and validates exit code', async t => {
  const f = await fixture(t);
  const invoke = (...args) => spawnSync(process.execPath, [resolve('bin/kairo.js'), 'team', 'detect-exhaustion', ...args],
    { env: { ...process.env, HARNESS_HOME: f.home }, encoding: 'utf8' });
  const before = await tree(f.home);
  const result = invoke('--text', 'You have hit your usage limit.', '--adapter', 'codex', '--exit-code', '1');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).provider, 'codex');
  const clean = invoke('--text', 'Finished normally.', '--adapter', 'codex', '--exit-code', '0');
  assert.equal(clean.status, 0, clean.stderr);
  assert.equal(JSON.parse(clean.stdout), null);
  for (const args of [['--adapter', 'codex'], ['--text', 'Limit', '--exit-code', 'abc'], ['--text', 'Limit', '--exit-code', '']]) {
    assert.notEqual(invoke(...args).status, 0);
  }
  assert.deepEqual(await tree(f.home), before);
});

test('successful implementation summaries mentioning error codes are not exhaustion', async () => {
  const { detectExhaustion } = await import('../src/global/team/exhaustion.js');
  const text = 'Implemented handling for usage_limit_reached and rate_limit_exceeded errors. All tests pass.';
  assert.equal(detectExhaustion(text, { adapterId: 'codex', exitCode: 0 }), null);
  assert.equal(detectExhaustion(text, { adapterId: 'codex' }), null);
  assert.equal(detectExhaustion('Claude usage limit reached; resets at 5pm')?.provider, 'claude');
  assert.equal(detectExhaustion('Claude usage limit reached; resets at 5pm', { exitCode: 0 })?.provider, 'claude');
});
