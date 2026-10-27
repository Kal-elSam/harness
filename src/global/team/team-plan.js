// Read-only table of the approved team's current routes (kairo team routes).
import { createHash } from 'node:crypto';
import { resolveHomeDir } from '../paths.js';
import { readTeamRoutes } from './routing-input-cache.js';

const isoOrNull = value => Number.isFinite(value) ? new Date(value).toISOString() : null;

export function routeRow(route) {
  return { role: route.role, provider: route.provider ?? null, modelId: route.model?.modelId ?? null,
    displayName: route.model?.displayName ?? null, decision: route.decision,
    waitUntil: isoOrNull(route.admission?.waitUntil), why: route.why ?? route.message ?? '' };
}

/** Changes only when a role, provider, model, decision or waitUntil changes (never `why`). */
export function routesFingerprint(rows) {
  const stable = rows.map(({ role, provider, modelId, decision, waitUntil }) => [role, provider, modelId, decision, waitUntil]);
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 16);
}

export async function buildTeamRoutesPlan(options, deps = {}) {
  const { status, routes } = await readTeamRoutes({ cwd: options.cwd, homeDir: deps.homeDir ?? resolveHomeDir() }, deps);
  const rows = routes.map(routeRow);
  return { status, rows, fingerprint: routesFingerprint(rows) };
}

export async function runTeamRoutesCli(options, deps = {}) {
  const log = deps.log ?? console.log;
  try {
    const plan = await buildTeamRoutesPlan(options, deps);
    if (options.json) log(JSON.stringify(plan));
    else if (!plan.rows.length) log('No approved team for this project.');
    else for (const row of plan.rows) {
      log(`${row.role}  ${row.provider ?? '-'}  ${row.modelId ?? '-'}  ${row.decision}${row.waitUntil ? `  until ${row.waitUntil}` : ''}`);
    }
    return plan;
  } catch (error) {
    const result = { ok: false, action: 'routes', code: error.code ?? 'routes_failed', error: error.message };
    log(options.json ? JSON.stringify(result) : error.message);
    process.exitCode = 1;
    return result;
  }
}
