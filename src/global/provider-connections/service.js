// connections.status / connections.preview / connections.connect.
//
// Four layers are always reported separately (installation, authentication,
// modelAccess, quota); they are never collapsed into one boolean. Every I/O
// dependency is injected so tests never spawn a CLI, touch the network or read
// the real ~/.harness.

import { createHash } from "node:crypto";
import { computeAccountFingerprint } from "../observability/account-fingerprint.js";
import {
  LOGIN_ARGV, LOGIN_SURFACES, LOGIN_SURFACE_NOTES, NETWORK_VERIFICATION,
  STATUS_ARGV, SUPPORTED_ACTIONS, isProviderId
} from "./allowlist.js";
import { resolveHomeDir } from "../paths.js";
import { AUTH_PARSERS, parseVersion } from "./parsers.js";
import { createSpawnRunner, execute } from "./runner.js";
import { aggregateModelAccess, createAccessEvidenceStore, normalizeModelAccess } from "./evidence.js";
import { createDefaultReaders } from "./readers.js";

export const PREVIEW_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_STATUS_TIMEOUT_MS = 10_000;
export const DEFAULT_CONNECT_TIMEOUT_MS = 5 * 60 * 1000;

export class ConnectionsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ConnectionsError";
    this.code = code;
  }
}

function requireProvider(providerId) {
  if (!isProviderId(providerId)) throw new ConnectionsError("unknown_provider", "Unknown provider.");
  return providerId;
}

function failureReason(kind) {
  if (kind === "timeout" || kind === "cancelled") return kind;
  if (kind === "missing") return "not_installed";
  return "spawn_error";
}

// Recheck outcomes that say nothing about the login itself (retry only the cheap status check).
const INCONCLUSIVE_REASONS = new Set(["timeout", "cancelled", "spawn_error", "not_installed"]);

function computePreviewId(providerId, action, argv, expiresAt) {
  return createHash("sha256")
    .update(`kairo-connection-preview-v1\n${providerId}\n${action}\n${JSON.stringify(argv)}\n${expiresAt}`)
    .digest("hex");
}

const sameArgv = (a, b) => Array.isArray(a) && a.length === b.length && a.every((token, i) => token === b[i]);

