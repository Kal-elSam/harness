import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  KAIRO_MCP_READ_TOOLS, KAIRO_MCP_WRITE_TOOLS, KAIRO_MCP_CONVERSATION_READ_TOOLS,
  createToolHandlers, registerKairoMcpTools
} from "../src/global/mcp/kairo-mcp.js";

const TOOLS = ["kairo_sessions", "kairo_team", "kairo_task_result"];
const WRITE_RE = /write|create|resolve|dismiss|import|export|apply|delete|mutate|publish/i;
const HOSTILE = "token=SECRET Authorization: Bearer abc /Users/kal-el/private/file.txt";

const projectDir = realpathSync(mkdtempSync(join(tmpdir(), "kairo-mcp-conv-")));
const otherHome = join(projectDir, "home");
mkdirSync(otherHome);

function fakeService(overrides = {}) {
  const calls = [];
  const rec = (name, impl) => async (args) => { calls.push({ name, args }); return impl(args); };
  const service = {
    listSessions: rec("listSessions", () => [
      { id: "aaaa1111", title: HOSTILE, mode: "ask", createdAt: "t1", updatedAt: "t2", projectKey: "k" }
    ]),
    resolveSession: rec("resolveSession", ({ ref }) => ({ id: `${ref}-full`, title: "x", mode: "ask", createdAt: "t1", updatedAt: "t2" })),
    readTeam: rec("readTeam", () => ({
      schema: "s", projectRoot: "/Users/kal-el/private/proj", state: "active",
      roles: [{ role: "Orchestrator", provider: "codex", model: "m", modelId: "m1", installed: true, launchable: true, eligible: false, blockedReason: HOSTILE }],
      providers: [{ id: "codex", label: "Codex", installed: true, launchable: true, reason: HOSTILE, eligibility: null }],
      tasks: [{ taskId: "t-1", taskText: HOSTILE, state: "approved", provider: "codex", model: "m", sessionId: "aaaa1111", execution: null, artifacts: ["/Users/kal-el/private/a.md"], error: HOSTILE }]
    })),
    readTaskResult: rec("readTaskResult", ({ taskId }) => ({
      taskId, runId: "run-1", provider: "codex", status: "terminal", runState: "completed",
      result: { ok: true, workerId: "run-1", status: "completed", summary: HOSTILE, error: null },
      gentle: { state: "project_receipt", scope: "project_context", taskReview: "not_established", receipt: { path: "/Users/kal-el/x" }, reason: HOSTILE }
    })),
    startRun: rec("startRun", () => { throw new Error("must never launch"); }),
    executePlan: rec("executePlan", () => { throw new Error("must never execute"); }),
    ...overrides
  };
  return { service, calls };
}

const bound = (service) => createToolHandlers({
  workspaceBound: true, cwdExplicit: true, cwd: projectDir, processCwd: projectDir,
  userHome: otherHome, env: {}, conversationService: service
});
const names = (calls) => calls.map((c) => c.name);

test("conversation read tools are read tools, not write tools, and pass the name policy", () => {
  assert.deepEqual([...KAIRO_MCP_CONVERSATION_READ_TOOLS], TOOLS);
  for (const name of TOOLS) {
    assert.ok(KAIRO_MCP_READ_TOOLS.includes(name));
    assert.equal(KAIRO_MCP_WRITE_TOOLS.includes(name), false);
    assert.equal(WRITE_RE.test(name), false);
  }
});

test("registered for unbound servers and also for write-bound servers", () => {
  for (const workspaceBound of [false, true]) {
    const registered = [];
    registerKairoMcpTools((n) => registered.push(n), { workspaceBound });
    for (const name of TOOLS) assert.ok(registered.includes(name), `${name} bound=${workspaceBound}`);
  }
});

test("no explicit project: typed refusal, zero service calls, service never built", async () => {
  const { service, calls } = fakeService();
  let built = 0;
  const unbound = createToolHandlers({
    env: { WORKSPACE_FOLDER_PATHS: projectDir, VSCODE_CWD: projectDir },
    processCwd: projectDir, conversationService: service,
    createConversationService: () => { built += 1; return service; }
  });
  const half = createToolHandlers({
    workspaceBound: true, cwdExplicit: false, cwd: projectDir, processCwd: projectDir, env: {},
    conversationService: service
  });
  for (const h of [unbound, half]) {
    for (const [name, args] of [["kairo_sessions", {}], ["kairo_team", {}], ["kairo_task_result", { taskId: "t-1" }]]) {
      const res = await h[name](args);
      assert.equal(res.structuredContent.ok, false);
      assert.match(res.structuredContent.code, /^workspace_/);
      assert.equal(res.isError, true);
      assert.equal(res.structuredContent.data, null);
    }
  }
  assert.deepEqual(calls, []);
  assert.equal(built, 0);
});

