import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runPaths } from "../src/global/paths.js";
import { listRoleAptitudeProbes, materializeProbeWorkspace } from "../src/global/intelligence/role-aptitude-probes.js";
import { createRunInvokeAdapter } from "../src/global/intelligence/role-aptitude-invoke.js";

const structured = { definitionPath: "src/compute-total.js", emptyArrayBehavior: "throws TypeError", citations: [{ path: "src/compute-total.js", line: 1 }] };
for (const probe of listRoleAptitudeProbes()) {
  for (const provider of ["claude", "codex"]) test(`${provider} ${probe.role}: bounded runtime arguments and final metrics`, async t => {
    const homeDir = mkdtempSync(join(tmpdir(), "invoke-test-"));
    t.after(() => rmSync(homeDir, { recursive: true, force: true }));
    const spawn = t.mock.method(childProcess, "spawn", () => assert.fail("no real CLI may spawn"));
    let calls = 0;
    let workspace;
    const adapter = createRunInvokeAdapter({ homeDir, materializeWorkspace: id => {
      workspace = materializeProbeWorkspace(id);
      t.after(workspace.dispose);
      return workspace;
    }, startRun: async args => {
      calls++;
      assert.equal(args.agentId, provider);
      assert.equal(args.model, "offline");
      assert.equal(args.cwd, workspace.workspaceRoot);
      assert.equal(args.role, probe.role);
      assert.deepEqual(args.permissions, probe.editablePaths.length ? [] : ["read-only"]);
      assert.equal(args.requireVerifiedWriteContainment, probe.editablePaths.length > 0);
      assert.equal(args.allowUnsafePermissions, false);
      assert.equal(args.permissionSource, "aptitude");
      assert.equal(args.timeoutMs, 1000);
      assert.equal(args.wait, true);
      assert.equal(args.captureTranscript, !["Builder", "Tester"].includes(probe.role));
      assert.ok(args.task.includes(probe.prompt));
      const { transcriptPath } = runPaths(homeDir, "offline-run");
      mkdirSync(dirname(transcriptPath), { recursive: true });
      writeFileSync(transcriptPath, JSON.stringify({ type: "run.transcript", data: { result: '```json\n' + JSON.stringify({ structured }) + '\n```' } }) + '\n');
      return { runId: "offline-run", completion: Promise.resolve({ state: "completed", tokenUsage: { total: 23 }, cost: 0.01, startedAt: "2026-10-19T00:00:00Z", completedAt: "2026-10-19T00:00:02Z" }) };
    } });
    const result = await adapter({ probe, identity: { adapterId: provider, modelId: "offline" }, limits: { absoluteTimeoutMs: 1000, maxOutputBytes: 2000 } });
    assert.equal(calls, 1);
    assert.equal(spawn.mock.callCount(), 0);
    assert.equal(result.tokens, 23);
    assert.equal(result.durationMs, 2000);
    assert.equal(result.workspaceRoot, workspace.workspaceRoot);
    assert.deepEqual(result.snapshotPaths, { changed: [] });
    assert.deepEqual(result.structured, ["Builder", "Tester"].includes(probe.role) ? {} : structured);
  });
}
for (const [state, error, kind] of [["failed", "idle timeout", "timeout"], ["failed", "exit 1", "run_failed"], ["completed", null, "unparsable_output"]]) {
  test(`maps ${kind} without retry or spawn`, async t => {
    const workspace = materializeProbeWorkspace("explorer.find-symbol-v1");
    t.after(workspace.dispose);
    const spawn = t.mock.method(childProcess, "spawn", () => assert.fail("no real CLI"));
    let calls = 0;
    const adapter = createRunInvokeAdapter({ homeDir: workspace.workspaceRoot, startRun: async () => {
      calls++;
      return { runId: "absent", completion: Promise.resolve({ state, error, tokenUsage: { total: 7 }, startedAt: "2026-10-19T00:00:00Z", completedAt: "2026-10-19T00:00:01Z" }) };
    } });
    const result = await adapter({ probe: workspace.probe, workspaceRoot: workspace.workspaceRoot, identity: { adapterId: "codex", modelId: "offline" }, limits: { absoluteTimeoutMs: 1000, maxOutputBytes: 2000 } });
    assert.equal(result.errorKind, kind);
    assert.equal(result.tokens, 7);
    assert.equal(result.durationMs, 1000);
    assert.equal(calls, 1);
    assert.equal(spawn.mock.callCount(), 0);
  });
}

