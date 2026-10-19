import childProcess from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runPaths } from "../paths.js";
import { stopRun } from "../runtime/run-manager.js";
import { formatTranscriptEventText } from "../runtime/run-events.js";
import { asRealBridgeInvokeAdapter, parseOperationalAptitudeAnswer, waitForAptitudeCleanup, APTITUDE_CLEANUP_GRACE_MS, CLAUDE_PREFLIGHT_CANCELLATION_LIMITATION } from "./role-aptitude-runner.js";
import { materializeProbeWorkspace, listRelativeFiles } from "./role-aptitude-probes.js";

const OUTPUT_FIELDS = {
  Explorer: "definitionPath: string, emptyArrayBehavior: string, citations: [{path: string, line: number}]",
  Architect: "planFiles: string[], steps: string[], acceptance: string, rejectsApiBreak: boolean, keepsPublicApi: string",
  Debugger: "rootCausePath: string, rootCauseLine: number, rootCauseSummary: string, citations: [{path: string, line: number}]",
  Reviewer: "plantedDefectPath: string, plantedDefectLine: number, blocksOnNonIssue: boolean, decision: approve or request-changes, citations: [{path: string, line: number}]"
};
// Provider keys that would switch a subscription CLI to pay-per-use billing.
const BILLING_ENV_KEYS = new Set(["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY", "CODEX_API_KEY"]);
/** Copy of the child env with every billing key removed (case-insensitive). */
function scrubBillingEnv(env) {
  const clean = {};
  for (const [key, value] of Object.entries(env ?? process.env)) {
    if (!BILLING_ENV_KEYS.has(key.toUpperCase())) clean[key] = value;
  }
  return clean;
}
const needsStructured = role => !["Builder", "Tester"].includes(role);
const snapshot = root => new Map(listRelativeFiles(root).map(path => [path, readFileSync(join(root, path), "utf8")]));

function runMetrics(record) {
  const elapsed = Date.parse(record?.completedAt) - Date.parse(record?.startedAt);
  return {
    tokens: record?.tokenUsage?.total ?? null, tokenUsage: record?.tokenUsage ?? null,
    durationMs: Number.isFinite(elapsed) ? Math.max(0, elapsed) : null,
    cost: record?.cost ?? null
  };
}

function readAnswer(homeDir, runId, maxBytes) {
  const text = readFileSync(runPaths(homeDir, runId).transcriptPath, "utf8");
  // Bound the response admitted to validators; never accept a truncated JSON answer.
  if (Buffer.byteLength(text) > maxBytes) throw new Error("transcript exceeds authorized output limit");
  const events = text.split("\n").filter(line => line.trim()).map(line => JSON.parse(line));
  for (const event of events.reverse()) {
    if (event.type !== "run.transcript") continue;
    const parsed = parseOperationalAptitudeAnswer(formatTranscriptEventText(event.data));
    if (parsed.ok && parsed.structured && typeof parsed.structured === "object" && !Array.isArray(parsed.structured)) return parsed;
  }
  throw new Error("run has no parseable structured output");
}

/** No runtime API deletes run artifacts, so remove exactly this run's raw
 * transcript and events files. The state record stays for telemetry. Returns
 * true when raw content may still be on disk (never silent).
 */
function scrubRunArtifacts(homeDir, runId) {
  if (typeof runId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId)) return true;
  try {
    const { transcriptPath, eventsPath } = runPaths(homeDir, runId);
    rmSync(transcriptPath, { force: true });
    rmSync(eventsPath, { force: true });
    return false;
  } catch {
    return true;
  }
}

/** Production bridge over the existing runtime. Construction performs no IO.
 * The operational runner already materializes and disposes its workspace. Reuse
 * that workspace, rather than validating a different copy after the run.
 * Standalone callers own the returned dispose callback. On timeout, cleanup
 * gets a separate bounded grace period (limits.cleanupGraceMs, default 1s).
 * cleanupFailed reports unconfirmed cleanup; workspaceRetained means dispose
 * is deferred until cleanupCompletion settles, so live processes keep cwd.
 * cancelRun defaults to runtime stopRun; tests inject offline cancellation.
 */
