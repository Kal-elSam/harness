// T31 unit B: Kairo absorbs the hand-built Claude Code hooks (agent enforcement,
// plan-approval dispatch, relevant-only CodeGraph prompt context).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, mkdir, realpath, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadProjectRoleCatalog } from '../src/global/intelligence/role-catalog.js';
import { evaluateAgentLaunch, buildDispatchContext, filterCodegraphContext, lastPlanPath } from '../src/global/team/claude-hooks.js';

const BIN = resolve('bin/kairo.js');

async function fixture(t, roles) {
  const base = await mkdtemp(join(tmpdir(), 'kairo-hooks-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const home = join(base, 'home');
  const repo = join(base, 'repo');
  await mkdir(home, { recursive: true });
  await mkdir(join(repo, '.kairo'), { recursive: true });
  execFileSync('git', ['init', '-q', repo]);
  if (roles) await writeFile(join(repo, '.kairo', 'roles.json'), JSON.stringify(roles));
  return { base, home, repo: await realpath(repo) };
}
const rolesFile = { roles: [
  { id: 'Builder', agents: [{ name: 'my-builder', adapterId: 'claude' }] },
  { id: 'Explorer', agents: ['my-explorer'] },
  { id: 'Tester', agents: ['my-tester'] },
] };
const run = (home, args, input = '', extraEnv = {}) => spawnSync(process.execPath, [BIN, ...args], {
  input, encoding: 'utf8', env: { ...process.env, HARNESS_HOME: home, ...extraEnv },
});

test('agent enforcement allows catalog agents, Kairo wrappers, gentle actors, namespaced and host agents', async t => {
  const { repo } = await fixture(t, rolesFile);
  const catalog = loadProjectRoleCatalog({ projectRoot: repo });
  for (const name of ['my-builder', 'my-explorer', 'team-builder', 'kairo-codex', 'review-risk', 'jd-judge-a', 'codex:codex-rescue', 'claude-code-guide', 'statusline-setup']) {
    assert.deepEqual(evaluateAgentLaunch(name, catalog), { allowed: true }, name);
  }
});

test('agent enforcement denies generic and unknown agents with a reason listing Kairo agents', async t => {
  const { repo } = await fixture(t, rolesFile);
  const catalog = loadProjectRoleCatalog({ projectRoot: repo });
  for (const name of ['', undefined, 'general-purpose', 'Explore', 'Plan', 'random-agent']) {
    const verdict = evaluateAgentLaunch(name, catalog);
    assert.equal(verdict.allowed, false, String(name));
    assert.match(verdict.reason, /my-builder/);
    assert.match(verdict.reason, /my-explorer/);
    assert.match(verdict.reason, /inline/);
    assert.doesNotMatch(verdict.reason, /Sam/);
    assert.doesNotMatch(verdict.reason, /review-risk/);
  }
  assert.match(evaluateAgentLaunch('general-purpose', catalog).reason, /general-purpose/);
});

test('team check-agent allows agents the user defined in ~/.claude/agents or the project .claude/agents', async t => {
  const { base, repo } = await fixture(t, rolesFile);
  const userHome = join(base, 'user');
  await mkdir(join(userHome, '.claude', 'agents'), { recursive: true });
  await mkdir(join(repo, '.claude', 'agents'), { recursive: true });
  await writeFile(join(userHome, '.claude', 'agents', 'frontend.md'), '---\nname: my-frontend-dev\ndescription: x\n---\nBody\n');
  await writeFile(join(repo, '.claude', 'agents', 'project-agent.md'), 'No frontmatter: the file name is the agent name.\n');
  const check = name => JSON.parse(run(userHome, ['team', 'check-agent', '--agent', name, '--cwd', repo, '--json'], '', { HOME: userHome }).stdout);
  assert.deepEqual(check('my-frontend-dev'), { allowed: true });
  assert.deepEqual(check('project-agent'), { allowed: true });
  await writeFile(join(userHome, '.claude', 'agents', 'commented.md'), '---\nname: frontend-dev # my comment\n---\n');
  await writeFile(join(userHome, '.claude', 'agents', 'quoted.md'), "---\nname: 'quoted-agent' # note\n---\n");
  await writeFile(join(userHome, '.claude', 'agents', 'double.md'), '---\nname: "double-agent"\n---\n');
  for (const name of ['frontend-dev', 'quoted-agent', 'double-agent']) assert.deepEqual(check(name), { allowed: true }, name);
  for (const name of ['general-purpose', 'Explore', 'Plan', 'fork', 'random-agent']) assert.equal(check(name).allowed, false, name);
});

test('team check-agent CLI prints the verdict as JSON and exits 0', async t => {
  const { home, repo } = await fixture(t, rolesFile);
  const ok = run(home, ['team', 'check-agent', '--agent', 'my-builder', '--cwd', repo, '--json']);
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout), { allowed: true });
  const denied = run(home, ['team', 'check-agent', '--agent', 'general-purpose', '--cwd', repo, '--json']);
  assert.equal(denied.status, 0, denied.stderr);
  const verdict = JSON.parse(denied.stdout);
  assert.equal(verdict.allowed, false);
  assert.match(verdict.reason, /my-tester/);
});

test('dispatch context names the catalog agents, follows pacing and carries no personal names', async t => {
  const { repo } = await fixture(t, rolesFile);
  const catalog = loadProjectRoleCatalog({ projectRoot: repo });
  const pacing = { providers: { claude: { tier: 'WATCH' }, codex: { tier: 'HEALTHY' } }, nextWriter: 'team-builder-codex' };
  const text = buildDispatchContext({ catalog, pacing, planPath: '/plans/last-plan.md', saved: true });
  assert.match(text, /PLAN APPROVED/);
  assert.match(text, /my-explorer/);
  assert.match(text, /my-builder/);
  assert.match(text, /my-tester/);
  assert.match(text, /\/plans\/last-plan\.md/);
  assert.match(text, /Pacing/);
  assert.match(text, /plan critic/i);
  assert.doesNotMatch(text, /Sam/);
  assert.doesNotMatch(text, /team-builder-codex/);
});

