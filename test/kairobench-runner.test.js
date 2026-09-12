import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { runKairoBenchTask } from "../src/global/intelligence/kairobench-runner.js";

// Every test here injects a fake runTask — never the real defaultRunTask,
// which is the only thing in this module that actually spends real quota.

const PASSING_TASK = {
  id: "fake-01", category: "Test",
  async setup({ writeFile }) { await writeFile("seed.txt", "seed"); },
  async verify({ readFile }) {
    const content = await readFile("seed.txt", "utf8");
    return content === "seed-modified-by-fake-model";
  },
  prompt: "irrelevant for this test"
};

test("runKairoBenchTask runs setup, calls the injected runTask, then verify, and reports the real outcome", async () => {
  let capturedCwd = null;
  const fakeRunTask = async ({ adapterId, model, cwd, task }) => {
    capturedCwd = cwd;
    assert.equal(adapterId, "codex");
    assert.equal(model, "gpt-6-astra");
    assert.equal(task, "irrelevant for this test");
    // Simulate the model doing real work: modify the real seed file.
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await writeFile(join(cwd, "seed.txt"), "seed-modified-by-fake-model");
    return { runId: "run-fake-1", durationMs: 4200, tokenUsage: { total: 1500 }, cost: 0.03 };
  };

  const result = await runKairoBenchTask(PASSING_TASK, { adapterId: "codex", model: "gpt-6-astra", runTask: fakeRunTask });

  assert.equal(result.success, true);
  assert.equal(result.taskId, "fake-01");
  assert.equal(result.adapterId, "codex");
  assert.equal(result.model, "gpt-6-astra");
  assert.equal(result.durationMs, 4200);
  assert.deepEqual(result.tokenUsage, { total: 1500 });
  assert.equal(result.cost, 0.03);
  assert.equal(result.runId, "run-fake-1");
  assert.ok(capturedCwd, "runTask must receive a real scratch directory, not the caller's cwd");
});

test("runKairoBenchTask reports a real failure, never fabricating success, when the model's real change doesn't satisfy verify", async () => {
  const fakeRunTask = async () => ({ runId: "run-fake-2", durationMs: 1000, tokenUsage: null, cost: null });
  const result = await runKairoBenchTask(PASSING_TASK, { adapterId: "codex", model: "gpt-5.6-luna", runTask: fakeRunTask });
  assert.equal(result.success, false);
});

test("runKairoBenchTask deletes the real scratch directory afterward, in the user's real project", async () => {
  let scratchDir = null;
  const fakeRunTask = async ({ cwd }) => {
    scratchDir = cwd;
    return { runId: "run-fake-3" };
  };
  await runKairoBenchTask(PASSING_TASK, { adapterId: "codex", model: "gpt-6-astra", runTask: fakeRunTask });
  assert.equal(existsSync(scratchDir), false, "the scratch directory must be cleaned up, never left behind");
});

test("runKairoBenchTask never touches the process's real working directory — every task runs in its own isolated scratch dir", async () => {
  const cwdSeen = [];
  const fakeRunTask = async ({ cwd }) => { cwdSeen.push(cwd); return { runId: "run-fake-4" }; };
  await runKairoBenchTask(PASSING_TASK, { adapterId: "codex", model: "gpt-6-astra", runTask: fakeRunTask });
  assert.notEqual(cwdSeen[0], process.cwd());
});

test("a task whose verify itself throws (e.g. an expected file was never created) is reported as a real failure, not an error", async () => {
  const throwingTask = { id: "fake-throw", category: "Test", prompt: "x", async verify() { throw new Error("file not found"); } };
  const result = await runKairoBenchTask(throwingTask, { adapterId: "codex", model: "gpt-6-astra", runTask: async () => ({ runId: "r" }) });
  assert.equal(result.success, false);
});
