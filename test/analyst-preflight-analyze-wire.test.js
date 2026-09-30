import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { KAIRO_WORKSPACE_SNAPSHOT_SCHEMA, openPiRpcBridge } from "../src/global/host/pi-rpc-bridge.js";
import { runKairoUiRpcStdio } from "../src/global/host/kairo-ui-rpc-stdio.js";
import {
  analyzeProjectTeam as analyzeProjectTeamImpl,
  preflightProjectTeam as preflightProjectTeamImpl
} from "../src/global/host/project-team-sidecar.js";

// T21b.2: project.preflight -> project.analyze with an unverified-access
// analyst whose revalidation fails, driven through the REAL sidecar op loop
// (runKairoUiRpcStdio) and the REAL preflightProjectTeam / analyzeProjectTeam.
// Faked: the conversation service (catalog + revalidation probe + analysis
// spy) and the Pi child behind the bridge. The exact host<->sidecar NDJSON is
// frozen into a fixture that the Rust test (crates/kairo-ui, main.rs) replays
// through the Rust host's own code: its request writer and record ingestion.

const FIXTURE = fileURLToPath(new URL("../crates/kairo-ui/fixtures/preflight-analyze-unverified.ndjson", import.meta.url));

const CATALOG = {
  recommendedModel: null,
  models: [
    {
      candidateKey: "codex::gpt-5", adapterId: "codex", modelId: "gpt-5", displayName: "GPT-5",
      evidenceStatus: "scored", entitlement: null, entitlementReason: null, available: true,
      accessVerified: true, selectable: true, recommendationTags: [], fit: 0.6, confidence: 0.9,
      evidence: { reasoning: 0.7, coding: 0.6, coverage: 1 }
    },
    {
      candidateKey: "claude::opus-unv", adapterId: "claude", modelId: "opus-unv", displayName: "Claude Opus Unverified",
      evidenceStatus: "scored", entitlement: "unverified", entitlementReason: null, available: false,
      selectable: true, accessVerified: false, cause: "access_unknown", recommendationTags: ["quality"], fit: 0.9, confidence: 0.9,
      evidence: { reasoning: 0.9, coding: 0.9, coverage: 1 }
    }
  ]
};
const PROBE_REASON = "claude entitlement probe timed out after 30000ms";

// What the Rust host writes (same key content; order is irrelevant to JSON).
const REQUEST_PREFLIGHT = { op: "project.preflight" };
const REQUEST_ANALYZE = {
  op: "project.analyze",
  analyst: {
    model: { adapterId: "claude", modelId: "opus-unv", displayName: "Claude Opus Unverified" },
    selectionSource: "manual",
    recommendationTags: [],
    choice: null,
    // The Rust host sets this only after the modal's explicit second confirmation.
    accessCheckConfirmed: true
  }
};

function fakeChild() {
  const child = new EventEmitter();
  let model = null;
  child.stdin = new EventEmitter();
  child.stdin.write = (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) {
      const cmd = JSON.parse(line);
      let body = null;
      if (cmd.type === "get_state") body = { type: "response", command: "get_state", success: true, data: { sessionId: "s1", model } };
      if (cmd.type === "set_model") {
        model = { id: cmd.modelId, provider: "kairo" };
        body = { type: "response", command: "set_model", success: true };
      }
      if (body) queueMicrotask(() => child.stdout.emit("data", Buffer.from(`${JSON.stringify({ ...body, id: cmd.id })}\n`)));
    }
    return true;
  };
  child.stdin.end = () => {};
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => child.emit("exit", 0, null);
  return child;
}

const openBridge = async (opts) => openPiRpcBridge({
  cwd: opts?.cwd ?? "/project",
  loadSnapshot: async () => ({ schema: KAIRO_WORKSPACE_SNAPSHOT_SCHEMA, project: { label: "demo" }, agents: [], subscriptions: { state: "checking", segments: [] } }),
  resolveCliPath: () => "/fake/cli.js",
  loadKairoProviderModels: async () => [],
  spawnImpl: () => fakeChild(),
  execPath: "/usr/bin/node",
  connectTimeoutMs: 500
});

