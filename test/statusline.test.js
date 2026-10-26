import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launchLedgerPath } from '../src/global/team/launch-ledger.js';
import { KAIRO_USAGE_CACHE_SCHEMA } from '../src/global/host/workspace-cache.js';
import { startBackgroundRefresh } from '../src/global/team/background-refresh.js';
import { ROUTING_INPUT_CACHE_SCHEMA, routingInputCachePath } from '../src/global/team/routing-input-cache.js';
import { buildStatuslineLine } from '../src/global/team/statusline-cli.js';
import { harnessHomePaths } from '../src/global/paths.js';

const BIN = resolve('bin/kairo.js');

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'kairo-statusline-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const home = join(base, 'home');
  const repo = join(base, 'repo');
  await mkdir(home, { recursive: true });
  await mkdir(repo, { recursive: true });
  execFileSync('git', ['init', '-q', repo]);
  const root = await realpath(repo);
  // Prevent CLI fixtures from probing real providers; refresh behavior is tested with a fake spawn.
  const lockDir = join(routingInputCachePath(home, root), '..');
  await mkdir(lockDir, { recursive: true });
  for (const bucket of [Math.floor(Date.now() / 60000), Math.floor(Date.now() / 60000) + 1]) {
    await writeFile(join(lockDir, `routing-refresh-${bucket}.lock`), '');
  }
  return { home, repo: root };
}

function claudeInput(repo, overrides = {}) {
  return JSON.stringify({
    model: { display_name: 'Opus 5.5' },
    effort: { level: 'high' },
    context_window: { remaining_percentage: 72.4 },
    rate_limits: { five_hour: { used_percentage: 13 }, seven_day: { used_percentage: 40 } },
    workspace: { current_dir: repo },
    ...overrides,
  });
}

function run(home, stdin) {
  return spawnSync(process.execPath, [BIN, 'statusline'], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, HARNESS_HOME: home },
  });
}

async function seedCodexUsage(home) {
  const { root } = harnessHomePaths(home);
  await mkdir(root, { recursive: true });
  const doc = {
    schema: KAIRO_USAGE_CACHE_SCHEMA,
    savedAt: Date.now(),
    value: { usage: { codex: { windows: [
      { name: '5h', remainingPercent: 84 },
      { name: 'week', remainingPercent: 72 },
    ] } } },
  };
  await writeFile(join(root, 'workspace-usage-cache.json'), JSON.stringify(doc));
}

async function seedRunning(home, repo, rows) {
  const path = launchLedgerPath(home, repo);
  await mkdir(join(path, '..'), { recursive: true });
  const lines = rows.map(([role, modelId, adapterId]) => JSON.stringify({
    source: 'launch', at: new Date(Date.now() - 60_000).toISOString(),
    role, agent: `${role}-agent`, adapterId, modelId,
  }));
  await writeFile(path, `${lines.join('\n')}\n`);
}

test('statusline prints every fact once in the agreed order', async t => {
  const { home, repo } = await fixture(t);
  await seedCodexUsage(home);
  const result = run(home, claudeInput(repo));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Opus 5.5 (high) · Context 72% · Claude 5h 87% · week 60% · Codex 5h 84% · week 72%\n');
});

test('statusline omits the running segment when no delegated work runs', async t => {
  const { home, repo } = await fixture(t);
  await seedCodexUsage(home);
  // Every launch has a matching completed outcome, so nothing is running.
  const path = launchLedgerPath(home, repo);
  await seedRunning(home, repo, [['explorer', 'haiku', 'claude'], ['builder', 'sonnet', 'claude']]);
  const outcomes = [['explorer', 'haiku'], ['builder', 'sonnet']].map(([role, modelId]) => JSON.stringify({
    source: 'outcome', at: new Date().toISOString(), role, agent: `${role}-agent`,
    adapterId: 'claude', modelId, status: 'completed',
  }));
  await writeFile(path, `${await readFile(path, 'utf8')}${outcomes.join('\n')}\n`);
  const result = run(home, claudeInput(repo));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Opus 5.5 (high) · Context 72% · Claude 5h 87% · week 60% · Codex 5h 84% · week 72%\n');
});

