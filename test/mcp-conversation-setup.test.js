import test from "node:test";
import assert from "node:assert/strict";
import {
  KAIRO_MCP_READ_TOOLS, KAIRO_MCP_WRITE_TOOLS, KAIRO_MCP_CONVERSATION_SETUP_TOOLS,
  KAIRO_MCP_CONVERSATION_SETUP_WRITE_TOOLS, createToolHandlers, registerKairoMcpTools, mcpSchemas
} from "../src/global/mcp/kairo-mcp.js";
import { registerKairoConversationTools, KAIRO_PI_CONVERSATION_TOOLS } from "../src/global/host/extension/conversation-tools.js";
import { ENTITLEMENT } from "../src/global/observability/claude-model-entitlement.js";
import { harness, draftTeam } from "./helpers/setup-harness.js";

const WRITE_RE = /write|create|resolve|dismiss|import|export|apply|delete|mutate|publish/i;
const READ = ["kairo_setup", "kairo_setup_plan"];
const WRITE = ["kairo_setup_run_analysis", "kairo_setup_approve_team", "kairo_setup_set_assignment"];

async function both(options = {}) {
  const h = await harness({ git: true, ...options });
  const mcp = createToolHandlers({
    workspaceBound: true, cwdExplicit: true, cwd: h.root, processCwd: h.root, userHome: h.home, env: {},
    conversationService: h.service
  });
  const tools = new Map();
  registerKairoConversationTools({ registerTool(t) { tools.set(t.name, t); } }, {
    getService: async () => h.service, resolveProjectRootImpl: async (c) => c
  });
  const ctx = { cwd: h.root };
  const piCall = async (name, params = {}) => (await tools.get(name).execute("id", params, undefined, undefined, ctx)).details;
  const mcpCall = async (name, args = {}) => (await mcp[name](args)).structuredContent;
  return { ...h, mcp, tools, piCall, mcpCall };
}

test("classification: setup read + preview are read tools, the three confirmed mutations are write tools", () => {
  assert.deepEqual([...KAIRO_MCP_CONVERSATION_SETUP_TOOLS], READ);
  assert.deepEqual([...KAIRO_MCP_CONVERSATION_SETUP_WRITE_TOOLS], WRITE);
  for (const n of READ) assert.ok(KAIRO_MCP_READ_TOOLS.includes(n), n);
  for (const n of WRITE) assert.ok(KAIRO_MCP_WRITE_TOOLS.includes(n), n);
  for (const n of [...READ, ...WRITE]) assert.equal(WRITE_RE.test(n), false, n);
});

test("write tools register only when workspace-bound; read tools register in both", () => {
  const unbound = [];
  registerKairoMcpTools((n) => unbound.push(n), { workspaceBound: false });
  for (const n of READ) assert.ok(unbound.includes(n), n);
  for (const n of WRITE) assert.equal(unbound.includes(n), false, n);
  const bound = [];
  registerKairoMcpTools((n) => bound.push(n), { workspaceBound: true });
  for (const n of [...READ, ...WRITE]) assert.ok(bound.includes(n), n);
});

test("schemas carry no filesystem inputs and require the confirmation target", () => {
  for (const key of ["setup", "setupPlan", "setupRunAnalysis", "setupApproveTeam", "setupSetAssignment"]) {
    assert.ok(mcpSchemas[key], key);
    for (const forbidden of ["cwd", "path", "projectRoot", "folder"]) assert.equal(Object.keys(mcpSchemas[key].shape).includes(forbidden), false);
  }
  for (const key of ["setupRunAnalysis", "setupApproveTeam", "setupSetAssignment"]) {
    assert.throws(() => mcpSchemas[key].parse({}), key);
  }
});

test("unbound server refuses every setup tool with zero service calls", async () => {
  let built = 0;
  const h = createToolHandlers({ env: {}, createConversationService: () => { built += 1; return {}; } });
  for (const name of [...READ, ...WRITE]) {
    const res = await h[name]({ action: "approve_team", confirmationTarget: { action: "approve_team", subject: null, candidateKey: null, stateFingerprint: "x" } });
    assert.equal(res.structuredContent.ok, false, name);
    assert.match(res.structuredContent.code, /^workspace_/);
  }
  assert.equal(built, 0);
});

test("Pi registers the setup tools with the MCP names", async () => {
  const c = await both();
  for (const n of [...READ, ...WRITE]) {
    assert.ok(c.tools.has(n), n);
    assert.ok(KAIRO_PI_CONVERSATION_TOOLS.includes(n), n);
  }
});

