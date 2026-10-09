/**
 * Settings consumer for Claude's provider-connections contract
 * (`src/global/provider-connections`). Adapts status/preview/connect shapes
 * for the Ratatui Settings UI. Never implements auth allowlists or spawn logic.
 */

import {
  createProviderConnections,
  createSpawnRunner,
  PROVIDER_IDS
} from "../provider-connections/index.js";

export const CONNECTION_PROVIDERS = PROVIDER_IDS;

export const ACCESS_LABEL = Object.freeze({
  CATALOGUED: "catalogued",
  VERIFIED: "verified",
  UNVERIFIED: "unverified",
  QUOTA_LIMITED: "quota_limited",
  DENIED: "denied",
  EXHAUSTED: "exhausted",
  UNKNOWN: "unknown",
  MIXED: "mixed"
});

export const CONNECT_ACTION = Object.freeze({
  SETUP: "setup",
  CONNECT: "connect",
  REFRESH: "refresh",
  UNAVAILABLE: "unavailable",
  INCOMPLETE: "incomplete"
});

function layerState(layer, key = "state") {
  return typeof layer?.[key] === "string" ? layer[key] : "unknown";
}

/**
 * CLI missing → setup; unauthenticated → connect; authenticated → refresh.
 * Incomplete backend wiring surfaces as incomplete (never silent simulation).
 */
export function resolveConnectAction(providerStatus = {}) {
  if (providerStatus?.incomplete === true) return CONNECT_ACTION.INCOMPLETE;
  const install = layerState(providerStatus.installation);
  if (install === "missing" || install === "absent") return CONNECT_ACTION.SETUP;
  if (install !== "installed" && install !== "present" && install !== "ok") {
    return CONNECT_ACTION.UNAVAILABLE;
  }
  const auth = layerState(providerStatus.authentication);
  if (auth === "unauthenticated" || auth === "absent") return CONNECT_ACTION.CONNECT;
  if (auth === "authenticated" || auth === "ok") return CONNECT_ACTION.REFRESH;
  return CONNECT_ACTION.UNAVAILABLE;
}

/**
 * Map contract modelAccess aggregate (and optional per-model rows) to UI labels.
 * Authenticated login alone never upgrades catalogued/unverified rows to verified.
 * Aggregate `temporarily_limited` is a temporary quota limit — not plain unverified.
 */
export function classifyModelAccess(entry = {}) {
  const state = typeof entry.state === "string" ? entry.state : "unknown";
  if (state === "temporarily_limited" || state === "rate_limited" || state === "limited") {
    return ACCESS_LABEL.QUOTA_LIMITED;
  }
  if (state === "exhausted") return ACCESS_LABEL.EXHAUSTED;
  if (state === "denied" || state === "forbidden") return ACCESS_LABEL.DENIED;
  if (state === "allowed" || state === "verified" || state === "available") return ACCESS_LABEL.VERIFIED;
  if (state === "mixed") return ACCESS_LABEL.MIXED;
  if (state === "unverified" || state === "pending") return ACCESS_LABEL.UNVERIFIED;
  if (state === "catalogued" || state === "listed" || state === "documented") return ACCESS_LABEL.CATALOGUED;
  if (state === "unknown") return ACCESS_LABEL.UNKNOWN;
  return ACCESS_LABEL.UNVERIFIED;
}

function modelsFromProvider(row) {
  const access = row.modelAccess;
  if (Array.isArray(access?.models)) {
    return access.models.map((m) => ({
      modelId: typeof m.modelId === "string" ? m.modelId : String(m.id ?? ""),
      label: typeof m.label === "string" ? m.label : (m.displayName ?? m.modelId ?? m.id ?? ""),
      access: classifyModelAccess(m),
      reusable: m.reusable === true
    }));
  }
  // Aggregate-only: surface one summary row so Settings still shows access state.
  if (access && typeof access.state === "string" && access.state !== "unknown") {
    return [{
      modelId: "*",
      label: "models",
      access: classifyModelAccess(access),
      reusable: access.source === "entitlement-cache"
    }];
  }
  return [];
}

/**
 * @param {{ providers?: Array<object>, ok?: boolean, reason?: string|null, incomplete?: boolean }} status
 */
export function buildProviderInventory(status = {}) {
  const providers = Array.isArray(status.providers) ? status.providers : [];
  return providers.map((row) => {
    const provider = typeof row.providerId === "string"
      ? row.providerId
      : (typeof row.provider === "string" ? row.provider : "unknown");
    return {
      provider,
      installation: layerState(row.installation),
      authentication: layerState(row.authentication),
      accountFingerprint: typeof row.authentication?.accountFingerprint === "string"
        ? row.authentication.accountFingerprint
        : null,
      action: resolveConnectAction({
        ...row,
        incomplete: status.incomplete === true || row.incomplete === true
      }),
      quota: layerState(row.quota),
      modelAccessState: layerState(row.modelAccess),
      models: modelsFromProvider(row),
      network: row.installation?.network ?? row.authentication?.network ?? null
    };
  });
}

