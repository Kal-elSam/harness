import test from 'node:test';
import assert from 'node:assert/strict';
import { rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { harness, draftTeam } from './helpers/setup-harness.js';
import { projectKeyForPath } from '../src/global/next/project-key.js';
import { readProjectStrategy, readTeamReform, writeProjectStrategy } from '../src/global/team/project-strategy-store.js';
import { activateCatalogRoles } from '../src/global/intelligence/role-registry.js';
import { harnessHomePaths } from '../src/global/paths.js';
import { readTeamRoute } from '../src/global/team/routing-input-cache.js';

const BANDS = ['light', 'standard', 'demanding'];
const strategyFile = (home, root) => join(harnessHomePaths(home).sessionsDir, projectKeyForPath(root), 'project-strategy.json');

/** A harness whose project profile signals (and so the active role catalog) can change between calls. */
async function world(t, { signals = {}, teamProviders } = {}) {
  const state = { signals: { ...signals } };
  const profile = () => ({
    projectName: 'repo', stack: ['Node.js'], architecture: { pattern: 'x' },
    quality: { buildCommand: null, testCommand: null, lintCommand: null, typeCheckCommand: null },
    hotspots: [], workflowCapabilities: [], risks: [], fingerprint: 'fp-1', signals: state.signals,
    // Like the real profile: catalog roles are already activated from the signals.
    roleRequirements: activateCatalogRoles([{ role: 'Explorer', capabilities: ['reasoning'], reason: '' }], { signals: state.signals })
  });
  const h = await harness({
    git: true, diskStrategy: true,
    serviceDeps: { recoverRuns: async () => {}, enableProviderProbes: true, computeProjectProfile: async () => profile(), ...(teamProviders ? { teamProviders } : {}) }
  });
  t.after(async () => { await rm(h.root, { recursive: true, force: true }); await rm(h.home, { recursive: true, force: true }); });
  // Terminal, instruction and latency evidence so light terminal roles (Deliverer) have a real pick.
  const evidence = { codex: { terminalBenchV2: 0.8, ifBench: 0.9, endToEndSeconds: 10 }, claude: { terminalBenchV2: 0.6, ifBench: 0.8, endToEndSeconds: 20 } };
  h.modelIntelligence.scoredAll = h.modelIntelligence.scoredAll.map(row => ({ ...row, ...evidence[row.adapterId] }));
  h.modelIntelligence.manualSelectionScoredPool = h.modelIntelligence.scoredAll;
  return { h, state, service: (extra = {}) => h.makeService({ computeProjectProfile: async () => profile(), enableProviderProbes: true, ...(teamProviders ? { teamProviders } : {}), ...extra }) };
}

async function approvedTeam(w) {
  await draftTeam(w.h);
  const approved = await w.h.service.approveProjectStrategy({ cwd: w.h.root });
  assert.notEqual(approved?.ok, false, JSON.stringify(approved));
  return readProjectStrategy(w.h.home, w.h.root);
}

test('T5a: every projectTeam entry keeps its role and model and gains a band and a pool across configured providers', async t => {
  const w = await world(t);
  await draftTeam(w.h);
  const strategy = await readProjectStrategy(w.h.home, w.h.root);
  assert.ok(strategy.projectTeam.length > 0);
  for (const entry of strategy.projectTeam) {
    assert.ok(entry.role);
    assert.ok(entry.model?.modelId, `${entry.role} keeps its default model pick`);
    assert.ok(BANDS.includes(entry.band), `${entry.role} band ${entry.band}`);
    assert.ok(Array.isArray(entry.pool) && entry.pool.length > 0, `${entry.role} has a pool`);
    for (const member of entry.pool) assert.ok(member.adapterId && member.modelId);
  }
  const providers = new Set(strategy.projectTeam.flatMap(entry => entry.pool.map(member => member.adapterId)));
  assert.deepEqual([...providers].sort(), ['claude', 'codex']);
});

test('T5a: the pool only holds teamProviders', async t => {
  const w = await world(t);
  await draftTeam(w.h);
  await w.service({ teamProviders: ['claude'] }).rebuildProjectTeam({ cwd: w.h.root, yes: true });
  const strategy = await readProjectStrategy(w.h.home, w.h.root);
  assert.ok(strategy.projectTeam.length > 0);
  for (const entry of strategy.projectTeam) assert.deepEqual([...new Set(entry.pool.map(member => member.adapterId))], ['claude']);
});

test('T5a: an old-format strategy (no band, no pool, no structure) loads unchanged; automatic refresh leaves it byte-identical and routing as before', async t => {
  const w = await world(t, { signals: { gitRemote: true } });
  const fixture = JSON.parse(await readFile(new URL('./fixtures/strategy-old-format.json', import.meta.url), 'utf8'));
  const path = strategyFile(w.h.home, w.h.root);
  await mkdir(dirname(path), { recursive: true });
  const text = `${JSON.stringify(fixture, null, 2)}\n`;
  await writeFile(path, text);
  assert.deepEqual(await readProjectStrategy(w.h.home, w.h.root), fixture);
  assert.equal(fixture.projectTeam.some(entry => 'band' in entry || 'pool' in entry), false);

  const route = () => readTeamRoute({ role: 'Builder', cwd: w.h.root, homeDir: w.h.home }, { resolveRoot: async () => w.h.root });
  const routedBefore = await route();
  assert.equal(routedBefore.provider, 'claude', 'the old strategy routes by its stored model');
  const out = await w.service().refreshRoutingInputs({ cwd: w.h.root });
  assert.equal(out.refreshed, true);
  assert.deepEqual(await route(), routedBefore, 'routing is exactly as before');
  assert.equal(out.reform ?? null, null, 'an old strategy has no baseline and is never re-formed automatically');
  assert.equal(await readFile(path, 'utf8'), text);
  assert.deepEqual((await readTeamReform(w.h.home, w.h.root)).entries, []);
});

test('T5b: a new git remote adds Deliverer automatically, with a recorded reason and before/after roles', async t => {
  const w = await world(t);
  const formed = await approvedTeam(w);
  assert.equal(formed.projectTeam.some(entry => entry.role === 'Deliverer'), false);
  const service = w.service();
  await service.refreshRoutingInputs({ cwd: w.h.root });
  assert.equal((await readTeamReform(w.h.home, w.h.root)).entries.length, 0, 'same world, no re-form');

  w.state.signals.gitRemote = true;
  const out = await service.refreshRoutingInputs({ cwd: w.h.root });
  const active = await readProjectStrategy(w.h.home, w.h.root);
  assert.equal(active.status, 'active');
  assert.ok(active.projectTeam.some(entry => entry.role === 'Deliverer'), 'Deliverer joined');
  assert.notEqual(active.approvedAt, formed.approvedAt);
  const log = await readTeamReform(w.h.home, w.h.root);
  assert.equal(log.entries.length, 1);
  const [entry] = log.entries;
  assert.ok(Date.parse(entry.at));
  assert.deepEqual(entry.reasons.map(reason => reason.kind), ['role_activated']);
  assert.equal(entry.reasons[0].role, 'Deliverer');
  assert.ok(!entry.before.includes('Deliverer') && entry.after.includes('Deliverer'));
  assert.equal(out.reform.at, entry.at);

  // The same world does not re-form again.
  await service.refreshRoutingInputs({ cwd: w.h.root });
  assert.equal((await readTeamReform(w.h.home, w.h.root)).entries.length, 1);

  // A role that stops being activated leaves the team the same way.
  w.state.signals.gitRemote = false;
  await service.refreshRoutingInputs({ cwd: w.h.root });
  const after = await readProjectStrategy(w.h.home, w.h.root);
  assert.equal(after.projectTeam.some(row => row.role === 'Deliverer'), false);
  const last = (await readTeamReform(w.h.home, w.h.root)).entries.at(-1);
  assert.deepEqual(last.reasons.map(reason => reason.kind), ['role_deactivated']);
});

test('T5b: disabling codex in teamProviders re-forms the team without codex pools', async t => {
  const w = await world(t);
  await approvedTeam(w);
  const claudeOnly = w.service({ teamProviders: ['claude'] });
  await claudeOnly.refreshRoutingInputs({ cwd: w.h.root });
  const active = await readProjectStrategy(w.h.home, w.h.root);
  assert.equal(active.status, 'active');
  for (const entry of active.projectTeam) {
    assert.equal(entry.model?.adapterId === 'codex', false, `${entry.role} model`);
    assert.equal(entry.pool.some(member => member.adapterId === 'codex'), false, `${entry.role} pool`);
  }
  const [entry] = (await readTeamReform(w.h.home, w.h.root)).entries;
  assert.deepEqual(entry.reasons.map(reason => reason.kind), ['team_providers_changed']);
});

test('T5b: a configured provider losing login re-forms; a quota-only change does not', async t => {
  const w = await world(t);
  await approvedTeam(w);
  const service = w.service();
  const before = await readFile(strategyFile(w.h.home, w.h.root), 'utf8');

  // Quota swing: codex hits its 5h window, claude capacity moves.
  w.h.modelIntelligence.eligibility = { claude: { ok: true }, codex: { ok: false, reason: 'codex 5h window exhausted', limit: { provider: 'codex', window: '5h' } } };
  w.h.modelIntelligence.providerCapacity = { claude: { quotaRemainingPercent: 3 }, codex: { quotaRemainingPercent: 0 } };
  await service.refreshRoutingInputs({ cwd: w.h.root });
  assert.equal(await readFile(strategyFile(w.h.home, w.h.root), 'utf8'), before, 'quota swings never re-form');
  assert.equal((await readTeamReform(w.h.home, w.h.root)).entries.length, 0);

  // Login lost: not a quota limit.
  w.h.modelIntelligence.eligibility = { claude: { ok: true }, codex: { ok: false, reason: 'codex is not authenticated' } };
  await service.refreshRoutingInputs({ cwd: w.h.root });
  const entries = (await readTeamReform(w.h.home, w.h.root)).entries;
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].reasons.map(reason => [reason.kind, reason.provider]), [['provider_lost', 'codex']]);
  const active = await readProjectStrategy(w.h.home, w.h.root);
  for (const entry of active.projectTeam) assert.equal(entry.pool.some(member => member.adapterId === 'codex'), false);
});

test('T5b: the first formation still waits for approval; a draft is never re-formed', async t => {
  const w = await world(t);
  await draftTeam(w.h);
  const path = strategyFile(w.h.home, w.h.root);
  const draft = await readFile(path, 'utf8');
  w.state.signals.gitRemote = true;
  await assert.rejects(w.service().refreshRoutingInputs({ cwd: w.h.root }), /No approved team/);
  assert.equal(await readFile(path, 'utf8'), draft);
  assert.equal((await readProjectStrategy(w.h.home, w.h.root)).status, 'suggested');
  assert.equal((await readTeamReform(w.h.home, w.h.root)).entries.length, 0);
});

test('T5b: a team approved while a structure holds is its own baseline: the next refresh does not re-form', async t => {
  const w = await world(t, { signals: { gitRemote: true } });
  const formed = await approvedTeam(w);
  assert.ok(formed.structure.roles.includes('Deliverer'));
  assert.ok(formed.structure.key, 'the strategy carries the structure it was formed for');
  const out = await w.service().refreshRoutingInputs({ cwd: w.h.root });
  assert.equal(out.reform ?? null, null);
  assert.equal((await readTeamReform(w.h.home, w.h.root)).entries.length, 0);
});
