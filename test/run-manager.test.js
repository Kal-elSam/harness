import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  recoverRuns,
  startRun,
  stopRun
} from "../src/global/runtime/run-manager.js";
import { createRunRecord, readRunEvents, readRunState, writeRunState } from "../src/global/runtime/run-store.js";
import { createRunMetadata, RUN_STATES } from "../src/global/runtime/run-types.js";
import { hasRunHandoff, writeRunHandoff } from "../src/global/runtime/run-handoff.js";
import { writeCancelSignal } from "../src/global/runtime/run-cancel-signal.js";
import { transitionRunState } from "../src/global/runtime/run-events.js";
import { runPaths } from "../src/global/paths.js";
import { spawnDetachedSupervisor } from "../src/global/runtime/run-supervisor.js";
import { writeSupervisorLock } from "../src/global/runtime/run-supervisor-lock.js";
import { withStubExecutables } from "./helpers/stub-executables.js";

function createFakeSpawn(lines, { exitCode = 0 } = {}) {
  return (_command, _args, _options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 4242;
    child.kill = () => {
      child.emit("close", 130);
    };

    setImmediate(() => {
      for (const line of lines) {
        child.stdout.emit("data", `${line}\n`);
      }
      child.emit("close", exitCode);
    });

    return child;
  };
}

test("startRun supervises process, normalizes events, and completes", async () => {
  await withStubExecutables(["codex"], async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "kairo-run-manager-"));
    const lines = [
      JSON.stringify({ type: "tool_call", tool_name: "read_file", subtype: "started" }),
      JSON.stringify({
        type: "result",
        usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 }
      })
    ];

    const { runId, completion } = await startRun({
      homeDir,
      agentId: "codex",
      task: "run tests",
      cwd: homeDir,
      cliVersion: "0.2.1",
      spawnImpl: createFakeSpawn(lines)
    });

    assert.ok(runId);

    const final = await completion;
    const events = await readRunEvents(homeDir, runId);

    assert.equal(final.state, RUN_STATES.COMPLETED);
    assert.equal(final.exitCode, 0);
    assert.ok(events.some((event) => event.type === "run.completed"));
  });
});

test("startRun marks failure on non-zero exit", async () => {
  await withStubExecutables(["codex"], async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "kairo-run-fail-"));

    const { completion } = await startRun({
      homeDir,
      agentId: "codex",
      task: "fail",
      cwd: homeDir,
      cliVersion: "0.2.1",
      spawnImpl: createFakeSpawn([], { exitCode: 2 })
    });

    const final = await completion;
    const saved = await readRunState(homeDir, final.runId);
    assert.equal(saved.state, RUN_STATES.FAILED);
    assert.equal(saved.exitCode, 2);
  });
});

test("stopRun cancels active run", async () => {
  await withStubExecutables(["codex"], async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "kairo-run-stop-"));

    const { runId } = await startRun({
      homeDir,
      agentId: "codex",
      task: "long task",
      cwd: homeDir,
      cliVersion: "0.2.1",
      spawnImpl: (_command, _args, _options) => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.pid = 4242;
        child.kill = () => child.emit("close", 130);
        return child;
      }
    });

    const cancelled = await stopRun(homeDir, runId);
    assert.equal(cancelled.state, RUN_STATES.CANCELLED);

    const events = await readRunEvents(homeDir, runId);
    assert.ok(events.some((event) => event.type === "run.cancelled"));
  });
});

test("stopRun removes handoff payload", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-run-stop-handoff-"));
  const metadata = createRunMetadata({
    runId: "run_stop_handoff",
    agentId: "codex",
    provider: "Codex",
    task: "secret handoff task",
    cwd: homeDir,
    cliVersion: "0.2.1"
  });
  metadata.state = RUN_STATES.RUNNING;
  await createRunRecord(homeDir, metadata);
  await writeRunHandoff(homeDir, metadata.runId, {
    agentId: "codex",
    task: "secret handoff task",
    cwd: homeDir
  });

  await stopRun(homeDir, metadata.runId);
  assert.equal(hasRunHandoff(homeDir, metadata.runId), false);
});

test("recoverRuns marks orphaned active runs interrupted", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-run-recover-"));
  const metadata = createRunMetadata({
    runId: "run_orphan",
    agentId: "codex",
    provider: "Codex",
    task: "orphan",
    cwd: homeDir,
    cliVersion: "0.2.1"
  });
  metadata.state = RUN_STATES.RUNNING;
  await createRunRecord(homeDir, metadata);

  const interrupted = await recoverRuns(homeDir);
  const state = await readRunState(homeDir, metadata.runId);

  assert.equal(interrupted.length, 1);
  assert.equal(state.state, RUN_STATES.INTERRUPTED);
});

test("opencode is rejected for auditable runs", async () => {
  await withStubExecutables(["opencode"], async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "kairo-run-opencode-"));

    await assert.rejects(
      () => startRun({
        homeDir,
        agentId: "opencode",
        task: "task",
        cwd: homeDir,
        cliVersion: "0.2.1",
        spawnImpl: createFakeSpawn([])
      }),
      /launchable|structured events|auditable|compatible/i
    );
  });
});

