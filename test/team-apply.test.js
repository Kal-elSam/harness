import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile, readdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeProjectStrategy } from '../src/global/team/project-strategy-store.js';

const dirs = [];
test.after(async () => { for (const d of dirs) await rm(d, { recursive: true, force: true }); });

const team = [
  { role: 'Explorer', model: { adapterId: 'claude', modelId: 'haiku' } },
  { role: 'Builder', model: { adapterId: 'claude', modelId: 'sonnet', effort: 'high' } },
  { role: 'Verifier', model: { adapterId: 'claude', modelId: 'opus' } },
  { role: 'Test Runner', model: { adapterId: 'codex', modelId: 'gpt-x' } },
  { role: 'Architect', model: { adapterId: 'claude', modelId: 'opus' } }
];

async function fixture({ approved = true, state = { claude_phase_assignments: { 'sdd-apply': { model: 'sonnet' } } } } = {}) {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'kairo-apply-home-')));
  const root = await realpath(await mkdtemp(join(tmpdir(), 'kairo-apply-root-')));
  dirs.push(home, root);
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
  if (approved) await writeProjectStrategy(home, root, { status: 'active', projectTeam: team });
  const statePath = join(home, '.gentle-ai', 'state.json');
  if (state !== null) {
    await mkdir(join(home, '.gentle-ai'), { recursive: true });
    await writeFile(statePath, typeof state === 'string' ? state : `${JSON.stringify(state, null, 2)}\n`);
  }
  const cli = (...args) => spawnSync(process.execPath, [resolve('bin/kairo.js'), ...args], {
    encoding: 'utf8', cwd: root, env: { ...process.env, HOME: home, HARNESS_HOME: home, XDG_CONFIG_HOME: join(home, '.config') }
  });
  return { home, root, statePath, cli };
}

async function list(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) out.push(join(e.parentPath ?? e.path, e.name));
  return out.sort();
}

const exists = p => readFile(p, 'utf8').then(() => true, () => false);

test('A1 preview prints picks, plans and skipped roles, writes nothing', async () => {
  const h = await fixture();
  const stateBefore = await readFile(h.statePath);
  const filesBefore = await list(h.home);
  const p = h.cli('team', 'apply', '--cwd', h.root);
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stdout, /odd-explorer: Explorer -> haiku/);
  assert.match(p.stdout, /odd-worker: Builder -> sonnet \(high\)/);
  assert.match(p.stdout, /odd-verify: Verifier -> opus/);
  assert.match(p.stdout, /change odd-worker/);
  assert.match(p.stdout, /create .*odd-explorer\.md/);
  assert.match(p.stdout, /unmapped Architect/);
  assert.match(p.stdout, /incompatible Test Runner: .*codex/);
  assert.deepEqual(await list(h.home), filesBefore);
  assert.deepEqual(await readFile(h.statePath), stateBefore);
});

test('A2 --yes writes state odd-* keys and bridge files', async () => {
  const h = await fixture();
  const p = h.cli('team', 'apply', '--yes', '--cwd', h.root);
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stdout, /backup: .*state\.json\.kairo-backup\./);
  const state = JSON.parse(await readFile(h.statePath, 'utf8'));
  assert.deepEqual(state.claude_phase_assignments['odd-explorer'], { model: 'haiku' });
  assert.deepEqual(state.claude_phase_assignments['odd-worker'], { model: 'sonnet', effort: 'high' });
  assert.deepEqual(state.claude_phase_assignments['odd-verify'], { model: 'opus' });
  assert.deepEqual(state.claude_phase_assignments['sdd-apply'], { model: 'sonnet' });
  const worker = await readFile(join(h.home, '.claude', 'agents', 'odd-worker.md'), 'utf8');
  assert.match(worker, /^model: sonnet$/m);
  assert.match(worker, /kairo-bridge: v1 role=odd-worker/);
  assert.match(p.stdout, /create .*odd-verify\.md/);
});

test('A3 refuses without an approved team and writes nothing', async () => {
  const h = await fixture({ approved: false });
  const filesBefore = await list(h.home);
  const p = h.cli('team', 'apply', '--yes', '--cwd', h.root);
  assert.equal(p.status, 1);
  assert.match(p.stderr, /kairo team analyze/);
  assert.match(p.stderr, /kairo team approve/);
  assert.deepEqual(await list(h.home), filesBefore);
});

for (const [name, state] of [['missing', null], ['bad schema', '[1,2]']]) {
  test(`A4 state.json ${name}: refuses, writes neither state nor bridge`, async () => {
    const h = await fixture({ state });
    const filesBefore = await list(h.home);
    const p = h.cli('team', 'apply', '--yes', '--cwd', h.root);
    assert.equal(p.status, 1);
    assert.match(p.stdout, /refused: state\.json/);
    assert.equal(await exists(join(h.home, '.claude', 'agents', 'odd-worker.md')), false);
    assert.deepEqual(await list(h.home), filesBefore);
  });
}

test('A5 --json prints one object with picks, skipped roles, state and bridge', async () => {
  const h = await fixture();
  const p = h.cli('team', 'apply', '--yes', '--json', '--cwd', h.root);
  assert.equal(p.status, 0, p.stderr);
  const out = JSON.parse(p.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.applied, true);
  assert.equal(out.picks['odd-worker'].model, 'sonnet');
  assert.equal(out.unmapped[0].role, 'Architect');
  assert.equal(out.incompatible[0].role, 'Test Runner');
  assert.ok(out.state.backupPath);
  assert.equal(out.bridge.roles.length, 3);
  assert.equal(out.bridge.roles.every(r => r.action === 'create'), true);
});

test('existing team roles init still refuses without an approved team', async () => {
  const h = await fixture({ approved: false });
  const p = h.cli('team', 'roles', 'init', '--cwd', h.root);
  assert.equal(p.status, 1);
  assert.match(p.stdout, /^No approved team for this project\. Analyze and approve a project team first/);
});
