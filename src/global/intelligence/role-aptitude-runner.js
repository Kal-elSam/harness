// Synthetic role-aptitude runner (E3). Materializes a disposable workspace,
// invokes a callback without expected answers, validates, and records into
// an E1 evidence store. No real adapters or paid calls.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertOperationalAuthorization } from "./role-aptitude-authorization.js";
import { createFailClosedOperationalBridge } from "./role-aptitude-bridge.js";
import {
  getRoleAptitudeProbe,
  listRelativeFiles,
  materializeProbeWorkspace,
  resolveWorkspacePath,
  writeWorkspaceFile
} from "./role-aptitude-probes.js";
import { validateProbeAttempt } from "./role-aptitude-validators.js";

const DEFAULT_TIMEOUT_MS = 8_000;

/** Execution provenance — origin=operational alone never proves a real model. */
export const EXECUTION_KIND = Object.freeze({
  TEST_DOUBLE: "test-double",
  REAL_BRIDGE: "real-bridge",
  SYNTHETIC: "synthetic-runner"
});

/**
 * Tag a callback as an offline test double. Passes may be recorded as
 * operational for harnesses, but never enable production competition.
 * @param {(ctx: object) => Promise<object>|object} fn
 */
export function asTestDoubleInvokeAdapter(fn) {
  if (typeof fn !== "function") throw new Error("role-aptitude-runner: test-double adapter must be a function");
  const wrapped = function testDoubleInvokeAdapter(...args) {
    return fn(...args);
  };
  wrapped.executionKind = EXECUTION_KIND.TEST_DOUBLE;
  return wrapped;
}

/**
 * Tag a callback as the real provider bridge path. Only this kind may
 * produce production-enabling operational evidence when the run passes.
 * @param {(ctx: object) => Promise<object>|object} fn
 */
export function asRealBridgeInvokeAdapter(fn) {
  if (typeof fn !== "function") throw new Error("role-aptitude-runner: real-bridge adapter must be a function");
  const wrapped = function realBridgeInvokeAdapter(...args) {
    return fn(...args);
  };
  wrapped.executionKind = EXECUTION_KIND.REAL_BRIDGE;
  return wrapped;
}

function resolveExecutionKind(invokeAdapter) {
  const kind = invokeAdapter?.executionKind;
  if (kind === EXECUTION_KIND.REAL_BRIDGE) return EXECUTION_KIND.REAL_BRIDGE;
  if (kind === EXECUTION_KIND.TEST_DOUBLE) return EXECUTION_KIND.TEST_DOUBLE;
  // Unmarked callbacks are treated as test doubles — never production-enabling.
  return EXECUTION_KIND.TEST_DOUBLE;
}

function snapshotWorkspace(workspaceRoot) {
  /** @type {Map<string, string>} */
  const files = new Map();
  for (const rel of listRelativeFiles(workspaceRoot)) {
    files.set(rel, readFileSync(join(workspaceRoot, rel), "utf8"));
  }
  return files;
}

