import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  KAIRO_MCP_READ_TOOLS, KAIRO_MCP_WRITE_TOOLS, KAIRO_MCP_CONVERSATION_DELEGATE_TOOLS,
  createToolHandlers, registerKairoMcpTools, mcpSchemas
} from "../src/global/mcp/kairo-mcp.js";

const WRITE_RE = /write|create|resolve|dismiss|import|export|apply|delete|mutate|publish/i;
const HOSTILE = "token=SECRET Authorization: Bearer abc /Users/kal-el/private/file.txt";

const projectDir = realpathSync(mkdtempSync(join(tmpdir(), "kairo-mcp-del-")));
const otherHome = join(projectDir, "home");
mkdirSync(otherHome);

const TARGET = Object.freeze({
  role: "Implementer", selection: "assigned", strategyFingerprint: "fp-1", candidateKey: "codex:m1"
});

/**
 * Fake service mirroring the real contract: planExecution is read-only,
 * executePlan reuses an existing execution link (never a second launch), and
 * drift between target and fresh route throws.
 */
function fakeService({ route = {}, cancelUnknown = false } = {}) {
  const calls = [];
  const state = { launches: 0, link: null, route: { decision: "ROUTED", ...route } };
  const rec = (name, impl) => async (args) => { calls.push({ name, args }); return impl(args); };
  const fresh = () => (state.route.decision === "ROUTED" && !state.route.noTarget
    ? { ...TARGET, ...(state.route.target ?? {}) } : null);
  const service = {
    resolveSession: rec("resolveSession", ({ ref }) => {
      if (ref === "dup") throw Object.assign(new Error("ambiguous"), { code: "SESSION_REF_AMBIGUOUS" });
      return { id: `${ref}-full` };
    }),
    planExecution: rec("planExecution", ({ taskId, role }) => ({
      decision: state.route.decision, role, provider: "codex", model: "m1", modelRef: { hostile: HOSTILE },
      assignmentSource: "team", strategyFingerprint: "fp-1", why: HOSTILE,
      blockedAssignment: null, suggestedAlternative: null,
      confirmationTarget: fresh(), taskPrompt: "SECRET PROMPT", projectRoot: "/Users/kal-el/private", taskId
    })),
    executePlan: rec("executePlan", ({ taskId, confirmationTarget }) => {
      if (state.link) return { taskId, execution: state.link, reused: true, projectRoot: "/Users/kal-el/p" };
      const target = fresh();
      if (!confirmationTarget || !target || target.strategyFingerprint !== confirmationTarget.strategyFingerprint) {
        throw new Error("Cannot execute: the real project team state changed since this was confirmed");
      }
      state.launches += 1;
      state.link = { runId: "run-1", provider: "codex", state: "running", active: true, message: HOSTILE };
      return { taskId, execution: state.link, reused: false, projectRoot: "/Users/kal-el/p" };
    }),
    cancelExecution: rec("cancelExecution", ({ taskId }) => {
      if (cancelUnknown) throw new Error(`Plan "${taskId}" has no Claude execution.`);
      state.link = { ...state.link, state: "cancelled", active: false };
      return { taskId, execution: state.link, projectRoot: "/Users/kal-el/p" };
    }),
    startRun: rec("startRun", () => { throw new Error("must never launch directly"); })
  };
  return { service, calls, state };
}

const bound = (service) => createToolHandlers({
  workspaceBound: true, cwdExplicit: true, cwd: projectDir, processCwd: projectDir,
  userHome: otherHome, env: {}, conversationService: service
});
const names = (calls) => calls.map((c) => c.name);
const exec = (h, extra = {}) => h.kairo_execute_plan({ taskId: "t-1", confirmationTarget: { ...TARGET }, ...extra });

test("tool classification: preview is a read tool, execute/cancel are write tools, name policy holds", () => {
  assert.deepEqual([...KAIRO_MCP_CONVERSATION_DELEGATE_TOOLS], ["kairo_plan_execution"]);
  assert.ok(KAIRO_MCP_READ_TOOLS.includes("kairo_plan_execution"));
  assert.deepEqual([...KAIRO_MCP_WRITE_TOOLS], [
    "kairo_publish_work_snapshot", "kairo_execute_plan", "kairo_cancel_execution",
    "kairo_setup_run_analysis", "kairo_setup_approve_team", "kairo_setup_set_assignment"
  ]);
  for (const name of ["kairo_plan_execution", "kairo_execute_plan", "kairo_cancel_execution"]) {
    assert.equal(WRITE_RE.test(name), false, name);
  }
});

