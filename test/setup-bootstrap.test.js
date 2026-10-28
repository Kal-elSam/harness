import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = resolve(import.meta.dirname, '..');
const bin = join(repo, 'bin/kairo.js');
const scratch = [];
test.after(() => Promise.all(scratch.map(dir => rm(dir, { recursive: true, force: true }))));

async function files(root) {
  const result = [];
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name);
    result.push(entry.isDirectory() ? [entry.name, await files(path)] : [entry.name, (await readFile(path)).toString('base64')]);
  }
  return result;
}

async function fixture({ git = true, claude = true, claudeCli = true, codex = true } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'kairo-bootstrap-'));
  scratch.push(base);
  const home = join(base, 'home'), root = join(base, 'project'), tools = join(base, 'bin');
  for (const dir of [home, root, tools, ...(codex ? [join(home, '.codex')] : [])]) await mkdir(dir, { recursive: true });
  if (claude) {
    await mkdir(join(home, '.claude/agents'), { recursive: true });
    await writeFile(join(home, '.claude/agents/my-architect.md'), '---\nname: my-architect\nmodel: sonnet\n---\nArchitecture work.\n');
  }
  if (git) assert.equal(spawnSync('git', ['init', '-q', root]).status, 0);
  const calls = join(base, 'claude-args.jsonl');
  const fake = join(tools, 'claude');
  if (claudeCli) {
    await writeFile(fake, `#!${process.execPath}\nimport('node:fs').then(fs => { const args = process.argv.slice(2); fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args)+'\\n'); if (process.env.FAIL_PLUGIN === args[2]) process.exitCode = 7; });\n`);
    await chmod(fake, 0o755);
  }
  // Retain the real team CLI/service/operations. Reuse team-cli.test's provider
  // seam, injected by a test-only module hook into the public bin process.
  const preload = join(base, 'preload.mjs');
  await writeFile(preload, `
import { registerHooks } from 'node:module';
registerHooks({ load(url, context, next) {
  const loaded = next(url, context);
  if (!url.endsWith('.js')) return loaded;
  let source = String(loaded.source);
  if (url.endsWith('/test/helpers/setup-harness.js')) source = source
    .replace('await mkdtemp(join(tmpdir(), "kairo-setup-root-"))', 'process.env.TEST_PROJECT')
    .replace('await mkdtemp(join(tmpdir(), "kairo-setup-home-"))', 'process.env.HARNESS_HOME');
  if (url.endsWith('/src/global/team/team-cli.js')) source = source.replace('async function buildService(homeDir, env = process.env) {', 'async function buildService(homeDir, env = process.env) { return globalThis.setupService;');
  if (url.endsWith('/src/global/team/providers-cli.js')) source = source.replace('export async function runTeamProvidersCli(options = {}, deps = {}) {', 'export async function runTeamProvidersCli(options = {}, deps = {}) { deps = { ...deps, status: async () => ({ providers: [] }) };');
  return { ...loaded, source };
}});
const { harness } = await import(${JSON.stringify(pathToFileURL(join(repo, 'test/helpers/setup-harness.js')).href)});
const h = await harness({ diskStrategy: true, serviceDeps: { recoverRuns: async () => {} } });
globalThis.setupService = h.service;
`);
  // No ambient provider binaries, credentials, or model calls.
  for (const cmd of ['git']) {
    const found = spawnSync('which', [cmd], { encoding: 'utf8' }).stdout.trim();
    await writeFile(join(tools, cmd), `#!/bin/sh\nexec '${found}' "$@"\n`);
    await chmod(join(tools, cmd), 0o755);
  }
  const env = { HOME: home, HARNESS_HOME: home, PATH: tools, TEST_PROJECT: root, TMPDIR: base,
    NODE_NO_WARNINGS: '1', LANG: 'en_US.UTF-8' };
  const run = (args, extra = {}) => spawnSync(process.execPath, ['--import', preload, bin, ...args], {
    cwd: root, env: { ...env, ...extra }, encoding: 'utf8', timeout: 60000
  });
  return { base, home, root, calls, run, snapshot: async () => [await files(home), await files(root)] };
}

function success(p) { assert.equal(p.status, 0, p.stderr + p.stdout); }
function ordered(text, parts) {
  let index = -1;
  for (const part of parts) { const next = text.indexOf(part, index + 1); assert.ok(next > index, `Missing/out-of-order ${part}: ${text}`); index = next; }
}

