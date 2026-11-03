import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../src/cli.js';

test('team integration preserves onboarding, guard and access verification', () => {
  for (const action of ['onboarding', 'guard', 'verify-access']) {
    const parsed = parseArgs(['team', action, '--json']);
    assert.equal(parsed.command, 'team');
    assert.equal(parsed.options.teamAction, action);
    assert.equal(parsed.options.json, true);
  }
  assert.throws(() => parseArgs(['team', 'unknown-action']), error => {
    assert.match(error.message, /kairo team onboarding/);
    assert.match(error.message, /kairo team guard/);
    assert.match(error.message, /kairo team verify-access/);
    return true;
  });
});
