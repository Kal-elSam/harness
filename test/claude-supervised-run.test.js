import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { startRun } from "../src/global/runtime/run-manager.js";

test("detached-run path preserves reserved run id and revalidates Claude auth before spawn", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-claude-supervisor-"));
  const binDir = await mkdtemp(join(tmpdir(), "kairo-claude-bin-"));
  const logPath = join(homeDir, "auth.log");
  const executable = join(binDir, "claude");
  await writeFile(executable, `#!/bin/sh\necho auth >> ${JSON.stringify(logPath)}\nprintf '%s\\n' '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"pro"}'\n`);
  await chmod(executable, 0o755);
  const previousPath = process.env.PATH;
  process.env.PATH = `${binDir}${delimiter}${previousPath ?? ""}`;
  let launch;
  try {
    const result = await startRun({
      homeDir, runId: "run_reserved", agentId: "claude", task: "Implement",
      cwd: homeDir, permissions: [], allowUnsafePermissions: false,
      permissionSource: "cockpit", wait: true,
      spawnImpl(command, args) {
        launch = { command, args };
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.pid = 9191;
        child.kill = () => true;
        setImmediate(() => child.emit("close", 0));
        return child;
      }
    });
    assert.equal(result.runId, "run_reserved");
    assert.equal((await result.completion).runId, "run_reserved");
  } finally {
    process.env.PATH = previousPath;
  }
  assert.equal((await readFile(logPath, "utf8")).trim().split("\n").length, 2);
  assert.equal(launch.command, "claude");
  assert.equal(launch.args.includes("--force"), false);
  assert.equal(launch.args.includes("--dangerously-skip-permissions"), false);
  assert.deepEqual(launch.args.slice(2, 6), ["stream-json", "--permission-mode", "auto", "--permission-prompts"]);
});
