import childProcess from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runPaths } from "../paths.js";
import { formatTranscriptEventText } from "../runtime/run-events.js";
import { asRealBridgeInvokeAdapter, parseOperationalAptitudeAnswer } from "./role-aptitude-runner.js";
import { materializeProbeWorkspace, listRelativeFiles } from "./role-aptitude-probes.js";

const OUTPUT_FIELDS = {
  Explorer: "definitionPath: string, emptyArrayBehavior: string, citations: [{path: string, line: number}]",
  Architect: "planFiles: string[], steps: string[], acceptance: string, rejectsApiBreak: boolean, keepsPublicApi: string",
  Debugger: "rootCausePath: string, rootCauseLine: number, rootCauseSummary: string, citations: [{path: string, line: number}]",
  Reviewer: "plantedDefectPath: string, plantedDefectLine: number, blocksOnNonIssue: boolean, decision: approve or request-changes, citations: [{path: string, line: number}]"
};
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

/** Production bridge over the existing runtime. Construction performs no IO.
 * The operational runner already materializes and disposes its workspace. Reuse
 * that workspace, rather than validating a different copy after the run.
 * Standalone callers own the returned dispose callback.
 */
export function createRunInvokeAdapter({ homeDir, startRun, materializeWorkspace = materializeProbeWorkspace, now = Date.now }) {
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
    const deadline = Number(now()) + limits.absoluteTimeoutMs;
    try {
      const expired = new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          if (child) {
            // POSIX children inherit this dedicated process group. Kill the
            // entire group, not just the CLI while its tools keep running.
            if (process.platform !== "win32" && child.pid) {
              try { process.kill(-child.pid, "SIGKILL"); }
              catch { child.kill("SIGKILL"); }
            } else child.kill("SIGKILL");
          }
          reject(new Error("authorized absolute timeout exceeded"));
        }, limits.absoluteTimeoutMs);
      });
      running = (async () => {
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
            if (timedOut || Number(now()) >= deadline) throw new Error("authorized absolute timeout exceeded");
            const [command, argv, options] = args;
            child = childProcess.spawn(command, argv, { ...options, detached: process.platform !== "win32" });
            return child;
          }
        });
        record = await run.completion;
        return run;
      })();
      const run = await Promise.race([running, expired]);
      const metrics = runMetrics(record);
      const after = snapshot(workspaceRoot);
      const changed = [...new Set([...before.keys(), ...after.keys()])].filter(path => before.get(path) !== after.get(path)).sort();
      const result = { ...metrics, workspaceRoot, snapshotPaths: { changed }, dispose: workspace.dispose };
      if (record?.state !== "completed") return { ...result, errorKind: /timed?\s*out|timeout/i.test(record?.error ?? "") ? "timeout" : "run_failed", error: record?.error ?? "run did not complete" };
      try {
        const parsed = captureTranscript ? readAnswer(homeDir, run.runId, limits.maxOutputBytes) : { structured: {}, fileWrites: [] };
        return { ...parsed, ...result, errorKind: null };
      } catch (error) {
        return { ...result, errorKind: "unparsable_output", error: error.message };
      }
    } catch (error) {
      // Do not hand the workspace back while runtime persistence/cleanup is
      // still in flight. The terminal record owns even failed-run telemetry.
      if (timedOut && running) await running.catch(() => {});
      return { workspaceRoot, dispose: workspace.dispose, ...runMetrics(record), errorKind: timedOut || /timed?\s*out|timeout/i.test(error.message) ? "timeout" : "run_failed", error: error.message };
    } finally {
      clearTimeout(timer);
    }
  });
}