export function buildVerifyPendingOffer({ inventory = [], verificationPlan = null } = {}) {
  const fromPlan = Array.isArray(verificationPlan?.subscriptions)
    ? verificationPlan.subscriptions.flatMap((sub) =>
      (Array.isArray(sub.checks) ? sub.checks : [])
        .filter((c) => c.state === "pending")
        .map((c) => ({
          id: c.id,
          provider: sub.adapterId ?? sub.provider,
          label: c.label ?? c.modelId ?? c.id,
          kind: c.kind ?? "model"
        }))
    )
    : [];
  const fromInventory = fromPlan.length > 0
    ? fromPlan
    : inventory.flatMap((p) =>
      p.models
        .filter((m) =>
          m.access === ACCESS_LABEL.UNVERIFIED
          || m.access === ACCESS_LABEL.CATALOGUED
          || m.access === ACCESS_LABEL.UNKNOWN
        )
        .map((m) => ({
          id: `${p.provider}::${m.modelId}`,
          provider: p.provider,
          label: m.label || m.modelId,
          kind: "model"
        }))
    );
  const pendingCount = fromInventory.length;
  const reusableCount = Number(verificationPlan?.reusableCount) || inventory.reduce(
    (n, p) => n + p.models.filter((m) => m.reusable === true).length,
    0
  );
  return {
    pendingCount,
    reusableCount,
    mayConsumeQuota: pendingCount > 0,
    pending: fromInventory,
    costStatement: pendingCount > 0
      ? `Verifying makes ${pendingCount} real provider call${pendingCount === 1 ? "" : "s"} and may consume quota or account credit.`
      : null
  };
}

/**
 * Explicit incomplete backend — never pretends providers are ready / simulated.
 */
export function createIncompleteConnectionsBackend(reason = "incomplete_configuration") {
  return {
    incomplete: true,
    reason,
    async status() {
      return {
        ok: false,
        incomplete: true,
        reason,
        providers: CONNECTION_PROVIDERS.map((providerId) => ({
          providerId,
          incomplete: true,
          installation: { state: "unknown", reason },
          authentication: { state: "unknown", reason },
          modelAccess: { state: "unknown", reason },
          quota: { state: "unknown", reason }
        }))
      };
    },
    preview() {
      return { ok: false, incomplete: true, reason };
    },
    async connect() {
      return { ok: false, outcome: "rejected", reason: "incomplete_configuration", detail: reason };
    }
  };
}

/**
 * Human-facing connect label for Settings / RPC.
 * Exit 0 alone is never success: `auth_not_confirmed` → "No conectado".
 */
export function formatConnectResultLabel({ ok, outcome, reason } = {}) {
  const resolvedOutcome = typeof outcome === "string" ? outcome : "";
  const resolvedReason = typeof reason === "string" ? reason : "";
  if (
    ok === true
    || resolvedOutcome === "connected"
    || resolvedReason === "login_completed"
  ) {
    // Login confirms auth only — remind that models stay catalogued until verify.
    return "Connected — refresh inventory to see verified models.";
  }
  if (resolvedReason === "auth_not_confirmed") {
    return "No conectado";
  }
  if (resolvedReason === "auth_check_incomplete") {
    // Login may have succeeded; only the cheap status recheck is incomplete.
    return "Not confirmed — retry the check";
  }
  if (resolvedOutcome === "cancelled" || resolvedReason === "cancelled") {
    return "Not connected · cancelled";
  }
  if (resolvedOutcome === "timeout" || resolvedReason === "timeout") {
    return "Not connected · timeout";
  }
  if (resolvedReason) {
    return `Not connected · ${resolvedReason}`;
  }
  return "No conectado";
}

/**
 * Wrap Claude's createProviderConnections API in the Settings/RPC record shape.
 * @param {ReturnType<typeof createProviderConnections>} api
 */
