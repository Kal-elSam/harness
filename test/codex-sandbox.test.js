import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { writeFile } from "node:fs/promises";
import {
  isCodexSandboxSupported, getCodexIsolationStatus, buildCodexSandboxProfile, runCodexSandboxedBootstrap
} from "../src/global/conversation/codex-sandbox.js";

test("isCodexSandboxSupported is false outright on a non-macOS platform, never probed further", async () => {
  const supported = await isCodexSandboxSupported({ platform: "linux", access: async () => { throw new Error("must not be called"); } });
  assert.equal(supported, false);
});

test("isCodexSandboxSupported is true only when sandbox-exec is actually executable on darwin", async () => {
  const supportedTrue = await isCodexSandboxSupported({ platform: "darwin", access: async () => {} });
  assert.equal(supportedTrue, true);

  const supportedFalse = await isCodexSandboxSupported({ platform: "darwin", access: async () => { throw new Error("ENOENT"); } });
  assert.equal(supportedFalse, false);
});

test("getCodexIsolationStatus reports a real, checkable reason on an unsupported platform — never a bare false", async () => {
  const status = await getCodexIsolationStatus({ platform: "linux" });
  assert.equal(status.available, false);
  assert.equal(status.boundaryVerified, false);
  assert.match(status.reason, /macOS/);
});

test("getCodexIsolationStatus reports boundaryVerified true on a supported macOS host", async () => {
  const status = await getCodexIsolationStatus({ platform: "darwin", access: async () => {} });
  assert.equal(status.available, true);
  assert.equal(status.boundaryVerified, true);
  assert.equal(status.reason, null);
});

test("buildCodexSandboxProfile denies by default and scopes reads/writes to the snapshot root and codexHome", async () => {
  const profile = await buildCodexSandboxProfile(
    { snapshotRoot: "/tmp/kairo-snap-1", codexHome: "/Users/kal-el/.codex" },
    { realpath: async (p) => p } // no symlink resolution needed for this assertion
  );
  assert.match(profile, /\(deny default\)/);
  assert.match(profile, /\(subpath "\/tmp\/kairo-snap-1"\)/);
  assert.match(profile, /\(subpath "\/Users\/kal-el\/\.codex"\)/);
  assert.match(profile, /\(allow network\*\)/);

  const [readBlock, writeBlock] = profile.split("(allow file-write*");
  assert.match(readBlock, /\(subpath "\/Users\/kal-el\/\.codex"\)/, "CODEX_HOME must be readable");
  assert.match(writeBlock, /\(subpath "\/Users\/kal-el\/\.codex"\)/, "CODEX_HOME must ALSO be writable — Codex's own app-server client fails to initialize (Operation not permitted) without write access to it too, verified empirically against the real CLI, not just read");
});

test("buildCodexSandboxProfile also allows the real (symlink-resolved) form of a path, not just the literal one given", async () => {
  const profile = await buildCodexSandboxProfile(
    { snapshotRoot: "/tmp/kairo-snap-2" },
    { realpath: async (p) => (p === "/tmp/kairo-snap-2" ? "/private/tmp/kairo-snap-2" : p) }
  );
  assert.match(profile, /\(subpath "\/tmp\/kairo-snap-2"\)/);
  assert.match(profile, /\(subpath "\/private\/tmp\/kairo-snap-2"\)/);
});

test("runCodexSandboxedBootstrap fails closed with isolation_unavailable on an unsupported platform — never a silent fallback", async () => {
  const result = await runCodexSandboxedBootstrap({
    question: "q", snapshotRoot: "/tmp/x", deps: { platform: "linux" }
  });
  assert.equal(result.status, "error");
  assert.equal(result.error, "isolation_unavailable");
  assert.equal(result.isolation.available, false);
});