export function createProviderConnections({
  runner = createSpawnRunner(),
  interactiveRunner = runner,
  now = () => Date.now(),
  homeDir = resolveHomeDir(),
  cacheDeps = {},
  accessReaders: injectedAccess = {},
  quotaReaders: injectedQuota = {},
  evidenceStore: injectedStore = null,
  previewTtlMs = PREVIEW_TTL_MS,
  statusTimeoutMs = DEFAULT_STATUS_TIMEOUT_MS,
  connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS
} = {}) {
  // Production defaults are cache-only. Injected values MERGE over them per
  // provider key (an empty `{}` or a null store still gets the defaults), so a
  // consumer passing accessReaders:{} / quotaReaders:{} / evidenceStore:null
  // gets the real readers and store.
  const defaults = createDefaultReaders({ homeDir, deps: cacheDeps });
  const accessReaders = { ...defaults.accessReaders, ...(injectedAccess ?? {}) };
  const quotaReaders = { ...defaults.quotaReaders, ...(injectedQuota ?? {}) };
  const evidenceStore = injectedStore ?? createAccessEvidenceStore({ homeDir, deps: cacheDeps });

  async function readInstallation(providerId, limits) {
    const step = await execute(runner, STATUS_ARGV[providerId].version, limits);
    const base = { network: NETWORK_VERIFICATION };
    if (step.kind === "missing") return { state: "missing", reason: "not_installed", ...base };
    if (step.kind !== "exit") return { state: "unknown", reason: failureReason(step.kind), ...base };
    const version = step.code === 0 ? parseVersion(step.stdout) : null;
    return version
      ? { state: "installed", version, ...base }
      : { state: "unknown", reason: "unparseable", ...base };
  }

  async function readAuthentication(providerId, limits) {
    const base = { network: NETWORK_VERIFICATION, accountFingerprint: null };
    const step = await execute(runner, STATUS_ARGV[providerId].auth, limits);
    if (step.kind !== "exit") return { authentication: { state: "unknown", reason: failureReason(step.kind), ...base }, identifier: null, subscriptionType: null };
    const parsed = AUTH_PARSERS[providerId](step);
    const fingerprint = parsed.state === "authenticated" ? computeAccountFingerprint(parsed.identifier) : null;
    const authentication = { state: parsed.state, ...base, accountFingerprint: fingerprint };
    if (parsed.reason) authentication.reason = parsed.reason;
    if (providerId === "cursor") authentication.advisory = true; // status is not a proof a real call works (cursor-auth.js)
    return { authentication, identifier: parsed.identifier, subscriptionType: parsed.subscriptionType ?? null };
  }

  async function readModelAccess(providerId, authentication, identifier, subscriptionType) {
    const base = { network: NETWORK_VERIFICATION };
    const reader = accessReaders[providerId];
    if (authentication.state !== "authenticated") return { state: "unknown", source: null, reason: "not_authenticated", ...base };
    if (typeof reader !== "function") return { state: "unknown", source: null, ...base };
    try {
      const raw = await reader({ providerId, accountIdentifier: identifier, subscriptionType, now: now() });
      const aggregate = aggregateModelAccess(raw);
      // ADDITIVE: per-model rows when the evidence names models.
      const models = normalizeModelAccess(raw);
      return { ...aggregate, source: "entitlement-cache", ...(models.length > 0 ? { models } : {}), ...base };
    } catch {
      return { state: "unknown", source: "entitlement-cache", reason: "reader_failed", ...base };
    }
  }

  async function readQuota(providerId, authentication) {
    const base = { network: NETWORK_VERIFICATION };
    const reader = quotaReaders[providerId];
    if (authentication.state !== "authenticated" || typeof reader !== "function") return { state: "unknown", ...base };
    try {
      const usage = await reader({ providerId, now: now() });
      const percent = Number(usage?.remainingPercent);
      if (!Number.isFinite(percent)) return { state: "unknown", ...base };
      const remainingPercent = Math.max(0, Math.min(100, percent));
      return { state: remainingPercent > 0 ? "available" : "exhausted", remainingPercent, ...base };
    } catch {
      return { state: "unknown", reason: "reader_failed", ...base };
    }
  }

  async function statusFor(providerId, limits) {
    const installation = await readInstallation(providerId, limits);
    let authentication = { state: "unknown", reason: "not_installed", network: NETWORK_VERIFICATION, accountFingerprint: null };
    let identifier = null;
    let subscriptionType = null;
    if (installation.state !== "missing") ({ authentication, identifier, subscriptionType } = await readAuthentication(providerId, limits));
    const modelAccess = await readModelAccess(providerId, authentication, identifier, subscriptionType);
    const quota = await readQuota(providerId, authentication);
    return { providerId, installation, authentication, modelAccess, quota, checkedAt: new Date(now()).toISOString() };
  }

  async function status({ providerIds, signal, timeoutMs = statusTimeoutMs } = {}) {
    const ids = providerIds === undefined ? [...Object.keys(STATUS_ARGV)] : providerIds;
    if (!Array.isArray(ids)) throw new ConnectionsError("invalid_input", "providerIds must be an array.");
    ids.forEach(requireProvider);
    const limits = { signal, timeoutMs };
    return { providers: await Promise.all(ids.map((id) => statusFor(id, limits))) };
  }

  function preview(input = {}) {
    const extra = Object.keys(input ?? {}).filter((key) => key !== "providerId" && key !== "action");
    if (extra.length > 0) throw new ConnectionsError("invalid_input", `Unsupported input: ${extra.join(", ")}. Callers can never supply argv or commands.`);
    const { providerId, action } = input;
    requireProvider(providerId);
    if (!SUPPORTED_ACTIONS.includes(action)) throw new ConnectionsError("unsupported_action", "Unsupported action.");
    const argv = [...LOGIN_ARGV[providerId]];
    const createdMs = now();
    const expiresAt = new Date(createdMs + previewTtlMs).toISOString();
    return {
      providerId,
      action,
      argv,
      command: argv.join(" "),
      surfaces: [...LOGIN_SURFACES[providerId]],
      networkVerification: NETWORK_VERIFICATION,
      ...(LOGIN_SURFACE_NOTES[providerId] ? { surfaceNote: LOGIN_SURFACE_NOTES[providerId] } : {}),
      createdAt: new Date(createdMs).toISOString(),
      expiresAt,
      // Pure function of (provider, action, allowlisted argv, expiry): connect
      // recomputes it, so a tampered preview or forged expiry cannot match.
      previewId: computePreviewId(providerId, action, argv, expiresAt)
    };
  }

  const rejected = (reason) => ({ outcome: "rejected", reason });

  function validatePreview(candidate) {
    if (!candidate || typeof candidate !== "object") return "invalid_preview";
    const { providerId, action, argv, expiresAt, previewId } = candidate;
    if (!isProviderId(providerId) || !SUPPORTED_ACTIONS.includes(action)) return "invalid_preview";
    const allowed = LOGIN_ARGV[providerId];
    if (!sameArgv(argv, allowed)) return "invalid_preview";
    const expiresMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresMs) || typeof previewId !== "string") return "invalid_preview";
    if (previewId !== computePreviewId(providerId, action, allowed, expiresAt)) return "invalid_preview";
    if (expiresMs - now() > previewTtlMs) return "invalid_preview";
    if (expiresMs <= now()) return "preview_expired";
    return null;
  }

  async function connect({ preview: candidate, confirm, signal, timeoutMs = connectTimeoutMs } = {}) {
    if (confirm !== true) return rejected("confirmation_required");
    const problem = validatePreview(candidate);
    if (problem) return rejected(problem);
    const { providerId } = candidate;
    // Always the allowlist's argv, never anything read from the caller's object.
    const step = await execute(interactiveRunner, LOGIN_ARGV[providerId], { interactive: true, signal, timeoutMs });
    if (step.kind === "timeout" || step.kind === "cancelled") return { outcome: step.kind, reason: step.kind };
    if (step.kind !== "exit") return { outcome: "failed", reason: failureReason(step.kind) };
    if (step.code !== 0) return { outcome: "failed", reason: "exit_nonzero" };

    // T8: exit 0 is NOT success. A caller that cancelled meanwhile gets cancelled.
    if (signal?.aborted) return { outcome: "cancelled", reason: "cancelled" };
    // The recheck has its OWN fresh budget (statusTimeoutMs, never what login left over) and
    // still honors the caller's signal. R4: an INCONCLUSIVE check is not a failed login.
    const { providers } = await status({ providerIds: [providerId], signal, timeoutMs: statusTimeoutMs });
    const after = providers[0];
    const auth = after.authentication;
    if (auth.state === "unknown" && auth.reason === "cancelled") return { outcome: "cancelled", reason: "cancelled", status: after };
    const confirmed = auth.state === "authenticated";
    const incomplete = auth.state === "unknown" && INCONCLUSIVE_REASONS.has(auth.reason);
    // `outcome`/`reason`/`status` keep the original shape; both failure reasons are `failed` reasons.
    const result = {
      outcome: confirmed ? "connected" : "failed",
      reason: confirmed ? "login_completed" : (incomplete ? "auth_check_incomplete" : "auth_not_confirmed"),
      status: after,
      accountChanged: null,
      evidenceInvalidated: false,
      needsTerminal: LOGIN_SURFACES[providerId].includes("terminal")
    };
    if (evidenceStore) {
      const newFingerprint = after.authentication.accountFingerprint;
      const previous = await evidenceStore.getFingerprint(providerId);
      result.accountChanged = previous !== newFingerprint;
      // Reuse is only safe when the account is identifiable and unchanged.
      if (!(newFingerprint && newFingerprint === previous)) {
        await evidenceStore.invalidate(providerId, newFingerprint);
        result.evidenceInvalidated = true;
      }
    }
    return result;
  }

  return {
    status,
    preview,
    connect,
    methods: { "connections.status": status, "connections.preview": preview, "connections.connect": connect }
  };
}
