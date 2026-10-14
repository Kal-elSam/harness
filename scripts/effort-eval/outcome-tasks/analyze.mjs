import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, TIERS, loadFrozen, jsonLines, isMain, argumentsFor } from './common.mjs';

export function analyzeResults({ tasks, predictions, results, predictionsHash }) {
  if (results.some(row => row.predictionsHash !== predictionsHash)) throw new Error('results predictions hash mismatch');
  if (results.some(row => !tasks.some(task => task.id === row.taskId) || !TIERS.includes(row.tier) ||
      !['pass','fail','missing-evidence'].includes(row.outcome))) throw new Error('invalid result');
  const byTask = new Map(tasks.map(task => [task.id, new Map()]));
  // Latest retry wins only while no completed non-missing result exists.
  for (const row of results) {
    const runs = byTask.get(row.taskId), existing = runs.get(row.tier);
    if (existing && existing.outcome !== 'missing-evidence') {
      if (JSON.stringify(existing) !== JSON.stringify(row)) throw new Error('duplicate completed result');
    } else runs.set(row.tier, row);
  }
  const truth = {}, excluded = [], unsolvable = [], nonMonotonic = [], complete = [];
  for (const task of tasks) {
    const runs = TIERS.map(tier => byTask.get(task.id).get(tier));
    if (runs.some(row => !row || row.outcome === 'missing-evidence')) {
      excluded.push({ taskId: task.id, reason: runs.some(row => row?.outcome === 'missing-evidence') ? 'missing-evidence' : 'incomplete' }); continue;
    }
    complete.push(task);
    const minimum = runs.findIndex(row => row.outcome === 'pass');
    if (minimum < 0) unsolvable.push(task.id);
    else {
      truth[task.id] = TIERS[minimum];
      if (runs.slice(minimum + 1).some(row => row.outcome === 'fail')) nonMonotonic.push(task.id);
    }
  }
  function metrics(group) {
    const solvable = group.filter(task => truth[task.id]);
    let under = 0, over = 0, exact = 0, success = 0, cost = 0, costKnown = 0;
    for (const task of group) {
      const prediction = predictions.find(row => row.taskId === task.id)?.tier;
      if (!TIERS.includes(prediction)) throw new Error(`missing prediction: ${task.id}`);
      const row = byTask.get(task.id).get(prediction);
      success += Number(row.outcome === 'pass');
      const usd = row.cost?.total_cost_usd;
      if (typeof usd === 'number' && Number.isFinite(usd) && usd >= 0) { cost += usd; costKnown++; }
      if (truth[task.id]) {
        const difference = TIERS.indexOf(prediction) - TIERS.indexOf(truth[task.id]);
        under += Number(difference < 0); over += Number(difference > 0); exact += Number(difference === 0);
      }
    }
    return { scoredTasks: solvable.length, routedTasks: group.length,
      underProvisionRate: solvable.length ? under / solvable.length : null,
      exactTierAccuracy: solvable.length ? exact / solvable.length : null,
      overProvisionRate: solvable.length ? over / solvable.length : null,
      routedSuccessRate: group.length ? success / group.length : null,
      routedCost: { total_cost_usd: costKnown === group.length && group.length ? cost : null,
        knownSubtotal: cost, measuredRuns: costKnown, missingRuns: group.length - costKnown, basis: 'API-equivalent' } };
  }
  return { classifier: 'classifyEffort', predictionsHash, truth, excluded, unsolvable, nonMonotonic,
    metrics: metrics(complete), riskSensitive: { metrics: metrics(complete.filter(task => task.riskSensitive)),
      excluded: excluded.filter(row => tasks.find(task => task.id === row.taskId).riskSensitive),
      unsolvable: unsolvable.filter(id => tasks.find(task => task.id === id).riskSensitive),
      nonMonotonic: nonMonotonic.filter(id => tasks.find(task => task.id === id).riskSensitive) },
    limitations: 'Synthetic, single-run-per-tier outcomes; not live routing impact or population estimates. No policy, threshold, or winner selected.' };
}
export function markdown(report) {
  const percent = value => value === null ? 'N/A' : `${(value * 100).toFixed(1)}%`;
  const section = (name, m) => `## ${name}\n- Under-provision: ${percent(m.underProvisionRate)}\n- Exact tier: ${percent(m.exactTierAccuracy)}\n- Over-provision: ${percent(m.overProvisionRate)}\n- Routed success: ${percent(m.routedSuccessRate)} (${m.routedTasks} complete tasks; includes unsolvable)\n- Routed API-equivalent cost: ${m.routedCost.total_cost_usd ?? 'N/A'} USD\n`;
  return `# Effort outcome analysis\n\nPredictions SHA-256: ${report.predictionsHash}\n\n${section('All tasks', report.metrics)}\n${section('Risk-sensitive tasks', report.riskSensitive.metrics)}\nUnsolvable: ${report.unsolvable.join(', ') || 'none'}\nNon-monotonic: ${report.nonMonotonic.join(', ') || 'none'}\nExcluded: ${report.excluded.map(x => `${x.taskId} (${x.reason})`).join(', ') || 'none'}\n\n${report.limitations}\n`;
}
export async function analyze({ root = ROOT, predictionsFile = join(root, 'predictions.json'),
  resultsFile = join(root, 'results.jsonl'), outputDir = join(root, 'reports') } = {}) {
  const { frozen, predictionsHash, tasks } = await loadFrozen(root, predictionsFile);
  const report = analyzeResults({ tasks, predictions: frozen.predictions, results: await jsonLines(resultsFile), predictionsHash });
  report.corpusHash = frozen.corpusHash; report.routerHash = frozen.routerHash;
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'analysis.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(outputDir, 'analysis.md'), markdown(report));
  return report;
}
if (isMain(import.meta.url)) {
  try {
    const args = argumentsFor({ predictions: { type: 'string' }, results: { type: 'string' }, output: { type: 'string' } });
    if (args.help) console.log('Usage: node analyze.mjs [--predictions FILE] [--results FILE] [--output DIRECTORY]\nWrites analysis.json and analysis.md under reports/ by default. Missing evidence excluded for every metric; unsolvable excluded only from tier accuracy.');
    else console.log(JSON.stringify(await analyze({ predictionsFile: args.predictions, resultsFile: args.results, outputDir: args.output }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