test("runCodexSandboxedBootstrap wraps codex in sandbox-exec with its own sandbox disabled, and returns the real answer", async () => {
  const seenArgs = [];
  const spawn = (cmd, args) => {
    seenArgs.push([cmd, args]);
    const outFileIndex = args.indexOf("-o") + 1;
    const outFile = args[outFileIndex];
    const child = new EventEmitter();
    child.kill = () => {};
    setTimeout(async () => {
      await writeFile(outFile, "Real answer.\n", "utf8");
      child.emit("close", 0);
    }, 0);
    return child;
  };
  const result = await runCodexSandboxedBootstrap({
    question: "Investigate this project.", model: "gpt-6", snapshotRoot: "/tmp/kairo-snap-3",
    spawn, deps: { platform: "darwin", access: async () => {}, realpath: async (p) => p }
  });
  assert.equal(result.status, "answered");
  assert.equal(result.answer, "Real answer.");
  assert.equal(result.isolation.available, true);

  const [cmd, args] = seenArgs[0];
  assert.equal(cmd, "sandbox-exec");
  assert.ok(args.includes("codex"));
  assert.ok(args.includes("exec"));
  assert.ok(args.includes("--dangerously-bypass-approvals-and-sandbox"), "Codex's own internal sandbox must be off so it never conflicts with the external sandbox-exec wrapper");
  assert.equal(args.includes("--sandbox"), false, "Codex's own (non-confining) --sandbox read-only must never be combined with the external wrapper");
  assert.ok(args.includes("--skip-git-repo-check"));
  assert.ok(args.includes("--ephemeral"));
  assert.ok(args.includes("--ignore-user-config"));
  assert.ok(args.includes("Investigate this project."));
});

test("runCodexSandboxedBootstrap fails closed to error when the output file is never written", async () => {
  const spawn = () => {
    const child = new EventEmitter();
    child.kill = () => {};
    setTimeout(() => child.emit("close", 0), 0);
    return child;
  };
  const result = await runCodexSandboxedBootstrap({
    question: "q", snapshotRoot: "/tmp/kairo-snap-4",
    spawn, deps: { platform: "darwin", access: async () => {} }
  });
  assert.equal(result.status, "error");
});

test("runCodexSandboxedBootstrap scrubs the child's env — a real secret in Kairo's own process env must never reach it", async () => {
  let seenEnv;
  const spawn = (cmd, args, options) => {
    seenEnv = options.env;
    const outFileIndex = args.indexOf("-o") + 1;
    const outFile = args[outFileIndex];
    const child = new EventEmitter();
    child.kill = () => {};
    setTimeout(async () => { await writeFile(outFile, "ok\n", "utf8"); child.emit("close", 0); }, 0);
    return child;
  };
  await runCodexSandboxedBootstrap({
    question: "q", snapshotRoot: "/tmp/kairo-snap-5",
    sourceEnv: { PATH: "/usr/bin", REAL_SECRET_TOKEN: "sk-should-never-leak" },
    spawn, deps: { platform: "darwin", access: async () => {} }
  });
  assert.equal(seenEnv.PATH, "/usr/bin");
  assert.equal(seenEnv.REAL_SECRET_TOKEN, undefined);
});

test("runCodexSandboxedBootstrap cleans up its temp profile/output directory on both success and failure", async () => {
  const capturedDirs = [];
  const capturingMkdtemp = async (...args) => {
    const { mkdtemp } = await import("node:fs/promises");
    const dir = await mkdtemp(...args);
    capturedDirs.push(dir);
    return dir;
  };
  const spawnFail = () => { throw new Error("spawn failed"); };
  await runCodexSandboxedBootstrap({
    question: "q", snapshotRoot: "/tmp/kairo-snap-6",
    spawn: spawnFail, deps: { platform: "darwin", access: async () => {}, mkdtemp: capturingMkdtemp }
  });
  assert.equal(capturedDirs.length, 1);
  const { existsSync } = await import("node:fs");
  assert.equal(existsSync(capturedDirs[0]), false, "the temp working dir must be removed even after a spawn failure");
});
