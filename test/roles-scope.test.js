import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture, tree } from './team-route-fixture.test.js';
import { writeProjectStrategy } from '../src/global/team/project-strategy-store.js';

const owned = ['review-risk', 'review-resilience', 'review-readability', 'review-reliability', 'review-refuter', 'jd-judge-a', 'jd-judge-b', 'jd-fix-agent'];
async function setup(t) {
  const f = await fixture(t);
  f.strategy.projectTeam.push({ role: 'Reviewer', model: f.model }, { role: 'Security Reviewer', model: f.model }, { role: 'Test Runner', model: f.model }, { role: 'Explorer', model: f.model });
  await writeProjectStrategy(f.home, f.cwd, f.strategy);
  const bin = join(f.home, 'bin');
  await mkdir(bin);
  await writeFile(join(bin, 'codex'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const cli = (...args) => {
    const p = spawnSync(process.execPath, [resolve('bin/kairo.js'), 'team', ...args, '--cwd', f.cwd, '--json'], {
      encoding: 'utf8', env: { ...process.env, HOME: f.home, HARNESS_HOME: f.home, PATH: `${bin}:${process.env.PATH ?? ''}`, XDG_CONFIG_HOME: join(f.home, '.config') }
    });
    assert.equal(p.status, 0, p.stdout + p.stderr);
    return JSON.parse(p.stdout);
  };
  const agent = async name => {
    await mkdir(join(f.cwd, '.claude/agents'), { recursive: true });
    await writeFile(join(f.cwd, '.claude/agents', `${name}.md`), `---\nname: ${name}\nmodel: sonnet\n---\nTask\n`);
  };
  return { ...f, cli, agent };
}

test('gentle-ai launch actors stay outside init, sync and route', async t => {
  const f = await setup(t);
  for (const name of owned) await f.agent(name);
  const before = await tree(f.cwd);
  const init = f.cli('roles', 'init', '--yes');
  assert.deepEqual(init.roles, []);
  const sync = f.cli('roles', 'sync', '--host', 'claude-code');
  for (const name of owned) {
    const row = sync.hosts[0].roles.find(row => row.role === name);
    assert.equal(row.action, 'skipped');
    assert.equal(row.reason, 'owned by gentle-ai');
    const route = f.cli('route', '--agent', name);
    assert.equal(route.decision, 'NOT_ROUTED');
    assert.equal(route.why, 'owned by gentle-ai');
    assert.equal(route.targetAgent, null);
  }
  assert.deepEqual(await tree(f.cwd), before);
  await mkdir(join(f.cwd, '.kairo'), { recursive: true });
  await writeFile(join(f.cwd, '.kairo/roles.json'), JSON.stringify({ roles: [{ id: 'review-risk', agents: ['custom-risk-reviewer'] }] }));
  await f.agent('custom-risk-reviewer');
  assert.deepEqual(f.cli('roles', 'init').conflicts, []);
  assert.equal(f.cli('route', '--agent', 'custom-risk-reviewer').decision, 'NOT_ROUTED');
});

test('work aliases map at init and route; approved work roles get sync plans', async t => {
  const f = await setup(t);
  const aliases = { 'team-builder': 'Builder', 'team-builder-codex': 'Builder', 'odd-worker': 'odd-worker', 'team-test-runner': 'Test Runner', 'team-explorer': 'Explorer' };
  for (const name of Object.keys(aliases)) await f.agent(name);
  const init = f.cli('roles', 'init', '--yes');
  assert.deepEqual(init.unmapped, []);
  for (const [name, role] of Object.entries(aliases)) {
    assert.ok(init.roles.find(r => r.id === role)?.agents.some(a => a.name === name), name);
    assert.equal(f.cli('route', '--agent', name).decision, 'STALE');
  }
  const sync = f.cli('roles', 'sync', '--host', 'claude-code');
  for (const role of ['Builder', 'Backend Builder', 'Frontend Builder', 'odd-worker', 'Test Runner', 'Explorer']) {
    assert.ok(['create', 'needs-wrapper'].includes(sync.hosts[0].roles.find(row => row.role === role).action), role);
  }
  f.strategy.projectTeam = [{ role: 'Backend Builder', model: f.model }, { role: 'Frontend Builder', model: f.model }];
  await writeProjectStrategy(f.home, f.cwd, f.strategy);
  assert.equal(f.cli('route', '--agent', 'team-builder').decision, 'STALE');
  assert.equal(f.cli('route', '--agent', 'odd-worker').decision, 'STALE');
  await writeFile(join(f.cwd, '.kairo/roles.json'), JSON.stringify({ roles: [] }));
  const splitInit = f.cli('roles', 'init');
  assert.deepEqual(splitInit.unmapped.filter(row => ['team-builder', 'team-builder-codex', 'odd-worker'].includes(row.name)), []);
});

test('sync writes short context guidance to native agents and transport wrappers', async t => {
  const f = await setup(t);
  f.strategy.projectTeam[0].model = { adapterId: 'claude', modelId: 'sonnet' };
  await writeProjectStrategy(f.home, f.cwd, f.strategy);
  const out = f.cli('roles', 'sync', '--host', 'claude-code', '--yes');
  const files = out.hosts[0].roles.filter(row => ['create', 'update'].includes(row.action));
  assert.ok(files.some(row => row.role === 'Builder'));
  assert.ok(files.some(row => row.source === 'wrapper'), 'installed provider CLI exposes a wrapper');
  for (const row of files) {
    const content = await readFile(row.path, 'utf8');
    const section = content.match(/## Context tools\n([\s\S]*?)(?=\n\n|$)/)?.[0];
    assert.ok(section, row.role);
    assert.ok(section.split('\n').length < 10);
    for (const name of ['CodeGraph', 'Engram', 'Graphify', 'RTK']) assert.ok(section.includes(name));
    assert.match(section, /before broad/);
    assert.match(section, /needed line ranges/);
  }
});

test('unrelated sync no-route output remains unchanged', async t => {
  const f = await setup(t);
  const out = f.cli('roles', 'sync', '--host', 'claude-code');
  assert.deepEqual(out.hosts[0].roles.find(row => row.role === 'DevOps'), { role: 'DevOps', host: 'claude-code', action: 'no-route' });
});
