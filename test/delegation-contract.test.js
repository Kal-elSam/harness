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
test('handoff rejects wildcard, directory, tilde and drive-letter surfaces', () => {
  for (const authorizedFiles of [['**/*.js'], ['*.js'], ['src/'], ['src/**'], ['src/**/*'], ['src/*'], ['~/x'], ['C:/x'], ['src/a.js', '*.js']])
    assert.throws(() => validateDelegationHandoff({ ...handoff, authorizedFiles }), error => error instanceof DelegationContractError && error.field === 'authorizedFiles', authorizedFiles.join());
});
test('handoff keeps narrow files and globs', () => {
  for (const authorizedFiles of [['test/write-guard*.test.js'], ['src/guard.js', 'docs/a.md']]) assert.doesNotThrow(() => validateDelegationHandoff({ ...handoff, authorizedFiles }));
});
test('worker result cannot carry an approved field', () => {
  for (const approved of [true, false, undefined]) assert.throws(() => validateWorkerResult({ diff: '', evidence: ['e'], blockers: [], approved }), error => error instanceof DelegationContractError && error.field === 'approved');
});
// Protects enforcement of explicit test budgets, including evidence rather than an unverified success claim.
test('worker result rejects full suite outside test budget', () => {
  const budgeted = { ...handoff, testBudget: { focused: ['test/guard.test.js'], affected: [], fullSuite: 'never' } };
  assert.equal(validateDelegationHandoff(budgeted), budgeted);
  const result = { diff: '', evidence: ['test results'], blockers: [], testsRun: { focused: ['test/guard.test.js'], affected: [], fullSuite: true } };
  assert.throws(() => validateWorkerResult(result, budgeted), error => error.field === 'testsRun.fullSuite');
  assert.throws(() => validateWorkerResult({ ...result, testsRun: undefined }, budgeted), error => error.field === 'testsRun');
  const allowed = { ...result, testsRun: { ...result.testsRun, fullSuite: false } };
  assert.equal(validateWorkerResult(allowed, budgeted), allowed);
  assert.equal(validateWorkerResult(result, { ...budgeted, testBudget: { ...budgeted.testBudget, fullSuite: 'once-per-slice' } }), result);
});
// Protects byte-for-byte compatibility for callers that do not opt into test budgeting.
test('legacy handoff and result remain unchanged without testBudget', () => {
  const old = Object.freeze({ ...handoff }); const before = JSON.stringify(old);
  const result = Object.freeze({ diff: '', evidence: ['checks'], blockers: [] });
  assert.equal(validateDelegationHandoff(old), old); assert.equal(JSON.stringify(old), before);
  assert.equal(validateWorkerResult(result, old), result);
});