test("absolute deadline kills the runtime child without launching any real CLI", async t => {
  const workspace = materializeProbeWorkspace("explorer.find-symbol-v1");
  t.after(workspace.dispose);
  const signals = [];
  let finish;
  const completion = new Promise(resolve => { finish = resolve; });
  const kill = t.mock.method(process, "kill", (pid, signal) => {
    assert.equal(pid, -12345, "kill the dedicated process group, not only the CLI");
    signals.push(signal);
    finish({ state: "failed", error: "killed", tokenUsage: { total: 11 }, startedAt: "2026-10-19T00:00:00Z", completedAt: "2026-10-19T00:00:01Z" });
  });
  const spawn = t.mock.method(childProcess, "spawn", (_command, _argv, options) => {
    assert.equal(options.detached, true);
    return { pid: 12345, kill: () => assert.fail("must terminate process group") };
  });
  let calls = 0;
  const adapter = createRunInvokeAdapter({ startRun: async args => {
    calls++;
    args.spawnImpl("offline-test-double", []);
    return { runId: "offline", completion };
  } });
  const result = await adapter({ probe: workspace.probe, workspaceRoot: workspace.workspaceRoot, identity: { adapterId: "codex", modelId: "offline" }, limits: { absoluteTimeoutMs: 20, maxOutputBytes: 1000 } });
  assert.equal(calls, 1);
  assert.equal(spawn.mock.callCount(), 1, "only the fake spawn is called");
  assert.deepEqual(signals, ["SIGKILL"]);
  assert.equal(kill.mock.callCount(), 1);
  assert.equal(result.tokens, 11);
  assert.equal(result.durationMs, 1000);
  assert.equal(result.errorKind, "timeout");
});

test("borrowed runner workspace and changed paths are returned unchanged", async t => {
  const workspace = materializeProbeWorkspace("builder.apply-fix-v1");
  t.after(workspace.dispose);
  const spawn = t.mock.method(childProcess, "spawn", () => assert.fail("no real CLI"));
  const adapter = createRunInvokeAdapter({ materializeWorkspace: () => assert.fail("runner already materialized"), startRun: async args => {
    writeFileSync(join(args.cwd, "src/compute-total.js"), "export function computeTotal(items) { return items.reduce((sum, item) => sum + item.value, 0); }\n");
    return { runId: "offline", completion: Promise.resolve({ state: "completed" }) };
  } });
  const result = await adapter({ probe: workspace.probe, workspaceRoot: workspace.workspaceRoot, identity: { adapterId: "claude", modelId: "offline" }, limits: { absoluteTimeoutMs: 1000, maxOutputBytes: 1000 } });
  assert.equal(result.workspaceRoot, workspace.workspaceRoot);
  assert.deepEqual(result.snapshotPaths.changed, ["src/compute-total.js"]);
  assert.equal(result.errorKind, null);
  assert.equal(spawn.mock.callCount(), 0);
});

test("absolute deadline cancels active runtime and awaits cancellation plus completion despite activity", async t => {
  const workspace = materializeProbeWorkspace("explorer.find-symbol-v1");
  t.after(workspace.dispose);
  let finish;
  let cancelFinished = false;
  let activity = 0;
  const completion = new Promise(resolve => { finish = resolve; });
  const interval = setInterval(() => { activity++; }, 2);
  t.after(() => clearInterval(interval));
  const adapter = createRunInvokeAdapter({
    startRun: async () => ({ runId: "active-double", completion }),
    cancelRun: async (_home, id, options) => {
      assert.equal(id, "active-double");
      assert.equal(options.signal, "SIGKILL");
      await new Promise(resolve => setTimeout(resolve, 10));
      cancelFinished = true;
      setTimeout(() => finish({ state: "cancelled", tokenUsage: { total: 19 } }), 10);
    }
  });
  // Bound the old implementation so RED never hangs on its unbounded cleanup.
  t.after(() => finish({ state: "cancelled" }));
  const result = await Promise.race([
    adapter({ probe: workspace.probe, workspaceRoot: workspace.workspaceRoot, identity: { adapterId: "codex", modelId: "offline" }, limits: { absoluteTimeoutMs: 20, maxOutputBytes: 1000, cleanupGraceMs: 80 } }),
    new Promise(resolve => setTimeout(() => resolve({ errorKind: "test-watchdog" }), 200))
  ]);
  assert.equal(result.errorKind, "timeout");
  assert.equal(cancelFinished, true);
  assert.ok(activity > 2);
  assert.equal(result.tokens, 19);
  assert.equal(result.cleanupFailed, false);
});

test("uncancellable preflight deadline reports cleanup failure and prevents late task spawn", async t => {
  const workspace = materializeProbeWorkspace("explorer.find-symbol-v1");
  t.after(workspace.dispose);
  let release;
  let lateSpawnError;
  let cancellations = 0;
  const spawn = t.mock.method(childProcess, "spawn", () => assert.fail("late task must not spawn"));
  const adapter = createRunInvokeAdapter({
    startRun: async args => {
      await new Promise(resolve => { release = resolve; });
      try { args.spawnImpl("offline", []); } catch (error) { lateSpawnError = error; throw error; }
    },
    cancelRun: async () => { cancellations++; }
  });
  t.after(() => release());
  const result = await Promise.race([
    adapter({ probe: workspace.probe, workspaceRoot: workspace.workspaceRoot, identity: { adapterId: "claude", modelId: "offline" }, limits: { absoluteTimeoutMs: 15, cleanupGraceMs: 20, maxOutputBytes: 1000 } }),
    new Promise(resolve => setTimeout(() => resolve({ errorKind: "test-watchdog" }), 200))
  ]);
  assert.equal(result.errorKind, "timeout");
  assert.equal(result.cleanupFailed, true);
  assert.match(result.preflightCancellationLimitation, /preflight/i);
  assert.equal(cancellations, 0, "no registered run exists during initial preflight");
  release();
  await result.cleanupCompletion;
  assert.match(lateSpawnError.message, /timeout/);
  assert.equal(spawn.mock.callCount(), 0);
});
