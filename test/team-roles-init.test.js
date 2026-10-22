import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture, tree } from './team-route-fixture.test.js';
import { writeProjectStrategy } from '../src/global/team/project-strategy-store.js';

async function setup(t) {
  const f = await fixture(t);
  const put = async (base, path, content) => {
    const target = join(base, path);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, content);
  };
  const md = (name, model, body = '') => `---\nname: ${name}\ndescription: Installed agent\n${model ? `model: ${model}\n` : ''}---\n${body}\n`;
  const cli = (...args) => spawnSync(process.execPath, [resolve('bin/kairo.js'), 'team', 'roles', 'init', '--cwd', f.cwd, '--json', ...args], {
    encoding: 'utf8', env: { ...process.env, HOME: f.home, HARNESS_HOME: f.home, XDG_CONFIG_HOME: join(f.home, '.config') }
  });
  return { ...f, put, md, cli, roles: join(f.cwd, '.kairo/roles.json') };
}
function result(f, ...args) {
  const p = f.cli(...args);
  assert.equal(p.status, 0, p.stdout + p.stderr);
  return JSON.parse(p.stdout);
}

test('init previews native and wrapper Builders; researchers remain explicitly unmapped', async t => {
  const f = await setup(t);
  await f.put(f.home, '.claude/agents/team-builder.md', f.md('team-builder', 'sonnet'));
  await f.put(f.cwd, '.claude/agents/team-builder-codex.md', f.md('team-builder-codex', '', 'Run `codex exec "$TASK"`.'));
  await f.put(f.home, '.claude/agents/team-researcher.md', f.md('team-researcher', 'opus'));
  await f.put(f.cwd, '.claude/agents/team-researcher-codex.md', f.md('team-researcher-codex', '', 'codex exec task'));
  const before = await tree(f.home);
  const out = result(f);
  assert.equal(out.applied, false);
  assert.deepEqual(out.roles, [{ id: 'Builder', agents: [{ name: 'team-builder', adapterId: 'claude' }, { name: 'team-builder-codex', adapterId: 'codex' }] }]);
  assert.equal(out.unmapped.length, 2);
  assert.ok(out.unmapped.every(a => /researcher.*catalog/i.test(a.reason)));
  assert.deepEqual(await tree(f.home), before);
});

test('init ignores Kairo markers, reports unknown providers and ambiguous role tokens', async t => {
  const f = await setup(t);
  await f.put(f.cwd, '.claude/agents/managed.md', f.md('team-builder', 'sonnet', '<!-- kairo-role: v1 host=claude-code role=builder -->'));
  await f.put(f.cwd, '.codex/agents/bridge.toml', '# kairo-bridge\nname = "team-builder"\nmodel = "gpt-5"');
  await f.put(f.cwd, '.claude/agents/unknown.md', f.md('team-builder', 'inherit'));
  await f.put(f.cwd, '.claude/agents/mixed.md', f.md('team-builder-reviewer', 'sonnet'));
  const out = result(f);
  assert.deepEqual(out.roles, []);
  assert.equal(out.unmapped.length, 2);
  assert.match(out.unmapped.find(a => a.name === 'team-builder').reason, /unknown provider/i);
  assert.match(out.unmapped.find(a => a.name === 'team-builder-reviewer').reason, /ambiguous/i);
});

test('init scans every supported host at user and project scope', async t => {
  const f = await setup(t);
  const paths = ['.claude/agents', '.codex/agents', '.opencode/agents', '.cursor/agents', '.gemini/agents'];
  for (const base of [f.home, f.cwd]) {
    for (const [i, dir] of paths.entries()) {
      const name = `team-builder-${i}-${base === f.home ? 'user' : 'project'}`;
      await f.put(base, `${dir}/${name}.${i === 1 ? 'toml' : 'md'}`, i === 1
        ? `name = "${name}"\ndescription = "Builder"\nmodel = "gpt-5"\ndeveloper_instructions = "Build"\n`
        : f.md(name, i === 2 ? 'custom-provider/model-a' : i === 4 ? 'gemini-2.5-pro' : 'claude-sonnet-4'));
    }
  }
  await f.put(f.home, '.config/opencode/agents/team-builder-config.md', f.md('team-builder-config', 'openai/gpt-5'));
  const out = result(f);
  assert.equal(out.roles[0].agents.length, 11);
  assert.equal(out.roles[0].agents.find(a => a.name === 'team-builder-config').adapterId, 'openai');
  assert.equal(out.roles[0].agents.find(a => a.name === 'team-builder-2-user').adapterId, 'custom-provider');
});

