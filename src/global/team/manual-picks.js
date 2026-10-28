// Manual gentle-ai model picks as routing inputs (T13 / S10).
// A pick is MANUAL when the value exists in a gentle-ai host file and differs from
// the last value Kairo recorded writing there, or Kairo has no record of it.
// Reads are local, pure of side effects, and never throw.
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { harnessHomePaths } from '../paths.js';
import { writeAtomicText } from '../runtime/write-atomic-json.js';
import { loadGentleClaudeAssignments } from '../fleet-shared.js';
import { agentNameToRole, isGentleOwnedActor } from '../intelligence/role-catalog.js';

export const MANUAL_PICKS_LEDGER_SCHEMA = 'kairo.manual-picks-ledger/v1';
export const PICK_HOSTS = Object.freeze(['claude', 'codex', 'opencode']);

// The odd naming Kairo writes plus the gentle-ai default agent names, per Kairo role.
const AGENT_ROLES = Object.freeze({
  'odd-explorer': 'Explorer', explorer: 'Explorer', explore: 'Explorer', 'gentle-ai-explore': 'Explorer',
  'odd-worker': 'Builder', worker: 'Builder', 'gentle-ai-worker': 'Builder',
  'odd-verify': 'Verifier', verifier: 'Verifier', verify: 'Verifier', 'gentle-ai-verify': 'Verifier'
});

export function manualPicksLedgerPath(homeDir) {
  return join(harnessHomePaths(homeDir).root, 'manual-picks-ledger.json');
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export async function readManualPicksLedger(homeDir) {
  try {
    const doc = JSON.parse(await readFile(manualPicksLedgerPath(homeDir), 'utf8'));
    if (!isObject(doc)) return {};
    const out = Object.fromEntries(PICK_HOSTS.filter(host => isObject(doc[host])).map(host => [host, doc[host]]));
    if (isObject(doc.baseline)) out.baseline = Object.fromEntries(PICK_HOSTS.filter(host => isObject(doc.baseline[host])).map(host => [host, doc.baseline[host]]));
    return out;
  } catch { return {}; }
}

async function writeLedger(homeDir, ledger) {
  const path = manualPicksLedgerPath(homeDir);
  await mkdir(dirname(path), { recursive: true });
  await writeAtomicText(path, `${JSON.stringify({ schema: MANUAL_PICKS_LEDGER_SCHEMA, ...ledger }, null, 2)}\n`);
}

/** Record values Kairo wrote: writes = { [key]: value } for one host. */
export async function recordKairoWrites(homeDir, host, writes) {
  const current = await readManualPicksLedger(homeDir);
  const next = { ...current, [host]: { ...(current[host] ?? {}), ...writes } };
  await writeLedger(homeDir, next);
  return next;
}

/**
 * Starting point: the first time a host has no baseline, its current values become
 * the baseline and are not manual. `persist` stores it (best-effort) for later reads.
 */
export async function ensureHostBaseline(homeDir, ledger, host, current, { persist = true } = {}) {
  if (ledger.baseline?.[host]) return ledger;
  const next = { ...ledger, baseline: { ...(ledger.baseline ?? {}), [host]: current } };
  if (persist) { try { await writeLedger(homeDir, next); } catch { /* baseline stays in memory */ } }
  return next;
}

const fieldsOf = value => (typeof value === 'string' ? { model: value, effort: null }
  : { model: value?.model ?? null, effort: value?.effort ?? null });
const sameValue = (a, b) => {
  if (a === undefined || b === undefined) return false;
  const left = fieldsOf(a);
  const right = fieldsOf(b);
  return left.model === right.model && left.effort === right.effort;
};

/**
 * Manual when present and different from both Kairo's last recorded write and the
 * baseline taken the first time the host was read. No baseline and no write: manual.
 */
export function isManualValue(ledger, host, key, current) {
  if (current === undefined || current === null) return false;
  return !sameValue(current, ledger?.[host]?.[key]) && !sameValue(current, ledger?.baseline?.[host]?.[key]);
}

function roleOf(agent, catalog) {
  if (isGentleOwnedActor(agent)) return null;
  const role = AGENT_ROLES[agent] ?? (catalog ? agentNameToRole(catalog).byAgent.get(agent) : null);
  if (!role || (catalog && !catalog.registry?.[role])) return null;
  return role;
}

/** Current Claude odd/phase values as { agent: {model, effort?} }. */
export async function readClaudeValues(homeDir, read = readFile) {
  return (await loadGentleClaudeAssignments(homeDir, read)) ?? {};
}

/** `model = "x"` only above the first [section]; a model inside a table is not the agent's own. */
export function topLevelModel(text) {
  const top = String(text).split(/^\s*\[/m, 1)[0];
  return /^\s*model\s*=\s*"([^"]+)"/m.exec(top)?.[1] ?? null;
}

