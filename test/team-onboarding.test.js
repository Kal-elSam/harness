import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { tree } from './team-route-fixture.test.js';
import { writeProjectStrategy } from '../src/global/team/project-strategy-store.js';

const asks = {
  not_git: ['Git repository', 'git init'],
  no_team: ['no approved Kairo team', 'session default model', 'Before any other work', 'one question', 'kairo team analysts', 'kairo team analyze --analyst CHOICE --yes', 'kairo team show', 'approval', 'kairo team approve --yes', 'do not ask again this session'],
  suggested: ['not approved', 'review and approve', 'kairo team show', 'kairo team approve --yes'],
  stale: ['stale', 're-analyze', 'kairo team analysts', 'kairo team analyze --analyst CHOICE --yes'],
};

for (const state of ['not_git', 'no_team', 'suggested', 'stale', 'active']) {
  test(`onboarding CLI reports ${state} without changing project state`, async t => {
    const home = await realpath(await mkdtemp(join(tmpdir(), 'team-onboarding-')));
    t.diagnostic(`scratch: ${home} (removed after test)`);
    t.after(() => rm(home, { recursive: true, force: true }));
    const cwd = join(home, 'project');
    await mkdir(cwd);
    if (state !== 'not_git') execFileSync('git', ['init', '-q', cwd]);
    if (['suggested', 'stale', 'active'].includes(state)) {
      await writeProjectStrategy(home, cwd, { status: state, projectTeam: [] });
    }
    const before = await tree(home);
    const result = spawnSync(process.execPath, [resolve('bin/kairo.js'), 'team', 'onboarding', '--json', '--cwd', cwd], {
      encoding: 'utf8', env: { ...process.env, HARNESS_HOME: home, GIT_CEILING_DIRECTORIES: home },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.deepEqual(await tree(home), before, 'onboarding is read-only');
    const value = JSON.parse(result.stdout);
    assert.equal(value.ok, true);
    assert.equal(value.state, state);
    if (state === 'active') assert.equal(value.ask, null);
    else {
      assert.equal(typeof value.ask, 'string');
      assert.ok(!value.ask.includes('\n'), 'ask is one paragraph');
      for (const text of asks[state]) assert.ok(value.ask.includes(text), `ask includes ${text}`);
    }
  });
}
