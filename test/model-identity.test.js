import test from 'node:test';
import assert from 'node:assert/strict';
import { assessModelIdentity, compareLaunchModel, creditedOutcomes, identityLabel, modelFamily } from '../src/global/team/model-identity.js';
import { buildRoleTelemetry } from '../src/global/intelligence/role-telemetry.js';

const HAIKU_45 = 'claude-haiku-4-5-20251001';

test('Haiku 4.5 requested, haiku alias sent, claude-haiku-5-5 observed is a version mismatch', () => {
  const r = assessModelIdentity({ requestedProvider: 'claude', requestedModel: HAIKU_45, dispatchedAlias: 'haiku', observedModels: ['claude-haiku-5-5'] });
  assert.deepEqual(r, { requestedModelId: HAIKU_45, dispatchedModelAlias: 'haiku', observedModelId: 'claude-haiku-5-5', identityStatus: 'mismatch', divergence: 'version' });
});

test('without an observation the identity is unverified, never matched', () => {
  const r = assessModelIdentity({ requestedProvider: 'claude', requestedModel: HAIKU_45, dispatchedAlias: 'haiku' });
  assert.equal(r.identityStatus, 'unverified'); assert.equal(r.divergence, 'unverified'); assert.equal(r.observedModelId, null);
});

test('provider and family divergence are distinguished from version divergence', () => {
  assert.equal(assessModelIdentity({ requestedProvider: 'claude', requestedModel: HAIKU_45, observedModels: ['gpt-6.1-sol'] }).divergence, 'provider');
  assert.equal(assessModelIdentity({ requestedProvider: 'claude', requestedModel: HAIKU_45, observedModels: ['claude-sonnet-5-5'] }).divergence, 'family');
  assert.equal(assessModelIdentity({ requestedProvider: 'codex', requestedModel: 'gpt-6.1-sol', observedModels: ['gpt-6.1-terra'] }).divergence, 'family');
  assert.equal(assessModelIdentity({ requestedProvider: 'codex', requestedModel: 'gpt-6.1-sol', observedModels: ['gpt-6-sol'] }).divergence, 'version');
});

test('a plain alias is matched by any model of its family and identical ids ignore a date suffix', () => {
  assert.equal(assessModelIdentity({ requestedProvider: 'claude', requestedModel: 'haiku', observedModels: ['claude-haiku-5-5'] }).identityStatus, 'matched');
  assert.equal(assessModelIdentity({ requestedProvider: 'claude', requestedModel: HAIKU_45, observedModels: ['claude-haiku-4-5'] }).identityStatus, 'matched');
  assert.equal(assessModelIdentity({ requestedProvider: 'claude', requestedModel: 'haiku', observedModels: ['claude-sonnet-5-5'] }).divergence, 'family');
});

test('agent-own requests are not comparable: the observation is kept, the status stays unverified', () => {
  const r = assessModelIdentity({ requestedProvider: 'claude', requestedModel: 'agent-own', observedModels: ['claude-haiku-5-5'] });
  assert.equal(r.identityStatus, 'unverified'); assert.equal(r.observedModelId, 'claude-haiku-5-5');
});

test('mixed observed models: mismatch unless all match, observed id is the most frequent', () => {
  const mixed = assessModelIdentity({ requestedProvider: 'claude', requestedModel: HAIKU_45, observedModels: ['claude-haiku-5-5', 'claude-haiku-5-5', HAIKU_45] });
  assert.equal(mixed.identityStatus, 'mismatch'); assert.equal(mixed.observedModelId, 'claude-haiku-5-5');
  assert.equal(assessModelIdentity({ requestedProvider: 'claude', requestedModel: HAIKU_45, observedModels: [HAIKU_45, HAIKU_45] }).identityStatus, 'matched');
});

test('launch comparison: same-family alias is unproven, other differences keep reporting', () => {
  const base = { selectedProvider: 'claude', launchedProvider: 'claude' };
  assert.deepEqual(compareLaunchModel({ ...base, selectedModel: HAIKU_45, launchedModel: 'haiku' }), { fallbackDetected: null, divergence: 'unverified' });
  assert.equal(compareLaunchModel({ ...base, selectedModel: HAIKU_45, launchedModel: 'sonnet' }).fallbackDetected, true);
  assert.equal(compareLaunchModel({ selectedProvider: 'codex', launchedProvider: 'codex', selectedModel: 'gpt-a', launchedModel: 'gpt-a' }).fallbackDetected, false);
  assert.equal(modelFamily('claude-haiku-4-5-20251001'), 'haiku');
});

test('credit: mismatch credits the observed model, unverified keeps the recorded model, matched and legacy are unchanged', () => {
  const rows = [
    { source: 'outcome', adapterId: 'claude', modelId: HAIKU_45, role: 'Builder', status: 'completed', result: 'pass', at: 'x', identityStatus: 'mismatch', observedModelId: 'claude-haiku-5-5' },
    { source: 'outcome', adapterId: 'claude', modelId: HAIKU_45, role: 'Builder', status: 'completed', result: 'pass', at: 'x', identityStatus: 'unverified' },
    { source: 'outcome', adapterId: 'claude', modelId: HAIKU_45, role: 'Builder', status: 'completed', result: 'pass', at: 'x', identityStatus: 'matched' },
    { source: 'outcome', adapterId: 'claude', modelId: HAIKU_45, role: 'Builder', status: 'completed', result: 'pass', at: 'x' },
  ];
  const credited = creditedOutcomes(rows);
  assert.deepEqual(credited.map(r => r.modelId), ['claude-haiku-5-5', HAIKU_45, HAIKU_45, HAIKU_45]);
  assert.strictEqual(credited[1], rows[1]); assert.strictEqual(credited[2], rows[2]); assert.strictEqual(credited[3], rows[3]);
  const codex = { source: 'outcome', adapterId: 'codex', modelId: 'gpt-6.1-sol', role: 'Builder', status: 'completed', result: 'pass', at: 'x', identityStatus: 'unverified' };
  const failed = { ...rows[1], result: 'fail', status: 'failed' };
  assert.deepEqual(creditedOutcomes([codex, failed]), [codex, failed]);
  assert.deepEqual(creditedOutcomes([{ ...rows[0], observedModelId: undefined }]), []);
  const models = [{ adapterId: 'claude', modelId: HAIKU_45 }, { adapterId: 'claude', modelId: 'claude-haiku-5-5' }];
  const many = Array.from({ length: 5 }, () => rows[0]).concat(Array.from({ length: 5 }, () => rows[1]));
  const roles = buildRoleTelemetry(creditedOutcomes(many).map(r => ({ ...r, at: new Date().toISOString() })), models).roles.Builder;
  assert.equal(roles.get(`claude::${HAIKU_45}`).resultRuns, 5);
  assert.equal(roles.get('claude::claude-haiku-5-5').resultRuns, 5);
});

test('labels name the observed or unverified identity; legacy rows read as before', () => {
  assert.equal(identityLabel({ modelId: 'm' }), 'm');
  assert.equal(identityLabel({ modelId: 'a', identityStatus: 'mismatch', observedModelId: 'b' }), 'requested a, observed b');
  assert.equal(identityLabel({ modelId: 'a', identityStatus: 'unverified' }), 'a, identity unverified');
});
