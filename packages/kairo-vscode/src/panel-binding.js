"use strict";

const REGISTRATION_REPAIR_IDS = Object.freeze(["repair-integration"]);
const BOUND_STATES = Object.freeze(["bound", "registered"]);

function isRegistrationRepairAction(action) {
  if (!action || typeof action !== "object") return false;
  if (REGISTRATION_REPAIR_IDS.includes(action.id)) return true;
  const command = typeof action.command === "string" ? action.command : "";
  return /\bmcp install\b/.test(command);
}

function isBoundState(state) {
  return BOUND_STATES.includes(state);
}

function recovery(id, label) {
  return { id, label, command: null, primary: true };
}

function attentionResult({ state, code, recovery, message, reason = null, writable = false }) {
  return {
    known: true,
    state,
    writable,
    code,
    recovery,
    attention: { id: "workspace-binding", severity: "warning", message },
    reason
  };
}

/**
 * Panel-facing write identity from observed native registration, not typeof stubs.
 */
function describeWorkspaceBinding(context) {
  if (!context || typeof context !== "object") {
    return {
      known: false, state: null, writable: true, code: null, recovery: null, attention: null, reason: null
    };
  }
  const folders = Array.isArray(context.folders) ? context.folders : [];
  const registration = context.registration && typeof context.registration === "object"
    ? context.registration
    : {};
  const reason = typeof registration.reason === "string" ? registration.reason : null;
  const regState = typeof registration.state === "string" ? registration.state : null;

  if (folders.length > 1 || regState === "ambiguous" || reason === "multi_root") {
    return attentionResult({
      state: "ambiguous",
      code: "workspace_ambiguous",
      recovery: recovery("open-folder", "Open single folder"),
      message: "Writes are blocked: this window has multiple folders. Open a single-folder workspace. mcp.json registration is not the fix."
    });
  }
  if (reason === "api_unavailable") {
    return attentionResult({
      state: "unbound",
      code: "workspace_unbound",
      reason,
      recovery: recovery("upgrade-cursor", "Upgrade Cursor"),
      message: "This Cursor build cannot register workspace MCP. Upgrade Cursor — Reload Window / mcp install will not bind writes."
    });
  }
  if (reason === "runtime_unavailable") {
    return attentionResult({
      state: "unbound",
      code: "workspace_unbound",
      reason,
      recovery: recovery("reload-window", "Reload Window"),
      message: "Node.js 20+ is required to bind workspace MCP. Install Node 20+, then Reload Window. PATH kairo / mcp install will not bind writes."
    });
  }
  if (reason === "register_failed" || regState === "registration_failed") {
    return attentionResult({
      state: "unbound",
      code: "workspace_unbound",
      reason: "register_failed",
      recovery: recovery("reload-window", "Reload Window"),
      message: "Workspace MCP registration failed. Retry with Reload Window. Do not Repair via mcp install."
    });
  }
  if (reason === "workspace_untrusted") {
    return attentionResult({
      state: "unbound",
      code: "workspace_unbound",
      reason,
      recovery: recovery("trust-workspace", "Trust Workspace"),
      message: "Writes are blocked until this workspace is trusted. Trust Workspace — mcp install will not bind writes."
    });
  }
  if (reason === "unsupported_scheme") {
    return attentionResult({
      state: "unbound",
      code: "workspace_unbound",
      reason,
      recovery: recovery("open-folder", "Open single folder"),
      message: "Writes are blocked: this window is not a local file folder."
    });
  }
  if (regState === "registering") {
    return {
      known: true,
      state: "unbound",
      writable: false,
      code: null,
      recovery: null,
      attention: null,
      reason: "registering"
    };
  }
  if (regState === "registered") {
    return {
      known: true,
      state: "bound",
      writable: true,
      code: null,
      recovery: null,
      attention: null,
      reason: null,
      label: "Bound"
    };
  }
  return attentionResult({
    state: "unbound",
    code: "workspace_unbound",
    reason: reason ?? (folders.length === 0 ? "empty_window" : "unregistered"),
    recovery: recovery("open-folder", folders.length === 0 ? "Open folder" : "Open single folder"),
    message: folders.length === 0
      ? "Writes are blocked: this window has no folder. Open a single-folder workspace. Do not Repair via mcp install."
      : "Workspace MCP is not registered in this window. Open a single-folder workspace. Do not Repair via mcp install."
  });
}

function applyWorkspaceBinding(model, context) {
  const binding = describeWorkspaceBinding(context);
  const next = { ...model, workspaceBinding: binding };
  if (!binding.known || isBoundState(binding.state)) return next;
  if (binding.reason === "registering") {
    next.actions = (model.actions ?? []).filter((action) => !isRegistrationRepairAction(action));
    return next;
  }

  if (model.overall !== "missing" && model.headline !== "Not installed") {
    next.headline = "Needs attention";
  }
  next.actions = (model.actions ?? []).filter((action) => !isRegistrationRepairAction(action));
  if (binding.recovery) {
    next.actions = [
      binding.recovery,
      ...next.actions.filter((action) => action.id !== binding.recovery.id)
    ];
  }
  if (!binding.attention) return next;
  const attention = model.attention && typeof model.attention === "object"
    ? model.attention
    : { items: [] };
  const rest = (attention.items ?? []).filter((item) => item?.id !== "workspace-binding");
  next.attention = { ...attention, items: [binding.attention, ...rest] };
  return next;
}

module.exports = {
  describeWorkspaceBinding,
  applyWorkspaceBinding,
  isRegistrationRepairAction,
  isBoundState
};
