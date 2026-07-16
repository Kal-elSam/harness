import {
  COST_CLASSES,
  OPENCODE_API_KEY_ENV,
  PRIVACY_CLASSES,
  TRANSPORT_KINDS,
  createModelDescriptor
} from "../types.js";
import {
  isDirectTransport,
  normalizeModelId,
  resolveOpencodeTransport
} from "../transport-registry.js";
import { fetchJson } from "../http.js";
import { CAPABILITY_STATES } from "../../capability-states.js";
import {
  BILLING_MODELS,
  ENTITLEMENT_STATES,
  buildDirectEvidenceBase,
  classifyModelsProbeStatus,
  collectOpencodeCliEvidence
} from "./opencode-evidence.js";

export function resolveOpencodeApiKey({ env = process.env, apiKey = null } = {}) {
  const value = apiKey ?? env[OPENCODE_API_KEY_ENV] ?? null;
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function redactSecret(message, secret) {
  if (!message || !secret) return message ?? null;
  return String(message).split(String(secret)).join("[REDACTED]");
}

export function zenCostClassForModel(modelId) {
  const id = normalizeModelId(modelId) ?? "";
  return id === "big-pickle" || id.endsWith("-free") ? COST_CLASSES.FREE : COST_CLASSES.PAID;
}

export function goCostClassForModel() {
  return COST_CLASSES.PAID;
}

/** Catalog/detection for OpenCode Go/Zen. Invoke composition ships in a later PR. */
export function createOpencodeCatalogBackend({
  id,
  label,
  product,
  baseUrl,
  defaultModelId,
  costClassForModel,
  env = process.env,
  fetchImpl = globalThis.fetch,
  apiKey = null,
  collectCliEvidence = collectOpencodeCliEvidence
}) {
  const resolvedKey = resolveOpencodeApiKey({ env, apiKey });

  return {
    id,
    label,
    local: false,
    product,
    baseUrl,

    async detect() {
      const cliEvidence = collectCliEvidence({ env });
      if (!resolvedKey) return missingKeyDetection(id, label, product, cliEvidence);

      const probe = await fetchJson(`${baseUrl}/models`, {
        headers: bearerHeaders(resolvedKey),
        timeoutMs: 5000,
        fetchImpl
      });
      const evidence = buildDirectEvidenceBase({
        product,
        hasApiKey: true,
        cliEvidence,
        modelsHttpStatus: probe.status || null,
        modelsOk: probe.ok
      });

      if (!probe.ok) {
        const entitlement = classifyModelsProbeStatus(probe.status);
        return {
          id,
          label,
          state: CAPABILITY_STATES.ERROR,
          detected: true,
          available: false,
          hasApiKey: true,
          cloud: true,
          ...evidence,
          entitlement,
          error: redactSecret(probe.error ?? `HTTP ${probe.status}`, resolvedKey),
          recommendation: describeAuthFailure(probe.status, label, product)
        };
      }

      return {
        id,
        label,
        state: CAPABILITY_STATES.AUTHENTICATED,
        detected: true,
        available: true,
        hasApiKey: true,
        cloud: true,
        ...evidence,
        error: null,
        recommendation: `${label} HTTP authenticated via /models. Entitlement remains ${ENTITLEMENT_STATES.UNVERIFIED}; cloud invoke needs --cloud-consent --yes.`
      };
    },

    async listModels() {
      if (!resolvedKey) return [];
      const result = await fetchJson(`${baseUrl}/models`, {
        headers: bearerHeaders(resolvedKey),
        timeoutMs: 10000,
        fetchImpl
      });
      if (!result.ok) return [];

      const mapped = [];
      for (const remoteId of extractModelIds(result.data)) {
        const modelId = normalizeModelId(remoteId);
        const transport = resolveOpencodeTransport(product, modelId);
        if (!isDirectTransport(transport)) continue;
        mapped.push(createModelDescriptor({
          provider: id,
          modelId,
          local: false,
          costClass: costClassForModel(modelId),
          privacyClass: PRIVACY_CLASSES.CLOUD,
          transport
        }));
      }
      return mapped;
    },

    async capabilities() {
      const detection = await this.detect();
      return {
        id,
        local: false,
        cloud: true,
        requiresApiKey: true,
        requiresConsent: true,
        streaming: false,
        tools: false,
        transports: [TRANSPORT_KINDS.CHAT_COMPLETIONS, TRANSPORT_KINDS.RESPONSES],
        billingModel: detection.billingModel,
        entitlement: detection.entitlement,
        configured: detection.configured,
        authenticated: detection.authenticated,
        state: detection.state,
        hasApiKey: Boolean(resolvedKey),
        defaultModelId
      };
    }
  };
}

function missingKeyDetection(id, label, product, cliEvidence = null) {
  const evidence = buildDirectEvidenceBase({
    product,
    hasApiKey: false,
    cliEvidence,
    modelsHttpStatus: null,
    modelsOk: false
  });
  const viaCli = evidence.configured;
  return {
    id,
    label,
    state: CAPABILITY_STATES.UNKNOWN,
    detected: viaCli,
    available: false,
    hasApiKey: false,
    cloud: true,
    ...evidence,
    error: null,
    recommendation: viaCli
      ? `${label} appears in OpenCode CLI auth list (${ENTITLEMENT_STATES.UNVERIFIED} entitlement). Intelligence direct HTTP still needs ${OPENCODE_API_KEY_ENV}, or use --backend opencode for CLI runtime.`
      : `Set ${OPENCODE_API_KEY_ENV} for direct ${label} HTTP, or install/authenticate OpenCode CLI for runtime. Kairo never reads auth.json or claims balance without evidence.`
  };
}

function bearerHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
}

function extractModelIds(payload) {
  const rows = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : Array.isArray(payload) ? payload : [];
  return rows
    .map((entry) => (typeof entry === "string" ? entry : entry?.id ?? entry?.name))
    .filter(Boolean);
}

function describeAuthFailure(status, label, product = "zen") {
  if (status === 401 || status === 403) {
    return `${label} rejected the API key (HTTP ${status}). Key is configured but not authenticated for HTTP.`;
  }
  if (status === 429) {
    return `${label} returned HTTP 429 (${ENTITLEMENT_STATES.LIMIT_REACHED}). Go limits do not automatically spend Zen credits.`;
  }
  const billing = product === "go" ? BILLING_MODELS.GO_PLAN : BILLING_MODELS.ZEN_CREDITS;
  return `${label} model discovery failed (${billing} catalog; entitlement ${ENTITLEMENT_STATES.UNKNOWN}).`;
}
