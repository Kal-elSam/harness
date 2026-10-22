import test from 'node:test';
import assert from 'node:assert/strict';
import { rm, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { harness } from './helpers/setup-harness.js';
import { tree } from './team-route-fixture.test.js';
import { readProjectStrategy, writeProjectStrategy } from '../src/global/team/project-strategy-store.js';
import { readTeamRoute } from '../src/global/team/routing-input-cache.js';

async function setup(t) {
  const h = await harness({ git: true, diskStrategy: true, serviceDeps: { recoverRuns: async () => {} } });
  t.after(async () => { await rm(h.root, { recursive: true, force: true }); await rm(h.home, { recursive: true, force: true }); });
  const outputs = [];
  const run = async (teamAction, extra = {}) => {
    const { runTeamCli } = await import('../src/global/team/team-cli.js');
    const before = process.exitCode;
    try {
      process.exitCode = 0;
      const result = await runTeamCli({ teamAction, cwd: h.root, ...extra }, {
        homeDir: h.home, getService: () => h.service, log: text => outputs.push(text)
      });
      return { result, output: outputs.at(-1), exitCode: process.exitCode };
    } finally { process.exitCode = before; }
  };
  return { ...h, run, recommended: (await h.ops.setup()).analyzers.find(a => a.recommended && a.available) };
}

test('analyze preview explains project, analyst and usage; writes and executes nothing', async t => {
  const h = await setup(t);
  const before = [await tree(h.home), await tree(h.root)];
  const p = await h.run('analyze');
  assert.equal(p.exitCode, 0);
  assert.equal(p.result.applied, false);
  assert.match(p.output, /sanitized.*project/i);
  assert.ok(p.output.includes(`${h.recommended.model} (${h.recommended.provider})`));
  assert.match(p.output, /spends provider usage/);
  assert.match(p.output, /kairo team analyze --yes/);
  assert.equal(h.counts.analyze, 0);
  assert.equal(h.counts.startRun, 0);
  assert.deepEqual([await tree(h.home), await tree(h.root)], before);
});

test('analyze --yes executes injected analyst once, persists draft, show lists draft read-only', async t => {
  const h = await setup(t);
  const p = await h.run('analyze', { yes: true, json: true });
  assert.equal(p.exitCode, 0);
  assert.equal(h.counts.analyze, 1);
  assert.deepEqual(h.analyzed, [h.recommended.candidateKey]);
  assert.equal(JSON.parse(p.output).strategyStatus, 'draft');
  assert.equal((await readProjectStrategy(h.home, h.root)).status, 'suggested');
  const before = await tree(h.home);
  const shown = await h.run('show');
  assert.match(shown.output, /Role\s+Model\s+Provider\s+Status/);
  assert.match(shown.output, /Explorer.*draft/);
  const json = await h.run('show', { json: true });
  assert.equal(JSON.parse(json.output).strategyStatus, 'draft');
  assert.ok(json.result.team.every(r => r.role && r.model && r.provider && r.status === 'draft'));
  assert.deepEqual(await tree(h.home), before);
  assert.equal(h.counts.analyze, 1);
});

test('approve preview changes nothing; --yes validates, approves and route reads the team', async t => {
  const h = await setup(t);
  await h.run('analyze', { yes: true });
  const before = await tree(h.home);
  const preview = await h.run('approve');
  assert.match(preview.output, /approve.*draft/i);
  assert.match(preview.output, /Explorer/);
  assert.match(preview.output, /kairo team approve --yes/);
  assert.deepEqual(await tree(h.home), before);
  assert.equal(preview.result.applied, false);
  const approved = await h.run('approve', { yes: true, json: true });
  assert.equal(approved.exitCode, 0);
  assert.equal(JSON.parse(approved.output).strategyStatus, 'approved');
  assert.equal((await readProjectStrategy(h.home, h.root)).status, 'active');
  assert.equal((await readTeamRoute({ cwd: h.root, homeDir: h.home, role: 'Explorer' })).provider, 'codex');
  assert.equal((await h.run('show', { json: true })).result.team[0].status, 'approved');
  assert.equal(h.counts.analyze, 1);
});

test('approval validation failure remains failure and leaves draft unchanged', async t => {
  const h = await setup(t);
  await h.run('analyze', { yes: true });
  const draft = await readProjectStrategy(h.home, h.root);
  await writeProjectStrategy(h.home, h.root, { ...draft, orchestrator: null });
  const before = await tree(h.home);
  const p = await h.run('approve', { yes: true, json: true });
  assert.equal(p.exitCode, 1);
  assert.equal(JSON.parse(p.output).ok, false);
  assert.equal(p.result.code, 'approval_blocked');
  assert.match(p.result.error, /kairo team show/);
  assert.deepEqual(await tree(h.home), before);
});

test('missing draft and missing project give one-line next commands and JSON errors', async t => {
  const h = await setup(t);
  for (const action of ['show', 'approve']) {
    const p = await h.run(action);
    assert.equal(p.exitCode, 1);
    assert.match(p.output, /No draft team yet.*kairo team analyze/);
    assert.equal(p.output.split('\n').length, 1);
  }
  const plain = await mkdtemp(join(tmpdir(), 'team-no-project-'));
  t.after(() => rm(plain, { recursive: true, force: true }));
  await mkdir(join(plain, 'empty'));
  for (const teamAction of ['analyze', 'show', 'approve']) {
    const p = await h.run(teamAction, { cwd: plain, json: true });
    assert.equal(p.exitCode, 1);
    assert.equal(JSON.parse(p.output).code, 'no_project');
    assert.match(p.result.error, /--cwd/);
  }
});

test('JSON previews expose machine shapes but never need copied confirmation tokens', async t => {
  const h = await setup(t);
  const analysis = await h.run('analyze', { json: true });
  assert.equal(analysis.result.action, 'analyze');
  assert.equal(analysis.result.applied, false);
  assert.equal(analysis.result.spend, true);
  assert.equal(analysis.result.analyst.provider, h.recommended.provider);
  assert.equal('confirmationTarget' in analysis.result, false);
  await h.run('analyze', { yes: true });
  const approval = await h.run('approve', { json: true });
  assert.equal(approval.result.action, 'approve');
  assert.equal(approval.result.applied, false);
  assert.equal(approval.result.strategyStatus, 'draft');
});

test('CLI dispatch exposes show, analyze/approve and three-step help without providers', async t => {
  const h = await setup(t);
  const cli = (...args) => spawnSync(process.execPath, [resolve('bin/kairo.js'), ...args], {
    encoding: 'utf8', env: { ...process.env, HOME: h.home, HARNESS_HOME: h.home, XDG_CONFIG_HOME: join(h.home, '.config') }
  });
  const help = cli('help');
  assert.match(help.stdout, /Team setup in three steps/);
  for (const command of ['analyze', 'approve', 'roles init']) assert.ok(help.stdout.includes(`kairo team ${command} --yes`));
  for (const action of ['show', 'approve']) {
    const p = cli('team', action, '--cwd', h.root, '--json');
    assert.equal(p.status, 1);
    assert.equal(JSON.parse(p.stdout).code, 'no_strategy');
  }
  await h.run('analyze', { yes: true });
  const before = await tree(h.home);
  const shown = cli('team', 'show', '--cwd', h.root, '--json');
  assert.equal(shown.status, 0, shown.stderr);
  assert.equal(JSON.parse(shown.stdout).strategyStatus, 'draft');
  assert.deepEqual(await tree(h.home), before);
});