function diffSnapshots(before, after) {
  const changed = [];
  for (const [rel, content] of after) {
    if (before.get(rel) !== content) changed.push(rel);
  }
  for (const rel of before.keys()) {
    if (!after.has(rel)) changed.push(rel);
  }
  return [...new Set(changed)].sort();
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Cleanup is bounded separately from the authorized execution deadline.
export const APTITUDE_CLEANUP_GRACE_MS = 1_000;
export const CLAUDE_PREFLIGHT_CANCELLATION_LIMITATION = "Existing runtime APIs cannot cancel Claude auth preflight; late task spawn is blocked and unresolved cleanup retains the workspace.";

export async function waitForAptitudeCleanup(promise, graceMs) {
  let timer;
  try {
    return await Promise.race([
      promise.then(() => true, () => true),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), graceMs); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @typedef {{
 *   exitCode?: number,
 *   artifactMarkdown?: string,
 *   structured?: object|null,
 *   fileWrites?: Array<{ path: string, contents: string }>,
 *   cost?: number|null
 * }} SyntheticExecutionResult
 */

/**
 * @param {{
 *   probeId: string,
 *   identity: { adapterId: string, modelId: string },
 *   store: ReturnType<import("./role-aptitude-evidence.js").createRoleAptitudeEvidenceStore>,
 *   execute: (ctx: { probe: object, workspaceRoot: string, prompt: string, identity: object }) => Promise<SyntheticExecutionResult>|SyntheticExecutionResult,
 *   timeoutMs?: number,
 *   artifactDir?: string
 * }} args
 */
export async function runSyntheticProbe(args) {
  const {
    probeId,
    identity,
    store,
    execute,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    artifactDir = null
  } = args;

  const probe = getRoleAptitudeProbe(probeId);
  if (!probe) throw new Error(`role-aptitude-runner: unknown probeId "${probeId}"`);
  if (typeof execute !== "function") throw new Error("role-aptitude-runner: execute callback required");
  if (!store?.recordAttempt) throw new Error("role-aptitude-runner: evidence store required");

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const materialized = materializeProbeWorkspace(probeId);
  const { workspaceRoot, expected, probe: liveProbe, dispose } = materialized;

  const productionSnapshotPath = liveProbe.role === "Debugger"
    ? "src/index-of.js"
    : liveProbe.role === "Builder"
      ? "src/compute-total.js"
      : null;
  const originalProduction = productionSnapshotPath
    ? readFileSync(join(workspaceRoot, productionSnapshotPath), "utf8")
    : null;

  const before = snapshotWorkspace(workspaceRoot);
  /** @type {string|null} */
  let artifactPath = null;
  /** @type {string[]} */
  const artifactRefs = [];

  try {
    let execution;
    try {
      execution = await withTimeout(
        Promise.resolve(execute({
          probe: {
            role: liveProbe.role,
            probeId: liveProbe.probeId,
            probeVersion: liveProbe.probeVersion,
            prompt: liveProbe.prompt,
            editablePaths: [...liveProbe.editablePaths],
            expectedArtifact: liveProbe.expectedArtifact
          },
          workspaceRoot,
          prompt: liveProbe.prompt,
          identity: { ...identity }
          // intentionally omit expected / expectedSourcePath
        })),
        timeoutMs,
        liveProbe.probeId
      );
    } catch (err) {
      const finishedAt = new Date().toISOString();
      const attempt = store.recordAttempt({
        adapterId: identity.adapterId,
        modelId: identity.modelId,
        accountKey: identity.accountKey ?? "default",
        role: liveProbe.role,
        probeId: liveProbe.probeId,
        probeVersion: liveProbe.probeVersion,
        verdict: "error",
        origin: "synthetic",
        executionKind: EXECUTION_KIND.SYNTHETIC,
        modelContext: identity.modelContext ?? null,
        startedAt,
        finishedAt,
        durationMs: Date.now() - startedMs,
        cost: null,
        error: err.message,
        artifactRefs: [],
        validatorId: liveProbe.validatorId,
        validatorVersion: liveProbe.validatorVersion
      });
      return { verdict: "error", validation: null, attempt, workspaceRoot, error: err.message };
    }

    if (!execution || typeof execution !== "object") {
      const finishedAt = new Date().toISOString();
      const attempt = store.recordAttempt({
        adapterId: identity.adapterId,
        modelId: identity.modelId,
        accountKey: identity.accountKey ?? "default",
        role: liveProbe.role,
        probeId: liveProbe.probeId,
        probeVersion: liveProbe.probeVersion,
        verdict: "fail",
        origin: "synthetic",
        executionKind: EXECUTION_KIND.SYNTHETIC,
        modelContext: identity.modelContext ?? null,
        startedAt,
        finishedAt,
        durationMs: Date.now() - startedMs,
        cost: null,
        error: "malformed execution result",
        artifactRefs: [],
        validatorId: liveProbe.validatorId,
        validatorVersion: liveProbe.validatorVersion
      });
      return {
        verdict: "fail",
        validation: { ok: false, verdict: "fail", reasons: ["malformed execution result"] },
        attempt,
        workspaceRoot
      };
    }

    for (const write of execution.fileWrites ?? []) {
      writeWorkspaceFile(workspaceRoot, write.path, write.contents);
    }

    if (typeof execution.artifactMarkdown === "string" && artifactDir) {
      mkdirSync(artifactDir, { recursive: true });
      artifactPath = join(
        artifactDir,
        `${identity.adapterId}__${identity.modelId}__${liveProbe.probeId}.md`
      );
      writeFileSync(artifactPath, execution.artifactMarkdown, "utf8");
      artifactRefs.push(artifactPath);
    } else if (typeof execution.artifactMarkdown === "string") {
      artifactRefs.push(`inline:${liveProbe.expectedArtifact}`);
    }

    const after = snapshotWorkspace(workspaceRoot);
    const changed = diffSnapshots(before, after);
    const forbidden = changed.filter((path) => !liveProbe.editablePaths.includes(path));

    let validation;
    if (forbidden.length) {
      validation = {
        ok: false,
        verdict: "fail",
        reasons: [`forbidden edits outside editablePaths: ${forbidden.join(", ")}`]
      };
    } else {
      validation = await validateProbeAttempt({
        probe: liveProbe,
        expected,
        workspaceRoot,
        structured: execution.structured ?? null,
        snapshotPaths: { changed },
        originalProduction
      });
    }

    const finishedAt = new Date().toISOString();
    const attempt = store.recordAttempt({
      adapterId: identity.adapterId,
      modelId: identity.modelId,
      accountKey: identity.accountKey ?? "default",
      role: liveProbe.role,
      probeId: liveProbe.probeId,
      probeVersion: liveProbe.probeVersion,
      verdict: validation.verdict,
      origin: "synthetic",
      executionKind: EXECUTION_KIND.SYNTHETIC,
      modelContext: identity.modelContext ?? null,
      startedAt,
      finishedAt,
      durationMs: Date.now() - startedMs,
      cost: execution.cost ?? null,
      error: validation.ok ? null : validation.reasons.join("; "),
      artifactRefs,
      validatorId: liveProbe.validatorId,
      validatorVersion: liveProbe.validatorVersion
    });

    return {
      verdict: validation.verdict,
      validation,
      attempt,
      workspaceRoot,
      artifactPath,
      changed,
      // for tests: prove expected was not handed to execute
      expectedKeysPresentInExecute: false
    };
  } finally {
    dispose();
  }
}

/**
 * Tracks remaining calls for one authorization grant. Sequential only —
 * no automatic retries. Unknown cost stays null at the attempt layer.
 */
export function createOperationalCallLedger(grant) {
  let remaining = grant.maxCalls;
  return {
    remaining() {
      return remaining;
    },
    consume() {
      if (remaining < 1) {
        return { ok: false, reason: "maxCalls exhausted for this authorization (no automatic retries)" };
      }
      remaining -= 1;
      return { ok: true, remaining };
    }
  };
}

/**
 * Parse a provider answer into structured aptitude fields. Prefers a fenced
 * JSON block; never invents facts from keywords alone.
 * @param {string|null|undefined} answer
 */
export function parseOperationalAptitudeAnswer(answer) {
  if (typeof answer !== "string" || !answer.trim()) {
    return { ok: false, reason: "empty answer", structured: null, artifactMarkdown: null, fileWrites: [] };
  }
  const fenced = answer.match(/```json\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : answer.trim();
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { ok: false, reason: "answer JSON is not an object", structured: null, artifactMarkdown: null, fileWrites: [] };
    }
    return {
      ok: true,
      structured: parsed.structured ?? parsed,
      artifactMarkdown: typeof parsed.artifactMarkdown === "string" ? parsed.artifactMarkdown : null,
      fileWrites: Array.isArray(parsed.fileWrites) ? parsed.fileWrites : [],
      cost: parsed.cost ?? null
    };
  } catch {
    return { ok: false, reason: "answer is not parseable JSON", structured: null, artifactMarkdown: null, fileWrites: [] };
  }
}

/**
 * Operational aptitude run (E5/E6). Requires authorization claims plus bridge
 * receipts. Records `origin: "operational"` but only `executionKind: real-bridge`
 * enables production competition. Unmarked/fake callbacks are test-doubles.
 * Choosing E5/E6 scope never authorizes real calls by itself.
 *
 * @param {{
 *   probeId: string,
 *   authorization: object,
 *   store: object,
 *   invokeAdapter: (ctx: object) => Promise<object>|object,
 *   bridge?: object|null,
 *   ledger?: ReturnType<typeof createOperationalCallLedger>,
 *   providerPolicy?: object,
 *   artifactDir?: string|null,
 *   signal?: AbortSignal,
 *   sessionInspectionPermission?: boolean
 * }} args
 */
export async function runOperationalProbe(args) {
  const {
    probeId,
    authorization,
    store,
    invokeAdapter,
    bridge = null,
    ledger = null,
    providerPolicy = undefined,
    artifactDir = null,
    signal = undefined,
    sessionInspectionPermission = false
  } = args;

  const probe = getRoleAptitudeProbe(probeId);
  if (!probe) throw new Error(`role-aptitude-runner: unknown probeId "${probeId}"`);
  if (!store?.recordAttempt) throw new Error("role-aptitude-runner: evidence store required");
  if (typeof invokeAdapter !== "function") {
    throw new Error("role-aptitude-runner: invokeAdapter required (no implicit real provider call)");
  }

  const executionKind = resolveExecutionKind(invokeAdapter);
  const auth = await assertOperationalAuthorization(authorization, {
    role: probe.role,
    providerPolicy,
    bridge: bridge ?? createFailClosedOperationalBridge(),
    sessionInspectionPermission
  });
  if (!auth.ok) {
    return {
      verdict: "error",
      blocked: true,
      code: auth.code,
      error: auth.reason,
      validation: null,
      attempt: null,
      executionKind
    };
  }
  const grant = auth.grant;
  const callLedger = ledger ?? createOperationalCallLedger(grant);
  const consumed = callLedger.consume();
  if (!consumed.ok) {
    return {
      verdict: "error",
      blocked: true,
      code: "max_calls_exhausted",
      error: consumed.reason,
      validation: null,
      attempt: null
    };
  }

  if (signal?.aborted) {
    return {
      verdict: "error",
      blocked: true,
      code: "cancelled_before_invoke",
      error: "signal already aborted before invoke",
      validation: null,
      attempt: null
    };
  }

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const materialized = materializeProbeWorkspace(probeId);
  const { workspaceRoot, expected, probe: liveProbe, dispose } = materialized;
  const productionSnapshotPath = liveProbe.role === "Debugger"
    ? "src/index-of.js"
    : liveProbe.role === "Builder"
      ? "src/compute-total.js"
      : null;
  const originalProduction = productionSnapshotPath
    ? readFileSync(join(workspaceRoot, productionSnapshotPath), "utf8")
    : null;
  const before = snapshotWorkspace(workspaceRoot);
  const identity = {
    adapterId: grant.provider,
    modelId: grant.modelId,
    accountKey: grant.accountKey
  };
  /** @type {string[]} */
  const artifactRefs = [];
  /** @type {string|null} */
  let artifactPath = null;

  const recordOperational = (fields) => store.recordAttempt({
    adapterId: identity.adapterId,
    modelId: identity.modelId,
    accountKey: identity.accountKey,
    role: liveProbe.role,
    probeId: liveProbe.probeId,
    probeVersion: liveProbe.probeVersion,
    origin: "operational",
    executionKind,
    modelContext: grant.authorizationId,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    cost: null,
    validatorId: liveProbe.validatorId,
    validatorVersion: liveProbe.validatorVersion,
    ...fields
  });

  let retainedCleanup = null;
  let workspaceRetained = false;
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  const cleanupGraceMs = APTITUDE_CLEANUP_GRACE_MS;
  try {
    let adapterResult;
    let invocation;
    let timer;
    let expired = false;
    try {
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          const error = new Error(`${liveProbe.probeId}: timed out after ${grant.absoluteTimeoutMs}ms`);
          error.errorKind = "timeout";
          controller.abort(error);
          reject(error);
        }, grant.absoluteTimeoutMs);
      });
      invocation = Promise.resolve().then(() => invokeAdapter({
        probe: {
          role: liveProbe.role,
          probeId: liveProbe.probeId,
          probeVersion: liveProbe.probeVersion,
          prompt: liveProbe.prompt,
          editablePaths: [...liveProbe.editablePaths],
          expectedArtifact: liveProbe.expectedArtifact
        },
        workspaceRoot,
        prompt: liveProbe.prompt,
        identity: { ...identity },
        limits: {
          absoluteTimeoutMs: grant.absoluteTimeoutMs,
          maxOutputBytes: grant.maxOutputBytes,
          maxCalls: grant.maxCalls,
          idleTimeoutMs: Math.min(grant.absoluteTimeoutMs, DEFAULT_TIMEOUT_MS),
          cleanupGraceMs
        },
        signal: controller.signal
        // never pass expected
      }));
      adapterResult = await Promise.race([invocation, deadline]);
      if (adapterResult?.errorKind) throw Object.assign(new Error(adapterResult.error ?? adapterResult.errorKind), adapterResult);
    } catch (err) {
      // Expiry requests cancellation first, then gives the adapter time to settle.
      if (expired && invocation) {
        const settled = await waitForAptitudeCleanup(invocation, cleanupGraceMs);
        if (settled) {
          adapterResult = await invocation.catch(() => null);
        } else {
          workspaceRetained = true;
          retainedCleanup = invocation.then(result => result?.cleanupCompletion);
        }
      }
      if (adapterResult?.workspaceRetained || err.workspaceRetained) {
        workspaceRetained = true;
        retainedCleanup = adapterResult?.cleanupCompletion ?? err.cleanupCompletion;
      }
      const cleanupFailed = workspaceRetained || adapterResult?.cleanupFailed === true || err.cleanupFailed === true;
      const errorKind = expired ? "timeout" : adapterResult?.errorKind ?? err.errorKind ?? "invoke_error";
      const error = `${err.message}${cleanupFailed && !/cleanup failed/.test(err.message) ? "; cleanup failed within grace period; workspace retained" : ""}`;
      const attempt = recordOperational({
        verdict: "error",
        error,
        artifactRefs: []
      });
      return { verdict: "error", blocked: false, validation: null, attempt, error,
        errorKind, cleanupFailed, workspaceRetained,
        transcriptRetained: (adapterResult?.transcriptRetained ?? err.transcriptRetained) === true,
        ...(workspaceRetained ? { workspaceRoot } : {}),
        ...((adapterResult?.preflightCancellationLimitation || (errorKind === "timeout" && grant.provider === "claude"))
          ? { preflightCancellationLimitation: adapterResult?.preflightCancellationLimitation ?? CLAUDE_PREFLIGHT_CANCELLATION_LIMITATION } : {})
      };
    } finally {
      clearTimeout(timer);
    }

    if (signal?.aborted) {
      const attempt = recordOperational({
        verdict: "error",
        error: "cancelled",
        artifactRefs: []
      });
      return { verdict: "error", blocked: false, validation: null, attempt, error: "cancelled", transcriptRetained: adapterResult?.transcriptRetained === true };
    }

    let execution;
    if (adapterResult && typeof adapterResult === "object" && (adapterResult.structured || adapterResult.fileWrites)) {
      execution = {
        structured: adapterResult.structured ?? null,
        artifactMarkdown: adapterResult.artifactMarkdown ?? null,
        fileWrites: adapterResult.fileWrites ?? [],
        cost: adapterResult.cost ?? null
      };
    } else if (adapterResult && typeof adapterResult === "object" && typeof adapterResult.answer === "string") {
      const parsed = parseOperationalAptitudeAnswer(adapterResult.answer);
      if (!parsed.ok) {
        const attempt = recordOperational({
          verdict: "fail",
          error: parsed.reason,
          artifactRefs: [],
          cost: adapterResult.cost ?? null
        });
        return {
          verdict: "fail",
          blocked: false,
          validation: { ok: false, verdict: "fail", reasons: [parsed.reason] },
          attempt,
          transcriptRetained: adapterResult?.transcriptRetained === true
        };
      }
      execution = parsed;
      execution.cost = adapterResult.cost ?? parsed.cost ?? null;
    } else {
      const attempt = recordOperational({
        verdict: "fail",
        error: "malformed operational adapter result",
        artifactRefs: []
      });
      return {
        verdict: "fail",
        blocked: false,
        validation: { ok: false, verdict: "fail", reasons: ["malformed operational adapter result"] },
        attempt,
        transcriptRetained: adapterResult?.transcriptRetained === true
      };
    }

    for (const write of execution.fileWrites ?? []) {
      if (!liveProbe.editablePaths.includes(write.path)) {
        const attempt = recordOperational({
          verdict: "fail",
          error: `forbidden edit outside editablePaths: ${write.path}`,
          artifactRefs: [],
          cost: execution.cost ?? null
        });
        return {
          verdict: "fail",
          blocked: false,
          validation: {
            ok: false,
            verdict: "fail",
            reasons: [`forbidden edit outside editablePaths: ${write.path}`]
          },
          attempt,
          transcriptRetained: adapterResult?.transcriptRetained === true
        };
      }
      writeWorkspaceFile(workspaceRoot, write.path, write.contents);
    }

    if (typeof execution.artifactMarkdown === "string" && artifactDir) {
      mkdirSync(artifactDir, { recursive: true });
      artifactPath = join(
        artifactDir,
        `ops__${identity.adapterId}__${identity.modelId}__${liveProbe.probeId}.md`
      );
      writeFileSync(artifactPath, execution.artifactMarkdown, "utf8");
      artifactRefs.push(artifactPath);
    }

    const after = snapshotWorkspace(workspaceRoot);
    const changed = diffSnapshots(before, after);
    const forbidden = changed.filter((path) => !liveProbe.editablePaths.includes(path));
    let validation;
    if (forbidden.length) {
      validation = {
        ok: false,
        verdict: "fail",
        reasons: [`forbidden edits outside editablePaths: ${forbidden.join(", ")}`]
      };
    } else {
      validation = await validateProbeAttempt({
        probe: liveProbe,
        expected,
        workspaceRoot,
        structured: execution.structured ?? null,
        snapshotPaths: { changed },
        originalProduction
      });
    }

    const attempt = recordOperational({
      verdict: validation.verdict,
      error: validation.ok ? null : validation.reasons.join("; "),
      artifactRefs,
      cost: execution.cost ?? null,
      durationMs: Date.now() - startedMs
    });

    return {
      verdict: validation.verdict,
      blocked: false,
      validation,
      attempt,
      transcriptRetained: adapterResult?.transcriptRetained === true,
      artifactPath,
      changed,
      grant,
      expectedKeysPresentInExecute: false
    };
  } finally {
    signal?.removeEventListener("abort", onAbort);
    // A live or unconfirmed process must never lose its workspace. Deferred
    // disposal runs only once the adapter confirms all cleanup has settled.
    if (workspaceRetained) retainedCleanup?.then(dispose, () => {});
    else dispose();
  }
}

export { snapshotWorkspace, diffSnapshots, resolveWorkspacePath };
