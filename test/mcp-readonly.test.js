import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/cli.js";
import {
  KAIRO_MCP_TOOLS, mcpSchemas, mcpResult, createToolHandlers,
  registerKairoMcpTools, createKairoMcpServer, runKairoMcp, pubCodes
} from "../src/global/mcp/kairo-mcp.js";
import { softLinkReviewToRun } from "../src/global/observability/build-companion-snapshot.js";

const WRITE_RE = /write|create|resolve|dismiss|import|export|apply|delete|mutate/i;
const HOSTILE = ["token=SECRET", "Authorization: Bearer abc", "stderr: boom"];

test("registry schemas + handlers + productive loaders + sanitize", async () => {
  assert.equal(parseArgs(["mcp"]).command, "mcp");
  const tools = new Map();
  registerKairoMcpTools((n, c, h) => { assert.equal(WRITE_RE.test(n), false); tools.set(n, h); }, {});
  assert.deepEqual([...tools.keys()], [...KAIRO_MCP_TOOLS]);
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
  assert.deepEqual(pubCodes(["provider_error", "status=1", ...HOSTILE]), ["provider_error", "status=1"]);

  const coverage = { detectedAgents: 2, governedAgents: 1, components: 3, activeModules: ["sdd-core"] };
  const ok = createToolHandlers({
    buildStatus: async () => ({ health: "healthy", cta: { kind: "idle" }, coverage }),
    listRuns: async () => [{ runId: "r1", state: "succeeded", agentId: "codex", startedAt: "t" }],
    listAlerts: async () => [{ alertId: "alt-aaaaaaaaaaaaaaaa", state: "open", kind: "x", severity: "low", title: "t", createdAt: "t" }],
    buildCompanion: async () => ({
      ok: true, signals: { gentle: { state: "available", error: "token=SECRET", diagnostics: HOSTILE } },
      engram: { status: "missing", binary: "/secret/bin", error: "token=SECRET" },
      links: [], alertsCount: 1, nextSafeAction: { kind: "missing", detail: "token=SECRET" }
    }),
    probeGentle: async () => ({ state: "available", diagnostics: [], error: null }),
    runGraphifyOp: async () => ({
      ok: true, code: "ok", op: "query", text: "hit", truncated: false,
      graphPath: "/ws/g.json", graphStatus: "fresh", diagnostics: []
    })
  });
  const status = await ok.kairo_status();
  assert.deepEqual(status.structuredContent.data.coverage, coverage);
  assert.equal(JSON.stringify(status).includes("SECRET"), false);
  assert.equal((await ok.kairo_runs()).structuredContent.data.runs[0].runId, "r1");
  assert.equal((await ok.kairo_gentle_status()).structuredContent.data.state, "available");
  assert.equal((await ok.kairo_graph_query({ graph: "/ws/g.json", question: "q" })).structuredContent.data.text, "hit");

  const bad = createToolHandlers({
    buildStatus: async () => { throw new Error("boom"); },
    listRuns: async () => { throw new Error("boom"); },
    listAlerts: async () => { throw new Error("boom"); },
    probeGentle: async () => ({ state: "missing" }),
    buildCompanion: async () => { throw new Error("boom"); }
  });
  for (const name of ["kairo_status", "kairo_runs", "kairo_alerts", "kairo_gentle_status", "kairo_context_summary"]) {
    assert.equal((await bad[name]()).structuredContent.code, "degraded");
  }

  let spawned = 0;
  const escaped = await createToolHandlers({
    whichCommand: () => "/usr/bin/graphify",
    containPath: () => ({ ok: false, code: "graph_path_outside_workspace", path: "/etc/passwd" }),
    inspectGraph: () => { throw new Error("no"); },
    probeCommand: () => { spawned += 1; return { ok: true, status: 0, stderr: "token=SECRET" }; }
  }).kairo_graph_query({ graph: "/etc/passwd", question: "x" });
  assert.equal(escaped.isError && escaped.structuredContent.code === "graph_path_outside_workspace" && spawned === 0, true);
  assert.equal(JSON.stringify(escaped).includes("SECRET"), false);
  const pf = await createToolHandlers({
    runGraphifyOp: async () => ({
      ok: false, code: "provider_error", op: "path", text: "token=SECRET\nError: internal stack", truncated: false,
      graphPath: "/ws/g.json", graphStatus: "fresh", diagnostics: ["provider_error", "status=1", "token=SECRET"]
    })
  }).kairo_graph_path({ graph: "/ws/g.json", from: "a", to: "b" });
  assert.equal(pf.structuredContent.data.text === null && !/SECRET|internal stack/.test(JSON.stringify(pf)), true);
  assert.deepEqual(pf.structuredContent.diagnostics, ["provider_error", "status=1"]);
  assert.equal((await createToolHandlers({
    runGraphifyOp: async () => { throw new Error("spawn boom"); }
  }).kairo_graph_query({ graph: "/ws/g.json", question: "x" })).structuredContent.code, "provider_error");

  const gent = await createToolHandlers({
    probeGentle: async () => ({ state: "error", error: "token=SECRET", diagnostics: HOSTILE })
  }).kairo_gentle_status();
  assert.equal(gent.structuredContent.data.error, null);
  assert.deepEqual(gent.structuredContent.data.diagnostics, ["provider_error"]);
  assert.equal(JSON.stringify(gent).includes("SECRET"), false);

  let loaded = 0;
  const runs = [{ runId: "run-a", agentId: "codex", startedAt: "2026-01-01T00:30:00Z" }];
  const review = { reviewId: "rev1", agentId: "codex", createdAt: "2026-01-01T01:00:00Z" };
  assert.equal(softLinkReviewToRun(review, runs).displayOnly, true);
  const wired = createToolHandlers({
    buildStatus: async () => ({
      health: "healthy", cta: { kind: "idle" },
      coverage: { detectedAgents: 1, governedAgents: 1, components: 2, activeModules: ["sdd-core"] }
    }),
    listRuns: async () => runs,
    listReviews: async () => { loaded += 1; return [review]; },
    listAlerts: async () => [],
    ensureRegistered: () => {},
    buildObservability: async () => ({ probes: [] }),
    inspectEngram: () => ({ status: "missing", binary: null })
  });
  assert.deepEqual((await wired.kairo_status()).structuredContent.data.coverage, {
    detectedAgents: 1, governedAgents: 1, components: 2, activeModules: ["sdd-core"]
  });
  assert.equal((await wired.kairo_status()).structuredContent.data.companion.linksCount, 1);
  const summary = await wired.kairo_context_summary();
  assert.equal(loaded >= 2 && summary.structuredContent.data.links[0].runId === "run-a", true);
  assert.equal(summary.structuredContent.data.links[0].displayOnly, true);
  assert.equal(summary.structuredContent.data.engram.error, null);

  // Persistent MCP must resolve HEAD per request, not once at handler creation.
  let headCalls = 0;
  const heads = createToolHandlers({
    cwd: "/ws",
    resolveHead: () => { headCalls += 1; return `sha${headCalls}`; },
    runGraphifyOp: async () => ({
      ok: true, code: "ok", op: "query", text: "t", truncated: false,
      graphPath: "g.json", graphStatus: "ok", diagnostics: []
    }),
    buildStatus: async () => ({ health: "healthy", coverage: null, cta: null }),
    listRuns: async () => [], listReviews: async () => [], listAlerts: async () => [],
    ensureRegistered: () => {},
    buildObservability: async () => ({ probes: [] }),
    inspectEngram: () => ({ status: "missing", binary: null })
  });
  await heads.kairo_status();
  await heads.kairo_graph_query({ graph: "g.json", question: "q" });
  await heads.kairo_context_summary();
  assert.equal(headCalls >= 3, true);

  const names = [];
  class FakeServer {
    constructor(info) { this.info = info; }
    registerTool(name) { assert.equal(WRITE_RE.test(name), false); names.push(name); }
  }
  let factory;
  await runKairoMcp({
    McpServer: FakeServer, serveStdio: (f) => { factory = f; return { close() {} }; },
    buildCompanion: async () => ({ ok: true, links: [] })
  });
  assert.equal(factory().info.name, "kairo");
  assert.deepEqual(names, [...KAIRO_MCP_TOOLS]);
  assert.ok(createKairoMcpServer({ McpServer: FakeServer, registerTool: () => {} }));
  assert.equal(JSON.parse(mcpResult({ ok: true, code: "ok", data: { x: 1 } }).content[0].text).data.x, 1);
});
