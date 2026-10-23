import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launchLedgerPath } from '../src/global/team/launch-ledger.js';
import { KAIRO_USAGE_CACHE_SCHEMA } from '../src/global/host/workspace-cache.js';
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

test('statusline omits missing Codex numbers instead of printing unknown', async t => {
  const { home, repo } = await fixture(t);
  const result = run(home, claudeInput(repo));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Opus 5.5 (high) · Context 72% · Claude 5h 87% · week 60%\n');
  assert.doesNotMatch(result.stdout, /unknown|Codex/);
});

test('statusline fails open on malformed stdin with a safe fallback', async t => {
  const { home } = await fixture(t);
  const result = run(home, '{not json');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Kairo\n');
  assert.equal(result.stderr, '');
});
