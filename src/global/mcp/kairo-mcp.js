import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod";
import { resolveHomeDir } from "../paths.js";
import { buildControlPlaneSnapshot } from "../control-plane-snapshot.js";
import { listRunRecords } from "../runtime/run-store.js";
import { listAlerts } from "../runtime/alerts/alert-store.js";
import { buildCompanionSnapshot } from "../observability/build-companion-snapshot.js";
import { probeGentle } from "../observability/gentle-probe.js";
import { runGraphifyOp } from "../observability/graphify-ops.js";
import { inspectEngramIntegration } from "../integrations/engram-evidence.js";

export const KAIRO_MCP_TOOLS = Object.freeze([
  "kairo_status", "kairo_runs", "kairo_alerts", "kairo_gentle_status",
  "kairo_graph_query", "kairo_graph_path", "kairo_context_summary"
]);

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
  graphPath: z.object({ graph: z.string().min(1), from: z.string().min(1), to: z.string().min(1) })
});

export function mcpResult({ ok, code, data = null, diagnostics = [], isError = false }) {
  const structuredContent = { ok, code, data, diagnostics: diagnostics.map(String) };
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent,
    ...(isError ? { isError: true } : {})
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

function graphEnvelope(result) {
  const data = {
    op: result.op ?? null, text: result.text ?? null, truncated: Boolean(result.truncated),
    graphPath: result.graphPath ?? null, graphStatus: result.graphStatus ?? null
  };
  return mcpResult({
    ok: Boolean(result.ok), code: result.ok ? "ok" : (result.code ?? "graphify_error"),
    data, diagnostics: result.diagnostics ?? [], isError: !result.ok
  });
}

export function createToolHandlers(deps = {}) {
  const homeDir = deps.homeDir ?? resolveHomeDir();
  const cwd = deps.cwd ?? process.cwd();
  const listRuns = deps.listRuns ?? ((o) => listRunRecords(homeDir, o));
  const listAlertRows = deps.listAlerts ?? ((o) => listAlerts({ homeDir, ...o }));
  const buildStatus = deps.buildStatus ?? (() => buildControlPlaneSnapshot({
    homeDir, workspaceRoot: cwd, packageRoot: deps.packageRoot, packageName: deps.packageName,
    cliVersion: deps.version, includeDiff: false, includeExplain: false, includeRuntime: true
  }));
  const buildCompanion = deps.buildCompanion ?? ((ctx) => buildCompanionSnapshot({
    ...ctx,
    inspectEngram: deps.inspectEngram ?? ((c) => inspectEngramIntegration(c)),
    loadAlerts: async () => listAlertRows({ limit: 50 }),
    observabilityContext: { cwd, homeDir, workspaceRoot: cwd }
  }));
  const gentleProbe = deps.probeGentle ?? ((ctx) => probeGentle(ctx));
  const graphOp = deps.runGraphifyOp ?? runGraphifyOp;
  const graphOpts = {
    cwd, workspaceRoot: cwd, whichCommand: deps.whichCommand, probeCommand: deps.probeCommand,
    containPath: deps.containPath, inspectGraph: deps.inspectGraph
  };
  const soft = async (code, data) => mcpResult({ ok: true, code, data, diagnostics: [code === "degraded" ? `${Object.keys(data)[0]}_unavailable` : ""].filter(Boolean) });

  return {
    async kairo_status() {
      try {
        const snap = await buildStatus();
        const runs = await listRuns({ limit: 20, activeOnly: false }).catch(() => []);
        const companion = await buildCompanion({ controlPlaneHealth: snap?.health ?? null, runs });
        return mcpResult({
          ok: true, code: "ok",
          data: {
            health: snap?.health ?? null,
            cta: snap?.cta ? { kind: snap.cta.kind ?? null } : null,
            companion: {
              ok: companion?.ok ?? false, signals: companion?.signals ?? null,
              nextSafeAction: companion?.nextSafeAction ?? null,
              alertsCount: companion?.alertsCount ?? null, linksCount: companion?.links?.length ?? 0
            }
          }
        });
      } catch {
        return soft("degraded", { health: null, companion: null });
      }
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
        const probe = await gentleProbe({ cwd, homeDir, workspaceRoot: cwd });
        const state = probe?.state ?? "missing";
        return mcpResult({
          ok: true, code: state === "available" ? "ok" : "degraded",
          data: { state, error: probe?.error == null ? null : String(probe.error), diagnostics: (probe?.diagnostics ?? []).map(String) },
          diagnostics: state === "missing" ? ["gentle_missing"] : []
        });
      } catch {
        return mcpResult({ ok: true, code: "degraded", data: { state: "missing", error: null, diagnostics: [] }, diagnostics: ["gentle_unavailable"] });
      }
    },
    async kairo_graph_query({ graph, question, budget = 2000 }) {
      return graphEnvelope(await graphOp({ op: "query", args: [question], graphPath: graph, budget, ...graphOpts }));
    },
    async kairo_graph_path({ graph, from, to }) {
      return graphEnvelope(await graphOp({ op: "path", args: [from, to], graphPath: graph, ...graphOpts }));
    },
    async kairo_context_summary() {
      try {
        const companion = await buildCompanion({ runs: await listRuns({ limit: 20, activeOnly: false }) });
        const links = (companion?.links ?? []).map((l) => ({
          kind: "soft", displayOnly: true, agentId: l.agentId ?? null,
          reviewId: l.reviewId ?? null, runId: l.runId ?? null, deltaMs: l.deltaMs ?? null
        }));
        return mcpResult({
          ok: true, code: companion?.ok === false ? "degraded" : "ok",
          data: {
            signals: companion?.signals ?? null, engram: companion?.engram ?? null, links,
            alertsCount: companion?.alertsCount ?? null, nextSafeAction: companion?.nextSafeAction ?? null
          },
          diagnostics: companion?.ok === false ? ["companion_degraded"] : []
        });
      } catch {
        return soft("degraded", { signals: null, engram: null, links: [], alertsCount: null, nextSafeAction: null });
      }
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
    ["kairo_context_summary", "Companion + soft links + alerts count", empty]
  ];
  for (const [name, description, inputSchema] of catalog) registerTool(name, { description, inputSchema }, h[name]);
  return h;
}

export function createKairoMcpServer(deps = {}) {
  const Server = deps.McpServer ?? McpServer;
  const server = new Server({ name: "kairo", version: deps.version ?? "0.11.0" });
  const register = deps.registerTool
    ? (n, c, h) => deps.registerTool(n, c, h)
    : (n, c, h) => server.registerTool(n, c, h);
  registerKairoMcpTools(register, deps);
  return server;
}

export function runKairoMcp(deps = {}) {
  const serve = deps.serveStdio ?? serveStdio;
  const createServer = () => createKairoMcpServer(deps);
  return serve(createServer);
}
