import { createHash } from "node:crypto";
import { assertOperationalAuthorization } from "./role-aptitude-authorization.js";
import { failedCheckName } from "./role-aptitude-evidence.js";
import { getRoleAptitudeProbe } from "./role-aptitude-probes.js";
import { runOperationalProbe, createOperationalCallLedger } from "./role-aptitude-runner.js";

const fail = reason => { throw new Error(`aptitude-run: authorization refused: ${reason}`); };
const key = call => JSON.stringify([call.role, call.provider, call.modelId, call.probeId]);

/** Stage 2 is resolved from stage-1 results before authorization: competitive
 * candidates always stay; a fallback stays only for roles where no stage-1 model
 * passed. Authorization binds exactly the resolved list.
 */
export function resolveStageTwo(plan, stageOneResults) {
  if (!Array.isArray(plan?.roles)) fail("plan binding requires roles");
  if (!Array.isArray(stageOneResults)) fail("stage 2 is not requestable: no stage 1 results");
  return {
    ...plan,
    roles: plan.roles.map(entry => {
      const rows = stageOneResults.filter(row => row.role === entry.role);
      const stage2 = Array.isArray(entry.stage2) ? entry.stage2 : [];
      if (stage2.length && !rows.length) fail(`stage 2 is not requestable: no stage 1 results for role ${entry.role}`);
      const passed = rows.some(row => row.verdict === "pass");
      return { ...entry, stage2: stage2.filter(item => item.reason !== "fallback-if-stage1-fails" || !passed) };
    })
  };
}

/** Separate hash binding: existing grants bind identity/roles, not stage/probes.
 * This fingerprint is not an identity or billing receipt and cannot replace one.
 */
