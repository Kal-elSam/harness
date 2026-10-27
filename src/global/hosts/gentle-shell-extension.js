export const MODEL_ROUTES_READ_EVENT = 'gentle-shell:model-routes:read/v1';
const SNAPSHOT_SCHEMA = 'gentle-shell.model-routes/v1';
const KINDS = ['ordinary', 'review'];
const UI_KEY = 'kairo-team';
const safeText = value => typeof value === 'string' && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value);

function validateSnapshot(value, sessionId) {
  if (!value || value.schema !== SNAPSHOT_SCHEMA || !KINDS.includes(value.kind) || value.sessionId !== sessionId || !Array.isArray(value.routes)) return null;
  const names = new Set();
  const routes = [];
  for (const row of value.routes) {
    if (!row || !safeText(row.agent) || names.has(row.agent) || !safeText(row.source)) return null;
    if (row.model !== null && !safeText(row.model)) return null;
    if (row.thinking !== null && !safeText(row.thinking)) return null;
    const inherited = value.kind === 'ordinary' && row.model === null;
    const expectedState = row.model !== null ? 'resolved' : inherited ? 'inherited-unobserved' : 'unconfigured';
    if (row.inherited !== inherited || row.state !== expectedState) return null;
    names.add(row.agent);
    routes.push({ agent: row.agent, model: row.model, thinking: row.thinking, source: row.source, inherited, state: expectedState });
  }
  const errors = value.errors ?? [];
  if (!Array.isArray(errors) || !errors.every(error => typeof error === 'string')) return null;
  return { kind: value.kind, sessionId, routes, errorCount: errors.length };
}

/** A same-process synchronous read, never a route, reservation, or cached tool result. */
export function readModelRouteSnapshots(pi, ctx) {
  const empty = () => ({ state: 'unavailable', ordinary: null, review: null });
  const sessionId = ctx.sessionManager?.getSessionId?.();
  const cwd = ctx.sessionManager?.getCwd?.() ?? ctx.cwd;
  if (!safeText(sessionId) || !safeText(cwd)) return empty();
  const scopes = { ordinary: null, review: null };
  const counts = { ordinary: 0, review: 0 };
  let closed = false;
  try {
    pi.events.emit(MODEL_ROUTES_READ_EVENT, { sessionId, cwd, respond(value) {
      if (closed || !KINDS.includes(value?.kind)) return;
      const kind = value.kind;
      counts[kind]++;
      scopes[kind] = counts[kind] === 1 ? validateSnapshot(value, sessionId) : null;
    } });
  } catch {
    return empty();
  } finally {
    closed = true;
  }
  if (ctx.sessionManager?.getSessionId?.() !== sessionId || (ctx.sessionManager?.getCwd?.() ?? ctx.cwd) !== cwd) return empty();
  const available = KINDS.filter(kind => scopes[kind]);
  const state = available.length === 0 ? 'unavailable' : available.length < 2 || available.some(kind => scopes[kind].errorCount > 0) ? 'partial' : 'available';
  return { state, ...scopes };
}

function cell(value) {
  return String(value).replace(/[\\|`]/g, '\\$&').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function assignmentTable(result) {
  const lines = [`Kairo: Gentle Shell assignment snapshot at prompt start — informational only (${result.state}).`,
    'Assignments do not prove executable routing, authentication, quota, or permission to change models.',
    '| Agent | Model | Effort | Source | State |', '| --- | --- | --- | --- | --- |'];
  for (const kind of KINDS) {
    const scope = result[kind];
    if (!scope) continue;
    for (const row of scope.routes) {
      const model = row.model ?? (row.inherited ? 'Inherited (unobserved)' : 'Unconfigured');
      lines.push(`| ${[row.agent, model, row.thinking ?? 'Unknown', row.source, row.state].map(cell).join(' | ')} |`);
    }
    if (scope.errorCount) lines.push(`${kind}: ${scope.errorCount} discovery warning(s); details withheld.`);
  }
  const missing = KINDS.filter(kind => !result[kind]);
  if (missing.length) lines.push(`Unavailable assignment scopes: ${missing.join(', ')}.`);
  return lines;
}

/** Load alongside the patched host; this module does not install or launch anything. */
export default function register(pi, env = process.env) {
  if (env.GENTLE_PI_AGENTS_CHILD === '1') return;
  pi.on('before_agent_start', (_event, ctx) => {
    const result = readModelRouteSnapshots(pi, ctx);
    const lines = assignmentTable(result);
    if (ctx.hasUI) {
      try {
        ctx.ui.setWidget(UI_KEY, lines);
        ctx.ui.setStatus(UI_KEY, `Kairo · assignment snapshot: ${result.state}`);
      } catch { /* Cosmetic UI failure must not block the prompt. */ }
    }
    return { message: { customType: 'kairo.gentle-shell-team', content: lines.join('\n'), display: false } };
  });
  pi.on('session_shutdown', (_event, ctx) => {
    if (!ctx.hasUI) return;
    try {
      ctx.ui.setWidget(UI_KEY, undefined);
      ctx.ui.setStatus(UI_KEY, undefined);
    } catch { /* A missing UI during shutdown needs no recovery. */ }
  });
}
