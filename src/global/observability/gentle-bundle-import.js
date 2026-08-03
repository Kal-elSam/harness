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

  const provider = probeCommand(binary, [
    "review-bundle-import", "--cwd", cwd, "--bundle", bundlePath
  ], { cwd, env, timeoutMs: IMPORT_TIMEOUT_MS });

  if (!provider.ok) {
    const diagnostics = ["provider_error"];
    if (provider.timedOut) diagnostics.push("timed_out");
    if (provider.status != null) diagnostics.push(`status=${provider.status}`);
    return fail("mutation_outcome_unknown", diagnostics, {
      mutationOutcome: "unknown",
      bundlePath,
      cwd,
      binary,
      permissionAuthority,
      providerStatus: provider.status ?? null,
      timedOut: Boolean(provider.timedOut)
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
    providerStatus: provider.status,
    timedOut: false,
    permissionAuthority
  };
}
