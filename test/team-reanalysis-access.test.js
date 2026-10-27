import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTeamCli } from '../src/global/team/team-cli.js';
import { writeProjectStrategy } from '../src/global/team/project-strategy-store.js';
import { createSetupOperations } from '../src/global/team/setup-operations.js';

const ref = (modelId, adapterId = 'codex') => ({ adapterId, modelId, displayName: modelId });
const strategyOf = status => ({
  schema: 'kairo.project-strategy/v1', status, profileFingerprint: 'fp-1',
  approvedAt: status === 'active' ? '2026-10-22T10:00:00Z' : null,
  orchestrator: null, bootstrapAnalyst: null,
  projectTeam: [{ role: 'Builder', model: ref('gpt-6-luna'), fallback: null, assignmentSource: 'recommended', assignmentState: 'ready' }]
});
const entry = (over = {}) => ({ candidateKey: 'claude::opus', adapterId: 'claude', modelId: 'opus', displayName: 'opus', available: true, recommendationTags: [], ...over });

// The analyst is listed (available) for the first read, then the access evidence
// changes before the plan and the confirmation read the facts again.
async function setup(t, { status, after }) {
  const home = await mkdtemp(join(tmpdir(), 'kairo-reanalysis-home-'));
  const root = await mkdtemp(join(tmpdir(), 'kairo-reanalysis-root-'));
  t.after(async () => { await rm(home, { recursive: true, force: true }); await rm(root, { recursive: true, force: true }); });
  if (status) await writeProjectStrategy(home, root, strategyOf(status));
  const calls = [];
  let reads = 0;
  const state = { pending: null };
  const service = {
    pendingTeamProposal: async () => state.pending,
    readSetup: async () => {
      reads += 1;
      const base = { strategy: status ? strategyOf(status) : null, adapters: [], providerCapacity: {}, claudeEntitlement: {}, cursorAccess: {} };
      return reads === 1
        ? { ...base, knownCandidates: [], analystCatalog: { recommendedModel: null, models: [entry()] } }
        : { ...base, ...after };
    },
    preflightProject: async () => ({ profile: { fingerprint: 'fp-2' }, candidates: [], analystCatalog: { recommendedModel: null } }),
    runBootstrapAnalysis: async args => { calls.push(['analyze', args]); state.pending = { proposalId: 'p1' }; return { pending: true, proposalId: 'p1' }; }
  };
  const run = async (extra = {}) => {
    const outputs = [];
    reads = 0;
    const before = process.exitCode;
    try {
      process.exitCode = 0;
      const result = await runTeamCli({ teamAction: 'analyze', cwd: root, analyst: 'opus', ...extra }, {
        homeDir: home, env: {}, resolveRoot: async c => c, getService: () => service, log: text => outputs.push(text)
      });
      return { result, output: outputs.at(-1), exitCode: process.exitCode };
    } finally { process.exitCode = before; }
  };
  return { run, calls, state, service, root };
}

const UNVERIFIED = { knownCandidates: [], analystCatalog: { recommendedModel: null, models: [entry({ available: false, cause: 'access_unknown' })] } };
const DENIED = {
  knownCandidates: [{ candidateKey: 'claude::opus', adapterId: 'claude', modelId: 'opus', displayName: 'opus', entitlement: 'denied' }],
  analystCatalog: { recommendedModel: null, models: [] }
};

for (const [name, after, code] of [['unverified', UNVERIFIED, 'access_unverified'], ['denied', DENIED, 'access_denied']]) {
  test(`re-analysis of an active team refuses an ${name} analyst like the normal analyze path and writes nothing`, async t => {
    const normal = await setup(t, { status: null, after });
    const n = await normal.run({ yes: true });
    const active = await setup(t, { status: 'active', after });
    for (const extra of [{}, { yes: true }]) {
      const p = await active.run(extra);
      assert.equal(p.result.ok, false);
      assert.equal(p.result.code, code);
      assert.equal(p.result.code, n.result.code);
      assert.equal(p.result.error, n.result.error);
      assert.equal(p.exitCode, 1);
    }
    assert.equal(active.calls.length, 0);
    assert.equal(active.state.pending, null);
    assert.equal(normal.calls.length, 0);
  });
}

test('re-analysis of an active team refuses when the confirmation target went stale', async t => {
  // Facts differ between the plan read and the confirmation read: profile changes.
  const h = await setup(t, { status: 'active', after: { knownCandidates: [], analystCatalog: { recommendedModel: null, models: [entry()] } } });
  let pre = 0;
  h.service.preflightProject = async () => ({ profile: { fingerprint: `fp-${pre += 1}` }, candidates: [], analystCatalog: { recommendedModel: null } });
  const p = await h.run({ yes: true });
  assert.equal(p.result.ok, false);
  assert.equal(p.result.code, 'confirmation_stale');
  assert.equal(h.calls.length, 0);
});

test('setup operations plan a re-analysis of an active team instead of refusing with strategy_active', async () => {
  const facts = { strategy: strategyOf('active'), knownCandidates: [], adapters: [], claudeEntitlement: {}, cursorAccess: {},
    analystCatalog: { recommendedModel: null, models: [entry()] } };
  const calls = [];
  const service = {
    readSetup: async () => facts, preflightProject: async () => ({ profile: { fingerprint: 'fp' }, candidates: [] }),
    runBootstrapAnalysis: async args => { calls.push(args); return { pending: true, proposalId: 'p9' }; }
  };
  const ops = createSetupOperations({ cwd: '/x', run: async (_fallback, fn) => fn(service) });
  const plan = await ops.planSetup({ action: 'run_analysis', analyzerKey: 'claude::opus' });
  assert.equal(plan.decision, 'READY');
  const out = await ops.runAnalysis({ confirmationTarget: plan.confirmationTarget });
  assert.equal(out.action, 'run_analysis');
  assert.equal(out.pending, true);
  assert.equal(out.proposalId, 'p9');
  assert.equal(out.strategyStatus, 'active');
  assert.equal(calls.length, 1);
});
