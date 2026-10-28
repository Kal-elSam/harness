// Launch and outcome history shares the routing-input cache's project scope.
import { mkdir, open, readFile, rmdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { harnessHomePaths, resolveHomeDir } from '../paths.js';
import { projectKeyForPath } from '../next/project-key.js';
import { resolveProjectRoot } from '../architect/architect-store.js';
import { loadProjectRoleCatalog, agentNameToRole } from '../intelligence/role-catalog.js';
import { readUsageSamples } from '../observability/usage-samples.js';
import { writeAtomicText } from '../runtime/write-atomic-json.js';
import { classifyCursorPool } from '../observability/cursor-entitlement.js';
import { invalidateCursorPoolAccess, readCursorAccessCache, writeCursorAccessCache } from '../observability/cursor-entitlement-store.js';

const RETENTION_MS = 8 * 86400000;
const STALE_LOCK_MS = 30000;

export function launchLedgerPath(homeDir, projectRoot) {
  return join(harnessHomePaths(homeDir).sessionsDir, projectKeyForPath(projectRoot), 'launch-ledger.jsonl');
}

async function readText(path) {
  try { return await readFile(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
}

function parseLine(line) {
  try { return JSON.parse(line); } catch { return null; }
}

/** Read-only: even expired rows are only pruned by the recording path. */
export async function readLaunchLedger(homeDir, projectRoot, role) {
  return (await readText(launchLedgerPath(homeDir, projectRoot))).split('\n')
    .map(parseLine)
    .filter(row => row?.source === 'launch' && row.role === role
      && typeof row.adapterId === 'string' && row.adapterId
      && typeof row.modelId === 'string' && row.modelId && Number.isFinite(Date.parse(row.at)))
    .map(row => ({ adapterId: row.adapterId, modelId: row.modelId, role, status: 'completed', at: Date.parse(row.at) }));
}

/** Serialize prune + append across CLI processes, so compaction cannot lose a launch. */
export async function appendLaunchRecord(homeDir, projectRoot, record, deps = {}) {
  return appendLedgerRecord(homeDir, projectRoot, record, 'launch', deps);
}

async function appendLedgerRecord(homeDir, projectRoot, record, source, { now = Date.now } = {}) {
  const path = launchLedgerPath(homeDir, projectRoot);
  const lock = path + '.lock';
  await mkdir(dirname(path), { recursive: true });
  // Never steal a live lock. A lock older than STALE_LOCK_MS can only belong to a
  // crashed writer (one append takes milliseconds), so it is removed and retried.
  for (let attempt = 0; ; attempt++) {
    try { await mkdir(lock); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const age = await stat(lock).then(s => now() - s.mtimeMs, () => 0);
      if (age > STALE_LOCK_MS) { await rmdir(lock).catch(() => {}); continue; }
      if (attempt >= 100) throw new Error('Launch ledger is busy; recording skipped.');
      await delay(20);
    }
  }
  try {
    const at = now();
    const text = await readText(path);
    const lines = text.split('\n').filter(Boolean);
    const retained = lines.filter(line => {
      const time = Date.parse(parseLine(line)?.at);
      return !Number.isFinite(time) || time >= at - RETENTION_MS;
    });
    if (source !== 'verdict' && retained.length !== lines.length) {
      await writeAtomicText(path, retained.length ? retained.join('\n') + '\n' : '');
    }
    if (typeof record === 'function') record = record(text);
    const row = { at: new Date(at).toISOString(), role: record.role, agent: record.agent,
      adapterId: record.adapterId, modelId: record.modelId, source,
      ...(source === 'verdict' ? { outcomeKey: record.outcomeKey, result: record.result,
        ...(record.retry === true ? { retry: true } : {}) } : {}),
      ...(source === 'outcome' ? { status: record.status, ...(record.reason ? { reason: record.reason } : {}),
        ...(record.result != null ? { result: record.result } : {}),
        ...(record.retry === true ? { retry: true } : {}),
        ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}) } : {}) };
    const handle = await open(path, 'a');
    try { await handle.write(JSON.stringify(row) + '\n'); }
    finally { await handle.close(); }
    return row;
  } finally {
    await rmdir(lock);
  }
}

export async function runRecordLaunchCli(options, deps = {}) {
  const log = deps.log ?? console.log;
  try {
    for (const key of ['agent', 'adapter', 'model']) {
      if (typeof options[key] !== 'string' || !options[key].trim()) throw new Error(`Missing --${key}. Use kairo team record-launch --agent NAME --adapter ID --model ID.`);
    }
    const projectRoot = await (deps.resolveRoot ?? resolveProjectRoot)(options.cwd);
    const role = agentNameToRole(loadProjectRoleCatalog({ projectRoot })).byAgent.get(options.agent);
    if (!role) throw new Error(`Unknown agent "${options.agent}" in the project role catalog.`);
    return await appendLaunchRecord(deps.homeDir ?? resolveHomeDir(), projectRoot, {
      role, agent: options.agent, adapterId: options.adapter, modelId: options.model,
    });
  } catch (error) {
    log(error.message);
    process.exitCode = 1;
    return null;
  }
}

/** Exhaustion markers are immutable observations, not launch counts. */
export async function appendOutcomeRecord(homeDir, projectRoot, record, deps = {}) {
  if (!['completed', 'failed', 'exhausted'].includes(record.status)) throw new Error('Invalid --status. Use completed|failed|exhausted.');
  if (record.result != null && !['pass', 'fail'].includes(record.result)) throw new Error('Invalid --result. Use pass|fail.');
  const at = (deps.now ?? Date.now)();
  let expiresAt;
  if (record.status === 'exhausted') {
    const samples = await (deps.readUsageSamples ?? readUsageSamples)(homeDir, record.adapterId, { now: () => at });
    const current = samples.filter(row => row.window === '5h' && row.timestamp <= at
      && row.resetsAt > at && row.resetsAt <= at + 5 * 3600000)
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    let reset = current?.resetsAt;
    if (!reset) {
      // This is the same project-local cache read by `team route`; no probes.
      let cache;
      try { cache = JSON.parse(await readText(join(dirname(launchLedgerPath(homeDir, projectRoot)), 'routing-input-cache.json'))); }
      catch { cache = null; }
      if (cache?.schema === 'kairo.routing-input-cache/v2' && Number.isFinite(cache.generatedAt)
          && cache.generatedAt <= at && at - cache.generatedAt <= 30 * 60000) {
        const window = cache.providerCapacity?.[record.adapterId]?.quotaWindows?.find(row => /5h|session/i.test(row.kind ?? row.window));
        const value = window?.resetsAtIso ?? window?.resetsAt;
        const time = typeof value === 'number' ? value : Date.parse(value);
        if (time > at && time <= at + 5 * 3600000) reset = time;
      }
    }
    expiresAt = new Date(reset ?? at + 30 * 60000).toISOString();
  }
  const row = await appendLedgerRecord(homeDir, projectRoot, { ...record, expiresAt }, 'outcome', { ...deps, now: () => at });
  if (record.status === 'exhausted' && record.adapterId === 'cursor') await invalidateExhaustedCursorPool(homeDir, record.modelId, deps);
  return row;
}

/** A real limit hit outranks the cached probe: drop only that pool's entry now. Fail-open. */
async function invalidateExhaustedCursorPool(homeDir, modelId, deps) {
  try {
    const pool = classifyCursorPool({ id: modelId });
    const cache = await (deps.readCursorAccessCache ?? readCursorAccessCache)(homeDir);
    if (!cache?.pools || !(pool in cache.pools)) return;
    await (deps.writeCursorAccessCache ?? writeCursorAccessCache)(homeDir, invalidateCursorPoolAccess(cache, pool));
  } catch { /* cache hygiene must never fail outcome recording */ }
}

/** Read-only, account-provider markers within this project's ledger scope. */
export async function readExhaustionMarkers(homeDir, projectRoot, { now = Date.now } = {}) {
  const at = now(), markers = {};
  for (const row of (await readText(launchLedgerPath(homeDir, projectRoot))).split('\n').map(parseLine)) {
    const expiry = Date.parse(row?.expiresAt), observed = Date.parse(row?.at);
    if (row?.source !== 'outcome' || row.status !== 'exhausted'
        || typeof row.adapterId !== 'string' || !row.adapterId || !Number.isFinite(observed)
        || observed > at || !(expiry > at) || expiry <= observed || expiry - observed > 5 * 3600000) continue;
    if (!markers[row.adapterId] || markers[row.adapterId].expiresAt < expiry) {
      markers[row.adapterId] = { expiresAt: expiry, reason: row.reason ?? 'Provider usage limit reached.' };
    }
  }
  return markers;
}

export async function runRecordOutcomeCli(options, deps = {}) {
  const log = deps.log ?? console.log;
  try {
    for (const key of ['agent', 'adapter', 'model', 'status']) {
      if (typeof options[key] !== 'string' || !options[key].trim() || options[key].startsWith('--')) throw new Error(`Missing --${key}. Use kairo team record-outcome --agent NAME --adapter ID --model ID --status completed|failed|exhausted.`);
    }
    if (!['completed', 'failed', 'exhausted'].includes(options.status)) throw new Error('Invalid --status. Use completed|failed|exhausted.');
    const projectRoot = await (deps.resolveRoot ?? resolveProjectRoot)(options.cwd);
    const role = agentNameToRole(loadProjectRoleCatalog({ projectRoot })).byAgent.get(options.agent);
    if (!role) throw new Error(`Unknown agent "${options.agent}" in the project role catalog.`);
    return await appendOutcomeRecord(deps.homeDir ?? resolveHomeDir(), projectRoot, {
      role, agent: options.agent, adapterId: options.adapter, modelId: options.model,
      status: options.status, reason: options.reason, result: options.result, retry: options.retry,
    }, deps);
  } catch (error) {
    log(error.message);
    process.exitCode = 1;
    return null;
  }
}

/** Stable references also cover legacy outcomes with no identifier. */
function attributedOutcomes(text) {
  const occurrences = new Map();
  const outcomes = new Map();
  for (const line of text.split('\n').filter(Boolean)) {
    const row = parseLine(line);
    if (row?.source === 'outcome' && Number.isFinite(Date.parse(row.at))) {
      const hash = createHash('sha256').update(line).digest('hex');
      const ordinal = occurrences.get(hash) ?? 0;
      occurrences.set(hash, ordinal + 1);
      outcomes.set(`${hash}:${ordinal}`, row);
    } else if (row?.source === 'verdict' && ['pass', 'fail'].includes(row.result)) {
      const outcome = outcomes.get(row.outcomeKey);
      if (outcome && outcome.result == null && outcome.agent === row.agent) {
        outcomes.set(row.outcomeKey, { ...outcome, result: row.result,
          ...(row.retry === true ? { retry: true } : {}) });
      }
    }
  }
  return outcomes;
}

/** Read attributed outcomes without converting verdicts into extra task counts. */
export async function readOutcomeRecords(homeDir, projectRoot) {
  return [...attributedOutcomes(await readText(launchLedgerPath(homeDir, projectRoot))).values()];
}

export async function runVerdictCli(options, deps = {}) {
  const log = deps.log ?? console.log;
  try {
    if (!options.pending && !['pass', 'fail'].includes(options.result)) throw new Error('Invalid --result. Use pass|fail.');
    if (options.pending && (options.agent != null || options.result != null || options.retry)) {
      throw new Error('Use --pending without --agent, --result or --retry.');
    }
    const projectRoot = await (deps.resolveRoot ?? resolveProjectRoot)(options.cwd);
    const homeDir = deps.homeDir ?? resolveHomeDir();
    if (options.pending) {
      const rows = (await readOutcomeRecords(homeDir, projectRoot)).filter(row => row.result == null && row.status !== 'exhausted');
      log(options.json ? JSON.stringify(rows) : rows.length
        ? ['Agent\tModel\tFinished', ...rows.map(row => `${row.agent}\t${row.modelId}\t${row.at}`)].join('\n')
        : 'No pending verdicts.');
      return rows;
    }
    if (typeof options.agent !== 'string' || !options.agent.trim() || options.agent.startsWith('--')) {
      throw new Error('Missing --agent. Use kairo team verdict --agent NAME --result pass|fail.');
    }
    // The ledger may hold names the catalog lacks (for example transport wrappers); a pending outcome is enough.
    const hasPending = (await readOutcomeRecords(homeDir, projectRoot)).some(row => row.agent === options.agent && row.result == null && row.status !== 'exhausted');
    if (!hasPending && !agentNameToRole(loadProjectRoleCatalog({ projectRoot })).byAgent.has(options.agent)) {
      throw new Error(`Unknown agent "${options.agent}" in the project role catalog.`);
    }
    // Select and append inside the same lock: simultaneous verdicts cannot claim one outcome.
    const row = await appendLedgerRecord(homeDir, projectRoot, text => {
      const pending = [...attributedOutcomes(text)].filter(([, row]) => row.agent === options.agent && row.result == null && row.status !== 'exhausted');
      const latest = pending.at(-1);
      if (!latest) throw new Error(`No pending outcome for agent "${options.agent}".`);
      const [outcomeKey, outcome] = latest;
      return { ...outcome, outcomeKey, result: options.result, retry: options.retry === true || outcome.retry === true };
    }, 'verdict', deps);
    log(options.json ? JSON.stringify(row) : `Verdict ${row.result}: ${row.agent} (${row.modelId}).`);
    return row;
  } catch (error) {
    log(options.json ? JSON.stringify({ decision: 'ERROR', message: error.message }) : error.message);
    process.exitCode = 1;
    return null;
  }
}


/** Pair legacy records in append order; each outcome consumes one preceding launch. */
export async function readRunningLaunches(homeDir, projectRoot, { now = Date.now } = {}) {
  const pending = [];
  const ordinals = new Map();
  const rows = (await readText(launchLedgerPath(homeDir, projectRoot))).split('\n').map(parseLine);
  const at = now();
  for (const row of rows) {
    if (!row || !['launch', 'outcome'].includes(row.source) || !Number.isFinite(Date.parse(row.at))
      || Date.parse(row.at) > at || ![row.role, row.agent, row.adapterId, row.modelId].every(v => typeof v === 'string' && v)) continue;
    if (row.source === 'launch') {
      const hash = createHash('sha256').update(JSON.stringify(row)).digest('hex');
      const ordinal = ordinals.get(hash) ?? 0;
      ordinals.set(hash, ordinal + 1);
      pending.push({ ...row, id: `${hash}:${ordinal}` });
    }
    else if (['completed', 'failed', 'exhausted'].includes(row.status)) {
      const match = pending.findIndex(item => item.role === row.role && item.agent === row.agent
        && item.adapterId === row.adapterId && item.modelId === row.modelId && Date.parse(item.at) <= Date.parse(row.at));
      if (match >= 0) pending.splice(match, 1);
    }
  }
  const result = { running: [], abandoned: [] };
  for (const row of pending) {
    const elapsedMs = at - Date.parse(row.at);
    const abandoned = elapsedMs > 2 * 3600000;
    result[abandoned ? 'abandoned' : 'running'].push({ ...row, elapsedMs, status: abandoned ? 'possibly abandoned' : 'running' });
  }
  return result;
}

/** Launches per model and provider: today (local calendar day) and the last 7 days. */
export async function readModelDistribution(homeDir, projectRoot, { now = Date.now } = {}) {
  const at = now();
  const dayStart = new Date(at); dayStart.setHours(0, 0, 0, 0);
  const windows = { today: dayStart.getTime(), last7Days: at - 7 * 86400000 };
  const counts = { today: new Map(), last7Days: new Map() };
  for (const row of (await readText(launchLedgerPath(homeDir, projectRoot))).split('\n').map(parseLine)) {
    const time = Date.parse(row?.at);
    if (row?.source !== 'launch' || !Number.isFinite(time) || time > at
      || ![row.adapterId, row.modelId].every(v => typeof v === 'string' && v)) continue;
    for (const [name, start] of Object.entries(windows)) {
      if (time < start) continue;
      const key = `${row.modelId}\u0000${row.adapterId}`;
      counts[name].set(key, (counts[name].get(key) ?? 0) + 1);
    }
  }
  const list = map => [...map].map(([key, launches]) => {
    const [modelId, adapterId] = key.split('\u0000');
    return { modelId, adapterId, launches };
  }).sort((a, b) => b.launches - a.launches);
  return { today: list(counts.today), last7Days: list(counts.last7Days) };
}