export function buildAptitudeAuthorizationRequest({ plan: rawPlan, stage = 1, maxCalls, stageOneResults } = {}) {
  if (stage !== 1 && stage !== 2) fail("stage binding must be 1 or 2");
  const plan = stage === 2 ? resolveStageTwo(rawPlan, stageOneResults) : rawPlan;
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
  plan, stage = 1, authorization, invokeAdapter, createInvokeAdapter, evidenceStore, maxCalls,
  now = () => new Date(), bridge, providerPolicy, sessionInspectionPermission = false
}) {
  // Snapshot all untrusted inputs before any asynchronous verification.
  const auth = structuredClone(authorization);
  if (!auth) fail("explicit operational authorization is required");
  if (stage === 2) {
    const completed = Date.parse(auth.stage1Report?.completedAt);
    const issued = Date.parse(auth.issuedAt);
    if (!Number.isFinite(completed) || !Number.isFinite(issued) || issued <= completed
      || !Array.isArray(auth.stage1Report?.results) || !auth.stage1Report.results.length) {
      fail("stage 2 requires stage 1 results and a subsequently issued authorization");
    }
  }
  const request = buildAptitudeAuthorizationRequest({ plan, stage, maxCalls: maxCalls ?? auth.maxCalls, stageOneResults: auth.stage1Report?.results });
  if (auth.stage !== stage || auth.maxCalls !== request.maxCalls
    || auth.planFingerprint !== request.planFingerprint || JSON.stringify(auth.calls) !== JSON.stringify(request.calls)) {
    fail("plan binding mismatch (stage, roles, models, probes or maximum calls)");
  }
  if (stage === 2) {
    for (const entry of plan.roles) {
      for (const model of entry.stage1) for (const probeId of entry.probes) {
        if (!auth.stage1Report.results.some(row => row.role === entry.role && row.provider === model.adapterId
          && row.modelId === model.modelId && row.probeId === probeId && ["pass", "fail"].includes(row.verdict))) {
          fail("stage 1 report does not cover the plan");
        }
      }
    }
  }
  if ((typeof invokeAdapter !== "function" && typeof createInvokeAdapter !== "function") || !evidenceStore?.recordAttempt) fail("adapter and evidence store required");
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
  const activeAdapter = invokeAdapter ?? createInvokeAdapter();
  const results = [];
  let invoked = 0;
  let evidenceError = null;
  try {
    for (const call of request.calls) {
      if (invoked >= auth.maxCalls) {
        results.push({ ...call, verdict: "error", tokens: null, durationMs: 0, errorKind: "call_cap" });
        continue;
      }
      const { grant, ledger } = grants.get(JSON.stringify([call.provider, call.modelId]));
      let tokens = null;
      let durationMs = null;
      let errorKind = null;
      let tokenUsage = null;
      let launchDiagnostic = null;
      const guarded = async ctx => {
        if (invoked >= auth.maxCalls) throw new Error("authorized call cap exhausted");
        invoked++; // Failures spend a call too; never retry.
        const output = await activeAdapter(ctx);
        tokens = output?.tokenUsage?.total ?? output?.tokens ?? null;
        tokenUsage = output?.tokenUsage ?? null;
        launchDiagnostic = output?.launchDiagnostic ?? null;
        durationMs = output?.durationMs ?? null;
        errorKind = output?.errorKind ?? null;
        return output;
      };
      guarded.executionKind = activeAdapter.executionKind;
      const outcome = await runOperationalProbe({
        probeId: call.probeId, authorization: grant, store: { ...evidenceStore, recordAttempt: fields => evidenceStore.recordAttempt({ ...fields, ...(durationMs === null ? {} : { durationMs }) }) },
        invokeAdapter: guarded, ledger, bridge, providerPolicy, sessionInspectionPermission
      });
      const errorCode = diagnosticCode(outcome.errorKind ?? errorKind ?? (outcome.blocked ? outcome.code : outcome.verdict === "error" ? "invoke_error"
        : outcome.verdict === "pass" ? null : "validation"));
      results.push({ ...call, // error = infrastructure (no model verdict); fail = model output failed validation.
        verdict: outcome.verdict === "pass" ? "pass" : outcome.verdict === "error" || outcome.blocked ? "error" : "fail",
        tokens, ...(tokenUsage ? { tokenUsage } : {}), ...(launchDiagnostic ? { launchDiagnostic } : {}), durationMs: durationMs ?? outcome.attempt?.durationMs ?? 0,
        cleanupFailed: outcome.cleanupFailed ?? false,
        workspaceRetained: outcome.workspaceRetained ?? false,
        transcriptRetained: outcome.transcriptRetained === true,
        ...(outcome.workspaceRoot ? { workspaceRoot: outcome.workspaceRoot } : {}),
        ...(outcome.preflightCancellationLimitation ? { preflightCancellationLimitation: outcome.preflightCancellationLimitation } : {}),
        errorKind: errorCode, errorCode,
        // Rule names only; failedCheckName strips interpolated model values.
        ...(outcome.verdict === "fail" ? { failedChecks: (outcome.validation?.reasons ?? []).map(failedCheckName).filter(Boolean) } : {}),
        // Fixed text only: provider and model output never reaches reports.
        error: errorCode ? (DIAGNOSTIC_MESSAGES[errorCode] ?? DIAGNOSTIC_MESSAGES.unclassified) : null });
    }
  } finally {
    // Persistent stores buffer writes; settle them on success and failure paths alike.
    try { await evidenceStore.flush?.(); } catch (error) { evidenceError = error; }
  }
  return { stage, planFingerprint: request.planFingerprint, calls: invoked, results, completedAt: new Date(now()).toISOString(),
    evidencePersisted: !evidenceError, ...(evidenceError ? { evidenceError: evidenceError.message } : {}) };
}

const DIAGNOSTIC_MESSAGES = {
  timeout: "call exceeded the authorized timeout",
  run_failed: "provider run did not complete",
  unparsable_output: "provider output could not be parsed",
  invoke_error: "call failed before producing a result",
  validation: "output failed deterministic validation",
  call_cap: "authorized call cap reached; call skipped",
  unclassified: "call failed; see the evidence store for details"
};
/** Stable lowercase diagnostic code, or "unclassified" for anything else. */
function diagnosticCode(value) {
  if (value === null || value === undefined) return null;
  return typeof value === "string" && /^[a-z][a-z_]{0,40}$/.test(value) ? value : "unclassified";
}

/** Stage-1 result rows for a plan, read from the aptitude evidence store. */
export function stageOneResultsFromEvidence(plan, evidenceStore, { accountKey } = {}) {
  const results = [];
  for (const entry of plan?.roles ?? []) for (const model of entry.stage1 ?? []) for (const probeId of entry.probes ?? []) {
    const probe = getRoleAptitudeProbe(probeId);
    const stored = probe && evidenceStore?.getValidatedVerdict({
      adapterId: model.adapterId, modelId: model.modelId, accountKey, role: entry.role, probeId, probeVersion: probe.probeVersion
    });
    if (stored && ["pass", "fail"].includes(stored.verdict)) {
      results.push({ role: entry.role, provider: model.adapterId, modelId: model.modelId, probeId, verdict: stored.verdict });
    }
  }
  return results;
}