async function codexValues(homeDir, read, list) {
  const dir = join(homeDir, '.codex', 'agents');
  let names;
  try { names = await list(dir); } catch { return {}; }
  const out = {};
  for (const file of names.filter(name => name.endsWith('.toml')).sort()) {
    try {
      const model = topLevelModel(await read(join(dir, file), 'utf8'));
      if (model) out[file.slice(0, -'.toml'.length)] = model;
    } catch { /* unreadable agent file */ }
  }
  return out;
}

async function opencodeValues(homeDir, read) {
  let config;
  try { config = JSON.parse(await read(join(homeDir, '.config', 'opencode', 'opencode.json'), 'utf8')); } catch { return {}; }
  const agents = config?.agent ?? config?.agents;
  if (!isObject(agents)) return {};
  return Object.fromEntries(Object.entries(agents).flatMap(([agent, entry]) =>
    (typeof entry?.model === 'string' && entry.model ? [[agent, entry.model]] : [])));
}

const splitOpenCode = model => {
  const slash = model.indexOf('/');
  return { adapterId: slash > 0 ? model.slice(0, slash) : 'opencode-go', model: slash > 0 ? model.slice(slash + 1) : model };
};

/**
 * Manual picks per host mapped to Kairo roles. Unmapped agents are ignored.
 * `persist` stores a missing per-host baseline; route reads leave it false and never write.
 * @returns {{claude: object, codex: object, opencode: object}} host -> role -> {agent, adapterId, model}
 */
export async function readManualPicks({ homeDir, catalog = null, read = readFile, list = readdir, persist = false } = {}) {
  const out = { claude: {}, codex: {}, opencode: {} };
  if (!homeDir) return out;
  let ledger = await readManualPicksLedger(homeDir);
  const values = { claude: await readClaudeValues(homeDir, read), codex: await codexValues(homeDir, read, list),
    opencode: await opencodeValues(homeDir, read) };
  for (const host of PICK_HOSTS) {
    ledger = await ensureHostBaseline(homeDir, ledger, host, values[host], { persist });
    for (const [agent, value] of Object.entries(values[host])) {
      if (!isManualValue(ledger, host, agent, value)) continue;
      const role = roleOf(agent, catalog);
      if (!role || out[host][role]) continue;
      if (host === 'claude') out.claude[role] = { agent, adapterId: 'claude', model: fieldsOf(value).model };
      else if (host === 'codex') out.codex[role] = { agent, adapterId: 'codex', model: value };
      else out.opencode[role] = { agent, ...splitOpenCode(value) };
    }
  }
  return out;
}

/** One pick for the role: the active host first, then Claude, Codex, OpenCode. */
export function manualPickForRole(picks, role, hostId = null) {
  const id = hostId === 'claude-code' ? 'claude' : hostId;
  const order = [...new Set([id, ...PICK_HOSTS].filter(host => PICK_HOSTS.includes(host)))];
  for (const host of order) if (picks?.[host]?.[role]) return { host, ...picks[host][role] };
  return null;
}

/**
 * Catalog model matching a pick: exact id, else the only same-provider model containing the picked name.
 * @returns {{model: object|null, unresolved: string|null}} unresolved states why the pick cannot route.
 */
export function resolveManualModel(pick, candidates) {
  const want = String(pick.model).toLowerCase();
  const same = (candidates ?? []).filter(row => row?.adapterId === pick.adapterId);
  const exact = same.find(row => String(row.modelId).toLowerCase() === want);
  if (exact) return { model: exact, unresolved: null };
  const loose = [...new Map(same.filter(row => String(row.modelId).toLowerCase().includes(want)).map(row => [row.modelId, row])).values()];
  if (loose.length === 1) return { model: loose[0], unresolved: null };
  return { model: null, unresolved: loose.length
    ? `manual pick ${pick.adapterId}/${pick.model} unresolved: ambiguous (${loose.map(row => row.modelId).join(', ')})`
    : `manual pick ${pick.adapterId}/${pick.model} unresolved: not in the catalog` };
}
