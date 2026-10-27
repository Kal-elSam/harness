import test from 'node:test';
import assert from 'node:assert/strict';
import { rm, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { harness } from './helpers/setup-harness.js';
import { tree } from './team-route-fixture.test.js';
import { readProjectStrategy, writeProjectStrategy } from '../src/global/team/project-strategy-store.js';
import { parseArgs } from '../src/cli.js';
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
        homeDir: h.home, env: {}, getService: () => h.service, log: text => outputs.push(text)
      });
      return { result, output: outputs.at(-1), exitCode: process.exitCode };
    } finally { process.exitCode = before; }
  };
  return { ...h, run, recommended: (await h.ops.setup()).analyzers.find(a => a.recommended && a.available) };
}

test('analyze preview explains project, analyst and usage; writes and executes nothing', async t => {
  const h = await setup(t);
  const before = [await tree(h.home), await tree(h.root)];
  const p = await h.run('analyze', { analyst: h.recommended.modelId });
  assert.equal(p.exitCode, 0);
  assert.equal(p.result.applied, false);
  assert.match(p.output, /sanitized.*project/i);
  assert.ok(p.output.includes(`${h.recommended.model} (${h.recommended.provider})`));
  assert.match(p.output, /spends provider usage/);
  assert.match(p.output, /kairo team analyze --analyst .* --yes/);
  assert.equal(h.counts.analyze, 0);
  assert.equal(h.counts.startRun, 0);
  assert.deepEqual([await tree(h.home), await tree(h.root)], before);
});

test('analyze --yes executes injected analyst once, persists draft, show lists draft read-only', async t => {
  const h = await setup(t);
  const p = await h.run('analyze', { yes: true, json: true, analyst: h.recommended.modelId });
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
  await h.run('analyze', { yes: true, analyst: h.recommended.modelId });
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
  await h.run('analyze', { yes: true, analyst: h.recommended.modelId });
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
  const analysis = await h.run('analyze', { json: true, analyst: h.recommended.modelId });
  assert.equal(analysis.result.action, 'analyze');
  assert.equal(analysis.result.applied, false);
  assert.equal(analysis.result.spend, true);
  assert.equal(analysis.result.analyst.provider, h.recommended.provider);
  assert.equal('confirmationTarget' in analysis.result, false);
  await h.run('analyze', { yes: true, analyst: h.recommended.modelId });
  const approval = await h.run('approve', { json: true });
  assert.equal(approval.result.action, 'approve');
  assert.equal(approval.result.applied, false);
  assert.equal(approval.result.strategyStatus, 'draft');
});

test('CLI dispatch exposes show, analyze/approve and manual-selection help without providers', async t => {
  const h = await setup(t);
  const cli = (...args) => spawnSync(process.execPath, [resolve('bin/kairo.js'), ...args], {
    encoding: 'utf8', env: { ...process.env, HOME: h.home, HARNESS_HOME: h.home, XDG_CONFIG_HOME: join(h.home, '.config') }
  });
  const help = cli('help');
  assert.match(help.stdout, /Team setup/);
  assert.ok(help.stdout.includes('kairo team analysts'));
  assert.ok(help.stdout.includes('kairo team analyze --analyst MODEL --yes'));
  for (const command of ['approve', 'roles init']) assert.ok(help.stdout.includes(`kairo team ${command} --yes`));
  for (const action of ['show', 'approve']) {
    const p = cli('team', action, '--cwd', h.root, '--json');
    assert.equal(p.status, 1);
    assert.equal(JSON.parse(p.stdout).code, 'no_strategy');
  }
  await h.run('analyze', { yes: true, analyst: h.recommended.modelId });
  const before = await tree(h.home);
  const shown = cli('team', 'show', '--cwd', h.root, '--json');
  assert.equal(shown.status, 0, shown.stderr);
  assert.equal(JSON.parse(shown.stdout).strategyStatus, 'draft');
  assert.deepEqual(await tree(h.home), before);
});

