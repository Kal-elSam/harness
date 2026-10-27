import { decideLaunchModel, isManualSource } from './gentle-shell-selector.js';
import { readTeamRoutes } from '../team/routing-input-cache.js';
import { agentNameToRole, loadProjectRoleCatalog } from '../intelligence/role-catalog.js';
import { resolveProjectRoot } from '../architect/architect-store.js';

export const MODEL_ROUTES_READ_EVENT = 'gentle-shell:model-routes:read/v1';
export const MODEL_SELECTION_EVENT = 'gentle-shell:model-selection:select/v1';
const SNAPSHOT_SCHEMA = 'gentle-shell.model-routes/v1';
const KINDS = ['ordinary', 'review'];
const UI_KEY = 'kairo-team';
const PANEL_MAX_LINES = 10;
const JD_AGENTS = ['jd-judge-a', 'jd-judge-b', 'jd-fix-agent'];
const panelKey = index => `${UI_KEY}-${String(index).padStart(2, '0')}`;
const shortAgent = agent => agent.replace(/^gentle-ai-/, '');
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

function assignmentTable(result, decide = () => null) {
  const lines = [`Kairo: Gentle Shell assignment snapshot at prompt start — informational only (${result.state}).`,
    'Assignments do not prove executable routing, authentication, quota, or permission to change models.',
    '| Agent | Model | Kairo | Effort | Source | State |', '| --- | --- | --- | --- | --- | --- |'];
  for (const kind of KINDS) {
    const scope = result[kind];
    if (!scope) continue;
    for (const row of scope.routes) {
      const model = row.model ?? (row.inherited ? 'Inherited (unobserved)' : 'Unconfigured');
      const decision = decide(row);
      const kairo = decision ? decision.model ?? `none (${decision.reason})` : 'n/a';
      lines.push(`| ${[row.agent, model, kairo, row.thinking ?? 'Unknown', row.source, row.state].map(cell).join(' | ')} |`);
    }
    if (scope.errorCount) lines.push(`${kind}: ${scope.errorCount} discovery warning(s); details withheld.`);
  }
  const missing = KINDS.filter(kind => !result[kind]);
  if (missing.length) lines.push(`Unavailable assignment scopes: ${missing.join(', ')}.`);
  return lines;
}

/** Per-role admitted candidates and agent-to-role names; any failure means no snapshot. */
export async function buildSelectionSnapshot(cwd) {
  try {
    const { routes } = await readTeamRoutes({ cwd });
    const catalog = loadProjectRoleCatalog({ projectRoot: await resolveProjectRoot(cwd) });
    const roles = {};
    for (const route of routes) {
      if (!route?.role || route.decision === 'ERROR') continue;
      const rows = route.admission?.candidates ?? [];
      const candidates = rows.map(row => ({ provider: row.provider, modelId: row.modelId, admitted: row.admitted === true }));
      const current = route.model?.modelId;
      if (current && !candidates.some(item => item.modelId === current && item.provider === route.provider)) {
        candidates.unshift({ provider: route.provider, modelId: current, admitted: !route.admission });
      }
      roles[route.role] = { candidates };
    }
    const agents = {};
    for (const [name, role] of agentNameToRole(catalog).byAgent) {
      const entry = catalog.registry[role];
      const routed = [role, entry?.sourceRole, entry?.extendsRole].find(id => id && roles[id]);
      if (routed) agents[name] = routed;
    }
    return { roles, agents };
  } catch {
    return null;
  }
}

/** Compact one-line panel entries: the header, one line per agent, then notices, capped. */
function panelLines(result, decide, judgeShared) {
  const lines = [`Kairo · team (${result.state})`];
  const seen = new Set();
  const rows = [...(result.ordinary?.routes ?? [])];
  for (const row of rows) seen.add(row.agent);
  for (const agent of JD_AGENTS) if (!seen.has(agent)) rows.push({ agent, model: null, source: null });
  for (const row of rows) {
    const decision = decide(row);
    const name = shortAgent(row.agent);
    if (decision?.model) lines.push(`${name} → ${modelIdOf(decision.model)}`);
    else if (decision?.reason === 'manual-kept' || decision?.reason === 'manual-judgment-day' || (row.model && isManualSource(row.source))) {
      lines.push(`${name} · manual ${row.model ? modelIdOf(row.model) : 'model'}`);
    } else lines.push(`${name} · ${row.model ? modelIdOf(row.model) : 'inherit'} (${decision?.reason ?? 'no-snapshot'})`);
  }
  if (result.review) lines.push('review lenses · gentle-ai');
  if (judgeShared) lines.push('judges share one provider; no independent model');
  if (lines.length <= PANEL_MAX_LINES) return lines;
  return [...lines.slice(0, PANEL_MAX_LINES - 1), `… +${lines.length - (PANEL_MAX_LINES - 1)} more`];
}

