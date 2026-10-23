import test from "node:test";
import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as containment from "../src/global/runtime/codex-write-containment.js";
import codex from "../src/global/runtime/execution-adapters/codex.js";

// The fake filesystem makes all four probe locations disjoint without host writes.
function fakeCanary(overrides = {}) {
  const calls = [];
  const removed = [];
  const deps = {
    platform: "darwin", realpathSync: (path) => path, homeDir: "/home/test", tempDir: "/temp",
    mkdtemp: async () => "/home/test/kairo-write-fresh", exists: async (path) => path.startsWith("/repo/") || path.startsWith(process.cwd() + "/"),
    rm: async (path) => { removed.push(path); },
    run: async (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: args.includes("/bin/echo") ? "kairo-control-ok\n"
        : calls.length === 1 ? "kairo-write-ok\n" : "kairo-write-denied:EPERM\n" };
    }, ...overrides
  };
  return { calls, removed, deps };
}

test("shared profile canonicalizes and TOML-escapes cwd without inheritance", () => {
  const profile = containment.buildCodexWriteProfile("alias", { realpathSync: () => '/real/a"b\\c' });
  assert.equal(profile.root, '/real/a"b\\c');
  assert.deepEqual(profile.configArgs, ["-c", 'permissions.kairo_cwd.filesystem={":root"="read","/real/a\\"b\\\\c"="write"}']);
  for (const path of ["relative", "/bad\u0000", "/bad\n", "/bad\ud800"]) {
    assert.throws(() => containment.buildCodexWriteProfile(path, { realpathSync: (p) => p }));
  }
});

test("canary proves four writes plus echo with same launch profile, timeout and cleanup", async () => {
  const { deps, calls, removed } = fakeCanary();
  const result = await containment.verifyCodexWriteSandbox({ cwd: "/repo", ...deps });
  assert.equal(result.verified, true);
  assert.equal(result.root, "/repo");
  assert.equal(calls.length, 5);
  const profile = containment.buildCodexWriteProfile("/repo", deps);
  for (const call of calls) {
    assert.equal(call.command, "codex");
    assert.equal(call.args.includes("--ignore-user-config"), false);
    assert.deepEqual(call.args.slice(0, 8), ["sandbox", "-C", "/repo", "-P", profile.name, ...profile.configArgs, "--"]);
    assert.ok(call.options.timeout > 0 && call.options.timeout <= 15000);
  }
  const launch = codex.buildLaunch({ task: "Implement", cwd: process.cwd(), requireVerifiedWriteContainment: true });
  assert.equal(launch.args.includes("--ignore-user-config"), true);
  assert.ok(calls[1].args.at(-1).startsWith("/home/test/kairo-write-fresh/"));
  assert.ok(calls[2].args.at(-1).startsWith("/temp/"));
  assert.ok(calls[3].args.at(-1).startsWith("/tmp/"));
  assert.ok(removed.includes("/home/test/kairo-write-fresh"));
});

for (const failure of ["leak", "allowed", "timeout", "throw", "signal", "unknown", "control", "inside"]) {
  test(`canary fails closed and cleans up on ${failure}`, async () => {
    let count = 0;
    const { deps, removed } = fakeCanary({
      exists: async (path) => failure === "leak" || path.startsWith("/repo/"),
      run: async (_command, args) => {
        count++;
        if (failure === "throw") throw new Error("launch error");
        if (failure === "timeout") return { error: { code: "ETIMEDOUT" }, status: null };
        if (failure === "signal") return { status: null, signal: "SIGTERM" };
        const stdout = args.includes("/bin/echo") ? (failure === "control" ? "no" : "kairo-control-ok")
          : count === 1 ? (failure === "inside" ? "kairo-write-denied:EPERM" : "kairo-write-ok")
          : failure === "allowed" ? "kairo-write-ok" : failure === "unknown" ? "" : "kairo-write-denied:EPERM";
        return { status: 0, stdout };
      }
    });
    await assert.rejects(() => containment.verifyCodexWriteSandbox({ cwd: "/repo", ...deps }));
    assert.ok(removed.length > 0);
  });
}

