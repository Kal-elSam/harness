import test from 'node:test';
import assert from 'node:assert/strict';
import { runTeamCli } from '../src/global/team/team-cli.js';
import { buildTeamRoutesPlan } from '../src/global/team/team-plan.js';
import { writeProjectStrategy } from '../src/global/team/project-strategy-store.js';
import { fixture } from './team-route-fixture.test.js';

async function routes(f, json = true) {
  const lines = [];
  const plan = await runTeamCli({ teamAction: 'routes', cwd: f.cwd, json }, { homeDir: f.home, log: line => lines.push(line) });
  return { plan, text: lines.join('\n') };
}

// Approved v2 seats expose hierarchy without reordering the routing rows.
test('routes JSON adds registry cells, seat kinds and the read-only session orchestrator', async t => {
  const f = await fixture(t);
  const roles = ['Builder', 'Execution Coordinator', 'Explorer', 'Technical Lead', 'Quality Lead', 'Reviewer'];
  await writeProjectStrategy(f.home, f.cwd, { ...f.strategy, projectTeam: roles.map(role => ({ role, model: f.model })) });
  const { plan, text } = await routes(f);
  assert.deepEqual(JSON.parse(text), plan);
  assert.deepEqual(plan.rows.map(row => row.role), roles);
  assert.deepEqual(plan.orchestrator, { role: 'Master Orchestrator', model: 'session model', permission: 'read-only' });
  assert.deepEqual(plan.rows[0].cell, { id: 'implementation', name: 'Implementation' });
  assert.deepEqual(plan.rows.map(row => row.seatKind), ['worker', 'lead', 'worker', 'lead', 'lead', 'worker']);
});

// Legacy persisted roles gain hierarchy through the existing read-time migration.
test('routes JSON derives cells after legacy team migration', async t => {
  const f = await fixture(t);
  await writeProjectStrategy(f.home, f.cwd, { ...f.strategy, projectTeam: [{ role: 'Architect', model: f.model }, { role: 'Backend Builder', model: f.model }] });
  const { plan } = await routes(f);
  assert.deepEqual(plan.rows.map(row => [row.role, row.cell?.id, row.seatKind]), [
    ['Technical Lead', 'design', 'lead'], ['Builder', 'implementation', 'worker'],
  ]);
});

// Text presentation groups project cells and retains unknown seats at the end.
test('routes text starts with orchestrator and prints leads before workers and Other last', async t => {
  const f = await fixture(t);
  await writeProjectStrategy(f.home, f.cwd, { ...f.strategy,
    proposal: { cells: [{ id: 'ml', name: 'ML', seats: ['ML Builder'] }], seats: [{ role: 'ML Builder', extends: 'Builder', cell: 'ML' }] },
    projectTeam: ['Builder', 'Execution Coordinator', 'ML Builder', 'Mystery'].map(role => ({ role, model: f.model })) });
  const { text, plan } = await routes(f, false);
  assert.match(text, /^Master Orchestrator \(session model\)/);
  assert.ok(text.indexOf('Implementation') < text.indexOf('Execution Coordinator'));
  assert.ok(text.indexOf('Execution Coordinator') < text.indexOf('  Builder'));
  assert.ok(text.indexOf('ML\n') < text.indexOf('ML Builder'));
  assert.ok(text.indexOf('Other\n') > text.indexOf('ML Builder'));
  assert.match(text, /Mystery/);
  assert.deepEqual(plan.rows[2].cell, { id: 'ml', name: 'ML' });
  assert.equal(plan.rows[2].seatKind, 'worker');
});

// Existing JSON consumers keep identical fields, order and fingerprint.
test('routes JSON preserves every pre-tree field and fingerprint', async t => {
  const f = await fixture(t);
  await f.cache();
  const before = await buildTeamRoutesPlan({ cwd: f.cwd }, { homeDir: f.home });
  const { plan } = await routes(f);
  assert.equal(plan.status, before.status);
  assert.equal(plan.fingerprint, before.fingerprint);
  assert.deepEqual(plan.rows.map(({ cell, seatKind, ...row }) => row), before.rows);
});
