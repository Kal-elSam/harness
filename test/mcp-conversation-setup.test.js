import test from "node:test";
import assert from "node:assert/strict";
import {
  KAIRO_MCP_READ_TOOLS, KAIRO_MCP_WRITE_TOOLS, KAIRO_MCP_CONVERSATION_SETUP_TOOLS,
  KAIRO_MCP_CONVERSATION_SETUP_WRITE_TOOLS, createToolHandlers, registerKairoMcpTools, mcpSchemas
} from "../src/global/mcp/kairo-mcp.js";
import { ENTITLEMENT } from "../src/global/observability/claude-model-entitlement.js";
import { harness, draftTeam } from "./helpers/setup-harness.js";

const WRITE_RE = /write|create|resolve|dismiss|import|export|apply|delete|mutate|publish/i;
const READ = ["kairo_setup", "kairo_setup_plan"];
const WRITE = ["kairo_setup_run_analysis", "kairo_setup_approve_team", "kairo_setup_set_assignment"];

async function env(options = {}) {
  const h = await harness({ git: true, ...options });
  const mcp = createToolHandlers({
    workspaceBound: true, cwdExplicit: true, cwd: h.root, processCwd: h.root, userHome: h.home, env: {},
    conversationService: h.service
  });
  const mcpCall = async (name, args = {}) => (await mcp[name](args)).structuredContent;
  return { ...h, mcp, mcpCall };
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

test("MCP returns stable setup, preview and confirmed results; repeated reads write nothing", async () => {
  const c = await env();
  const a = (await c.mcpCall("kairo_setup")).data;
  assert.deepEqual((await c.mcpCall("kairo_setup")).data, a);
  const args = { action: "run_analysis", analyzerKey: "codex::codex-model" };
  const plan = (await c.mcpCall("kairo_setup_plan", args)).data;
  assert.deepEqual((await c.mcpCall("kairo_setup_plan", args)).data, plan);
  assert.equal(c.counts.analyze, 0);
  assert.equal(c.counts.strategyWrites, 0);
  const done = (await c.mcpCall("kairo_setup_run_analysis", { confirmationTarget: plan.confirmationTarget })).data;
  assert.equal(done.strategyStatus, "draft");
  assert.equal(c.counts.analyze, 1);
  // The same confirmed action is re-validated against the new (draft) state.
  const again = await c.mcpCall("kairo_setup_run_analysis", { confirmationTarget: plan.confirmationTarget });
  assert.equal(again.code, "confirmation_stale");
  assert.equal(c.counts.analyze, 1);
  const approve = (await c.mcpCall("kairo_setup_plan", { action: "approve_team" })).data;
  assert.deepEqual((await c.mcpCall("kairo_setup_plan", { action: "approve_team" })).data, approve);
  const mcpApproved = await c.mcpCall("kairo_setup_approve_team", { confirmationTarget: approve.confirmationTarget });
  assert.equal(mcpApproved.data.strategyStatus, "active");
  assert.equal((await c.mcpCall("kairo_setup")).data.strategyStatus, "active");
  assert.equal(c.counts.startRun, 0);
});

test("typed refusals are stable over MCP (access missing, stale, no strategy, missing confirmation)", async () => {
  const c = await env({ claude: ENTITLEMENT.UNVERIFIED });
  const args = { action: "run_analysis", analyzerKey: "claude::claude-model" };
  const refused = (await c.mcpCall("kairo_setup_plan", args)).data;
  assert.deepEqual((await c.mcpCall("kairo_setup_plan", args)).data, refused);
  assert.equal(refused.reasonCode, "access_unverified");
  const target = { action: "approve_team", subject: null, candidateKey: null, stateFingerprint: "x" };
  assert.equal((await c.mcpCall("kairo_setup_approve_team", { confirmationTarget: target })).code, "no_strategy");
  const missing = await c.mcpCall("kairo_setup_approve_team", { confirmationTarget: null });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "confirmation_required");
  assert.equal(c.counts.analyze, 0);
  assert.equal(c.counts.strategyWrites, 0);
});

test("set assignment is refused while active; old and new are stated while draft", async () => {
  const c = await env();
  await draftTeam(c);
  const plan = (await c.mcpCall("kairo_setup_plan", { action: "set_assignment", role: "Architect", candidateKey: "codex::codex-model" })).data;
  assert.equal(plan.decision, "READY");
  const done = await c.mcpCall("kairo_setup_set_assignment", { confirmationTarget: plan.confirmationTarget });
  assert.equal(done.data.change.to.candidateKey, "codex::codex-model");
  assert.ok(done.data.change.from.provider);
  const approve = (await c.mcpCall("kairo_setup_plan", { action: "approve_team" })).data;
  await c.mcpCall("kairo_setup_approve_team", { confirmationTarget: approve.confirmationTarget });
  const writes = c.counts.strategyWrites;
  const after = (await c.mcpCall("kairo_setup_plan", { action: "set_assignment", role: "Architect", candidateKey: "claude::claude-model" })).data;
  assert.equal(after.reasonCode, "strategy_not_draft");
  assert.equal(c.counts.strategyWrites, writes);
});

test("outputs carry no absolute paths or secrets", async () => {
  const c = await env({ claude: ENTITLEMENT.DENIED });
  const text = JSON.stringify((await c.mcpCall("kairo_setup")).data);
  assert.equal(text.includes(c.root), false);
  assert.equal(text.includes(c.home), false);
});
