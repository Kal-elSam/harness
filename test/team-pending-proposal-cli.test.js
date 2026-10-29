import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTeamCli } from '../src/global/team/team-cli.js';
import { writeProjectStrategy } from '../src/global/team/project-strategy-store.js';
import { parseArgs } from '../src/cli.js';

const ref = (modelId, adapterId = 'codex') => ({ adapterId, modelId, displayName: modelId });
const strategyOf = (status, models) => ({
  schema: 'kairo.project-strategy/v1', status, profileFingerprint: 'fp-1',
  approvedAt: status === 'active' ? '2026-10-22T10:00:00Z' : null,
  orchestrator: null, bootstrapAnalyst: null,
  projectTeam: Object.entries(models).map(([role, model]) => ({ role, model: ref(model), fallback: null, assignmentSource: 'recommended', assignmentState: 'ready' }))
});
const PENDING_ID = '4cc622bcdc4ae2872e924c3d';
const proposalOf = (id = PENDING_ID, source = 'manual-rebuild') => ({
  outcome: 'proposed', source, proposalId: id, fingerprint: null, affected: [], basedOn: null,
  proposal: strategyOf('suggested', { Builder: 'gpt-6-terra', Explorer: 'haiku-5' })
});

async function setup(t, { status = 'active', pending = null } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'kairo-pending-cli-'));
  const root = await mkdtemp(join(tmpdir(), 'kairo-pending-root-'));
  t.after(async () => { await rm(home, { recursive: true, force: true }); await rm(root, { recursive: true, force: true }); });
  if (status) await writeProjectStrategy(home, root, strategyOf(status, { Builder: 'gpt-6-luna', Explorer: 'sonnet-5' }));
  const calls = [];
  const state = { pending };
  const service = {
    pendingTeamProposal: async () => state.pending,
    approveRecoveryProposal: async args => { calls.push(['approve', args]); state.pending = null; return { outcome: 'approved', proposalId: args.proposalId }; },
    rejectRecoveryProposal: async args => { calls.push(['reject', args]); state.pending = null; return { outcome: 'rejected', proposalId: args.proposalId }; },
    rebuildProjectTeam: async args => {
      calls.push(['rebuild', args]);
      return { changed: true, applied: args.yes === true, pending: args.yes === true && status === 'active', proposalId: PENDING_ID,
        roles: [{ role: 'Builder', old: { model: 'gpt-6-luna' }, new: { model: 'gpt-6-terra', assignmentState: 'ready' }, changed: true }] };
    },
    readSetup: async () => ({ strategy: state.strategy ?? null, knownCandidates: [], claudeEntitlement: {}, cursorAccess: {}, adapters: [], providerCapacity: {},
      analystCatalog: { recommendedModel: null, models: [{ candidateKey: 'codex::gpt-6-astra', adapterId: 'codex', modelId: 'gpt-6-astra', displayName: 'gpt-6-astra', available: true, recommendationTags: [] }] } }),
    preflightProject: async () => ({ profile: { fingerprint: 'fp-2' }, candidates: [], analystCatalog: { recommendedModel: null } }),
    runBootstrapAnalysis: async args => {
      calls.push(['analyze', args]);
      state.pending = proposalOf('prop-reanalysis', 'manual-reanalysis');
      return { pending: true, proposalId: 'prop-reanalysis' };
    }
  };
  if (status) service.readSetup = (orig => async a => ({ ...(await orig(a)), strategy: strategyOf(status, { Builder: 'gpt-6-luna', Explorer: 'sonnet-5' }) }))(service.readSetup);
  const outputs = [];
  const run = async (teamAction, extra = {}) => {
    const before = process.exitCode;
    try {
      process.exitCode = 0;
      const result = await runTeamCli({ teamAction, cwd: root, ...extra }, {
        homeDir: home, env: {}, resolveRoot: async c => c, getService: () => service, log: text => outputs.push(text)
      });
      return { result, output: outputs.at(-1), exitCode: process.exitCode };
    } finally { process.exitCode = before; }
  };
  return { run, calls, state, root };
}

test('analyze --yes on an active team stores a pending proposal and prints id, roles and exact commands', async t => {
  const h = await setup(t);
  const p = await h.run('analyze', { analyst: 'gpt-6-astra', yes: true });
  assert.equal(p.exitCode, 0);
  assert.equal(h.calls.filter(c => c[0] === 'analyze').length, 1);
  assert.equal(p.result.pending, true);
  assert.equal(p.result.proposalId, 'prop-reanalysis');
  assert.match(p.output, /Builder\s+gpt-6-luna\s+gpt-6-terra/);
  assert.match(p.output, /prop-reanalysis/);
  assert.match(p.output, /approved team keeps routing/i);
  assert.ok(p.output.includes('kairo team approve --yes --proposal prop-reanalysis'));
  assert.ok(p.output.includes('kairo team reject --proposal prop-reanalysis'));
});

test('analyze on an active team without --yes previews and runs no analysis', async t => {
  const h = await setup(t);
  const p = await h.run('analyze', { analyst: 'gpt-6-astra' });
  assert.equal(p.exitCode, 0);
  assert.equal(p.result.applied, false);
  assert.equal(h.calls.length, 0);
  assert.match(p.output, /Preview only/);
});

test('analyze with no active team keeps the draft preview unchanged', async t => {
  const h = await setup(t, { status: null });
  const p = await h.run('analyze', { analyst: 'gpt-6-astra' });
  assert.equal(p.exitCode, 0);
  assert.equal(p.output, `Analyze a sanitized snapshot of this project: ${h.root}\nNo project goal given. Add --goal "TEXT" or .kairo/goal.md.\nAnalyst: gpt-6-astra (codex). This spends provider usage.\nPreview only. Run kairo team analyze --analyst gpt-6-astra --yes to create a draft team.`);
  assert.equal(h.calls.length, 0);
});

