import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve('scripts/effort-eval/outcome-tasks');
const tiers = ['light', 'standard', 'heavy'];
const catalogs = { claude: { models: tiers.map((_, i) => ({ id: ['claude-haiku-test', 'claude-sonnet-test', 'claude-opus-test'][i] })) } };
const good = "exports.clean = text => text.split('\\n').map(x=>x.trim()).filter(Boolean);\n";
async function environment(t) {
  const dir = await mkdtemp(join(tmpdir(), 'outcome-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { freezePredictions } = await import('../scripts/effort-eval/outcome-tasks/freeze-predictions.mjs');
  const predictionsFile = join(dir, 'predictions.json');
  const frozen = await freezePredictions({ root, output: predictionsFile });
  return { root, predictionsFile, resultsFile: join(dir, 'results.jsonl'), frozen, catalogs,
    tasks: ['trim-lines'], quotaProbe: async () => 80,
    runTask: async ({ cwd }) => { await writeFile(join(cwd, 'task.cjs'), good); return { cost: 0.1, tokenUsage: { input: 10 }, turns: 2 }; } };
}
async function run(options) {
  return (await import('../scripts/effort-eval/outcome-tasks/run.mjs')).runOutcomes(options);
}
test('freeze records classifier provenance, balanced fixed Phase A, and refuses overwrite', async t => {
  const e = await environment(t);
  assert.equal(e.frozen.predictions.length, 24);
  assert.match(e.frozen.routerHash, /^[a-f0-9]{64}$/);
  assert.match(e.frozen.corpusHash, /^[a-f0-9]{64}$/);
  const { tasks } = JSON.parse(await readFile(join(root, 'manifest.json')));
  const phase = tasks.filter(x => e.frozen.phaseA.includes(x.id));
  assert.equal(phase.length, 6);
  assert.equal(new Set(phase.map(x => x.language)).size, 2);
  assert.equal(new Set(phase.map(x => x.category)).size, 3);
  assert.ok(phase.filter(x => x.riskSensitive).length >= 2);
  const { classifyEffort } = await import('../src/global/intelligence/execution-router.js');
  for (const task of tasks) {
    const prediction = e.frozen.predictions.find(x => x.taskId === task.id);
    assert.equal(prediction.tier, classifyEffort(task.prompt));
    assert.equal(prediction.routerHash, e.frozen.routerHash);
    assert.equal(prediction.corpusHash, e.frozen.corpusHash);
  }
  const before = await readFile(e.predictionsFile);
  const { freezePredictions } = await import('../scripts/effort-eval/outcome-tasks/freeze-predictions.mjs');
  await assert.rejects(freezePredictions({ root, output: e.predictionsFile }), /exist|overwrite/i);
  assert.deepEqual(await readFile(e.predictionsFile), before);
  await freezePredictions({ root, output: e.predictionsFile, force: true });
});
test('run refuses absent frozen predictions and corpus mismatch before any run or probe', async t => {
  const e = await environment(t);
  e.runTask = e.quotaProbe = () => { throw Error('must not call'); };
  await assert.rejects(run({ ...e, predictionsFile: join(e.resultsFile, 'absent') }), /frozen/i);
  await writeFile(e.predictionsFile, JSON.stringify({ ...e.frozen, corpusHash: 'bad' }));
  await assert.rejects(run(e), /corpus hash/i);
});
test('unknown tier model fails closed before quota or task execution', async t => {
  const e = await environment(t);
  e.catalogs = { claude: { models: [{ id: 'claude-sonnet-test', isDefault: true }] } };
  e.runTask = e.quotaProbe = () => { throw Error('must not call'); };
  await assert.rejects(run(e), /unknown model/i);
});
test('dry-run bypasses quota and execution and resolves Phase A/B plans', async t => {
  const e = await environment(t);
  e.runTask = e.quotaProbe = () => { throw Error('must not call'); };
  const a = await run({ ...e, tasks: undefined, phase: 'A', dryRun: true });
  const b = await run({ ...e, tasks: undefined, phase: 'B', dryRun: true });
  assert.equal(a.plan.length, 18); assert.equal(b.plan.length, 54);
  assert.match(a.reason, /quota.*bypass/i);
  assert.equal(a.plan[0].model, 'claude-haiku-test');
  assert.equal(a.plan.some(x => b.plan.some(y => y.taskId === x.taskId)), false);
  await assert.rejects(run({ ...e, phase: 'C', dryRun: true }), /phase/i);
  await assert.rejects(run({ ...e, tasks: ['unknown'], dryRun: true }), /task/i);
});
test('fresh copies outside repository contain no checks; actual external check passes and JSONL carries evidence', async t => {
  const e = await environment(t); const copies = [];
  const fake = e.runTask;
  e.runTask = async args => {
    copies.push(args.cwd);
    assert.ok(relative(resolve('.'), args.cwd).startsWith('..'));
    assert.deepEqual((await readdir(args.cwd)).sort(), (await readdir(join(root, 'fixtures/trim-lines'))).sort());
    assert.equal(args.adapterId, 'claude');
    return fake(args);
  };
  const result = await run(e);
  assert.equal(result.records.length, 3);
  assert.equal(new Set(copies).size, 3);
  const hash = createHash('sha256').update(await readFile(e.predictionsFile)).digest('hex');
  for (const record of result.records) {
    assert.equal(record.outcome, 'pass'); assert.equal(record.predictionsHash, hash);
    assert.equal(record.cost.total_cost_usd, 0.1); assert.equal(record.cost.basis, 'API-equivalent');
    assert.equal(record.turns, 2); assert.ok(record.diffSize > 0);
    assert.ok(record.durationMs >= 0); assert.ok(record.timestamp);
    assert.deepEqual(record.tokenUsage, { input: 10 });
  }
  assert.equal((await readFile(e.resultsFile, 'utf8')).trim().split('\n').length, 3);
  for (const cwd of copies) await assert.rejects(readFile(join(cwd, 'task.cjs')));
});
test('diff outside scope fails even when solution passes', async t => {
  const e = await environment(t); const fake = e.runTask;
  e.runTask = async args => { await fake(args); await writeFile(join(args.cwd, 'extra.txt'), 'oops'); return {}; };
  const result = await run(e);
  assert.ok(result.records.every(x => x.outcome === 'fail' && /scope/.test(x.reason)));
});
test('external check cannot hide a scope violation caused by importing agent code', async t => {
  const e = await environment(t);
  e.runTask = async ({ cwd }) => { await writeFile(join(cwd, 'task.cjs'), good + "require('fs').writeFileSync(require('path').join(__dirname,'extra.txt'),'oops');"); return {}; };
  assert.ok((await run(e)).records.every(x => x.outcome === 'fail'));
});
test('transport errors and unsuccessful provider states are missing-evidence, not task failure', async t => {
  const e = await environment(t);
  e.runTask = async () => { throw Error('429 transport'); };
  assert.ok((await run(e)).records.every(x => x.outcome === 'missing-evidence'));
  e.runTask = async () => ({ state: 'failed', error: 'auth failed' });
  assert.ok((await run(e)).records.every(x => x.outcome === 'missing-evidence'));
});
test('untouched solution is a checked failure and resume skips non-missing results', async t => {
  const e = await environment(t); let calls = 0;
  e.runTask = async () => { calls++; return {}; };
  assert.ok((await run(e)).records.every(x => x.outcome === 'fail'));
  assert.equal((await run(e)).records.length, 0); assert.equal(calls, 3);
});
test('resume retries missing evidence and refuses different prediction lineage', async t => {
  const e = await environment(t); const fake = e.runTask;
  e.runTask = async () => { throw Error('transport'); };
  await run(e); e.runTask = fake;
  assert.equal((await run(e)).records.length, 3);
  await writeFile(e.predictionsFile, JSON.stringify(e.frozen) + '\n');
  await assert.rejects(run(e), /predictions hash/i);
});
test('quota below 20 stops before next run; measured multiwindow worst-case used', async t => {
  const e = await environment(t); let probes = 0;
  e.quotaProbe = async () => ({ status: 'measured', windows: [{ remainingPercent: 80 }, { remainingPercent: ++probes === 1 ? 20 : 19 }] });
  const result = await run(e);
  assert.equal(result.records.length, 1); assert.equal(result.stopped, true);
  assert.match(result.reason, /quota.*20/i);
});
test('unavailable or throwing quota probe stops cleanly with no run', async t => {
  const e = await environment(t);
  e.runTask = () => { throw Error('must not call'); };
  for (const probe of [async () => null, async () => ({ status: 'unknown' }), async () => { throw Error('unavailable'); }]) {
    const result = await run({ ...e, quotaProbe: probe });
    assert.equal(result.records.length, 0); assert.equal(result.stopped, true);
    assert.match(result.reason, /quota.*unavailable/i);
  }
});
test('analysis derives minimal truth, exclusions, non-monotonic flags and under/over metrics', async () => {
  const { analyzeResults } = await import('../scripts/effort-eval/outcome-tasks/analyze.mjs');
  const tasks = ['under', 'over', 'nonmono', 'unsolvable', 'missing', 'incomplete'].map(id => ({ id, riskSensitive: id === 'under' }));
  const predictions = tasks.map(x => ({ taskId: x.id, tier: x.id === 'over' ? 'heavy' : 'light' }));
  const outcomes = { under: ['fail','pass','pass'], over: ['pass','pass','pass'], nonmono: ['pass','fail','pass'], unsolvable: ['fail','fail','fail'], missing: ['pass','missing-evidence','pass'], incomplete: ['pass'] };
  const results = tasks.flatMap(task => outcomes[task.id].map((outcome,i) => ({ taskId: task.id, tier: tiers[i], outcome, cost: { total_cost_usd: i+1 }, predictionsHash: 'frozen' })));
  const report = analyzeResults({ tasks, predictions, results, predictionsHash: 'frozen' });
  assert.equal(report.truth.under, 'standard'); assert.equal(report.truth.over, 'light');
  assert.deepEqual(report.unsolvable, ['unsolvable']); assert.deepEqual(report.nonMonotonic, ['nonmono']);
  assert.deepEqual(report.excluded.map(x => x.taskId), ['missing','incomplete']);
  assert.equal(report.metrics.underProvisionRate, 1/3); assert.equal(report.metrics.overProvisionRate, 1/3);
  assert.equal(report.metrics.exactTierAccuracy, 1/3);
  assert.equal(report.metrics.routedSuccessRate, 2/4); assert.equal(report.metrics.routedCost.total_cost_usd, 6);
  assert.equal(report.riskSensitive.metrics.underProvisionRate, 1);
  assert.throws(() => analyzeResults({ tasks, predictions, results, predictionsHash: 'other' }), /predictions hash/i);
});
test('analysis writes traceable JSON and short markdown without pretending missing costs are zero', async t => {
  const e = await environment(t);
  await run({ ...e, runTask: async () => ({}) });
  const { analyze } = await import('../scripts/effort-eval/outcome-tasks/analyze.mjs');
  const outputDir = join(e.resultsFile, '..', 'reports');
  const report = await analyze({ ...e, outputDir });
  assert.equal(report.metrics.routedCost.total_cost_usd, null);
  assert.equal(report.metrics.routedCost.missingRuns, 1);
  assert.equal(report.metrics.scoredTasks, 0);
  assert.deepEqual(report.unsolvable, ['trim-lines']);
  assert.equal(report.excluded.length, 23);
  assert.deepEqual(JSON.parse(await readFile(join(outputDir, 'analysis.json'))), report);
  const md = await readFile(join(outputDir, 'analysis.md'), 'utf8');
  assert.match(md, /Under-provision/); assert.match(md, /Risk-sensitive/);
  assert.ok(md.includes(report.predictionsHash));
});
test('Claude task bridge runs yolo (Sam decision for equal write access across tiers) and awaits completion before check and cleanup', async t => {
  const e = await environment(t);
  const { createClaudeRunTask } = await import('../scripts/effort-eval/outcome-tasks/run.mjs');
  assert.equal(typeof createClaudeRunTask, 'function');
  let completed = false, launches = 0;
  e.runTask = createClaudeRunTask({
    startRun: async options => {
      assert.deepEqual(options.permissions, ['yolo']);
      assert.equal(options.allowUnsafePermissions, true);
      // The real authorizer must accept what the bridge sends.
      const { authorizeRunPermissions } = await import('../src/global/runtime/run-permissions.js');
      authorizeRunPermissions({ permissions: options.permissions, agentId: options.agentId, allowUnsafePermissions: options.allowUnsafePermissions, source: 'cli' });
      assert.equal(options.agentId, 'claude'); assert.equal(options.wait, true);
      completed = false; launches++;
      const completion = new Promise(resolve => setTimeout(async () => {
        await writeFile(join(options.cwd, 'task.cjs'), good);
        completed = true; resolve();
      }, 5));
      return { runId: 'fake', completion };
    },
    readRunState: async () => {
      assert.equal(completed, true);
      return { state: 'completed', exitCode: 0, tokenUsage: { input: 11 }, cost: 0.2 };
    },
    readRunEvents: async () => [{ type: 'agent.result', data: { num_turns: 4 } }]
  });
  const result = await run(e);
  assert.equal(launches, 3);
  assert.ok(result.records.every(row => row.outcome === 'pass' && row.turns === 4 && row.cost.total_cost_usd === 0.2));
});
test('runs get an isolated harness home outside the repository when none is given', async t => {
  const e = await environment(t);
  const homes = [];
  const runTask = e.runTask;
  e.runTask = async args => { homes.push(args.homeDir); return runTask(args); };
  const result = await run(e);
  assert.equal(result.records.length, 3);
  assert.equal(homes.length, 3);
  for (const home of homes) {
    assert.equal(typeof home, 'string');
    assert.ok(home.length > 0);
    assert.ok(relative(resolve('.'), home).startsWith('..'), 'harness home must live outside the repository');
  }
  assert.equal(new Set(homes).size, 1, 'one isolated home per invocation');
});
test('an internal runner bug stops the run instead of being recorded as missing evidence', async t => {
  const e = await environment(t);
  e.runTask = async () => { throw new TypeError('The "path" argument must be of type string. Received undefined'); };
  await assert.rejects(run(e), /internal runner error: TypeError/);
  const rows = await readFile(e.resultsFile, 'utf8').catch(() => '');
  assert.equal(rows.trim(), '', 'no bogus rows recorded');
});
test('the real Claude run task refuses a missing harness home before starting a run', async () => {
  const { createClaudeRunTask } = await import('../scripts/effort-eval/outcome-tasks/run.mjs');
  const rt = createClaudeRunTask({ startRun: () => { throw Error('must not start'); }, readRunState: () => null, readRunEvents: () => [] });
  await assert.rejects(rt({ adapterId: 'claude', model: 'm', cwd: '/tmp', task: 't', homeDir: undefined }), /harness home required/);
});
