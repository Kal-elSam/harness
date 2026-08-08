/**
 * Recommended button actions per connection chip.
 * Optional tools never block governance; Kairo does not brew-install externals.
 */
import { formatCliCommand } from "./brand/cli.js";

function action(id, label, command, kind = "run") {
  return { id, label, command, kind };
}

/** @returns {{ optional: boolean, actions: Array<{id,label,command,kind}> }} */
export function actionsForConnection(connection) {
  if (!connection || typeof connection !== "object") {
    return { optional: true, actions: [] };
  }
  const id = connection.id;
  const state = connection.state ?? "unknown";

  switch (id) {
    case "gentle":
      return {
        optional: true,
        actions: state === "available"
          ? [action("refresh", "Refresh", null, "refresh")]
          : [
            action("guide-gentle", "How to install", null, "guide"),
            action("refresh", "Refresh after install", null, "refresh")
          ]
      };
    case "hermes":
      return {
        optional: true,
        actions: state === "available"
          ? [action("refresh", "Refresh", null, "refresh")]
          : state === "unavailable" || state === "error"
            ? [
              action("guide-hermes-api", "Enable API tip", null, "guide"),
              action(
                "start-hermes",
                "Start Hermes gateway",
                "hermes gateway run",
                "configure"
              ),
              action("refresh", "Refresh", null, "refresh")
            ]
            : [
              action("guide-hermes", "How to install", null, "guide"),
              action("refresh", "Refresh after install", null, "refresh")
            ]
      };
    case "engram":
      return {
        optional: true,
        actions: state === "configured"
          ? [action("refresh", "Refresh", null, "refresh")]
          : state === "missing"
            ? [
              action("guide-engram", "How to install", null, "guide"),
              action("refresh", "Refresh after install", null, "refresh")
            ]
            : [
              action(
                "configure-engram",
                "Configure Engram",
                formatCliCommand("components configure engram-memory --dry-run"),
                "configure"
              ),
              action("refresh", "Refresh", null, "refresh")
            ]
      };
    case "graphify": {
      const wantsUpdate = state === "stale"
        || /graphify update/i.test(connection.detail ?? "")
        || /No graphify-out/i.test(connection.detail ?? "");
      const wantsInstall = state === "missing"
        || /Install graphify/i.test(connection.detail ?? "");
      return {
        optional: true,
        actions: wantsInstall
          ? [
            action("guide-graphify", "How to install", null, "guide"),
            action("refresh", "Refresh after install", null, "refresh")
          ]
          : wantsUpdate
            ? [
              action("update-graph", "Update graph", "graphify update .", "configure"),
              action("refresh", "Refresh", null, "refresh")
            ]
            : [action("refresh", "Refresh", null, "refresh")]
      };
    }
    case "agent":
      return {
        optional: false,
        actions: state === "connected"
          ? [action("refresh", "Refresh", null, "refresh")]
          : [
            action("connect-agent", "Connect Agent", formatCliCommand("mcp install"), "configure"),
            action("refresh", "Refresh", null, "refresh")
          ]
      };
    default:
      return { optional: true, actions: [] };
  }
}

export function enrichConnection(connection) {
  const { optional, actions } = actionsForConnection(connection);
  return {
    ...connection,
    optional,
    actions
  };
}

/** Top-level panel buttons that are not chip-specific. */
export function buildSetupActions({ needsAttention = false, agentConnected = false } = {}) {
  const actions = [];
  actions.push({
    id: "setup",
    label: "Setup",
    command: formatCliCommand("setup"),
    primary: !needsAttention && !agentConnected,
    detail: "Detect agents you use (Cursor, Codex, Claude, …) and prepare only those."
  });
  if (needsAttention) {
    actions.push({
      id: "repair",
      label: "Repair",
      command: formatCliCommand("sync"),
      primary: true
    });
  }
  if (!agentConnected) {
    actions.push({
      id: "connect-agent",
      label: "Connect Agent",
      command: formatCliCommand("mcp install"),
      primary: !needsAttention
    });
  }
  actions.push(
    { id: "doctor", label: "Doctor", command: formatCliCommand("doctor"), primary: false },
    { id: "refresh", label: "Refresh", command: null, primary: false }
  );
  return actions;
}