// The real service catalog joins scored and unscored inventory. API billing
// metadata is fixture data, not inferred from benchmark prices.
async function analystFixture(t) {
  const h = await setup(t);
  const api = { adapterId: 'codex', modelId: 'api-model', candidateKey: 'codex::api-model',
    displayName: 'API Model', accessType: 'API key', estimatedAnalysisCost: '$0.02', entitlement: 'not_applicable' };
  h.modelIntelligence.unscoredModels.push(api,
    { ...api, modelId: 'another-model', candidateKey: 'codex::another-model', estimatedAnalysisCost: null },
    { ...api, adapterId: 'unsupported', modelId: 'not-executable', candidateKey: 'unsupported::not-executable' });
  h.modelIntelligence.unscoredModels.push(
    { ...api, adapterId: 'opencode-go', modelId: 'go-model', candidateKey: 'opencode-go::go-model', accessType: 'subscription' },
    { ...api, adapterId: 'cursor', modelId: 'cursor-model', candidateKey: 'cursor::cursor-model', accessType: 'subscription', entitlement: 'allowed' });
  h.modelIntelligence.eligibility['opencode-go'] = { ok: true };
  h.modelIntelligence.eligibility.cursor = { ok: true };
  h.modelIntelligence.providerCapacity = { codex: { quotaRemainingPercent: 75 } };
  return h;
}

test('analysts lists every executable scored and unscored model, access, cost and quota without writes', async t => {
  const h = await analystFixture(t);
  const before = [await tree(h.home), await tree(h.root)];
  const p = await h.run('analysts');
  assert.equal(p.exitCode, 0);
  assert.match(p.output, /Number\s+Model\s+Provider\s+Access\s+Estimated cost\s+Quota tier/);
  assert.match(p.output, /api-model.*codex.*API key.*\$0.02.*HEALTHY/);
  assert.match(p.output, /claude-model.*subscription.*unknown.*unknown/);
  const json = await h.run('analysts', { json: true });
  assert.deepEqual(json.result.analysts.map(a => a.modelId), ['claude-model', 'another-model', 'api-model', 'codex-model']);
  assert.deepEqual(JSON.parse(json.output).analysts.map(a => a.number), [1, 2, 3, 4]);
  assert.equal(h.counts.analyze, 0);
  assert.deepEqual([await tree(h.home), await tree(h.root)], before);
});

test('analyze without analyst lists choices; --yes refuses with no runner or writes', async t => {
  const h = await analystFixture(t);
  const before = [await tree(h.home), await tree(h.root)];
  const listing = await h.run('analysts');
  const preview = await h.run('analyze');
  assert.equal(preview.exitCode, 0);
  assert.equal(preview.output, listing.output + '\nPick one with kairo team analyze --analyst MODEL.');
  const refused = await h.run('analyze', { yes: true });
  assert.equal(refused.exitCode, 1);
  assert.equal(refused.output, 'Pick one with kairo team analyze --analyst MODEL.');
  assert.equal(h.counts.analyze, 0);
  assert.deepEqual([await tree(h.home), await tree(h.root)], before);
});

for (const [selection, expected] of [['api-model', 'codex::api-model'], ['3', 'codex::api-model']]) {
  test(`analyze explicit analyst ${selection} runs exactly that model once`, async t => {
    const h = await analystFixture(t);
    const applied = await h.run('analyze', { yes: true, analyst: selection });
    assert.equal(applied.exitCode, 0, applied.output);
    assert.deepEqual(h.analyzed, [expected]);
    const strategy = await readProjectStrategy(h.home, h.root);
    assert.equal(strategy.bootstrapAnalyst.modelId, expected.split('::')[1]);
    assert.equal(strategy.bootstrapAnalystSelectionSource, 'manual');
  });
}

test('unknown analyst refuses in one line pointing to analysts without effects', async t => {
  const h = await analystFixture(t);
  const before = [await tree(h.home), await tree(h.root)];
  for (const analyst of ['missing-model', '999', '0', 'go-model', 'cursor-model']) {
    const p = await h.run('analyze', { yes: true, analyst });
    assert.equal(p.exitCode, 1);
    assert.match(p.output, /kairo team analysts/);
    assert.equal(p.output.split('\n').length, 1);
  }
  assert.equal(h.counts.analyze, 0);
  assert.deepEqual([await tree(h.home), await tree(h.root)], before);
});

test('CLI parses analysts and explicit analyst IDs and row numbers', () => {
  assert.equal(parseArgs(['team', 'analysts', '--json']).options.teamAction, 'analysts');
  assert.equal(parseArgs(['team', 'analyze', '--analyst', 'api-model']).options.analyst, 'api-model');
  assert.equal(parseArgs(['team', 'analyze', '--analyst=3']).options.analyst, '3');
});
