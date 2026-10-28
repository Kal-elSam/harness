import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture } from './team-route-fixture.test.js';
import { writeProjectStrategy } from '../src/global/team/project-strategy-store.js';
import { createConversationService } from '../src/global/team/service.js';
import { runFleetSet } from '../src/global/fleet-set.js';
import { topLevelModel, readManualPicks, recordKairoWrites, manualPickForRole } from '../src/global/team/manual-picks.js';
import { saveGlobalTeamProviders } from '../src/global/profile.js';
import { launchLedgerPath } from '../src/global/team/launch-ledger.js';

const NOW = Date.parse('2026-10-22T12:00:00Z');
const model = (adapterId, modelId, utility = 1) => ({ adapterId, modelId, accessMode: 'automatic', utility, priceInputPerMTok: 1, priceOutputPerMTok: 1 });
const gptA = model('codex', 'gpt-a', 2), gptB = model('codex', 'gpt-b', 1), sonA = model('claude', 'son-a', 1), goA = model('opencode-go', 'go-a', 1);
const models = [gptA, gptB, sonA, goA];

async function setup(t, { eligibility } = {}) {
  const f = await fixture(t);
  const team = [{ role: 'Builder', model: gptA, assignmentSource: 'recommended' }, { role: 'Explorer', model: gptA, assignmentSource: 'recommended' }];
  await writeProjectStrategy(f.home, f.cwd, { ...f.strategy, projectTeam: team });
  await f.cache({ roles: { Builder: { pool: models }, Explorer: { pool: models } }, models,
    eligibility: eligibility ?? { codex: { ok: true }, claude: { ok: true }, 'opencode-go': { ok: true } },
    providerCapacity: { codex: { quotaRemainingPercent: 50 }, claude: { quotaRemainingPercent: 50 }, 'opencode-go': { quotaRemainingPercent: 50 } } });
  // Starting point: Kairo reads the (empty) hosts once, so later files are manual picks.
  await readManualPicks({ homeDir: f.home, persist: true });
  const put = async (rel, body) => { const path = join(f.home, rel); await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, body); };
  const claudePick = (entries) => put('.gentle-ai/state.json', JSON.stringify({ claude_phase_assignments: entries }));
  return { ...f, put, claudePick, route: (...args) => JSON.parse(f.cli(...args).stdout) };
}

test('a manual Claude pick for Builder pins the route and says why', async t => {
  const f = await setup(t);
  await f.claudePick({ 'odd-worker': { model: 'son-a' } });
  const result = f.route('--role', 'Builder');
  assert.equal(result.decision, 'ROUTED');
  assert.equal(result.model.modelId, 'son-a');
  assert.equal(result.assignmentSource, 'manual');
  assert.match(result.why, /manual/);
});

test('a manual pick is counted like any routed launch and stays pinned under heavy use', async t => {
  const f = await setup(t);
  await f.claudePick({ 'odd-worker': { model: 'son-a' } });
  const rows = Array.from({ length: 30 }, () => JSON.stringify({ source: 'launch', role: 'Builder', adapterId: 'claude', modelId: 'son-a', at: new Date(Date.now() - 60_000).toISOString() }));
  await f.put(launchLedgerPath(f.home, f.cwd).slice(f.home.length + 1), `${rows.join('\n')}\n`);
  assert.equal(f.route('--role', 'Builder').model.modelId, 'son-a');
});

test('a manual pick moves to the next admitted candidate when its provider has no quota', async t => {
  const f = await setup(t, { eligibility: { codex: { ok: true }, claude: { ok: false, cause: 'quota_exhausted', reason: 'week limit' }, 'opencode-go': { ok: true } } });
  await f.claudePick({ 'odd-worker': { model: 'son-a' } });
  const result = f.route('--role', 'Builder');
  assert.equal(result.decision, 'ROUTED');
  assert.notEqual(result.model.modelId, 'son-a');
  assert.notEqual(result.assignmentSource, 'manual');
});

test('a value Kairo wrote is not a manual pick and routes as before', async t => {
  const f = await setup(t);
  const baseline = f.route('--role', 'Builder');
  await f.claudePick({ 'odd-worker': { model: 'son-a' } });
  await recordKairoWrites(f.home, 'claude', { 'odd-worker': { model: 'son-a' } });
  const result = f.route('--role', 'Builder');
  assert.equal(result.model.modelId, baseline.model.modelId);
  assert.notEqual(result.assignmentSource, 'manual');
});

test('a Codex worker toml model pins Builder', async t => {
  const f = await setup(t);
  await f.put('.codex/agents/worker.toml', 'name = "worker"\nmodel = "gpt-b"\n');
  const result = f.route('--role', 'Builder');
  assert.equal(result.model.modelId, 'gpt-b');
  assert.equal(result.assignmentSource, 'manual');
});

