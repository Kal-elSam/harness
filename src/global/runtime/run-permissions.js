export const PERMISSION_MODES = Object.freeze({
  NORMAL: "normal",
  SAFE: "safe",
  UNSAFE: "unsafe"
});

export const CONSENT_TYPES = Object.freeze({
  NONE: "none",
  ALLOW_UNSAFE_PERMISSIONS: "allow-unsafe-permissions",
  COCKPIT_UNSAFE_CONFIRM: "cockpit-unsafe-confirm",
  CLI_CONFIRM_IMPORT: "cli-confirm-import"
});

/** Closed set of non-agent unsafe operations (import, future controlled actions). */
export const UNSAFE_OPERATIONS = Object.freeze({
  GENTLE_BUNDLE_IMPORT: "gentle-bundle-import"
});

const UNSAFE = new Set(["force", "yolo"]);
const SAFE = new Set(["read-only"]);

/** Canonical permission modes each adapter may accept (empty = normal always ok). */
export const ADAPTER_PERMISSION_MODES = Object.freeze({
  pi: Object.freeze(["read-only"]),
  codex: Object.freeze(["yolo"]),
  claude: Object.freeze(["force", "yolo"]),
  cursor: Object.freeze(["force", "yolo"]),
  opencode: Object.freeze(["force"])
});

export class PermissionAuthorityError extends Error {
  constructor(message, { code = "permission_authority", details = null } = {}) {
    super(message);
    this.name = "PermissionAuthorityError";
    this.code = code;
    this.details = details;
  }
}

function canonicalizeToken(raw) {
  const token = String(raw ?? "").trim().toLowerCase();
  if (!token) return null;
  if (token === "all" || token === "force") return "force";
  if (token === "yolo" || token.startsWith("dangerously-")) return "yolo";
  if (token === "read-only") return "read-only";
  throw new PermissionAuthorityError(`Unknown permission "${raw}".`, {
    code: "unknown_permission", details: { permission: raw }
  });
}

/** Normalize aliases; reject unknown tokens. Dedupes preserving force/yolo/read-only order. */
export function normalizePermissions(permissions = []) {
  if (!Array.isArray(permissions)) {
    throw new PermissionAuthorityError("Permissions must be an array.", {
      code: "invalid_permissions"
    });
  }
  const seen = new Set();
  const out = [];
  for (const entry of permissions) {
    const token = canonicalizeToken(entry);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

export function classifyPermissionMode(normalized = []) {
  if (normalized.some((p) => UNSAFE.has(p))) return PERMISSION_MODES.UNSAFE;
  if (normalized.some((p) => SAFE.has(p))) return PERMISSION_MODES.SAFE;
  return PERMISSION_MODES.NORMAL;
}

/** Profile defaults may only be empty or safe — never force/yolo/aliases. */
export function validateDefaultPermissions(defaultPermissions) {
  if (defaultPermissions == null) return [];
  const normalized = normalizePermissions(defaultPermissions);
  if (normalized.some((p) => UNSAFE.has(p))) {
    throw new PermissionAuthorityError(
      "Profile defaultPermissions cannot include unsafe modes (force/yolo/all/dangerously-*). "
      + "Pass them per run with --allow-unsafe-permissions.",
      { code: "unsafe_default_permissions", details: { defaultPermissions: normalized } }
    );
  }
  return normalized;
}

function resolveConsent({ mode, source, allowUnsafePermissions, consentType }) {
  if (mode !== PERMISSION_MODES.UNSAFE) return CONSENT_TYPES.NONE;
  if (consentType) return consentType;
  if (source === "cockpit") return CONSENT_TYPES.COCKPIT_UNSAFE_CONFIRM;
  if (allowUnsafePermissions) return CONSENT_TYPES.ALLOW_UNSAFE_PERMISSIONS;
  return CONSENT_TYPES.NONE;
}

/**
 * Fail-closed permission authority for startRun.
 * Unsafe modes require explicit allowUnsafePermissions (CLI) or cockpit confirm.
 */
export function authorizeRunPermissions({
  permissions = [],
  agentId,
  allowUnsafePermissions = false,
  source = "cli",
  consentType = null
} = {}) {
  const normalized = normalizePermissions(permissions);
  const mode = classifyPermissionMode(normalized);

  if (mode === PERMISSION_MODES.UNSAFE && !allowUnsafePermissions) {
    throw new PermissionAuthorityError(
      `Unsafe permissions (${normalized.join(", ")}) require --allow-unsafe-permissions `
      + "(or an explicit Cockpit unsafe confirmation).",
      { code: "unsafe_consent_required", details: { permissions: normalized, source } }
    );
  }

  const supported = new Set(ADAPTER_PERMISSION_MODES[agentId] ?? []);
  for (const token of normalized) {
    if (!supported.has(token)) {
      throw new PermissionAuthorityError(
        `Permission "${token}" is not supported by adapter "${agentId}". `
        + `Supported: ${[...supported].join(", ") || "(none)"}.`,
        {
          code: "unsupported_permission",
          details: { permission: token, agentId, supported: [...supported] }
        }
      );
    }
  }

  const consent = resolveConsent({ mode, source, allowUnsafePermissions, consentType });
  return {
    permissions: normalized,
    permissionAuthority: {
      mode,
      source: source === "cockpit" ? "cockpit" : "cli",
      consent
    }
  };
}

/** Map normalized permissions to common CLI flags (force/yolo). */
export function buildPermissionsArgs(permissions = []) {
  const normalized = normalizePermissions(permissions);
  if (normalized.includes("force")) return ["--force"];
  if (normalized.includes("yolo")) return ["--dangerously-skip-permissions"];
  return [];
}

/**
 * Generic fail-closed authority for unsafe non-agent operations (e.g. Gentle import).
 * Does not use agentId / run permissions — callers assert explicit confirmed consent.
 */
export function authorizeUnsafeOperation({
  operation,
  confirmed = false,
  source = "cli",
  consentType = null
} = {}) {
  const known = new Set(Object.values(UNSAFE_OPERATIONS));
  if (!known.has(operation)) {
    throw new PermissionAuthorityError(`Unknown unsafe operation "${operation}".`, {
      code: "unknown_unsafe_operation",
      details: { operation }
    });
  }
  if (!confirmed) {
    throw new PermissionAuthorityError(
      `Unsafe operation "${operation}" requires explicit confirmation.`,
      { code: "import_consent_required", details: { operation, source } }
    );
  }
  const consent = consentType ?? CONSENT_TYPES.CLI_CONFIRM_IMPORT;
  return {
    operation,
    permissionAuthority: {
      mode: PERMISSION_MODES.UNSAFE,
      source: source === "cockpit" ? "cockpit" : "cli",
      consent,
      operation
    }
  };
}
