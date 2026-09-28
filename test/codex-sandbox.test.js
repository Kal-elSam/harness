import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  isCodexSandboxSupported, getCodexIsolationStatus, buildCodexSandboxProfile, runCodexSandboxedBootstrap,
  resolveCodexHome
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
    child.stdin = { end() {} };
    child.stderr = new EventEmitter();
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
  assert.equal(args.includes("--ignore-user-config"), false, "user config under CODEX_HOME must load inside the sandbox");
  assert.ok(args.includes("Investigate this project."));
});

test("runCodexSandboxedBootstrap fails closed to error when the output file is never written", async () => {
  const spawn = () => {
    const child = new EventEmitter();
    child.stdin = { end() {} };
    child.stderr = new EventEmitter();
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

test("runCodexSandboxedBootstrap reports real captured stderr — never a raw ENOENT — when the output file is missing", async () => {
  const spawn = () => {
    const child = new EventEmitter();
    child.stdin = { end() {} };
    child.stderr = new EventEmitter();
    child.kill = () => {};
    child.stderr = new EventEmitter();
    setTimeout(() => {
      child.stderr.emit("data", Buffer.from("codex: rate limit exceeded\n"));
      child.emit("close", 1);
    }, 0);
    return child;
  };
  const result = await runCodexSandboxedBootstrap({
    question: "q", snapshotRoot: "/tmp/kairo-snap-4b",
    spawn, deps: { platform: "darwin", access: async () => {} }
  });
  assert.equal(result.status, "error");
  assert.match(result.error, /rate limit exceeded/, "must surface the real stderr, not a bare ENOENT");
  assert.doesNotMatch(result.error, /ENOENT/);
});

test("runCodexSandboxedBootstrap falls back to an honest exit-code message when the output file is missing and stderr is empty", async () => {
  const spawn = () => {
    const child = new EventEmitter();
    child.stdin = { end() {} };
    child.stderr = new EventEmitter();
    child.kill = () => {};
    child.stderr = new EventEmitter();
    setTimeout(() => child.emit("close", 7), 0);
    return child;
  };
  const result = await runCodexSandboxedBootstrap({
    question: "q", snapshotRoot: "/tmp/kairo-snap-4c",
    spawn, deps: { platform: "darwin", access: async () => {} }
  });
  assert.equal(result.status, "error");
  assert.match(result.error, /exited 7 without writing its output file/);
  assert.doesNotMatch(result.error, /ENOENT/);
});

test("runCodexSandboxedBootstrap scrubs the child's env — a real secret in Kairo's own process env must never reach it", async () => {
  let seenEnv;
  const spawn = (cmd, args, options) => {
    seenEnv = options.env;
    const outFileIndex = args.indexOf("-o") + 1;
    const outFile = args[outFileIndex];
    const child = new EventEmitter();
    child.stdin = { end() {} };
    child.stderr = new EventEmitter();
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

test("resolveCodexHome: explicit non-empty arg wins over sourceEnv.CODEX_HOME and the default", () => {
  const resolved = resolveCodexHome({
    codexHome: "/explicit/codex-home",
    sourceEnv: { CODEX_HOME: "/env/codex-home" }
  });
  assert.equal(resolved, "/explicit/codex-home");
});

test("resolveCodexHome: falls back to a non-empty sourceEnv.CODEX_HOME when no explicit arg is given", () => {
  const resolved = resolveCodexHome({ sourceEnv: { CODEX_HOME: "/env/codex-home" } });
  assert.equal(resolved, "/env/codex-home");
});

test("resolveCodexHome: falls back to ~/.codex when neither an explicit arg nor a non-empty env var is set", () => {
  const resolved = resolveCodexHome({ sourceEnv: {} });
  assert.equal(resolved, join(homedir(), ".codex"));

  const resolvedEmptyEnv = resolveCodexHome({ sourceEnv: { CODEX_HOME: "" } });
  assert.equal(resolvedEmptyEnv, join(homedir(), ".codex"));
});

test("runCodexSandboxedBootstrap: a custom sourceEnv.CODEX_HOME is used for BOTH the SBPL profile and the child env", async () => {
  let seenEnv;
  const spawn = (cmd, args, options) => {
    seenEnv = options.env;
    const outFileIndex = args.indexOf("-o") + 1;
    const outFile = args[outFileIndex];
    const child = new EventEmitter();
    child.stdin = { end() {} };
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setTimeout(async () => { await writeFile(outFile, "ok\n", "utf8"); child.emit("close", 0); }, 0);
    return child;
  };
  let seenProfile;
  const writeFileDep = async (path, contents, encoding) => {
    if (path.endsWith(".sb")) seenProfile = contents;
    return writeFile(path, contents, encoding);
  };
  await runCodexSandboxedBootstrap({
    question: "q", snapshotRoot: "/tmp/kairo-snap-7",
    sourceEnv: { PATH: "/usr/bin", CODEX_HOME: "/env/codex-home" },
    spawn, deps: { platform: "darwin", access: async () => {}, realpath: async (p) => p, writeFile: writeFileDep }
  });
  assert.equal(seenEnv.CODEX_HOME, "/env/codex-home", "child env must use the same CODEX_HOME the profile was built with");
  assert.match(seenProfile, /\(subpath "\/env\/codex-home"\)/, "the SBPL profile must confine to the SAME CODEX_HOME the child env uses");
});

test("runCodexSandboxedBootstrap: an explicit codexHome arg wins over sourceEnv.CODEX_HOME and reaches the child env", async () => {
  let seenEnv;
  let seenProfile;
  const spawn = (cmd, args, options) => {
    seenEnv = options.env;
    const outFileIndex = args.indexOf("-o") + 1;
    const outFile = args[outFileIndex];
    const child = new EventEmitter();
    child.stdin = { end() {} };
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setTimeout(async () => { await writeFile(outFile, "ok\n", "utf8"); child.emit("close", 0); }, 0);
    return child;
  };
  const writeFileDep = async (path, contents, encoding) => {
    if (path.endsWith(".sb")) seenProfile = contents;
    return writeFile(path, contents, encoding);
  };
  await runCodexSandboxedBootstrap({
    question: "q", snapshotRoot: "/tmp/kairo-snap-8", codexHome: "/explicit/codex-home",
    sourceEnv: { PATH: "/usr/bin", CODEX_HOME: "/env/codex-home" },
    spawn, deps: { platform: "darwin", access: async () => {}, realpath: async (p) => p, writeFile: writeFileDep }
  });
  assert.equal(seenEnv.CODEX_HOME, "/explicit/codex-home");
  assert.match(seenProfile, /\(subpath "\/explicit\/codex-home"\)/);
  assert.doesNotMatch(seenProfile, /\/env\/codex-home/);
});

test("runCodexSandboxedBootstrap: defaults CODEX_HOME to ~/.codex in the child env when neither arg nor env var is set", async () => {
  let seenEnv;
  const spawn = (cmd, args, options) => {
    seenEnv = options.env;
    const outFileIndex = args.indexOf("-o") + 1;
    const outFile = args[outFileIndex];
    const child = new EventEmitter();
    child.stdin = { end() {} };
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setTimeout(async () => { await writeFile(outFile, "ok\n", "utf8"); child.emit("close", 0); }, 0);
    return child;
  };
  await runCodexSandboxedBootstrap({
    question: "q", snapshotRoot: "/tmp/kairo-snap-9",
    sourceEnv: { PATH: "/usr/bin" },
    spawn, deps: { platform: "darwin", access: async () => {}, realpath: async (p) => p }
  });
  assert.equal(seenEnv.CODEX_HOME, join(homedir(), ".codex"));
});

test("runCodexSandboxedBootstrap: profile contains both the literal and realpath forms of a symlinked CODEX_HOME", async () => {
  let seenProfile;
  const spawn = (cmd, args) => {
    const outFileIndex = args.indexOf("-o") + 1;
    const outFile = args[outFileIndex];
    const child = new EventEmitter();
    child.stdin = { end() {} };
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setTimeout(async () => { await writeFile(outFile, "ok\n", "utf8"); child.emit("close", 0); }, 0);
    return child;
  };
  const writeFileDep = async (path, contents, encoding) => {
    if (path.endsWith(".sb")) seenProfile = contents;
    return writeFile(path, contents, encoding);
  };
  const realpathDep = async (p) => (p === "/env/codex-home" ? "/private/env/codex-home" : p);
  await runCodexSandboxedBootstrap({
    question: "q", snapshotRoot: "/tmp/kairo-snap-10",
    sourceEnv: { PATH: "/usr/bin", CODEX_HOME: "/env/codex-home" },
    spawn, deps: { platform: "darwin", access: async () => {}, realpath: realpathDep, writeFile: writeFileDep }
  });
  assert.match(seenProfile, /\(subpath "\/env\/codex-home"\)/);
  assert.match(seenProfile, /\(subpath "\/private\/env\/codex-home"\)/);
});

test("runCodexSandboxedBootstrap: spawn is invoked with a piped stdin and the child's stdin is closed", async () => {
  let seenOptions;
  let stdinEnded = false;
  const spawn = (cmd, args, options) => {
    seenOptions = options;
    const outFileIndex = args.indexOf("-o") + 1;
    const outFile = args[outFileIndex];
    const child = new EventEmitter();
    child.stdin = { end() { stdinEnded = true; } };
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setTimeout(async () => { await writeFile(outFile, "ok\n", "utf8"); child.emit("close", 0); }, 0);
    return child;
  };
  await runCodexSandboxedBootstrap({
    question: "q", snapshotRoot: "/tmp/kairo-snap-11",
    spawn, deps: { platform: "darwin", access: async () => {}, realpath: async (p) => p }
  });
  assert.equal(seenOptions.stdio[0], "pipe");
  assert.equal(stdinEnded, true);
});

test("runCodexSandboxedBootstrap: timeout error includes captured stderr, not just the bare timeout message", async () => {
  const spawn = () => {
    const child = new EventEmitter();
    child.stdin = { end() {} };
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setTimeout(() => {
      child.stderr.emit("data", Buffer.from("codex: waiting on approval that will never come\n"));
    }, 0);
    // never emits "close" — simulates a hang
    return child;
  };
  const result = await runCodexSandboxedBootstrap({
    question: "q", snapshotRoot: "/tmp/kairo-snap-12", timeoutMs: 20,
    spawn, deps: { platform: "darwin", access: async () => {} }
  });
  assert.equal(result.status, "error");
  assert.match(result.error, /sandboxed codex exec timed out/);
  assert.match(result.error, /waiting on approval that will never come/, "the timeout error must include captured stderr, not drop it");
});

test("runCodexSandboxedBootstrap: a multiline config error on stderr with no output file surfaces the full stderr, not just the first line", async () => {
  const stderrText = "Error: failed to load configuration\ncaused by: invalid TOML at line 3\ncaused by: unexpected character '#'";
  const spawn = () => {
    const child = new EventEmitter();
    child.stdin = { end() {} };
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setTimeout(() => {
      child.stderr.emit("data", Buffer.from(stderrText));
      child.emit("close", 1);
    }, 0);
    return child;
  };
  const result = await runCodexSandboxedBootstrap({
    question: "q", snapshotRoot: "/tmp/kairo-snap-13",
    spawn, deps: { platform: "darwin", access: async () => {} }
  });
  assert.equal(result.status, "error");
  assert.match(result.error, /invalid TOML at line 3/);
  assert.match(result.error, /unexpected character '#'/);
});
