/**
 * kairo.next/v1 — selected work snapshot + honest integration state for the panel.
 * Never invents Goal/Progress/Now/Blockers/Next when data is absent or corrupt.
 */
import { detectAgentMcpRegistration } from "../connections.js";
import { resolveHomeDir } from "../paths.js";
import { loadEnrollment } from "./work-enroll.js";
import {
  listWorkSnapshots,
  snapshotIsComplete
} from "./work-snapshot.js";

export const NEXT_SCHEMA = "kairo.next/v1";

export const INTEGRATION_STATE = Object.freeze({
  MISSING: "missing",
  READY: "ready",
  ACTIVE: "active",
  BROKEN: "broken"
});

function teamFromDelegations(delegations) {
  if (!Array.isArray(delegations) || delegations.length === 0) return undefined;
  const members = delegations
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const title = typeof row.title === "string" ? row.title.slice(0, 160) : null;
      const workId = typeof row.workId === "string" ? row.workId : null;
      if (!title && !workId) return null;
      return {
        ...(workId ? { workId } : {}),
        ...(title ? { title } : {}),
        ...(row.role ? { role: row.role } : {}),
        ...(row.state ? { state: row.state } : {})
      };
    })
    .filter(Boolean);
  return members.length > 0 ? { members } : undefined;
}

export function resolveIntegrationState({ mcp, hasUsableSnapshot }) {
  if (mcp?.state === "error") {
    return {
      state: INTEGRATION_STATE.BROKEN,
      mcpConnected: false,
      showRepair: true,
      detail: mcp.detail ?? "MCP configuration could not be read."
    };
  }
  if (!mcp?.connected) {
    return {
      state: INTEGRATION_STATE.MISSING,
      mcpConnected: false,
      showRepair: false,
      detail: mcp?.detail ?? "Kairo MCP is not registered."
    };
  }
  if (hasUsableSnapshot) {
    return {
      state: INTEGRATION_STATE.ACTIVE,
      mcpConnected: true,
      showRepair: false,
      detail: "MCP connected with a usable work snapshot."
    };
  }
  return {
    state: INTEGRATION_STATE.READY,
    mcpConnected: true,
    showRepair: false,
    detail: "MCP connected; waiting for a published work snapshot."
  };
}

function viewFromSnapshot(snapshot) {
  if (!snapshot) {
    return {
      goal: null,
      progress: [],
      now: null,
      blockers: [],
      next: null,
      conversationId: null,
      updatedAt: null
    };
  }
  const team = teamFromDelegations(snapshot.delegations);
  return {
    goal: snapshot.goal ?? null,
    progress: Array.isArray(snapshot.progress) ? snapshot.progress : [],
    now: snapshot.now ?? null,
    blockers: Array.isArray(snapshot.blockers) ? snapshot.blockers : [],
    next: snapshot.next ?? null,
    conversationId: snapshot.conversationId ?? null,
    updatedAt: snapshot.updatedAt ?? null,
    ...(team ? { team } : {})
  };
}

/**
 * Build the next report for the runtime workspace (deps.cwd / process.cwd()).
 */
export async function buildNextReport({
  homeDir = resolveHomeDir(),
  cwd = process.cwd(),
  provider = "cursor",
  client = "cursor",
  detectAgent = detectAgentMcpRegistration,
  listSnapshots = listWorkSnapshots,
  loadEnrollmentFn = loadEnrollment
} = {}) {
  const mcp = await detectAgent({ client, homeDir });
  const listed = await listSnapshots(homeDir, cwd);
  // Prefer newest complete snapshot — incomplete records must not hide valid work.
  const snapshot = listed.find((row) => snapshotIsComplete(row)) ?? null;
  const complete = snapshotIsComplete(snapshot);
  const integrationCore = resolveIntegrationState({
    mcp,
    hasUsableSnapshot: complete
  });
  const view = viewFromSnapshot(snapshot);

  let enrolled = false;
  if (view.conversationId) {
    const enrollment = await loadEnrollmentFn(homeDir, cwd, view.conversationId);
    enrolled = Boolean(enrollment);
  }

  return {
    schema: NEXT_SCHEMA,
    ok: integrationCore.state !== INTEGRATION_STATE.BROKEN,
    ...view,
    integration: {
      state: integrationCore.state,
      provider,
      client,
      mcpConnected: integrationCore.mcpConnected,
      enrolled,
      showRepair: integrationCore.showRepair === true,
      detail: integrationCore.detail
    },
    diagnostics: integrationCore.state === INTEGRATION_STATE.BROKEN
      ? ["integration_broken"]
      : []
  };
}
