import { probeCommand as defaultProbeCommand } from "../cli-probe.js";
import {
  CONSENT_TYPES,
  PermissionAuthorityError,
  UNSAFE_OPERATIONS,
  authorizeUnsafeOperation as defaultAuthorizeUnsafeOperation
} from "../runtime/run-permissions.js";
import { probeGentle as defaultProbeGentle } from "./gentle-probe.js";
import { resolveNegotiatedGentleBinary } from "./gentle-bundle-export.js";

const IMPORT_TIMEOUT_MS = 60_000;

function fail(code, diagnostics, extra = {}) {
  return {
    ok: false,
    exitCode: 2,
    code,
    mutationOutcome: "not_started",
    diagnostics: diagnostics.map(String),
    providerStatus: null,
    timedOut: false,
    permissionAuthority: null,
    ...extra
  };
}

/**
 * Consent-gated transport: invoke Gentle review-bundle-import.
 * Provider decides bundle format. Never parses bytes or surfaces raw stderr.
 */
export async function importGentleReviewBundle({
  bundlePath,
  cwd = process.cwd(),
  env = process.env,
  confirmImport = false,
  probeGentle = defaultProbeGentle,
  probeCommand = defaultProbeCommand,
  authorizeUnsafeOperation = defaultAuthorizeUnsafeOperation
} = {}) {
  if (typeof bundlePath !== "string" || !bundlePath.trim()) {
    return fail("invalid_request", ["Missing --bundle path."], {
      bundlePath: bundlePath ?? null
    });
  }

  let permissionAuthority = null;
  try {
    ({ permissionAuthority } = authorizeUnsafeOperation({
      operation: UNSAFE_OPERATIONS.GENTLE_BUNDLE_IMPORT,
      confirmed: Boolean(confirmImport),
      source: "cli",
      consentType: CONSENT_TYPES.CLI_CONFIRM_IMPORT
    }));
  } catch (error) {
    if (error instanceof PermissionAuthorityError) {
      return fail(error.code ?? "import_consent_required", [error.message], {
        bundlePath, cwd
      });
    }
    throw error;
  }

  const probe = await probeGentle({ cwd, env });
  if (probe.state !== "available") {
    const code = ["missing", "incompatible", "error"].includes(probe.state)
      ? `gentle_${probe.state}` : "gentle_error";
    return fail(
      code,
      probe.diagnostics?.length ? probe.diagnostics : [`Gentle probe state: ${probe.state}`],
      { bundlePath, cwd, permissionAuthority }
    );
  }

  const binary = resolveNegotiatedGentleBinary(probe);
  if (!binary) {
    return fail("gentle_binary_unbound", [
      "Negotiated Gentle binary evidence missing or not absolute; refusing PATH fallback."
    ], { bundlePath, cwd, permissionAuthority });
  }

  let provider;
  try {
    provider = probeCommand(binary, [
      "review-bundle-import", "--cwd", cwd, "--bundle", bundlePath
    ], { cwd, env, timeoutMs: IMPORT_TIMEOUT_MS });
  } catch {
    return fail("mutation_outcome_unknown", ["provider_error", "spawn_interrupted"], {
      mutationOutcome: "unknown",
      bundlePath, cwd, binary, permissionAuthority
    });
  }

  const timedOut = Boolean(provider?.timedOut);
  const status = provider?.status ?? null;
  const committed = provider?.ok === true && status === 0 && timedOut !== true;
  if (!committed) {
    const diagnostics = ["provider_error"];
    if (timedOut) diagnostics.push("timed_out");
    if (status != null) diagnostics.push(`status=${status}`);
    else diagnostics.push("status_unknown");
    return fail("mutation_outcome_unknown", diagnostics, {
      mutationOutcome: "unknown",
      bundlePath, cwd, binary, permissionAuthority,
      providerStatus: status,
      timedOut
    });
  }

  return {
    ok: true,
    exitCode: 0,
    code: "imported",
    mutationOutcome: "committed",
    bundlePath,
    cwd,
    binary,
    diagnostics: [],
    providerStatus: status,
    timedOut: false,
    permissionAuthority
  };
}
