import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOST_IDS, getHost } from '../src/global/hosts/index.js';

const role = { id: 'odd-worker', description: 'Implements one bounded unit.' };
const pickFor = adapterId => ({ adapterId, model: 'm-1', source: 'route' });

test('registry lists the seven hosts', () => {
  assert.deepEqual([...HOST_IDS].sort(), ['claude-code', 'codex', 'cursor', 'gemini', 'kimi', 'opencode', 'pi']);
  for (const id of HOST_IDS) assert.equal(getHost(id).id, id);
});

test('claude-code renders .claude/agents/<id>.md', () => {
  const out = getHost('claude-code').renderRoleFile(role, pickFor('claude'));
  assert.equal(out.path, '.claude/agents/odd-worker.md');
  assert.match(out.content, /^---\nname: odd-worker\ndescription: .*\nmodel: m-1\n---\n/);
  assert.match(out.content, /<!-- kairo-role: v1 host=claude-code role=odd-worker -->/);
});

test('codex renders .codex/agents/<id>.toml', () => {
  const out = getHost('codex').renderRoleFile(role, pickFor('codex'));
  assert.equal(out.path, '.codex/agents/odd-worker.toml');
  assert.match(out.content, /^name = "odd-worker"$/m);
  assert.match(out.content, /^description = ".*"$/m);
  assert.match(out.content, /^developer_instructions = ".*"$/m);
  assert.match(out.content, /^model = "m-1"$/m);
  assert.match(out.content, /# kairo-role: v1 host=codex role=odd-worker/);
});

test('opencode renders .opencode/agents/<id>.md with provider/model', () => {
  const out = getHost('opencode').renderRoleFile(role, pickFor('claude'));
  assert.equal(out.path, '.opencode/agents/odd-worker.md');
  assert.match(out.content, /^---\ndescription: .*\nmode: subagent\nmodel: anthropic\/m-1\n---\n/);
  assert.match(getHost('opencode').renderRoleFile(role, { adapterId: 'codex', model: 'gpt-x' }).content, /model: openai\/gpt-x/);
  assert.match(getHost('opencode').renderRoleFile(role, { adapterId: 'opencode', model: 'groq/llama' }).content, /model: groq\/llama/);
});

test('cursor renders .cursor/agents/<id>.md', () => {
  const out = getHost('cursor').renderRoleFile(role, pickFor('cursor'));
  assert.equal(out.path, '.cursor/agents/odd-worker.md');
  assert.match(out.content, /^---\nname: odd-worker\ndescription: .*\nmodel: m-1\n---\n/);
});

test('gemini renders .gemini/agents/<id>.md with kind: local', () => {
  const out = getHost('gemini').renderRoleFile(role, pickFor('gemini'));
  assert.equal(out.path, '.gemini/agents/odd-worker.md');
  assert.match(out.content, /^---\nname: odd-worker\ndescription: .*\nkind: local\nmodel: m-1\n---\n/);
});

test('kimi and pi cannot hold a role file', () => {
  const kimi = getHost('kimi').renderRoleFile(role, pickFor('kimi'));
  assert.equal(kimi.path, null);
  assert.equal(kimi.reason, 'no-model-field');
  const pi = getHost('pi').renderRoleFile(role, pickFor('pi'));
  assert.equal(pi.path, null);
  assert.equal(pi.reason, 'owned-by-gentle-pi');
});

test('non-native pick needs a wrapper', () => {
  for (const [host, foreign] of [['claude-code', 'codex'], ['codex', 'claude'], ['cursor', 'claude'], ['gemini', 'codex']]) {
    const out = getHost(host).renderRoleFile(role, pickFor(foreign));
    assert.equal(out.path, null, host);
    assert.equal(out.reason, 'needs-wrapper', host);
  }
});

test('role ids become safe file names', () => {
  const out = getHost('claude-code').renderRoleFile({ id: '../Data Wrangler', description: 'x' }, pickFor('claude'));
  assert.equal(out.path, '.claude/agents/data-wrangler.md');
});

test('capabilities follow the host matrix; unverified is never true', () => {
  const caps = id => getHost(id).capabilities();
  assert.deepEqual(caps('claude-code'), { namedRoles: true, roleModelField: true, perLaunchModel: true, launchHook: true, nativeProviders: ['claude'], roleDir: '.claude/agents' });
  assert.equal(caps('codex').launchHook, 'unverified');
  assert.equal(caps('codex').perLaunchModel, 'unverified');
  assert.equal(caps('opencode').launchHook, 'unverified');
  assert.deepEqual(caps('opencode').nativeProviders, ['*']);
  assert.equal(caps('cursor').launchHook, false);
  assert.equal(caps('cursor').perLaunchModel, false);
  assert.equal(caps('gemini').launchHook, 'unverified');
  assert.equal(caps('kimi').roleModelField, false);
  assert.equal(caps('kimi').roleDir, null);
  assert.equal(caps('pi').launchHook, 'unverified');
  assert.equal(caps('pi').roleDir, null);
  for (const id of HOST_IDS) for (const [key, value] of Object.entries(caps(id))) {
    assert.ok(value === true || value === false || value === 'unverified' || Array.isArray(value) || typeof value === 'string' || value === null, `${id}.${key}`);
  }
});

test('detect reports evidence from home and project dirs', async t => {
  const home = await mkdtemp(join(tmpdir(), 'hosts-detect-'));
  const project = await mkdtemp(join(tmpdir(), 'hosts-detect-p-'));
  t.after(() => Promise.all([rm(home, { recursive: true, force: true }), rm(project, { recursive: true, force: true })]));
  assert.equal((await getHost('gemini').detect({ homeDir: home, projectRoot: project, env: {} })).installed, false);
  await mkdir(join(project, '.gemini'));
  const found = await getHost('gemini').detect({ homeDir: home, projectRoot: project, env: {} });
  assert.equal(found.installed, true);
  assert.ok(found.evidence.length > 0);
  await mkdir(join(home, '.claude'));
  assert.equal((await getHost('claude-code').detect({ homeDir: home, projectRoot: project, env: {} })).installed, true);
  assert.equal((await getHost('codex').detect({ homeDir: home, projectRoot: project, env: {} })).installed, false);
});
