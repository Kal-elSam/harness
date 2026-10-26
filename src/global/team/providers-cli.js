import { createProviderConnections } from '../provider-connections/service.js';
import { PROVIDER_IDS } from '../provider-connections/allowlist.js';

function inventoryRow(provider) {
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
  const reason = !installed ? 'not_installed'
    : !authenticated ? 'not_authenticated'
      : quota?.state === 'exhausted' ? 'quota_exhausted'
        : quota?.state !== 'available' ? 'no_quota_data'
          : models === 'unknown' ? 'catalog_unknown' : null;
  return { providerId: provider.providerId, installed, authenticated, models,
    remainingPercent, available: reason === null, ...(reason ? { reason } : {}) };
}

/** Read-only inventory: version/auth checks, catalog RPC and cached quota only. */
export async function runTeamProvidersCli(options = {}, deps = {}) {
  const status = deps.status ?? createProviderConnections({
    homeDir: deps.homeDir, cacheDeps: { ...deps.cacheDeps, cwd: options.cwd }
  }).status;
  const snapshot = await status({ providerIds: [...PROVIDER_IDS] });
  const result = { providers: snapshot.providers.map(inventoryRow) };
  const log = deps.log ?? console.log;
  if (options.json) log(JSON.stringify(result));
  else for (const row of result.providers) {
    log(`${row.providerId} installed=${row.installed} authenticated=${row.authenticated} models=${Array.isArray(row.models) ? row.models.join(',') : row.models} quota=${row.remainingPercent === 'unknown' ? 'unknown' : `${row.remainingPercent}%`} available=${row.available}${row.reason ? ` reason=${row.reason}` : ''}`);
  }
  return result;
}