test("service is built lazily, only when a bound tool is called", async () => {
  const { service } = fakeService();
  let built = 0;
  const h = createToolHandlers({
    workspaceBound: true, cwdExplicit: true, cwd: projectDir, processCwd: projectDir, userHome: otherHome,
    env: {}, createConversationService: () => { built += 1; return service; }
  });
  assert.equal(built, 0);
  await h.kairo_sessions({});
  await h.kairo_sessions({});
  assert.equal(built, 1);
});

test("bound reads use the bound project root, never an agent-supplied path", async () => {
  const { service, calls } = fakeService();
  const h = bound(service);
  await h.kairo_sessions({ cwd: "/etc", path: "/etc", projectRoot: "/etc" });
  await h.kairo_team({ cwd: "/etc" });
  await h.kairo_task_result({ taskId: "t-1", cwd: "/etc" });
  assert.equal(calls.length, 3);
  for (const c of calls) assert.equal(c.args.cwd, projectDir);
});

test("sessions: list and ref resolution; ambiguous ref surfaces a typed error, nothing created", async () => {
  const { service, calls } = fakeService({
    resolveSession: async () => { throw Object.assign(new Error(`ambiguous ${HOSTILE}`), { code: "SESSION_REF_AMBIGUOUS" }); }
  });
  const h = bound(service);
  const list = await h.kairo_sessions({});
  assert.equal(list.structuredContent.ok, true);
  assert.equal(list.structuredContent.data.sessions[0].sessionId, "aaaa1111");
  const amb = await h.kairo_sessions({ ref: "aa" });
  assert.equal(amb.structuredContent.ok, false);
  assert.equal(amb.structuredContent.code, "session_ref_ambiguous");
  assert.equal(amb.isError, true);
  assert.equal(/SECRET|Bearer|kal-el/.test(JSON.stringify(amb)), false);
  assert.deepEqual(names(calls), ["listSessions"]);

  const unknown = createToolHandlers({
    workspaceBound: true, cwdExplicit: true, cwd: projectDir, processCwd: projectDir, userHome: otherHome, env: {},
    conversationService: fakeService({
      resolveSession: async () => { throw Object.assign(new Error("none"), { code: "SESSION_REF_UNKNOWN" }); }
    }).service
  });
  assert.equal((await unknown.kairo_sessions({ ref: "zz" })).structuredContent.code, "session_ref_unknown");
});

test("session ref resolves to the session id used by team and task result", async () => {
  const { service, calls } = fakeService();
  const h = bound(service);
  const one = await h.kairo_sessions({ ref: "aaaa" });
  assert.equal(one.structuredContent.data.sessions.length, 1);
  await h.kairo_team({ ref: "aaaa" });
  await h.kairo_task_result({ taskId: "t-1", ref: "aaaa" });
  const team = calls.find((c) => c.name === "readTeam");
  const res = calls.find((c) => c.name === "readTaskResult");
  assert.equal(team.args.sessionId, "aaaa-full");
  assert.equal(res.args.sessionId, "aaaa-full");
});

test("hostile strings and absolute paths are redacted from every tool", async () => {
  const { service } = fakeService();
  const h = bound(service);
  const out = [
    await h.kairo_sessions({}), await h.kairo_team({}), await h.kairo_task_result({ taskId: "t-1" })
  ];
  for (const res of out) {
    assert.equal(res.structuredContent.ok, true);
    const text = JSON.stringify(res);
    assert.equal(/SECRET|Bearer abc|\/Users\/|kal-el|private/.test(text), false, text);
  }
  const team = out[1].structuredContent.data;
  assert.equal(team.roles[0].role, "Orchestrator");
  assert.equal(team.roles[0].eligible, false);
  assert.equal(team.tasks[0].taskId, "t-1");
  assert.equal("projectRoot" in team, false);
  const result = out[2].structuredContent.data;
  assert.equal(result.status, "terminal");
  assert.equal(result.gentle.taskReview, "not_established");
});

test("service failures map to safe codes without leaking messages", async () => {
  const h = bound(fakeService({
    readTaskResult: async () => { throw new Error(`Plan "t-9" not found. ${HOSTILE}`); },
    readTeam: async () => { throw new Error(HOSTILE); }
  }).service);
  const missing = await h.kairo_task_result({ taskId: "t-9" });
  assert.equal(missing.structuredContent.code, "task_not_found");
  const broken = await h.kairo_team({});
  assert.equal(broken.structuredContent.code, "read_failed");
  assert.equal(/SECRET|kal-el/.test(JSON.stringify([missing, broken])), false);
});

test("repeated calls are identical and never launch or execute anything", async () => {
  const { service, calls } = fakeService();
  const h = bound(service);
  for (const [name, args] of [["kairo_sessions", {}], ["kairo_team", {}], ["kairo_task_result", { taskId: "t-1" }]]) {
    const a = await h[name](args);
    const b = await h[name](args);
    assert.deepEqual(a, b);
  }
  assert.equal(calls.some((c) => c.name === "startRun" || c.name === "executePlan"), false);
  assert.equal(calls.length, 6);
});
