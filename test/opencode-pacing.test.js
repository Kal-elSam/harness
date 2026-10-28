import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installGlobalHarness, syncGlobalHarness, uninstallGlobalHarness } from '../src/global/global-installer.js';
import { detectGlobalDrift } from '../src/global/drift.js';
import { buildAdapterContext } from '../src/global/adapter-context.js';
import { readGlobalState } from '../src/global/state.js';
import { hasManagedSection } from '../src/global/managed-section.js';
import { readPacingContext } from '../src/global/hosts/pacing-context.js';
import { createKairoPacingSetup } from '../src/global/hosts/opencode-pacing-plugin.js';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const options = { packageRoot, packageName: '@kal-elsam/kairo-runtime', cliVersion: '0.36.0', agents: ['opencode'], components: [], noDefaultComponents: true };
async function fixture(t) {
  const homeDir = await mkdtemp(join(tmpdir(), 'opencode-pacing-'));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  await mkdir(join(homeDir, '.config/opencode'), { recursive: true });
  return { homeDir, path: join(homeDir, '.config/opencode/plugins/kairo-pacing.js') };
}
function fakeCtx(directory = '/project') {
  const hooks = {};
  return { hooks, ctx: { location: { directory }, session: { hook: async (name, fn) => { hooks[name] = fn; } } } };
}
const snapshot = { ok: true, providers: { codex: { tier: 'WATCH', expectedDeadTimeMs: 60000, windows: [{ name: '5h', remainingPercent: 65, resetsAt: '2026-10-28T00:00:00Z' }] } } };

test('readPacingContext runs the bounded no-wait CLI with the host and returns text or null', async () => {
  let observed;
  const text = await readPacingContext({ cwd: '/p', host: 'opencode', run: async (file, args, config) => { observed = { args, config }; return { stdout: JSON.stringify(snapshot) }; } });
  assert.deepEqual(observed.args.slice(1), ['team', 'pacing', '--json', '--no-wait', '--cwd', '/p']);
  assert.equal(observed.config.env.KAIRO_HOST, 'opencode');
  assert.equal(observed.config.timeout, 1800);
  assert.match(text, /codex:.*65%/);
  assert.equal(await readPacingContext({ cwd: '/p', host: 'opencode', run: async () => ({ stdout: '{bad' }) }), null);
  assert.equal(await readPacingContext({ cwd: '/p', host: 'opencode', run: async () => { throw new Error('x'); } }), null);
});

test('P1 setup registers prompt and context hooks; context injects the cached text for that session only', async () => {
  const calls = [];
  const setup = createKairoPacingSetup({ readContext: async args => { calls.push(args); return 'PACING'; } });
  const { hooks, ctx } = fakeCtx('/work');
  await setup(ctx);
  assert.deepEqual(Object.keys(hooks).sort(), ['context', 'prompt']);
  const prompt = { sessionID: 's1', prompt: { text: 'hello' } };
  await hooks.prompt(prompt);
  assert.equal(prompt.prompt.text, 'hello');
  assert.deepEqual(calls, [{ cwd: '/work', host: 'opencode' }]);
  const hit = { sessionID: 's1', system: [] };
  await hooks.context(hit);
  assert.deepEqual(hit.system, [{ type: 'text', text: 'PACING' }]);
  const miss = { sessionID: 's2', system: [] };
  await hooks.context(miss);
  assert.deepEqual(miss.system, []);
});

test('P1 setup falls back to process.cwd and never throws or injects on failures', async () => {
  const calls = [];
  const setup = createKairoPacingSetup({ readContext: async args => { calls.push(args); throw new Error('boom'); } });
  const { hooks, ctx } = fakeCtx(undefined);
  ctx.location = undefined;
  await setup(ctx);
  await hooks.prompt({ sessionID: 's1', prompt: { text: 'x' } });
  assert.equal(calls[0].cwd, process.cwd());
  const event = { sessionID: 's1', system: [] };
  await hooks.context(event);
  assert.deepEqual(event.system, []);
  await hooks.prompt({});
  await hooks.context({});
  const nullSetup = createKairoPacingSetup({ readContext: async () => null });
  const other = fakeCtx();
  await nullSetup(other.ctx);
  await other.hooks.prompt({ sessionID: 's1', prompt: { text: 'x' } });
  const empty = { sessionID: 's1', system: [] };
  await other.hooks.context(empty);
  assert.deepEqual(empty.system, []);
});

test('P2 one refresh per session at a time and a bounded session cache', async () => {
  let running = 0, max = 0, releases = [];
  const setup = createKairoPacingSetup({ maxSessions: 2, readContext: () => new Promise(resolve => {
    running += 1; max = Math.max(max, running);
    releases.push(() => { running -= 1; resolve('T'); });
  }) });
  const { hooks, ctx } = fakeCtx();
  await setup(ctx);
  const first = hooks.prompt({ sessionID: 'a', prompt: { text: '' } });
  const second = hooks.prompt({ sessionID: 'a', prompt: { text: '' } });
  assert.equal(releases.length, 1);
  releases.shift()();
  await Promise.all([first, second]);
  for (const id of ['b', 'c']) {
    const pending = hooks.prompt({ sessionID: id, prompt: { text: '' } });
    releases.shift()();
    await pending;
  }
  assert.equal(max, 1);
  const evicted = { sessionID: 'a', system: [] };
  await hooks.context(evicted);
  assert.deepEqual(evicted.system, []);
  const kept = { sessionID: 'c', system: [] };
  await hooks.context(kept);
  assert.equal(kept.system.length, 1);
});

