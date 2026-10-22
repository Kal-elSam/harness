// Launch-only history shares the routing-input cache's project scope.
import { mkdir, open, readFile, rmdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { harnessHomePaths, resolveHomeDir } from '../paths.js';
import { projectKeyForPath } from '../next/project-key.js';
import { resolveProjectRoot } from '../architect/architect-store.js';
import { loadProjectRoleCatalog, agentNameToRole } from '../intelligence/role-catalog.js';
import { writeAtomicText } from '../runtime/write-atomic-json.js';

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
export async function appendLaunchRecord(homeDir, projectRoot, record, { now = Date.now } = {}) {
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
    if (retained.length !== lines.length) {
      await writeAtomicText(path, retained.length ? retained.join('\n') + '\n' : '');
    }
    const row = { at: new Date(at).toISOString(), role: record.role, agent: record.agent,
      adapterId: record.adapterId, modelId: record.modelId, source: 'launch' };
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
