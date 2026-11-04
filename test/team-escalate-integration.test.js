import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../src/cli.js';

test('team integration retains onboarding, guard, access and escalation', () => {
  for (const action of ['onboarding', 'guard', 'verify-access', 'escalate']) {
    const parsed = parseArgs(['team', action, '--json']);
    assert.equal(parsed.command, 'team');
    assert.equal(parsed.options.teamAction, action);
    assert.equal(parsed.options.json, true);
  }
  assert.throws(() => parseArgs(['team', 'unknown-action']), error => {
    for (const action of ['onboarding', 'guard', 'verify-access', 'escalate']) {
      assert.ok(error.message.includes(`kairo team ${action}`));
    }
    return true;
  });
});
