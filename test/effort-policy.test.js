import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseEffort } from '../src/global/team/effort-policy.js';

// S16: labor roles get the cheapest effort, analysis roles higher.
test('effort follows the role class', () => {
  assert.equal(chooseEffort({ role: 'Explorer', tier: 'light', provider: 'codex' }).effort, 'low');
  assert.equal(chooseEffort({ role: 'Builder', tier: 'standard', provider: 'claude' }).effort, 'medium');
  assert.equal(chooseEffort({ role: 'Reviewer', tier: 'demanding', provider: 'claude' }).effort, 'high');
});

// S16: high-risk demand raises effort, capped at the provider's top level.
test('high-risk demand raises effort without exceeding the provider maximum', () => {
  assert.equal(chooseEffort({ role: 'Builder', tier: 'standard', provider: 'codex', risk: 'high' }).effort, 'high');
  assert.equal(chooseEffort({ role: 'Reviewer', tier: 'demanding', provider: 'codex', risk: 'high' }).effort, 'high');
});

// S16: tight quota lowers effort one level, never below the provider minimum.
test('tight quota lowers effort and never goes below the minimum', () => {
  const lowered = chooseEffort({ role: 'Builder', tier: 'standard', provider: 'codex', quotaRemainingPercent: 20 });
  assert.equal(lowered.effort, 'low');
  assert.match(lowered.reason, /quota 20% left/);
  assert.equal(chooseEffort({ role: 'Explorer', tier: 'light', provider: 'codex', quotaRemainingPercent: 5 }).effort, 'low');
});

// S16/S17: a provider with no effort support gets no effort, never an invented level.
test('unsupported provider or unknown class yields no effort', () => {
  assert.equal(chooseEffort({ role: 'Builder', tier: 'standard', provider: 'opencode' }), null);
  assert.equal(chooseEffort({ role: 'X', provider: 'codex' }), null);
});
