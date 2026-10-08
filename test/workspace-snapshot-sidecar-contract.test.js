import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { KAIRO_WORKSPACE_SNAPSHOT_SCHEMA, openPiRpcBridge } from "../src/global/host/pi-rpc-bridge.js";
import { buildKairoWorkspaceSnapshot } from "../src/global/host/workspace-snapshot.js";
import { runKairoUiRpcStdio } from "../src/global/host/kairo-ui-rpc-stdio.js";

// The workspace snapshot gained additive fields (tasks, sessions, status,
// statusReason, scope, workState). The Ratatui sidecar forwards the snapshot
// as-is: base keys and semantics must survive, the new keys must travel, and
// the wire schema id must not change. Presentation of the new fields in the
// Rust view is NOT part of this contract.

const CODEX = { displayName: "M1", adapterId: "codex", modelId: "m1", accessMode: "automatic" };
const STRATEGY = {
  status: "active", bootstrapAnalyst: CODEX, orchestrator: CODEX,
  projectTeam: [{ role: "Builder", model: CODEX, reason: "Chosen for coding throughput." }, { role: "Reviewer", model: CODEX }]
};
const WORK = {
  sessions: [],
  tasks: [{ taskId: "t1", state: "approved", execution: { runId: "run_1", state: "running", active: true, role: "Builder" }, nextTransition: "delegated" }]
};

async function readySnapshot(snapshot) {
  const out = [];
  const stdout = new PassThrough();
  stdout.on("data", (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) out.push(JSON.parse(line));
  });
  const stdin = new PassThrough();
  const run = runKairoUiRpcStdio({
    stdin, stdout, cwd: "/project",
    openBridge: async () => openPiRpcBridge({
      cwd: "/project", loadSnapshot: async () => snapshot,
      resolveCliPath: () => { throw new Error("no Pi CLI offline"); },
      spawnImpl: () => { throw new Error("spawn must not run"); }, connectTimeoutMs: 200
    })
  });
  const deadline = Date.now() + 3000;
  while (!out.some((r) => r.type === "ready") && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await run;
  return out.find((r) => r.type === "ready").snapshot;
}

test("sidecar forwards the real snapshot: base keys intact, additive keys present, schema unchanged", async () => {
  const built = buildKairoWorkspaceSnapshot({
    projectRoot: "/work/demo", strategy: STRATEGY,
    availabilityIntelligence: { eligibility: { codex: { ok: true } }, claudeEntitlement: {}, cursorAccess: {} },
    work: WORK
  });
  const wire = await readySnapshot(built);
  assert.equal(wire.schema, KAIRO_WORKSPACE_SNAPSHOT_SCHEMA);
  // Base contract (what the Rust snapshot reads today): agents[].why / availability, team, subscriptions.
  assert.ok(wire.team && wire.subscriptions && wire.project && wire.session !== undefined && wire.memory);
  const builder = wire.agents.find((a) => a.role === "Builder");
  assert.equal(builder.why, "Chosen for coding throughput.");
  assert.equal(typeof builder.availability, "string");
  assert.ok(wire.agents.every((a) => a.why === null || typeof a.why === "string"));
  // Additive fields derived from shared facts.
  assert.deepEqual(wire.scope, { projectRoot: "/work/demo", sessionId: null });
  assert.equal(wire.workState, "ready");
  assert.equal(wire.tasks.length, 1);
  assert.equal(wire.tasks[0].status, "working");
  assert.equal(builder.status, "working");
  assert.equal(typeof builder.statusReason === "string" || builder.statusReason === null, true);
  assert.ok(wire.status && typeof wire.status.status === "string");
  // The wire form is exactly the built value (JSON-safe, nothing dropped or invented by the sidecar).
  assert.deepEqual(wire, JSON.parse(JSON.stringify(built)));
});

test("without work facts the additive fields degrade to unknown, never to an inferred approval", async () => {
  const built = buildKairoWorkspaceSnapshot({ projectRoot: "/work/demo", strategy: STRATEGY });
  const wire = await readySnapshot(built);
  assert.equal(wire.workState, "unknown");
  assert.deepEqual(wire.tasks, []);
  assert.ok(Array.isArray(wire.sessions));
  for (const agent of wire.agents) assert.equal(agent.status, "unknown");
});
