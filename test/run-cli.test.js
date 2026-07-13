import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../src/cli.js";
import { runGlobalRun, runGlobalRuns } from "../src/global/runtime/run-cli.js";
import { startRun } from "../src/global/runtime/run-manager.js";
import { withStubExecutables } from "./helpers/stub-executables.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const kairoBin = join(packageRoot, "bin/kairo.js");

function createFakeSpawn(lines, { exitCode = 0 } = {}) {
  return (_command, _args, _options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 5151;
    child.kill = () => child.emit("close", 130);

    queueMicrotask(() => {
      for (const line of lines) child.stdout.emit("data", `${line}\n`);
      child.emit("close", exitCode);
    });

    return child;
  };
}

test("parseArgs routes run and runs commands", () => {
  const run = parseArgs(["run", "--agent", "codex", "--task", "hello"]);
  assert.equal(run.command, "run");
  assert.equal(run.options.agent, "codex");
  assert.equal(run.options.task, "hello");

  const runs = parseArgs(["runs", "show", "run_abc"]);
  assert.equal(runs.command, "runs");
  assert.equal(runs.options.runsAction, "show");
  assert.equal(runs.options.runId, "run_abc");
});

test("runGlobalRun --json --wait emits a single JSON document", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-run-cli-json-"));
  const packageManifest = { version: "0.2.2" };
  const previousHome = process.env.HARNESS_HOME;
  process.env.HARNESS_HOME = homeDir;

  const originalStartRun = startRun;
  const startRunImpl = async () => ({
    runId: "run_json_once",
    metadata: { runId: "run_json_once", state: "running", agentId: "codex" },
    completion: Promise.resolve({
      runId: "run_json_once",
      state: "completed",
      agentId: "codex",
      exitCode: 0
    })
  });

  const jsonLines = [];
  const originalLog = console.log;
  console.log = (line) => {
    if (typeof line === "string" && line.startsWith("{")) {
      jsonLines.push(line);
    }
  };

  try {
    await runGlobalRun({
      agent: "codex",
      task: "hello",
      cwd: homeDir,
      json: true,
      wait: true
    }, packageManifest, { startRunImpl });
    assert.equal(jsonLines.length, 1);
    assert.match(jsonLines[0], /"state":"completed"/);
  } finally {
    console.log = originalLog;
    if (previousHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
  }
});

test("runGlobalRuns list returns persisted runs", async () => {
  await withStubExecutables(["codex"], async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "kairo-run-cli-"));
    const packageManifest = { version: "0.2.1" };

    const { completion } = await startRun({
      homeDir,
      agentId: "codex",
      task: "cli test",
      cwd: homeDir,
      cliVersion: packageManifest.version,
      spawnImpl: createFakeSpawn([JSON.stringify({ type: "result" })])
    });
    await completion;

    const previousHome = process.env.HARNESS_HOME;
    process.env.HARNESS_HOME = homeDir;
    try {
      const result = await runGlobalRuns({ cwd: homeDir, json: true }, packageManifest);
      assert.ok(result.runs.length >= 1);
    } finally {
      if (previousHome === undefined) delete process.env.HARNESS_HOME;
      else process.env.HARNESS_HOME = previousHome;
    }
  });
});

test("help documents runtime commands", () => {
  const cli = spawnSync(process.execPath, [kairoBin, "help"], {
    cwd: packageRoot,
    encoding: "utf8",
    env: { ...process.env, HARNESS_INK: "0" }
  });

  assert.equal(cli.status, 0);
  assert.match(cli.stdout, /kairo run --agent/);
  assert.match(cli.stdout, /runs list/);
  assert.match(cli.stdout, /Operations dashboard/);
});
