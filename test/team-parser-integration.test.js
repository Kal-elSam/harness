import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../src/cli.js';

test('team parser retains guard and onboarding during stacked integration', () => {
  for (const action of ['guard', 'onboarding']) {
    const parsed = parseArgs(['team', action, '--json']);
    assert.equal(parsed.command, 'team');
    assert.equal(parsed.options.teamAction, action);
    assert.equal(parsed.options.json, true);
  }
  assert.throws(() => parseArgs(['team', 'unknown-action']), error => {
    assert.match(error.message, /kairo team guard --json/);
    assert.match(error.message, /kairo team onboarding \[--json\] \[--cwd DIR\]/);
    return true;
  });
});
