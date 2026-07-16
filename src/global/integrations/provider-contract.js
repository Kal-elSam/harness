/** Integration provider contract — metadata only; no executable commands in manifests. */

export const INTEGRATION_PROVIDER_IDS = Object.freeze(["engram"]);
export const PROVIDER_METHODS = Object.freeze(["inspect", "plan", "apply", "verify", "rollback"]);

const EXECUTABLE_FIELDS = Object.freeze([
  "commands",
  "command",
  "execute",
  "bin",
  "setup",
  "apply",
  "shell",
  "argv",
  "script",
  "exec"
]);

export function assertProviderContract(provider) {
  if (provider == null || typeof provider !== "object" || Array.isArray(provider)) {
    throw new Error("Integration provider must be an object.");
  }
  if (typeof provider.id !== "string" || !INTEGRATION_PROVIDER_IDS.includes(provider.id)) {
    throw new Error(
      `Integration provider id must be one of: ${INTEGRATION_PROVIDER_IDS.join(", ")}.`
    );
  }
  for (const method of PROVIDER_METHODS) {
    if (typeof provider[method] !== "function") {
      throw new Error(`Integration provider "${provider.id}" is missing ${method}().`);
    }
  }
  return provider;
}

export function normalizeIntegrationMetadata(integration, { componentId, source = "bundled" } = {}) {
  if (integration === undefined) return null;
  if (!isObject(integration)) {
    throw new Error(`Component "${componentId}" integration must be an object.`);
  }

  assertNoExecutableFields(integration, { componentId, source });

  const { provider } = integration;
  if (typeof provider !== "string" || !INTEGRATION_PROVIDER_IDS.includes(provider)) {
    throw new Error(
      `Component "${componentId}" integration.provider must be one of: ${INTEGRATION_PROVIDER_IDS.join(", ")}.`
    );
  }

  const allowed = new Set(["provider"]);
  for (const key of Object.keys(integration)) {
    if (!allowed.has(key)) {
      throw new Error(
        `Component "${componentId}" integration declares unsupported field "${key}".`
      );
    }
  }

  return { provider };
}

function assertNoExecutableFields(integration, { componentId, source }) {
  for (const key of Object.keys(integration)) {
    const isExecutable = EXECUTABLE_FIELDS.includes(key)
      || /Command$/i.test(key)
      || /commands?/i.test(key);
    if (!isExecutable) continue;

    if (source === "workspace") {
      throw new Error(
        `Workspace component "${componentId}" cannot declare executable integration.${key}.`
      );
    }
    throw new Error(
      `Component "${componentId}" integration cannot declare executable field "${key}".`
    );
  }
}

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