test('statusline shows two running items and counts the rest', async t => {
  const { home, repo } = await fixture(t);
  await seedCodexUsage(home);
  await seedRunning(home, repo, [['explorer', 'haiku', 'claude'], ['builder', 'gpt', 'codex'], ['verifier', 'sonnet', 'claude']]);
  const result = run(home, claudeInput(repo));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Opus 5.5 (high) · Context 72% · Claude 5h 87% · week 60% · Codex 5h 84% · week 72% · explorer - haiku - claude, builder - gpt - codex +1 more\n');
});

test('statusline explains missing Codex quota without inventing numbers', async t => {
  const { home, repo } = await fixture(t);
  const result = run(home, claudeInput(repo));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Opus 5.5 (high) · Context 72% · Claude 5h 87% · week 60% · Codex quota unavailable (missing or stale)\n');
  assert.doesNotMatch(result.stdout, /Codex 5h \d/);
});

test('statusline fails open on malformed stdin with a safe fallback', async t => {
  const { home } = await fixture(t);
  const result = run(home, '{not json');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Kairo\n');
  assert.equal(result.stderr, '');
});


test('statusline preserves fresh quota and rejects stale quota without a known reset', async () => {
  const now = 1_800_000_000_000;
  for (const [age, expected] of [
    [120_000, 'Codex 5h 84% · week 72%'],
    [120_001, 'Codex quota unavailable (missing or stale)'],
  ]) {
    const deps = {
      startBackgroundRefresh: async () => false,
      now: () => now,
      resolveRoot: async () => '/project',
      readCachedUsage: async () => ({ savedAt: now - age, value: { usage: { codex: { windows: [
        { name: '5h', remainingPercent: 84 }, { name: 'week', remainingPercent: 72 },
      ] } } } }),
      readRoutingInputCache: async () => null,
      readRunningLaunches: async () => ({ running: [] }),
    };
    assert.equal(await buildStatuslineLine({ model: { display_name: 'Opus' } }, deps), `Opus · ${expected}`);
  }
});

const NOW = 1_800_000_000_000;
function quotaDeps(age = 7 * 60000, overrides = {}) {
  return {
    homeDir: '/unused', now: () => NOW, resolveRoot: async () => '/project',
    readCachedUsage: async () => ({ savedAt: NOW - age, value: { usage: { codex: { windows: [
      { name: '5h', remainingPercent: 46, resetsAt: (NOW + 3600000) / 1000 },
      { name: 'week', remainingPercent: 76, resetsAt: (NOW + 86400000) / 1000 },
    ] } } } }),
    readRoutingInputCache: async () => null,
    readRunningLaunches: async () => ({ running: [] }),
    startBackgroundRefresh: async () => false,
    ...overrides,
  };
}
const INPUT = { model: { display_name: 'Opus 5.5' }, effort: { level: 'medium' } };
const QUOTA = 'Opus 5.5 (medium) · Codex 5h 46% · week 76%';

test('stale quota shows last values with age and requests one refresh', async () => {
  const calls = [];
  const line = await buildStatuslineLine(INPUT, quotaDeps(undefined, {
    startBackgroundRefresh: args => { calls.push(args); return new Promise(() => {}); },
  }));
  assert.equal(line, `${QUOTA} (7m ago)`);
  assert.deepEqual(calls, [{ homeDir: '/unused', projectRoot: '/project' }]);
});

test('fresh quota is unchanged and does not refresh', async () => {
  let calls = 0;
  assert.equal(await buildStatuslineLine(INPUT, quotaDeps(120000, {
    startBackgroundRefresh: () => { calls++; },
  })), QUOTA);
  assert.equal(calls, 0);
});

