import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  isCursorSandboxSupported, getCursorIsolationStatus, buildCursorSandboxProfile, runCursorSandboxedBootstrap
} from "../src/global/conversation/cursor-sandbox.js";

test("isCursorSandboxSupported is false outright on a non-macOS platform, never probed further", async () => {
  const supported = await isCursorSandboxSupported({ platform: "linux", access: async () => { throw new Error("must not be called"); } });
  assert.equal(supported, false);
});

test("isCursorSandboxSupported is true only when sandbox-exec is actually executable on darwin", async () => {
  const supportedTrue = await isCursorSandboxSupported({ platform: "darwin", access: async () => {} });
  assert.equal(supportedTrue, true);
  const supportedFalse = await isCursorSandboxSupported({ platform: "darwin", access: async () => { throw new Error("ENOENT"); } });
  assert.equal(supportedFalse, false);
});

test("getCursorIsolationStatus reports a real, checkable reason on an unsupported platform — never a bare false", async () => {
  const status = await getCursorIsolationStatus({ platform: "linux" });
  assert.equal(status.available, false);
  assert.equal(status.boundaryVerified, false);
  assert.match(status.reason, /macOS/);
});

test("buildCursorSandboxProfile denies by default and scopes reads/writes to the snapshot root, cursorHome, the ~/.local binary tree, and Keychains", async () => {
  const profile = await buildCursorSandboxProfile(
    {
      snapshotRoot: "/tmp/kairo-cursor-snap-1", cursorHome: "/Users/kal-el/.cursor",
      cursorLocalHome: "/Users/kal-el/.local", keychainsHome: "/Users/kal-el/Library/Keychains"
    },
    { realpath: async (p) => p }
  );
  assert.match(profile, /\(deny default\)/);
  assert.match(profile, /\(subpath "\/tmp\/kairo-cursor-snap-1"\)/);
  assert.match(profile, /\(subpath "\/Users\/kal-el\/\.cursor"\)/);
  assert.match(profile, /\(subpath "\/Users\/kal-el\/\.local"\)/);
  assert.match(profile, /\(subpath "\/Users\/kal-el\/Library\/Keychains"\)/);
  assert.match(profile, /\(allow network\*\)/);

  const writeBlock = profile.split("(allow file-write*")[1];
  assert.match(writeBlock, /\(literal "\/dev\/null"\)/, "cursor-agent's wrapper script writes to /dev/null — must be explicitly allowed");
  assert.match(writeBlock, /\(subpath "\/Users\/kal-el\/Library\/Keychains"\)/, "Keychains must ALSO be writable, not just readable");
});

test("runCursorSandboxedBootstrap fails closed with isolation_unavailable on an unsupported platform — never a silent fallback", async () => {
  const result = await runCursorSandboxedBootstrap({
    question: "q", snapshotRoot: "/tmp/x", deps: { platform: "linux" }
  });
  assert.equal(result.status, "error");
  assert.equal(result.error, "isolation_unavailable");
});

test("runCursorSandboxedBootstrap wraps cursor-agent in sandbox-exec with its own sandbox disabled and --trust, and returns the real answer", async () => {
  const seenArgs = [];
  const spawn = (cmd, args) => {
    seenArgs.push([cmd, args]);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = () => {};
    setTimeout(() => {
      child.stdout.emit("data", JSON.stringify({ result: "Real answer." }));
      child.emit("close", 0);
    }, 0);
    return child;
  };
  const result = await runCursorSandboxedBootstrap({
    question: "Investigate this project.", model: "gpt-6", snapshotRoot: "/tmp/kairo-cursor-snap-2",
    spawn, deps: { platform: "darwin", access: async () => {}, realpath: async (p) => p }
  });
  assert.equal(result.status, "answered");
  assert.equal(result.answer, "Real answer.");

  const [cmd, args] = seenArgs[0];
  assert.equal(cmd, "sandbox-exec");
  assert.ok(args.includes("cursor-agent"));
  assert.ok(args.includes("--sandbox"));
  assert.ok(args.includes("disabled"), "Cursor's own internal sandbox must be off so it never conflicts with the external sandbox-exec wrapper");
  assert.ok(args.includes("--trust"), "the snapshot root is always a fresh Kairo-generated temp dir cursor-agent has never trusted before");
  assert.ok(args.includes("--model"));
  assert.ok(args.includes("gpt-6"));
});

test("runCursorSandboxedBootstrap omits --model for Cursor Auto (model: null)", async () => {
  const seenArgs = [];
  const spawn = (cmd, args) => {
    seenArgs.push([cmd, args]);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = () => {};
    setTimeout(() => { child.stdout.emit("data", JSON.stringify({ result: "ok" })); child.emit("close", 0); }, 0);
    return child;
  };
  await runCursorSandboxedBootstrap({
    question: "q", model: null, snapshotRoot: "/tmp/kairo-cursor-snap-3",
    spawn, deps: { platform: "darwin", access: async () => {} }
  });
  assert.equal(seenArgs[0][1].includes("--model"), false);
});

test("runCursorSandboxedBootstrap fails closed to error when stdout is not valid JSON", async () => {
  const spawn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = () => {};
    setTimeout(() => { child.stdout.emit("data", "not json"); child.emit("close", 0); }, 0);
    return child;
  };
  const result = await runCursorSandboxedBootstrap({
    question: "q", snapshotRoot: "/tmp/kairo-cursor-snap-4",
    spawn, deps: { platform: "darwin", access: async () => {} }
  });
  assert.equal(result.status, "error");
});

test("runCursorSandboxedBootstrap scrubs the child's env — a real secret in Kairo's own process env must never reach it", async () => {
  let seenEnv;
  const spawn = (cmd, args, options) => {
    seenEnv = options.env;
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = () => {};
    setTimeout(() => { child.stdout.emit("data", JSON.stringify({ result: "ok" })); child.emit("close", 0); }, 0);
    return child;
  };
  await runCursorSandboxedBootstrap({
    question: "q", snapshotRoot: "/tmp/kairo-cursor-snap-5",
    sourceEnv: { PATH: "/usr/bin", REAL_SECRET_TOKEN: "sk-should-never-leak" },
    spawn, deps: { platform: "darwin", access: async () => {} }
  });
  assert.equal(seenEnv.PATH, "/usr/bin");
  assert.equal(seenEnv.REAL_SECRET_TOKEN, undefined);
});

test("runCursorSandboxedBootstrap cleans up its temp profile directory on both success and failure", async () => {
  const capturedDirs = [];
  const capturingMkdtemp = async (...args) => {
    const { mkdtemp } = await import("node:fs/promises");
    const dir = await mkdtemp(...args);
    capturedDirs.push(dir);
    return dir;
  };
  const spawnFail = () => { throw new Error("spawn failed"); };
  await runCursorSandboxedBootstrap({
    question: "q", snapshotRoot: "/tmp/kairo-cursor-snap-6",
    spawn: spawnFail, deps: { platform: "darwin", access: async () => {}, mkdtemp: capturingMkdtemp }
  });
  assert.equal(capturedDirs.length, 1);
  const { existsSync } = await import("node:fs");
  assert.equal(existsSync(capturedDirs[0]), false, "the temp working dir must be removed even after a spawn failure");
});
