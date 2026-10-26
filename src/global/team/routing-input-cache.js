// Persistent routing inputs: refreshed with model intelligence, consumed without
// constructing a service (and therefore without recovery or provider probes).
import { readUsageSamples } from '../observability/usage-samples.js';
import { launchLedgerPath, readExhaustionMarkers } from './launch-ledger.js';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { harnessHomePaths, resolveHomeDir } from '../paths.js';
import { projectKeyForPath } from '../next/project-key.js';
import { writeAtomicText } from '../runtime/write-atomic-json.js';
import { readProjectStrategy } from './project-strategy-store.js';
import { listRunRecords, runRecordsToLedger } from '../runtime/run-store.js';
import { resolveProjectRoot } from '../architect/architect-store.js';
import { createCapabilityRegistry } from '../intelligence/model-capability-registry.js';
import { loadProjectRoleCatalog, agentNameToRole, isGentleOwnedActor } from '../intelligence/role-catalog.js';
import { resolveProjectRoute } from './project-router.js';
import { tierBandPool } from '../intelligence/price-tier.js';
import { roleTier } from '../intelligence/role-demand.js';
import { withRoleCatalog } from '../intelligence/role-registry.js';

export const ROUTING_INPUT_CACHE_SCHEMA = 'kairo.routing-input-cache/v1';
export const ROUTING_INPUT_CACHE_TTL_MS = 30 * 60_000;

export function routingInputCachePath(homeDir, projectRoot) {
  return join(harnessHomePaths(homeDir).sessionsDir, projectKeyForPath(projectRoot), 'routing-input-cache.json');
}

export async function writeRoutingInputCache(homeDir, projectRoot, inputs, deps = {}) {
  const path = routingInputCachePath(homeDir, projectRoot);
  const registry = inputs.registry?.listIdentities
    ? inputs.registry.listIdentities().map(identity => ({ ...identity, evidence: inputs.registry.getEvidence(identity.id) }))
    : inputs.registry;
  const doc = { ...inputs, registry, schema: ROUTING_INPUT_CACHE_SCHEMA };
  await (deps.mkdir ?? mkdir)(dirname(path), { recursive: true });
  await (deps.writeAtomicText ?? writeAtomicText)(path, `${JSON.stringify(doc)}\n`);
  return doc;
}

/** Shared persisted inputs used by routing and account pacing. */
export async function readRoutingInputCache(homeDir, projectRoot) {
  try { return JSON.parse(await readFile(routingInputCachePath(homeDir, projectRoot), 'utf8')); }
  catch { return null; }
}

export async function refreshRoutingInputs({ homeDir, cwd }, deps = {}) {
  const service = deps.service ?? (await import('./service.js')).createConversationService({ homeDir });
  return service.refreshRoutingInputs({ cwd });
}

function routeError(code, message) { return Object.assign(new Error(message), { code }); }
function approvedRole(strategy, role) {
  if (strategy?.status !== 'active' || !strategy.projectTeam?.length) {
    throw routeError('no_approved_team', 'No approved team for this project. Analyze and approve a project team first.');
  }
  const entry = strategy.projectTeam.find(entry => entry.role === role && entry.model);
  if (!entry) throw routeError('unknown_role', `Unknown role "${role ?? ''}" in the approved team.`);
  return entry;
}
export function routeErrorJson(error) {
  return { decision: 'ERROR', code: error.code ?? 'route_failed', message: error.message };
}

/** Account samples must see every recorded project role, not only the routed
 * role. Keep distribution's role filtering separate from cost attribution.
 */
