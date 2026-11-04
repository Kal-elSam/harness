import { mkdir, open, readFile, rmdir, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { launchLedgerPath } from './launch-ledger.js';
import { resolveHomeDir } from '../paths.js';
import { resolveProjectRoot } from '../architect/architect-store.js';
import { writeAtomicText } from '../runtime/write-atomic-json.js';
import { redactText } from '../runtime/run-redact.js';
import { FRONTIER_REFERENCE } from '../intelligence/frontier-reference.js';

const RETENTION_MS = 8 * 86400000;
const STALE_LOCK_MS = 30000;
const LOCK_WAIT_MS = 200;
const LOCK_STEP_MS = 20;
const text = value => typeof value === 'string' ? redactText(value).slice(0, 500) : null;
export const routingTracePath = (home, root) => join(dirname(launchLedgerPath(home, root)), 'routing-trace.jsonl');

const modelText = value => text(typeof value === 'object' && value !== null ? value.modelId : value);
const family = value => ['sonnet', 'opus', 'haiku'].find(name => value?.toLowerCase().includes(name));
function quotaSnapshot(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'unknown';
  const providers = {};
  for (const [name, provider] of Object.entries(input.providers ?? {})) {
    if (!provider || typeof provider !== 'object') continue;
    providers[text(name)] = { tier: text(provider.tier), windows: Array.isArray(provider.windows) ? provider.windows.filter(w => w != null).map(w => ({ name: text(w.name), remainingPercent: typeof w.remainingPercent === 'number' && Number.isFinite(w.remainingPercent) ? w.remainingPercent : null, resetsAt: text(w.resetsAt) })) : [] };
  }
  return { observedAt: text(input.generatedAt), stale: typeof input.stale === 'boolean' ? input.stale : null, providers, attribution: 'none' };
}

// Construct a new object from explicit fields only: never persist arbitrary input.
export function buildRoutingTrace(input, now = Date.now()) {
  const decision = input.routingDecision ?? {};
  const effective = input.effectiveLaunch ?? {};
  const selectedProvider = text(input.selectedProvider), selectedModel = text(input.selectedModel);
  const kind = ['valid', 'invalid', 'absent', 'denied', 'caller_selected'].includes(decision.kind) ? decision.kind : 'absent';
  const denied = kind === 'denied';
  const provider = denied ? null : text(effective.provider), model = denied ? null : text(effective.model);
  let fallbackDetected = null, fallbackReason = null;
  if (denied) fallbackDetected = false;
  else if (kind === 'invalid' || kind === 'absent') { fallbackDetected = true; fallbackReason = text(decision.reason) ?? 'Launch without a valid route'; }
  else if (provider && selectedProvider && provider !== selectedProvider) { fallbackDetected = true; fallbackReason = (kind === 'caller_selected' ? text(input.selectionReason) : null) ?? 'Provider differs from routing decision'; }
  else if (model && selectedModel) {
    const equivalent = provider === 'claude' && selectedProvider === 'claude' && (['sonnet', 'opus', 'haiku'].includes(model.toLowerCase()) || ['sonnet', 'opus', 'haiku'].includes(selectedModel.toLowerCase())) && family(model) && family(model) === family(selectedModel);
    fallbackDetected = model !== selectedModel && !equivalent;
    if (fallbackDetected) fallbackReason = (kind === 'caller_selected' ? text(input.selectionReason) : null) ?? 'Model differs from routing decision';
  }
  return {
    schema: 'kairo.routing-trace/v2', at: new Date(now).toISOString(), traceId: randomUUID(), taskId: null,
    role: text(input.role)?.trim() ? text(input.role) : 'unknown', agent: text(input.agent), cell: text(input.cell), source: input.source === 'exec' ? 'exec' : 'hook',
    candidates: Array.isArray(input.candidates) ? input.candidates.filter(c => c != null).map(c => ({ provider: text(c.provider), model: modelText(c.model) })) : [],
    selectedProvider, selectedModel,
    rejectionReasons: Array.isArray(input.rejectionReasons) ? input.rejectionReasons.filter(c => c != null).map(c => ({ provider: text(c.provider), model: modelText(c.model), reason: text([c.reason, c.detail].filter(v => typeof v === 'string' && v).join(': ')) })) : [],
    selectionReason: text(input.selectionReason), routingDecision: { kind, code: text(decision.code), reason: text(decision.reason) },
    effectiveLaunch: { agent: denied ? null : text(effective.agent), provider, model, evidence: !denied && ['requested', 'dispatched', 'confirmed', 'unknown'].includes(effective.evidence) ? effective.evidence : 'unknown' },
    fallbackDetected, fallbackReason, override: input.override === true,
    quotaSnapshot: quotaSnapshot(input.quotaSnapshot), policyVersion: { frontier: FRONTIER_REFERENCE.version, strategyFingerprint: text(input.strategyFingerprint) },
    capabilityUsed: text(input.capabilityUsed) ?? 'unknown', estimatedConsumption: 'unknown', observedConsumption: 'unknown', attempts: Number.isInteger(input.attempts) && input.attempts > 0 ? input.attempts : 'unknown', rework: 'unknown', outcome: ['completed', 'failed'].includes(input.outcome) ? input.outcome : 'unknown', verdict: 'unknown',
  };
}

export async function appendRoutingTrace(home, root, input, deps = {}) {
  const now = deps.now ?? Date.now, wait = deps.delay ?? delay;
  const path = routingTracePath(home, root), lock = path + '.lock';
  await mkdir(dirname(path), { recursive: true });
  const started = now();
  for (;;) {
    try { await mkdir(lock); break; } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const age = await stat(lock).then(s => now() - s.mtimeMs, () => 0);
      const removed = age > STALE_LOCK_MS && await rmdir(lock).then(() => true, () => false);
      if (now() - started >= LOCK_WAIT_MS) throw new Error('Routing trace is busy; recording skipped.');
      if (!removed) await wait(LOCK_STEP_MS);
    }
  }
  try {
    const timestamp = now();
    const old = await readFile(path, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
    const lines = old.split('\n').filter(Boolean);
    const retained = lines.filter(line => { try { const at = Date.parse(JSON.parse(line).at); return !Number.isFinite(at) || at >= timestamp - RETENTION_MS; } catch { return true; } });
    if (retained.length !== lines.length) await writeAtomicText(path, retained.length ? retained.join('\n') + '\n' : '');
    const row = buildRoutingTrace(input, timestamp);
    const handle = await open(path, 'a');
    try { await handle.write(JSON.stringify(row) + '\n'); } finally { await handle.close(); }
    return row;
  } finally { await rmdir(lock).catch(() => {}); }
}

export async function runRecordTraceCli(options, deps = {}) {
  try {
    if (typeof options.payload !== 'string') throw new Error('Missing --payload JSON.');
    const input = JSON.parse(options.payload);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Payload must be a JSON object.');
    const root = await (deps.resolveRoot ?? resolveProjectRoot)(options.cwd);
    return await appendRoutingTrace(deps.homeDir ?? resolveHomeDir(), root, input);
  } catch (error) { (deps.error ?? console.error)(error.message); process.exitCode = 1; return null; }
}
