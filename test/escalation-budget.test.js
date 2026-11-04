import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateDelegationHandoff, DelegationContractError } from '../src/global/team/delegation-contract.js';
import { runTeamCli } from '../src/global/team/team-cli.js';
import { readTeamRoutes } from '../src/global/team/routing-input-cache.js';
import { fixture, tree } from './team-route-fixture.test.js';

const handoff = { goal: 'Resolve a decision', authorizedFiles: ['src/example.js'], preservedContracts: ['CLI output'], decisionsTaken: [], acceptanceChecks: ['node --test'], workBudget: 'One unit', escalationCondition: 'Uncertain scope' };
const escalation = { to: 'Frontier Authority', reason: 'uncertainty', evidence: 'Two incompatible contracts need a decision.' };
const budgetModule = () => import('../src/global/team/escalation-budget.js');
const day = 86400000;

// Frontier decisions accept only the three approved escalation triggers.
test('handoff accepts valid Frontier Authority escalation reasons', () => {
  for (const reason of ['risk', 'uncertainty', 'repeated_failure']) {
    const value = Object.freeze({ ...handoff, escalation: Object.freeze({ ...escalation, reason }) });
    assert.equal(validateDelegationHandoff(value), value);
  }
});

for (const [name, value, field] of [
  ['bad reason', { ...escalation, reason: 'routine_work' }, 'reason'],
  ['missing evidence', { to: escalation.to, reason: escalation.reason }, 'evidence'],
  ['wrong target', { ...escalation, to: 'Builder' }, 'to'],
]) {
  // Invalid escalation decisions must fail before workers can hand them off.
  test(`handoff rejects escalation with ${name}`, () => {
    assert.throws(() => validateDelegationHandoff({ ...handoff, escalation: value }), error =>
      error instanceof DelegationContractError && error.code === 'invalid_handoff' && error.field === `escalation.${field}`);
    if (field === 'evidence') assert.throws(() => validateDelegationHandoff({ ...handoff, escalation: { ...escalation, evidence: '  ' } }),
      error => error instanceof DelegationContractError && error.field === 'escalation.evidence');
  });
}

// Legacy handoffs retain their exact object and serialized representation.
test('handoff without escalation remains unchanged', () => {
  const value = Object.freeze({ ...handoff });
  const before = JSON.stringify(value);
  assert.equal(validateDelegationHandoff(value), value);
  assert.equal(JSON.stringify(value), before);
  assert.equal(Object.hasOwn(value, 'escalation'), false);
});

// Every cell shares the project budget, with expired entries excluded on reads and writes.
test('record then read shares the budget and drops entries at seven days', async t => {
  const { recordEscalation, readEscalationBudget } = await budgetModule();
  const f = await fixture(t);
  const now = Date.parse('2026-11-03T12:00:00Z');
  await recordEscalation(f.home, f.cwd, escalation, { now: () => now - 8 * day });
  await recordEscalation(f.home, f.cwd, { ...escalation, reason: 'risk' }, { now: () => now - 7 * day });
  await recordEscalation(f.home, f.cwd, escalation, { now: () => now - day });
  const before = await tree(f.home);
  const budget = await readEscalationBudget(f.home, f.cwd, { now: () => now });
  assert.deepEqual(Object.keys(budget), ['used', 'cap', 'remaining', 'windowDays', 'entries']);
  assert.equal(budget.used, 1);
  assert.equal(budget.remaining, budget.cap - 1);
  assert.equal(budget.windowDays, 7);
  assert.equal(budget.entries.length, 1);
  assert.deepEqual(budget.entries[0], { ...escalation, at: new Date(now - day).toISOString() });
  assert.deepEqual(await tree(f.home), before);
  assert.equal((await recordEscalation(f.home, f.cwd, escalation, { now: () => now })).ok, true);
  assert.equal((await readEscalationBudget(f.home, f.cwd, { now: () => now })).used, 2);
});

// Exhaustion cannot change even one byte of the ledger or create ancillary files.
test('record refuses at cap without writing', async t => {
  const { recordEscalation, readEscalationBudget, escalationBudgetPath } = await budgetModule();
  const f = await fixture(t);
  const initial = await readEscalationBudget(f.home, f.cwd);
  assert.ok(Number.isInteger(initial.cap) && initial.cap > 0);
  for (let i = 0; i < initial.cap; i++) assert.equal((await recordEscalation(f.home, f.cwd, escalation)).ok, true);
  const hash = async () => createHash('sha256').update(await readFile(escalationBudgetPath(f.home, f.cwd))).digest('hex');
  const beforeHash = await hash();
  const beforeTree = await tree(f.home);
  const result = await recordEscalation(f.home, f.cwd, escalation);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'escalation_budget_exhausted');
  assert.equal(result.remaining, 0);
  assert.equal(await hash(), beforeHash);
  assert.deepEqual(await tree(f.home), beforeTree);
});

// The routes command reports the shared budget without mutating HOME.
test('routes JSON shows the escalation summary and writes nothing', async t => {
  const f = await fixture(t);
  await f.cache();
  const before = await tree(f.home);
  const core = await readTeamRoutes({ cwd: f.cwd, homeDir: f.home });
  assert.deepEqual(core.escalation, { used: 0, cap: 10, remaining: 10 });
  assert.deepEqual(await tree(f.home), before);
  const lines = [];
  await runTeamCli({ cwd: f.cwd, teamAction: 'routes', json: true }, { homeDir: f.home, log: line => lines.push(line) });
  const out = JSON.parse(lines.at(-1));
  assert.ok(out.escalation, 'routes JSON must include escalation');
  assert.deepEqual(Object.keys(out.escalation), ['used', 'cap', 'remaining']);
  assert.equal(out.escalation.used, 0);
  assert.equal(out.escalation.remaining, out.escalation.cap);
  assert.ok(out.escalation.cap > 0);
  assert.deepEqual(await tree(f.home), before);
  const { recordEscalation } = await budgetModule();
  await recordEscalation(f.home, f.cwd, escalation);
  const afterRecord = await tree(f.home);
  lines.length = 0;
  await runTeamCli({ cwd: f.cwd, teamAction: 'routes', json: true }, { homeDir: f.home, log: line => lines.push(line) });
  assert.deepEqual(JSON.parse(lines.at(-1)).escalation, { used: 1, cap: 10, remaining: 9 });
  assert.deepEqual(await tree(f.home), afterRecord);
});
