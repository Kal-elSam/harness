import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { planRoleFiles as planFiles, applyRoleFiles as applyFiles, retireRoleFiles } from '../src/global/hosts/index.js';
import { fixture, tree } from './team-route-fixture.test.js';

const catalog = { registry: { 'odd-worker': { description: 'Implements one bounded unit.' }, 'odd-verify': { description: 'Verifies.' } } };
const picks = {
  'odd-worker': { adapterId: 'claude', model: 'son-a', source: 'route' },
  'odd-verify': { adapterId: 'codex', model: 'gpt-a', source: 'approved-fallback' }
};
const planRoleFiles = options => planFiles({ env: {}, ...options });
const applyRoleFiles = options => applyFiles({ env: {}, ...options });
async function project(t) {
  const root = await mkdtemp(join(tmpdir(), 'hosts-sync-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
const worker = root => join(root, '.claude', 'agents', 'odd-worker.md');

async function cliEnv(f) {
  const bin = join(f.home, 'cli-bin');
  await mkdir(bin);
  await symlink('/usr/bin/git', join(bin, 'git'));
  return { ...process.env, HARNESS_HOME: f.home, PATH: bin };
}

test('preview writes nothing and reports per-file source', async t => {
  const root = await project(t);
  const plan = await planRoleFiles({ host: 'claude-code', projectRoot: root, catalog, picks });
  assert.equal(plan.applied, false);
  const byRole = Object.fromEntries(plan.roles.map(r => [r.role, r]));
  assert.equal(byRole['odd-worker'].action, 'create');
  assert.equal(byRole['odd-worker'].source, 'route');
  assert.equal(byRole['odd-verify'].action, 'needs-wrapper');
  assert.deepEqual(await readdir(root), []);
  const noYes = await applyRoleFiles({ host: 'claude-code', projectRoot: root, catalog, picks });
  assert.equal(noYes.applied, false);
  assert.deepEqual(await readdir(root), []);
});

test('apply writes marked files; second apply is unchanged', async t => {
  const root = await project(t);
  const done = await applyRoleFiles({ host: 'claude-code', projectRoot: root, catalog, picks, yes: true });
  assert.equal(done.applied, true);
  assert.match(await readFile(worker(root), 'utf8'), /kairo-role: v1 host=claude-code role=odd-worker/);
  const again = await applyRoleFiles({ host: 'claude-code', projectRoot: root, catalog, picks, yes: true });
  assert.equal(again.applied, false);
  assert.equal(again.roles.find(r => r.role === 'odd-worker').action, 'unchanged');
});

test('update keeps an exclusive backup', async t => {
  const root = await project(t);
  await applyRoleFiles({ host: 'claude-code', projectRoot: root, catalog, picks, yes: true });
  const old = await readFile(worker(root), 'utf8');
  const next = { ...picks, 'odd-worker': { adapterId: 'claude', model: 'son-b', source: 'route' } };
  const res = await applyRoleFiles({ host: 'claude-code', projectRoot: root, catalog, picks: next, yes: true, now: () => 42 });
  const entry = res.roles.find(r => r.role === 'odd-worker');
  assert.equal(entry.action, 'update');
  assert.match(entry.backupPath, /odd-worker\.md\.kairo-backup\.42$/);
  assert.equal(await readFile(entry.backupPath, 'utf8'), old);
  assert.match(await readFile(worker(root), 'utf8'), /model: son-b/);
});

test('foreign file and symlink are untouched by apply and retire', async t => {
  const root = await project(t);
  const dir = join(root, '.claude', 'agents');
  await mkdir(dir, { recursive: true });
  await writeFile(worker(root), 'mine\n');
  const target = join(root, 'elsewhere.md');
  await writeFile(target, 'target\n');
  const linkPicks = { 'odd-verify': { adapterId: 'claude', model: 'son-a', source: 'route' } };
  await symlink(target, join(dir, 'odd-verify.md'));
  const plan = await planRoleFiles({ host: 'claude-code', projectRoot: root, catalog, picks: { ...picks, ...linkPicks } });
  assert.deepEqual(plan.roles.map(r => r.action), ['skip-foreign', 'skip-foreign']);
  await applyRoleFiles({ host: 'claude-code', projectRoot: root, catalog, picks: { ...picks, ...linkPicks }, yes: true });
  await retireRoleFiles({ host: 'claude-code', projectRoot: root, yes: true });
  assert.equal(await readFile(worker(root), 'utf8'), 'mine\n');
  assert.equal((await lstat(join(dir, 'odd-verify.md'))).isSymbolicLink(), true);
  assert.equal(await readFile(target, 'utf8'), 'target\n');
});

test('retire removes only marked files and previews without yes', async t => {
  const root = await project(t);
  await applyRoleFiles({ host: 'claude-code', projectRoot: root, catalog, picks, yes: true });
  await writeFile(join(root, '.claude', 'agents', 'keep.md'), 'keep\n');
  const preview = await retireRoleFiles({ host: 'claude-code', projectRoot: root });
  assert.equal(preview.applied, false);
  assert.deepEqual(preview.roles.map(r => [r.role, r.action]), [['odd-worker', 'remove']]);
  assert.ok((await readdir(join(root, '.claude', 'agents'))).includes('odd-worker.md'));
  const done = await retireRoleFiles({ host: 'claude-code', projectRoot: root, yes: true });
  assert.equal(done.applied, true);
  assert.deepEqual(await readdir(join(root, '.claude', 'agents')), ['keep.md']);
});

test('hosts without a role dir report unsupported', async t => {
  const root = await project(t);
  const plan = await planRoleFiles({ host: 'kimi', projectRoot: root, catalog, picks });
  assert.ok(plan.roles.every(r => r.action === 'unsupported' && r.reason === 'no-model-field'));
  assert.deepEqual(await readdir(root), []);
});

test('roles without a pick are listed as no-route', async t => {
  const root = await project(t);
  const plan = await planRoleFiles({ host: 'claude-code', projectRoot: root, catalog, picks: { 'odd-worker': picks['odd-worker'] } });
  assert.equal(plan.roles.find(r => r.role === 'odd-verify').action, 'no-route');
});

test('CLI sync previews by default and writes with --yes; retire removes', async t => {
  const f = await fixture(t);
  await f.cache();
  const env = await cliEnv(f);
  const run = (...args) => spawnSync(process.execPath, [resolve('bin/kairo.js'), 'team', 'roles', ...args, '--cwd', f.cwd, '--json'], { env, encoding: 'utf8' });
  const before = await tree(f.cwd);
  const preview = run('sync', '--host', 'all');
  assert.equal(preview.status, 0, `${preview.stdout}\n${preview.stderr}`);
  const doc = JSON.parse(preview.stdout);
  assert.equal(doc.applied, false);
  const files = doc.hosts.flatMap(h => h.roles).filter(r => r.action === 'create');
  assert.ok(files.length > 0, preview.stdout);
  assert.ok(files.every(r => r.source === 'route'));
  assert.deepEqual(await tree(f.cwd), before);
  const applied = JSON.parse(run('sync', '--host', 'all', '--yes').stdout);
  assert.equal(applied.applied, true);
  assert.notDeepEqual(await tree(f.cwd), before);
  const retired = JSON.parse(run('retire', '--host', 'all', '--yes').stdout);
  assert.equal(retired.applied, true);
  assert.deepEqual(await tree(f.cwd), before);
});

test('CLI rejects an unknown host and unknown action', async t => {
  const f = await fixture(t);
  const env = await cliEnv(f);
  const run = (...args) => spawnSync(process.execPath, [resolve('bin/kairo.js'), 'team', 'roles', ...args, '--cwd', f.cwd, '--json'], { env, encoding: 'utf8' });
  assert.notEqual(run('sync', '--host', 'nope').status, 0);
  assert.notEqual(run('bogus').status, 0);
});