test('an OpenCode agent model pins its role', async t => {
  const f = await setup(t);
  await saveGlobalTeamProviders(f.home, ['claude', 'codex', 'opencode-go']);
  await f.put('.config/opencode/opencode.json', JSON.stringify({ agent: { explore: { model: 'opencode-go/go-a' } } }));
  const result = f.route('--role', 'Explorer');
  assert.equal(result.model.modelId, 'go-a');
  assert.equal(result.provider, 'opencode-go');
  assert.equal(result.assignmentSource, 'manual');
});

test('a role without a pick routes exactly as before', async t => {
  const f = await setup(t);
  const before = f.route('--role', 'Explorer');
  await f.claudePick({ 'odd-worker': { model: 'son-a' }, default: { model: 'son-a' }, 'sdd-apply': { model: 'son-a' } });
  assert.deepEqual(f.route('--role', 'Explorer'), before);
  assert.notEqual(before.assignmentSource, 'manual');
});

test('review and jd actors stay NOT_ROUTED even with a pick under their name', async t => {
  const f = await setup(t);
  await f.claudePick({ 'review-risk': { model: 'son-a' }, 'jd-judge-a': { model: 'son-a' }, 'odd-worker': { model: 'son-a' } });
  for (const agent of ['review-risk', 'jd-judge-a']) {
    const result = f.route('--agent', agent);
    assert.equal(result.decision, 'NOT_ROUTED', agent);
    assert.equal(result.model, null);
  }
});

