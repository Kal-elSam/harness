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
  preflightProjectTeam as preflightProjectTeamImpl,
  verifyProjectTeamAccess as verifyProjectTeamAccessImpl
} from "../src/global/host/project-team-sidecar.js";

// T21b.2: project.preflight -> project.analyze with an unverified-access
// analyst whose revalidation fails, driven through the REAL sidecar op loop
// (runKairoUiRpcStdio) and the REAL preflightProjectTeam / analyzeProjectTeam.
// Faked: the conversation service (catalog + revalidation probe + analysis
// spy) and the Pi child behind the bridge. The exact host<->sidecar NDJSON is
// frozen into a fixture that the Rust test (crates/kairo-ui, main.rs) replays
// through the Rust host's own code: its request writer and record ingestion.

const FIXTURE = fileURLToPath(new URL("../crates/kairo-ui/fixtures/verify-then-pick.ndjson", import.meta.url));

const EVALUATION = {
  comparable: true, confidence: "medium", capabilities: { reasoning: 0.75, coding: 0.5 },
  benchmarkCounts: { reasoning: 2, coding: 1 }, optionalEvidence: false, missing: []
};
const evaluated = (rank, modelId) => ({ rank, qualification: "qualified", identityKey: modelId, evidenceKey: modelId, evaluation: { ...EVALUATION } });

// The local project scan the sidecar contextualizes its explanations with (fixed, no real scan).
const LOCAL_PROFILE = { projectName: "demo", stack: ["Node.js"], architecture: { pattern: "modular" }, risks: [{ kind: "no-test-command", detail: "x" }], confidence: "medium" };
const computeProfile = async () => LOCAL_PROFILE;

