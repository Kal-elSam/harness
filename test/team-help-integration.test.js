import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('team help retains guard, onboarding and routed effort during integration', () => {
  const result = spawnSync(process.execPath, ['bin/kairo.js', 'help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /team guard --json/);
  assert.match(result.stdout, /team onboarding \[--json\] \[--cwd DIR\]/);
  assert.match(result.stdout, /team exec --provider P --model M \[--effort LEVEL\]/);
});
