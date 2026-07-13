import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRun } from "../src/global/runtime/run-manager.js";
import { readRunEvents, readRunState } from "../src/global/runtime/run-store.js";
import { runPaths } from "../src/global/paths.js";
import { withStubExecutables } from "./helpers/stub-executables.js";

function createFakeSpawn(lines, { exitCode = 0 } = {}) {
  return (_command, _args, _options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 4242;
    child.kill = () => child.emit("close", 130);

    setImmediate(() => {
      for (const line of lines) {
        child.stdout.emit("data", `${line}\n`);
      }
      child.emit("close", exitCode);
    });

    return child;
  };
}

test("persisted run artifacts exclude raw task content", async () => {
  await withStubExecutables(["codex"], async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "kairo-run-privacy-"));
    const secretTask = "super secret prompt that must never be persisted";

    const { runId, completion } = await startRun({
      homeDir,
      agentId: "codex",
      task: secretTask,
      cwd: homeDir,
      cliVersion: "0.2.1",
      spawnImpl: createFakeSpawn([JSON.stringify({ type: "result" })])
    });

    await completion;

    const { statePath, eventsPath } = runPaths(homeDir, runId);
    const stateRaw = await readFile(statePath, "utf8");
    const eventsRaw = await readFile(eventsPath, "utf8");

    assert.doesNotMatch(stateRaw, /super secret/);
    assert.doesNotMatch(eventsRaw, /super secret/);
    assert.match(stateRaw, /taskDigest/);

    const metadata = await readRunState(homeDir, runId);
    const events = await readRunEvents(homeDir, runId);
    const started = events.find((event) => event.type === "run.started");

    assert.equal(metadata.taskSummary, undefined);
    assert.equal(started?.data?.taskSummary, undefined);
    assert.ok(started?.data?.taskDigest);
  });
});
