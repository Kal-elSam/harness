import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod";
import { resolveHomeDir } from "../paths.js";
import { buildControlPlaneSnapshot } from "../control-plane-snapshot.js";
import { listRunRecords } from "../runtime/run-store.js";
import { listAlerts } from "../runtime/alerts/alert-store.js";
import { listReviewReceipts } from "../runtime/review/review-receipts.js";
import { buildCompanionSnapshot } from "../observability/build-companion-snapshot.js";
import { probeGentle } from "../observability/gentle-probe.js";
import { runGraphifyOp } from "../observability/graphify-ops.js";
import { resolveGitHeadSha } from "../observability/graphify-probe.js";
import { runPassiveObservabilitySnapshot } from "../observability/passive-snapshot-flight.js";
import { inspectEngramIntegration } from "../integrations/engram-evidence.js";
import { buildFleetReport } from "../observability/fleet-probe.js";
import {
  createPublishWorkSnapshotHandler,
  workSnapshotPublishSchema
} from "./work-snapshot-tool.js";
import { resolveMcpWorkspaceCwd } from "./resolve-mcp-workspace.js";
import {
  WORKSPACE_BINDING_CODES,
  resolveWorkspaceWriteBinding
} from "./workspace-binding.js";

/** Sole MCP write tool for companion snapshots. Bound servers only. */
export const KAIRO_MCP_WRITE_TOOLS = Object.freeze(["kairo_publish_work_snapshot"]);

export const KAIRO_MCP_READ_TOOLS = Object.freeze([
  "kairo_status", "kairo_runs", "kairo_alerts", "kairo_gentle_status",
  "kairo_graph_query", "kairo_graph_path", "kairo_context_summary", "kairo_fleet"
]);

export const KAIRO_MCP_TOOLS = Object.freeze([
  ...KAIRO_MCP_READ_TOOLS,
  ...KAIRO_MCP_WRITE_TOOLS
]);

export function mcpWorkspaceBinding(deps = {}) {
  return resolveWorkspaceWriteBinding({
    workspaceBound: deps.workspaceBound === true,
    cwdExplicit: deps.cwdExplicit === true,
    cwd: deps.cwd,
    processCwd: deps.processCwd ?? process.cwd(),
    userHome: deps.userHome,
    env: deps.env ?? process.env
  });
}

const empty = z.object({});
export const mcpSchemas = Object.freeze({
  empty,
  runs: z.object({ limit: z.number().int().min(1).max(20).default(20), activeOnly: z.boolean().optional() }),
  alerts: z.object({
    limit: z.number().int().min(1).max(50).default(50),
    state: z.enum(["open", "resolved", "dismissed"]).optional()
  }),
  graphQuery: z.object({
    graph: z.string().min(1), question: z.string().min(1),
    budget: z.number().int().min(1).max(8000).default(2000)
  }),
  graphPath: z.object({ graph: z.string().min(1), from: z.string().min(1), to: z.string().min(1) }),
  workSnapshotPublish: workSnapshotPublishSchema
});

const CODE_RE = /^(?:[a-z][a-z0-9_]{0,48}|status=\d+)$/;
export const pubCodes = (xs = []) => xs.map(String).filter((d) => CODE_RE.test(d));

export function mcpResult({ ok, code, data = null, diagnostics = [], isError = false }) {
  const structuredContent = { ok, code, data, diagnostics: pubCodes(diagnostics) };
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent, ...(isError ? { isError: true } : {})
  };
}

const pubRun = (r) => ({
  runId: r?.runId ?? null, state: r?.state ?? null, agentId: r?.agentId ?? null,
  startedAt: r?.startedAt ?? null, updatedAt: r?.updatedAt ?? null,
  endedAt: r?.endedAt ?? r?.completedAt ?? null
});
const pubAlert = (a) => ({
  alertId: a?.alertId ?? null, state: a?.state ?? null, kind: a?.kind ?? null,
  severity: a?.severity ?? null, title: a?.title ?? null, createdAt: a?.createdAt ?? null
});
export const pubCoverage = (c) => (c == null ? null : {
  detectedAgents: Number(c.detectedAgents) || 0, governedAgents: Number(c.governedAgents) || 0,
  components: Number(c.components) || 0,
  activeModules: Array.isArray(c.activeModules) ? c.activeModules.map(String) : []
});
export const pubGentle = (p) => ({
  state: p?.state ?? "missing", error: null,
  diagnostics: (p?.state === "error") ? ["provider_error"] : pubCodes(p?.diagnostics)
});
export const pubSignals = (s) => ({
  gentle: { state: s?.gentle?.state ?? "missing", error: null, diagnostics: [] },
  graphify: {
    state: s?.graphify?.state ?? "missing", error: null, diagnostics: [],
    graphStatus: s?.graphify?.graphStatus ?? null
  }
});
export const pubEngram = (e) => ({ status: e?.status ?? "missing", binary: null, error: null });
const pubNext = (n) => (n == null ? null : { kind: n.kind ?? null, displayOnly: true, secondary: true });
const pubCompanion = (c) => ({
  ok: Boolean(c?.ok), signals: pubSignals(c?.signals), engram: pubEngram(c?.engram),
  nextSafeAction: pubNext(c?.nextSafeAction), alertsCount: c?.alertsCount ?? null,
  linksCount: c?.links?.length ?? 0
});
const pubLinks = (links) => (links ?? []).map((l) => ({
  kind: "soft", displayOnly: true, agentId: l.agentId ?? null,
  reviewId: l.reviewId ?? null, runId: l.runId ?? null, deltaMs: l.deltaMs ?? null
}));