test("write tools register only when workspace-bound; preview registers in both", () => {
  const unbound = [];
  registerKairoMcpTools((n) => unbound.push(n), { workspaceBound: false });
  assert.ok(unbound.includes("kairo_plan_execution"));
  assert.equal(unbound.includes("kairo_execute_plan"), false);
  assert.equal(unbound.includes("kairo_cancel_execution"), false);
  const boundNames = [];
  registerKairoMcpTools((n) => boundNames.push(n), { workspaceBound: true });
  for (const n of ["kairo_plan_execution", "kairo_execute_plan", "kairo_cancel_execution"]) {
    assert.ok(boundNames.includes(n), n);
  }
});

test("schemas carry no filesystem path inputs", () => {
  for (const key of ["planExecution", "executePlan", "cancelExecution"]) {
    assert.ok(mcpSchemas[key], key);
    const shape = Object.keys(mcpSchemas[key].shape);
    for (const forbidden of ["cwd", "path", "projectRoot", "folder"]) assert.equal(shape.includes(forbidden), false);
  }
  assert.throws(() => mcpSchemas.executePlan.parse({ taskId: "t-1" }));
});

test("unbound/half-bound server refuses all three tools with zero service calls", async () => {
  const { service, calls } = fakeService();
  let built = 0;
  const unbound = createToolHandlers({
    env: { WORKSPACE_FOLDER_PATHS: projectDir }, processCwd: projectDir,
    conversationService: service, createConversationService: () => { built += 1; return service; }
  });
  const half = createToolHandlers({
    workspaceBound: true, cwdExplicit: false, cwd: projectDir, processCwd: projectDir, env: {},
    conversationService: service
  });
  for (const h of [unbound, half]) {
    for (const [name, args] of [
      ["kairo_plan_execution", { taskId: "t-1", role: "Implementer" }],
      ["kairo_execute_plan", { taskId: "t-1", confirmationTarget: TARGET }],
      ["kairo_cancel_execution", { taskId: "t-1" }]
    ]) {
      const res = await h[name](args);
      assert.equal(res.structuredContent.ok, false);
      assert.match(res.structuredContent.code, /^workspace_/);
      assert.equal(res.isError, true);
    }
  }
  assert.deepEqual(calls, []);
  assert.equal(built, 0);
});

test("preview launches nothing, returns the confirmation target, scrubs output", async () => {
  const { service, calls, state } = fakeService();
  const res = await bound(service).kairo_plan_execution({ taskId: "t-1", role: "Implementer" });
  assert.equal(res.structuredContent.ok, true);
  const d = res.structuredContent.data;
  assert.equal(d.decision, "ROUTED");
  assert.deepEqual(d.confirmationTarget, TARGET);
  assert.equal(d.confirmationRequired, true);
  assert.equal(state.launches, 0);
  assert.deepEqual(names(calls), ["planExecution"]);
  const json = JSON.stringify(res.structuredContent);
  for (const leak of ["SECRET", "/Users/kal-el", "Bearer abc"]) assert.equal(json.includes(leak), false, leak);
});

test("preview of a blocked route carries no confirmation target", async () => {
  const { service } = fakeService({ route: { decision: "WAIT_FOR_PROJECT_TEAM" } });
  const d = (await bound(service).kairo_plan_execution({ taskId: "t-1", role: "Implementer" })).structuredContent.data;
  assert.equal(d.confirmationTarget, null);
  assert.equal(d.confirmationRequired, false);
});

test("execute without or with malformed confirmation is refused, zero launches", async () => {
  const { service, calls, state } = fakeService();
  const h = bound(service);
  for (const args of [
    { taskId: "t-1" },
    { taskId: "t-1", confirmationTarget: null },
    { taskId: "t-1", confirmationTarget: { role: "Implementer" } },
    { taskId: "t-1", confirmationTarget: { ...TARGET, selection: "yolo" } }
  ]) {
    const res = await h.kairo_execute_plan(args);
    assert.equal(res.structuredContent.ok, false);
    assert.equal(res.structuredContent.code, "confirmation_required");
    assert.equal(res.isError, true);
  }
  assert.equal(state.launches, 0);
  assert.equal(names(calls).includes("executePlan"), false);
});

test("stale or mismatched confirmation is refused after server-side re-preview, zero launches", async () => {
  const { service, calls, state } = fakeService({ route: { target: { strategyFingerprint: "fp-2" } } });
  const res = await exec(bound(service));
  assert.equal(res.structuredContent.code, "confirmation_stale");
  assert.equal(res.isError, true);
  assert.deepEqual(names(calls), ["planExecution"]);
  assert.equal(state.launches, 0);
  const other = fakeService({ route: { target: { candidateKey: "other" } } });
  assert.equal((await exec(bound(other.service))).structuredContent.code, "confirmation_stale");
  assert.equal(other.state.launches, 0);
});

