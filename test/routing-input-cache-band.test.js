import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './team-route-fixture.test.js';
import { writeProjectStrategy } from '../src/global/team/project-strategy-store.js';

// S3: frontier status comes from AA intelligence (cutoff 54.5), never price; levels mirror the frozen reference pool.
const level = (intelligenceIndex, value) => ({ intelligenceIndex, codingIndex: value, gpqa: value / 100, hle: value / 100 });
const AA_EVIDENCE = { 'gpt-6-luna': level(27.8, 55), 'gpt-6.1-sol': level(51.8, 78), 'gpt-5.6-terra': level(42.1, 77), 'gpt-6-astra': level(56.9, 85), haiku: level(36.2, 60), sonnet: level(54.2, 76), opus: level(58.4, 80) };
const priced = (adapterId, modelId, input, output) => ({ adapterId, modelId, accessMode: 'automatic', utility: 1, priceInputPerMTok: input, priceOutputPerMTok: output, ...AA_EVIDENCE[modelId] });
const luna = priced('codex', 'gpt-6-luna', .1, .5), sol = priced('codex', 'gpt-6.1-sol', 2, 10);
const terra = priced('codex', 'gpt-5.6-terra', 2, 12), astra = priced('codex', 'gpt-6-astra', 10, 50);
const haiku = priced('claude', 'haiku', .1, .5), sonnet = priced('claude', 'sonnet', 2, 10), opus = priced('claude', 'opus', 4, 20);
const models = [luna, sol, terra, astra, haiku, sonnet, opus];

async function route(t, role, pool, extra = []) {
  const f = await fixture(t);
  await writeProjectStrategy(f.home, f.cwd, { ...f.strategy, projectTeam: [{ role, model: sonnet, assignmentSource: 'recommended' }] });
  await f.cache({ roles: { [role]: { pool } }, models });
  return JSON.parse(f.cli('--role', role, ...extra).stdout);
}

test('cached standard route keeps the Codex standard band (Sol or Terra), never Astra', async t => {
  const result = await route(t, 'Planner', [sonnet, sol, terra, astra], ['--provider', 'codex']);
  assert.ok(['gpt-6.1-sol', 'gpt-5.6-terra'].includes(result.model.modelId), JSON.stringify(result));
  assert.doesNotMatch(result.why ?? '', /demanding band/);
});

// S3: Builder is labor, so the frontier model in the cached pool is barred and the Codex pool is rebuilt from the catalog.
test('a cache whose pool lacks a labor-compatible Codex model rebuilds it from the catalog, never the frontier Astra', async t => {
  const result = await route(t, 'Builder', [sonnet, astra], ['--provider', 'codex']);
  assert.ok(['gpt-6.1-sol', 'gpt-5.6-terra'].includes(result.model?.modelId), JSON.stringify(result));
});

test('cached demanding route still reaches Astra and light route still reaches Luna', async t => {
  const f = await fixture(t);
  await writeProjectStrategy(f.home, f.cwd, { ...f.strategy, projectTeam: [{ role: 'Architect', model: opus, assignmentSource: 'recommended' }, { role: 'Explorer', model: haiku, assignmentSource: 'recommended' }] });
  await f.cache({ roles: { Architect: { pool: [opus, astra] }, Explorer: { pool: [haiku, luna, astra] } }, models });
  assert.equal(JSON.parse(f.cli('--role', 'Architect', '--provider', 'codex').stdout).model.modelId, 'gpt-6-astra');
  assert.equal(JSON.parse(f.cli('--role', 'Explorer', '--provider', 'codex').stdout).model.modelId, 'gpt-6-luna');
});
