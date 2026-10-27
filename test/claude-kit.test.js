import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, lstat, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  KIT_AGENTS, KIT_PARITY, CLAUDE_MD_START, CLAUDE_MD_END,
  renderKitAgent, kitAgentForRole, renderClaudeMdSection, planClaudeKit, applyClaudeKit
} from '../src/global/hosts/claude-kit.js';
import { renderWrapperAgent } from '../src/global/hosts/claude-code.js';
import { ROLE_REGISTRY } from '../src/global/intelligence/role-registry.js';
import { loadProjectRoleCatalog, agentNameToRole, isGentleOwnedActor, kairoAgentName } from '../src/global/intelligence/role-catalog.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const kairoBin = join(packageRoot, 'bin/kairo.js');

async function fixture(t, commands = []) {
  const root = await mkdtemp(join(tmpdir(), 'claude-kit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  const homeDir = join(root, 'home');
  await mkdir(bin);
  await mkdir(join(homeDir, '.claude'), { recursive: true });
  for (const command of commands) await writeFile(join(bin, command), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
  return { root, bin, homeDir, env: { PATH: bin } };
}

const agentsDir = home => join(home, '.claude', 'agents');
const claudeMd = home => join(home, '.claude', 'CLAUDE.md');
const CORE_NAMES = ['kairo-architect', 'kairo-builder', 'kairo-deliverer', 'kairo-explorer', 'kairo-reviewer', 'kairo-tester'];
const NAMES = KIT_AGENTS.map(a => a.name).sort();

test('kit lists the six core agents plus one per catalog role and never a gentle-ai actor', () => {
  assert.deepEqual(KIT_AGENTS.map(a => a.name).sort(), [...new Set([...CORE_NAMES, ...Object.keys(ROLE_REGISTRY).map(kairoAgentName)])].sort());
  for (const agent of KIT_AGENTS) {
    assert.equal(isGentleOwnedActor(agent.name), false);
    assert.equal(isGentleOwnedActor(agent.role), false);
  }
  const catalog = loadProjectRoleCatalog({});
  const { byAgent } = agentNameToRole(catalog);
  assert.deepEqual(CORE_NAMES.map(name => byAgent.get(name)),
    ['Architect', 'Builder', 'Deliverer', 'Explorer', 'Reviewer', 'Tester']);
  for (const agent of KIT_AGENTS) assert.equal(byAgent.get(agent.name), agent.role, agent.name);
});

test('every catalog role renders its own agent named kairo- plus the kebab-case role', () => {
  for (const [role, entry] of Object.entries(ROLE_REGISTRY)) {
    const name = kairoAgentName(role);
    const { content } = renderKitAgent(name);
    assert.match(content, new RegExp(`^---\\nname: ${name}\\n`), name);
    assert.match(content, new RegExp(`\\nmodel: ${entry.tier === 'light' ? 'haiku' : 'sonnet'}\\n`), name);
    assert.match(content, /Do NOT launch sub-agents/, name);
    assert.match(content, /## Context tools/, name);
  }
  assert.equal(kairoAgentName('Backend Builder'), 'kairo-backend-builder');
  const tools = name => renderKitAgent(name).content.split('\n').find(l => l.startsWith('tools:'));
  assert.match(tools('kairo-debugger'), /Edit, Write/);
  assert.doesNotMatch(tools('kairo-security-reviewer'), /Edit|Write/);
  assert.equal(tools('kairo-verifier'), 'tools: Bash, Read');
  assert.match(renderKitAgent('kairo-debugger').content, /root cause|Investigate|bug/i);
});

test('the six core agents render byte-for-byte as before', () => {
  const digest = name => createHash('sha256').update(renderKitAgent(name).content).digest('hex').slice(0, 16);
  assert.deepEqual(Object.fromEntries(CORE_NAMES.map(name => [name, digest(name)])), {
    'kairo-architect': 'ea42aa9eda6b3d69', 'kairo-builder': '062fed1234a2d836', 'kairo-deliverer': '3e417ed099cd511d',
    'kairo-explorer': '05e9164da720ad29', 'kairo-reviewer': '2ae241a7e2e661ab', 'kairo-tester': '3eb8631cdad8d41b'
  });
});

test('kitAgentForRole keeps the role: exact, unique suffix, otherwise none', () => {
  assert.equal(kitAgentForRole('Debugger'), 'kairo-debugger');
  assert.equal(kitAgentForRole('Backend Builder'), 'kairo-backend-builder');
  assert.equal(kitAgentForRole('builder'), 'kairo-builder');
  assert.equal(kitAgentForRole('Mobile Builder'), 'kairo-builder');
  assert.equal(kitAgentForRole('Senior Security Reviewer'), 'kairo-security-reviewer');
  assert.equal(kitAgentForRole('Astronomer'), null);
  assert.equal(kitAgentForRole(undefined), null);
});

test('parity table maps every hand-built team-* agent and keeps gentle-ai and researcher gaps explicit', () => {
  const byHand = Object.fromEntries(KIT_PARITY.map(row => [row.handBuilt, row]));
  assert.deepEqual(Object.keys(byHand).sort(), [
    'team-builder', 'team-builder-codex', 'team-explorer', 'team-jd-judge-codex', 'team-plan-critic-codex',
    'team-researcher', 'team-researcher-codex', 'team-reviewer-codex', 'team-test-runner'
  ]);
  assert.equal(byHand['team-builder'].kairo, 'kairo-builder');
  assert.equal(byHand['team-builder-codex'].kairo, 'kairo-builder');
  assert.equal(byHand['team-explorer'].kairo, 'kairo-explorer');
  assert.equal(byHand['team-test-runner'].kairo, 'kairo-tester');
  assert.equal(byHand['team-reviewer-codex'].kairo, 'kairo-reviewer');
  assert.equal(byHand['team-plan-critic-codex'].kairo, 'kairo-architect');
  assert.equal(byHand['team-jd-judge-codex'].kairo, null);
  assert.equal(byHand['team-researcher'].kairo, null);
  for (const row of KIT_PARITY.filter(r => r.kairo)) assert.ok(KIT_AGENTS.some(a => a.name === row.kairo), row.kairo);
});

test('builder agent carries the hand-built builder rules plus the context tools', () => {
  const { path, content } = renderKitAgent('kairo-builder');
  assert.equal(path, '.claude/agents/kairo-builder.md');
  assert.match(content, /^---\nname: kairo-builder\ndescription: /);
  assert.match(content, /\nmodel: sonnet\n/);
  assert.match(content, /\ntools: Read, Edit, Write, Grep, Glob, Bash, mcp__codegraph__codegraph_explore\n/);
  assert.match(content, /Do NOT launch sub-agents/);
  assert.match(content, /## Allowed edit surfaces/);
  assert.match(content, /failing test first \(RED\)/);
  assert.match(content, /Leave full suites to the test runner/);
  assert.match(content, /status`: done \| partial \| blocked/);
  assert.match(content, /## Context tools\nUse CodeGraph, Engram and Graphify before broad file reads\./);
  assert.match(content, /kairo-role: v1 host=claude-code role=kairo-builder/);
  assert.doesNotMatch(content, /team-builder/);
});

test('explorer and reviewer agents are read-only, tester only runs commands', () => {
  for (const name of ['kairo-explorer', 'kairo-reviewer', 'kairo-architect']) {
    const { content } = renderKitAgent(name);
    assert.match(content, /\ntools: Read, Grep, Glob, Bash, mcp__codegraph__codegraph_explore\n/, name);
    assert.doesNotMatch(content.split('\n').find(l => l.startsWith('tools:')), /Edit|Write/, name);
    assert.match(content, /Read-only\. Do NOT edit files/, name);
    assert.match(content, /## Context tools/, name);
  }
  assert.match(renderKitAgent('kairo-explorer').content, /\nmodel: haiku\n/);
  assert.match(renderKitAgent('kairo-explorer').content, /path:line/);
  const tester = renderKitAgent('kairo-tester').content;
  assert.match(tester, /\nmodel: haiku\n/);
  assert.match(tester, /\ntools: Bash, Read\n/);
  assert.match(tester, /Do NOT fix failures/);
  assert.match(tester, /rtk/);
  assert.match(tester, /PASS \| FAIL/);
  assert.throws(() => renderKitAgent('kairo-nope'), /Unknown Kairo agent/);
});

test('deliverer agent follows the gentle-ai delivery skills and keeps its guardrails', () => {
  const d = renderKitAgent('kairo-deliverer').content;
  assert.match(d, /\nmodel: haiku\n/);
  assert.match(d, /\ntools: Bash, Read\n/);
  assert.match(d, /Do NOT edit files/);
  assert.match(d, /Do NOT launch sub-agents/);
  assert.match(d, /work-unit-commits/);
  assert.match(d, /branch-pr/);
  assert.match(d, /chained-pr/);
  assert.match(d, /about 400 changed lines/);
  assert.match(d, /by registry name/);
  assert.match(d, /\.atl\/skill-registry\.md/);
  assert.match(d, /never a hardcoded path/);
  assert.match(d, /name which skill is missing/);
  assert.match(d, /conventional commits and a plain PR body/);
  assert.match(d, /never add Co-Authored-By or AI attribution/i);
  assert.match(d, /repository's own PR practice/);
});

test('plan previews and writes nothing; apply installs agents and installed wrappers under ~/.claude/agents', async t => {
  const f = await fixture(t, ['codex', 'gemini']);
  const plan = await planClaudeKit({ homeDir: f.homeDir, env: f.env });
  assert.equal(plan.applied, false);
  assert.deepEqual(plan.files.map(x => x.action), Array(NAMES.length + 2).fill('create'));
  assert.equal(existsSync(agentsDir(f.homeDir)), false);
  assert.equal((await applyClaudeKit({ homeDir: f.homeDir, env: f.env })).applied, false);
  assert.equal(existsSync(agentsDir(f.homeDir)), false);

  const done = await applyClaudeKit({ homeDir: f.homeDir, env: f.env, yes: true });
  assert.equal(done.applied, true);
  assert.deepEqual((await readdir(agentsDir(f.homeDir))).sort(), [...NAMES, 'kairo-codex', 'kairo-gemini'].map(n => `${n}.md`).sort());
  assert.equal(await readFile(join(agentsDir(f.homeDir), 'kairo-builder.md'), 'utf8'), renderKitAgent('kairo-builder').content);
  assert.equal(await readFile(join(agentsDir(f.homeDir), 'kairo-codex.md'), 'utf8'), renderWrapperAgent('codex').content);
  const again = await applyClaudeKit({ homeDir: f.homeDir, env: f.env, yes: true });
  assert.equal(again.applied, false);
  assert.ok(again.files.every(x => x.action === 'unchanged'));
});

test('apply backs up an owned stale agent and never touches foreign files, symlinks or the hand-built team-* agents', async t => {
  const f = await fixture(t);
  const dir = agentsDir(f.homeDir);
  await mkdir(dir, { recursive: true });
  const stale = '<!-- kairo-role: v1 host=claude-code role=kairo-builder -->\nold\n';
  await writeFile(join(dir, 'kairo-builder.md'), stale);
  await writeFile(join(dir, 'kairo-tester.md'), 'my own tester\n');
  await writeFile(join(dir, 'team-builder.md'), 'hand built\n');
  const target = join(f.root, 'target.md');
  await writeFile(target, 'target\n');
  await symlink(target, join(dir, 'kairo-explorer.md'));
  const done = await applyClaudeKit({ homeDir: f.homeDir, env: f.env, yes: true, now: () => 7 });
  const action = name => done.files.find(x => x.name === name).action;
  assert.equal(action('kairo-builder'), 'update');
  assert.equal(await readFile(done.files.find(x => x.name === 'kairo-builder').backupPath, 'utf8'), stale);
  assert.equal(action('kairo-tester'), 'skip-foreign');
  assert.equal(action('kairo-explorer'), 'skip-foreign');
  assert.equal(await readFile(join(dir, 'kairo-tester.md'), 'utf8'), 'my own tester\n');
  assert.equal(await readFile(join(dir, 'team-builder.md'), 'utf8'), 'hand built\n');
  assert.equal((await lstat(join(dir, 'kairo-explorer.md'))).isSymbolicLink(), true);
  assert.equal(await readFile(target, 'utf8'), 'target\n');
});

test('CLAUDE.md section is short, points at Kairo routing and states the context-tool rule', () => {
  const section = renderClaudeMdSection();
  assert.ok(section.startsWith(CLAUDE_MD_START) && section.trimEnd().endsWith(CLAUDE_MD_END));
  assert.ok(section.split('\n').length <= 16, `section has ${section.split('\n').length} lines`);
  assert.match(section, /kairo team route/);
  assert.match(section, /kairo team pacing/);
  assert.match(section, /\[no-redirect\]/);
  assert.match(section, /CodeGraph/);
  assert.match(section, /Engram/);
  assert.match(section, /Graphify/);
  assert.match(section, /rtk/i);
  assert.match(section, /review-\*/);
  assert.doesNotMatch(section, /team-builder|team-explorer|gpt-|sonnet|opus|haiku/i);
});

test('CLAUDE.md apply preserves everything outside the markers, refreshes in place and is idempotent', async t => {
  const f = await fixture(t);
  const user = '# My rules\n\n<!-- harness:managed:start -->\nmanaged\n<!-- harness:managed:end -->\n\nTail line.\n';
  await writeFile(claudeMd(f.homeDir), user);
  const first = await applyClaudeKit({ homeDir: f.homeDir, env: f.env, yes: true });
  assert.equal(first.claudeMd.action, 'update');
  const text = await readFile(claudeMd(f.homeDir), 'utf8');
  assert.ok(text.startsWith(user), 'user content stays first, byte for byte');
  assert.equal(text.split(CLAUDE_MD_START).length, 2);
  assert.ok(text.includes(renderClaudeMdSection()));
  const second = await applyClaudeKit({ homeDir: f.homeDir, env: f.env, yes: true });
  assert.equal(second.claudeMd.action, 'unchanged');
  assert.equal(await readFile(claudeMd(f.homeDir), 'utf8'), text);

  const stale = text.replace(/## Kairo[^\n]*/, '## Kairo old title');
  const edited = `top\n${stale}`;
  await writeFile(claudeMd(f.homeDir), edited);
  const third = await applyClaudeKit({ homeDir: f.homeDir, env: f.env, yes: true, now: () => 9 });
  assert.equal(third.claudeMd.action, 'update');
  const refreshed = await readFile(claudeMd(f.homeDir), 'utf8');
  assert.ok(refreshed.startsWith('top\n# My rules'));
  assert.equal(refreshed.split(CLAUDE_MD_START).length, 2);
  assert.doesNotMatch(refreshed, /Kairo old title/);
  assert.ok(refreshed.endsWith(`${renderClaudeMdSection().trimEnd()}\n`) || refreshed.includes('Tail line.'));
  assert.equal(await readFile(third.claudeMd.backupPath, 'utf8'), edited);
});

test('CLAUDE.md apply creates the file when missing and refuses a half-open marker', async t => {
  const f = await fixture(t);
  const created = await applyClaudeKit({ homeDir: f.homeDir, env: f.env, yes: true });
  assert.equal(created.claudeMd.action, 'create');
  assert.equal(await readFile(claudeMd(f.homeDir), 'utf8'), `${renderClaudeMdSection().trimEnd()}\n`);

  const broken = `keep\n${CLAUDE_MD_START}\nno end marker\n`;
  await writeFile(claudeMd(f.homeDir), broken);
  const refused = await applyClaudeKit({ homeDir: f.homeDir, env: f.env, yes: true });
  assert.equal(refused.claudeMd.action, 'skip-malformed');
  assert.equal(await readFile(claudeMd(f.homeDir), 'utf8'), broken);
});

test('wrapper keeps running past the 10-minute Bash limit: detached run, polled exit file, output returned', () => {
  const { content } = renderWrapperAgent('codex');
  assert.match(content, /10-minute/);
  assert.match(content, /nohup|setsid/);
  assert.match(content, /\.code/);
  assert.match(content, /poll/i);
  assert.match(content, /--role/);
  const block = /```sh\n([\s\S]*?)```/.exec(content)[1];
  assert.match(block, /kairo team exec --provider codex --model "\$model" --no-record/);
});

test('wrapper shell block runs the command detached and prints its output and exit status', async t => {
  const f = await fixture(t);
  const fake = join(f.bin, 'kairo');
  await writeFile(fake, '#!/bin/sh\ncat >/dev/null\necho "answer from $*"\nexit 3\n', { mode: 0o755 });
  const task = join(f.root, 'task.md');
  await writeFile(task, 'do it\n');
  const block = /```sh\n([\s\S]*?)```/.exec(renderWrapperAgent('codex').content)[1];
  const ran = spawnSync('sh', ['-c', block], {
    encoding: 'utf8', env: { PATH: `${f.bin}:${process.env.PATH}`, model: 'gpt-x', task_file: task, TMPDIR: f.root }
  });
  assert.match(ran.stdout, /answer from team exec --provider codex --model gpt-x --no-record/);
  assert.equal(ran.status, 3);
});

test('kairo setup installs the Claude Code kit, a Kairo CLAUDE.md section and keeps the existing managed block', async t => {
  const f = await fixture(t);
  await writeFile(claudeMd(f.homeDir), '# mine\n');
  const run = args => spawnSync(process.execPath, [kairoBin, 'setup', ...args], {
    cwd: packageRoot, encoding: 'utf8',
    env: { ...process.env, HARNESS_HOME: f.homeDir, PATH: `${f.bin}:${process.env.PATH}` }
  });
  const dry = run(['--dry-run', '--agents', 'claude']);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /Claude Code kit/);
  assert.equal(existsSync(agentsDir(f.homeDir)), false);
  assert.equal(await readFile(claudeMd(f.homeDir), 'utf8'), '# mine\n');

  const real = run(['--confirm', '--agents', 'claude']);
  assert.equal(real.status, 0, real.stderr);
  assert.match(real.stdout, /Claude Code kit/);
  for (const name of NAMES) assert.ok(existsSync(join(agentsDir(f.homeDir), `${name}.md`)), name);
  const text = await readFile(claudeMd(f.homeDir), 'utf8');
  assert.ok(text.startsWith('# mine'));
  assert.ok(text.includes('harness:managed:start'), 'existing managed block still written');
  assert.equal(text.split(CLAUDE_MD_START).length, 2);
  const rerun = run(['--confirm', '--agents', 'claude']);
  assert.equal(rerun.status, 0, rerun.stderr);
  assert.equal(await readFile(claudeMd(f.homeDir), 'utf8'), text);
});

test('kairo setup for another agent leaves Claude Code alone', async t => {
  const f = await fixture(t);
  await mkdir(join(f.homeDir, '.cursor'), { recursive: true });
  const ran = spawnSync(process.execPath, [kairoBin, 'setup', '--confirm', '--agents', 'cursor'], {
    cwd: packageRoot, encoding: 'utf8', env: { ...process.env, HARNESS_HOME: f.homeDir }
  });
  assert.equal(ran.status, 0, ran.stderr);
  assert.equal(existsSync(agentsDir(f.homeDir)), false);
  assert.equal(existsSync(claudeMd(f.homeDir)), false);
});

test('CLAUDE.md append keeps the user bytes exactly, trailing whitespace included', async t => {
  const f = await fixture(t);
  const user = '# user rules\n \n';
  await writeFile(claudeMd(f.homeDir), user);
  await applyClaudeKit({ homeDir: f.homeDir, env: f.env, yes: true });
  const text = await readFile(claudeMd(f.homeDir), 'utf8');
  assert.equal(text.slice(0, text.indexOf(CLAUDE_MD_START)), `${user}\n`);
  assert.equal(text.slice(text.indexOf(CLAUDE_MD_START)), renderClaudeMdSection());
});

test('a file that appears or changes after planning is never overwritten', async t => {
  const f = await fixture(t);
  const dir = agentsDir(f.homeDir);
  await mkdir(dir, { recursive: true });
  const owned = '<!-- kairo-role: v1 host=claude-code role=kairo-tester -->\nold\n';
  await writeFile(join(dir, 'kairo-tester.md'), owned);
  const done = await applyClaudeKit({ homeDir: f.homeDir, env: f.env, yes: true, afterPlan: async () => {
    await writeFile(join(dir, 'kairo-builder.md'), 'user wrote this meanwhile\n');
    await writeFile(join(dir, 'kairo-tester.md'), 'user edited this meanwhile\n');
    await writeFile(claudeMd(f.homeDir), 'user CLAUDE.md written meanwhile\n');
  } });
  const action = name => done.files.find(x => x.name === name).action;
  assert.equal(await readFile(join(dir, 'kairo-builder.md'), 'utf8'), 'user wrote this meanwhile\n');
  assert.equal(await readFile(join(dir, 'kairo-tester.md'), 'utf8'), 'user edited this meanwhile\n');
  assert.equal(await readFile(claudeMd(f.homeDir), 'utf8'), 'user CLAUDE.md written meanwhile\n');
  assert.equal(action('kairo-builder'), 'skip-changed');
  assert.equal(action('kairo-tester'), 'skip-changed');
  assert.equal(done.claudeMd.action, 'skip-changed');
  assert.equal(action('kairo-explorer'), 'create');
});

test('an update never loses an edit made during publication: every version lands in the file or its backup', async t => {
  const f = await fixture(t);
  const dir = agentsDir(f.homeDir);
  await mkdir(dir, { recursive: true });
  const owned = '<!-- kairo-role: v1 host=claude-code role=kairo-tester -->\nold\n';
  const ownedBuilder = '<!-- kairo-role: v1 host=claude-code role=kairo-builder -->\nold\n';
  await writeFile(join(dir, 'kairo-tester.md'), owned);
  await writeFile(join(dir, 'kairo-builder.md'), ownedBuilder);
  const done = await applyClaudeKit({ homeDir: f.homeDir, env: f.env, yes: true, now: () => 9,
    // tester: the user edits just before Kairo moves it aside; builder: the user recreates it right after.
    beforeMove: async path => { if (path.endsWith('kairo-tester.md')) await writeFile(path, 'user edit before move\n'); },
    afterMove: async path => { if (path.endsWith('kairo-builder.md')) await writeFile(path, 'user edit after move\n'); } });
  const entry = name => done.files.find(x => x.name === name);
  assert.equal(entry('kairo-tester').action, 'skip-changed');
  assert.equal(await readFile(join(dir, 'kairo-tester.md'), 'utf8'), 'user edit before move\n');
  assert.equal(entry('kairo-builder').action, 'skip-changed');
  assert.equal(await readFile(join(dir, 'kairo-builder.md'), 'utf8'), 'user edit after move\n');
  assert.equal(await readFile(entry('kairo-builder').backupPath, 'utf8'), ownedBuilder);
  const leftovers = (await readdir(dir)).filter(name => name.startsWith('kairo-tester.md.kairo-backup'));
  assert.deepEqual(leftovers, [], 'a restored file leaves no backup behind');
});

test('two concurrent setups never share a backup name, so the original bytes survive', async t => {
  const f = await fixture(t);
  const dir = agentsDir(f.homeDir);
  await mkdir(dir, { recursive: true });
  const original = '<!-- kairo-role: v1 host=claude-code role=kairo-tester -->\noriginal\n';
  await writeFile(join(dir, 'kairo-tester.md'), original);
  let reachedMove, releaseB;
  const bAtMove = new Promise(resolve => { reachedMove = resolve; });
  const bMayMove = new Promise(resolve => { releaseB = resolve; });
  const tester = path => path.endsWith('kairo-tester.md');
  // B plans and picks its backup name, then pauses; A runs to completion with the same stamp; then B resumes.
  const b = applyClaudeKit({ homeDir: f.homeDir, env: f.env, yes: true, now: () => 5,
    beforeMove: async path => { if (tester(path)) { reachedMove(); await bMayMove; } } });
  await bAtMove;
  await applyClaudeKit({ homeDir: f.homeDir, env: f.env, yes: true, now: () => 5 });
  releaseB();
  await b;
  const backups = (await readdir(dir)).filter(name => name.startsWith('kairo-tester.md.kairo-backup'));
  const contents = await Promise.all(backups.map(name => readFile(join(dir, name), 'utf8')));
  assert.ok(contents.includes(original), 'the original bytes are kept in a backup');
  assert.equal(await readFile(join(dir, 'kairo-tester.md'), 'utf8'), renderKitAgent('kairo-tester').content);
});