test('the pure reader maps odd naming per host and ignores unmapped agents', async t => {
  const home = await mkdtemp(join(tmpdir(), 'manual-picks-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await readManualPicks({ homeDir: home, persist: true });
  await mkdir(join(home, '.gentle-ai'), { recursive: true });
  await writeFile(join(home, '.gentle-ai', 'state.json'), JSON.stringify({ claude_phase_assignments: {
    'odd-explorer': { model: 'haiku' }, 'odd-verify': 'opus', 'sdd-apply': { model: 'x' }, default: { model: 'y' } } }));
  await mkdir(join(home, '.codex', 'agents'), { recursive: true });
  await writeFile(join(home, '.codex', 'agents', 'worker.toml'), 'model = "gpt-b"\n');
  await writeFile(join(home, '.codex', 'agents', 'mystery.toml'), 'model = "gpt-b"\n');
  const picks = await readManualPicks({ homeDir: home, persist: true });
  assert.deepEqual(Object.keys(picks.claude).sort(), ['Explorer', 'Verifier']);
  assert.equal(picks.codex.Builder.model, 'gpt-b');
  assert.equal(Object.keys(picks.codex).length, 1);
  assert.equal(manualPickForRole(picks, 'Builder', 'claude').host, 'codex');
});

test('routeProjectExecution keeps a manual pick, counts it, and moves it when quota rejects it', async t => {
  const home = await mkdtemp(join(tmpdir(), 'manual-picks-svc-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await readManualPicks({ homeDir: home, persist: true });
  await mkdir(join(home, '.gentle-ai'), { recursive: true });
  await writeFile(join(home, '.gentle-ai', 'state.json'), JSON.stringify({ claude_phase_assignments: { 'odd-worker': { model: 'son-a' } } }));
  const strategy = { status: 'active', profileFingerprint: 'fp', roleCapabilities: { Builder: { required: ['reasoning'] } },
    projectTeam: [{ role: 'Builder', model: gptA, assignmentSource: 'quality' }] };
  const make = eligibility => {
    const service = createConversationService({ homeDir: home, resolveRoot: async () => '/repo', now: () => NOW,
      readProjectStrategy: async () => strategy, listRunRecords: async () => [] });
    service.snapshot = async () => ({ modelIntelligence: { eligibility, scoredAll: models.map(m => ({ ...m, intelligenceIndex: 90 })),
      providerCapacity: { codex: { quotaRemainingPercent: 50 }, claude: { quotaRemainingPercent: 50 } } } });
    return service;
  };
  const kept = await make({ codex: { ok: true }, claude: { ok: true } }).routeProjectExecution('Builder', '/repo');
  assert.equal(kept.model.modelId, 'son-a');
  assert.equal(kept.assignmentSource, 'manual');
  const moved = await make({ codex: { ok: true }, claude: { ok: false, cause: 'quota_exhausted', reason: 'week' } }).routeProjectExecution('Builder', '/repo');
  assert.equal(moved.decision, 'ROUTED');
  assert.notEqual(moved.model.modelId, 'son-a');
});

test('starting point: existing Claude and Codex values are baseline, not pinned; a later change is pinned', async t => {
  const home = await mkdtemp(join(tmpdir(), 'manual-picks-base-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(join(home, '.gentle-ai'), { recursive: true });
  await mkdir(join(home, '.codex', 'agents'), { recursive: true });
  await writeFile(join(home, '.gentle-ai', 'state.json'), JSON.stringify({ claude_phase_assignments: { 'odd-worker': { model: 'son-a' } } }));
  await writeFile(join(home, '.codex', 'agents', 'worker.toml'), 'model = "gpt-b"\n');
  const first = await readManualPicks({ homeDir: home, persist: true });
  assert.deepEqual(first, { claude: {}, codex: {}, opencode: {} });
  await writeFile(join(home, '.codex', 'agents', 'worker.toml'), 'model = "gpt-c"\n');
  await writeFile(join(home, '.gentle-ai', 'state.json'), JSON.stringify({ claude_phase_assignments: { 'odd-worker': { model: 'son-z' } } }));
  const later = await readManualPicks({ homeDir: home, persist: true });
  assert.equal(later.codex.Builder.model, 'gpt-c');
  assert.equal(later.claude.Builder.model, 'son-z');
});

test('starting point through routing: an existing Codex toml does not pin Builder', async t => {
  const f = await fixture(t);
  await mkdir(join(f.home, '.codex', 'agents'), { recursive: true });
  await writeFile(join(f.home, '.codex', 'agents', 'worker.toml'), 'model = "gpt-a"\n');
  await f.cache({ roles: { Builder: { pool: models } }, models,
    eligibility: { codex: { ok: true }, claude: { ok: true } },
    providerCapacity: { codex: { quotaRemainingPercent: 50 }, claude: { quotaRemainingPercent: 50 } } });
  const result = JSON.parse(f.cli('--role', 'Builder').stdout);
  assert.notEqual(result.assignmentSource, 'manual');
});

test('a fleet set write is Kairo\'s own and not a manual pick', async t => {
  const f = await setup(t);
  await f.put('.config/opencode/opencode.json', JSON.stringify({ agent: { explore: { model: 'opencode-go/old' } } }));
  assert.equal((await readManualPicks({ homeDir: f.home })).opencode.Explorer.model, 'old');
  await runFleetSet({ platform: 'opencode', agent: 'explore', model: 'opencode-go/go-a', yes: true, json: true, homeDir: f.home });
  assert.deepEqual((await readManualPicks({ homeDir: f.home })).opencode, {});
});

test('an ambiguous manual pick is reported in why and does not pin', async t => {
  const f = await setup(t);
  const more = [...models, model('claude', 'son-b')];
  await f.cache({ roles: { Builder: { pool: more } }, models: more });
  await f.claudePick({ 'odd-worker': { model: 'son' } });
  const result = f.route('--role', 'Builder');
  assert.notEqual(result.assignmentSource, 'manual');
  assert.match(result.why, /manual pick claude\/son unresolved: ambiguous/);
});

test('a Reviewer pick on the Builder provider is dropped and the route stays independent', async t => {
  const f = await setup(t);
  const team = [{ role: 'Builder', model: gptA, assignmentSource: 'recommended' }, { role: 'Reviewer', model: sonA, assignmentSource: 'recommended' }];
  await writeProjectStrategy(f.home, f.cwd, { ...f.strategy, projectTeam: team });
  await f.cache({ roles: { Builder: { pool: models }, Reviewer: { pool: models } }, models });
  await f.put('.codex/agents/kairo-reviewer.toml', 'model = "gpt-b"\n');
  const result = f.route('--role', 'Reviewer');
  assert.notEqual(result.provider, 'codex');
  assert.notEqual(result.assignmentSource, 'manual');
  assert.match(result.why, /dropped/);
});

test('launches of a pinned role count in distribution once the pick is gone', async t => {
  const f = await setup(t);
  const rows = Array.from({ length: 40 }, () => JSON.stringify({ source: 'launch', role: 'Explorer', adapterId: 'claude', modelId: 'son-a', at: new Date(Date.now() - 60_000).toISOString() }));
  await f.put(launchLedgerPath(f.home, f.cwd).slice(f.home.length + 1), `${rows.join('\n')}\n`);
  await f.claudePick({ 'odd-explorer': { model: 'son-a' } });
  assert.equal(f.route('--role', 'Explorer').model.modelId, 'son-a');
  await f.claudePick({});
  const unpinned = f.route('--role', 'Explorer');
  assert.notEqual(unpinned.assignmentSource, 'manual');
  assert.notEqual(unpinned.model.modelId, 'son-a');
});

test('only a top-level toml model counts, never one inside a table', () => {
  assert.equal(topLevelModel('name = "w"\nmodel = "gpt-b"\n[mcp]\nmodel = "other"\n'), 'gpt-b');
  assert.equal(topLevelModel('name = "w"\n[profile]\nmodel = "inside"\n'), null);
});