export function createRunInvokeAdapter({ homeDir, startRun, cancelRun = stopRun, materializeWorkspace = materializeProbeWorkspace, now = Date.now }) {
  if (typeof startRun !== "function") throw new Error("aptitude invoke requires startRun");
  return asRealBridgeInvokeAdapter(async ctx => {
    const { probe, identity, limits } = ctx;
    if (!["claude", "codex"].includes(identity?.adapterId)) throw new Error("aptitude invoke provider is not allowed");
    if (!Number.isFinite(limits?.absoluteTimeoutMs) || limits.absoluteTimeoutMs <= 0) throw new Error("aptitude invoke requires an absolute timeout");
    const workspace = ctx.workspaceRoot ? { workspaceRoot: ctx.workspaceRoot, dispose() {} } : await materializeWorkspace(probe.probeId);
    const { workspaceRoot } = workspace;
    const before = snapshot(workspaceRoot);
    const captureTranscript = needsStructured(probe.role);
    let timer;
    let child;
    let timedOut = false;
    let record = null;
    let running;
    let runHandle;
    let cancellation;
    let cancellationError = null;
    let stopRequested = false;
    let rejectStopped;
    const stopped = new Promise((_, reject) => { rejectStopped = reject; });
    const cancel = () => {
      if (!runHandle || cancellation) return;
      cancellation = Promise.resolve().then(() => cancelRun(homeDir, runHandle.runId, { signal: "SIGKILL" }))
        .catch(error => { cancellationError = error.message; });
    };
    const requestStop = (error, isTimeout) => {
      if (stopRequested) return;
      stopRequested = true;
      timedOut = isTimeout;
      cancel();
      if (child) {
        // stopRun persists cancellation; the dedicated group also covers tools.
        try {
          if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch {
          try { child.kill("SIGKILL"); } catch { /* Reported through bounded cleanup below. */ }
        }
      }
      rejectStopped(error);
    };
    const onAbort = () => requestStop(ctx.signal.reason ?? new Error("cancelled"), /timeout|timed out/i.test(ctx.signal.reason?.message ?? ""));
    const deadline = Number(now()) + limits.absoluteTimeoutMs;
    try {
      timer = setTimeout(() => requestStop(new Error("authorized absolute timeout exceeded"), true), limits.absoluteTimeoutMs);
      ctx.signal?.addEventListener("abort", onAbort, { once: true });
      if (ctx.signal?.aborted) onAbort();
      running = (async () => {
        if (stopRequested) throw ctx.signal?.reason ?? new Error("cancelled");
        const run = await startRun({
          homeDir, agentId: identity.adapterId, model: identity.modelId,
          cwd: workspaceRoot, role: probe.role,
          task: captureTranscript
            ? `${probe.prompt}\nReturn a JSON object with a structured object containing these fields: ${OUTPUT_FIELDS[probe.role]}. Derive values from the workspace; no prose outside JSON.`
            : probe.prompt,
          permissions: probe.editablePaths.length ? [] : ["read-only"],
          // Normal write permissions are not proof of workspace containment.
          // Keep write probes fail-closed until the runtime verifies that floor.
          requireVerifiedWriteContainment: probe.editablePaths.length > 0,
          allowUnsafePermissions: false, permissionSource: "aptitude",
          captureTranscript, strategy: "direct", wait: true,
          timeoutMs: limits.absoluteTimeoutMs,
          spawnImpl: (...args) => {
            // startRun's timeout is idle-only. This outer deadline never resets.
            if (stopRequested || Number(now()) >= deadline) throw new Error("authorized absolute timeout exceeded");
            const [command, argv, options] = args;
            child = childProcess.spawn(command, argv, { ...options, env: scrubBillingEnv(options?.env), detached: process.platform !== "win32" });
            return child;
          }
        });
        runHandle = run;
        if (stopRequested) cancel();
        record = await run.completion;
        return run;
      })();
      const run = await Promise.race([running, stopped]);
      const metrics = runMetrics(record);
      const after = snapshot(workspaceRoot);
      const changed = [...new Set([...before.keys(), ...after.keys()])].filter(path => before.get(path) !== after.get(path)).sort();
      const result = { ...metrics, workspaceRoot, snapshotPaths: { changed }, dispose: workspace.dispose };
      if (record?.state !== "completed") return { ...result, transcriptRetained: scrubRunArtifacts(homeDir, run.runId), errorKind: /timed?\s*out|timeout/i.test(record?.error ?? "") ? "timeout" : "run_failed", error: record?.error ?? "run did not complete" };
      try {
        const parsed = captureTranscript ? readAnswer(homeDir, run.runId, limits.maxOutputBytes) : { structured: {}, fileWrites: [] };
        return { ...parsed, ...result, transcriptRetained: scrubRunArtifacts(homeDir, run.runId), errorKind: null };
      } catch (error) {
        return { ...result, transcriptRetained: scrubRunArtifacts(homeDir, run.runId), errorKind: "unparsable_output", error: error.message };
      }
    } catch (error) {
      let cleanupFailed = false;
      let cleanupCompletion;
      if (stopRequested && running) {
        // stopRun records cancellation, but only completion proves termination.
        cleanupCompletion = running.catch(() => {}).then(() => cancellation);
        cleanupFailed = !await waitForAptitudeCleanup(cleanupCompletion, limits.cleanupGraceMs ?? APTITUDE_CLEANUP_GRACE_MS);
      }
      const workspaceRetained = cleanupFailed;
      cleanupFailed ||= cancellationError !== null;
      const limitation = timedOut && identity.adapterId === "claude"
        ? CLAUDE_PREFLIGHT_CANCELLATION_LIMITATION
        : null;
      // A live run may still write; scrub only once its completion settled.
      const transcriptRetained = !runHandle ? false : cleanupFailed ? true : scrubRunArtifacts(homeDir, runHandle.runId);
      if (runHandle && cleanupFailed && cleanupCompletion) cleanupCompletion.then(() => scrubRunArtifacts(homeDir, runHandle.runId), () => {});
      return {
        workspaceRoot,
        transcriptRetained,
        dispose: workspaceRetained ? () => cleanupCompletion.then(() => workspace.dispose()) : workspace.dispose,
        ...runMetrics(record),
        errorKind: timedOut || /timed?\s*out|timeout/i.test(error.message) ? "timeout" : "run_failed",
        error: `${error.message}${cleanupFailed ? "; cleanup failed within grace period" : ""}${cancellationError ? `; cancellation failed: ${cancellationError}` : ""}`,
        cleanupFailed, workspaceRetained,
        ...(workspaceRetained ? { cleanupCompletion } : {}),
        ...(limitation ? { preflightCancellationLimitation: limitation } : {})
      };
    } finally {
      clearTimeout(timer);
      ctx.signal?.removeEventListener("abort", onAbort);
    }
  });
}
