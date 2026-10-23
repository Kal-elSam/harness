import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { buildAiTeam, buildEfficientTeam } from '../src/global/intelligence/model-intelligence.js';
import { harness } from './helpers/setup-harness.js';
import { readProjectStrategy, writeProjectStrategy } from '../src/global/team/project-strategy-store.js';

const eligibility = { claude: { ok: true }, codex: { ok: true } };
const row = (adapterId, score, price) => ({ adapterId, modelId: `${adapterId}-${score}`, intelligenceIndex: score, codingIndex: score, priceInputPerMTok: price, priceOutputPerMTok: price, accessMode: 'automatic' });
const roles = { Builder: { required: ['reasoning', 'coding'] }, Reviewer: { required: ['reasoning', 'coding'] } };
const builders = {
  quality: rows => buildAiTeam(rows, eligibility, null, roles),
  efficient: rows => buildEfficientTeam(rows, eligibility, null, { roleCapabilities: roles })
};

for (const [name, build] of Object.entries(builders)) {
  test(`${name}: other provider far below the floor degrades to a qualified Builder-provider model, not provider-independent`, () => {
    const team = build([row('codex', 80, .1), row('codex', 75, .2), row('claude', 40, 2)]);
    const builder = team.find(e => e.role === 'Builder');
    const reviewer = team.find(e => e.role === 'Reviewer');
    assert.equal(builder.primary.adapterId, 'codex');
    assert.equal(reviewer.assignmentState, 'degraded');
    assert.equal(reviewer.primary.adapterId, 'codex');
    assert.notEqual(reviewer.primary.modelId, builder.primary.modelId);
    assert.match(reviewer.reason, /step b/i);
    assert.match(reviewer.reason, /not provider-independent/i);
    assert.equal(builder.assignmentState, undefined);
  });
  test(`${name}: stays blocked when no model other than the Builder reaches the floor`, () => {
    const reviewer = build([row('codex', 80, .1), row('claude', 40, 2)]).find(e => e.role === 'Reviewer');
    assert.equal(reviewer.primary, null);
    assert.equal(reviewer.assignmentState, undefined);
    assert.equal(reviewer.selection.reasonKind, 'reviewer_independence');
  });
  test(`${name}: an independent near-equivalent Reviewer is untouched by the ladder`, () => {
    const reviewer = build([row('codex', 80, .1), row('claude', 79, 2)]).find(e => e.role === 'Reviewer');
    assert.equal(reviewer.primary.adapterId, 'claude');
    assert.equal(reviewer.assignmentState, undefined);
  });
}

async function draftWith(t, state) {
  const h = await harness({ git: true, diskStrategy: true, serviceDeps: { recoverRuns: async () => {} } });
  t.after(async () => { await rm(h.root, { recursive: true, force: true }); await rm(h.home, { recursive: true, force: true }); });
  const { runTeamCli } = await import('../src/global/team/team-cli.js');
  const outputs = [];
  const run = async (teamAction, extra = {}) => {
    const before = process.exitCode;
    try {
      process.exitCode = 0;
      const result = await runTeamCli({ teamAction, cwd: h.root, ...extra }, { homeDir: h.home, getService: () => h.service, log: x => outputs.push(x) });
      return { result, output: outputs.at(-1), exitCode: process.exitCode };
    } finally { process.exitCode = before; }
  };
  const analyst = (await h.ops.setup()).analyzers.find(a => a.recommended && a.available);
  await run('analyze', { yes: true, analyst: analyst.modelId });
  const draft = await readProjectStrategy(h.home, h.root);
  const projectTeam = draft.projectTeam.map((e, i) => i === 0 ? { ...e, assignmentState: state } : e);
  await writeProjectStrategy(h.home, h.root, { ...draft, projectTeam });
  return { h, run, role: draft.projectTeam[0].role };
}

test('approval accepts a degraded role; show marks it', async t => {
  const { h, run } = await draftWith(t, 'degraded');
  const shown = await run('show', { json: true });
  assert.equal(shown.result.team.find(r => r.status === 'draft (degraded)') != null, true);
  const approved = await run('approve', { yes: true, json: true });
  assert.equal(approved.exitCode, 0);
  assert.equal((await readProjectStrategy(h.home, h.root)).status, 'active');
});

test('approval still refuses a blocked role', async t => {
  const { h, run } = await draftWith(t, 'blocked');
  const approved = await run('approve', { yes: true, json: true });
  assert.equal(approved.exitCode, 1);
  assert.equal(approved.result.code, 'approval_blocked');
  assert.equal((await readProjectStrategy(h.home, h.root)).status, 'suggested');
});