test('dispatch context names the agent file roles sync installs when a role has no agents', async t => {
  const { repo } = await fixture(t, rolesFile);
  const text = buildDispatchContext({ catalog: loadProjectRoleCatalog({ projectRoot: repo }), pacing: null, planPath: null, saved: false });
  assert.match(text, /Stuck debugging -> debugger\./);
  assert.doesNotMatch(text, /-> Debugger|-> Reviewer/);
});

test('dispatch context skips the plan critic when every provider is constrained and says when the plan was not saved', async t => {
  const { repo } = await fixture(t, rolesFile);
  const catalog = loadProjectRoleCatalog({ projectRoot: repo });
  const pacing = { providers: { claude: { tier: 'CRITICAL' }, codex: { tier: 'CONSERVE' } } };
  const text = buildDispatchContext({ catalog, pacing, planPath: null, saved: false });
  assert.match(text, /Plan critic: skip/);
  assert.match(text, /could not be saved/);
  assert.match(buildDispatchContext({ catalog, pacing: null, planPath: null, saved: false }), /Plan critic \(LARGE/);
});

test('team dispatch CLI saves the approved plan under Kairo home and returns the context', async t => {
  const { home, repo } = await fixture(t, rolesFile);
  const ran = run(home, ['team', 'dispatch', '--cwd', repo, '--json'], '# Plan\n- step one\n');
  assert.equal(ran.status, 0, ran.stderr);
  const result = JSON.parse(ran.stdout);
  assert.equal(result.saved, true);
  assert.equal(result.planPath, lastPlanPath(home, repo));
  assert.equal(await readFile(result.planPath, 'utf8'), '# Plan\n- step one\n');
  assert.match(result.context, /PLAN APPROVED/);
  assert.match(result.context, /my-builder/);
});

const CODEGRAPH_SAMPLE = root => `<codegraph_context note="Structural context">
**Exploration: how does routing work**

Found 61 symbols across 6 files.

**Blast radius — what depends on these (update/verify before editing)**

- \`route\` (src/real.js:3) — 1 caller in \`src/real.js\`; tests: \`test/real.test.js\`
- \`gone\` (src/removed.js:9) — 2 callers in \`src/removed.js\`
- \`piThing\` (third_party/pi/core.js:4) — 1 caller in \`third_party/pi/core.js\`
- \`other\` (src/real.js:30) — 1 caller in \`src/real.js\`

**Relationships**

**calls:**
- a → b

**Source Code**

> verbatim source follows

\`\`\`javascript
1\tconst secret = 1;
\`\`\`
</codegraph_context>`;

async function codegraphRepo(t) {
  const f = await fixture(t);
  await mkdir(join(f.repo, 'src'), { recursive: true });
  await mkdir(join(f.repo, 'third_party', 'pi'), { recursive: true });
  await writeFile(join(f.repo, 'src', 'real.js'), 'x');
  await writeFile(join(f.repo, 'third_party', 'pi', 'core.js'), 'x');
  return f;
}

test('codegraph context keeps only relevant, existing, non-vendored symbols and drops source and relationships', async t => {
  const { repo } = await codegraphRepo(t);
  const out = filterCodegraphContext(CODEGRAPH_SAMPLE(repo), { projectRoot: repo });
  assert.match(out, /route/);
  assert.match(out, /other/);
  assert.doesNotMatch(out, /gone/);
  assert.doesNotMatch(out, /third_party/);
  assert.doesNotMatch(out, /secret/);
  assert.doesNotMatch(out, /Relationships/);
  assert.match(out, /codegraph_explore/);
  assert.ok(out.length <= 1500, `length ${out.length}`);
});

test('codegraph context is empty when nothing relevant survives or the input is empty', async t => {
  const { repo } = await codegraphRepo(t);
  assert.equal(filterCodegraphContext('', { projectRoot: repo }), '');
  const only = '**Blast radius — x**\n\n- `gone` (third_party/pi/core.js:4) — 1 caller\n';
  assert.equal(filterCodegraphContext(only, { projectRoot: repo }), '');
});

test('team prompt-context CLI runs codegraph prompt-hook and prints the filtered context; fails open without it', async t => {
  const { base, home, repo } = await codegraphRepo(t);
  const bin = join(base, 'bin');
  await mkdir(bin, { recursive: true });
  const sample = join(base, 'sample.txt');
  await writeFile(sample, CODEGRAPH_SAMPLE(repo));
  await writeFile(join(bin, 'codegraph'), `#!/bin/sh\ncat "${sample}"\n`);
  await chmod(join(bin, 'codegraph'), 0o755);
  const input = JSON.stringify({ prompt: 'how does routing work', cwd: repo });
  const ran = run(home, ['team', 'prompt-context', '--cwd', repo], input, { PATH: `${bin}:${process.env.PATH}` });
  assert.equal(ran.status, 0, ran.stderr);
  assert.match(ran.stdout, /route/);
  assert.doesNotMatch(ran.stdout, /third_party/);
  const missing = run(home, ['team', 'prompt-context', '--cwd', repo], input, { PATH: dirOfNode() });
  assert.equal(missing.status, 0, missing.stderr);
  assert.equal(missing.stdout.trim(), '');
});
function dirOfNode() { return resolve(process.execPath, '..'); }
