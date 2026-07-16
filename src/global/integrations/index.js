import { createEngramProvider } from "./engram-provider.js";
import { createSddCoreProvider } from "./sdd-provider.js";
import { registerIntegrationProvider, getIntegrationProvider } from "./provider-registry.js";

export function ensureIntegrationProvidersRegistered() {
  if (!getIntegrationProvider("engram")) {
    registerIntegrationProvider(createEngramProvider());
  }
  if (!getIntegrationProvider("sdd-core")) {
    registerIntegrationProvider(createSddCoreProvider());
  }
}
