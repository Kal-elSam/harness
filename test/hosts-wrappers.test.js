import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as claude from '../src/global/hosts/claude-code.js';
import { getHost, planRoleFiles, applyRoleFiles, retireRoleFiles, runTeamRolesCli } from '../src/global/hosts/index.js';

async function fixture(t, commands = []) {
  const root = await mkdtemp(join(tmpdir(), 'hosts-wrappers-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  const projectRoot = join(root, 'project');
  const homeDir = join(root, 'home');
  for (const dir of [bin, projectRoot, homeDir]) await mkdir(dir);
  for (const command of commands) await writeFile(join(bin, command), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
  return { projectRoot, homeDir, env: { PATH: bin }, catalog: { registry: {} }, host: 'claude-code' };
}

test('Claude wrappers render dynamic provider execution with managed ownership', () => {
  assert.equal(typeof claude.renderWrapperAgent, 'function');
  for (const provider of ['codex', 'opencode', 'opencode-go', 'opencode-zen', 'cursor', 'gemini']) {
    const rendered = claude.renderWrapperAgent(provider);
    assert.equal(rendered.path, `.claude/agents/kairo-${provider}.md`);
    assert.match(rendered.content, new RegExp(`^---\\nname: kairo-${provider}\\ndescription: .*${provider} models through Kairo.*\\nmodel: haiku\\ntools: Bash\\n---\\n`));
    assert.match(rendered.content, new RegExp(`kairo-role: v1 host=claude-code role=kairo-${provider}`));
    assert.match(rendered.content, /kairo-model:/);
    assert.match(rendered.content, new RegExp(`kairo team exec --provider ${provider} --model`));
    assert.match(rendered.content, /stdin/);
    assert.match(rendered.content, /remaining task bytes unchanged/);
    assert.match(rendered.content, /kairo team route/);
    assert.match(rendered.content, /same provider/);
    assert.match(rendered.content, /return its output unchanged/i);
    assert.equal(getHost('claude-code').renderWrapperAgent(provider).content, rendered.content);
  }
  assert.throws(() => claude.renderWrapperAgent('claude'), /Unsupported wrapper provider/);
  assert.throws(() => claude.renderWrapperAgent('codex; touch bad'), /Unsupported wrapper provider/);
});

test('sync previews only installed executable wrappers and points foreign picks at them', async t => {
  const f = await fixture(t, ['codex', 'cursor-agent', 'gemini']);
  await writeFile(join(f.env.PATH, 'opencode'), 'not executable\n', { mode: 0o644 });
  const catalog = { registry: { review: { description: 'Review a change.' } } };
  const picks = { review: { adapterId: 'codex', model: 'gpt-routed', source: 'route' } };
  const plan = await planRoleFiles({ ...f, catalog, picks });
  assert.deepEqual(plan.roles.filter(r => r.source === 'wrapper').map(r => r.role), ['kairo-codex', 'kairo-cursor', 'kairo-gemini']);
  const foreign = plan.roles.find(r => r.role === 'review');
  assert.equal(foreign.action, 'needs-wrapper');
  assert.equal(foreign.wrapperAgent, 'kairo-codex');
  assert.equal(foreign.path, join(f.projectRoot, '.claude/agents/kairo-codex.md'));
  assert.equal(foreign.model, 'gpt-routed');
  assert.deepEqual(await readdir(f.projectRoot), []);
  assert.equal((await applyRoleFiles({ ...f, catalog, picks })).applied, false);
  assert.deepEqual(await readdir(f.projectRoot), []);
  assert.equal((await planRoleFiles({ ...f, env: {} })).roles.length, 0);
  assert.equal((await planRoleFiles({ ...f, host: 'codex' })).roles.length, 0);
});

test('wrapper updates back up owned files while foreign files and symlinks stay untouched', async t => {
  const f = await fixture(t, ['codex', 'opencode', 'gemini']);
  const dir = join(f.projectRoot, '.claude/agents');
  await mkdir(dir, { recursive: true });
  const codexPath = join(dir, 'kairo-codex.md');
  const old = '<!-- kairo-role: v1 host=claude-code role=kairo-codex -->\nold wrapper\n';
  await writeFile(codexPath, old);
  await writeFile(join(dir, 'kairo-opencode.md'), 'user agent\n');
  const target = join(f.projectRoot, 'target.md');
  await writeFile(target, 'target\n');
  await symlink(target, join(dir, 'kairo-gemini.md'));
  const done = await applyRoleFiles({ ...f, yes: true, now: () => 42 });
  const codex = done.roles.find(r => r.role === 'kairo-codex');
  assert.equal(codex.action, 'update');
  assert.equal(await readFile(codex.backupPath, 'utf8'), old);
  assert.equal(await readFile(codexPath, 'utf8'), claude.renderWrapperAgent('codex').content);
  assert.deepEqual(done.roles.filter(r => ['kairo-opencode', 'kairo-gemini'].includes(r.role)).map(r => r.action), ['skip-foreign', 'skip-foreign']);
  assert.equal(await readFile(join(dir, 'kairo-opencode.md'), 'utf8'), 'user agent\n');
  assert.equal((await lstat(join(dir, 'kairo-gemini.md'))).isSymbolicLink(), true);
  assert.equal(await readFile(target, 'utf8'), 'target\n');
  assert.equal((await applyRoleFiles({ ...f, yes: true })).applied, false);
  assert.equal((await retireRoleFiles({ ...f })).applied, false);
  await retireRoleFiles({ ...f, yes: true });
  assert.equal(await readFile(join(dir, 'kairo-opencode.md'), 'utf8'), 'user agent\n');
  assert.equal((await lstat(join(dir, 'kairo-gemini.md'))).isSymbolicLink(), true);
});

test('roles sync passes injected PATH to wrapper discovery without launching provider CLIs', async t => {
  const f = await fixture(t, ['codex']);
  const deps = { homeDir: f.homeDir, env: f.env, resolveRoot: async () => f.projectRoot,
    readRoute: async () => ({ decision: 'ROUTED', provider: 'claude', model: { modelId: 'sonnet' } }), log: () => {} };
  const preview = await runTeamRolesCli({ rolesAction: 'sync', roleHost: 'claude-code' }, deps);
  assert.equal(preview.hosts[0].roles.find(r => r.role === 'kairo-codex')?.action, 'create');
  assert.deepEqual(await readdir(f.projectRoot), []);
  const applied = await runTeamRolesCli({ rolesAction: 'sync', roleHost: 'claude-code', yes: true }, deps);
  assert.equal(applied.hosts[0].roles.find(r => r.role === 'kairo-codex')?.action, 'create');
  assert.equal(await readFile(join(f.projectRoot, '.claude/agents/kairo-codex.md'), 'utf8'), claude.renderWrapperAgent('codex').content);
});


test('Cursor wrapper discovery rejects unrelated agent executable', async t => {
  const f = await fixture(t, ['agent']);
  assert.deepEqual((await planRoleFiles(f)).roles, []);
});

test('OpenCode subscription routes have wrappers preserving routing identity', async t => {
  const f = await fixture(t, ['opencode']);
  const picks = { review: { adapterId: 'opencode-go', model: 'opencode-go/model', source: 'route' } };
  const plan = await planRoleFiles({ ...f, picks, catalog: { registry: { review: {} } } });
  const target = plan.roles.find(r => r.role === 'review');
  assert.equal(target.wrapperAgent, 'kairo-opencode-go');
  const wrapper = plan.roles.find(r => r.role === target.wrapperAgent);
  assert.equal(wrapper.action, 'create');
  assert.match(wrapper.content, /kairo team exec --provider opencode-go --model/);
});
