import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArchitecturePlan } from "../src/global/architect/architect-manager.js";
import { transitionTask } from "../src/global/architect/architect-store.js";
import { createConversationService } from "../src/global/conversation/service.js";
import { createSession } from "../src/global/conversation/session-registry.js";
import { createToolHandlers } from "../src/global/mcp/kairo-mcp.js";

const RUN = "run_ro_1";
const SNAPSHOT = {
  project: { label: "demo" }, session: { state: "unbound" },
  team: { state: "active", assignments: [], rows: [] }, usage: [], agents: [], spaces: [],
  subscriptions: { state: "ready", segments: [], usageModel: [] }, memory: { status: "configured" }
};
const TARGET = Object.freeze({ role: "Builder", selection: "assigned", strategyFingerprint: "fp-1", candidateKey: "codex:m1" });

async function gitRepo() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "kairo-ro-repo-")));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "T"], { cwd: root });
  await writeFile(join(root, "README.md"), "hi\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: root });
  return root;
}

async function harness() {
  const root = await gitRepo();
  const home = await mkdtemp(join(tmpdir(), "kairo-ro-home-"));
  const created = await createArchitecturePlan({
    task: "Do a thing", cwd: root, runCodex: async () => ({ plan: "## Plan\nDo it.", usage: null })
  });
  const taskId = created.status.taskId;
  await transitionTask(root, taskId, "approved");
  const counters = { startRun: 0 };
  const service = createConversationService({
    resolveRoot: async () => root, homeDir: home, createRunId: () => RUN,
    startRun: async () => {
      counters.startRun += 1;
      return { metadata: { state: "running", startedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" } };
    },
    readRun: async () => ({ runId: RUN, agentId: "codex", state: "completed", error: null }),
    readRunEvents: async () => [{ type: "run.transcript", source: "codex", data: { text: "Done." } }],
    gentle: { probe: async () => ({ state: "missing", evidence: [] }), runCommand: () => { throw new Error("must not run"); } }
  });
  service.routeProjectExecution = async () => ({
    decision: "ROUTED", role: "Builder", strategyFingerprint: "fp-1",
    model: { adapterId: "codex", modelId: "m1", candidateKey: "codex:m1" }
  });
  const session = await createSession(home, root, {});
  const mcp = createToolHandlers({
    workspaceBound: true, cwdExplicit: true, cwd: root, processCwd: root, userHome: home, env: {},
    conversationService: service
  });
  const mcpCall = async (name, args) => (await mcp[name](args)).structuredContent.data;
  return { root, home, taskId, counters, service, session, mcp, mcpCall };
}

test("read-only mode over MCP: preview shows it, a standard target keeps its exact shape, a read-only confirmation is refused before launch for an adapter without containment, and an invalid mode is rejected", async () => {
  const h = await harness();
  const roPlan = await h.mcpCall("kairo_plan_execution", { taskId: h.taskId, role: "Builder", mode: "read-only" });
  assert.equal(roPlan.mode, "read-only");
  assert.deepEqual(roPlan.confirmationTarget, { ...TARGET, mode: "read-only" });
  const stdPlan = await h.mcpCall("kairo_plan_execution", { taskId: h.taskId, role: "Builder" });
  assert.equal(stdPlan.mode, "standard");
  assert.deepEqual(stdPlan.confirmationTarget, TARGET, "standard target keeps its exact shape");

  // codex has no read-only containment yet: refused before any launch or link.
  const refused = (await h.mcp.kairo_execute_plan({ taskId: h.taskId, confirmationTarget: roPlan.confirmationTarget })).structuredContent;
  assert.equal(refused.code, "read_only_unsupported");
  assert.equal(h.counters.startRun, 0);

  // An invalid mode never reaches a launch.
  const bad = (await h.mcp.kairo_plan_execution({ taskId: h.taskId, role: "Builder", mode: "yolo" })).structuredContent;
  assert.equal(bad.code, "invalid_execution_mode");
  assert.equal(h.counters.startRun, 0);
});
