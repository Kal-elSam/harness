import test from "node:test";
import assert from "node:assert/strict";
import { executeAuthorizedAptitudeRun, buildAptitudeAuthorizationRequest } from "../src/global/intelligence/role-aptitude-run.js";
import { asTestDoubleInvokeAdapter } from "../src/global/intelligence/role-aptitude-runner.js";
import { buildSingleCallAuthorization } from "../src/global/intelligence/role-aptitude-authorization.js";
import { createScriptedOperationalBridge, scriptedReceiptsForClaim } from "../src/global/intelligence/role-aptitude-bridge.js";
import { createRoleAptitudeEvidenceStore } from "../src/global/intelligence/role-aptitude-evidence.js";

const model = { adapterId: "codex", modelId: "offline" };
const plan = { roles: [{ role: "Explorer", probes: ["explorer.find-symbol-v1"], stage1: [model], stage2: [{ model, reason: "within-near-equivalence-band" }] }] };
function fixture({ cap = 1, stage = 1, execute } = {}) {
  let invokes = 0;
  const stageOneResults = [{ role: "Explorer", provider: "codex", modelId: "offline", probeId: "explorer.find-symbol-v1", verdict: "pass" }];
  const request = buildAptitudeAuthorizationRequest({ plan, stage, maxCalls: cap, stageOneResults });
  const grant = buildSingleCallAuthorization({ provider: "codex", modelId: "offline", accountKey: "test", roles: ["Explorer"], maxCalls: cap, absoluteTimeoutMs: 1000, maxOutputBytes: 1000 });
  const authorization = { ...request, grants: [grant] };
  const bridge = createScriptedOperationalBridge(scriptedReceiptsForClaim(grant));
  const evidenceStore = createRoleAptitudeEvidenceStore();
  const invokeAdapter = asTestDoubleInvokeAdapter(ctx => {
    invokes++;
    assert.equal(ctx.identity.modelId, "offline");
    assert.equal(ctx.expected, undefined);
    return execute ? execute(ctx) : { structured: { definitionPath: "src/compute-total.js", emptyArrayBehavior: "throws TypeError", citations: [{ path: "src/compute-total.js", line: 1 }] }, tokenUsage: { total: 17 } };
  });
  assert.equal(invokeAdapter.executionKind, "test-double", "no real bridge adapter may be constructed");
  return { args: { plan, stage, authorization, invokeAdapter, evidenceStore, bridge }, count: () => invokes, request };
}
test("bound calls run once, deterministic validators grade and evidence stores results", async () => {
  const f = fixture();
  const report = await executeAuthorizedAptitudeRun(f.args);
  assert.equal(f.count(), 1);
  assert.equal(report.calls, 1);
  assert.equal(report.results[0].verdict, "pass");
  assert.equal(report.results[0].tokens, 17);
  assert.ok(report.results[0].durationMs >= 0);
  assert.equal(report.results[0].errorKind, null);
  const stored = f.args.evidenceStore.getLastAttempt({ ...model, accountKey: "test", role: "Explorer", probeId: "explorer.find-symbol-v1", probeVersion: "1" });
  assert.equal(stored.verdict, "pass");
  assert.equal(stored.executionKind, "test-double");
});
for (const mutation of ["model", "role", "probe", "stage", "cap"]) {
  test(`changed ${mutation} binding refuses before invoke`, async () => {
    const f = fixture();
    const changed = structuredClone(plan);
    if (mutation === "model") changed.roles[0].stage1[0].modelId = "other";
    if (mutation === "role") changed.roles[0].role = "Builder";
    if (mutation === "probe") changed.roles[0].probes[0] = "builder.apply-fix-v1";
    f.args.plan = changed;
    if (mutation === "stage") f.args.stage = 2;
    if (mutation === "cap") f.args.maxCalls = 2;
    await assert.rejects(executeAuthorizedAptitudeRun(f.args), /binding|authorization|probe|role/i);
    assert.equal(f.count(), 0);
  });
}
test("all grants and receipts checked before any invocation", async () => {
  const f = fixture();
  f.args.authorization.grants[0].roles = ["Builder"];
  await assert.rejects(executeAuthorizedAptitudeRun(f.args), /authorization|binding/i);
  assert.equal(f.count(), 0);
});
test("missing bridge receipts fail closed", async () => {
  const f = fixture();
  delete f.args.bridge;
  await assert.rejects(executeAuthorizedAptitudeRun(f.args), /identity_unverifiable/);
  assert.equal(f.count(), 0);
});
test("cap survives invocation failures with no retries", async () => {
  const f = fixture({ execute: () => { throw new Error("offline failure"); } });
  f.args.plan = { roles: [...plan.roles, { role: "Architect", probes: ["architect.plan-fix-v1"], stage1: [model], stage2: [] }] };
  Object.assign(f.args.authorization, buildAptitudeAuthorizationRequest({ plan: f.args.plan, maxCalls: 1 }));
  f.args.authorization.grants[0].roles = ["Architect", "Explorer"];
  const report = await executeAuthorizedAptitudeRun(f.args);
  assert.equal(f.count(), 1);
  assert.equal(report.calls, 1);
  assert.equal(report.results.filter(row => row.errorKind === "call_cap").length, 1);
  assert.equal(report.results.filter(row => row.errorKind === "invoke_error").length, 1);
});
test("invalid answers fail deterministic grading and are stored", async () => {
  const f = fixture({ execute: () => ({ structured: { definitionPath: "wrong" } }) });
  const report = await executeAuthorizedAptitudeRun(f.args);
  assert.equal(report.results[0].verdict, "fail");
  assert.equal(report.results[0].errorKind, "validation");
  assert.equal(f.count(), 1);
});
test("failed validation reports and stores fixed rule names without model output", async () => {
  const leak = "MODEL-LEAK-VALUE";
  const f = fixture({ execute: () => ({ structured: { definitionPath: leak, emptyArrayBehavior: leak } }) });
  const report = await executeAuthorizedAptitudeRun(f.args);
  const expected = [
    "definitionPath want src/compute-total.js",
    "emptyArrayBehavior must describe the real thrown TypeError",
    "missing citation for definition path"
  ];
  assert.deepEqual(report.results[0].failedChecks, expected);
  const key = { adapterId: "codex", modelId: "offline", accountKey: "test", role: "Explorer", probeId: "explorer.find-symbol-v1", probeVersion: "1" };
  assert.deepEqual(f.args.evidenceStore.getLastAttempt(key).failedChecks, expected);
  assert.ok(!JSON.stringify(report).includes(leak));
});
test("stage two needs separately issued authorization after stage one results", async () => {
  const f = fixture({ stage: 2 });
  await assert.rejects(executeAuthorizedAptitudeRun(f.args), /stage.?1|stage.?one/i);
  assert.equal(f.count(), 0);
});
test("authorization request is canonical across ordering", () => {
  const request = buildAptitudeAuthorizationRequest({ plan });
  assert.match(request.planFingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(request.calls, [{ role: "Explorer", provider: "codex", modelId: "offline", probeId: "explorer.find-symbol-v1" }]);
  assert.equal(request.maxCalls, 1);
  assert.equal(request.stage, 1);
});

test("stage two executes only with new post-results binding", async () => {
  const first = fixture();
  first.args.now = () => new Date("2026-10-19T00:00:00Z");
  const stage1Report = await executeAuthorizedAptitudeRun(first.args);
  const second = fixture({ stage: 2 });
  second.args.authorization.stage1Report = stage1Report;
  second.args.authorization.issuedAt = "2026-10-19T00:00:01Z";
  const report = await executeAuthorizedAptitudeRun(second.args);
  assert.equal(second.count(), 1);
  assert.equal(report.stage, 2);
  assert.equal(report.results[0].verdict, "pass");
});

test("multiple bound calls execute exactly once and untrusted extra grants refuse", async () => {
  const f = fixture();
  f.args.plan = { roles: [...plan.roles, { role: "Architect", probes: ["architect.plan-fix-v1"], stage1: [model], stage2: [] }] };
  Object.assign(f.args.authorization, buildAptitudeAuthorizationRequest({ plan: f.args.plan }));
  Object.assign(f.args.authorization.grants[0], { maxCalls: 2, roles: ["Architect", "Explorer"] });
  const report = await executeAuthorizedAptitudeRun(f.args);
  assert.equal(f.count(), 2);
  assert.equal(report.results.length, 2);
  const denied = fixture();
  denied.args.authorization.grants.push({ ...denied.args.authorization.grants[0], modelId: "unbound" });
  await assert.rejects(executeAuthorizedAptitudeRun(denied.args), /outside binding/);
  assert.equal(denied.count(), 0);
});

test("a later model receipt failure prevents every model invocation", async () => {
  const f = fixture();
  const other = { adapterId: "claude", modelId: "offline-claude" };
  f.args.plan = { roles: [{ ...plan.roles[0], stage1: [model, other] }] };
  Object.assign(f.args.authorization, buildAptitudeAuthorizationRequest({ plan: f.args.plan }));
  f.args.authorization.grants[0].maxCalls = 2;
  f.args.authorization.grants.push(buildSingleCallAuthorization({
    provider: other.adapterId, modelId: other.modelId, accountKey: "test",
    roles: ["Explorer"], maxCalls: 2, absoluteTimeoutMs: 1000, maxOutputBytes: 1000
  }));
  await assert.rejects(executeAuthorizedAptitudeRun(f.args), /identity_mismatch/);
  assert.equal(f.count(), 0);
});

test("runtime bridge hands actual edits to deterministic validators and preserves run duration", async t => {
  const { createRunInvokeAdapter } = await import("../src/global/intelligence/role-aptitude-invoke.js");
  const { writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const childProcess = (await import("node:child_process")).default;
  const spawn = t.mock.method(childProcess, "spawn", () => assert.fail("no real agent CLI may spawn"));
  const f = fixture();
  f.args.plan = { roles: [{ role: "Builder", probes: ["builder.apply-fix-v1"], stage1: [model], stage2: [] }] };
  Object.assign(f.args.authorization, buildAptitudeAuthorizationRequest({ plan: f.args.plan }));
  f.args.authorization.grants[0].roles = ["Builder"];
  let calls = 0;
  f.args.invokeAdapter = createRunInvokeAdapter({ startRun: async args => {
    calls++;
    writeFileSync(join(args.cwd, "src/compute-total.js"), "export function computeTotal(items) { return items.reduce((sum, item) => sum + item.value, 0); }\n");
    return { runId: "offline", completion: Promise.resolve({ state: "completed", tokenUsage: { total: 41 }, startedAt: "2026-10-19T00:00:00Z", completedAt: "2026-10-19T00:00:04Z" }) };
  } });
  const report = await executeAuthorizedAptitudeRun(f.args);
  assert.equal(calls, 1);
  assert.equal(spawn.mock.callCount(), 0);
  assert.equal(report.results[0].verdict, "pass");
  assert.equal(report.results[0].tokens, 41);
  assert.equal(report.results[0].durationMs, 4000);
  const stored = f.args.evidenceStore.getLastAttempt({ ...model, accountKey: "test", role: "Builder", probeId: "builder.apply-fix-v1", probeVersion: "1" });
  assert.equal(stored.durationMs, 4000);
});

for (const neverTerminates of [false, true]) {
  test(`runner ${neverTerminates ? "retains workspace after cleanup grace" : "awaits cancellation before disposing workspace"} and counts timed-out call`, async t => {
    const { createRunInvokeAdapter } = await import("../src/global/intelligence/role-aptitude-invoke.js");
    const { existsSync, rmSync } = await import("node:fs");
    const f = fixture();
    f.args.authorization.grants[0].absoluteTimeoutMs = 20;
    let workspaceRoot;
    let finish;
    let releaseCancel;
    let cancellationFinished = false;
    const completion = new Promise(resolve => { finish = resolve; });
    const cancellation = new Promise(resolve => { releaseCancel = resolve; });
    t.after(() => { releaseCancel(); finish({ state: "cancelled" }); });
    f.args.invokeAdapter = createRunInvokeAdapter({
      startRun: async args => {
        workspaceRoot = args.cwd;
        return { runId: "runner-double", completion };
      },
      cancelRun: async () => {
        assert.equal(existsSync(workspaceRoot), true);
        if (neverTerminates) await cancellation;
        else await new Promise(resolve => setTimeout(resolve, 35));
        assert.equal(existsSync(workspaceRoot), true, "workspace must survive cancellation");
        cancellationFinished = true;
        if (!neverTerminates) finish({ state: "cancelled", tokenUsage: { total: 29 } });
      }
    });
    const report = await executeAuthorizedAptitudeRun(f.args);
    assert.equal(report.calls, 1);
    assert.equal(report.results[0].errorKind, "timeout");
    assert.equal(report.results[0].cleanupFailed, neverTerminates);
    assert.equal(existsSync(workspaceRoot), neverTerminates);
    assert.equal(cancellationFinished, !neverTerminates);
    if (neverTerminates) {
      assert.equal(report.results[0].workspaceRetained, true);
      assert.equal(report.results[0].workspaceRoot, workspaceRoot);
      releaseCancel();
      finish({ state: "cancelled" });
      // Allow the retained workspace's deferred cleanup to settle.
      for (let i = 0; i < 50 && existsSync(workspaceRoot); i++) await new Promise(resolve => setTimeout(resolve, 5));
      assert.equal(existsSync(workspaceRoot), false);
    } else assert.equal(report.results[0].tokens, 29);
    t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  });
}

test("runner reports uncancellable Claude preflight when cleanup grace expires", async t => {
  const { createRunInvokeAdapter } = await import("../src/global/intelligence/role-aptitude-invoke.js");
  const { existsSync, rmSync } = await import("node:fs");
  const f = fixture();
  const claudePlan = { roles: [{ ...plan.roles[0], stage1: [{ adapterId: "claude", modelId: "offline" }] }] };
  const grant = buildSingleCallAuthorization({ provider: "claude", modelId: "offline", accountKey: "test", roles: ["Explorer"], maxCalls: 1, absoluteTimeoutMs: 15, maxOutputBytes: 1000 });
  f.args.plan = claudePlan;
  f.args.authorization = { ...buildAptitudeAuthorizationRequest({ plan: claudePlan }), grants: [grant] };
  f.args.bridge = createScriptedOperationalBridge(scriptedReceiptsForClaim(grant));
  let release;
  let workspaceRoot;
  const runtimeAdapter = createRunInvokeAdapter({
    startRun: async args => {
      workspaceRoot = args.cwd;
      await new Promise(resolve => { release = resolve; });
      args.spawnImpl("offline-must-not-spawn", []);
      assert.fail("deadline must block task launch after preflight");
    },
    cancelRun: async () => assert.fail("initial preflight has no registered run")
  });
  f.args.invokeAdapter = async ctx => {
    const result = await runtimeAdapter(ctx);
    // Make the runner win the equal-grace race deterministically.
    await new Promise(resolve => setTimeout(resolve, 15));
    return result;
  };
  f.args.invokeAdapter.executionKind = runtimeAdapter.executionKind;
  t.after(() => { release(); rmSync(workspaceRoot, { recursive: true, force: true }); });
  const report = await executeAuthorizedAptitudeRun(f.args);
  assert.equal(report.calls, 1);
  assert.equal(report.results[0].errorKind, "timeout");
  assert.equal(report.results[0].cleanupFailed, true);
  assert.equal(report.results[0].workspaceRetained, true);
  assert.equal(existsSync(workspaceRoot), true);
  assert.match(report.results[0].preflightCancellationLimitation, /cannot cancel Claude auth preflight/);
  release();
  for (let i = 0; i < 50 && existsSync(workspaceRoot); i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(existsSync(workspaceRoot), false);
});

// --- Stage-2 resolution from stage-1 results (S49/S50, verifier blocker 3) ---
const near = { adapterId: "codex", modelId: "offline-near" };
const strong = { adapterId: "codex", modelId: "offline-strong" };
const mixedPlan = { roles: [{ role: "Explorer", probes: ["explorer.find-symbol-v1"], stage1: [model], stage2: [
  { model: near, reason: "within-near-equivalence-band" }, { model: strong, reason: "fallback-if-stage1-fails" }] }] };
const stageOneRow = verdict => ({ role: "Explorer", provider: "codex", modelId: "offline", probeId: "explorer.find-symbol-v1", verdict });
const stageOneReport = verdict => ({ completedAt: "2026-10-19T00:00:00Z", results: [stageOneRow(verdict)] });
function stageTwoFixture(verdict) {
  const stage1Report = stageOneReport(verdict);
  const request = buildAptitudeAuthorizationRequest({ plan: mixedPlan, stage: 2, stageOneResults: stage1Report.results });
  const models = [...new Set(request.calls.map(call => call.modelId))];
  const grants = models.map(modelId => buildSingleCallAuthorization({ provider: "codex", modelId, accountKey: "test", roles: ["Explorer"], maxCalls: request.maxCalls, absoluteTimeoutMs: 1000, maxOutputBytes: 1000 }));
  let invoked = [];
  const invokeAdapter = asTestDoubleInvokeAdapter(ctx => {
    invoked.push(ctx.identity.modelId);
    return { structured: { definitionPath: "src/compute-total.js", emptyArrayBehavior: "throws TypeError", citations: [{ path: "src/compute-total.js", line: 1 }] }, tokenUsage: { total: 1 } };
  });
  const bridges = new Map(grants.map(grant => [grant.modelId, createScriptedOperationalBridge(scriptedReceiptsForClaim(grant))]));
  const bridge = { verifyIdentity: claim => bridges.get(claim.modelId).verifyIdentity(claim), verifyBilling: claim => (bridges.get(claim.modelId) ?? [...bridges.values()][0]).verifyBilling(claim) };
  return { request, invoked: () => invoked, args: {
    plan: mixedPlan, stage: 2, invokeAdapter, evidenceStore: createRoleAptitudeEvidenceStore(), bridge,
    authorization: { ...request, grants, stage1Report, issuedAt: "2026-10-19T00:00:01Z" }
  } };
}
test("stage 2 keeps competitive and drops fallback when a stage-1 model passed", async () => {
  const f = stageTwoFixture("pass");
  assert.deepEqual(f.request.calls.map(call => call.modelId), ["offline-near"]);
  const report = await executeAuthorizedAptitudeRun(f.args);
  assert.deepEqual(f.invoked(), ["offline-near"]);
  assert.equal(report.results.length, 1);
});
test("stage 2 keeps the fallback for a role where every stage-1 model failed", async () => {
  const f = stageTwoFixture("fail");
  assert.deepEqual(f.request.calls.map(call => call.modelId), ["offline-near", "offline-strong"]);
  await executeAuthorizedAptitudeRun(f.args);
  assert.deepEqual(f.invoked().sort(), ["offline-near", "offline-strong"]);
});
test("stage 2 is not requestable without stage-1 results", () => {
  assert.throws(() => buildAptitudeAuthorizationRequest({ plan: mixedPlan, stage: 2 }), /no stage 1 results/i);
  assert.throws(() => buildAptitudeAuthorizationRequest({ plan: mixedPlan, stage: 2, stageOneResults: [] }), /no stage 1 results/i);
});
test("stage 2 authorization bound to the unresolved plan is refused", async () => {
  const f = stageTwoFixture("pass");
  Object.assign(f.args.authorization, buildAptitudeAuthorizationRequest({ plan: { roles: [{ ...mixedPlan.roles[0], stage2: [{ model: strong, reason: "fallback-if-stage1-fails" }] }] }, stage: 2, stageOneResults: stageOneReport("fail").results }));
  await assert.rejects(executeAuthorizedAptitudeRun(f.args), /binding/);
  assert.equal(f.invoked().length, 0);
});

test("persistent evidence is flushed before the run returns", async t => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createPersistentRoleAptitudeEvidenceStore } = await import("../src/global/intelligence/role-aptitude-evidence.js");
  const homeDir = await mkdtemp(join(tmpdir(), "aptitude-flush-"));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  const f = fixture();
  f.args.evidenceStore = await createPersistentRoleAptitudeEvidenceStore({ homeDir });
  const report = await executeAuthorizedAptitudeRun(f.args);
  assert.equal(report.evidencePersisted, true);
  const reopened = await createPersistentRoleAptitudeEvidenceStore({ homeDir });
  const stored = reopened.getLastAttempt({ ...model, accountKey: "test", role: "Explorer", probeId: "explorer.find-symbol-v1", probeVersion: "1" });
  assert.equal(stored.verdict, "pass");
});

test("flush is awaited after failures and cap exhaustion", async () => {
  const f = fixture({ execute: () => { throw new Error("offline failure"); } });
  f.args.plan = { roles: [...plan.roles, { role: "Architect", probes: ["architect.plan-fix-v1"], stage1: [model], stage2: [] }] };
  Object.assign(f.args.authorization, buildAptitudeAuthorizationRequest({ plan: f.args.plan, maxCalls: 1 }));
  f.args.authorization.grants[0].roles = ["Architect", "Explorer"];
  let flushed = false;
  f.args.evidenceStore = { ...f.args.evidenceStore, flush: async () => { await new Promise(resolve => setTimeout(resolve, 5)); flushed = true; } };
  const report = await executeAuthorizedAptitudeRun(f.args);
  assert.equal(flushed, true, "flush must be awaited before the report returns");
  assert.ok(report.results.some(row => row.errorKind === "call_cap"));
  assert.ok(report.results.some(row => row.errorKind === "invoke_error"));
});

test("a failing flush marks the report as not persisted", async () => {
  const f = fixture();
  f.args.evidenceStore = { ...f.args.evidenceStore, flush: async () => { throw new Error("disk full"); } };
  const report = await executeAuthorizedAptitudeRun(f.args);
  assert.equal(report.evidencePersisted, false);
  assert.match(report.evidenceError, /disk full/);
});

test("stores without flush keep working", async () => {
  const f = fixture();
  const report = await executeAuthorizedAptitudeRun(f.args);
  assert.equal(report.evidencePersisted, true);
});

test("report separates infrastructure errors from model fails, matching the store", async () => {
  const infra = fixture({ execute: () => ({ errorKind: "run_failed", error: "Process exited with code 1", tokenUsage: { input: 4, output: 1, total: 5 }, launchDiagnostic: { exitCode: 1, stderrFirstLine: "boom" } }) });
  const infraReport = await executeAuthorizedAptitudeRun(infra.args);
  const row = infraReport.results[0];
  assert.equal(row.verdict, "error");
  assert.equal(row.errorKind, "run_failed");
  assert.deepEqual(row.launchDiagnostic, { exitCode: 1, stderrFirstLine: "boom" });
  assert.deepEqual(row.tokenUsage, { input: 4, output: 1, total: 5 });
  const key = { ...model, accountKey: "test", role: "Explorer", probeId: "explorer.find-symbol-v1", probeVersion: "1" };
  assert.equal(infra.args.evidenceStore.getLastAttempt(key).verdict, "error");
  const modelFail = fixture({ execute: () => ({ structured: { definitionPath: "wrong" } }) });
  const failReport = await executeAuthorizedAptitudeRun(modelFail.args);
  assert.equal(failReport.results[0].verdict, "fail");
  assert.equal(modelFail.args.evidenceStore.getLastAttempt(key).verdict, "fail");
});
