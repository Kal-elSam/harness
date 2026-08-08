/**
 * Connection chips for IDE panel / CLI — companion probes + agent MCP registration.
 * Read-only; never mutates configs.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { resolveHomeDir } from "./paths.js";
import { buildCompanionSnapshot } from "./observability/build-companion-snapshot.js";
import { runPassiveObservabilitySnapshot } from "./observability/passive-snapshot-flight.js";
import { inspectEngramIntegration } from "./integrations/engram-evidence.js";
import { resolveGitHeadSha } from "./observability/graphify-probe.js";
import { enrichConnection } from "./connection-actions.js";
import { buildFleetReport } from "./observability/fleet-probe.js";

export const CONNECTION_ACCESS = Object.freeze({
  gentle: "Probe contract; export/import review bundles (import needs consent).",
  hermes: "Read-only: sessions via loopback API. Never runs hermes doctor/status.",
  engram: "Disk evidence + engram version; setup needs consent.",
  graphify: "Read-only: query, path, explain on workspace graph.",
  agent: "MCP tools for Cursor agents (status, runs, alerts, graph)."
});

export const MCP_CLIENTS = Object.freeze({
  cursor: {
    id: "cursor",
    label: "Cursor",
    configRelativePath: join(".cursor", "mcp.json")
  }
});

function chip(id, label, state, access, detail) {
  return enrichConnection({
    id,
    label,
    state: typeof state === "string" && state ? state : "unknown",
    access,
    detail: typeof detail === "string" && detail ? detail : ""
  });
}

function gentleDetail(state) {
  switch (state) {
    case "available":
      return "Gentle AI is available for review-bundle export/import.";
    case "missing":
      return "Install gentle-ai separately, then Refresh.";
    case "incompatible":
      return "Gentle is present but the review contract is incompatible.";
    case "error":
      return "Gentle probe failed. Check PATH and try Doctor.";
    default:
      return `Gentle state: ${state}.`;
  }
}

function hermesDetail(state) {
  switch (state) {
    case "available":
      return "Hermes loopback API is reachable; sessions are read-only.";
    case "missing":
      return "Install Hermes Agent separately, then Refresh.";
    case "auth_required":
      return "Hermes API requires auth (KAIRO_HERMES_API_KEY).";
    case "incompatible":
      return "Hermes is present but the local API contract is incompatible.";
    case "unavailable":
    case "error":
      return "Hermes binary found, but loopback API (http://127.0.0.1:8642) is down. Everyday chat is `hermes` (see https://hermes-ai.net/es/docs/quickstart/). For the Kairo chip: set API_SERVER_ENABLED=true in ~/.hermes/.env, run hermes gateway run, then Refresh. Optional.";
    default:
      return `Hermes state: ${state}.`;
  }
}

function engramDetail(status) {
  switch (status) {
    case "configured":
      return "Engram integration evidence looks configured on disk.";
    case "available":
      return "Engram binary found; some agents still need configure.";
    case "unconfigured":
      return "Engram binary found; configure via Settings or components configure.";
    case "missing":
      return "Engram not detected. Optional memory — governance still works.";
    case "conflict":
      return "Engram config conflict. Open Settings → Engram.";
    case "restart_required":
      return "Engram config written; restart the agent to activate MCP tools.";
    case "unsupported":
      return "Engram version unsupported by this Kairo contract.";
    case "error":
      return "Engram inspection failed.";
    default:
      return `Engram status: ${status}.`;
  }
}

function graphifyDetail(state, graphStatus) {
  if (graphStatus === "stale") {
    return "Graph exists but may be stale vs git HEAD. Run graphify update .";
  }
  if (graphStatus === "missing") {
    return "No graphify-out/graph.json. Run graphify update . in the workspace.";
  }
  if (state === "available" && (graphStatus === "ok" || graphStatus == null)) {
    return "Graphify CLI available; graph ready for query/path/explain.";
  }
  if (state === "missing") {
    return "Install graphify separately, then Refresh.";
  }
  if (state === "error" || graphStatus === "error" || graphStatus === "malformed") {
    return "Graphify probe failed or graph is malformed.";
  }
  return `Graphify state: ${state}${graphStatus ? ` / ${graphStatus}` : ""}.`;
}

export function resolveMcpConfigPath(client = "cursor", { homeDir = homedir() } = {}) {
  const entry = MCP_CLIENTS[client] ?? MCP_CLIENTS.cursor;
  return join(homeDir, entry.configRelativePath);
}

/**
 * Read-only: is Kairo registered under mcpServers.kairo for the client?
 */
