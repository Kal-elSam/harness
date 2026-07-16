import { assertProviderContract } from "./provider-contract.js";

const providers = new Map();

export function registerIntegrationProvider(provider) {
  assertProviderContract(provider);
  if (providers.has(provider.id)) {
    throw new Error(`Integration provider "${provider.id}" is already registered.`);
  }
  const frozen = Object.freeze({
    id: provider.id,
    inspect: provider.inspect,
    plan: provider.plan,
    apply: provider.apply,
    verify: provider.verify,
    rollback: provider.rollback
  });
  providers.set(provider.id, frozen);
  return frozen;
}

export function getIntegrationProvider(id) {
  return providers.get(id) ?? null;
}

export function requireIntegrationProvider(id) {
  const provider = getIntegrationProvider(id);
  if (!provider) {
    throw new Error(`Unknown integration provider "${id}".`);
  }
  return provider;
}

export function listIntegrationProviders() {
  return [...providers.values()];
}

export function resolveComponentIntegrationProvider(component) {
  const providerId = component?.integration?.provider;
  if (!providerId) return null;
  return requireIntegrationProvider(providerId);
}

/** Test helper — clears registry between tests. */
export function resetIntegrationProvidersForTests() {
  providers.clear();
}
