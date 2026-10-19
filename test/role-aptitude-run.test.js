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
  const request = buildAptitudeAuthorizationRequest({ plan, stage, maxCalls: cap });
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
