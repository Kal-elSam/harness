import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chmod, mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { parseArgs } from "../src/cli.js";
import { buildPiLaunch } from "../src/global/runtime/execution-adapters/pi.js";
import { resolveKairoMinionExtensionPath } from "../src/global/runtime/orchestration/index.js";
import { startRun } from "../src/global/runtime/run-manager.js";
import { readRunState } from "../src/global/runtime/run-store.js";
import { RUN_STATES } from "../src/global/runtime/run-types.js";

async function withPiOnPath(fn) {
  const binDir = await mkdtemp(join(tmpdir(), "kairo-pi-strat-bin-"));
  await writeFile(
    join(binDir, "pi"),
    "#!/bin/sh\nif [ \"$1\" = \"--help\" ]; then echo '  --mode json'; echo '  --no-session'; exit 0; fi\nexit 0\n",
    "utf8"
  );
  await chmod(join(binDir, "pi"), 0o755);
  const previousPath = process.env.PATH ?? "";
  process.env.PATH = `${binDir}${delimiter}${previousPath}`;
  try { return await fn(); }
  finally { process.env.PATH = previousPath; }
}

async function installMinionAsset(homeDir) {
  const dest = resolveKairoMinionExtensionPath(homeDir);
  await mkdir(join(dest, ".."), { recursive: true });
  await writeFile(dest, "export default () => {};\n", "utf8");
  return dest;
}

function fakeSpawn(capture) {
  return (command, args) => {
    capture.push({ command, args });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 4242;
    child.kill = () => child.emit("close", 130);
    queueMicrotask(() => child.emit("close", 0));
    return child;
  };
}

test("parseArgs strategy defaults, accepts values, rejects invalid/missing", () => {
  assert.equal(parseArgs(["run", "--task", "x"]).options.strategy, "direct");
  assert.equal(parseArgs(["run", "--task", "x", "--strategy", "orchestrated"]).options.strategy, "orchestrated");
  assert.equal(parseArgs(["run", "--task", "x", "--strategy=direct"]).options.strategy, "direct");
  assert.throws(() => parseArgs(["run", "--task", "x", "--strategy", "parallel"]), /Invalid run strategy/);
  assert.throws(() => parseArgs(["run", "--task", "x", "--strategy"]), /Missing value/);
  assert.throws(() => parseArgs(["run", "--task", "x", "--strategy", "--json"]), /Missing value/);
});

test("direct Pi argv stays unchanged; orchestrated adds managed extension only", () => {
  const task = "do the thing";
  const direct = buildPiLaunch({ task, cwd: "/tmp", permissions: ["read-only"], model: "m1" });
  assert.deepEqual(direct.args, [
    "--mode", "json", "--no-session", "--tools", "read,grep,find,ls",
    "--model", "m1", task
  ]);
  const ext = "/home/.harness/components/orchestrator/extensions/pi/kairo-minion.js";
  const orch = buildPiLaunch({
    task, cwd: "/tmp", permissions: ["read-only"], model: "m1",
    strategy: "orchestrated", extensionPath: ext
  });
  assert.deepEqual(orch.args, [
    "--mode", "json", "--no-session", "--tools", "read,grep,find,ls",
    "--model", "m1", "--no-extensions", "--extension", ext, task
  ]);
  assert.throws(
    () => buildPiLaunch({ task, strategy: "orchestrated" }),
    /managed extension path/
  );
});

test("orchestrated fail-closed for non-Pi and missing extension; launch uses homeDir path", async () => {
  await withPiOnPath(async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "kairo-strat-"));
    try {
      await assert.rejects(
        () => startRun({
          homeDir, agentId: "codex", task: "x", cwd: homeDir, cliVersion: "0.8.0",
          strategy: "orchestrated",
          spawnImpl: fakeSpawn([])
        }),
        /requires agent "pi"/
      );

      await assert.rejects(
        () => startRun({
          homeDir, agentId: "pi", task: "x", cwd: homeDir, cliVersion: "0.8.0",
          strategy: "orchestrated", spawnImpl: fakeSpawn([])
        }),
        /extension missing/
      );

      const ext = await installMinionAsset(homeDir);
      const captured = [];
      const { runId, metadata, completion } = await startRun({
        homeDir, agentId: "pi", task: "secret objective text", cwd: homeDir,
        cliVersion: "0.8.0", strategy: "orchestrated", permissions: ["read-only"],
        spawnImpl: fakeSpawn(captured)
      });
      const final = await completion;
      assert.equal(final.state, RUN_STATES.COMPLETED);
      assert.equal(metadata.strategy, "orchestrated");
      assert.equal(metadata.lineage.rootRunId, runId);
      assert.equal(metadata.lineage.parentRunId, null);
      assert.equal(metadata.lineage.depth, 0);
      assert.ok(metadata.lineage.taskId);
      assert.doesNotMatch(JSON.stringify(metadata), /secret objective/);
      assert.equal(captured[0].args.at(-1), "secret objective text");
      assert.ok(captured[0].args.includes("--no-extensions"));
      const extIdx = captured[0].args.indexOf("--extension");
      assert.equal(captured[0].args[extIdx + 1], ext);
      assert.ok(!captured[0].args.includes(".pi/agent"));

      const noWait = await startRun({
        homeDir, agentId: "pi", task: "detached", cwd: homeDir, cliVersion: "0.8.0",
        strategy: "orchestrated", wait: false,
        forkDetachedSupervisorImpl: () => 99999,
        spawnImpl: fakeSpawn([])
      });
      assert.equal(noWait.metadata.strategy, "orchestrated");
      assert.equal(noWait.metadata.lineage.rootRunId, noWait.runId);
      assert.equal((await readRunState(homeDir, noWait.runId)).strategy, "orchestrated");
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });
});