test("recoverRuns preserves runs supervised by a live process", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-run-alive-"));
  const metadata = createRunMetadata({
    runId: "run_alive",
    agentId: "codex",
    provider: "Codex",
    task: "still running",
    cwd: homeDir,
    cliVersion: "0.2.1"
  });
  metadata.state = RUN_STATES.RUNNING;
  metadata.pid = process.pid;
  await createRunRecord(homeDir, metadata);

  const interrupted = await recoverRuns(homeDir);
  const state = await readRunState(homeDir, metadata.runId);

  assert.equal(interrupted.length, 0);
  assert.equal(state.state, RUN_STATES.RUNNING);
});

test("startRun with wait false detaches supervision", async () => {
  await withStubExecutables(["codex"], async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "kairo-run-detach-"));
    let forked = false;

    const result = await startRun({
      homeDir,
      agentId: "codex",
      task: "detached task",
      cwd: homeDir,
      cliVersion: "0.2.1",
      wait: false,
      forkDetachedSupervisorImpl: () => {
        forked = true;
        return 424242;
      }
    });

    assert.equal(forked, true);
    assert.equal(result.completion, null);
    assert.equal(result.metadata.supervisorPid, 424242);
    assert.equal(result.metadata.state, RUN_STATES.STARTING);
  });
});

test("supervisor preserves cancelled state written by another process", async () => {
  await withStubExecutables(["codex"], async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "kairo-run-cancel-persist-"));
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 4242;
    child.kill = () => child.emit("close", 130);

    const { runId, completion } = await startRun({
      homeDir,
      agentId: "codex",
      task: "long task",
      cwd: homeDir,
      cliVersion: "0.2.1",
      spawnImpl: () => child
    });

    while (true) {
      try {
        const snapshot = await readRunState(homeDir, runId);
        if (snapshot?.state === RUN_STATES.RUNNING) break;
      } catch {
        // state.json may be mid-write while supervision starts
      }
      await new Promise((resolve) => setImmediate(resolve));
    }

    const current = await readRunState(homeDir, runId);
    await writeCancelSignal(homeDir, runId, {
      requested: true,
      signal: "SIGTERM",
      requestedAt: new Date().toISOString()
    });
    await writeRunState(homeDir, transitionRunState(current, RUN_STATES.CANCELLED, {
      error: "Run cancelled by user."
    }));

    child.emit("close", 0);

    const final = await completion;
    assert.equal(final.state, RUN_STATES.CANCELLED);
  });
});

test("recoverRuns preserves starting run within grace and keeps handoff", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-run-starting-grace-"));
  const metadata = createRunMetadata({
    runId: "run_starting",
    agentId: "codex",
    provider: "Codex",
    task: "starting",
    cwd: homeDir,
    cliVersion: "0.2.1"
  });
  metadata.state = RUN_STATES.STARTING;
  await createRunRecord(homeDir, metadata);
  await writeRunHandoff(homeDir, metadata.runId, {
    agentId: "codex",
    task: "secret prompt",
    cwd: homeDir
  });
  await writeSupervisorLock(homeDir, metadata.runId, {
    startingAt: new Date().toISOString(),
    supervisorPid: null,
    agentPid: null
  });

  const interrupted = await recoverRuns(homeDir);
  const state = await readRunState(homeDir, metadata.runId);

  assert.equal(interrupted.length, 0);
  assert.equal(state.state, RUN_STATES.STARTING);
  assert.equal(hasRunHandoff(homeDir, metadata.runId), true);
});

test("startRun deletes handoff when detached supervisor fails to spawn", async () => {
  await withStubExecutables(["codex"], async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "kairo-run-handoff-fail-"));

    await assert.rejects(
      () => startRun({
        homeDir,
        agentId: "codex",
        task: "secret prompt must not linger",
        cwd: homeDir,
        cliVersion: "0.2.1",
        wait: false,
        forkDetachedSupervisorImpl: () => {
          throw new Error("spawn failed");
        }
      }),
      /spawn failed/
    );

    const runs = await import("../src/global/runtime/run-store.js").then((mod) => mod.listRunRecords(homeDir));
    assert.equal(runs.length, 1);
    assert.equal(runs[0].state, RUN_STATES.FAILED);
    assert.equal(hasRunHandoff(homeDir, runs[0].runId), false);
  });
});

test("recoverRuns cleans orphan handoffs for terminal runs", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-run-handoff-clean-"));
  const metadata = createRunMetadata({
    runId: "run_handoff_orphan",
    agentId: "codex",
    provider: "Codex",
    task: "orphan prompt",
    cwd: homeDir,
    cliVersion: "0.2.1"
  });
  metadata.state = RUN_STATES.INTERRUPTED;
  await createRunRecord(homeDir, metadata);

  const { handoffPath } = (() => {
    const { runDir } = runPaths(homeDir, metadata.runId);
    return { handoffPath: join(runDir, "handoff.json") };
  })();
  await writeFile(handoffPath, `${JSON.stringify({ task: "orphan prompt" })}\n`, "utf8");
  assert.equal(existsSync(handoffPath), true);

  await recoverRuns(homeDir);
  assert.equal(existsSync(handoffPath), false);
});

test("spawnDetachedSupervisor uses spawn without ipc channel", () => {
  let spawnOptions = null;
  const child = new EventEmitter();
  child.pid = 51515;
  child.unref = () => {};

  const pid = spawnDetachedSupervisor({
    homeDir: "/tmp/home",
    runId: "run_spawn",
    spawnImpl: (_execPath, _args, options) => {
      spawnOptions = options;
      return child;
    }
  });

  assert.equal(pid, 51515);
  assert.equal(spawnOptions.detached, true);
  assert.deepEqual(spawnOptions.stdio, "ignore");
  assert.equal(child.channel, undefined);
});