test("strict adapter uses only profile/never/ignore-config; ordinary argv stays byte-identical", async () => {
  const root = realpathSync(await mkdtemp(join(tmpdir(), "kairo-write-argv-")));
  try {
    const launch = codex.buildLaunch({ task: "Implement", cwd: root, model: "m", requireVerifiedWriteContainment: true });
    const profile = containment.buildCodexWriteProfile(root);
    assert.deepEqual(launch.args, ["--model", "m", "exec", "--json", "-c", 'default_permissions="kairo_cwd"', ...profile.configArgs, "-c", 'approval_policy="never"', "--ignore-user-config", "Implement"]);
    for (const forbidden of ["--sandbox", "--approve-for-me", "--dangerously-bypass-approvals-and-sandbox"]) assert.equal(launch.args.includes(forbidden), false);
    assert.deepEqual(codex.buildLaunch({ task: "Implement", cwd: root, model: "m" }).args,
      ["--model", "m", "exec", "--json", "--approve-for-me", "Implement"]);
    for (const permission of ["force", "yolo"]) assert.throws(() => codex.buildLaunch({ task: "t", cwd: root, permissions: [permission], requireVerifiedWriteContainment: true }));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("startRun threads strict posture and detached supervisor rechecks fresh evidence before spawn", async () => {
  const { startRun } = await import("../src/global/runtime/run-manager.js");
  const { supervisePreparedRun } = await import("../src/global/runtime/run-supervisor.js");
  const { readRunState } = await import("../src/global/runtime/run-store.js");
  const { EventEmitter } = await import("node:events");
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-write-supervisor-"));
  const cwd = process.cwd();
  let checks = 0;
  let spawns = 0;
  const adapter = {
    ...codex, availability: () => ({ available: true, launchable: true }),
    preflight: async (options) => {
      assert.equal(options.requireVerifiedWriteContainment, true);
      checks++;
      const { deps } = fakeCanary();
      return codex.preflight({ ...options, verifyAuth: async () => ({ ok: true }),
        verifyWriteSandbox: (input) => containment.verifyCodexWriteSandbox({ ...input, ...deps }) });
    },
    buildLaunch: (options) => {
      assert.equal(options.requireVerifiedWriteContainment, true);
      return codex.buildLaunch(options);
    }
  };
  try {
    const run = await startRun({ homeDir, cwd, agentId: "codex", task: "Implement", wait: false,
      requireVerifiedWriteContainment: true, resolveAdapterImpl: () => adapter,
      forkDetachedSupervisorImpl: () => 42 });
    assert.equal(checks, 1);
    const metadata = await supervisePreparedRun({ homeDir, runId: run.runId, resolveAdapterImpl: () => adapter,
      spawnImpl: (_command, args) => {
        spawns++;
        assert.equal(checks, 2);
        assert.equal(args.includes("--approve-for-me"), false);
        const child = new EventEmitter();
        child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.pid = 43;
        setImmediate(() => child.emit("close", 0));
        return child;
      } });
    assert.equal(metadata.state, "completed");
    assert.equal(spawns, 1);
    const denied = await startRun({ homeDir, cwd, agentId: "codex", task: "t", wait: false,
      requireVerifiedWriteContainment: true, resolveAdapterImpl: () => adapter, forkDetachedSupervisorImpl: () => 42 });
    await assert.rejects(() => supervisePreparedRun({ homeDir, runId: denied.runId,
      resolveAdapterImpl: () => ({ ...adapter, preflight: async () => { throw new Error("fresh canary failed"); } }),
      spawnImpl: () => { throw new Error("must not spawn"); } }), /fresh canary failed/);
    assert.equal((await readRunState(homeDir, denied.runId)).state, "failed");
  } finally { await rm(homeDir, { recursive: true, force: true }); }
});