test('P3 install writes the marked plugin, is idempotent, keeps AGENTS.md section, sync repairs, uninstall removes', async t => {
  const { homeDir, path } = await fixture(t);
  const preview = await installGlobalHarness({ ...options, homeDir, dryRun: true });
  assert.equal(existsSync(path), false);
  assert.ok(preview.configsCreated.includes('.config/opencode/AGENTS.md'));
  await installGlobalHarness({ ...options, homeDir });
  const text = await readFile(path, 'utf8');
  assert.match(text, /Kairo quota pacing \(managed\)/);
  assert.ok(text.includes(JSON.stringify(pathToFileURL(join(packageRoot, 'src/global/hosts/opencode-pacing-plugin.js')).href)));
  assert.match(text, /import \{ Plugin \} from "@opencode\/plugin"/);
  assert.match(text, /Plugin\.define\(\{\s*id: "kairo\.pacing"/);
  assert.ok(hasManagedSection(await readFile(join(homeDir, '.config/opencode/AGENTS.md'), 'utf8')));
  await installGlobalHarness({ ...options, homeDir });
  assert.equal(await readFile(path, 'utf8'), text);
  await writeFile(path, `${text}// outdated\n`);
  const context = buildAdapterContext({ ...options, homeDir });
  const state = await readGlobalState(join(context.paths.root, 'state.json'));
  const drift = await detectGlobalDrift({ homeDir, paths: context.paths, state, packageRoot, context });
  assert.ok(drift.some(check => check.name === 'opencode:pacing' && check.status === 'stale'));
  const synced = await syncGlobalHarness({ ...options, homeDir });
  assert.equal(await readFile(path, 'utf8'), text);
  assert.ok(synced.backups.some(file => file.includes('kairo-pacing.js')));
  await rm(path);
  await syncGlobalHarness({ ...options, homeDir });
  assert.equal(await readFile(path, 'utf8'), text);
  await uninstallGlobalHarness({ homeDir });
  assert.equal(existsSync(path), false);
});

test('P3 an unmarked file at the plugin path is never overwritten or removed', async t => {
  const { homeDir, path } = await fixture(t);
  await mkdir(join(homeDir, '.config/opencode/plugins'), { recursive: true });
  await writeFile(path, '// user plugin\n');
  await installGlobalHarness({ ...options, homeDir });
  assert.equal(await readFile(path, 'utf8'), '// user plugin\n');
  const context = buildAdapterContext({ ...options, homeDir });
  const state = await readGlobalState(join(context.paths.root, 'state.json'));
  const drift = await detectGlobalDrift({ homeDir, paths: context.paths, state, packageRoot, context });
  assert.ok(drift.some(check => check.name === 'opencode:pacing' && check.status === 'warning'));
  await uninstallGlobalHarness({ homeDir });
  assert.equal(await readFile(path, 'utf8'), '// user plugin\n');
});

test('existing OpenCode adapter behavior holds: AGENTS.md section is removed on uninstall, user content kept', async t => {
  const { homeDir } = await fixture(t);
  const agents = join(homeDir, '.config/opencode/AGENTS.md');
  await writeFile(agents, '# Mine\n');
  await installGlobalHarness({ ...options, homeDir });
  assert.ok(hasManagedSection(await readFile(agents, 'utf8')));
  await uninstallGlobalHarness({ homeDir });
  const after = await readFile(agents, 'utf8');
  assert.ok(!hasManagedSection(after));
  assert.match(after, /# Mine/);
});

// Inside OpenCode, process.execPath is the opencode binary; the plugin must run kairo with the Node captured at install.
test('the plugin runs the pacing CLI with the install-time Node path, not the host runtime', async () => {
  const { renderOpenCodePacingPlugin } = await import('../src/global/hosts/opencode-pacing-config.js');
  assert.match(renderOpenCodePacingPlugin(packageRoot, '/opt/node/bin/node'), /createKairoPacingSetup\(\{ nodePath: "\/opt\/node\/bin\/node" \}\)/);
  const calls = [];
  const setup = createKairoPacingSetup({ nodePath: '/opt/node/bin/node', readContext: async args => { calls.push(args); return 'Pacing: ok'; } });
  const hooks = {};
  await setup({ location: { directory: '/repo' }, session: { hook: async (name, fn) => { hooks[name] = fn; } } });
  await hooks.prompt({ sessionID: 's1', prompt: { text: 'hi' } });
  assert.deepEqual(calls, [{ cwd: '/repo', host: 'opencode', execPath: '/opt/node/bin/node' }]);
  const run = async (file) => { calls.push(file); return { stdout: '{}' }; };
  await readPacingContext({ cwd: '/repo', host: 'opencode', execPath: '/opt/node/bin/node', run });
  assert.equal(calls.at(-1), '/opt/node/bin/node');
});

// Regression: real Claude windows are "Current session" and "Current week (all models)"; a name whitelist rejected them all.
test('the pacing text accepts the real provider window names and still rejects unsafe ones', async () => {
  const { buildPacingContext } = await import('../src/global/hosts/pacing-context.js');
  const window = (name) => ({ name, remainingPercent: 37, resetsAt: '2026-10-29T00:49:00.000Z' });
  const snapshot = (names) => ({ ok: true, providers: { claude: { tier: 'CONSERVE', windows: names.map(window), expectedDeadTimeMs: 0 } } });
  const text = buildPacingContext(snapshot(['Current session', 'Current week (all models)']));
  assert.match(text, /claude: Current session 37% \(resets 2026-10-29T00:49:00.000Z\), Current week \(all models\) 37%/);
  assert.equal(buildPacingContext(snapshot(['line\nbreak'])), null);
  assert.equal(buildPacingContext(snapshot([''])), null);
});