test('init refuses absent, suggested and stale teams without writes', async t => {
  const f = await setup(t);
  await f.put(f.cwd, '.claude/agents/team-builder.md', f.md('team-builder', 'sonnet'));
  await writeFile(f.path.replace('routing-input-cache.json', 'project-strategy.json'), '{}');
  assert.notEqual(f.cli('--yes').status, 0);
  for (const status of ['suggested', 'stale', 'active']) {
    await writeProjectStrategy(f.home, f.cwd, { ...f.strategy, status, projectTeam: status === 'active' ? [] : f.strategy.projectTeam });
    const before = await tree(f.home);
    const p = f.cli('--yes');
    assert.notEqual(p.status, 0);
    assert.match(JSON.parse(p.stdout).error, /analy.*approv/i);
    assert.deepEqual(await tree(f.home), before);
  }
});

test('--yes merges custom fields, adds only missing agents, backs up safely and is idempotent', async t => {
  const f = await setup(t);
  const original = { version: 99, roles: [{ id: 'My Custom', description: 'Mine', extends: 'Builder', note: { keep: true }, agents: ['custom-agent'] }, { id: 'Builder', description: 'My builder', agents: [{ name: 'mine', adapterId: 'claude', extra: true }] }] };
  await f.put(f.cwd, '.kairo/roles.json', JSON.stringify(original));
  await f.put(f.cwd, '.claude/agents/team-builder.md', f.md('team-builder', 'sonnet'));
  await f.put(f.cwd, '.claude/agents/custom-agent.md', f.md('custom-agent', 'gpt-5'));
  const first = result(f, '--yes');
  assert.equal(first.applied, true);
  assert.deepEqual(JSON.parse(await readFile(first.backupPath, 'utf8')), original);
  const saved = JSON.parse(await readFile(f.roles, 'utf8'));
  assert.equal(saved.version, 99);
  assert.deepEqual(saved.roles[0], original.roles[0]);
  assert.deepEqual(saved.roles[1], { ...original.roles[1], agents: [...original.roles[1].agents, { name: 'team-builder', adapterId: 'claude' }] });
  assert.ok(first.conflicts.some(c => /custom-agent/.test(c.reason)));
  const before = await tree(f.home);
  assert.equal(result(f, '--yes').applied, false);
  assert.deepEqual(await tree(f.home), before);
  assert.equal((await readdir(join(f.cwd, '.kairo'))).filter(n => n.includes('backup')).length, 1);
});

test('--yes creates role catalog and second run leaves bytes unchanged', async t => {
  const f = await setup(t);
  await f.put(f.cwd, '.claude/agents/team-builder.md', f.md('team-builder', 'sonnet'));
  assert.equal(result(f, '--yes').applied, true);
  assert.deepEqual(JSON.parse(await readFile(f.roles, 'utf8')), { roles: [{ id: 'Builder', agents: [{ name: 'team-builder', adapterId: 'claude' }] }] });
  const before = await tree(f.home);
  assert.equal(result(f, '--yes').applied, false);
  assert.deepEqual(await tree(f.home), before);
});


test('exact catalog aliases win over role tokens; wrappers use their execution provider', async t => {
  const f = await setup(t);
  await writeProjectStrategy(f.home, f.cwd, { ...f.strategy, projectTeam: [...f.strategy.projectTeam, { role: 'Explorer', model: f.model }] });
  await f.put(f.cwd, '.kairo/roles.json', JSON.stringify({ roles: [{ id: 'Explorer', agents: ['team-builder-alias'] }] }));
  await f.put(f.cwd, '.claude/agents/alias.md', f.md('team-builder-alias', 'sonnet'));
  for (const [name, body, provider] of [
    ['team-builder-opencode', 'opencode run task', 'opencode'],
    ['team-builder-cursor', 'cursor-agent --print task', 'cursor'],
    ['team-builder-gemini', 'gemini --prompt task', 'gemini']
  ]) {
    await f.put(f.cwd, `.claude/agents/${name}.md`, f.md(name, 'sonnet', body));
  }
  await f.put(f.cwd, '.claude/agents/Explorer.md', f.md('Explorer', 'haiku'));
  const out = result(f);
  assert.ok(out.conflicts.some(a => a.name === 'team-builder-alias'));
  assert.deepEqual(out.roles.find(r => r.id === 'Explorer').agents, ['team-builder-alias', { name: 'Explorer', adapterId: 'claude' }]);
  for (const provider of ['opencode', 'cursor', 'gemini']) assert.ok(out.roles.find(r => r.id === 'Builder').agents.some(a => a.adapterId === provider));
});

test('unapproved role tokens and unmatched names are reported, not invented', async t => {
  const f = await setup(t);
  await f.put(f.cwd, '.claude/agents/team-reviewer.md', f.md('team-reviewer', 'sonnet'));
  await f.put(f.cwd, '.claude/agents/unknown.md', f.md('unfamiliar-agent', 'sonnet'));
  const out = result(f, '--yes');
  assert.deepEqual(out.roles, []);
  assert.equal(out.applied, false);
  assert.match(out.unmapped.find(a => a.name === 'team-reviewer').reason, /not in.*approved/);
  assert.match(out.unmapped.find(a => a.name === 'unfamiliar-agent').reason, /No matching/);
});
