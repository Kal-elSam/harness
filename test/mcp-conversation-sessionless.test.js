import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createToolHandlers, mcpSchemas } from "../src/global/mcp/kairo-mcp.js";
import { createConversationService } from "../src/global/conversation/service.js";

const projectDir = realpathSync(mkdtempSync(join(tmpdir(), "kairo-mcp-nosess-")));
const otherHome = join(projectDir, "home");
mkdirSync(otherHome);

const TARGET = Object.freeze({ role: "Implementer", selection: "assigned", strategyFingerprint: "fp-1", candidateKey: "codex:m1" });
const never = (name) => async () => { throw new Error(`${name} must not be called: the engine is project-scoped`); };

// A service with NO session API at all: any session lookup would throw.
function projectScopedService() {
  const calls = [];
  const rec = (name, impl) => async (args) => { calls.push({ name, args }); return impl(args); };
  return {
    calls,
    service: {
      resolveSession: never("resolveSession"),
      listSessions: never("listSessions"),
      readTeam: rec("readTeam", () => ({
        state: "active", roles: [], providers: [],
        tasks: [{ taskId: "t-1", taskText: "x", state: "approved", provider: "codex", model: "m", sessionId: "legacy-1", execution: null, artifacts: [], error: null }]
      })),
      readTaskResult: rec("readTaskResult", ({ taskId }) => ({ taskId, runId: "run-1", provider: "codex", status: "terminal", runState: "completed" })),
      readSetup: rec("readSetup", () => ({ projectRoot: projectDir, adapters: [], providers: [], strategy: null, record: null })),
      planExecution: rec("planExecution", ({ taskId, role }) => ({
        decision: "ROUTED", role, provider: "codex", model: "m1", assignmentSource: "team", strategyFingerprint: "fp-1",
        why: "ok", blockedAssignment: null, suggestedAlternative: null, confirmationTarget: { ...TARGET }, taskId
      })),
      executePlan: rec("executePlan", ({ taskId }) => ({ taskId, execution: { runId: "r1", provider: "codex", state: "running", active: true }, reused: false })),
      cancelExecution: rec("cancelExecution", ({ taskId }) => ({ taskId, execution: { runId: "r1", provider: "codex", state: "cancelled", active: false } }))
    }
  };
}
const bound = (service) => createToolHandlers({
  workspaceBound: true, cwdExplicit: true, cwd: projectDir, processCwd: projectDir,
  userHome: otherHome, env: {}, conversationService: service
});

const LEGACY = { ref: "aaaa", sessionId: "aaaa-full" };

for (const [name, args] of [
  ["kairo_team", {}],
  ["kairo_task_result", { taskId: "t-1" }],
  ["kairo_plan_execution", { taskId: "t-1", role: "Implementer" }],
  ["kairo_execute_plan", { taskId: "t-1", confirmationTarget: { ...TARGET } }],
  ["kairo_cancel_execution", { taskId: "t-1" }],
  ["kairo_setup", {}]
]) {
  test(`${name}: a legacy ref/sessionId is accepted and ignored, output shape unchanged`, async () => {
    const plain = projectScopedService();
    const legacy = projectScopedService();
    const a = await bound(plain.service)[name](args);
    const b = await bound(legacy.service)[name]({ ...args, ...LEGACY });
    assert.equal(a.structuredContent.ok, true, JSON.stringify(a.structuredContent));
    assert.equal(b.structuredContent.ok, true, JSON.stringify(b.structuredContent));
    assert.deepEqual(b.structuredContent, a.structuredContent);
    for (const c of legacy.calls) assert.equal("sessionId" in c.args, false, `${c.name} received sessionId`);
  });
}

test("kairo_sessions still answers (deprecated) without touching any session store", async () => {
  const { service } = projectScopedService();
  const res = await bound(service).kairo_sessions({});
  assert.equal(res.structuredContent.ok, true);
  assert.deepEqual(res.structuredContent.data, { sessions: [] });
  const withRef = await bound(service).kairo_sessions({ ...LEGACY });
  assert.deepEqual(withRef.structuredContent, res.structuredContent);
});

test("MCP schemas keep accepting ref and sessionId as optional deprecated inputs", () => {
  for (const key of ["sessions", "team", "taskResult", "planExecution", "executePlan", "cancelExecution", "setup", "setupPlan", "setupRunAnalysis", "setupApproveTeam", "setupSetAssignment"]) {
    const shape = mcpSchemas[key].shape;
    assert.ok(shape.ref?.isOptional(), `${key}.ref`);
    assert.ok(shape.sessionId?.isOptional(), `${key}.sessionId`);
    assert.match(shape.ref.description ?? "", /deprecated/i);
    assert.match(shape.sessionId.description ?? "", /deprecated/i);
  }
});

// Before sessionId was declared it was an unknown key that zod stripped, so ANY
// value passed validation. Declaring it must not start rejecting those values.
test("MCP schemas still accept any legacy sessionId value", () => {
  for (const key of ["sessions", "team", "cancelExecution", "setup"]) {
    for (const value of [null, "", "x".repeat(200), 42, { nested: true }]) {
      const parsed = mcpSchemas[key].safeParse(key === "cancelExecution" ? { taskId: "t-1", sessionId: value } : { sessionId: value });
      assert.ok(parsed.success, `${key} rejected sessionId=${JSON.stringify(value)}`);
    }
  }
});

function engine(plans) {
  return createConversationService({
    resolveRoot: async (cwd) => cwd,
    listPlans: async () => plans,
    readExecution: async () => null,
    recoverRuns: async () => {},
    inspectExecutionAdapters: () => [],
    inspectEngramIntegration: () => ({ status: "configured" }),
    readProjectStrategy: async () => null
  });
}
const PLAN = (taskId, sessionId) => ({
  taskId, state: "approved", provider: "codex", model: null, sessionId, baseHead: "a".repeat(40),
  taskText: taskId, artifacts: []
});

test("engine reads are project-scoped: every task of the project shows, whatever session recorded it", async () => {
  const service = engine([PLAN("t1", "s-a"), PLAN("t2", "s-b"), PLAN("t3", null)]);
  const team = await service.readTeam({ cwd: "/repo" });
  assert.deepEqual(team.tasks.map((t) => t.taskId).sort(), ["t1", "t2", "t3"]);
  const work = await service.readWork({ cwd: "/repo", sessionId: "s-a" });
  assert.deepEqual(work.tasks.map((t) => t.taskId).sort(), ["t1", "t2", "t3"]);
  assert.equal("sessions" in work, false);
});

test("the retired chat/session methods are gone from the service", () => {
  const service = engine([]);
  for (const m of ["planAsk", "askQuestion", "submitTask", "getSession", "setMode", "resolveActiveSession",
    "listSessions", "resolveSession", "loadTranscript", "appendTranscript", "clearTranscript", "readRunTranscript", "acquireSessionLock"]) {
    assert.equal(typeof service[m], "undefined", m);
  }
});
