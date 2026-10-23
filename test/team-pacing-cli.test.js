import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs } from '../src/cli.js';
import { runTeamPacingCli, buildPacingSnapshot, chooseNextWriter, comparePacingAvailability } from '../src/global/team/pacing-cli.js';
import { paceQuotaWindows } from '../src/global/intelligence/quota-pacing.js';
import { writeCachedUsage } from '../src/global/host/workspace-cache.js';
import { launchLedgerPath } from '../src/global/team/launch-ledger.js';
import { dirname } from 'node:path';
const H = 3600000, now = Date.parse('2026-10-23T12:00:00Z');
const capacity = (left, hours = 2.5) => ({ quotaWindows: paceQuotaWindows({ primary: { name: '5h', remainingPercent: left, resetsAt: (now + hours * H) / 1000 } }, now) });
const provider = (tier, dead, exhaustion = null, projected = 0) => ({ tier, expectedDeadTimeMs: dead, windows: [{ exhaustionInMs: exhaustion, resetsInMs: 3 * H, projectedRemaining: projected }] });

test('pacing parser accepts the read-only command without changing plan parsing', () => {
  assert.equal(parseArgs(['team', 'pacing', '--json']).options.teamAction, 'pacing');
  assert.equal(parseArgs(['team', 'plan', '--json']).options.teamAction, 'plan');
});
test('every window exposes quota, reset, projection, tier and dead time; chooses less dead time', () => {
  const result = buildPacingSnapshot({ claude: capacity(10), codex: capacity(80) }, {}, [], now);
  assert.equal(result.nextWriter, 'team-builder-codex');
  const w = result.providers.claude.windows[0];
  assert.equal(w.remainingPercent, 10);
  assert.equal(w.resetsAt, new Date(now + 2.5 * H).toISOString());
  assert.ok(w.projectedRemaining < 0);
  assert.equal(w.tier, 'CRITICAL');
  assert.ok(w.expectedDeadTimeMs > 2 * H);
});
test('writer availability tie-breaks: severity, exhaustion, projection, seven-day launches', () => {
  const pick = (a, b, counts = {}) => chooseNextWriter({ claude: a, codex: b }, counts);
  assert.equal(pick(provider('CRITICAL', 0), provider('WATCH', 0)), 'team-builder-codex');
  assert.equal(pick(provider('WATCH', 0, H), provider('WATCH', 0, 2 * H)), 'team-builder-codex');
  assert.equal(pick(provider('WATCH', 0, null, .1), provider('WATCH', 0, null, .2)), 'team-builder-codex');
  assert.equal(pick(provider('WATCH', 0), provider('WATCH', 0), { claude: 2, codex: 1 }), 'team-builder-codex');
  assert.equal(pick(provider('WATCH', 0), provider('WATCH', 0)), 'team-builder');
  assert.equal(chooseNextWriter({ claude: { tier: null, windows: [] }, codex: { tier: null, windows: [] } }), null);
});
test('seven-day writer counts exclude future, old, read-only and outcome records', () => {
  const rows = [
    { source: 'launch', role: 'Builder', adapterId: 'claude', at: new Date(now - H).toISOString() },
    { source: 'launch', role: 'Builder', adapterId: 'codex', at: new Date(now + H).toISOString() },
    { source: 'launch', role: 'Builder', adapterId: 'codex', at: new Date(now - 8 * 24 * H).toISOString() },
    { source: 'launch', role: 'Explorer', adapterId: 'codex', at: new Date(now).toISOString() },
    { source: 'outcome', role: 'Builder', adapterId: 'codex', at: new Date(now).toISOString() },
  ];
  const result = buildPacingSnapshot({ claude: capacity(80), codex: capacity(80) }, {}, rows, now);
  assert.deepEqual(result.writerCounts, { claude: 1, codex: 0 });
  assert.equal(result.nextWriter, 'team-builder-codex');
});
async function tree(path) {
  return Promise.all((await readdir(path, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name)).map(async e => [e.name, e.isDirectory() ? await tree(join(path,e.name)) : await readFile(join(path,e.name), 'utf8')]));
}
test('public command reads cached account usage and project ledger without changing bytes or creating files', async t => {
  const home = await mkdtemp(join(tmpdir(), 'kairo-pacing-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const root = join(home, 'project'); await mkdir(root);
  await writeCachedUsage(home, { usage: { claude: { primary: { name: '5h', remainingPercent: 10, resetsAt: (now + 2.5 * H) / 1000 } }, codex: { primary: { name: '5h', remainingPercent: 80, resetsAt: (now + 2.5 * H) / 1000 } } } }, { now: () => now });
  const ledger = launchLedgerPath(home, root); await mkdir(dirname(ledger), { recursive: true });
  await writeFile(ledger, JSON.stringify({ source: 'launch', role: 'Builder', adapterId: 'claude', at: new Date(now).toISOString() }) + '\n');
  const before = await tree(home), output = [];
  const deps = { homeDir: home, resolveRoot: async () => root, now: () => now, log: s => output.push(s) };
  const result = await runTeamPacingCli({ cwd: root, json: true }, deps);
  assert.equal(JSON.parse(output.pop()).nextWriter, 'team-builder-codex');
  assert.equal(result.writerCounts.claude, 1);
  await runTeamPacingCli({ cwd: root }, deps);
  assert.match(output.pop(), /claude: .*resets .*unused .*\ncodex: .*resets /);
  assert.deepEqual(await tree(home), before);
});
test('missing and stale usage stays unknown rather than fabricated HEALTHY', async () => {
  for (const cached of [null, { savedAt: now - H, value: { usage: {} } }]) {
    const result = await runTeamPacingCli({ json: true }, { resolveRoot: async () => '/project', homeDir: '/nonexistent', now: () => now, readCachedUsage: async () => cached, readRoutingInputCache: async () => null, service: { refreshRoutingInputs: async () => { throw new Error('offline'); } }, readUsageSamples: async () => [], readLedger: async () => [], log: () => {} });
    assert.equal(result.providers.claude.tier, null);
    assert.equal(result.nextWriter, null);
  }
});


test('CLI writer selection matches the same frozen reference fixtures exercised by plugin parity', async () => {
  const source = await readFile(new URL('../integrations/claude-code/kairo-router/hooks/parity.test.ts', import.meta.url), 'utf8');
  const fixtures = JSON.parse(source.match(/\/\* writer-choice-fixtures:start \*\/([\s\S]*?)\/\* writer-choice-fixtures:end \*\//)[1]);
  const status = ([tier, expectedDeadTimeMs, exhaustionInMs, projectedRemaining]) => ({ tier, expectedDeadTimeMs, windows: [{ resetsInMs: 1000, exhaustionInMs, projectedRemaining }] });
  for (const f of fixtures) {
    const providers = { claude: status(f.claude), codex: status(f.codex) };
    assert.equal(comparePacingAvailability(providers.claude, providers.codex), f.preferred);
    assert.equal(chooseNextWriter(providers, f.counts), f.writer);
  }
});

// Correction batch: exercise the public pacing and routing entry points.
test('pacing refreshes missing or expired routing inputs and consumes real refreshed windows', async () => {
  const { ROUTING_INPUT_CACHE_SCHEMA } = await import('../src/global/team/routing-input-cache.js');
  for (const initial of [null, { generatedAt: now - H }]) {
    let cached = initial, refreshes = 0;
    const deps = { homeDir: '/unused', resolveRoot: async () => '/project', now: () => now,
      readCachedUsage: async () => null, readRoutingInputCache: async () => cached,
      service: { refreshRoutingInputs: async ({ cwd }) => {
        assert.equal(cwd, '/project'); refreshes++;
        cached = { schema: ROUTING_INPUT_CACHE_SCHEMA, generatedAt: now, providerCapacity: { claude: capacity(21), codex: capacity(80) } };
      } }, readUsageSamples: async () => [], readLedger: async () => [], log: () => {} };
    const result = await runTeamPacingCli({ cwd: '/project', json: true }, deps);
    assert.equal(refreshes, 1);
    assert.equal(result.providers.claude.windows[0]?.remainingPercent, 21);
    assert.equal(result.providers.codex.windows[0]?.remainingPercent, 80);
    await runTeamPacingCli({ cwd: '/project', json: true }, deps);
    assert.equal(refreshes, 1, 'fresh cache does not probe again');
  }
});
test('plain pacing uses local resets and hours/minutes while JSON retains machine fields', async () => {
  const output = [];
  const deps = { homeDir: '/unused', resolveRoot: async () => '/project', now: () => now,
    readCachedUsage: async () => ({ savedAt: now, value: { usage: { claude: { primary: { name: '5h', remainingPercent: 0, resetsAt: (now + 80 * 60000) / 1000 } } } } }),
    readUsageSamples: async () => [], readLedger: async () => [], log: s => output.push(s) };
  const result = await runTeamPacingCli({}, deps);
  const local = new Date(now + 80 * 60000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  assert.ok(output[0].includes(`resets ${local}`), output[0]);
  assert.match(output[0], /unused about 1h 20m/);
  assert.doesNotMatch(output[0], /T\d\d:|dead \d+m|CRITICAL/);
  await runTeamPacingCli({ json: true }, deps);
  assert.equal(JSON.parse(output[1]).providers.claude.windows[0].resetsAt, result.providers.claude.windows[0].resetsAt);
});
test('empty quota providers collapse into one trailing plain line and remain in JSON', async () => {
  const output = [];
  const result = await runTeamPacingCli({}, { homeDir: '/unused', resolveRoot: async () => '/project', now: () => now,
    readCachedUsage: async () => ({ savedAt: now, value: { usage: { claude: { primary: { name: '5h', remainingPercent: 80, resetsAt: (now + H) / 1000 } } } } }),
    readUsageSamples: async () => [], readLedger: async () => [], log: s => output.push(s) });
  assert.equal(output[0].split('\n').at(-1), 'No quota data: codex, opencode-go');
  assert.doesNotMatch(output[0], /UNKNOWN|quota unknown/);
  assert.deepEqual(result.providers['opencode-go'].windows, []);
});
test('forced provider selects only qualified models without changing approval or bypassing exhaustion', async t => {
  const { fixture, tree } = await import('./team-route-fixture.test.js');
  const { readTeamRoute } = await import('../src/global/team/routing-input-cache.js');
  const f = await fixture(t); await f.cache();
  const before = await tree(f.home);
  const forced = f.cli('--role', 'Builder', '--provider', 'claude');
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(JSON.parse(forced.stdout).provider, 'claude');
  assert.equal(JSON.parse(forced.stdout).model.modelId, 'son-a');
  const normal = await readTeamRoute({ homeDir: f.home, cwd: f.cwd, role: 'Builder' });
  assert.equal(normal.provider, 'codex');
  const missing = f.cli('--role', 'Builder', '--provider', 'gemini');
  assert.notEqual(JSON.parse(missing.stdout).decision, 'ROUTED');
  assert.deepEqual(await tree(f.home), before);
  f.inputs.providerCapacity.claude = { quotaRemainingPercent: 0, exhaustion: { reason: 'usage limit' } };
  await f.cache();
  const exhausted = f.cli('--role', 'Builder', '--provider', 'claude');
  assert.notEqual(JSON.parse(exhausted.stdout).decision, 'ROUTED');
});
