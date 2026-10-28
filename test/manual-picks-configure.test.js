import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture } from './team-route-fixture.test.js';
import { runFleetConfigure } from '../src/global/fleet-configure.js';
import { runFleetSet } from '../src/global/fleet-set.js';
import { readManualPicks, readManualPicksLedger } from '../src/global/team/manual-picks.js';
import { writeProjectStrategy } from '../src/global/team/project-strategy-store.js';
import { createConversationService } from '../src/global/team/service.js';
import { readTeamRoute } from '../src/global/team/routing-input-cache.js';

const quiet = async fn => { const log = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = log; } };
const put = async (home, rel, body) => { const path = join(home, rel); await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, body); };

test('fleet configure writes are Kairo\'s own: baseline, configure, then no pin', async t => {
  const home = await mkdtemp(join(tmpdir(), 'manual-picks-conf-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await put(home, '.gentle-ai/state.json', JSON.stringify({ claude_phase_assignments: { 'odd-explorer': { model: 'haiku' } } }));
  await put(home, '.config/opencode/opencode.json', JSON.stringify({ agent: { 'odd-explorer': { model: 'opencode-go/old' } } }));
  await readManualPicks({ homeDir: home, persist: true });
  await quiet(() => runFleetConfigure({ from: 'gentle', platforms: 'opencode', yes: true, json: true, homeDir: home }));
  const written = JSON.parse(await (await import('node:fs/promises')).readFile(join(home, '.config/opencode/opencode.json'), 'utf8'));
  assert.notEqual(written.agent['odd-explorer'].model, 'opencode-go/old', 'configure must have written the agent');
  assert.deepEqual((await readManualPicks({ homeDir: home })).opencode, {});
});

test('fleet configure records a Codex default write in the ledger', async t => {
  const home = await mkdtemp(join(tmpdir(), 'manual-picks-conf-codex-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await put(home, '.codex/config.toml', 'model = "gpt-old"\n');
  await readManualPicks({ homeDir: home, persist: true });
  await quiet(() => runFleetConfigure({ codexModel: 'gpt-new', platforms: 'codex', yes: true, json: true, homeDir: home }));
  assert.equal((await readManualPicksLedger(home)).codex['config:default'], 'gpt-new');
});

test('fleet set records a Codex default write in the ledger', async t => {
  const home = await mkdtemp(join(tmpdir(), 'manual-picks-set-codex-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await put(home, '.codex/config.toml', 'model = "gpt-old"\n');
  await quiet(() => runFleetSet({ platform: 'codex', model: 'gpt-new', yes: true, json: true, homeDir: home }));
  const ledger = await readManualPicksLedger(home);
  assert.equal(ledger.codex['config:default'], 'gpt-new');
  assert.ok(ledger.baseline.codex, 'the baseline was taken before the write');
});

test('a string host and an object host select the same manual pick in both routing paths', async t => {
  const f = await fixture(t);
  const model = (adapterId, modelId, utility = 1) => ({ adapterId, modelId, accessMode: 'automatic', utility, priceInputPerMTok: 1, priceOutputPerMTok: 1 });
  const gptA = model('codex', 'gpt-a', 2), gptB = model('codex', 'gpt-b'), sonA = model('claude', 'son-a');
  const models = [gptA, gptB, sonA];
  await writeProjectStrategy(f.home, f.cwd, { ...f.strategy, projectTeam: [{ role: 'Builder', model: gptA, assignmentSource: 'recommended' }] });
  await f.cache({ roles: { Builder: { pool: models } }, models,
    eligibility: { codex: { ok: true }, claude: { ok: true } },
    providerCapacity: { codex: { quotaRemainingPercent: 50 }, claude: { quotaRemainingPercent: 50 } } });
  await readManualPicks({ homeDir: f.home, persist: true });
  await put(f.home, '.gentle-ai/state.json', JSON.stringify({ claude_phase_assignments: { 'odd-worker': { model: 'son-a' } } }));
  await put(f.home, '.codex/agents/worker.toml', 'model = "gpt-b"\n');
  const NOW = Date.now();
  const strategy = { ...f.strategy, roleCapabilities: { Builder: { required: ['reasoning'] } },
    projectTeam: [{ role: 'Builder', model: gptA, assignmentSource: 'quality' }] };
  const service = createConversationService({ homeDir: f.home, resolveRoot: async () => f.cwd, now: () => NOW,
    readProjectStrategy: async () => strategy, listRunRecords: async () => [] });
  service.snapshot = async () => ({ modelIntelligence: { eligibility: { codex: { ok: true }, claude: { ok: true } },
    scoredAll: models.map(m => ({ ...m, intelligenceIndex: 90 })),
    providerCapacity: { codex: { quotaRemainingPercent: 50 }, claude: { quotaRemainingPercent: 50 } } } });
  for (const host of ['codex', { id: 'codex' }]) {
    const cached = await readTeamRoute({ role: 'Builder', cwd: f.cwd, homeDir: f.home, activeHost: host });
    const live = await service.routeProjectExecution('Builder', f.cwd, { activeHost: host });
    assert.equal(cached.model.modelId, 'gpt-b', `readTeamRoute ${JSON.stringify(host)}`);
    assert.equal(live.model.modelId, 'gpt-b', `routeProjectExecution ${JSON.stringify(host)}`);
  }
});