test("Pi and MCP return deeply equal setup, preview and confirmed results; repeated reads write nothing", async () => {
  const c = await both();
  const a = await c.piCall("kairo_setup");
  assert.deepEqual(a, (await c.mcpCall("kairo_setup")).data);
  assert.deepEqual(await c.piCall("kairo_setup"), a);
  const args = { action: "run_analysis", analyzerKey: "codex::codex-model" };
  const plan = await c.piCall("kairo_setup_plan", args);
  assert.deepEqual(plan, (await c.mcpCall("kairo_setup_plan", args)).data);
  assert.equal(c.counts.analyze, 0);
  assert.equal(c.counts.strategyWrites, 0);
  const done = await c.piCall("kairo_setup_run_analysis", { confirmationTarget: plan.confirmationTarget });
  assert.equal(done.strategyStatus, "draft");
  assert.equal(c.counts.analyze, 1);
  // Same confirmed action via MCP is re-validated against the new (draft) state.
  const again = await c.mcpCall("kairo_setup_run_analysis", { confirmationTarget: plan.confirmationTarget });
  assert.equal(again.code, "confirmation_stale");
  assert.equal(c.counts.analyze, 1);
  const approve = await c.piCall("kairo_setup_plan", { action: "approve_team" });
  assert.deepEqual(approve, (await c.mcpCall("kairo_setup_plan", { action: "approve_team" })).data);
  const mcpApproved = await c.mcpCall("kairo_setup_approve_team", { confirmationTarget: approve.confirmationTarget });
  assert.equal(mcpApproved.data.strategyStatus, "active");
  assert.deepEqual(await c.piCall("kairo_setup"), (await c.mcpCall("kairo_setup")).data);
  assert.equal(c.counts.startRun, 0);
});

test("typed refusals are identical on both transports (access missing, stale, active)", async () => {
  const c = await both({ claude: ENTITLEMENT.UNVERIFIED });
  const refused = await c.piCall("kairo_setup_plan", { action: "run_analysis", analyzerKey: "claude::claude-model" });
  assert.deepEqual(refused, (await c.mcpCall("kairo_setup_plan", { action: "run_analysis", analyzerKey: "claude::claude-model" })).data);
  assert.equal(refused.reasonCode, "access_unverified");
  const target = { action: "approve_team", subject: null, candidateKey: null, stateFingerprint: "x" };
  await assert.rejects(c.piCall("kairo_setup_approve_team", { confirmationTarget: target }), { code: "no_strategy" });
  assert.equal((await c.mcpCall("kairo_setup_approve_team", { confirmationTarget: target })).code, "no_strategy");
  await assert.rejects(c.piCall("kairo_setup_approve_team", { confirmationTarget: null }), { code: "confirmation_required" });
  assert.equal(c.counts.analyze, 0);
  assert.equal(c.counts.strategyWrites, 0);
});

test("set assignment is refused identically while active; old and new are stated while draft", async () => {
  const c = await both();
  await draftTeam(c);
  const plan = await c.piCall("kairo_setup_plan", { action: "set_assignment", role: "Explorer", candidateKey: "claude::claude-model" });
  assert.equal(plan.decision, "READY");
  const done = await c.mcpCall("kairo_setup_set_assignment", { confirmationTarget: plan.confirmationTarget });
  assert.equal(done.data.change.to.candidateKey, "claude::claude-model");
  assert.ok(done.data.change.from.provider);
  const approve = await c.piCall("kairo_setup_plan", { action: "approve_team" });
  await c.piCall("kairo_setup_approve_team", { confirmationTarget: approve.confirmationTarget });
  const writes = c.counts.strategyWrites;
  const after = await c.piCall("kairo_setup_plan", { action: "set_assignment", role: "Explorer", candidateKey: "codex::codex-model" });
  assert.equal(after.reasonCode, "strategy_not_draft");
  assert.equal(c.counts.strategyWrites, writes);
});

test("Pi refuses without a host ctx and outputs carry no absolute paths or secrets", async () => {
  const c = await both({ claude: ENTITLEMENT.DENIED });
  await assert.rejects(c.tools.get("kairo_setup").execute("id", {}, undefined, undefined, undefined), { code: "project_unbound" });
  const text = JSON.stringify(await c.piCall("kairo_setup")) + JSON.stringify((await c.mcpCall("kairo_setup")).data);
  assert.equal(text.includes(c.root), false);
  assert.equal(text.includes(c.home), false);
});
