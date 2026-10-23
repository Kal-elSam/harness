import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { launchLedgerPath, runRecordOutcomeCli } from '../src/global/team/launch-ledger.js';
import { MIN_ROLE_RUNS, buildRoleTelemetry } from '../src/global/intelligence/role-telemetry.js';
import { buildAiTeam, buildEfficientTeam } from '../src/global/intelligence/model-intelligence.js';

const models = ['public-best', 'observed-best'].map((modelId, i) => ({
  adapterId: 'codex', modelId, intelligenceIndex: 95 - i * 30,
  codingIndex: 95 - i * 30, priceInputPerMTok: 1, priceOutputPerMTok: 1
}));
const outcome = (modelId, result, extra = {}) => ({ source: 'outcome', role: 'Builder',
  adapterId: 'codex', modelId, status: 'completed', at: new Date().toISOString(), result, ...extra });
const results = (modelId, passes, n = MIN_ROLE_RUNS) => Array.from({ length: n }, (_, i) => outcome(modelId, i < passes ? 'pass' : 'fail'));
const telemetry = records => buildRoleTelemetry(records, models);
function teams(records, candidates = models, eligibility = { codex: { ok: true } }) {
  const roleTelemetry = buildRoleTelemetry(records, candidates);
  const roleCapabilities = { Builder: { required: ['coding'] } };
  return [buildAiTeam(candidates, eligibility, null, roleCapabilities, { roleTelemetry }),
    buildEfficientTeam(candidates, eligibility, null, { roleCapabilities, roleTelemetry })];
}
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'quality-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cwd = join(dir, 'project'), homeDir = join(dir, 'home');
  await mkdir(join(cwd, '.kairo'), { recursive: true });
  await writeFile(join(cwd, '.kairo', 'roles.json'), JSON.stringify({ roles: [
    { id: 'Builder', agents: [{ name: 'task-builder', adapterId: 'codex' }] }
  ] }));
  const git = spawnSync('git', ['init', '-q', cwd], { encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);
  return { cwd, homeDir, resolveRoot: async () => cwd, log: () => {} };
}

test('record-outcome records result and retry through the CLI with role attribution', async t => {
  const f = await fixture(t);
  for (const flags of [['--result', 'pass'], ['--result=fail', '--retry']]) {
    const child = spawnSync(process.execPath, [resolve('bin/kairo.js'), 'team', 'record-outcome',
      '--agent', 'task-builder', '--adapter', 'codex', '--model', 'observed-best', '--status', 'completed', '--cwd', f.cwd, ...flags],
    { encoding: 'utf8', env: { ...process.env, HARNESS_HOME: f.homeDir } });
    assert.equal(child.status, 0, child.stdout + child.stderr);
  }
  const rows = (await readFile(launchLedgerPath(f.homeDir, f.cwd), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(rows[0].result, 'pass');
  assert.equal(rows[1].result, 'fail');
  assert.equal(rows[1].retry, true);
  assert.ok(rows.every(row => row.role === 'Builder'));
});

test('old outcome calls keep their persisted shape and do not imply quality', async t => {
  const f = await fixture(t);
  const row = await runRecordOutcomeCli({ cwd: f.cwd, agent: 'task-builder', adapter: 'codex', model: 'public-best', status: 'completed' }, f);
  assert.deepEqual(Object.keys(row).sort(), ['adapterId', 'agent', 'at', 'modelId', 'role', 'source', 'status']);
  assert.deepEqual(telemetry(Array(5).fill(row)), { roles: {}, volumes: null });
});

test('quality rate is hidden below MIN_ROLE_RUNS and retries do not add another failure', () => {
  const records = results('public-best', 3, 4);
  assert.equal(telemetry(records).roles.Builder?.get('codex::public-best')?.successRate, undefined);
  records.push(outcome('public-best', 'pass', { retry: true }));
  const measured = telemetry(records).roles.Builder?.get('codex::public-best');
  assert.equal(measured?.successRate, 4 / 5);
  assert.equal(measured?.resultRuns, 5);
  assert.equal(telemetry([...records, outcome('observed-best', 'pass', { retry: true })]).roles.Builder.get('codex::public-best').successRate, 4 / 5);
});

test('measured rate replaces public role score in both team builders and explains its sample', () => {
  const records = [...results('public-best', 3), ...results('observed-best', 5)];
  for (const team of teams(records)) {
    const builder = team.find(entry => entry.role === 'Builder');
    assert.equal(builder.primary?.modelId, 'observed-best');
    assert.match(builder.reason, /measured success rate.*100%.*5 results/i);
  }
});

test('measured rate below floor removes the model, including when all measured models fail', () => {
  for (const records of [results('public-best', 1), [...results('public-best', 1), ...results('observed-best', 1)]]) {
    for (const team of teams(records)) {
      const builder = team.find(entry => entry.role === 'Builder');
      assert.notEqual(builder.primary?.modelId, 'public-best');
      assert.notEqual(builder.fallback?.modelId, 'public-best');
      if (records.length === 10) assert.equal(builder.primary, null);
    }
  }
  // An unavailable public leader must not be restored as a comparative primary.
  const candidates = [models[0], { ...models[1], adapterId: 'claude' }];
  for (const team of teams(results('public-best', 1), candidates, { codex: { ok: false }, claude: { ok: true } })) {
    assert.notEqual(team.find(entry => entry.role === 'Builder').primary?.modelId, 'public-best');
  }
});

test('unattributed outcomes, launches and statuses without results never supply quality', () => {
  const rows = [...results('public-best', 5).map(row => ({ ...row, role: null })),
    ...results('public-best', 5).map(row => ({ ...row, source: 'launch' })),
    ...results('public-best', 5).map(row => ({ ...row, result: undefined }))];
  assert.deepEqual(telemetry(rows), { roles: {}, volumes: null });
});
