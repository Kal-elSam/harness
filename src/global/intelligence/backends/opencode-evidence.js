import { probeCommand, isExecutableAvailable } from "../../cli-probe.js";

export const ENTITLEMENT_STATES = Object.freeze({
  UNKNOWN: "unknown",
  UNVERIFIED: "entitlement_unverified",
  LIMIT_REACHED: "limit_reached"
});

export const BILLING_MODELS = Object.freeze({
  GO_PLAN: "go_plan",
  ZEN_CREDITS: "zen_credits",
  CLI_RUNTIME: "cli_runtime"
});

/**
 * Safe OpenCode evidence: CLI presence + `opencode auth list` + env key.
 * Never reads auth.json. Never claims subscription/balance without HTTP evidence.
 */
export function collectOpencodeCliEvidence({
  env = process.env,
  whichImpl = isExecutableAvailable,
  probeImpl = probeCommand
} = {}) {
  const cliInstalled = whichImpl("opencode", { env });
  if (!cliInstalled) {
    return {
      cliInstalled: false,
      authListOk: false,
      authProviders: [],
      error: null
    };
  }

  const result = probeImpl("opencode", ["auth", "list"], {
    env,
    timeoutMs: 8000
  });

  if (!result.ok && !result.stdout) {
    return {
      cliInstalled: true,
      authListOk: false,
      authProviders: [],
      error: result.error ?? result.stderr ?? "opencode auth list failed"
    };
  }

  return {
    cliInstalled: true,
    authListOk: true,
    authProviders: parseAuthListProviders(`${result.stdout}\n${result.stderr}`),
    error: null
  };
}

export function parseAuthListProviders(rawOutput) {
  const plain = String(rawOutput ?? "").replace(/\u001b\[[0-9;]*m/g, "");
  const found = new Set();

  for (const line of plain.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /credentials|environment|outro|intro/i.test(trimmed)) continue;

    const match = trimmed.match(/^(?:[●*•]\s*)?(.+?)\s+(oauth|api)\s*$/i);
    if (match) {
      found.add(normalizeProviderLabel(match[1]));
      continue;
    }

    if (/opencode\s+go/i.test(trimmed)) found.add("OpenCode Go");
    if (/opencode\s+zen/i.test(trimmed)) found.add("OpenCode Zen");
  }

  return [...found].sort((a, b) => a.localeCompare(b));
}

export function hasAuthProvider(providers, product) {
  const list = Array.isArray(providers) ? providers : [];
  if (product === "go") {
    return list.some((entry) => /opencode\s*go/i.test(entry) || /^go$/i.test(entry));
  }
  if (product === "zen") {
    return list.some((entry) => /opencode\s*zen/i.test(entry) || /^zen$/i.test(entry));
  }
  return list.length > 0;
}

export function classifyModelsProbeStatus(status) {
  if (status === 429) return ENTITLEMENT_STATES.LIMIT_REACHED;
  if (status === 401 || status === 403) return ENTITLEMENT_STATES.UNKNOWN;
  if (status >= 200 && status < 300) return ENTITLEMENT_STATES.UNVERIFIED;
  return ENTITLEMENT_STATES.UNKNOWN;
}

export function buildDirectEvidenceBase({
  product,
  hasApiKey,
  cliEvidence = null,
  modelsHttpStatus = null,
  modelsOk = false
}) {
  const authProviders = cliEvidence?.authProviders ?? [];
  const configuredViaCli = hasAuthProvider(authProviders, product);
  const configured = Boolean(hasApiKey) || configuredViaCli;
  const authenticated = Boolean(hasApiKey) && modelsOk;
  const entitlement = modelsHttpStatus === 429
    ? ENTITLEMENT_STATES.LIMIT_REACHED
    : (authenticated || configured
      ? ENTITLEMENT_STATES.UNVERIFIED
      : ENTITLEMENT_STATES.UNKNOWN);

  return {
    configured,
    authenticated,
    entitlement,
    billingModel: product === "go" ? BILLING_MODELS.GO_PLAN : BILLING_MODELS.ZEN_CREDITS,
    evidence: {
      hasApiKey: Boolean(hasApiKey),
      cliInstalled: Boolean(cliEvidence?.cliInstalled),
      authListOk: Boolean(cliEvidence?.authListOk),
      authProviders,
      modelsHttpStatus
    }
  };
}

function normalizeProviderLabel(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