test('R1 explicit adapters preserves legacy setup output and exit code', async () => {
  const h = await fixture();
  const before = await h.snapshot();
  const p = h.run(['setup', '--adapters', 'codex']);
  assert.equal(p.status, 1);
  assert.equal(p.stdout, "Kairo Runtime setup — local AI ecosystem configurator\nConfigures and coordinates local agents. Does not install the AI apps themselves.\n\nDetected agents: codex, claude\nSupported agents: cursor, codex, opencode, claude, pi\nDefault components: orchestrator, sdd-core\n\nPlan:\n  Agents: codex\n  Components: orchestrator, sdd-core\n  Available components: orchestrator, sdd-core, engram-memory, graphify-context, agent-skills\n\n");
  assert.equal(p.stderr, "kairo.js: Non-interactive setup requires --yes, --confirm, or --no-preflight before applying managed changes.\n");
  assert.deepEqual(await h.snapshot(), before);
  assert.match(p.stdout, /Kairo Runtime/);
  assert.match(p.stderr, /Non-interactive setup requires/);
  assert.doesNotMatch(p.stdout, /Team bootstrap|Detected hosts|Choose an analyst/);
});

test('R2 no-option preview lists discovery and steps without any writes, including TTY', async () => {
  const h = await fixture();
  const before = await h.snapshot();
  const p = h.run(['setup']);
  success(p);
  for (const pattern of [/Detected providers:/, /Detected hosts:.*claude-code.*codex/, /Available analysts:/, /codex-model/, /Approved team: no/, /kairo setup --analyst MODEL --yes/]) assert.match(p.stdout, pattern);
  ordered(p.stdout, ['harness setup', 'analyze', 'approve', 'roles init', 'roles sync', 'kairo-router']);
  assert.deepEqual(await h.snapshot(), before);
  // Force the same TTY flags consumed by setup routing in the subprocess.
  const tty = join(h.base, 'tty.mjs');
  await writeFile(tty, 'process.stdin.isTTY = true; process.stdout.isTTY = true;');
  const dry = h.run(['setup', '--dry-run']);
  success(dry);
  assert.match(dry.stdout, /Detected hosts:/);
  assert.deepEqual(await h.snapshot(), before);
  const pty = h.run(['setup'], { NODE_OPTIONS: `--import=${tty}` });
  success(pty);
  assert.match(pty.stdout, /kairo setup --analyst MODEL --yes/);
  assert.deepEqual(await h.snapshot(), before);
});

test('R3 missing analyst installs harness, kit and router, skips team and exits successfully', async () => {
  const h = await fixture();
  const projectBefore = await files(h.root);
  const p = h.run(['setup', '--yes']);
  success(p);
  assert.equal(p.stderr, '');
  ordered(p.stdout, ['harness setup: done', 'kairo-router: installed']);
  assert.equal(p.stdout.split('\n').filter(line => /Team steps.*skipped.*kairo setup --analyst MODEL --yes/.test(line)).length, 1);
  assert.doesNotMatch(p.stdout, /analyze: done|approve: done|roles init: done|roles sync: done/);
  assert.ok(await readFile(join(h.home, '.harness/state.json')));
  assert.ok(await readFile(join(h.home, '.claude/agents/kairo-architect.md')));
  assert.deepEqual(await files(h.root), projectBefore);
  assert.deepEqual((await readFile(h.calls, 'utf8')).trim().split('\n').map(JSON.parse), [
    ['plugin', 'marketplace', 'add', 'Kal-elSam/harness'], ['plugin', 'install', 'kairo-router@kairo']
  ]);
});

test('C2 router skips when HOME has no .claude even with claude on PATH', async () => {
  const h = await fixture({ git: false, claude: false });
  const p = h.run(['setup', '--yes']);
  success(p);
  assert.match(p.stdout, /kairo-router: skipped.*claude/);
  await assert.rejects(readFile(h.calls), { code: 'ENOENT' });
  await assert.rejects(readFile(join(h.home, '.claude/agents/kairo-architect.md')), { code: 'ENOENT' });
  const excluded = await fixture({ git: false });
  const legacy = excluded.run(['setup', '--adapters', 'codex', '--yes']);
  success(legacy);
  await assert.rejects(readFile(excluded.calls), { code: 'ENOENT' });
  await assert.rejects(readFile(join(excluded.home, '.claude/agents/kairo-architect.md')), { code: 'ENOENT' });
});

test('B2 fresh HOME without .claude never calls claude even when setup creates it', async () => {
  // With no detected agent, harness setup targets every agent and creates HOME/.claude.
  const h = await fixture({ claude: false, codex: false });
  const p = h.run(['setup', '--yes']);
  success(p);
  assert.match(p.stdout, /kairo-router: skipped.*claude/);
  await assert.rejects(readFile(h.calls), { code: 'ENOENT' });
});

test('B1 --json prints no bootstrap text and one final JSON line', async () => {
  const h = await fixture();
  const preview = h.run(['setup', '--dry-run', '--json']);
  success(preview);
  assert.doesNotMatch(preview.stdout, /Team bootstrap|Detected hosts|Choose an analyst/);
  const view = JSON.parse(preview.stdout.trim().split('\n').at(-1));
  assert.equal(view.mode, 'preview');
  for (const key of ['providers', 'hosts', 'analysts', 'approved', 'steps', 'next']) assert.ok(key in view, key);
  const run = h.run(['setup', '--yes', '--json']);
  success(run);
  assert.doesNotMatch(run.stdout, /harness setup: done|Team steps|kairo-router:/);
  const done = JSON.parse(run.stdout.trim().split('\n').at(-1));
  assert.deepEqual(done.steps.map(s => [s.name, s.status]), [['harness setup', 'done'], ['team steps 2-5', 'skipped'], ['kairo-router', 'done']]);
  const bad = fixture({ git: false });
  const failed = (await bad).run(['setup', '--yes', '--json'], { FAIL_PLUGIN: 'add' });
  assert.equal(failed.status, 1);
  const last = JSON.parse(failed.stdout.trim().split('\n').at(-1));
  assert.deepEqual(last.steps.at(-1), { name: 'kairo-router', status: 'failed', reason: last.steps.at(-1).reason });
});

