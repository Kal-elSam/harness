// `kairo statusline`: Claude Code status line. Reads the status JSON on stdin,
// prints one line, never refreshes or probes a provider, and fails open.
import { resolveHomeDir } from '../paths.js';
import { resolveProjectRoot } from '../architect/architect-store.js';
import { readRunningLaunches } from './launch-ledger.js';
import { readCachedUsage } from '../host/workspace-cache.js';
import { readRoutingInputCache, ROUTING_INPUT_CACHE_SCHEMA } from './routing-input-cache.js';
import { paceQuotaWindows } from '../intelligence/quota-pacing.js';

const FALLBACK = 'Kairo';
const USAGE_MAX_AGE_MS = 2 * 60_000;
const STDIN_TIMEOUT_MS = 200;
const SHOWN_RUNNING = 2;

const percent = value => Number.isFinite(value) ? `${Math.round(Math.min(100, Math.max(0, value)))}%` : null;
const remaining = used => Number.isFinite(used) ? 100 - used : null;
const isText = value => typeof value === 'string' && value.trim() !== '';

async function readStdin(stdin = process.stdin) {
  if (stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function withTimeout(promise, ms, fallback) {
  let timer;
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms); timer.unref?.(); });
  return Promise.race([promise.catch(() => fallback), timeout]).finally(() => clearTimeout(timer));
}

function modelPart(input) {
  const model = input?.model?.display_name;
  if (!isText(model)) return null;
  const effort = input?.effort?.level;
  return isText(effort) ? `${model} (${effort})` : model;
}

/** Codex quota from Kairo's cached reads only: fresh usage cache first, then the routing input cache. */
async function codexWindows({ home, root, now }, deps) {
  const cached = await (deps.readCachedUsage ?? readCachedUsage)(home).catch(() => null);
  if (cached && now - cached.savedAt >= 0 && now - cached.savedAt <= USAGE_MAX_AGE_MS) {
    const windows = paceQuotaWindows(cached.value?.usage?.codex ?? {}, now);
    if (windows.length) return windows;
  }
  if (!root) return [];
  const routing = await (deps.readRoutingInputCache ?? readRoutingInputCache)(home, root).catch(() => null);
  const fresh = routing?.schema === ROUTING_INPUT_CACHE_SCHEMA && Number.isFinite(routing.generatedAt)
    && now - routing.generatedAt >= 0 && now - routing.generatedAt <= USAGE_MAX_AGE_MS;
  return fresh ? routing.providerCapacity?.codex?.quotaWindows ?? [] : [];
}

function windowPercent(windows, pattern) {
  const window = windows.find(w => pattern.test(w.kind ?? w.name ?? '') && Number.isFinite(w.remainingPercent));
  return window ? window.remainingPercent : null;
}

function runningPart(snapshot) {
  const items = (snapshot?.running ?? []).map(row => `${row.role} - ${row.modelId} - ${row.adapterId}`);
  if (!items.length) return null;
  const extra = items.length - SHOWN_RUNNING;
  return items.slice(0, SHOWN_RUNNING).join(', ') + (extra > 0 ? ` +${extra} more` : '');
}

async function projectRoot(cwd, deps) {
  try { return await (deps.resolveRoot ?? resolveProjectRoot)(cwd); }
  catch { return null; } // Outside a Git project there is no running-work ledger.
}

/** Builds the full line. Throws on any unexpected error so the caller can fail open. */
export async function buildStatuslineLine(input, deps = {}) {
  const home = deps.homeDir ?? resolveHomeDir();
  const now = (deps.now ?? Date.now)();
  const cwd = input?.workspace?.current_dir ?? input?.cwd ?? deps.cwd ?? process.cwd();
  const root = await projectRoot(cwd, deps);
  const claude = input?.rate_limits ?? {};
  const codex = await codexWindows({ home, root, now }, deps);
  const snapshot = root ? await (deps.readRunningLaunches ?? readRunningLaunches)(home, root, { now: () => now }).catch(() => null) : null;
  const fact = (label, value) => {
    const text = percent(value);
    return text ? `${label} ${text}` : null;
  };
  const codexFiveHour = windowPercent(codex, /5h|session/i);
  const codexWeek = windowPercent(codex, /week/i);
  const codexUnavailable = input && codexFiveHour === null && codexWeek === null
    ? 'Codex quota unavailable (missing or stale)' : null;
  const parts = [
    modelPart(input),
    fact('Context', input?.context_window?.remaining_percentage),
    fact('Claude 5h', remaining(claude.five_hour?.used_percentage)),
    fact('week', remaining(claude.seven_day?.used_percentage)),
    fact('Codex 5h', codexFiveHour),
    fact('week', codexWeek),
    codexUnavailable,
    runningPart(snapshot),
  ];
  return parts.filter(Boolean).join(' · ');
}

/** Entry point for `kairo statusline`. Always resolves with the printed line and never throws. */
export async function runStatuslineCli(options = {}, deps = {}) {
  const log = deps.log ?? console.log;
  const raw = await withTimeout(Promise.resolve().then(() => (deps.readStdin ?? readStdin)()), STDIN_TIMEOUT_MS, '');
  let input = null;
  try { input = JSON.parse(raw); } catch { input = null; }
  if (input === null || typeof input !== 'object') input = null;
  let line;
  try { line = (await buildStatuslineLine(input, { ...deps, cwd: options.cwd })) || FALLBACK; }
  catch { line = modelPart(input) ?? FALLBACK; }
  log(line);
  return line;
}