function graphEnvelope(result) {
  return mcpResult({
    ok: Boolean(result.ok), code: result.ok ? "ok" : (result.code ?? "graphify_error"),
    data: {
      op: result.op ?? null, text: result.ok ? (result.text ?? null) : null, truncated: Boolean(result.truncated),
      graphPath: result.graphPath ?? null, graphStatus: result.graphStatus ?? null
    },
    diagnostics: result.diagnostics ?? [], isError: !result.ok
  });
}

export function createToolHandlers(deps = {}) {
  const homeDir = deps.homeDir ?? resolveHomeDir();
  const env = deps.env ?? process.env;
  const binding = mcpWorkspaceBinding({ ...deps, env });
  const cwd = binding.writable
    ? binding.cwd
    : resolveMcpWorkspaceCwd({
      cwd: deps.cwdExplicit === true ? deps.cwd : (binding.bound ? undefined : deps.cwd),
      env: binding.bound ? {} : env
    });
  const listRuns = deps.listRuns ?? ((o) => listRunRecords(homeDir, o));
  const listAlertRows = deps.listAlerts ?? ((o) => listAlerts({ homeDir, ...o }));
  const listReviews = deps.listReviews ?? (() => listReviewReceipts({ homeDir, limit: 20 }));
  const buildStatus = deps.buildStatus ?? (() => buildControlPlaneSnapshot({
    homeDir, workspaceRoot: cwd, packageRoot: deps.packageRoot, packageName: deps.packageName,
    cliVersion: deps.version, includeDiff: false, includeExplain: false, includeRuntime: true
  }));
  const resolveHead = deps.resolveHead ?? ((dir) => resolveGitHeadSha(dir));
  /** Fresh HEAD per request/snapshot — never cache across MCP tool calls. */
  const requestHead = () => resolveHead(cwd);
  const buildObs = deps.buildObservability
    ?? ((ctx) => runPassiveObservabilitySnapshot(ctx, { force: Boolean(ctx?.force) }));
  const buildCompanion = deps.buildCompanion ?? ((ctx) => buildCompanionSnapshot({
    ...ctx,
    inspectEngram: deps.inspectEngram ?? ((c) => inspectEngramIntegration(c)),
    loadAlerts: async () => listAlertRows({ limit: 50 }),
    loadReviews: async () => listReviews(),
    buildObservability: buildObs,
    ensureRegistered: deps.ensureRegistered,
    observabilityContext: { cwd, homeDir, workspaceRoot: cwd, headSha: requestHead() }
  }));
  const gentleProbe = deps.probeGentle ?? ((ctx) => probeGentle(ctx));
  const fleetProbe = deps.buildFleet ?? ((ctx) => buildFleetReport(ctx));
  const graphOp = deps.runGraphifyOp ?? runGraphifyOp;
  const gOpts = () => ({
    cwd, workspaceRoot: cwd, headSha: requestHead(), whichCommand: deps.whichCommand,
    probeCommand: deps.probeCommand, containPath: deps.containPath,
    inspectGraph: deps.inspectGraph, resolveHead
  });
  const soft = (code, data) => mcpResult({
    ok: true, code, data,
    diagnostics: code === "degraded" ? [`${Object.keys(data)[0]}_unavailable`] : []
  });
  const graphFail = () => mcpResult({
    ok: false, code: "provider_error", data: null, diagnostics: ["provider_error"], isError: true
  });

  return {
    async kairo_status() {
      try {
        const snap = await buildStatus();
        const runs = await listRuns({ limit: 20, activeOnly: false }).catch(() => []);
        const companion = await buildCompanion({ controlPlaneHealth: snap?.health ?? null, runs });
        return mcpResult({
          ok: true, code: "ok",
          data: {
            health: snap?.health ?? null, coverage: pubCoverage(snap?.coverage),
            cta: snap?.cta ? { kind: snap.cta.kind ?? null } : null,
            companion: pubCompanion(companion)
          }
        });
      } catch { return soft("degraded", { health: null, coverage: null, companion: null }); }
    },
    async kairo_runs({ limit = 20, activeOnly = false } = {}) {
      try {
        return mcpResult({ ok: true, code: "ok", data: { runs: (await listRuns({ limit, activeOnly: Boolean(activeOnly) })).map(pubRun) } });
      } catch { return soft("degraded", { runs: [] }); }
    },
    async kairo_alerts({ limit = 50, state } = {}) {
      try {
        return mcpResult({ ok: true, code: "ok", data: { alerts: (await listAlertRows({ limit, state: state ?? null })).map(pubAlert) } });
      } catch { return soft("degraded", { alerts: [] }); }
    },
    async kairo_gentle_status() {
      try {
        const probe = pubGentle(await gentleProbe({ cwd, homeDir, workspaceRoot: cwd }));
        return mcpResult({
          ok: true, code: probe.state === "available" ? "ok" : "degraded", data: probe,
          diagnostics: probe.state === "missing" ? ["gentle_missing"] : []
        });
      } catch {
        return mcpResult({
          ok: true, code: "degraded", data: { state: "missing", error: null, diagnostics: [] },
          diagnostics: ["gentle_unavailable"]
        });
      }
    },
    async kairo_graph_query({ graph, question, budget = 2000 }) {
      try {
        return graphEnvelope(await graphOp({
          op: "query", args: [question], graphPath: graph, budget, ...gOpts()
        }));
      } catch { return graphFail(); }
    },
    async kairo_graph_path({ graph, from, to }) {
      try {
        return graphEnvelope(await graphOp({
          op: "path", args: [from, to], graphPath: graph, ...gOpts()
        }));
      } catch { return graphFail(); }
    },
    async kairo_context_summary() {
      try {
        const companion = await buildCompanion({ runs: await listRuns({ limit: 20, activeOnly: false }) });
        return mcpResult({
          ok: true, code: companion?.ok === false ? "degraded" : "ok",
          data: {
            signals: pubSignals(companion?.signals), engram: pubEngram(companion?.engram),
            links: pubLinks(companion?.links), alertsCount: companion?.alertsCount ?? null,
            nextSafeAction: pubNext(companion?.nextSafeAction)
          },
          diagnostics: companion?.ok === false ? ["companion_degraded"] : []
        });
      } catch {
        return soft("degraded", { signals: null, engram: null, links: [], alertsCount: null, nextSafeAction: null });
      }
    },
    async kairo_fleet() {
      try {
        const report = await fleetProbe({ homeDir });
        return mcpResult({
          ok: true,
          code: "ok",
          data: {
            kind: report?.kind ?? "declared",
            note: report?.note ?? null,
            orchestratorAuthority: report?.orchestratorAuthority ?? null,
            fleets: Array.isArray(report?.fleets) ? report.fleets : [],
            activity: report?.activity ?? null,
            generatedAt: report?.generatedAt ?? null
          }
        });
      } catch {
        return soft("degraded", {
          kind: "declared", fleets: [], activity: null, note: null, orchestratorAuthority: null
        });
      }
    },
    kairo_publish_work_snapshot: async (args = {}) => {
      if (!binding.writable) {
        const code = binding.code ?? WORKSPACE_BINDING_CODES.UNBOUND;
        return mcpResult({ ok: false, code, data: null, diagnostics: [code], isError: true });
      }
      return createPublishWorkSnapshotHandler({
        homeDir,
        cwd: binding.cwd,
        now: deps.now,
        writeAtomic: deps.writeAtomic,
        publishWorkSnapshot: deps.publishWorkSnapshot,
        mcpResult
      })(args);
    }
  };
}