test('no quota still shows unavailable', async () => {
  assert.equal(await buildStatuslineLine(INPUT, quotaDeps(undefined, {
    readCachedUsage: async () => null,
  })), 'Opus 5.5 (medium) · Codex quota unavailable (missing or stale)');
});

test('stale display has a strict 30-minute bound', async () => {
  assert.equal(await buildStatuslineLine(INPUT, quotaDeps(30 * 60000 - 1)), `${QUOTA} (29m ago)`);
  assert.match(await buildStatuslineLine(INPUT, quotaDeps(30 * 60000)), /Codex quota unavailable/);
});

test('stale usage rejects reset windows and future timestamps', async () => {
  for (const reset of [NOW, NOW - 1, null]) {
    const deps = quotaDeps();
    const cached = await deps.readCachedUsage();
    cached.value.usage.codex.windows.forEach(w => { w.resetsAt = reset === null ? null : reset / 1000; });
    deps.readCachedUsage = async () => cached;
    assert.match(await buildStatuslineLine(INPUT, deps), /Codex quota unavailable/);
  }
  assert.match(await buildStatuslineLine(INPUT, quotaDeps(-1)), /Codex quota unavailable/);
});

test('routing fallback prefers fresh data and filters stale reset windows', async () => {
  const routing = { schema: ROUTING_INPUT_CACHE_SCHEMA, generatedAt: NOW - 60000,
    providerCapacity: { codex: { quotaWindows: [
      { kind: '5h', remainingPercent: 21, resetsAtIso: new Date(NOW + 3600000).toISOString() },
      { kind: 'week', remainingPercent: 65, resetsAtIso: new Date(NOW + 86400000).toISOString() },
    ] } } };
  const deps = quotaDeps(undefined, { readRoutingInputCache: async () => routing });
  assert.equal(await buildStatuslineLine(INPUT, deps), 'Opus 5.5 (medium) · Codex 5h 21% · week 65%');
  routing.generatedAt = NOW - 3 * 60000;
  assert.equal(await buildStatuslineLine(INPUT, deps), 'Opus 5.5 (medium) · Codex 5h 21% · week 65% (3m ago)');
  deps.readCachedUsage = async () => null;
  routing.providerCapacity.codex.quotaWindows[0].resetsAtIso = new Date(NOW).toISOString();
  assert.equal(await buildStatuslineLine(INPUT, deps), 'Opus 5.5 (medium) · week 65% (3m ago)');
});

test('refresh throw or rejection cannot hide stale quota', async () => {
  for (const refresh of [() => { throw Error('offline'); }, async () => { throw Error('offline'); }]) {
    assert.equal(await buildStatuslineLine(INPUT, quotaDeps(undefined, { startBackgroundRefresh: refresh })), `${QUOTA} (7m ago)`);
  }
});

test('statusline redraws and pacing share one detached refresh lock', async t => {
  const base = await mkdtemp(join(tmpdir(), 'kairo-statusline-refresh-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  let spawns = 0;
  const pending = [];
  const refresh = args => {
    const task = startBackgroundRefresh(args, { now: () => NOW, spawnImpl: (_exe, argv, options) => {
      spawns++;
      assert.deepEqual(argv.slice(1), ['team', 'route', '--refresh', '--cwd', '/project']);
      assert.equal(options.detached, true);
      assert.equal(options.stdio, 'ignore');
      return { once() {}, unref() {} };
    } });
    pending.push(task);
    return task;
  };
  const deps = quotaDeps(undefined, { homeDir: base, startBackgroundRefresh: refresh });
  await Promise.all([buildStatuslineLine(INPUT, deps), buildStatuslineLine(INPUT, deps)]);
  await Promise.all(pending);
  assert.equal(spawns, 1);
  assert.equal(await refresh({ homeDir: base, projectRoot: '/project' }), false);
  assert.equal(spawns, 1);
});