/** Load alongside the patched host; this module does not install or launch anything. */
export default function register(pi, env = process.env, deps = {}) {
  if (env.GENTLE_PI_AGENTS_CHILD === '1') return;
  const build = deps.buildSnapshot ?? buildSelectionSnapshot;
  let state = null; // { sessionId, cwd, snapshot, ctx }
  let lastJudgeReason = null;
  let usedKeys = new Set();
  const judgeReason = () => {
    if (!state?.snapshot) return null;
    const registryModels = registryOf(state.ctx);
    return decideLaunchModel({ request: { agent: 'jd-judge-a', model: null, source: null }, snapshot: state.snapshot, registryModels }).reason;
  };
  let unsubscribe = null;
  try {
    unsubscribe = pi.events.on?.(MODEL_SELECTION_EVENT, request => {
      try {
        if (!state?.snapshot || typeof request?.respond !== 'function'
          || request.sessionId !== state.sessionId || request.cwd !== state.cwd) return;
        const decision = decideLaunchModel({ request, snapshot: state.snapshot, registryModels: registryOf(state.ctx) });
        if (request.agent === 'jd-judge-a' || request.agent === 'jd-judge-b') lastJudgeReason = decision.reason;
        if (decision.model) request.respond({ model: decision.model });
      } catch { /* A selector failure must never block a launch. */ }
    });
  } catch { unsubscribe = null; }
  // Reads the route snapshot, arms the selector and paints the panel; shared by session_start and each prompt.
  const refresh = async ctx => {
    const result = readModelRouteSnapshots(pi, ctx);
    const sessionId = ctx.sessionManager?.getSessionId?.();
    const cwd = ctx.sessionManager?.getCwd?.() ?? ctx.cwd;
    const snapshot = safeText(sessionId) && safeText(cwd) ? await build(cwd) : null;
    state = snapshot ? { sessionId, cwd, snapshot, ctx } : null;
    const decide = row => {
      if (!state?.snapshot) return null;
      try {
        return decideLaunchModel({ request: { agent: row.agent, model: row.model ?? null, source: row.source ?? null }, snapshot: state.snapshot, registryModels: registryOf(ctx) });
      } catch { return null; }
    };
    const lines = assignmentTable(result, decide);
    const judgeShared = Boolean(state && (lastJudgeReason === 'judges-share-provider' || judgeReason() === 'judges-share-provider'));
    if (judgeShared) lines.push('Kairo: both Judgment Day judges would run on the same provider; no independent model is admitted.');
    if (ctx.hasUI) {
      try {
        const panel = panelLines(result, decide, judgeShared);
        ctx.ui.setWidget(UI_KEY, undefined);
        ctx.ui.setStatus(UI_KEY, undefined);
        const next = new Set(panel.map((_, index) => panelKey(index)));
        for (const key of usedKeys) if (!next.has(key)) ctx.ui.setStatus(key, undefined);
        panel.forEach((text, index) => ctx.ui.setStatus(panelKey(index), text));
        usedKeys = next;
      } catch { /* Cosmetic UI failure must not block the prompt. */ }
    }
    return lines;
  };
  pi.on('session_start', async (_event, ctx) => {
    try { await refresh(ctx); } catch { /* The panel is cosmetic; a failure must not block the session. */ }
  });
  pi.on('before_agent_start', async (_event, ctx) => {
    const lines = await refresh(ctx);
    return { message: { customType: 'kairo.gentle-shell-team', content: lines.join('\n'), display: false } };
  });
  pi.on('session_shutdown', (_event, ctx) => {
    state = null;
    try { unsubscribe?.(); } catch { /* Already detached. */ }
    unsubscribe = null;
    if (!ctx.hasUI) return;
    try {
      ctx.ui.setWidget(UI_KEY, undefined);
      ctx.ui.setStatus(UI_KEY, undefined);
      for (const key of usedKeys) ctx.ui.setStatus(key, undefined);
      usedKeys = new Set();
    } catch { /* A missing UI during shutdown needs no recovery. */ }
  });
}

/** The Status column is narrow: show the model id without its provider prefix. */
function modelIdOf(model) {
  const slash = model.indexOf('/');
  return slash < 0 ? model : model.slice(slash + 1);
}

/**
 * Authenticated models first: getAll() also lists every built-in provider without
 * credentials, so the same id appears under several providers and never maps uniquely.
 */
function registryOf(ctx) {
  try {
    const available = [...(ctx?.modelRegistry?.getAvailable?.() ?? [])];
    if (available.length) return available;
  } catch { /* Fall back to the full catalog. */ }
  try { return [...(ctx?.modelRegistry?.getAll?.() ?? [])]; } catch { return []; }
}