export function registerKairoMcpTools(registerTool, deps = {}) {
  const h = createToolHandlers(deps);
  const catalog = [
    ["kairo_status", "Read-only control-plane + companion summary", empty],
    ["kairo_runs", "Read-only run list", mcpSchemas.runs],
    ["kairo_alerts", "Read-only alert list", mcpSchemas.alerts],
    ["kairo_gentle_status", "Gentle probe / companion gentle signal", empty],
    ["kairo_graph_query", "Read-only Graphify query", mcpSchemas.graphQuery],
    ["kairo_graph_path", "Read-only Graphify path", mcpSchemas.graphPath],
    ["kairo_context_summary", "Companion + soft links + alerts count", empty],
    ["kairo_fleet", "Declared fleet topology + OpenCode live activity", empty],
    [
      "kairo_publish_work_snapshot",
      "Publish kairo.work-snapshot/v1 for the runtime workspace (enrolls conversation)",
      mcpSchemas.workSnapshotPublish
    ]
  ];
  const bound = deps.workspaceBound === true;
  for (const [name, description, inputSchema] of catalog) {
    if (bound ? !KAIRO_MCP_WRITE_TOOLS.includes(name) : KAIRO_MCP_WRITE_TOOLS.includes(name)) continue;
    registerTool(name, { description, inputSchema }, h[name]);
  }
  return h;
}

export function createKairoMcpServer(deps = {}) {
  const Server = deps.McpServer ?? McpServer;
  const server = new Server({ name: "kairo", version: deps.version ?? "0.11.0" });
  registerKairoMcpTools(deps.registerTool ?? ((n, c, h) => server.registerTool(n, c, h)), deps);
  return server;
}

export function runKairoMcp(deps = {}) {
  return (deps.serveStdio ?? serveStdio)(() => createKairoMcpServer(deps));
}