export async function detectAgentMcpRegistration({
  client = "cursor",
  homeDir = homedir(),
  readFileFn = readFile
} = {}) {
  const path = resolveMcpConfigPath(client, { homeDir });
  try {
    const raw = await readFileFn(path, "utf8");
    const parsed = JSON.parse(raw);
    const entry = parsed?.mcpServers?.kairo;
    if (entry && typeof entry === "object") {
      return {
        connected: true,
        state: "connected",
        path,
        detail: `Kairo MCP registered in ${path}. Reload Cursor MCP if tools are missing.`
      };
    }
    return {
      connected: false,
      state: "not_connected",
      path,
      detail: "Kairo MCP is not registered. Click Connect Agent (opens kairo mcp install)."
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        connected: false,
        state: "not_connected",
        path,
        detail: "No Cursor MCP config yet. Click Connect Agent to create one."
      };
    }
    return {
      connected: false,
      state: "error",
      path,
      detail: `Could not read ${path}: ${error?.message ?? error}`
    };
  }
}

/**
 * Pure adapter: companion snapshot (+ optional agent registration) → connection chips.
 */
export function mapCompanionToConnections(companion = {}, agent = null) {
  const gentleState = companion?.signals?.gentle?.state ?? "missing";
  const hermesState = companion?.signals?.hermes?.activity?.state
    ?? companion?.signals?.hermes?.state
    ?? "missing";
  const engramStatus = companion?.engram?.status ?? "missing";
  const graphifyState = companion?.signals?.graphify?.state ?? "missing";
  const graphStatus = companion?.signals?.graphify?.graphStatus ?? null;

  const connections = [
    chip("gentle", "Gentle", gentleState, CONNECTION_ACCESS.gentle, gentleDetail(gentleState)),
    chip("hermes", "Hermes", hermesState, CONNECTION_ACCESS.hermes, hermesDetail(hermesState)),
    chip("engram", "Engram", engramStatus, CONNECTION_ACCESS.engram, engramDetail(engramStatus)),
    chip(
      "graphify",
      "Graphify",
      graphStatus === "stale" ? "stale" : graphifyState,
      CONNECTION_ACCESS.graphify,
      graphifyDetail(graphifyState, graphStatus)
    )
  ];

  if (agent) {
    connections.push(chip(
      "agent",
      "Agent",
      agent.state ?? (agent.connected ? "connected" : "not_connected"),
      CONNECTION_ACCESS.agent,
      agent.detail ?? ""
    ));
  }

  return connections;
}

export async function buildConnectionsReport({
  homeDir = resolveHomeDir(),
  workspaceRoot = process.cwd(),
  client = "cursor",
  packageRoot = null,
  packageName = null,
  cliVersion = null,
  buildCompanion = buildCompanionSnapshot,
  buildObservability = (ctx) => runPassiveObservabilitySnapshot(ctx),
  inspectEngram = inspectEngramIntegration,
  detectAgent = detectAgentMcpRegistration,
  resolveHead = resolveGitHeadSha,
  buildFleet = buildFleetReport
} = {}) {
  const cwd = workspaceRoot ?? process.cwd();
  const headSha = typeof resolveHead === "function" ? resolveHead(cwd) : null;
  const companion = await buildCompanion({
    inspectEngram: (ctx) => inspectEngram({ homeDir, ...(ctx ?? {}) }),
    buildObservability,
    observabilityContext: {
      cwd,
      homeDir,
      workspaceRoot: cwd,
      headSha,
      packageRoot,
      packageName,
      cliVersion
    }
  });
  const agent = await detectAgent({ client, homeDir });
  const connections = mapCompanionToConnections(companion, agent);
  const fleet = typeof buildFleet === "function"
    ? await buildFleet({ homeDir })
    : { ok: true, fleets: [] };
  return {
    ok: companion?.ok !== false,
    generatedAt: companion?.generatedAt ?? new Date().toISOString(),
    client,
    connections,
    fleets: fleet?.fleets ?? [],
    activity: fleet?.activity ?? null,
    fleetNote: fleet?.note ?? "Declared config topology — not live token usage.",
    orchestratorAuthority: fleet?.orchestratorAuthority ?? null
  };
}
