import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launchLedgerPath } from '../src/global/team/launch-ledger.js';
import { KAIRO_USAGE_CACHE_SCHEMA } from '../src/global/host/workspace-cache.js';
import { buildStatuslineLine } from '../src/global/team/statusline-cli.js';
import { harnessHomePaths } from '../src/global/paths.js';
import { ROUTING_INPUT_CACHE_SCHEMA } from '../src/global/team/routing-input-cache.js';

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


test('statusline shows fresh quota at 120 seconds and explains expired quota without probing', async () => {
  const now = 1_800_000_000_000;
  for (const [age, expected] of [
    [120_000, 'Codex 5h 84% · week 72%'],
    [31 * 60_000, 'Codex 5h 84% (31m ago) · week 72% (31m ago)'],
    [3 * 3_600_000, 'Codex 5h 84% (3h ago) · week 72% (3h ago)'],
    [5 * 86_400_000, 'Codex 5h 84% (5d ago) · week 72% (5d ago)'],
  ]) {
    const deps = {
      now: () => now,
      resolveRoot: async () => '/project',
      readCachedUsage: async () => ({ savedAt: now - age, value: { usage: { codex: { windows: [
        { name: '5h', remainingPercent: 84 }, { name: 'week', remainingPercent: 72 },
      ] } } } }),
      readRoutingInputCache: async () => null,
      readRunningLaunches: async () => ({ running: [] }),
      startBackgroundRefresh: async () => {},
    };
    assert.equal(await buildStatuslineLine({ model: { display_name: 'Opus' } }, deps), `Opus · ${expected}`);
  }
});

test('statusline shows last known Codex quota with its age and refreshes in the background', async () => {
  const now = 1_800_000_000_000;
  const depsFor = (age, startBackgroundRefresh) => ({
    now: () => now,
    resolveRoot: async () => '/project',
    readCachedUsage: async () => ({ savedAt: now - age, value: { usage: { codex: { windows: [
      { name: '5h', remainingPercent: 65 }, { name: 'week', remainingPercent: 95 },
    ] } } } }),
    readRoutingInputCache: async () => null,
    readRunningLaunches: async () => ({ running: [] }),
    startBackgroundRefresh,
  });
  const input = { model: { display_name: 'Opus' } };

  let calls = [];
  assert.equal(await buildStatuslineLine(input, depsFor(30_000, async a => { calls.push(a); })), 'Opus · Codex 5h 65% · week 95%');
  assert.equal(calls.length, 0);

  calls = [];
  assert.equal(
    await buildStatuslineLine(input, depsFor(4 * 60_000, async a => { calls.push(a); })),
    'Opus · Codex 5h 65% (4m ago) · week 95% (4m ago)',
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].projectRoot, '/project');

  calls = [];
  assert.equal(
    await buildStatuslineLine(input, depsFor(45 * 60_000, async a => { calls.push(a); })),
    'Opus · Codex 5h 65% (45m ago) · week 95% (45m ago)',
  );
  assert.equal(calls.length, 1);

  assert.equal(
    await buildStatuslineLine(input, depsFor(4 * 60_000, async () => { throw new Error('boom'); })),
    'Opus · Codex 5h 65% (4m ago) · week 95% (4m ago)',
  );
});

test('statusline marks a Codex window whose reset passed instead of showing its old percent', async () => {
  const now = 1_800_000_000_000;
  const savedAt = now - 60 * 60_000;
  const calls = [];
  const deps = {
    now: () => now,
    resolveRoot: async () => '/project',
    // resetsAt is epoch seconds, as Codex reports it: the 5h window reset 15 minutes ago.
    readCachedUsage: async () => ({ savedAt, value: { usage: { codex: { windows: [
      { name: '5h', remainingPercent: 3, resetsAt: (now - 15 * 60_000) / 1000 },
      { name: 'week', remainingPercent: 72, resetsAt: (now + 86_400_000) / 1000 },
    ] } } } }),
    readRoutingInputCache: async () => null,
    readRunningLaunches: async () => ({ running: [] }),
    startBackgroundRefresh: async args => { calls.push(args); },
  };
  assert.equal(await buildStatuslineLine({ model: { display_name: 'Opus' } }, deps), 'Opus · Codex 5h reset · week 72% (1h ago)');
  assert.equal(calls.length, 1);
});

test('statusline marks a reset routing-cache window and keeps windows whose reset is ahead', async () => {
  const now = 1_800_000_000_000;
  const deps = {
    now: () => now,
    resolveRoot: async () => '/project',
    readCachedUsage: async () => null,
    readRoutingInputCache: async () => ({ schema: ROUTING_INPUT_CACHE_SCHEMA, generatedAt: now - 10 * 60_000, providerCapacity: { codex: { quotaWindows: [
      { kind: '5h', remainingPercent: 10, resetsAtIso: new Date(now - 60_000).toISOString() },
      { kind: 'weekly', remainingPercent: 80, resetsAtIso: new Date(now + 3_600_000).toISOString() },
    ] } } }),
    readRunningLaunches: async () => ({ running: [] }),
    startBackgroundRefresh: async () => {},
  };
  assert.equal(await buildStatuslineLine({ model: { display_name: 'Opus' } }, deps), 'Opus · Codex 5h reset · week 80% (10m ago)');
});
