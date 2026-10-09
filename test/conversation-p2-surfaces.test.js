import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArchitecturePlan } from "../src/global/architect/architect-manager.js";
import { taskPaths, transitionTask } from "../src/global/architect/architect-store.js";
import { createConversationService } from "../src/global/conversation/service.js";
import { isReadOnlyGentleArgv } from "../src/global/conversation/rdd-mode-reader.js";
import { createToolHandlers } from "../src/global/mcp/kairo-mcp.js";
import { GENTLE_230_BOOTSTRAP } from "../src/global/control-plane/review-status.js";

const RUN = "run_surf_1";
const TARGET = Object.freeze({ role: "Builder", selection: "assigned", strategyFingerprint: "fp-1", candidateKey: "codex:m1" });
const ok = (payload) => ({ ok: true, payload, status: 0, error: null });
const MODE = {
  schema: "gentle-ai.review-mode/v1", operation: "status", scope: "both",
  status: { schema: "gentle-ai.rdd-mode-status/v1", global: "", clone_local: "", effective: "on", source: "default" }
};
// Hostile fixture: project receipt/gate plus every executable-looking field Gentle may publish.
const STATUS = {
  schema: "gentle-ai.review-integration.status/v2",
  contract: "gentle-ai.review-integration/v2",
  action: "start",
  applicability: "unrelated",
  receipt: { id: "rcpt-9", status: "approved" },
  gate: "g1",
  next_transition: {
    kind: "execute", operation: "review.start",
    execute: { command: "gentle-ai", argv: ["review", "start", "--lineage", "x"], invocation: "gentle-ai review start" }
  },
  command: "gentle-ai review start", argv: ["review", "start"]
};
const probe = async () => ({
  state: "available", contractCompatible: true, version: "2.3.0",
  evidence: [{ kind: "binary", path: "/opt/fake/gentle-ai" }, { kind: "bootstrap", command: GENTLE_230_BOOTSTRAP }]
});
const sha = async (p) => createHash("sha256").update(await readFile(p)).digest("hex");

async function harness() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "kairo-surf-repo-")));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "T"], { cwd: root });
  await writeFile(join(root, "README.md"), "hi\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: root });
  const home = await mkdtemp(join(tmpdir(), "kairo-surf-home-"));
  const created = await createArchitecturePlan({ task: "Do a thing", cwd: root, runCodex: async () => ({ plan: "## Plan\nDo it.", usage: null }) });
  const taskId = created.status.taskId;
  await transitionTask(root, taskId, "approved");
  const counters = { startRun: 0 };
  const gentleCalls = [];
  const service = createConversationService({
    resolveRoot: async () => root, homeDir: home, createRunId: () => RUN,
    startRun: async () => { counters.startRun += 1; return { metadata: { state: "running", startedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" } }; },
    readRun: async () => ({ runId: RUN, agentId: "codex", state: "completed", error: null }),
    readRunEvents: async () => [{ type: "run.transcript", source: "codex", data: { text: "Done." } }],
    gentle: {
      probe, useProductionRddReader: true,
      runCommand: (args) => { gentleCalls.push(args); return args[1] === "mode" ? ok(MODE) : ok(STATUS); }
    }
  });
  service.routeProjectExecution = async () => ({
    decision: "ROUTED", strategyFingerprint: "fp-1", model: { adapterId: "codex", modelId: "m1", candidateKey: "codex:m1" }
  });
  await service.executePlan({ cwd: root, taskId, confirmationTarget: { ...TARGET } });
  counters.startRun = 0; // launches caused by the setup itself are not under test
  const mcp = createToolHandlers({
    workspaceBound: true, cwdExplicit: true, cwd: root, processCwd: root, userHome: home, env: {}, conversationService: service
  });
  const viaMcp = async () => (await mcp.kairo_task_result({ taskId })).structuredContent.data;
  return { root, taskId, counters, gentleCalls, viaMcp };
}

const walk = (value, visit, path = "") => {
  if (Array.isArray(value)) return value.forEach((v, i) => walk(v, visit, `${path}[${i}]`));
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) { visit(k, v, `${path}.${k}`); walk(v, visit, `${path}.${k}`); }
    return undefined;
  }
  return visit(null, value, path);
};
const FORBIDDEN = /^(command|argv|next_?transition|execute|invocation)$/i;
const FORBIDDEN_VALUE = /gentle-ai review|review\.start|--lineage/;

test("Service and MCP: project Gentle context visible, no executable fields, no action performed", async () => {
  const h = await harness();
  await h.viaMcp(); // settles result_observed once; baseline taken after
  const log = taskPaths(h.root, h.taskId).transitionsPath;
  const before = await sha(log);
  const callsBefore = h.gentleCalls.length;

  const mcp = await h.viaMcp();
  assert.deepEqual(await h.viaMcp(), mcp, "repeated observation is stable");

  for (const out of [mcp]) {
    assert.equal(out.gentle.scope, "project_context");
    assert.equal(out.gentle.receipt, "rcpt-9");
    assert.equal(out.gentle.gate, "g1");
    assert.equal(out.gentle.taskReview, "not_established");
    assert.deepEqual(out.gentle.diagnostics, ["task_binding_unavailable"]);
    assert.equal(out.gentle.actionsEnabled, false);
    const hits = [];
    walk(out, (k, v, p) => {
      if (k && FORBIDDEN.test(k)) hits.push(p);
      if (typeof v === "string" && FORBIDDEN_VALUE.test(v)) hits.push(`${p}=${v}`);
    });
    assert.deepEqual(hits, []);
    assert.equal(out.transitions.recorded.includes("review_authorized"), false);
  }

  assert.equal(await sha(log), before, "transitions.jsonl must be byte-identical");
  assert.equal(h.counters.startRun, 0, "no provider launched");
  const newCalls = h.gentleCalls.slice(callsBefore);
  assert.ok(newCalls.length > 0);
  for (const args of newCalls) {
    assert.equal(isReadOnlyGentleArgv(args) || (args[0] === "review" && args[1] === "status"), true, args.join(" "));
    assert.equal(args.some((a) => /^(start|grant|enable|disable|abandon|invalidate|recover|capture)$/.test(a)), false, args.join(" "));
  }
});