export function adaptProviderConnectionsApi(api) {
  if (!api || typeof api.status !== "function" || typeof api.preview !== "function" || typeof api.connect !== "function") {
    return createIncompleteConnectionsBackend("invalid_provider_connections_api");
  }
  return {
    incomplete: false,
    async status({ provider } = {}) {
      const providerIds = provider ? [provider] : undefined;
      const result = await api.status({ providerIds });
      return {
        ok: true,
        incomplete: false,
        reason: null,
        providers: Array.isArray(result?.providers) ? result.providers : []
      };
    },
    async preview({ provider, action = "login" } = {}) {
      try {
        const preview = api.preview({ providerId: provider, action });
        const surfaces = Array.isArray(preview.surfaces) ? preview.surfaces : [];
        return {
          ok: true,
          reason: null,
          provider: preview.providerId,
          providerId: preview.providerId,
          action: preview.action,
          argv: preview.argv,
          command: preview.command,
          surfaces: {
            list: surfaces,
            credentialStore: surfaces.includes("credential-store"),
            browser: surfaces.includes("browser"),
            network: surfaces.includes("network"),
            terminal: surfaces.includes("terminal")
          },
          networkVerification: preview.networkVerification ?? null,
          surfaceNote: preview.surfaceNote ?? null,
          fingerprint: preview.previewId,
          previewId: preview.previewId,
          expiresAt: preview.expiresAt,
          createdAt: preview.createdAt,
          scope: `${preview.providerId} · ${preview.action} · ${surfaces.join(", ")}`,
          summary: preview.command,
          preview
        };
      } catch (err) {
        return {
          ok: false,
          reason: err?.code ?? "preview_failed",
          error: err?.message ?? String(err)
        };
      }
    },
    async connect({ provider, fingerprint, preview, confirm, signal, timeoutMs } = {}) {
      if (confirm !== true) {
        return {
          ok: false,
          outcome: "rejected",
          reason: "confirmation_required",
          label: formatConnectResultLabel({ ok: false, outcome: "rejected", reason: "confirmation_required" })
        };
      }
      if (!preview || typeof preview !== "object") {
        return {
          ok: false,
          outcome: "rejected",
          reason: "invalid_preview",
          label: formatConnectResultLabel({ ok: false, outcome: "rejected", reason: "invalid_preview" })
        };
      }
      if (fingerprint && preview.previewId && fingerprint !== preview.previewId) {
        return {
          ok: false,
          outcome: "rejected",
          reason: "invalid_preview",
          label: formatConnectResultLabel({ ok: false, outcome: "rejected", reason: "invalid_preview" })
        };
      }
      const result = await api.connect({ preview, confirm: true, signal, timeoutMs });
      const outcome = result?.outcome ?? "failed";
      const reason = result?.reason ?? outcome;
      const ok = outcome === "connected";
      return {
        ok,
        outcome,
        reason,
        label: formatConnectResultLabel({ ok, outcome, reason }),
        provider: preview.providerId ?? provider,
        providerId: preview.providerId ?? provider,
        status: result?.status ?? null,
        accountChanged: result?.accountChanged ?? null,
        evidenceInvalidated: result?.evidenceInvalidated === true,
        needsTerminal: result?.needsTerminal === true,
        error: ok ? null : reason
      };
    }
  };
}

/**
 * Build the real backend from Claude's module + injected runners.
 * Incomplete deps → incomplete backend (never a silent simulation fallback).
 * `evidenceStore: null` / empty readers MERGE with module defaults (cache-only).
 * Pass `homeDir` (temp in tests) so defaults never touch the real ~/.harness.
 *
 * @param {{
 *   backend?: object,
 *   runner?: Function,
 *   interactiveRunner?: Function,
 *   accessReaders?: object,
 *   quotaReaders?: object,
 *   evidenceStore?: object|null,
 *   homeDir?: string,
 *   now?: () => number,
 *   createProviderConnections?: typeof createProviderConnections,
 *   createSpawnRunner?: typeof createSpawnRunner,
 *   env?: NodeJS.ProcessEnv
 * }} [deps]
 */
export function loadConnectionsBackend(deps = {}) {
  if (deps.backend) return deps.backend;

  const interactiveRunner = deps.interactiveRunner;
  if (typeof interactiveRunner !== "function") {
    return createIncompleteConnectionsBackend("missing_interactive_runner");
  }

  const createApi = deps.createProviderConnections ?? createProviderConnections;
  const spawnFactory = deps.createSpawnRunner ?? createSpawnRunner;
  const runner = typeof deps.runner === "function"
    ? deps.runner
    : spawnFactory({ env: deps.env ?? process.env });

  try {
    const api = createApi({
      runner,
      interactiveRunner,
      accessReaders: deps.accessReaders ?? {},
      quotaReaders: deps.quotaReaders ?? {},
      // null → module installs the default evidence store (cache-only).
      evidenceStore: deps.evidenceStore === undefined ? null : deps.evidenceStore,
      homeDir: deps.homeDir,
      now: deps.now
    });
    return adaptProviderConnectionsApi(api);
  } catch (err) {
    return createIncompleteConnectionsBackend(
      `provider_connections_init_failed:${err?.message ?? String(err)}`
    );
  }
}

/** @deprecated use loadConnectionsBackend — kept sync-compatible name for RPC. */
export async function loadConnectionsBackendAsync(deps = {}) {
  return loadConnectionsBackend(deps);
}

export async function connectionsStatus({ backend, provider = null } = {}) {
  const result = await backend.status({ provider: provider || undefined });
  const inventory = buildProviderInventory(result);
  return {
    ok: result?.ok !== false && result?.incomplete !== true,
    incomplete: result?.incomplete === true,
    reason: result?.reason ?? null,
    providers: Array.isArray(result?.providers) ? result.providers : [],
    inventory
  };
}

export async function connectionsPreview({ backend, provider, action = "login" } = {}) {
  if (typeof provider !== "string" || !provider) {
    return { ok: false, reason: "invalid_provider" };
  }
  return backend.preview({ provider, action });
}

export async function connectionsConnect({
  backend,
  provider,
  fingerprint,
  preview,
  confirm,
  signal,
  timeoutMs
} = {}) {
  if (confirm !== true) {
    return { ok: false, outcome: "rejected", reason: "confirmation_required" };
  }
  return backend.connect({ provider, fingerprint, preview, confirm: true, signal, timeoutMs });
}
