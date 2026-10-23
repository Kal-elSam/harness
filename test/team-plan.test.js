import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { runTeamCli } from '../src/global/team/team-cli.js';
import { runTeamRouteCli } from '../src/global/team/routing-input-cache.js';
import { writeProjectStrategy } from '../src/global/team/project-strategy-store.js';
import { fixture, tree } from './team-route-fixture.test.js';
import { harness } from './helpers/setup-harness.js';
import { parseArgs } from '../src/cli.js';

const now = Date.now();
const iso = offset => new Date(now + offset).toISOString();
const a = { adapterId: 'codex', modelId: 'ideal', accessMode: 'automatic' };
const b = { adapterId: 'claude', modelId: 'backup', accessMode: 'automatic' };
const plan = {
  generatedAt: iso(-1000), horizon: iso(7200000),
  idealTeam: [{ role: 'Builder', model: a }, { role: 'Explorer', model: a }],
  phases: [
    { startsAt: iso(-1000), endsAt: iso(3600000), team: [{ role: 'Builder', model: b }, { role: 'Explorer', model: a }] },
    { startsAt: iso(3600000), endsAt: iso(7200000), team: [{ role: 'Builder', model: null, assignmentState: 'waiting', waitUntil: iso(7200000) }, { role: 'Explorer', model: a }] },
    { startsAt: iso(7200000), endsAt: null, team: [{ role: 'Builder', model: a }, { role: 'Explorer', model: a }] }
  ]
};
const local = value => new Date(value).toLocaleString();
async function cli(t, phasePlan = plan) {
  const f = await fixture(t);
  await writeProjectStrategy(f.home, f.cwd, { ...f.strategy, ...(phasePlan ? { phasePlan } : {}) });
  const lines = [], calls = [];
  const run = (teamAction, options = {}) => runTeamCli({ cwd: f.cwd, teamAction, ...options }, {
    homeDir: f.home, log: line => lines.push(line), now: () => now,
    getService: () => ({ rebuildProjectTeam: async args => { calls.push(args); return { phasePlan }; } })
  });
  return { ...f, lines, calls, run };
}

const hour = 3600000;
const longPlan = {
  ...plan, horizon: iso(48 * hour),
  phases: [
    ...Array.from({ length: 48 }, (_, index) => ({
      startsAt: iso(index * hour), endsAt: iso((index + 1) * hour),
      // Distinct budget/event snapshots must not repeat identical role changes.
      budgets: { codex: { remainingPercent: 100 - index } }, events: [{ at: iso(index * hour) }],
      team: index < 12 ? [{ role: 'Builder', model: b }, { role: 'Explorer', model: a }]
        : ['Builder', 'Explorer'].map(role => ({ role, model: null, waitUntil: iso(48 * hour) }))
    })),
    { startsAt: iso(48 * hour), endsAt: null, team: plan.idealTeam }
  ]
};

const phaseRows = text => text.split('\n').filter(line => /^\d+\s{2}/.test(line));

test('plan defaults to next 24 hours and merges consecutive identical changes', async t => {
  const f = await cli(t, longPlan);
  const before = structuredClone(longPlan);
  const returned = await f.run('plan');
  const text = f.lines.at(-1);
  assert.equal(phaseRows(text).length, 2);
  assert.ok(text.includes(local(iso(24 * hour))));
  assert.doesNotMatch(text, /No changes from ideal team/);
  assert.match(text, /--all/);
  assert.deepEqual(returned, before);
  assert.deepEqual(longPlan, before);
});

test('plan --all through existing argument parser shows full compact horizon', async t => {
  const f = await cli(t, longPlan);
  const { options } = parseArgs(['team', 'plan', '--all']);
  await f.run('plan', options);
  const text = f.lines.at(-1);
  assert.equal(phaseRows(text).length, 3);
  assert.ok(phaseRows(text)[0].includes(local(iso(12 * hour))));
  assert.ok(phaseRows(text)[1].includes(local(iso(48 * hour))));
  assert.match(text, /No changes from ideal team/);
  assert.doesNotMatch(text, /Run kairo team plan --all/);
});

