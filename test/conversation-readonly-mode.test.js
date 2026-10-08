import test from "node:test";
import assert from "node:assert/strict";
import { createConversationService } from "../src/global/conversation/service.js";
import { createConversationOperations } from "../src/global/conversation/operations.js";
import { ADAPTER_PERMISSION_MODES } from "../src/global/runtime/run-permissions.js";

const MODEL = { candidateKey: "codex::gpt-6-astra", adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra", accessMode: "automatic" };
const STRATEGY = {
  schema: "kairo.project-strategy/v1", status: "active", profileFingerprint: "fp-1", activeRoles: ["Builder"],
  projectTeam: [{
    role: "Builder", model: MODEL, fallback: null, decisionEvidence: null, assignmentSource: "recommended",
    recommendedAssignment: { model: MODEL, fallback: null, decisionEvidence: null }, overrideEvidence: null
  }]
};
const RECORD = { status: {}, taskMarkdown: "text", planMarkdown: "# Approved plan" };
const STANDARD_TARGET = { role: "Builder", selection: "assigned", strategyFingerprint: "fp-1", candidateKey: MODEL.candidateKey };
const RO_TARGET = { ...STANDARD_TARGET, mode: "read-only" };

function harness({ authorize } = {}) {
  const calls = { launches: [], reserved: 0 };
  let link = null;
  const deps = {
    resolveRoot: async () => "/repo", homeDir: "/home/test",
    selectExecutionProvider: () => { throw new Error("legacy router must not be used"); },
    readPlan: async () => RECORD, verifyExecution: async () => RECORD,
    createRunId: () => "run_fixed",
    readExecution: async () => link,
    writeExecution: async (_r, _i, value) => { calls.reserved += 1; link = value; },
    updateExecution: async (_r, _i, value) => { link = value; },
    readProjectStrategy: async () => STRATEGY,
    startRun: async (input) => {
      calls.launches.push(input);
      return { metadata: { state: "starting", startedAt: "now", updatedAt: "now" } };
    },
    ...(authorize ? { authorizeRunPermissions: authorize } : {})
  };
  const service = createConversationService(deps);
  const realSnapshot = service.snapshot.bind(service);
  service.snapshot = async (args) => {
    const snap = await realSnapshot(args);
    return { ...snap, modelIntelligence: { ...snap.modelIntelligence, eligibility: { codex: { ok: true } } } };
  };
  return { service, calls, getLink: () => link };
}

const allowReadOnly = (input) => ({ permissions: input.permissions, permissionAuthority: {} });

test("default (no mode) launch args are unchanged: permissions [] and no read-only wording", async () => {
  const { service, calls } = harness();
  const preview = await service.planExecution({ cwd: "/repo", taskId: "t", role: "Builder" });
  assert.equal(preview.mode, "standard");
  assert.deepEqual(preview.confirmationTarget, STANDARD_TARGET, "standard target stays byte-for-byte (no mode key)");
  await service.executePlan({ cwd: "/repo", taskId: "t", confirmationTarget: STANDARD_TARGET });
  assert.equal(calls.launches.length, 1);
  assert.deepEqual(calls.launches[0].permissions, []);
  assert.equal(calls.launches[0].allowUnsafePermissions, false);
  assert.equal(calls.launches[0].task, [
    "Implement the explicitly approved architecture plan below.",
    "Follow repository AGENTS.md and Gentle governance. Do not treat plan approval as any additional governance receipt.",
    "Use safe, non-bypassed permissions for this session.",
    "",
    "# Approved plan"
  ].join("\n"));
});

test("read-only preview carries mode in preview and confirmationTarget and says read-only before confirming", async () => {
  const { service } = harness();
  const preview = await service.planExecution({ cwd: "/repo", taskId: "t", role: "Builder", mode: "read-only" });
  assert.equal(preview.mode, "read-only");
  assert.deepEqual(preview.confirmationTarget, RO_TARGET);
  assert.match(preview.why, /read-only/i);
});

test("planExecution rejects an unknown mode with a typed error", async () => {
  const { service } = harness();
  await assert.rejects(() => service.planExecution({ cwd: "/repo", taskId: "t", role: "Builder", mode: "yolo" }), { code: "invalid_execution_mode" });
});

test("read-only confirmation launches with permissions [read-only], a read-only prompt, and persists the mode", async () => {
  const { service, calls, getLink } = harness({ authorize: allowReadOnly });
  const result = await service.executePlan({ cwd: "/repo", taskId: "t", confirmationTarget: RO_TARGET, mode: "read-only" });
  assert.equal(calls.launches.length, 1);
  assert.deepEqual(calls.launches[0].permissions, ["read-only"]);
  assert.match(calls.launches[0].task, /READ-ONLY/);
  assert.match(calls.launches[0].task, /must not (modify|change)/i);
  assert.match(calls.launches[0].task, /# Approved plan/);
  assert.equal(getLink().mode, "read-only");
  assert.equal(result.execution.mode, "read-only");
});

test("a read-only confirmation can never launch a standard run, and standard can never launch read-only (zero launches)", async () => {
  const { service, calls } = harness({ authorize: allowReadOnly });
  await assert.rejects(
    () => service.executePlan({ cwd: "/repo", taskId: "t", confirmationTarget: RO_TARGET, mode: "standard" }),
    /state changed since this was confirmed/
  );
  await assert.rejects(
    () => service.executePlan({ cwd: "/repo", taskId: "t", confirmationTarget: STANDARD_TARGET, mode: "read-only" }),
    /state changed since this was confirmed/
  );
  await assert.rejects(
    () => service.executePlan({ cwd: "/repo", taskId: "t", confirmationTarget: { ...STANDARD_TARGET, mode: "bogus" } }),
    /state changed since this was confirmed/
  );
  assert.equal(calls.launches.length, 0);
  assert.equal(calls.reserved, 0);
});

test("a target without mode is standard and an explicit standard target also validates", async () => {
  const a = harness();
  await a.service.executePlan({ cwd: "/repo", taskId: "t", confirmationTarget: STANDARD_TARGET, mode: "standard" });
  assert.deepEqual(a.calls.launches[0].permissions, []);
  const b = harness();
  await b.service.executePlan({ cwd: "/repo", taskId: "t", confirmationTarget: { ...STANDARD_TARGET, mode: "standard" } });
  assert.deepEqual(b.calls.launches[0].permissions, []);
});

test("repeating a read-only confirmation does not relaunch; a standard confirmation never reuses a read-only run", async () => {
  const { service, calls } = harness({ authorize: allowReadOnly });
  const first = await service.executePlan({ cwd: "/repo", taskId: "t", confirmationTarget: RO_TARGET });
  const again = await service.executePlan({ cwd: "/repo", taskId: "t", confirmationTarget: RO_TARGET });
  assert.equal(first.reused, false);
  assert.equal(again.reused, true);
  assert.equal(again.execution.mode, "read-only");
  assert.equal(calls.launches.length, 1);
  await assert.rejects(
    () => service.executePlan({ cwd: "/repo", taskId: "t", confirmationTarget: STANDARD_TARGET }),
    /state changed since this was confirmed/
  );
  assert.equal(calls.launches.length, 1);
});

test("read-only on an adapter without containment support is refused before reserve or launch (typed, no link written)", async () => {
  assert.equal(ADAPTER_PERMISSION_MODES.codex.includes("read-only"), false, "R1 must not claim codex containment");
  assert.equal(ADAPTER_PERMISSION_MODES.claude.includes("read-only"), false, "R1 must not claim claude containment");
  const { service, calls, getLink } = harness(); // real authorizeRunPermissions
  await assert.rejects(
    () => service.executePlan({ cwd: "/repo", taskId: "t", confirmationTarget: RO_TARGET }),
    { code: "read_only_unsupported" }
  );
  assert.equal(calls.launches.length, 0);
  assert.equal(calls.reserved, 0);
  assert.equal(getLink(), null);
});

test("operations: plan forwards mode; absent mode stays standard; a read-only target is honored only as read-only", async () => {
  const { service, calls } = harness({ authorize: allowReadOnly });
  const ops = createConversationOperations({ cwd: "/repo", getService: () => service });
  const roPlan = await ops.plan({ taskId: "t", role: "Builder", mode: "read-only" });
  assert.equal(roPlan.mode, "read-only");
  assert.equal(roPlan.confirmationTarget.mode, "read-only");
  const stdPlan = await ops.plan({ taskId: "t", role: "Builder" });
  assert.equal(stdPlan.mode, "standard");
  assert.equal("mode" in stdPlan.confirmationTarget, false);
  const launched = await ops.execute({ taskId: "t", confirmationTarget: roPlan.confirmationTarget });
  assert.equal(launched.mode, "read-only");
  assert.deepEqual(calls.launches.map((l) => l.permissions), [["read-only"]]);
});

test("operations: a fresh preview whose mode differs from the confirmed target is refused as stale, both directions, zero launches", async () => {
  const { service, calls } = harness({ authorize: allowReadOnly });
  const realPlan = service.planExecution.bind(service);
  let forced = null;
  const drifting = { ...service, planExecution: async (args) => realPlan({ ...args, mode: forced ?? args.mode }), executePlan: (a) => service.executePlan(a) };
  const ops = createConversationOperations({ cwd: "/repo", getService: () => drifting });
  forced = "standard";
  await assert.rejects(() => ops.execute({ taskId: "t", confirmationTarget: RO_TARGET }), { code: "confirmation_stale" });
  forced = "read-only";
  await assert.rejects(() => ops.execute({ taskId: "t", confirmationTarget: STANDARD_TARGET }), { code: "confirmation_stale" });
  assert.equal(calls.launches.length, 0);
});

test("operations: read-only execute through a service reports read_only_unsupported", async () => {
  const { service, calls } = harness();
  const ops = createConversationOperations({ cwd: "/repo", getService: () => service });
  const plan = await ops.plan({ taskId: "t", role: "Builder", mode: "read-only" });
  await assert.rejects(() => ops.execute({ taskId: "t", confirmationTarget: plan.confirmationTarget }), { code: "read_only_unsupported" });
  assert.equal(calls.launches.length, 0);
});
