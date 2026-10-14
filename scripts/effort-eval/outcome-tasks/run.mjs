import { appendFile, cp, lstat, readFile, readdir, readlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, relative, resolve } from 'node:path';
import { runKairoBenchTask } from '../../../src/global/intelligence/kairobench-runner.js';
import { resolveClaudeModelForEffort } from '../../../src/global/intelligence/execution-router.js';
import { readClaudeModels } from '../../../src/global/observability/claude-models.js';
import { ROOT, TIERS, loadFrozen, jsonLines, isMain, argumentsFor } from './common.mjs';

// Imported only on the real execution path. Tests and dry-run never invoke these.
async function defaultQuotaProbe() {
  return (await import('../../../src/global/observability/claude-usage.js')).readClaudeUsage();
}
export function createClaudeRunTask(dependencies = {}) {
  return async ({ adapterId, model, cwd, task, homeDir }) => {
    const startRun = dependencies.startRun ?? (await import('../../../src/global/runtime/run-manager.js')).startRun;
    const store = dependencies.readRunState && dependencies.readRunEvents ? dependencies
      : await import('../../../src/global/runtime/run-store.js');
    // Normal permission mode: never manufacture unsafe consent for a benchmark.
    const { runId, completion } = await startRun({ agentId: adapterId, model, cwd, task, homeDir, permissions: [], wait: true });
    await completion;
    const state = await store.readRunState(homeDir, runId);
    if (state?.state !== 'completed' || state?.exitCode !== 0) throw new Error(state?.error || 'provider did not complete successfully');
    const events = await store.readRunEvents(homeDir, runId);
    const result = events.findLast(event => event.type === 'agent.result')?.data;
    if (result?.is_error) throw new Error('provider result error');
    return { state: state.state, tokenUsage: state.tokenUsage, cost: state.cost,
      turns: result?.num_turns ?? result?.turns ?? null, runId };
  };
}
const defaultRunTask = createClaudeRunTask();
function remaining(probe) {
  if (typeof probe === 'number') return Number.isFinite(probe) && probe >= 0 && probe <= 100 ? probe : null;
  if (probe?.status !== 'measured') return null;
  const windows = probe.windows?.length ? probe.windows : [probe.primary, probe.secondary].filter(Boolean);
  const values = windows.map(window => remaining(window?.remainingPercent));
  return values.length && values.every(value => value !== null) ? Math.min(...values) : null;
}
async function snapshot(root, prefix = '') {
  const result = new Map();
  for (const name of (await readdir(join(root, prefix))).sort()) {
    const path = join(root, prefix, name), key = [prefix, name].filter(Boolean).join('/');
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) result.set(key, { type: 'symlink', bytes: Buffer.from(await readlink(path)), mode: stat.mode });
    else if (stat.isDirectory()) {
      result.set(key + '/', { type: 'directory', bytes: Buffer.alloc(0), mode: stat.mode });
      for (const [child, value] of await snapshot(root, key)) result.set(child, value);
    } else if (stat.isFile()) result.set(key, { type: 'file', bytes: await readFile(path), mode: stat.mode });
    else throw new Error('unsupported file type');
  }
  return result;
}
function diff(before, after, scope) {
  let size = 0, violation = null;
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(path), b = after.get(path);
    if (a?.type === b?.type && a?.mode === b?.mode && a?.bytes.equals(b?.bytes)) continue;
    size += (a?.bytes.length ?? 0) + (b?.bytes.length ?? 0);
    // Exact file scope; directory creation/deletion and symlinks also fail closed.
    if (!scope.includes(path) || (b && b.type !== 'file')) violation = `scope violation: ${path}`;
  }
  return { size, violation };
}
async function execute(task, tier, model, { root, runTask, homeDir, predictionsHash }) {
  const started = Date.now();
  let cwd, before, usage = {}, evidence = { outcome: 'missing-evidence', reason: 'crash before check' }, diffSize = null;
  try {
    await runKairoBenchTask({ ...task,
      verify: async () => {
        // Check command is external: only fixture bytes enter the agent copy.
        try {
          let change = diff(before, await snapshot(cwd), task.scope);
          diffSize = change.size;
          if (change.violation) { evidence = { outcome: 'fail', reason: change.violation }; return false; }
          const checked = spawnSync(process.execPath, [resolve(root, task.check), cwd], {
            cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024
          });
          change = diff(before, await snapshot(cwd), task.scope);
          diffSize = change.size;
          if (change.violation) evidence = { outcome: 'fail', reason: change.violation };
          else if (checked.error || checked.signal || checked.status === null || checked.status > 1) {
            evidence = { outcome: 'missing-evidence', reason: 'external check unavailable or crashed' };
          } else evidence = { outcome: checked.status === 0 ? 'pass' : 'fail', reason: checked.status === 0 ? 'external check passed' : 'external check failed' };
        } catch { evidence = { outcome: 'missing-evidence', reason: 'external check or diff unavailable' }; }
        return evidence.outcome === 'pass';
      }
    }, { adapterId: 'claude', model, homeDir,
      runTask: async args => {
        cwd = args.cwd;
        if (!relative(resolve(ROOT, '../../..'), cwd).startsWith('..')) throw new Error('agent copy must be outside repository');
        await cp(resolve(root, task.fixture), cwd, { recursive: true });
        before = await snapshot(cwd);
        usage = await runTask(args) ?? {};
        if (usage.error || (usage.state && usage.state !== 'completed') || (usage.exitCode != null && usage.exitCode !== 0)) {
          throw new Error('transport/quota/auth failure or crash before check');
        }
        return usage;
      }
    });
  } catch {
    // Provider error text can contain secrets: retain a bounded reason class only.
    evidence = { outcome: 'missing-evidence', reason: 'transport/quota/auth failure or crash before check' };
  }
  return { taskId: task.id, tier, model, ...evidence, tokenUsage: usage.tokenUsage ?? null,
    cost: { total_cost_usd: typeof usage.cost === 'number' ? usage.cost : usage.cost?.total_cost_usd ?? usage.total_cost_usd ?? null, basis: 'API-equivalent' },
    durationMs: Date.now() - started, turns: usage.turns ?? usage.num_turns ?? null, diffSize,
    timestamp: new Date().toISOString(), predictionsHash };
}
export async function runOutcomes({ root = ROOT, predictionsFile = join(root, 'predictions.json'),
  resultsFile = join(root, 'results.jsonl'), tasks: ids, phase, dryRun = false,
  catalogs = { claude: readClaudeModels() }, runTask = defaultRunTask, quotaProbe = defaultQuotaProbe, homeDir } = {}) {
  const { frozen, predictionsHash, tasks } = await loadFrozen(root, predictionsFile);
  if (phase != null && !['A','B'].includes(phase)) throw new Error('phase must be A or B');
  if (phase && ids) throw new Error('choose --tasks or --phase, not both');
  if (!phase && !ids) throw new Error('--tasks or --phase required');
  if (ids && (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length || ids.some(id => !tasks.some(task => task.id === id)))) throw new Error('unknown or duplicate task id');
  const selected = tasks.filter(task => ids ? ids.includes(task.id) : frozen.phaseA.includes(task.id) === (phase === 'A'));
  const models = Object.fromEntries(TIERS.map(tier => [tier, resolveClaudeModelForEffort(tier, catalogs, { strict: true })]));
  if (TIERS.some(tier => !models[tier])) throw new Error('unknown model: tier absent from real Claude catalog');
  const plan = selected.flatMap(task => TIERS.map(tier => ({ taskId: task.id, tier, model: models[tier] })));
  if (dryRun) return { plan, records: [], stopped: false, reason: 'dry-run: real quota probe bypassed; no provider execution' };
  const previous = await jsonLines(resultsFile);
  if (previous.some(row => row.predictionsHash !== predictionsHash)) throw new Error('results predictions hash mismatch');
  if (previous.some(row => !tasks.some(task => task.id === row.taskId) || !TIERS.includes(row.tier) ||
      row.model !== models[row.tier] || !['pass','fail','missing-evidence'].includes(row.outcome))) throw new Error('invalid results or model mismatch');
  const completed = new Set(previous.filter(row => row.outcome !== 'missing-evidence').map(row => `${row.taskId}:${row.tier}`));
  const records = [];
  for (const item of plan) {
    if (completed.has(`${item.taskId}:${item.tier}`)) continue;
    let quota = null;
    try { quota = remaining(await quotaProbe()); } catch { /* fail closed */ }
    if (quota === null || quota < 20) return { plan, records, stopped: true, reason: quota === null ? 'quota probe unavailable' : 'quota below 20%; stopped before next run' };
    const record = await execute(selected.find(task => task.id === item.taskId), item.tier, item.model,
      { root, runTask, homeDir, predictionsHash });
    await appendFile(resultsFile, JSON.stringify(record) + '\n');
    records.push(record);
  }
  return { plan, records, stopped: false, reason: 'selected runs recorded' };
}
if (isMain(import.meta.url)) {
  try {
    const args = argumentsFor({ tasks: { type: 'string' }, phase: { type: 'string' }, 'dry-run': { type: 'boolean' },
      predictions: { type: 'string' }, results: { type: 'string' } });
    if (args.help) console.log('Usage: node run.mjs (--tasks id,id | --phase A|B) [--dry-run] [--predictions FILE] [--results FILE]\nA = frozen six-task pilot; B = remaining tasks. All three tiers. Dry-run bypasses real quota probe and provider. Real execution spends quota; commit predictions first.');
    else console.log(JSON.stringify(await runOutcomes({ tasks: args.tasks?.split(','), phase: args.phase, dryRun: args['dry-run'],
      predictionsFile: args.predictions, resultsFile: args.results }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
