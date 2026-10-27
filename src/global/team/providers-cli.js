import { createProviderConnections } from '../provider-connections/service.js';
import { PROVIDER_IDS } from '../provider-connections/allowlist.js';
import { resolveHomeDir } from '../paths.js';
import { resolveTeamProviders, resolveTeamProvidersWithSource, saveGlobalTeamProviders, KNOWN_TEAM_PROVIDER_IDS } from '../profile.js';
import { resolveProjectRoot } from '../architect/architect-store.js';

function inventoryRow(provider, teamProviders) {
  const configured = teamProviders.includes(provider.providerId);
  const installed = provider.installation?.state === 'installed';
  const authenticated = provider.authentication?.state === 'authenticated';
  // Pool-level access evidence is not a model catalog. Catalog presence is
  // independent of per-model entitlement (catalogued does not mean allowed).
  const ids = (provider.modelAccess?.models ?? [])
    .filter(model => model.scope !== 'pool' && typeof model.modelId === 'string' && model.modelId.trim())
    .map(model => model.modelId);
  const models = ids.length ? [...new Set(ids)] : 'unknown';
  const quota = provider.quota;
  const remainingPercent = Number.isFinite(quota?.remainingPercent) ? quota.remainingPercent : 'unknown';
  const reason = !configured ? 'not_configured'
    : !installed ? 'not_installed'
    : !authenticated ? 'not_authenticated'
      : quota?.state === 'exhausted' ? 'quota_exhausted'
        : quota?.state !== 'available' ? 'no_quota_data'
          : models === 'unknown' ? 'catalog_unknown' : null;
  return { providerId: provider.providerId, configured, installed, authenticated, models,
    remainingPercent, available: reason === null, ...(reason ? { reason } : {}) };
}

/** --enable ID / --disable ID: update the global profile's teamProviders and print the result. */
async function changeTeamProviders(options, deps) {
  const homeDir = deps.homeDir ?? resolveHomeDir();
  const workspaceRoot = await (deps.resolveRoot ?? resolveProjectRoot)(options.cwd).catch(() => undefined);
  const effective = await resolveTeamProvidersWithSource({ homeDir, workspaceRoot });
  if (effective.source === 'project') {
    throw new Error(`The project profile ${effective.path} sets teamProviders (${effective.teamProviders.join(', ')}) and overrides the global profile. Edit that file instead.`);
  }
  const next = [...effective.teamProviders];
  for (const [flag, id] of [['enable', options.enable], ['disable', options.disable]]) {
    if (id == null) continue;
    if (!KNOWN_TEAM_PROVIDER_IDS.includes(id)) {
      throw new Error(`Unknown provider "${id}" in teamProviders. Use ${KNOWN_TEAM_PROVIDER_IDS.join(', ')}.`);
    }
    if (flag === 'enable' && !next.includes(id)) next.push(id);
    if (flag === 'disable' && next.includes(id)) next.splice(next.indexOf(id), 1);
  }
  await saveGlobalTeamProviders(homeDir, next);
  const result = { teamProviders: next };
  const log = deps.log ?? console.log;
  if (options.json) log(JSON.stringify(result));
  else log(`teamProviders=${next.join(',')}`);
  return result;
}

/** Read-only inventory: version/auth checks, catalog RPC and cached quota only. --enable/--disable edit the profile. */
export async function runTeamProvidersCli(options = {}, deps = {}) {
  if (options.enable != null || options.disable != null) return changeTeamProviders(options, deps);
  const teamProviders = deps.teamProviders
    ?? await resolveTeamProviders({
      homeDir: deps.homeDir ?? resolveHomeDir(),
      workspaceRoot: await (deps.resolveRoot ?? resolveProjectRoot)(options.cwd).catch(() => undefined)
    });
  const status = deps.status ?? createProviderConnections({
    homeDir: deps.homeDir, cacheDeps: { ...deps.cacheDeps, cwd: options.cwd }
  }).status;
  const snapshot = await status({ providerIds: [...PROVIDER_IDS] });
  const result = { providers: snapshot.providers.map(provider => inventoryRow(provider, teamProviders)) };
  const log = deps.log ?? console.log;
  if (options.json) log(JSON.stringify(result));
  else for (const row of result.providers) {
    log(`${row.providerId} configured=${row.configured} installed=${row.installed} authenticated=${row.authenticated} models=${Array.isArray(row.models) ? row.models.join(',') : row.models} quota=${row.remainingPercent === 'unknown' ? 'unknown' : `${row.remainingPercent}%`} available=${row.available}${row.reason ? ` reason=${row.reason}` : ''}`);
  }
  return result;
}
