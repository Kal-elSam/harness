import { createHash } from "node:crypto";
import { assertOperationalAuthorization } from "./role-aptitude-authorization.js";
import { getRoleAptitudeProbe } from "./role-aptitude-probes.js";
import { runOperationalProbe, createOperationalCallLedger } from "./role-aptitude-runner.js";

const fail = reason => { throw new Error(`aptitude-run: authorization refused: ${reason}`); };
const key = call => JSON.stringify([call.role, call.provider, call.modelId, call.probeId]);

/** Separate hash binding: existing grants bind identity/roles, not stage/probes.
 * This fingerprint is not an identity or billing receipt and cannot replace one.
 */
export function buildAptitudeAuthorizationRequest({ plan, stage = 1, maxCalls } = {}) {
  if (stage !== 1 && stage !== 2) fail("stage binding must be 1 or 2");
  if (!Array.isArray(plan?.roles)) fail("plan binding requires roles");
  const calls = [];
  for (const entry of plan.roles) {
    const models = stage === 1 ? entry.stage1 : entry.stage2?.map(item => item.model);
    if (!Array.isArray(models) || !Array.isArray(entry.probes)) fail("invalid plan binding");
    for (const model of models) for (const probeId of entry.probes) {
      const probe = getRoleAptitudeProbe(probeId);
      if (!probe || probe.role !== entry.role) fail("probe role outside binding");
      if (!model?.adapterId || !model.modelId) fail("model binding missing identity");
      calls.push({ role: entry.role, provider: model.adapterId, modelId: model.modelId, probeId });
    }
  }
  calls.sort((a, b) => key(a).localeCompare(key(b)));
  if (new Set(calls.map(key)).size !== calls.length) fail("duplicate calls in plan binding");
  const cap = maxCalls ?? calls.length;
  if (!Number.isSafeInteger(cap) || cap < 1 || cap > calls.length) fail("invalid maximum call binding");
  const binding = { stage, calls, maxCalls: cap };
  return { ...binding, planFingerprint: createHash("sha256").update(JSON.stringify(binding)).digest("hex") };
}

export async function executeAuthorizedAptitudeRun({
  plan, stage = 1, authorization, invokeAdapter, evidenceStore, maxCalls,
  now = () => new Date(), bridge, providerPolicy, sessionInspectionPermission = false
}) {
  // Snapshot all untrusted inputs before any asynchronous verification.
  const auth = structuredClone(authorization);
  if (!auth) fail("explicit operational authorization is required");
  const request = buildAptitudeAuthorizationRequest({ plan, stage, maxCalls: maxCalls ?? auth.maxCalls });
  if (auth.stage !== stage || auth.maxCalls !== request.maxCalls
    || auth.planFingerprint !== request.planFingerprint || JSON.stringify(auth.calls) !== JSON.stringify(request.calls)) {
    fail("plan binding mismatch (stage, roles, models, probes or maximum calls)");
  }
  if (stage === 2) {
    const completed = Date.parse(auth.stage1Report?.completedAt);
    const issued = Date.parse(auth.issuedAt);
    if (!Number.isFinite(completed) || !Number.isFinite(issued) || issued <= completed
      || !Array.isArray(auth.stage1Report?.results) || !auth.stage1Report.results.length) {
      fail("stage 2 requires stage 1 results and a subsequently issued authorization");
    }
    for (const entry of plan.roles) {
      for (const model of entry.stage1) for (const probeId of entry.probes) {
        if (!auth.stage1Report.results.some(row => row.role === entry.role && row.provider === model.adapterId
          && row.modelId === model.modelId && row.probeId === probeId && ["pass", "fail"].includes(row.verdict))) {
          fail("stage 1 report does not cover the plan");
        }
      }
      const passed = auth.stage1Report.results.some(row => row.role === entry.role && row.verdict === "pass");
      if (passed && entry.stage2.some(item => item.reason === "fallback-if-stage1-fails")) {
        fail("stage 2 fallback outside authorized stage 1 failure condition");
      }
    }
  }
  if (typeof invokeAdapter !== "function" || !evidenceStore?.recordAttempt) fail("adapter and evidence store required");
  if (!Array.isArray(auth.grants)) fail("binding requires per-model authorization grants");
  const groups = new Map();
  for (const call of request.calls) {
    const id = JSON.stringify([call.provider, call.modelId]);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(call);
  }
  if (auth.grants.length !== groups.size) fail("grant models outside binding");
  const grants = new Map();
  for (const [id, calls] of groups) {
    const matching = auth.grants.filter(grant => JSON.stringify([grant.provider, grant.modelId]) === id);
    const grant = matching[0];
    if (matching.length !== 1 || !Number.isSafeInteger(grant.maxCalls) || grant.maxCalls > auth.maxCalls
      || grant.maxCalls < Math.min(calls.length, auth.maxCalls)
      || JSON.stringify([...(grant.roles ?? [])].sort()) !== JSON.stringify([...new Set(calls.map(call => call.role))].sort())) {
      fail("grant role/model/call binding mismatch");
    }
    const checked = await assertOperationalAuthorization(grant, { bridge, providerPolicy, sessionInspectionPermission });
    if (!checked.ok) fail(`${checked.code}: ${checked.reason}`);
    grants.set(id, { grant, ledger: createOperationalCallLedger(checked.grant) });
  }
  const results = [];
  let invoked = 0;
  for (const call of request.calls) {
    if (invoked >= auth.maxCalls) {
      results.push({ ...call, verdict: "fail", tokens: null, durationMs: 0, errorKind: "call_cap" });
      continue;
    }
    const { grant, ledger } = grants.get(JSON.stringify([call.provider, call.modelId]));
    let tokens = null;
    const guarded = async ctx => {
      if (invoked >= auth.maxCalls) throw new Error("authorized call cap exhausted");
      invoked++; // Failures spend a call too; never retry.
      const output = await invokeAdapter(ctx);
      tokens = output?.tokenUsage?.total ?? output?.tokens ?? null;
      return output;
    };
    guarded.executionKind = invokeAdapter.executionKind;
    const outcome = await runOperationalProbe({
      probeId: call.probeId, authorization: grant, store: evidenceStore,
      invokeAdapter: guarded, ledger, bridge, providerPolicy, sessionInspectionPermission
    });
    results.push({ ...call, verdict: outcome.verdict === "pass" ? "pass" : "fail",
      tokens, durationMs: outcome.attempt?.durationMs ?? 0,
      errorKind: outcome.blocked ? outcome.code : outcome.verdict === "error" ? "invoke_error"
        : outcome.verdict === "pass" ? null : "validation",
      error: outcome.error ?? outcome.attempt?.error ?? null });
  }
  return { stage, planFingerprint: request.planFingerprint, calls: invoked, results, completedAt: new Date(now()).toISOString() };
}