test('plan summarizes exhausted team in one all-roles waiting line', async t => {
  const f = await cli(t, longPlan);
  await f.run('plan', { helpAll: true });
  const row = phaseRows(f.lines.at(-1))[1];
  assert.ok(row.includes(`All roles wait until ${local(iso(48 * hour))}`));
  assert.doesNotMatch(row, /Builder:|Explorer:/);
});

test('missing reset evidence says no reset data for individual and all-role waits', async t => {
  for (const team of [
    [{ role: 'Builder', model: null, waitUntil: null }, { role: 'Explorer', model: a }],
    ['Builder', 'Explorer'].map(role => ({ role, model: null, waitUntil: null }))
  ]) {
    const f = await cli(t, { ...plan, phases: [{ startsAt: iso(-1000), endsAt: null, team }] });
    await f.run('plan');
    const text = f.lines.at(-1);
    assert.match(text, /no reset data/);
    assert.doesNotMatch(text, /unknown reset/);
    if (team.every(entry => !entry.model)) assert.match(text, /All roles wait/);
  }
});

test('default plan omits past phases and does not merge nonconsecutive changes', async t => {
  const f = await cli(t, { ...plan, phases: [
    { startsAt: iso(-2 * hour), endsAt: iso(-hour), team: [{ role: 'Builder', model: { ...b, modelId: 'past' } }] },
    { startsAt: iso(-hour), endsAt: iso(hour), team: [{ role: 'Builder', model: b }] },
    { startsAt: iso(hour), endsAt: iso(2 * hour), team: plan.idealTeam },
    { startsAt: iso(2 * hour), endsAt: null, team: [{ role: 'Builder', model: b }] }
  ] });
  await f.run('plan');
  const text = f.lines.at(-1);
  assert.equal(phaseRows(text).length, 3);
  assert.doesNotMatch(text, /claude\/past/);
});

test('plan JSON retains all raw phases regardless of display horizon or --all', async t => {
  const f = await cli(t, longPlan);
  for (const args of [['team', 'plan', '--json'], ['team', 'plan', '--all', '--json']]) {
    await f.run('plan', parseArgs(args).options);
    assert.deepEqual(JSON.parse(f.lines.at(-1)), longPlan);
  }
});