const CATALOG = {
  recommendedModel: null,
  models: [
    {
      candidateKey: "codex::gpt-5", adapterId: "codex", modelId: "gpt-5", displayName: "GPT-5",
      evidenceStatus: "scored", entitlement: null, entitlementReason: null, available: true,
      accessVerified: true, selectable: true, recommendationTags: [], ...evaluated(2, "gpt-5")
    },
    {
      candidateKey: "claude::opus-unv", adapterId: "claude", modelId: "opus-unv", displayName: "Claude Opus Unverified",
      evidenceStatus: "scored", entitlement: "unverified", entitlementReason: null, available: false,
      selectable: true, accessVerified: false, cause: "access_unknown", recommendationTags: ["quality"], ...evaluated(1, "opus-unv")
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

test("T21b safety net (T23: no longer the primary path, no Rust fixture): a crafted analyze for a still-unverified analyst revalidates first, fails closed and runs no analysis", async () => {
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
    preflightProjectTeam: (args) => preflightProjectTeamImpl({ ...args, createConversationService: () => service, computeProfile }),
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
});

// ---- T23: preflight -> verify (explicit consent) -> preflight, frozen for the Rust host ----

const REQUEST_VERIFY = { op: "project.verify_access", confirmed: true };
const PLAN_PENDING = {
  pendingCount: 1, reusableCount: 1, mayConsumeQuota: true,
  costStatement: "Verifying makes 1 real provider call and may consume quota or account credit.",
  subscriptions: [
    {
      adapterId: "cursor", provider: "Cursor", granularity: "pool", pendingCount: 1, reusableCount: 0,
      checks: [{ id: "cursor::other_models", kind: "pool", pool: "other_models", modelId: "gpt-5.4", models: 2, label: "Other models", state: "pending", reason: "never_verified", cachedStatus: null, age: null }]
    },
    {
      adapterId: "claude", provider: "Claude", granularity: "model", pendingCount: 0, reusableCount: 1,
      checks: [{ id: "claude::claude-a", kind: "model", modelId: "claude-a", label: "Claude A", state: "reusable", reason: null, cachedStatus: "allowed", age: "3m" }]
    }
  ]
};
const PLAN_DONE = { pendingCount: 0, reusableCount: 2, mayConsumeQuota: false, costStatement: null, subscriptions: [] };
const row = (adapterId, modelId, displayName, rank, extra = {}) => ({
  candidateKey: `${adapterId}::${modelId}`, adapterId, modelId, displayName, evidenceStatus: "scored", entitlement: null,
  entitlementReason: null, available: true, accessVerified: true, selectable: true, recommendationTags: [],
  ...evaluated(rank, modelId), ...extra
});

test("T23 wire: preflight carries the plan; project.verify_access (confirmed) runs verification once, then re-emits a preflight with the verified rows", async () => {
  let verified = false;
  const spies = { verify: [], preflights: 0, analysis: 0 };
  const service = {
    async preflightProject({ cwd }) {
      spies.preflights += 1;
      const models = verified
        ? [row("claude", "claude-a", "Claude A", 1), row("cursor", "gpt-5.4", "GPT 5.4", 2), row("codex", "gpt-5", "GPT-5", 3)]
        : [row("claude", "claude-a", "Claude A", 1), row("codex", "gpt-5", "GPT-5", 3),
          row("cursor", "gpt-5.4", "GPT 5.4", 2, { available: false, accessVerified: false, cause: "access_unknown", entitlement: "unverified" })];
      return {
        profile: { root: cwd }, candidates: { scoredAll: [], eligibility: {} }, projectRoot: cwd, unverifiedClaudeNotice: null,
        analystCatalog: { recommendedModel: null, models, exclusions: [] },
        verificationPlan: verified ? PLAN_DONE : PLAN_PENDING
      };
    },
    async verifyAccess(args) {
      spies.verify.push({ cwd: args.cwd, confirmed: args.confirmed, hasProgressListener: typeof args.onProgress === "function" });
      const check = { id: "cursor::other_models", label: "Other models", adapterId: "cursor", provider: "Cursor" };
      args.onProgress?.({ completed: 0, total: 1, active: [check], done: null });
      verified = true;
      args.onProgress?.({ completed: 1, total: 1, active: [], done: { ...check, status: "allowed", reason: null } });
      return {
        ran: true, status: "verified", persisted: true,
        outcomes: [{ adapterId: "cursor", provider: "Cursor", granularity: "pool", counts: { allowed: 1, denied: 0, unverified: 0 },
          results: [{ id: "cursor::other_models", label: "Other models", pool: "other_models", modelId: "gpt-5.4", status: "allowed", reason: null }] }]
      };
    },
    async runBootstrapAnalysis() { spies.analysis += 1; throw new Error("analysis must never run"); }
  };
  const out = [];
  const stdout = new PassThrough();
  stdout.on("data", (chunk) => { for (const line of String(chunk).split("\n").filter(Boolean)) out.push(JSON.parse(line)); });
  const stdin = new PassThrough();
  const run = runKairoUiRpcStdio({
    stdin, stdout, cwd: "/project", openBridge,
    preflightProjectTeam: (args) => preflightProjectTeamImpl({ ...args, createConversationService: () => service, computeProfile }),
    verifyProjectTeamAccess: (args) => verifyProjectTeamAccessImpl({ ...args, createConversationService: () => service })
  });
  assert.ok(await pollUntil(() => out.some((r) => r.type === "ready" || r.type === "engine")), "sidecar came up");
  const mark = out.length;
  stdin.write(`${JSON.stringify(REQUEST_PREFLIGHT)}\n`);
  assert.ok(await pollUntil(() => out.slice(mark).some((r) => r.type === "preflight")));
  assert.deepEqual(spies.verify, [], "preflight alone never verifies");
  const first = out.slice(mark).find((r) => r.type === "preflight");
  assert.equal(first.verificationPlan.pendingCount, 1);
  assert.equal(first.projectContext.line, "Proyecto demo · Node.js · arquitectura modular · riesgos: sin script de test", "the local project scan reaches the host");
  assert.ok(first.analystCatalog.models.every((row) => row.explanation === null && row.detail === null), "flat list rows carry no explanation or detail");
  assert.deepEqual(first.unverifiedSubscriptions.map((s) => s.adapterId), ["cursor"]);

  const mid = out.length;
  stdin.write(`${JSON.stringify(REQUEST_VERIFY)}\n`);
  assert.ok(await pollUntil(() => out.slice(mid).some((r) => r.type === "preflight")));
  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await run;

  assert.deepEqual(spies.verify, [{ cwd: "/project", confirmed: true, hasProgressListener: true }]);
  assert.equal(spies.analysis, 0);
  const after = out.slice(mid);
  const verification = after.find((r) => r.type === "verification");
  assert.equal(verification.ok, true);
  assert.equal(verification.status, "verified");
  assert.equal(verification.outcomes[0].results[0].status, "allowed");
  const types = after.map((r) => r.type);
  assert.ok(types.indexOf("verification") < types.indexOf("preflight"), "outcome first, then the rebuilt catalog");
  const progress = after.filter((r) => r.type === "verification_progress");
  assert.deepEqual(progress.map((r) => [r.completed, r.total, r.active.map((a) => a.label), r.done?.status ?? null]), [
    [0, 1, ["Other models"], null],
    [1, 1, [], "allowed"]
  ]);
  assert.ok(types.lastIndexOf("verification_progress") < types.indexOf("verification"), "progress comes before the outcome");
  const second = after.find((r) => r.type === "preflight");
  assert.deepEqual(second.analystCatalog.models.map((m) => m.candidateKey), ["claude::claude-a", "cursor::gpt-5.4", "codex::gpt-5"]);
  assert.equal(second.verificationPlan.pendingCount, 0);
  assert.deepEqual(second.unverifiedSubscriptions, []);

  const lines = [
    { dir: "host->sidecar", record: REQUEST_PREFLIGHT },
    { dir: "sidecar->host", record: first },
    { dir: "host->sidecar", record: REQUEST_VERIFY },
    ...after.filter((r) => ["verification_progress", "verification", "preflight"].includes(r.type)).map((record) => ({ dir: "sidecar->host", record }))
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

test("T23 wire: project.verify_access without confirmed:true never verifies and reports confirmation_required", async () => {
  const spies = { verify: 0 };
  const out = [];
  const stdout = new PassThrough();
  stdout.on("data", (chunk) => { for (const line of String(chunk).split("\n").filter(Boolean)) out.push(JSON.parse(line)); });
  const stdin = new PassThrough();
  const run = runKairoUiRpcStdio({
    stdin, stdout, cwd: "/project", openBridge,
    verifyProjectTeamAccess: (args) => verifyProjectTeamAccessImpl({
      ...args,
      createConversationService: () => ({ async verifyAccess() { spies.verify += 1; return { ran: true, status: "verified", outcomes: [] }; } })
    }),
    preflightProjectTeam: async () => { throw new Error("no preflight after a refusal"); }
  });
  assert.ok(await pollUntil(() => out.some((r) => r.type === "ready" || r.type === "engine")));
  const mark = out.length;
  stdin.write(`${JSON.stringify({ op: "project.verify_access" })}\n`);
  assert.ok(await pollUntil(() => out.slice(mark).some((r) => r.type === "verification")));
  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await run;
  const verification = out.slice(mark).find((r) => r.type === "verification");
  assert.equal(verification.ok, false);
  assert.equal(verification.status, "confirmation_required");
  assert.equal(spies.verify, 0);
  assert.equal(out.slice(mark).some((r) => r.type === "preflight"), false);
});

test("T24 wire: a verification in flight is not cancelled by anything the host does meanwhile (closing its modal sends nothing); it completes and persists", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const seen = { verifyArgs: null, finished: false };
  const service = {
    async preflightProject({ cwd }) {
      return { profile: { root: cwd }, candidates: { scoredAll: [], eligibility: {} }, projectRoot: cwd, unverifiedClaudeNotice: null,
        analystCatalog: { recommendedModel: null, models: [], exclusions: [] }, verificationPlan: PLAN_DONE };
    },
    async verifyAccess(args) {
      seen.verifyArgs = args;
      const check = { id: "claude::claude-a", label: "Claude A", adapterId: "claude", provider: "Claude" };
      args.onProgress?.({ completed: 0, total: 1, active: [check], done: null });
      await gate;
      seen.finished = true;
      args.onProgress?.({ completed: 1, total: 1, active: [], done: { ...check, status: "unverified", reason: "probe timed out" } });
      return { ran: true, status: "verified", persisted: false, outcomes: [] };
    }
  };
  const out = [];
  const stdout = new PassThrough();
  stdout.on("data", (chunk) => { for (const line of String(chunk).split("\n").filter(Boolean)) out.push(JSON.parse(line)); });
  const stdin = new PassThrough();
  const run = runKairoUiRpcStdio({
    stdin, stdout, cwd: "/project", openBridge,
    preflightProjectTeam: (args) => preflightProjectTeamImpl({ ...args, createConversationService: () => service, computeProfile }),
    verifyProjectTeamAccess: (args) => verifyProjectTeamAccessImpl({ ...args, createConversationService: () => service }),
    loadSnapshot: async () => ({ ok: true })
  });
  assert.ok(await pollUntil(() => out.some((r) => r.type === "ready" || r.type === "engine")), "sidecar came up");
  const mark = out.length;
  stdin.write(`${JSON.stringify(REQUEST_VERIFY)}\n`);
  assert.ok(await pollUntil(() => out.slice(mark).some((r) => r.type === "verification_progress")));
  // The host closes its modal and keeps working: other ops are handled while the checks run.
  stdin.write(`${JSON.stringify({ op: "reload_snapshot" })}\n`);
  assert.ok(await pollUntil(() => out.slice(mark).some((r) => r.type === "snapshot")), "other ops are not blocked by the running checks");
  assert.equal(seen.finished, false, "nothing aborted the run");
  assert.equal("signal" in seen.verifyArgs, false, "no cancellation channel is offered to the service");
  assert.equal(out.slice(mark).some((r) => r.type === "verification"), false, "still running");
  release();
  assert.ok(await pollUntil(() => out.slice(mark).some((r) => r.type === "verification")));
  stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
  stdin.end();
  await run;
  const records = out.slice(mark);
  assert.equal(seen.finished, true);
  const last = records.filter((r) => r.type === "verification_progress").at(-1);
  assert.deepEqual([last.completed, last.total, last.done.status, last.done.reason], [1, 1, "unverified", "probe timed out"]);
});