async function pollUntil(pred, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!pred() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
  return pred();
}

test("T21b: preflight -> analyze with an unverified analyst whose revalidation fails emits the exact wire records and runs no analysis", async () => {
  const spies = { preflight: [], verify: [], analysis: 0, snapshotReloads: 0 };
  const service = {
    async preflightProject({ cwd, mode }) {
      spies.preflight.push(mode);
      return { profile: { root: cwd }, candidates: { scoredAll: [], eligibility: {} }, analystCatalog: CATALOG, projectRoot: cwd, unverifiedClaudeNotice: null };
    },
    async verifyAnalystAccess({ model }) {
      spies.verify.push(model.modelId);
      return { status: "unverified", reason: PROBE_REASON };
    },
    async runBootstrapAnalysis() {
      spies.analysis += 1;
      throw new Error("analysis must never run");
    }
  };
  const out = [];
  const stdout = new PassThrough();
  stdout.on("data", (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) out.push(JSON.parse(line));
  });
  const stdin = new PassThrough();
  const run = runKairoUiRpcStdio({
    stdin, stdout, cwd: "/project", openBridge,
    preflightProjectTeam: (args) => preflightProjectTeamImpl({ ...args, createConversationService: () => service }),
    analyzeProjectTeam: (args) => analyzeProjectTeamImpl({ ...args, createConversationService: () => service }),
    loadSnapshot: async () => { spies.snapshotReloads += 1; throw new Error("no snapshot reload expected"); }
  });

  assert.ok(await pollUntil(() => out.some((r) => r.type === "ready" || r.type === "engine")), "sidecar came up");
  const mark = out.length;
  stdin.write(`${JSON.stringify(REQUEST_PREFLIGHT)}\n`);
  assert.ok(await pollUntil(() => out.slice(mark).some((r) => r.type === "preflight")));
  stdin.write(`${JSON.stringify(REQUEST_ANALYZE)}\n`);
  assert.ok(await pollUntil(() => out.slice(mark).some((r) => r.type === "team")));
  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await run;

  const wire = out.slice(mark).filter((r) => ["preflight", "team"].includes(r.type) || (r.type === "notice" && /^Analyzing project team/.test(r.message)));
  const team = wire.find((r) => r.type === "team");
  assert.deepEqual(
    { ok: team.ok, status: team.status, accessStatus: team.accessStatus, analyst: team.analyst },
    { ok: false, status: "analyst_access_unverified", accessStatus: "unverified", analyst: { adapterId: "claude", modelId: "opus-unv", displayName: "Claude Opus Unverified" } }
  );
  assert.match(team.reason, /could not be verified/);
  assert.match(team.reason, /timed out/);
  assert.deepEqual(spies, { preflight: ["catalog", undefined], verify: ["opus-unv"], analysis: 0, snapshotReloads: 0 });
  assert.equal(out.slice(mark).some((r) => r.type === "snapshot"), false);
  assert.equal(out.slice(mark).some((r) => r.type === "notice" && /Suggested team ready/.test(r.message)), false);

  const lines = [
    { dir: "host->sidecar", record: REQUEST_PREFLIGHT },
    wire.find((r) => r.type === "preflight") && { dir: "sidecar->host", record: wire.find((r) => r.type === "preflight") },
    { dir: "host->sidecar", record: REQUEST_ANALYZE },
    ...wire.filter((r) => r.type !== "preflight").map((record) => ({ dir: "sidecar->host", record }))
  ];
  const text = `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`;
  if (process.env.UPDATE_WIRE_FIXTURE === "1") await writeFile(FIXTURE, text);
  const committed = await readFile(FIXTURE, "utf8");
  assert.deepEqual(
    committed.trim().split("\n").map((l) => JSON.parse(l)),
    lines,
    "wire fixture drifted; regenerate with UPDATE_WIRE_FIXTURE=1 and re-run the Rust test"
  );
});
