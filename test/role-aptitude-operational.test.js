/**
 * E5/E6 — operational aptitude runner. Offline fakes only; no real provider calls.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  assertOperationalAuthorization,
  BILLING_NO_ADDITIONAL_CHARGE,
  buildSingleCallAuthorization
} from "../src/global/intelligence/role-aptitude-authorization.js";
import {
  createFailClosedOperationalBridge,
  createScriptedOperationalBridge,
  scriptedReceiptsForClaim
} from "../src/global/intelligence/role-aptitude-bridge.js";
import { createRoleAptitudeEvidenceStore } from "../src/global/intelligence/role-aptitude-evidence.js";
import {
  listOperationalProviderAdmission,
  OPERATIONAL_PROVIDER_POLICY
} from "../src/global/intelligence/role-aptitude-providers.js";
import {
  asRealBridgeInvokeAdapter,
  asTestDoubleInvokeAdapter,
  createOperationalCallLedger,
  EXECUTION_KIND,
  runOperationalProbe,
  runSyntheticProbe
} from "../src/global/intelligence/role-aptitude-runner.js";
import { buildAiTeam } from "../src/global/intelligence/model-intelligence.js";
import { createConversationService } from "../src/global/conversation/service.js";
import { currentProbeForRole } from "../src/global/intelligence/role-aptitude-selection.js";
import { ENTITLEMENT } from "../src/global/observability/claude-model-entitlement.js";

const FIXED_COMPUTE_TOTAL = `/**
 * Sum numeric item values. Public API: computeTotal(items) → number.
 */
