import { createEngramProvider } from "./engram-provider.js";
import { registerIntegrationProvider, getIntegrationProvider } from "./provider-registry.js";

export function ensureIntegrationProvidersRegistered() {
  if (!getIntegrationProvider("engram")) {
    registerIntegrationProvider(createEngramProvider());
  }
}
