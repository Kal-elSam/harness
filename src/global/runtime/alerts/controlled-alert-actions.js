import {
  CONSENT_TYPES,
  PermissionAuthorityError,
  UNSAFE_OPERATIONS,
  authorizeUnsafeOperation as defaultAuthorize
} from "../run-permissions.js";
import { dismissAlert, resolveAlert } from "./alert-store.js";

function fail(code, message, permissionAuthority = null) {
  return { ok: false, code, message, alert: null, permissionAuthority, diagnostics: [code] };
}

async function runControlled({
  operation, confirmed, source, consentType, alertId, homeDir,
  authorizeUnsafeOperation = defaultAuthorize, mutate
}) {
  let permissionAuthority = null;
  try {
    ({ permissionAuthority } = authorizeUnsafeOperation({
      operation, confirmed: Boolean(confirmed), source, consentType
    }));
  } catch (error) {
    if (error instanceof PermissionAuthorityError) {
      return fail(error.code ?? "unsafe_consent_required", error.message, null);
    }
    throw error;
  }
  const alert = await mutate(alertId, { homeDir, permissionAuthority });
  return {
    ok: true, code: "ok", message: null, alert, permissionAuthority, diagnostics: []
  };
}

export async function controlledResolveAlert({
  alertId, confirmed = false, source = "cli", consentType = null, homeDir,
  authorizeUnsafeOperation, resolve = resolveAlert
} = {}) {
  return runControlled({
    operation: UNSAFE_OPERATIONS.ALERT_RESOLVE, confirmed, source, consentType, alertId, homeDir,
    authorizeUnsafeOperation,
    mutate: (id, opts) => resolve(id, opts)
  });
}

export async function controlledDismissAlert({
  alertId, confirmed = false, source = "cli", consentType = null, homeDir,
  authorizeUnsafeOperation, dismiss = dismissAlert
} = {}) {
  return runControlled({
    operation: UNSAFE_OPERATIONS.ALERT_DISMISS, confirmed, source, consentType, alertId, homeDir,
    authorizeUnsafeOperation,
    mutate: (id, opts) => dismiss(id, opts)
  });
}

export { CONSENT_TYPES, UNSAFE_OPERATIONS };
