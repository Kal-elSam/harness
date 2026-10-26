// `kairo statusline`: Claude Code status line. Reads the status JSON on stdin,
// prints one line and fails open. Stale quota refreshes detached using pacing's
// shared lock; last values remain visible for <30 minutes, only before reset.
import { resolveHomeDir } from '../paths.js';
import { resolveProjectRoot } from '../architect/architect-store.js';
import { readRunningLaunches } from './launch-ledger.js';
import { readCachedUsage } from '../host/workspace-cache.js';
import { readRoutingInputCache, ROUTING_INPUT_CACHE_SCHEMA } from './routing-input-cache.js';
import { startBackgroundRefresh } from './background-refresh.js';
import { paceQuotaWindows } from '../intelligence/quota-pacing.js';

const FALLBACK = 'Kairo';
const USAGE_MAX_AGE_MS = 2 * 60_000;
const STALE_MAX_AGE_MS = 30 * 60_000;
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

/** Prefer fresh usage, then fresh routing, then the newest safe stale snapshot. */
async function codexWindows({ home, root, now, refresh }, deps) {
  const candidate = (windows, at) => {
    const age = now - at;
    if (!Number.isFinite(at) || age < 0 || age >= STALE_MAX_AGE_MS) return null;
    const stale = age > USAGE_MAX_AGE_MS;
    const usable = (Array.isArray(windows) ? windows : []).filter(w => w
      && /5h|session|week/i.test(w.kind ?? w.name ?? '') && Number.isFinite(w.remainingPercent)
      && (!stale || Date.parse(w.resetsAtIso) > now));
    return usable.length ? { windows: usable, age, stale } : null;
  };
  const cached = await (deps.readCachedUsage ?? readCachedUsage)(home).catch(() => null);
  // Normalize at observation time, not now: human-readable reset dates must not roll forward.
  const usage = candidate(paceQuotaWindows(cached?.value?.usage?.codex ?? {}, cached?.savedAt ?? now), cached?.savedAt);
  if (usage && !usage.stale) return usage;
  const routing = root
    ? await (deps.readRoutingInputCache ?? readRoutingInputCache)(home, root).catch(() => null) : null;
  const routed = routing?.schema === ROUTING_INPUT_CACHE_SCHEMA
    ? candidate(routing.providerCapacity?.codex?.quotaWindows, routing.generatedAt) : null;
  if (routed && !routed.stale) return routed;
  if (root && refresh) {
    // Never await startup or provider I/O; synchronous throws and rejections fail open.
    void Promise.resolve().then(() => (deps.startBackgroundRefresh ?? startBackgroundRefresh)({
      homeDir: home, projectRoot: root,
    })).catch(() => {});
  }
  return [usage, routed].filter(Boolean).sort((a, b) => a.age - b.age)[0]
    ?? { windows: [], age: 0, stale: false };
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
  const codex = await codexWindows({ home, root, now, refresh: Boolean(input) }, deps);
  const snapshot = root ? await (deps.readRunningLaunches ?? readRunningLaunches)(home, root, { now: () => now }).catch(() => null) : null;
  const fact = (label, value) => {
    const text = percent(value);
    return text ? `${label} ${text}` : null;
  };
  const codexFiveHour = windowPercent(codex.windows, /5h|session/i);
  const codexWeek = windowPercent(codex.windows, /week/i);
  const codexUnavailable = input && codexFiveHour === null && codexWeek === null
    ? 'Codex quota unavailable (missing or stale)' : null;
  const codexPart = [fact('Codex 5h', codexFiveHour), fact('week', codexWeek)].filter(Boolean).join(' · ');
  const parts = [
    modelPart(input),
    fact('Context', input?.context_window?.remaining_percentage),
    fact('Claude 5h', remaining(claude.five_hour?.used_percentage)),
    fact('week', remaining(claude.seven_day?.used_percentage)),
    codexPart ? codexPart + (codex.stale ? ` (${Math.floor(codex.age / 60_000)}m ago)` : '') : null,
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
