import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/cli.js";
import {
  KAIRO_MCP_TOOLS, mcpSchemas, mcpResult, createToolHandlers,
  registerKairoMcpTools, createKairoMcpServer, runKairoMcp
} from "../src/global/mcp/kairo-mcp.js";
import { softLinkReviewToRun } from "../src/global/observability/build-companion-snapshot.js";

const WRITE_RE = /write|create|resolve|dismiss|import|export|apply|delete|mutate/i;

test("registry: seven exact read-only names; CLI mcp; schemas", () => {
  assert.equal(parseArgs(["mcp"]).command, "mcp");
  const tools = new Map();
  registerKairoMcpTools((n, c, h) => {
    assert.equal(WRITE_RE.test(n), false);
    tools.set(n, { c, h });
  }, {});
  assert.deepEqual([...tools.keys()], [...KAIRO_MCP_TOOLS]);
  assert.equal(KAIRO_MCP_TOOLS.length, 7);
  assert.equal(mcpSchemas.runs.parse({}).limit, 20);
  assert.equal(mcpSchemas.alerts.parse({}).limit, 50);
  assert.equal(mcpSchemas.graphQuery.parse({ graph: "g", question: "q" }).budget, 2000);
  for (const bad of [
    () => mcpSchemas.runs.parse({ limit: 0 }), () => mcpSchemas.runs.parse({ limit: 21 }),
    () => mcpSchemas.alerts.parse({ limit: 51 }), () => mcpSchemas.alerts.parse({ state: "pending" }),
    () => mcpSchemas.graphQuery.parse({ question: "q" }),
    () => mcpSchemas.graphQuery.parse({ graph: "g", question: "q", budget: 8001 }),
    () => mcpSchemas.graphPath.parse({ graph: "g", from: "a" })
  ]) assert.throws(bad);
});

test("handlers happy + degrade; graph escape; soft displayOnly; factory inject", async () => {
  const ok = createToolHandlers({
    buildStatus: async () => ({ health: "healthy", cta: { kind: "idle" } }),
    listRuns: async () => [{ runId: "r1", state: "succeeded", agentId: "codex", startedAt: "2026-01-01T00:00:00Z" }],
    listAlerts: async () => [{ alertId: "alt-aaaaaaaaaaaaaaaa", state: "open", kind: "x", severity: "low", title: "t", createdAt: "t" }],
    buildCompanion: async () => ({
      ok: true, signals: { gentle: { state: "available" } }, engram: { status: "missing" },
      links: [], alertsCount: 1, nextSafeAction: { kind: "missing", displayOnly: true }
    }),
    probeGentle: async () => ({ state: "available", diagnostics: [], error: null }),
    runGraphifyOp: async () => ({
      ok: true, code: "ok", op: "query", text: "hit", truncated: false,
      graphPath: "/ws/g.json", graphStatus: "fresh", diagnostics: []
    })
  });
  const status = await ok.kairo_status();
  assert.equal(status.structuredContent.data.health, "healthy");
  assert.deepEqual(JSON.parse(status.content[0].text), status.structuredContent);
  assert.equal((await ok.kairo_runs({ limit: 5 })).structuredContent.data.runs[0].runId, "r1");
  assert.equal((await ok.kairo_alerts({ state: "open" })).structuredContent.data.alerts[0].state, "open");
  assert.equal((await ok.kairo_gentle_status()).structuredContent.data.state, "available");
  assert.equal((await ok.kairo_graph_query({ graph: "/ws/g.json", question: "how?" })).structuredContent.data.text, "hit");

  const bad = createToolHandlers({
    buildStatus: async () => { throw new Error("boom"); },
    listRuns: async () => { throw new Error("boom"); },
    listAlerts: async () => { throw new Error("boom"); },
    probeGentle: async () => ({ state: "missing", diagnostics: [], error: null }),
    buildCompanion: async () => { throw new Error("boom"); }
  });
  for (const name of ["kairo_status", "kairo_runs", "kairo_alerts", "kairo_gentle_status", "kairo_context_summary"]) {
    const r = await bad[name]();
    assert.equal(r.structuredContent.code, "degraded");
    assert.equal(JSON.stringify(r).includes("boom"), false);
  }

  let spawned = 0;
  const esc = createToolHandlers({
    whichCommand: () => "/usr/bin/graphify",
    containPath: () => ({ ok: false, code: "graph_path_outside_workspace", path: "/etc/passwd" }),
    inspectGraph: () => { throw new Error("no"); },
    probeCommand: () => { spawned += 1; return { ok: true, status: 0, stdout: "x", stderr: "secret=1" }; }
  });
  const escaped = await esc.kairo_graph_query({ graph: "/etc/passwd", question: "x" });
  assert.equal(escaped.isError && escaped.structuredContent.code === "graph_path_outside_workspace", true);
  assert.equal(spawned, 0);
  assert.equal(JSON.stringify(escaped).includes("secret"), false);
  const pf = await createToolHandlers({
    runGraphifyOp: async () => ({
      ok: false, code: "provider_error", op: "path", text: null, truncated: false,
      graphPath: "/ws/g.json", graphStatus: "fresh", diagnostics: ["provider_error", "status=1"]
    })
  }).kairo_graph_path({ graph: "/ws/g.json", from: "a", to: "b" });
  assert.equal(pf.isError && pf.structuredContent.code === "provider_error", true);
  const threw = await createToolHandlers({
    runGraphifyOp: async () => { throw new Error("spawn boom"); }
  }).kairo_graph_query({ graph: "/ws/g.json", question: "x" });
  assert.equal(threw.isError && threw.structuredContent.code === "provider_error", true);
  assert.equal(JSON.stringify(threw).includes("boom"), false);

  const link = softLinkReviewToRun(
    { reviewId: "rev1", agentId: "codex", createdAt: "2026-01-01T01:00:00Z" },
    [{ runId: "run-a", agentId: "codex", startedAt: "2026-01-01T00:30:00Z" }]
  );
  assert.equal(link.displayOnly, true);
  const summary = await createToolHandlers({
    listRuns: async () => [],
    buildCompanion: async () => ({
      ok: true, signals: {}, engram: { status: "missing" }, links: [link],
      alertsCount: 0, nextSafeAction: { kind: "idle", displayOnly: true }
    })
  }).kairo_context_summary();
  assert.equal(summary.structuredContent.data.links[0].displayOnly, true);
  assert.equal(summary.structuredContent.data.links[0].kind, "soft");

  const names = [];
  class FakeServer {
    constructor(info) { this.info = info; }
    registerTool(name) { assert.equal(WRITE_RE.test(name), false); names.push(name); }
  }
  let factory;
  const handle = await runKairoMcp({
    McpServer: FakeServer, version: "0.11.0",
    serveStdio: (createServer) => { factory = createServer; return { close() {} }; },
    buildStatus: async () => ({ health: "healthy" }), listRuns: async () => [],
    listAlerts: async () => [], probeGentle: async () => ({ state: "missing" }),
    buildCompanion: async () => ({ ok: true, links: [] })
  });
  assert.equal(typeof handle.close, "function");
  assert.equal(factory().info.name, "kairo");
  assert.deepEqual(names, [...KAIRO_MCP_TOOLS]);
  assert.ok(createKairoMcpServer({ McpServer: FakeServer, registerTool: () => {} }));
  const mirrored = mcpResult({ ok: true, code: "ok", data: { x: 1 } });
  assert.deepEqual(JSON.parse(mirrored.content[0].text), mirrored.structuredContent);
});