test("provider unavailable surfaces a blocked code with zero launches", async () => {
  const { service, calls, state } = fakeService({ route: { decision: "WAIT_FOR_PROJECT_TEAM" } });
  const res = await exec(bound(service));
  assert.equal(res.structuredContent.ok, false);
  assert.equal(res.structuredContent.code, "provider_unavailable");
  assert.equal(state.launches, 0);
  assert.equal(names(calls).includes("executePlan"), false);
  const manual = fakeService({ route: { decision: "MANUAL_HANDOFF" } });
  assert.equal((await exec(bound(manual.service))).structuredContent.code, "provider_unavailable");
});

test("ambiguous session ref is refused, never guessed, zero launches", async () => {
  const { service, state } = fakeService();
  const res = await exec(bound(service), { ref: "dup" });
  assert.equal(res.structuredContent.code, "session_ref_ambiguous");
  assert.equal(state.launches, 0);
});

test("confirmed execute launches exactly once via service.executePlan only", async () => {
  const { service, calls, state } = fakeService();
  const res = await exec(bound(service));
  assert.equal(res.structuredContent.ok, true);
  assert.equal(res.structuredContent.data.runId, "run-1");
  assert.equal(res.structuredContent.data.reused, false);
  assert.equal(state.launches, 1);
  assert.deepEqual(names(calls), ["planExecution", "executePlan"]);
  assert.deepEqual(calls[1].args.confirmationTarget, TARGET);
  assert.equal(names(calls).includes("startRun"), false);
  const json = JSON.stringify(res.structuredContent);
  for (const leak of ["SECRET", "/Users/kal-el", "Bearer abc"]) assert.equal(json.includes(leak), false, leak);
});

test("repeating the same confirmed execute does not launch twice", async () => {
  const { service, state } = fakeService();
  const h = bound(service);
  await exec(h);
  const again = await exec(h);
  assert.equal(again.structuredContent.ok, true);
  assert.equal(again.structuredContent.data.reused, true);
  assert.equal(again.structuredContent.data.runId, "run-1");
  assert.equal(state.launches, 1);
  // a fresh MCP connection over the same service (reconnect) also never relaunches
  await exec(bound(service));
  assert.equal(state.launches, 1);
});

test("declined consent (no confirmation call) leaves no run", async () => {
  const { service, state } = fakeService();
  const h = bound(service);
  await h.kairo_plan_execution({ taskId: "t-1", role: "Implementer" });
  assert.equal(state.link, null);
  assert.equal(state.launches, 0);
});

test("cancel goes through service.cancelExecution; unknown run is a typed error", async () => {
  const { service, calls, state } = fakeService();
  const h = bound(service);
  await exec(h);
  const res = await h.kairo_cancel_execution({ taskId: "t-1" });
  assert.equal(res.structuredContent.ok, true);
  assert.equal(res.structuredContent.data.state, "cancelled");
  assert.equal(res.structuredContent.data.active, false);
  assert.equal(names(calls).at(-1), "cancelExecution");
  assert.equal(state.launches, 1);
  const unknown = fakeService({ cancelUnknown: true });
  const bad = await bound(unknown.service).kairo_cancel_execution({ taskId: "t-9" });
  assert.equal(bad.structuredContent.ok, false);
  assert.equal(bad.structuredContent.code, "execution_not_found");
  assert.equal(bad.isError, true);
});

test("read-only mode schemas: plan and target accept optional standard|read-only; anything else is rejected; absent mode still validates", async () => {
  const { conversationDelegateSchemas } = await import("../src/global/mcp/conversation-delegate-tools.js");
  const plan = conversationDelegateSchemas.planExecution;
  assert.equal(plan.safeParse({ taskId: "t-1", role: "Implementer" }).success, true);
  assert.equal(plan.safeParse({ taskId: "t-1", role: "Implementer", mode: "read-only" }).success, true);
  assert.equal(plan.safeParse({ taskId: "t-1", role: "Implementer", mode: "standard" }).success, true);
  assert.equal(plan.safeParse({ taskId: "t-1", role: "Implementer", mode: "yolo" }).success, false);
  const exec = conversationDelegateSchemas.executePlan;
  assert.equal(exec.safeParse({ taskId: "t-1", confirmationTarget: { ...TARGET } }).success, true);
  assert.equal(exec.safeParse({ taskId: "t-1", confirmationTarget: { ...TARGET, mode: "read-only" } }).success, true);
  assert.equal(exec.safeParse({ taskId: "t-1", confirmationTarget: { ...TARGET, mode: "write" } }).success, false);
});
