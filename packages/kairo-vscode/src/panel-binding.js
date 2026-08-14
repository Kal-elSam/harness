"use strict";

const { planWorkspaceMcpServer } = require("./workspace-mcp");

const REGISTRATION_REPAIR_IDS = Object.freeze(["repair-integration"]);

function isRegistrationRepairAction(action) {
  if (!action || typeof action !== "object") return false;
  if (REGISTRATION_REPAIR_IDS.includes(action.id)) return true;
  const command = typeof action.command === "string" ? action.command : "";
  return /\bmcp install\b/.test(command);
}

function recoveryOpenFolder(label) {
  return { id: "open-folder", label, command: null, primary: true };
}

function unboundResult({ recovery, message, reason = null }) {
  return {
    known: true,
    state: "unbound",
    writable: false,
    code: "workspace_unbound",
    recovery,
    attention: { id: "workspace-binding", severity: "warning", message },
    reason
  };
}

/**
 * Panel-facing write identity from observed registration, not live PID.
 * API + single-root alone is never "ready".
 *
 * @param {{ folders?: unknown, mcpApiAvailable?: boolean, providerRegistered?: boolean } | null | undefined} context
 */
function describeWorkspaceBinding(context) {
  if (!context || typeof context !== "object") {
    return {
      known: false, state: null, writable: true, code: null, recovery: null, attention: null, reason: null
    };
  }
  const folders = Array.isArray(context.folders) ? context.folders : [];
  if (folders.length > 1) {
    return {
      known: true,
      state: "ambiguous",
      writable: false,
      code: "workspace_ambiguous",
      recovery: recoveryOpenFolder("Open single folder"),
      attention: {
        id: "workspace-binding",
        severity: "warning",
        message: "Writes are blocked: this window has multiple folders. Open a single-folder workspace. mcp.json registration is not the fix."
      },
      reason: null
    };
  }
  if (context.mcpApiAvailable === false) {
    return unboundResult({
      reason: "api_unavailable",
      recovery: { id: "upgrade-cursor", label: "Upgrade Cursor", command: null, primary: true },
      message: "This Cursor build cannot register workspace MCP. Upgrade Cursor — Reload Window / mcp install will not bind writes."
    });
  }
  if (context.providerRegistered === true && folders.length === 1 && planWorkspaceMcpServer(folders).register) {
    return {
      known: true, state: "ready", writable: true, code: null, recovery: null, attention: null, reason: null
    };
  }
  return unboundResult({
    reason: context.providerRegistered === true ? null : "unregistered",
    recovery: recoveryOpenFolder("Open folder"),
    message: folders.length === 0
      ? "Writes are blocked: this window has no folder. Open a single-folder workspace. Do not Repair via mcp install."
      : "Workspace MCP is not registered in this window. Open a single-folder workspace. Do not Repair via mcp install."
  });
}

function applyWorkspaceBinding(model, context) {
  const binding = describeWorkspaceBinding(context);
  const next = { ...model, workspaceBinding: binding };
  if (!binding.known || binding.state === "ready") return next;

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
  isRegistrationRepairAction
};