test('R4 executes existing steps in order, syncs every detected host and installs router', async () => {
  const h = await fixture();
  const p = h.run(['setup', '--analyst', 'codex-model', '--yes']);
  success(p);
  ordered(p.stdout, ['harness setup: done', 'analyze: done', 'approve: done', 'roles init: done', 'roles sync: done', 'kairo-router: installed']);
  assert.ok(await readFile(join(h.home, '.harness/state.json')));
  const kit = await readFile(join(h.home, '.claude/agents/kairo-architect.md'), 'utf8');
  for (const name of ['CodeGraph', 'Engram', 'Graphify', 'RTK']) assert.ok(kit.includes(name), name);
  assert.equal(p.stdout.split('\n').filter(line => /^(harness setup|analyze|approve|roles init|roles sync): done$|^kairo-router: installed$/.test(line)).length, 6);
  assert.ok(await readFile(join(h.root, '.kairo/roles.json')));
  const { stdout } = h.run(['team', 'show', '--json']);
  assert.equal(JSON.parse(stdout).strategyStatus, 'approved');
  for (const host of ['.claude/agents', '.codex/agents']) assert.ok((await readdir(join(h.root, host))).length);
  const commands = (await readFile(h.calls, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(commands, [['plugin', 'marketplace', 'add', 'Kal-elSam/harness'], ['plugin', 'install', 'kairo-router@kairo']]);
  const installed = join(h.home, '.claude/plugins/installed_plugins.json');
  await mkdir(join(h.home, '.claude/plugins'), { recursive: true });
  await writeFile(installed, JSON.stringify({ version: 2, plugins: { 'kairo-router@kairo': [{ scope: 'user', installPath: '/fake' }] } }));
  const again = h.run(['setup', '--yes']);
  success(again);
  assert.match(again.stdout, /analyze.*skipped.*already approved/);
  assert.match(again.stdout, /approve.*skipped.*already approved/);
  assert.match(again.stdout, /kairo-router: already installed/);
  assert.equal(await readFile(h.calls, 'utf8'), commands.map(x => JSON.stringify(x) + '\n').join(''));
});

test('R4 stops on first failure and names failed step', async () => {
  const h = await fixture();
  const p = h.run(['setup', '--analyst', 'unknown-model', '--yes']);
  assert.equal(p.status, 1);
  assert.match(p.stderr, /analyze: failed/);
  assert.doesNotMatch(p.stdout, /approve: done|roles init: done|kairo-router: installed/);
});

test('R4 router missing CLI skips; plugin failure stops before second command', async () => {
  const missing = await fixture({ git: false, claudeCli: false });
  const skipped = missing.run(['setup', '--yes']);
  success(skipped);
  assert.match(skipped.stdout, /kairo-router: skipped.*claude CLI not on PATH/);
  const h = await fixture({ git: false });
  const failed = h.run(['setup', '--yes'], { FAIL_PLUGIN: 'add' });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /kairo-router: failed/);
  assert.deepEqual((await readFile(h.calls, 'utf8')).trim().split('\n').map(JSON.parse), [['plugin', 'marketplace', 'add', 'Kal-elSam/harness']]);
});

test('R5 outside Git preview and execution skip only team steps', async () => {
  const h = await fixture({ git: false });
  const before = await h.snapshot();
  const preview = h.run(['setup']);
  success(preview);
  assert.match(preview.stdout, /not a Git repository/);
  assert.deepEqual(await h.snapshot(), before);
  const p = h.run(['setup', '--yes']);
  success(p);
  ordered(p.stdout, ['harness setup: done', 'not a Git repository', 'kairo-router: installed']);
  assert.ok(await readFile(join(h.home, '.harness/state.json')));
  assert.deepEqual(await files(h.root), []);
});

test('R6 setup help and Team setup docs describe preview and composed flow', async () => {
  const h = await fixture();
  const before = await h.snapshot();
  const p = h.run(['setup', '--help']);
  success(p);
  assert.deepEqual(await h.snapshot(), before);
  assert.match(p.stdout, /setup --analyst MODEL --yes/);
  assert.match(p.stdout, /read-only preview/i);
  const readme = await readFile(join(repo, 'README.md'), 'utf8');
  assert.match(readme, /kairo setup --analyst MODEL --yes/);
  assert.match(readme, /step-by-step/i);
});
