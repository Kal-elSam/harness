// Runs one KairoBench task (kairobench-tasks.js) against one real model,
// in an isolated scratch directory that's always deleted afterward — never
// the user's real project. `runTask` is injectable specifically so this
// can be exercised in tests with zero cost and zero real execution; the
// default wires to run-manager's real startRun, which is what actually
// spends quota when this is genuinely invoked.

import { mkdtemp, readFile as fsReadFile, writeFile as fsWriteFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { startRun } from "../runtime/run-manager.js";
import { readRunState } from "../runtime/run-store.js";

function realShellRun(command, args, cwd) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { cwd });
    } catch (error) {
      reject(error);
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ stdout, stderr, exitCode }));
  });
}

async function defaultRunTask({ adapterId, model, cwd, task, homeDir }) {
  // Real execution: this is what actually spends real quota/money against
  // a real provider. Never called by a test — every test injects a fake.
  const { runId } = await startRun({
    homeDir, agentId: adapterId, model, cwd, task, permissions: ["yolo"], wait: true
  });
  const state = await readRunState(homeDir, runId);
  const startedAtMs = Date.parse(state?.startedAt ?? "");
  const completedAtMs = Date.parse(state?.completedAt ?? "");
  return {
    runId,
    durationMs: Number.isFinite(startedAtMs) && Number.isFinite(completedAtMs) ? completedAtMs - startedAtMs : null,
    tokenUsage: state?.tokenUsage ?? null,
    cost: state?.cost ?? null
  };
}

/**
 * @param {object} task - one KAIROBENCH_TASKS entry ({id, category, prompt, setup?, verify})
 * @param {{adapterId: string, model: string, homeDir?: string, runTask?: Function}} options
 * @returns {Promise<{taskId: string, category: string, adapterId: string, model: string, success: boolean, durationMs: number|null, tokenUsage: object|null, cost: number|null, runId: string|null}>}
 */
export async function runKairoBenchTask(task, { adapterId, model, homeDir = null, runTask = defaultRunTask } = {}) {
  const scratchDir = await mkdtemp(join(tmpdir(), `kairobench-${task.id}-`));
  try {
    const io = {
      readFile: (path, encoding) => fsReadFile(join(scratchDir, path), encoding),
      writeFile: (path, content) => fsWriteFile(join(scratchDir, path), content),
      run: (command, args) => realShellRun(command, args, scratchDir)
    };

    if (task.setup) await task.setup(io);

    const runResult = await runTask({ adapterId, model, cwd: scratchDir, task: task.prompt, homeDir });

    let success = false;
    try {
      success = await task.verify(io);
    } catch {
      success = false; // a verify that throws (e.g. the expected file was never created) is a real failure, not an error to surface
    }

    return {
      taskId: task.id, category: task.category, adapterId, model, success,
      durationMs: runResult?.durationMs ?? null,
      tokenUsage: runResult?.tokenUsage ?? null,
      cost: runResult?.cost ?? null,
      runId: runResult?.runId ?? null
    };
  } finally {
    await rm(scratchDir, { recursive: true, force: true }).catch(() => {});
  }
}