export async function readRoutingLaunchLedger(homeDir, projectRoot) {
  let text;
  try { text = await readFile(launchLedgerPath(homeDir, projectRoot), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  return text.split('\n').flatMap(line => {
    let row;
    try { row = JSON.parse(line); } catch { return []; }
    if (row?.source !== 'launch' || typeof row.role !== 'string' || !row.role
      || typeof row.adapterId !== 'string' || !row.adapterId
      || typeof row.modelId !== 'string' || !row.modelId || !Number.isFinite(Date.parse(row.at))) return [];
    return [{ adapterId: row.adapterId, modelId: row.modelId, role: row.role,
      status: 'completed', at: Date.parse(row.at) }];
  });
}

/** Enrich count-only ledger entries without changing distribution history.
 * Other roles/projects remain visible to reject overlapping account usage.
 */
export async function readTaskAdmissionInputs(homeDir, records, launches, providers, now, deps = {}) {
  const samples = (await Promise.all([...new Set(providers)].map(provider =>
    (deps.readUsageSamples ?? readUsageSamples)(homeDir, provider, { now: () => now })))).flat();
  const admissionLedger = [...records.map(run => ({ adapterId: run.agentId ?? run.provider,
    modelId: run.model?.replace(/^opencode(-go)?\//, ''), role: run.role,
    status: run.state, at: Date.parse(run.startedAt), endAt: Date.parse(run.completedAt) })), ...launches];
  const markers = deps.projectRoot ? await readExhaustionMarkers(homeDir, deps.projectRoot, { now: () => now }) : {};
  const providerCapacity = Object.fromEntries(Object.entries(deps.providerCapacity ?? {}).map(([provider, value]) =>
    [provider, markers[provider] ? { ...value, quotaRemainingPercent: 0, exhaustion: markers[provider] } : value]));
  for (const [provider, marker] of Object.entries(markers)) {
    providerCapacity[provider] = { ...providerCapacity[provider], quotaRemainingPercent: 0, exhaustion: marker };
    // Marker evidence activates admission even without observed quota samples.
    // No window or remainder: this cannot become a measured task-cost sample.
    samples.push({ provider, exhaustion: marker });
  }
  return { samples, admissionLedger, ...(deps.providerCapacity ? { providerCapacity, capacity: providerCapacity } : {}) };
}

/** Only local strategy, routing cache, run-store and launch-ledger reads; never recovers runs. */
export async function readTeamRoute({ role, agent, provider, cwd, homeDir = resolveHomeDir() }, deps = {}) {
  // Return before reading strategy/cache: even unconfigured projects must leave
  // provider-bound review actors unchanged.
  if (isGentleOwnedActor(agent) || isGentleOwnedActor(role)) return {
    decision: 'NOT_ROUTED', role: role ?? agent, provider: null, model: null,
    agentName: null, targetAgent: null, targetModel: null, why: 'owned by gentle-ai'
  };
  const projectRoot = await (deps.resolveRoot ?? resolveProjectRoot)(cwd);
  const catalog = loadProjectRoleCatalog({ projectRoot });
  let names;
  if (agent !== undefined && agent !== null) {
    names = agentNameToRole(catalog);
    const resolvedRole = names.byAgent.get(agent);
    if (!resolvedRole) throw routeError('unknown_agent', `Unknown agent "${agent}" in the project role catalog.`);
    if (role && role !== resolvedRole) throw routeError('agent_role_mismatch', `Agent "${agent}" belongs to role "${resolvedRole}", not "${role}".`);
    if (isGentleOwnedActor(resolvedRole)) return {
      decision: 'NOT_ROUTED', role: resolvedRole, provider: null, model: null,
      agentName: null, targetAgent: null, targetModel: null, why: 'owned by gentle-ai'
    };
    role = resolvedRole;
  }
  const strategy = await (deps.readProjectStrategy ?? readProjectStrategy)(homeDir, projectRoot);
  // Work aliases follow their base when only that base was approved. A split
  // builder team supplies the generic Builder launch from its first approved
  // implementation role; exact approved assignments always take precedence.
  const requestedRole = role;
  const hasPick = id => strategy?.projectTeam?.some(entry => entry.role === id && entry.model);
  if (!hasPick(role)) {
    const base = catalog.registry[role]?.sourceRole ?? catalog.registry[role]?.extendsRole;
    if (base && hasPick(base)) role = base;
    else if (role === 'Builder' || base === 'Builder') {
      role = strategy?.projectTeam?.find(entry => ['Backend Builder', 'Frontend Builder'].includes(entry.role) && entry.model)?.role ?? role;
    }
  }
  const entry = approvedRole(strategy, role);
  const cache = await readRoutingInputCache(homeDir, projectRoot);
  const now = (deps.now ?? Date.now)();
  const stale = cache?.schema !== ROUTING_INPUT_CACHE_SCHEMA
    || !Number.isFinite(cache.generatedAt) || cache.generatedAt > now
    || now - cache.generatedAt > ROUTING_INPUT_CACHE_TTL_MS
    || !strategy.approvedAt || cache.approvedAt !== strategy.approvedAt
    || !Array.isArray(cache.roles?.[role]?.pool)
    || !cache.eligibility || !cache.modelEntitlement || !cache.providerCapacity;
  let route;
  let bandNote = null;
  if (stale) {
    if (provider) throw routeError('stale_forced_route', 'Refresh routing inputs before selecting a provider.');
    route = { decision: 'STALE', role, provider: entry.model.adapterId, model: entry.model,
      assignmentSource: entry.assignmentSource ?? null, strategyFingerprint: strategy.profileFingerprint ?? null,
      blockedAssignment: null, suggestedAlternative: null,
      why: 'Routing inputs are missing, stale, or from a different approval. Run kairo team route --refresh.' };
  } else {
    const records = await (deps.listRunRecords ?? listRunRecords)(homeDir);
    // A cache written before price bands holds the role's whole floor-qualified pool; band it here too.
    const band = tierBandPool(cache.roles[role].pool, (cache.models ?? []).filter(row => cache.eligibility[row.adapterId]?.ok === true),
      withRoleCatalog(catalog, () => roleTier(role)));
    bandNote = band.note;
    const pool = band.pool.filter(row => !provider || row.adapterId === provider);
    if (provider && !pool.length) throw routeError('unqualified_provider', `No qualified ${provider} model for ${role}.`);
    if (provider && (cache.providerCapacity[provider]?.exhaustion || cache.providerCapacity[provider]?.quotaRemainingPercent === 0)) {
      throw routeError('exhausted_provider', `${provider} has no quota available.`);
    }
    // Temporary launch constraint only; never rewrite the approved team. Keep
    // every admission, entitlement and eligibility gate in the shared resolver.
    const constrainedStrategy = provider ? { ...strategy, projectTeam: strategy.projectTeam.map(row =>
      row.role === role ? { ...row, model: pool[0], fallback: null } : row) } : strategy;
    const registry = createCapabilityRegistry();
    for (const identity of cache.registry ?? []) {
      const id = registry.registerIdentity(identity.adapterId, identity.modelId, identity.displayName);
      for (const entry of identity.evidence) registry.addEvidence(id, entry);
    }
    const launches = await readRoutingLaunchLedger(homeDir, projectRoot);
    const admission = await readTaskAdmissionInputs(homeDir, records, launches, pool.map(row => row.adapterId), now, { ...deps, projectRoot, providerCapacity: cache.providerCapacity });
    route = resolveProjectRoute({ role, strategy: constrainedStrategy, eligibility: cache.eligibility,
      modelEntitlement: cache.modelEntitlement, providerCapacity: cache.providerCapacity,
      models: provider ? pool : cache.models ?? [], registry,
      ...((provider || pool.length || admission.samples.length) ? { pool, ledger: [...runRecordsToLedger(records, { projectRoot, role }), ...launches.filter(row => row.role === role)], capacity: cache.providerCapacity, now, ...admission } : {}) });
  }
  if (bandNote) route = { ...route, why: `${route.why} ${bandNote}` };
  if (provider && route.provider !== provider) throw routeError('provider_unavailable', `No launchable ${provider} route for ${role}.`);
  return { ...route, ...(requestedRole !== role ? { requestedRole } : {}), agentName: route.provider ? `team-${role.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${route.provider}` : null,
    ...(names ? { targetAgent: names.byRole.get(role)?.get(route.provider) ?? null, targetModel: route.model?.modelId ?? null } : {}) };
}

export async function runTeamRouteCli(options, deps = {}) {
  const homeDir = deps.homeDir ?? resolveHomeDir();
  const log = deps.log ?? console.log;
  try {
    let result;
    if (options.refresh) {
      result = await refreshRoutingInputs({ homeDir, cwd: options.cwd }, deps);
    } else {
      if (!options.role && !options.agent) throw routeError('missing_role', 'Missing --role or --agent. Use kairo team route --role ROLE_ID, --agent NAME, or --refresh.');
      result = await readTeamRoute({ role: options.role, agent: options.agent, provider: options.provider, cwd: options.cwd, homeDir });
    }
    log(options.json ? JSON.stringify(result) : result.why ?? 'Routing inputs refreshed.');
    return result;
  } catch (error) {
    if (options.json) log(JSON.stringify(routeErrorJson(error)));
    else log(error.message);
    process.exitCode = 1;
    return null;
  }
}
