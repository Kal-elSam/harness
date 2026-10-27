import test from 'node:test';
import assert from 'node:assert/strict';
import { decideLaunchModel } from '../src/global/hosts/gentle-shell-selector.js';

const cand = (provider, modelId, admitted = true) => ({ provider, modelId, admitted });
const snapshot = (overrides = {}) => ({
  roles: {
    Builder: { candidates: [cand('openai', 'gpt-a'), cand('anthropic', 'claude-b')] },
    Reviewer: { candidates: [cand('anthropic', 'claude-b'), cand('openai', 'gpt-a'), cand('google', 'gem-c')] },
    ...overrides.roles
  },
  agents: { 'gentle-ai-worker': 'Builder', 'team-reviewer-codex': 'Reviewer', ...overrides.agents }
});
const registry = [
  { provider: 'openai', id: 'gpt-a' }, { provider: 'anthropic', id: 'claude-b' }, { provider: 'google', id: 'gem-c' }
];
const decide = (request, snap = snapshot(), models = registry) => decideLaunchModel({ request, snapshot: snap, registryModels: models });

test('manual ordinary model is kept while admitted', () => {
  const result = decide({ agent: 'gentle-ai-worker', model: 'anthropic/claude-b', source: 'binding' });
  assert.equal(result.model, null);
});

test('manual ordinary model without quota moves to the next admitted candidate', () => {
  const snap = snapshot({ roles: { Builder: { candidates: [cand('openai', 'gpt-a', false), cand('anthropic', 'claude-b')] } } });
  const result = decide({ agent: 'gentle-ai-worker', model: 'openai/gpt-a', source: 'pin:local' }, snap);
  assert.equal(result.model, 'anthropic/claude-b');
});

test('manual Judgment Day agents are never touched, even out of quota', () => {
  const snap = snapshot({ roles: { Reviewer: { candidates: [cand('openai', 'gpt-a', false), cand('anthropic', 'claude-b')] } } });
  for (const agent of ['jd-judge-a', 'jd-judge-b', 'jd-fix-agent']) {
    assert.equal(decide({ agent, model: 'openai/gpt-a', source: 'frozen:global' }, snap).model, null);
  }
});

test('inherited ordinary agent gets the routed model', () => {
  assert.equal(decide({ agent: 'gentle-ai-worker', model: null, source: null }).model, 'openai/gpt-a');
  assert.equal(decide({ agent: 'gentle-ai-worker', model: 'x/y', source: 'default' }).model, 'openai/gpt-a');
});

test('inherited judges end on different providers and the fix agent follows Builder', () => {
  const a = decide({ agent: 'jd-judge-a', model: null, source: null });
  const b = decide({ agent: 'jd-judge-b', model: null, source: 'definition' });
  assert.equal(a.model, 'anthropic/claude-b');
  assert.equal(b.model, 'openai/gpt-a');
  assert.equal(decide({ agent: 'jd-fix-agent', model: null, source: null }).model, 'openai/gpt-a');
});

test('judges with a single admitted provider are not answered', () => {
  const snap = snapshot({ roles: { Reviewer: { candidates: [cand('openai', 'gpt-a'), cand('anthropic', 'claude-b', false)] } } });
  for (const agent of ['jd-judge-a', 'jd-judge-b']) {
    const result = decide({ agent, model: null, source: null }, snap);
    assert.deepEqual(result, { model: null, reason: 'judges-share-provider' });
  }
});

test('review lenses are never answered', () => {
  for (const agent of ['review-risk', 'review-resilience', 'review-readability', 'review-reliability', 'review-refuter', 'review-validator']) {
    assert.equal(decide({ agent, model: null, source: null }).model, null);
  }
});

test('an id present under two providers is ambiguous and not answered', () => {
  const dup = [...registry, { provider: 'azure', id: 'gpt-a' }];
  const result = decide({ agent: 'gentle-ai-worker', model: null, source: null }, snapshot({ roles: { Builder: { candidates: [cand('openai', 'gpt-a')] } } }), dup);
  assert.deepEqual(result, { model: null, reason: 'ambiguous-model' });
});

test('an unknown agent is not answered', () => {
  assert.deepEqual(decide({ agent: 'mystery', model: null, source: null }), { model: null, reason: 'unknown-agent' });
});

const teamSnapshot = (names, agents = {}) => ({
  roles: Object.fromEntries(names.map((name, index) => [name, { candidates: [cand(index % 2 ? 'anthropic' : 'openai', index % 2 ? 'claude-b' : 'gpt-a')] }])),
  agents
});

test('default Gentle Shell agents resolve to suffix-matched project roles', () => {
  const snap = teamSnapshot(['Backend Builder', 'Explorer', 'Verifier', 'Reviewer']);
  assert.equal(decide({ agent: 'gentle-ai-worker', model: null, source: null }, snap).model, 'openai/gpt-a');
  assert.equal(decide({ agent: 'jd-fix-agent', model: null, source: null }, snap).model, 'openai/gpt-a');
  assert.equal(decide({ agent: 'gentle-ai-explore', model: null, source: null }, snap).model, 'anthropic/claude-b');
  assert.equal(decide({ agent: 'gentle-ai-verify', model: null, source: null }, snap).model, 'openai/gpt-a');
});

test('a catalog entry for the agent overrides the default role', () => {
  const snap = teamSnapshot(['Backend Builder', 'Architect'], { 'gentle-ai-worker': 'Architect' });
  assert.equal(decide({ agent: 'gentle-ai-worker', model: null, source: null }, snap).model, 'anthropic/claude-b');
});

test('several roles ending in the default role name are not answered', () => {
  const snap = teamSnapshot(['Backend Builder', 'Frontend Builder']);
  assert.deepEqual(decide({ agent: 'gentle-ai-worker', model: null, source: null }, snap), { model: null, reason: 'ambiguous-role' });
  assert.deepEqual(decide({ agent: 'jd-fix-agent', model: null, source: null }, snap), { model: null, reason: 'ambiguous-role' });
});

test('a default role with no matching project role is unknown', () => {
  const snap = teamSnapshot(['Architect']);
  assert.deepEqual(decide({ agent: 'gentle-ai-explore', model: null, source: null }, snap), { model: null, reason: 'unknown-agent' });
});