export function computeTotal(items) {
  return items.map((item) => item.value).reduce((sum, value) => sum + value, 0);
}
`;

function grant(overrides = {}) {
  return buildSingleCallAuthorization({
    provider: "codex",
    modelId: "gpt-ops",
    accountKey: "acct-a",
    roles: ["Explorer", "Architect", "Builder", "Debugger", "Tester", "Reviewer"],
    absoluteTimeoutMs: 5_000,
    maxOutputBytes: 64_000,
    ...overrides
  });
}

function admittingBridge(auth = grant()) {
  return createScriptedOperationalBridge(scriptedReceiptsForClaim(auth));
}

function explorerPassAdapter() {
  return async () => ({
    structured: {
      definitionPath: "src/compute-total.js",
      emptyArrayBehavior: "throws TypeError (Reduce of empty array with no initial value)",
      citations: [{ path: "src/compute-total.js", line: 6 }]
    },
    artifactMarkdown: "# ops findings",
    cost: null
  });
}

async function runOps(args) {
  const authorization = args.authorization ?? grant();
  return runOperationalProbe({
    bridge: admittingBridge(authorization),
    ...args,
    authorization
  });
}

test("provider admission list records admitted and blocked with reasons", () => {
  const { admitted, blocked } = listOperationalProviderAdmission();
  assert.ok(admitted.some((row) => row.provider === "codex"));
  assert.ok(admitted.some((row) => row.provider === "claude"));
  assert.ok(admitted.some((row) => row.provider === "cursor"));
  assert.ok(blocked.some((row) => row.provider === "opencode-go"));
  assert.match(blocked.find((row) => row.provider === "opencode-go").reason, /containment/i);
  assert.equal(OPERATIONAL_PROVIDER_POLICY.codex.admitted, true);
});

test("authorization missing / billing uncertain / identity mismatch block before invoke", async () => {
  const store = createRoleAptitudeEvidenceStore();
  let invoked = 0;
  const invokeAdapter = asTestDoubleInvokeAdapter(async () => {
    invoked += 1;
    return explorerPassAdapter()();
  });

  const missing = await runOperationalProbe({
    probeId: "explorer.find-symbol-v1",
    authorization: null,
    store,
    bridge: admittingBridge(),
    invokeAdapter
  });
  assert.equal(missing.blocked, true);
  assert.equal(missing.code, "authorization_missing");
  assert.equal(invoked, 0);

  const billing = await runOps({
    probeId: "explorer.find-symbol-v1",
    authorization: { ...grant(), billingCertainty: "payg_unknown" },
    store,
    invokeAdapter
  });
  assert.equal(billing.blocked, true);
  assert.equal(billing.code, "billing_uncertain");
  assert.equal(invoked, 0);

  const mismatch = await runOps({
    probeId: "explorer.find-symbol-v1",
    authorization: {
      ...grant(),
      verifiedIdentity: { provider: "codex", modelId: "other-model", accountKey: "acct-a" }
    },
    store,
    invokeAdapter
  });
  assert.equal(mismatch.blocked, true);
  assert.equal(mismatch.code, "identity_mismatch");
  assert.equal(invoked, 0);

  const blockedProvider = await assertOperationalAuthorization(
    buildSingleCallAuthorization({
      provider: "opencode-go",
      modelId: "glm",
      accountKey: "acct-a",
      roles: ["Explorer"],
      absoluteTimeoutMs: 1000,
      maxOutputBytes: 1000
    }),
    { role: "Explorer", bridge: admittingBridge({ provider: "opencode-go", modelId: "glm", accountKey: "acct-a" }) }
  );
  assert.equal(blockedProvider.ok, false);
  assert.equal(blockedProvider.code, "provider_blocked");
});

test("self-declared identity/billing without bridge receipts never authorize invoke", async () => {
  const store = createRoleAptitudeEvidenceStore();
  let invoked = 0;
  const invokeAdapter = asTestDoubleInvokeAdapter(async () => {
    invoked += 1;
    return explorerPassAdapter()();
  });

  const noBridge = await runOperationalProbe({
    probeId: "explorer.find-symbol-v1",
    authorization: grant(),
    store,
    bridge: createFailClosedOperationalBridge(),
    invokeAdapter
  });
  assert.equal(noBridge.blocked, true);
  assert.equal(noBridge.code, "identity_unverifiable");
  assert.equal(invoked, 0);

  const spoofBridge = createScriptedOperationalBridge({
    identity: {
      ok: true,
      verifiedIdentity: { provider: "codex", modelId: "different-model", accountKey: "acct-a" },
      receiptId: "spoof"
    },
    billing: scriptedReceiptsForClaim(grant()).billing
  });
  const spoof = await runOperationalProbe({
    probeId: "explorer.find-symbol-v1",
    authorization: grant(),
    store,
    bridge: spoofBridge,
    invokeAdapter
  });
  assert.equal(spoof.blocked, true);
  assert.equal(spoof.code, "identity_mismatch");
  assert.equal(invoked, 0);

  const billingOnlyClaim = createScriptedOperationalBridge({
    identity: scriptedReceiptsForClaim(grant()).identity,
    billing: { ok: false, code: "billing_unverifiable", reason: "cannot confirm subscription path" }
  });
  const unverifiableBilling = await runOperationalProbe({
    probeId: "explorer.find-symbol-v1",
    authorization: grant(),
    store,
    bridge: billingOnlyClaim,
    invokeAdapter
  });
  assert.equal(unverifiableBilling.blocked, true);
  assert.equal(unverifiableBilling.code, "billing_unverifiable");
  assert.equal(invoked, 0);

  const sessionDenied = await assertOperationalAuthorization(grant({ sessionInspection: true }), {
    role: "Explorer",
    bridge: admittingBridge(),
    sessionInspectionPermission: false
  });
  assert.equal(sessionDenied.ok, false);
  assert.equal(sessionDenied.code, "session_inspection_denied");
  assert.equal(BILLING_NO_ADDITIONAL_CHARGE, "no_additional_charge");
});

test("limits incomplete (timeout / maxOutput / maxCalls) block before invoke", async () => {
  const store = createRoleAptitudeEvidenceStore();
  let invoked = 0;
  const invokeAdapter = asTestDoubleInvokeAdapter(async () => {
    invoked += 1;
    return {};
  });
  for (const bad of [
    { absoluteTimeoutMs: undefined },
    { maxOutputBytes: 0 },
    { maxCalls: 0 }
  ]) {
    const auth = { ...grant(), ...bad };
    if (bad.absoluteTimeoutMs === undefined) delete auth.absoluteTimeoutMs;
    const result = await runOps({
      probeId: "explorer.find-symbol-v1",
      authorization: auth,
      store,
      invokeAdapter
    });
    assert.equal(result.blocked, true);
    assert.equal(result.code, "limits_incomplete");
  }
  assert.equal(invoked, 0);
});

test("absolute timeout and cancel before/during invoke; maxCalls has no automatic retry", async () => {
  const store = createRoleAptitudeEvidenceStore();
  const slow = await runOps({
    probeId: "explorer.find-symbol-v1",
    authorization: grant({ absoluteTimeoutMs: 30 }),
    store,
    invokeAdapter: asTestDoubleInvokeAdapter(() => new Promise(() => {}))
  });
  assert.equal(slow.verdict, "error");
  assert.match(slow.error, /timed out/i);
  assert.equal(slow.attempt?.origin, "operational");
  assert.equal(slow.attempt?.executionKind, EXECUTION_KIND.TEST_DOUBLE);

  const ac = new AbortController();
  ac.abort();
  const cancelled = await runOps({
    probeId: "explorer.find-symbol-v1",
    authorization: grant(),
    store,
    signal: ac.signal,
    invokeAdapter: asTestDoubleInvokeAdapter(explorerPassAdapter())
  });
  assert.equal(cancelled.blocked, true);
  assert.equal(cancelled.code, "cancelled_before_invoke");

  const ledger = createOperationalCallLedger(grant({ maxCalls: 1 }));
  const first = await runOps({
    probeId: "explorer.find-symbol-v1",
    authorization: grant(),
    store,
    ledger,
    invokeAdapter: asTestDoubleInvokeAdapter(explorerPassAdapter())
  });
  assert.equal(first.verdict, "pass");
  const second = await runOps({
    probeId: "explorer.find-symbol-v1",
    authorization: grant(),
    store,
    ledger,
    invokeAdapter: asTestDoubleInvokeAdapter(explorerPassAdapter())
  });
  assert.equal(second.blocked, true);
  assert.equal(second.code, "max_calls_exhausted");
});

test("operational pass/fail, forbidden edit, never leaks expected to adapter", async () => {
  const store = createRoleAptitudeEvidenceStore();
  let seenKeys = null;
  const pass = await runOps({
    probeId: "explorer.find-symbol-v1",
    authorization: grant(),
    store,
    invokeAdapter: asTestDoubleInvokeAdapter(async (ctx) => {
      seenKeys = Object.keys(ctx).sort();
      assert.equal("expected" in ctx, false);
      assert.ok(ctx.limits.absoluteTimeoutMs > 0);
      assert.ok(ctx.limits.maxOutputBytes > 0);
      return explorerPassAdapter()();
    })
  });
  assert.equal(pass.verdict, "pass");
  assert.equal(pass.attempt.origin, "operational");
  assert.equal(pass.attempt.executionKind, EXECUTION_KIND.TEST_DOUBLE);
  assert.equal(pass.attempt.cost, null);
  assert.deepEqual(seenKeys, ["identity", "limits", "probe", "prompt", "signal", "workspaceRoot"]);

  const fail = await runOps({
    probeId: "explorer.find-symbol-v1",
    authorization: grant(),
    store,
    invokeAdapter: asTestDoubleInvokeAdapter(async () => ({
      structured: {
        definitionPath: "src/compute-total.js",
        emptyArrayBehavior: "returns 0",
        citations: [{ path: "src/compute-total.js", line: 1 }]
      }
    }))
  });
  assert.equal(fail.verdict, "fail");

  const forbidden = await runOps({
    probeId: "explorer.find-symbol-v1",
    authorization: grant(),
    store,
    invokeAdapter: asTestDoubleInvokeAdapter(async () => ({
      structured: {
        definitionPath: "src/compute-total.js",
        emptyArrayBehavior: "throws TypeError (Reduce of empty array with no initial value)",
        citations: [{ path: "src/compute-total.js", line: 6 }]
      },
      fileWrites: [{ path: "src/compute-total.js", contents: FIXED_COMPUTE_TOTAL }]
    }))
  });
  assert.equal(forbidden.verdict, "fail");
  assert.ok(forbidden.validation.reasons.some((r) => /forbidden edit/i.test(r)));
});

test("fake/test-double callback never enables competition; real-bridge pass does", async () => {
  const store = createRoleAptitudeEvidenceStore();
  const probe = currentProbeForRole("Explorer");
  const key = {
    adapterId: "codex",
    modelId: "gpt-ops",
    accountKey: "acct-a",
    role: "Explorer",
    probeId: probe.probeId,
    probeVersion: probe.probeVersion
  };

  await runOps({
    probeId: "explorer.find-symbol-v1",
    authorization: grant(),
    store,
    invokeAdapter: asTestDoubleInvokeAdapter(explorerPassAdapter())
  });
  assert.equal(store.getValidatedVerdict(key)?.verdict, "pass");
  assert.equal(store.getValidatedVerdict(key)?.origin, "operational");
  assert.equal(store.getProductionEnablingPass(key), null, "operational label alone must not enable");

  await runOps({
    probeId: "explorer.find-symbol-v1",
    authorization: grant(),
    store,
    invokeAdapter: asRealBridgeInvokeAdapter(explorerPassAdapter())
  });
  assert.equal(store.getProductionEnablingPass(key)?.executionKind, EXECUTION_KIND.REAL_BRIDGE);
  assert.equal(store.getProductionEnablingPass(key)?.origin, "operational");
});

test("error after real-bridge pass does not clear validatedVerdict; synthetic never enables", async () => {
  const store = createRoleAptitudeEvidenceStore();
  await runOps({
    probeId: "explorer.find-symbol-v1",
    authorization: grant(),
    store,
    invokeAdapter: asRealBridgeInvokeAdapter(explorerPassAdapter())
  });
  const probe = currentProbeForRole("Explorer");
  const key = {
    adapterId: "codex",
    modelId: "gpt-ops",
    accountKey: "acct-a",
    role: "Explorer",
    probeId: probe.probeId,
    probeVersion: probe.probeVersion
  };
  assert.equal(store.getValidatedVerdict(key)?.verdict, "pass");
  assert.equal(store.getProductionEnablingPass(key)?.origin, "operational");

  await runOps({
    probeId: "explorer.find-symbol-v1",
    authorization: grant({ absoluteTimeoutMs: 20 }),
    store,
    invokeAdapter: asRealBridgeInvokeAdapter(() => new Promise(() => {}))
  });
  assert.equal(store.getValidatedVerdict(key)?.verdict, "pass");
  assert.equal(store.getLastAttempt(key)?.verdict, "error");
  assert.equal(store.getProductionEnablingPass(key)?.verdict, "pass");

  await runSyntheticProbe({
    probeId: "explorer.find-symbol-v1",
    identity: { adapterId: "synthetic", modelId: "fixture-agent", accountKey: "acct-a" },
    store,
    execute: async () => explorerPassAdapter()()
  });
  assert.equal(
    store.getProductionEnablingPass({
      adapterId: "synthetic",
      modelId: "fixture-agent",
      accountKey: "acct-a",
      role: "Explorer",
      probeId: probe.probeId,
      probeVersion: probe.probeVersion
    }),
    null
  );
});

test("service injects one store per instance; real-bridge pass updates selection; account scoped", async () => {
  const storeA = createRoleAptitudeEvidenceStore();
  const serviceA = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/test",
    ownedEvidenceStore: storeA,
    ownedEvidenceAccountKey: "acct-a"
  });
  const serviceB = createConversationService({
    resolveRoot: async () => "/repo",
    homeDir: "/home/test",
    ownedEvidenceAccountKey: "acct-b"
  });
  assert.equal(serviceA.getOwnedEvidenceStore(), storeA);
  assert.notEqual(serviceA.getOwnedEvidenceStore(), serviceB.getOwnedEvidenceStore());
  assert.equal(serviceA.getOwnedEvidenceAccountKey(), "acct-a");

  await runOps({
    probeId: "explorer.find-symbol-v1",
    authorization: grant({ accountKey: "acct-a" }),
    store: storeA,
    invokeAdapter: asRealBridgeInvokeAdapter(explorerPassAdapter())
  });

  const models = [
    {
      adapterId: "codex",
      modelId: "gpt-ops",
      displayName: "Ops",
      intelligenceIndex: null,
      codingIndex: null,
      evidenceStatus: "unscored",
      entitlement: ENTITLEMENT.NOT_APPLICABLE,
      accessMode: "automatic"
    },
    {
      adapterId: "codex",
      modelId: "gpt-scored",
      displayName: "Scored",
      intelligenceIndex: 90,
      codingIndex: 90,
      entitlement: ENTITLEMENT.NOT_APPLICABLE,
      accessMode: "automatic"
    }
  ];
  const eligibility = { codex: { ok: true } };
  const teamA = buildAiTeam(models, eligibility, null, undefined, {
    ownedEvidenceStore: storeA,
    accountKey: "acct-a"
  });
  const explorerA = teamA.find((entry) => entry.role === "Explorer");
  assert.ok(explorerA);
  assert.equal(explorerA.primary.modelId, "gpt-ops");

  const teamWrongAccount = buildAiTeam(models, eligibility, null, undefined, {
    ownedEvidenceStore: storeA,
    accountKey: "acct-b"
  });
  const explorerWrong = teamWrongAccount.find((entry) => entry.role === "Explorer");
  assert.notEqual(explorerWrong?.primary?.modelId, "gpt-ops");
});
