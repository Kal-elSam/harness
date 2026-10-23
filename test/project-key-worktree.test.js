import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectKeyForPath } from '../src/global/next/project-key.js';

// Today's key formula for a directory that is not a linked worktree.
function legacyKey(path) {
  return createHash('sha256').update(realpathSync(path).toLowerCase()).digest('hex').slice(0, 16);
}

async function fixture(t) {
  const base = realpathSync(await mkdtemp(join(tmpdir(), 'project-key-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const main = join(base, 'main');
  await mkdir(join(main, '.git', 'worktrees', 'feat'), { recursive: true });
  await writeFile(join(main, '.git', 'worktrees', 'feat', 'commondir'), '../..\n');
  return { base, main };
}

test('main checkout with a .git directory keeps today\'s project key', async t => {
  const { main } = await fixture(t);
  assert.equal(projectKeyForPath(main), legacyKey(main));
});

test('linked worktree resolves to the main checkout project key', async t => {
  const { base, main } = await fixture(t);
  const worktree = join(base, 'wt');
  await mkdir(worktree);
  await writeFile(join(worktree, '.git'), `gitdir: ${join(main, '.git', 'worktrees', 'feat')}\n`);
  assert.equal(projectKeyForPath(worktree), legacyKey(main));
  assert.equal(projectKeyForPath(worktree), projectKeyForPath(main));
  assert.notEqual(projectKeyForPath(worktree), legacyKey(worktree));
});

test('linked worktree with a relative gitdir pointer resolves to the main checkout key', async t => {
  const { base, main } = await fixture(t);
  const worktree = join(base, 'wt');
  await mkdir(worktree);
  await writeFile(join(worktree, '.git'), 'gitdir: ../main/.git/worktrees/feat\n');
  assert.equal(projectKeyForPath(worktree), legacyKey(main));
});

test('broken .git file falls back to today\'s project key', async t => {
  const { base } = await fixture(t);
  const broken = join(base, 'broken');
  await mkdir(broken);
  await writeFile(join(broken, '.git'), 'not a gitdir pointer\n');
  assert.equal(projectKeyForPath(broken), legacyKey(broken));
});

test('gitdir pointer without a readable commondir falls back to today\'s project key', async t => {
  const { base } = await fixture(t);
  const orphan = join(base, 'orphan');
  await mkdir(orphan);
  await writeFile(join(orphan, '.git'), `gitdir: ${join(base, 'missing', '.git', 'worktrees', 'x')}\n`);
  assert.equal(projectKeyForPath(orphan), legacyKey(orphan));
});

test('non-git directory keeps today\'s project key', async t => {
  const { base } = await fixture(t);
  const plain = join(base, 'plain');
  await mkdir(plain);
  assert.equal(projectKeyForPath(plain), legacyKey(plain));
});
