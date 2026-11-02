import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const run = input => spawnSync(process.execPath, ['bin/kairo.js', 'team', 'guard', '--json'], { input, encoding: 'utf8', env: { ...process.env, KAIRO_HOME: '/dev/null/unavailable' } });
test('team guard stdin JSON allows, denies and rejects malformed input without state access', () => {
  for (const [input, allow] of [[JSON.stringify({ host: 'codex', role: 'Master Orchestrator', tool: 'Bash', command: 'git commit -m x' }), true], [JSON.stringify({ host: 'claude', role: 'Execution Coordinator', tool: 'Write', paths: ['a.js'] }), false], ['{', false]]) {
    const result = run(input);
    assert.equal(result.status, allow ? 0 : 1, result.stderr);
    const decision = JSON.parse(result.stdout);
    assert.equal(decision.allow, allow);
    assert.equal(typeof decision.reason, 'string');
    assert.equal(result.stderr, '');
  }
});