test('plan lists every phase in time order, local ranges and only changed roles', async t => {
  const f = await cli(t, { ...plan, phases: [...plan.phases].reverse() });
  const before = await tree(f.home);
  await f.run('plan');
  const text = f.lines.at(-1);
  assert.match(text.split('\n')[0], /^Current phase: 1/);
  const grid = text.split('\n').slice(1).join('\n');
  assert.ok(grid.indexOf(local(plan.phases[0].startsAt)) < grid.indexOf(local(plan.phases[1].startsAt)));
  assert.match(text, /Builder.*claude\/backup/);
  assert.doesNotMatch(text, /Explorer|codex\/ideal/);
  assert.match(text, /No changes from ideal team/);
  assert.deepEqual(f.calls, [{ cwd: f.cwd, yes: false }]);
  assert.deepEqual(await tree(f.home), before);
});
test('waiting roles show their local reset time', async t => {
  const f = await cli(t);
  await f.run('plan');
  assert.ok(f.lines.at(-1).includes(`Builder: waiting until ${local(iso(7200000))}`));
});
test('plan --json prints the phasePlan without an envelope', async t => {
  const f = await cli(t);
  await f.run('plan', { json: true });
  assert.deepEqual(JSON.parse(f.lines.at(-1)), plan);
});
test('plan without stored analysis gives clear message and exit code 1', async t => {
  const f = await fixture(t);
  const h = await harness({ git: true, diskStrategy: true, serviceDeps: { recoverRuns: async () => {} } });
  t.after(async () => { await rm(h.home, { recursive: true, force: true }); await rm(h.root, { recursive: true, force: true }); });
  const lines = [];
  const previous = process.exitCode;
  try {
    await runTeamCli({ cwd: f.cwd, teamAction: 'plan' }, { homeDir: f.home, getService: () => h.service, log: line => lines.push(line) });
    assert.equal(process.exitCode, 1);
    assert.equal(lines[0], 'No stored analysis. Run kairo team analysts and kairo team analyze first.');
  } finally { process.exitCode = previous; }
});
for (const exists of [true, false]) test(`show phase summary exists=${exists}`, async t => {
  const f = await cli(t, exists ? plan : null);
  await f.run('show');
  const text = f.lines.at(-1);
  assert.equal(text.includes('Current phase:'), exists);
  if (exists) {
    assert.match(text, /Current phase: 1.*Next change:/);
    assert.ok(text.includes(local(iso(3600000))));
    assert.match(text, /Builder: waiting/);
  }
  assert.deepEqual(f.calls, []);
});
for (const mode of ['changed', 'unchanged', 'ineligible', 'outside-pool']) test(`route phase preference: ${mode}`, async t => {
  const f = await fixture(t);
  const baseline = f.cli('--role', 'Builder');
  await f.cache();
  const baselineRoute = JSON.parse(f.cli('--role', 'Builder').stdout);
  const target = mode === 'outside-pool' ? { ...b, modelId: 'not-qualified' } : mode === 'unchanged' ? f.model : f.inputs.roles.Builder.pool[1];
  await writeProjectStrategy(f.home, f.cwd, { ...f.strategy, phasePlan: {
    ...plan, idealTeam: f.strategy.projectTeam,
    phases: [{ startsAt: iso(-60000), endsAt: null, team: [{ role: 'Builder', model: target }] }]
  } });
  if (mode === 'ineligible') { f.inputs.eligibility.claude.ok = false; await f.cache(); }
  const before = await tree(f.home), lines = [];
  await runTeamRouteCli({ cwd: f.cwd, role: 'Builder', json: true }, { homeDir: f.home, log: line => lines.push(line) });
  const route = JSON.parse(lines[0]);
  assert.equal(route.model.modelId, mode === 'changed' ? target.modelId : f.model.modelId);
  if (mode === 'unchanged' || mode === 'outside-pool') assert.deepEqual(route, baselineRoute);
  assert.deepEqual(await tree(f.home), before);
  assert.equal(baseline.status, 0);
});
test('plan uses real rebuild path with current quota, no model calls or writes; rebuild JSON includes it', async t => {
  const h = await harness({ git: true, diskStrategy: true, serviceDeps: { recoverRuns: async () => {}, now: () => now } });
  t.after(async () => { await rm(h.home, { recursive: true, force: true }); await rm(h.root, { recursive: true, force: true }); });
  const mi = { ...h.modelIntelligence, providerCapacity: { codex: { quotaRemainingPercent: 80, quotaWindows: [{ kind: '5h', remainingPercent: 80, resetsAtIso: iso(3600000), resetsInMs: 3600000, timeLeftFraction: .2 }] } } };
  h.service.snapshot = async () => ({ projectRoot: h.root, modelIntelligence: mi, timeline: [] });
  await writeProjectStrategy(h.home, h.root, { status: 'suggested', bootstrapAnalyst: a, roleCapabilities: { Builder: { required: ['coding'], optional: [] } }, projectTeam: [] });
  const before = await tree(h.home), lines = [];
  const deps = { homeDir: h.home, getService: () => h.service, log: line => lines.push(line) };
  await runTeamCli({ cwd: h.root, teamAction: 'plan', json: true }, deps);
  const actual = JSON.parse(lines.at(-1));
  assert.equal(actual.generatedAt, iso(0));
  assert.equal(actual.phases[0].budgets.codex.remainingPercent, 80);
  mi.providerCapacity.codex.quotaWindows[0].remainingPercent = 20;
  await runTeamCli({ cwd: h.root, teamAction: 'plan', json: true }, deps);
  assert.equal(JSON.parse(lines.at(-1)).phases[0].budgets.codex.remainingPercent, 20);
  await runTeamCli({ cwd: h.root, teamAction: 'rebuild', json: true }, deps);
  assert.ok(JSON.parse(lines.at(-1)).phasePlan);
  assert.deepEqual(await tree(h.home), before);
  assert.equal(h.counts.analyze, 0);
});
