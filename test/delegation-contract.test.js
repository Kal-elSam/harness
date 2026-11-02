import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDelegationHandoff, validateWorkerResult, DelegationContractError } from '../src/global/team/delegation-contract.js';
const handoff = { goal: 'Implement guard', authorizedFiles: ['src/guard.js'], preservedContracts: ['CLI output'], decisionsTaken: ['Use registry'], acceptanceChecks: ['node --test'], workBudget: 'One slice', escalationCondition: 'Scope changes' };
test('valid handoff is pure and returns the original object', () => {
  const frozen = Object.freeze(handoff);
  assert.equal(validateDelegationHandoff(frozen), frozen);
});
for (const key of Object.keys(handoff)) test(`handoff requires ${key}`, () => {
  const value = { ...handoff }; delete value[key];
  assert.throws(() => validateDelegationHandoff(value), error => error instanceof DelegationContractError && error.code === 'invalid_handoff' && error.field === key);
});
test('handoff rejects malformed, empty and unbounded surfaces', () => {
  for (const value of [null, [], { ...handoff, goal: ' ' }, { ...handoff, authorizedFiles: ['.'] }, { ...handoff, authorizedFiles: ['/repo/a'] }, { ...handoff, authorizedFiles: ['../a'] }, { ...handoff, acceptanceChecks: 'test' }, { ...handoff, workBudget: {} }])
    assert.throws(() => validateDelegationHandoff(value), DelegationContractError);
});
test('worker result requires diff, evidence and blockers; empty diff/blockers allowed', () => {
  const result = { diff: '', evidence: ['node --test: pass'], blockers: [] };
  assert.equal(validateWorkerResult(Object.freeze(result)), result);
  for (const value of [null, {}, { ...result, diff: [] }, { ...result, evidence: [] }, { ...result, blockers: 'none' }])
    assert.throws(() => validateWorkerResult(value), error => error instanceof DelegationContractError && error.code === 'invalid_worker_result');
});
