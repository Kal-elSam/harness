import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './team-route-fixture.test.js';
import { writeProjectStrategy } from '../src/global/team/project-strategy-store.js';

const priced = (adapterId, modelId, input, output) => ({ adapterId, modelId, accessMode: 'automatic', utility: 1, priceInputPerMTok: input, priceOutputPerMTok: output });
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

test('a cache whose pool lacks the standard Codex band rebuilds it from the catalog, never Astra', async t => {
  const result = await route(t, 'Planner', [sonnet, astra], ['--provider', 'codex']);
  assert.ok(['gpt-6.1-sol', 'gpt-5.6-terra'].includes(result.model?.modelId), JSON.stringify(result));
});

test('cached demanding route still reaches Astra and light route still reaches Luna', async t => {
  const f = await fixture(t);
  await writeProjectStrategy(f.home, f.cwd, { ...f.strategy, projectTeam: [{ role: 'Architect', model: opus, assignmentSource: 'recommended' }, { role: 'Explorer', model: haiku, assignmentSource: 'recommended' }] });
  await f.cache({ roles: { Architect: { pool: [opus, astra] }, Explorer: { pool: [haiku, luna, astra] } }, models });
  assert.equal(JSON.parse(f.cli('--role', 'Architect', '--provider', 'codex').stdout).model.modelId, 'gpt-6-astra');
  assert.equal(JSON.parse(f.cli('--role', 'Explorer', '--provider', 'codex').stdout).model.modelId, 'gpt-6-luna');
});
