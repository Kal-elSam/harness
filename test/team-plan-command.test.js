import test from 'node:test';
import assert from 'node:assert/strict';
import { runTeamCli } from '../src/global/team/team-cli.js';
import { runTeamRouteCli } from '../src/global/team/routing-input-cache.js';
import { resolveProjectRoute } from '../src/global/team/project-router.js';
import { writeProjectStrategy } from '../src/global/team/project-strategy-store.js';
import { fixture, tree } from './team-route-fixture.test.js';

const ROW_KEYS = ['role', 'provider', 'modelId', 'displayName', 'decision', 'waitUntil', 'why'];

async function routes(f, deps = {}, options = {}) {
  const lines = [];
  await runTeamCli({ cwd: f.cwd, teamAction: 'routes', json: true, ...options },
    { homeDir: f.home, log: line => lines.push(line), ...deps });
  return { lines, out: options.json === false ? null : JSON.parse(lines.at(-1)) };
}

// Codex exhausted until `reset`; only claude is pooled and unaffordable now: admission waits.
async function waitingFixture(t, now, reset) {
  const f = await fixture(t);
  const codex = { candidateKey: 'codex::gpt-a', adapterId: 'codex', modelId: 'gpt-a', displayName: 'GPT A', accessMode: 'automatic', utility: 3 };
  const claude = { candidateKey: 'claude::son-a', adapterId: 'claude', modelId: 'son-a', displayName: 'Son A', accessMode: 'automatic', utility: 2.9 };
  await writeProjectStrategy(f.home, f.cwd, { ...f.strategy, projectTeam: [{ role: 'Builder', model: codex, assignmentSource: 'recommended' }] });
  const windows = (remainingPercent, resetsAt) => [{ kind: '5h', remainingPercent, resetsAt }, { kind: 'weekly', remainingPercent: 80, resetsAt: now + 5 * 86400000 }];
  await f.cache({ generatedAt: now, roles: { Builder: { pool: [claude] } }, models: [codex, claude],
    eligibility: { codex: { ok: false, cause: 'quota_exhausted', reason: '5h quota exhausted', limit: { resetsAt: new Date(reset).toISOString() } }, claude: { ok: true } },
    providerCapacity: { codex: { quotaRemainingPercent: 0, quotaWindows: windows(0, reset) }, claude: { quotaRemainingPercent: 25, quotaWindows: windows(25, now + 4 * 3600000) } } });
  const readUsageSamples = async (_home, provider) => provider === 'claude'
    ? [{ provider: 'claude', window: '5h', timestamp: now - 1000, remainingPercent: 25, resetsAt: now + 4 * 3600000 }] : [];
  return { f, deps: { now: () => now, readUsageSamples } };
}

test('routes reports a routed role with the contract shape', async t => {
  const f = await fixture(t);
  await f.cache();
  const { out } = await routes(f);
  assert.deepEqual(Object.keys(out), ['status', 'rows', 'fingerprint']);
  assert.equal(out.status, 'active');
  assert.equal(out.rows.length, 1);
  assert.deepEqual(Object.keys(out.rows[0]), ROW_KEYS);
  assert.equal(out.rows[0].role, 'Builder');
  assert.equal(out.rows[0].decision, 'ROUTED');
  assert.equal(out.rows[0].provider, 'codex');
  assert.equal(out.rows[0].modelId, 'gpt-a');
  assert.equal(out.rows[0].waitUntil, null);
  assert.match(out.fingerprint, /^[0-9a-f]{16,}$/);
});

test('routes reports a waiting role with an ISO waitUntil', async t => {
  const now = Date.now();
  const reset = now + 32 * 60000;
  const { f, deps } = await waitingFixture(t, now, reset);
  const { out } = await routes(f, deps);
  assert.equal(out.rows[0].decision, 'WAIT_FOR_PROJECT_TEAM');
  assert.equal(out.rows[0].provider, null);
  assert.equal(out.rows[0].waitUntil, new Date(reset).toISOString());
});

test('routes without an approved team returns status none and no rows', async t => {
  const f = await fixture(t);
  await writeProjectStrategy(f.home, f.cwd, { ...f.strategy, status: 'suggested' });
  const { out } = await routes(f);
  assert.equal(out.status, 'none');
  assert.deepEqual(out.rows, []);
  assert.equal(typeof out.fingerprint, 'string');
});

test('routes with missing or stale inputs gives STALE rows without crashing', async t => {
  const f = await fixture(t);
  const missing = (await routes(f)).out;
  assert.equal(missing.rows[0].decision, 'STALE');
  await f.cache({ generatedAt: Date.now() - 31 * 60000 });
  assert.equal((await routes(f)).out.rows[0].decision, 'STALE');
});

test('fingerprint is stable across calls and changes only with waitUntil, not why', async t => {
  const now = Date.now();
  const { f, deps } = await waitingFixture(t, now, now + 32 * 60000);
  const a = (await routes(f, deps)).out;
  const b = (await routes(f, deps)).out;
  assert.equal(a.fingerprint, b.fingerprint);
  const later = await waitingFixture(t, now, now + 64 * 60000);
  const c = (await routes(later.f, later.deps)).out;
  assert.notEqual(c.rows[0].waitUntil, a.rows[0].waitUntil);
  assert.notEqual(c.fingerprint, a.fingerprint);
});

test('routes writes nothing under HOME and does not announce re-form notices', async t => {
  const f = await fixture(t);
  await f.cache();
  const before = await tree(f.home);
  await routes(f);
  await routes(f, {}, { json: false });
  assert.deepEqual(await tree(f.home), before);
});

test('routes without --json prints one line per role', async t => {
  const f = await fixture(t);
  await f.cache();
  const { lines } = await routes(f, {}, { json: false });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^Builder\b.*ROUTED/);
});

test('team route output is unchanged by the shared-read refactor', async t => {
  const f = await fixture(t);
  await f.cache();
  const lines = [];
  await runTeamRouteCli({ role: 'Builder', cwd: f.cwd, json: true }, { homeDir: f.home, log: line => lines.push(line) });
  const expected = resolveProjectRoute({ role: 'Builder', strategy: f.strategy, ...f.inputs, pool: f.inputs.roles.Builder.pool, ledger: [], capacity: f.inputs.providerCapacity, now: Date.now() });
  assert.deepEqual(JSON.parse(lines[0]), { ...expected, agentName: 'team-builder-' + expected.provider });
});

test('team plan output is unchanged', async t => {
  const phasePlan = { generatedAt: new Date().toISOString(), horizon: new Date(Date.now() + 3600000).toISOString(), idealTeam: [], phases: [] };
  const f = await fixture(t);
  const lines = [];
  await runTeamCli({ cwd: f.cwd, teamAction: 'plan', json: true },
    { homeDir: f.home, log: line => lines.push(line), getService: () => ({ rebuildProjectTeam: async () => ({ phasePlan }) }) });
  assert.equal(lines.at(-1), JSON.stringify(phasePlan));
});