test('approve without --yes previews the pending proposal with roles, old vs new model, id and source', async t => {
  const h = await setup(t, { pending: proposalOf() });
  const p = await h.run('approve');
  assert.equal(p.exitCode, 0);
  assert.equal(p.result.applied, false);
  assert.match(p.output, /Builder\s+gpt-6-luna\s+gpt-6-terra/);
  assert.ok(p.output.includes(PENDING_ID));
  assert.ok(p.output.includes('manual-rebuild'));
  assert.ok(p.output.includes(`kairo team approve --yes --proposal ${PENDING_ID}`));
  assert.equal(h.calls.length, 0);
});

// A recovery proposal swapped demanding roles to older models with no explanation in the preview.
test('approve preview explains each proposed model so a weak swap is visible before approval', async t => {
  const pending = proposalOf(PENDING_ID, 'automatic-recovery');
  pending.proposal.projectTeam[0].decisionEvidence = { decisionType: 'leader', requiredFloor: 0.65, riskLevel: 'high' };
  pending.proposal.projectTeam[1].reason = 'Only adequate option for this role right now.';
  const h = await setup(t, { pending });
  const p = await h.run('approve');
  assert.match(p.output, /Role\s+Old model\s+New model\s+Why/);
  assert.match(p.output, /Builder\s+gpt-6-luna\s+gpt-6-terra\s+Ranked first .*65% capability floor \(high-risk role\)/);
  assert.match(p.output, /Explorer\s+sonnet-5\s+haiku-5\s+Only adequate option for this role right now\./);
  const json = await h.run('approve', { json: true });
  assert.equal(json.result.pending.roles.find(r => r.role === 'Explorer').why, 'Only adequate option for this role right now.');
  assert.equal(h.calls.length, 0);
});

test('approve --yes with the matching --proposal calls approveRecoveryProposal once', async t => {
  const h = await setup(t, { pending: proposalOf() });
  const p = await h.run('approve', { yes: true, proposal: PENDING_ID });
  assert.equal(p.exitCode, 0);
  assert.deepEqual(h.calls, [['approve', { cwd: h.root, proposalId: PENDING_ID }]]);
  assert.equal(p.result.applied, true);
  assert.equal(p.result.proposalId, PENDING_ID);
});

test('approve --yes with a missing or wrong --proposal refuses and names the current id', async t => {
  const h = await setup(t, { pending: proposalOf() });
  for (const extra of [{ yes: true }, { yes: true, proposal: 'other-id' }]) {
    const p = await h.run('approve', extra);
    assert.equal(p.exitCode, 1);
    assert.equal(p.result.ok, false);
    assert.ok(p.output.includes(PENDING_ID));
  }
  assert.equal(h.calls.length, 0);
});

test('approve with no pending proposal keeps the draft flow unchanged', async t => {
  const h = await setup(t, { status: 'suggested' });
  const p = await h.run('approve');
  assert.equal(p.exitCode, 0);
  assert.match(p.output, /^Approve this draft team:\n/);
  assert.match(p.output, /Preview only\. Run kairo team approve --yes\.$/);
  const active = await setup(t);
  const refused = await active.run('approve', { yes: true });
  assert.equal(refused.exitCode, 1);
  assert.equal(refused.output, 'Team is not a draft. Run kairo team show.');
});

test('reject --proposal ID calls rejectRecoveryProposal; a wrong id refuses and names the current one', async t => {
  const h = await setup(t, { pending: proposalOf() });
  const wrong = await h.run('reject', { proposal: 'nope' });
  assert.equal(wrong.exitCode, 1);
  assert.ok(wrong.output.includes(PENDING_ID));
  assert.equal(h.calls.length, 0);
  const ok = await h.run('reject', { proposal: PENDING_ID });
  assert.equal(ok.exitCode, 0);
  assert.deepEqual(h.calls, [['reject', { cwd: h.root, proposalId: PENDING_ID }]]);
  assert.equal(ok.result.ok, true);
});

test('rebuild --yes on an active team prints the pending id and the working approve command; the table is unchanged', async t => {
  const h = await setup(t);
  const p = await h.run('rebuild', { yes: true });
  const lines = p.output.split('\n');
  assert.match(lines[0], /^Role\s+Old model\s+New model\s+Status$/);
  assert.match(lines[1], /^Builder\s+gpt-6-luna\s+gpt-6-terra\s+draft$/);
  assert.equal(lines.at(-1), `Draft saved as a pending proposal; the approved team stays until you approve. Run kairo team approve --yes --proposal ${PENDING_ID}.`);
});

test('show prints the pending proposal id and exact approve command only when one is pending', async t => {
  const none = await setup(t);
  assert.ok(!(await none.run('show')).output.includes('--proposal'));
  const h = await setup(t, { pending: proposalOf() });
  const p = await h.run('show');
  assert.ok(p.output.includes(PENDING_ID));
  assert.ok(p.output.includes(`kairo team approve --yes --proposal ${PENDING_ID}`));
});

test('parser accepts --proposal for team approve and reject', () => {
  const approve = parseArgs(['team', 'approve', '--yes', '--proposal', 'abc']).options;
  assert.equal(approve.teamAction, 'approve');
  assert.equal(approve.proposal, 'abc');
  const reject = parseArgs(['team', 'reject', '--proposal=abc']).options;
  assert.equal(reject.teamAction, 'reject');
  assert.equal(reject.proposal, 'abc');
});
