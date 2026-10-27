import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { installGlobalHarness, syncGlobalHarness, uninstallGlobalHarness } from '../src/global/global-installer.js';
import { writeCachedUsage } from '../src/global/host/workspace-cache.js';
import { detectGlobalDrift } from '../src/global/drift.js';
import { buildAdapterContext } from '../src/global/adapter-context.js';
import { readGlobalState } from '../src/global/state.js';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const hook = join(packageRoot, 'src/global/hosts/codex-pacing-hook.js');
const options = { packageRoot, packageName: '@kal-elsam/kairo-runtime', cliVersion: '0.36.0', agents: ['codex'], components: [], noDefaultComponents: true };
async function fixture(t) {
  const homeDir = await mkdtemp(join(tmpdir(), 'codex-pacing-'));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  await mkdir(join(homeDir, '.codex'));
  return { homeDir, path: join(homeDir, '.codex/hooks.json') };
}

test('Codex prompt hook uses bounded no-wait pacing and keeps explicit model choices advisory', async () => {
  const { runCodexPacingHook } = await import('../src/global/hosts/codex-pacing-hook.js');
  let observed;
  const output = await runCodexPacingHook({ hook_event_name: 'UserPromptSubmit', cwd: '/project' }, {
    run: async (file, args, config) => {
      observed = { file, args, config };
      return { stdout: JSON.stringify({ ok: true, stale: true, providers: {
        codex: { tier: 'WATCH', expectedDeadTimeMs: 60000, windows: [{ name: '5h', remainingPercent: 65, resetsAt: '2026-10-28T00:00:00Z' }] },
        claude: { tier: null, expectedDeadTimeMs: null, windows: [] },
      }, nextWriter: 'team-builder-codex' }) };
    },
  });
  assert.deepEqual(observed.args.slice(1), ['team', 'pacing', '--json', '--no-wait', '--cwd', '/project']);
  assert.equal(observed.config.timeout, 1800);
  assert.equal(observed.config.env.KAIRO_HOST, 'codex');
  assert.deepEqual(Object.keys(output), ['hookSpecificOutput']);
  assert.equal(output.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(output.hookSpecificOutput.additionalContext, /codex:.*65%.*2026-10-28/);
  assert.match(output.hookSpecificOutput.additionalContext, /stale|cached/i);
  assert.match(output.hookSpecificOutput.additionalContext, /claude: unavailable/);
  assert.match(output.hookSpecificOutput.additionalContext, /never overrides explicit model/i);
});

test('Codex hook fails open for unsupported events, missing cwd, invalid data and CLI failures', async () => {
  const { runCodexPacingHook } = await import('../src/global/hosts/codex-pacing-hook.js');
  const payload = { hook_event_name: 'UserPromptSubmit', cwd: '/project' };
  for (const input of [{}, { ...payload, hook_event_name: 'Stop' }]) {
    assert.deepEqual(await runCodexPacingHook(input, { run: () => { throw new Error('must not run'); } }), {});
  }
  for (const run of [async () => { throw new Error('timeout'); }, async () => ({ stdout: '{bad' }), async () => ({ stdout: '{"ok":false}' })]) {
    assert.deepEqual(await runCodexPacingHook(payload, { run }), {});
  }
  const process = spawnSync(globalThis.process.execPath, [hook], { input: '{bad', encoding: 'utf8' });
  assert.equal(process.status, 0, process.stderr);
  assert.equal(process.stderr, '');
  assert.deepEqual(JSON.parse(process.stdout), {});
});

test('Codex install previews, preserves other hooks/TOML, backs up and is idempotent; sync repairs and uninstall removes only Kairo', async t => {
  const { homeDir, path } = await fixture(t);
  const original = JSON.stringify({ description: 'User hooks', hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo user-hook' }] }], Stop: [] } });
  const toml = '[hooks]\n# Native user configuration must remain byte-identical.\n';
  await writeFile(path, original);
  await chmod(path, 0o600);
  await writeFile(join(homeDir, '.codex/config.toml'), toml);
  const preview = await installGlobalHarness({ ...options, homeDir, dryRun: true });
  assert.equal(await readFile(path, 'utf8'), original);
  assert.equal(existsSync(join(homeDir, '.codex/AGENTS.md')), false);
  assert.ok(preview.configsCreated.includes('.codex/AGENTS.md'));
  const installed = await installGlobalHarness({ ...options, homeDir });
  const contents = await readFile(path, 'utf8');
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  const document = JSON.parse(contents);
  assert.equal(document.hooks.UserPromptSubmit.length, 2);
  assert.deepEqual(document.hooks.UserPromptSubmit[0], JSON.parse(original).hooks.UserPromptSubmit[0]);
  assert.equal(document.description, 'User hooks');
  assert.equal(await readFile(join(homeDir, '.codex/config.toml'), 'utf8'), toml);
  assert.equal(document.hooks.UserPromptSubmit[1].hooks[0].timeout, 4);
  assert.match(document.hooks.UserPromptSubmit[1].hooks[0].command, /codex-pacing-hook\.js/);
  assert.ok((await Promise.all(installed.backups.map(file => readFile(file, 'utf8')))).includes(original));
  await installGlobalHarness({ ...options, homeDir });
  assert.equal(await readFile(path, 'utf8'), contents);
  document.hooks.UserPromptSubmit.pop();
  await writeFile(path, JSON.stringify(document));
  const context = buildAdapterContext({ ...options, homeDir });
  const state = await readGlobalState(join(context.paths.root, 'state.json'));
  const drift = await detectGlobalDrift({ homeDir, paths: context.paths, state, packageRoot, context });
  assert.ok(drift.some(check => check.name === 'codex:pacing' && check.status === 'stale'));
  await syncGlobalHarness({ ...options, homeDir });
  assert.equal(JSON.parse(await readFile(path, 'utf8')).hooks.UserPromptSubmit.length, 2);
  await uninstallGlobalHarness({ homeDir });
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), JSON.parse(original));
  assert.equal(await readFile(join(homeDir, '.codex/config.toml'), 'utf8'), toml);
});

test('Codex invalid hook config is rejected before changing managed instructions', async t => {
  const { homeDir, path } = await fixture(t);
  for (const text of ['{bad', '{"hooks":[]}', '{"hooks":{"UserPromptSubmit":{}}}']) {
    await writeFile(path, text);
    await assert.rejects(installGlobalHarness({ ...options, homeDir }), /Codex hooks/);
    assert.equal(await readFile(path, 'utf8'), text);
    assert.equal(existsSync(join(homeDir, '.codex/AGENTS.md')), false);
  }
});

test('installed Codex hook runs the real cached pacing CLI without a model or provider probe', async t => {
  const { homeDir } = await fixture(t);
  await writeCachedUsage(homeDir, { usage: { codex: { primary: {
    name: '5h', remainingPercent: 65, resetsAt: Date.now() / 1000 + 3600,
  } } } });
  const result = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', cwd: packageRoot }), encoding: 'utf8',
    env: { ...process.env, HARNESS_HOME: homeDir }, timeout: 4000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /codex:.*65%/);
});
