// Additive hierarchy and presentation for the public routes command.
import { ROLE_REGISTRY } from '../intelligence/role-registry.js';

export const sessionOrchestrator = () => ({ role: 'Master Orchestrator', model: 'session model', permission: 'read-only' });

/** Cell leaders are the registry's decision seats, not every analysis/review seat. */
export function routeSeat(role, proposal, registry = ROLE_REGISTRY) {
  const seat = proposal?.seats?.find(entry => entry.role === role);
  const entry = registry[role] ?? registry[seat?.extends];
  const proposed = proposal?.cells?.find(cell => cell.seats?.includes(role));
  const id = proposed?.id ?? entry?.cell;
  const name = proposed?.name ?? (id ? id[0].toUpperCase() + id.slice(1) : null);
  const lead = entry?.class === 'coordination' || entry?.class === 'verification'
    || (entry?.class === 'analysis' && entry?.cell === 'design');
  return { cell: id ? { id, name } : null, seatKind: lead ? 'lead' : 'worker' };
}

/** Group only for display: JSON rows and routing fingerprints retain their order. */
export function renderTeamRoutesTree(plan) {
  const lines = [`${plan.orchestrator.role} (${plan.orchestrator.model})`];
  const cells = new Map();
  const other = [];
  for (const row of plan.rows) {
    if (!row.cell) { other.push(row); continue; }
    if (!cells.has(row.cell.id)) cells.set(row.cell.id, { name: row.cell.name, rows: [] });
    cells.get(row.cell.id).rows.push(row);
  }
  const renderRow = row => `  ${row.role} | ${row.displayName || row.modelId || 'unknown'} (${row.provider || 'unknown'}) | ${row.decision}${row.waitUntil ? ` until ${row.waitUntil}` : ''}`;
  for (const cell of cells.values()) {
    lines.push(cell.name);
    for (const kind of ['lead', 'worker']) for (const row of cell.rows) if (row.seatKind === kind) lines.push(renderRow(row));
  }
  if (other.length) lines.push('Other', ...other.map(renderRow));
  return lines.join('\n');
}

export async function runTeamRoutesCli(options, deps = {}) {
  const log = deps.log ?? console.log;
  try {
    const { readTeamRoutes } = await import('./routing-input-cache.js');
    const { routeRow, routesFingerprint } = await import('./team-plan.js');
    const { status, routes, orchestrator } = await readTeamRoutes({ cwd: options.cwd, homeDir: deps.homeDir }, deps);
    const rows = routes.map(route => ({ ...routeRow(route), cell: route.cell, seatKind: route.seatKind }));
    const plan = { status, rows, fingerprint: routesFingerprint(rows), orchestrator };
    log(options.json ? JSON.stringify(plan) : rows.length ? renderTeamRoutesTree(plan) : 'No approved team for this project.');
    return plan;
  } catch (error) {
    const result = { ok: false, action: 'routes', code: error.code ?? 'routes_failed', error: error.message };
    log(options.json ? JSON.stringify(result) : error.message);
    process.exitCode = 1;
    return result;
  }
}
