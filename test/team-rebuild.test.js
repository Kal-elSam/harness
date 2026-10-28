import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { harness } from './helpers/setup-harness.js';
import { tree } from './team-route-fixture.test.js';
import { readProjectStrategy, writeProjectStrategy } from '../src/global/team/project-strategy-store.js';

const row = (adapterId, score, price) => ({ adapterId, modelId: `${adapterId}-${score}`, intelligenceIndex: score, codingIndex: score, priceInputPerMTok: price, priceOutputPerMTok: price, accessMode: 'automatic' });
const caps = { required: ['reasoning', 'coding'], optional: [] };
const ref = m => ({ adapterId: m.adapterId, modelId: m.modelId, displayName: m.modelId });
const builder = row('codex', 80, .1);

// Live-like: every Builder on codex, Claude far below the near-equivalence band.
async function setup(t, status = 'suggested') {
  const h = await harness({ git: true, diskStrategy: true, serviceDeps: { recoverRuns: async () => {} } });
  t.after(async () => { await rm(h.root, { recursive: true, force: true }); await rm(h.home, { recursive: true, force: true }); });
  const mi = { ...h.modelIntelligence, scoredAll: [builder, row('codex', 40, .2), row('claude', 30, 2)], manualSelectionScoredPool: [], registry: null,
    eligibility: { claude: { ok: true }, codex: { ok: true } } };
  h.service.snapshot = async () => ({ projectRoot: h.root, modelIntelligence: mi, projectStrategy: await readProjectStrategy(h.home, h.root), timeline: [] });
  const stored = {
    status, approvedAt: status === 'active' ? '2026-10-22T10:00:00Z' : null, profileFingerprint: 'fp-1',
    bootstrapAnalyst: ref(builder), bootstrapAnalystChoice: null, bootstrapAnalystSelectionSource: 'manual', bootstrapAnalystRecommendationTags: [],
    activeRoles: ['Architect', 'Builder', 'Reviewer'], roleCapabilities: { Architect: caps, Builder: caps, Reviewer: caps },
    projectTeam: [
      { role: 'Builder', model: ref(builder), fallback: null, assignmentState: 'ready', assignmentSource: 'recommended' },
      { role: 'Reviewer', model: null, fallback: null, assignmentState: 'blocked', assignmentSource: 'recommended' }
    ],
    demandAssessment: null
  };
  await writeProjectStrategy(h.home, h.root, stored);
  return { h, stored };
}

test('rebuild preview writes nothing, calls no analyst, shows Reviewer null -> degraded', async t => {
  const { h, stored } = await setup(t);
  const before = [await tree(h.home), await tree(h.root)];
  const out = await h.service.rebuildProjectTeam({ cwd: h.root });
  assert.equal(out.applied, false);
  const reviewer = out.roles.find(r => r.role === 'Reviewer');
  assert.equal(reviewer.old.model, null);
  assert.equal(reviewer.new.assignmentState, 'degraded');
  // T15b: claude-30 is in the Reviewer band but is not admitted as independent (it fails the quality floor), so the
  // Reviewer takes an in-band Builder-provider model, marked not provider-independent.
  assert.equal(reviewer.new.model, 'codex-40');
  assert.match(reviewer.why, /step c/);
  assert.equal(reviewer.changed, true);
  assert.match(reviewer.why, /not provider-independent/i);
  // codex has no standard-priced model, so the Builder band steps down to light and keeps in-band codex-80.
  assert.equal(out.roles.find(r => r.role === 'Builder').changed, false);
  assert.equal(h.counts.analyze, 0);
  assert.deepEqual([await tree(h.home), await tree(h.root)], before);
  assert.deepEqual(await readProjectStrategy(h.home, h.root), { ...stored, schema: (await readProjectStrategy(h.home, h.root)).schema });
});

test('rebuild --yes saves a draft that approve accepts', async t => {
  const { h } = await setup(t);
  const out = await h.service.rebuildProjectTeam({ cwd: h.root, yes: true });
  assert.equal(out.applied, true);
  const draft = await readProjectStrategy(h.home, h.root);
  assert.equal(draft.status, 'suggested');
  assert.equal(draft.approvedAt, null);
  assert.equal(draft.projectTeam.find(r => r.role === 'Reviewer').assignmentState, 'degraded');
  assert.equal(h.counts.analyze, 0);
  const approved = await h.service.approveProjectStrategy({ cwd: h.root });
  console.log(JSON.stringify(approved));
  assert.notEqual(approved?.ok, false);
  assert.equal((await readProjectStrategy(h.home, h.root)).status, 'active');
});

test('rebuild with no stored analysis refuses with one line', async t => {
  const h = await harness({ git: true, diskStrategy: true, serviceDeps: { recoverRuns: async () => {} } });
  t.after(async () => { await rm(h.root, { recursive: true, force: true }); await rm(h.home, { recursive: true, force: true }); });
  await assert.rejects(h.service.rebuildProjectTeam({ cwd: h.root, yes: true }), /Run kairo team analysts and kairo team analyze first\./);
  await writeProjectStrategy(h.home, h.root, { status: 'suggested', projectTeam: [] });
  await assert.rejects(h.service.rebuildProjectTeam({ cwd: h.root }), { code: 'no_analysis' });
});

test('approved strategy: preview untouched; --yes files a pending draft, approved team stays until approval', async t => {
  const { h, stored } = await setup(t, 'active');
  await h.service.rebuildProjectTeam({ cwd: h.root });
  assert.equal((await h.service.pendingTeamProposal({ cwd: h.root })), null);
  const out = await h.service.rebuildProjectTeam({ cwd: h.root, yes: true });
  assert.equal(out.applied, true);
  const current = await readProjectStrategy(h.home, h.root);
  assert.equal(current.status, 'active');
  assert.equal(current.projectTeam.find(r => r.role === 'Reviewer').model, null);
  const pending = await h.service.pendingTeamProposal({ cwd: h.root });
  assert.equal(pending.proposalId, out.proposalId);
  assert.equal(stored.status, 'active');
});

test('team-cli rebuild: preview table with degraded status, --yes applies, refusal line', async t => {
  const { h } = await setup(t);
  const { runTeamRebuildCli } = await import('../src/global/team/team-cli.js');
  const lines = [];
  const run = opts => runTeamRebuildCli({ teamAction: 'rebuild', cwd: h.root, ...opts }, { homeDir: h.home, getService: () => h.service, log: x => lines.push(x) });
  await run({});
  assert.match(lines.at(-1), /Role\s+Old model\s+New model\s+Status/);
  assert.match(lines.at(-1), /Reviewer\s+-\s+\S+\s+draft \(degraded\)/);
  assert.match(lines.at(-1), /kairo team rebuild --yes/);
  assert.equal((await readProjectStrategy(h.home, h.root)).projectTeam.find(r => r.role === 'Reviewer').model, null);
  await run({ yes: true });
  assert.equal((await readProjectStrategy(h.home, h.root)).projectTeam.find(r => r.role === 'Reviewer').assignmentState, 'degraded');
  await rm(h.home, { recursive: true, force: true });
  const before = process.exitCode;
  await run({});
  process.exitCode = before;
  assert.match(lines.at(-1), /^No stored analysis\. Run kairo team analysts and kairo team analyze first\.$/);
});
