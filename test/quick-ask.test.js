import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { writeFile } from "node:fs/promises";
import { askProvider } from "../src/global/intelligence/quick-ask.js";

function fakeClaudeSpawn({ result, malformed = false }) {
  return (_cmd, _args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = () => {};
    setTimeout(() => {
      child.stdout.emit("data", malformed ? "not-json" : JSON.stringify({ result }));
      child.emit("close", 0);
    }, 0);
    return child;
  };
}

test("claude: returns the real answer text from a successful -p call", async () => {
  const seenArgs = [];
  const answer = await askProvider({
    provider: "claude", question: "What is 2+2?", model: "claude-opus-5", cwd: "/repo",
    spawn: (cmd, args) => { seenArgs.push([cmd, args]); return fakeClaudeSpawn({ result: "4." })(); }
  });
  assert.equal(answer.status, "answered");
  assert.equal(answer.answer, "4.");
  assert.deepEqual(seenArgs[0], ["claude", ["-p", "What is 2+2?", "--output-format", "json", "--restricted", "--strict-mcp-config", "--model", "claude-opus-5"]]);
});

test("claude and codex both spawn with a real SCRUBBED env, never Kairo's own unfiltered process.env — a real secret (e.g. a provider API key) must never reach the child process", async () => {
  let seenEnv;
  await askProvider({
    provider: "claude", question: "q", cwd: "/repo",
    sourceEnv: { PATH: "/usr/bin", REAL_SECRET_TOKEN: "sk-should-never-leak", HOME: "/home/kal-el" },
    spawn: (cmd, args, options) => { seenEnv = options.env; return fakeClaudeSpawn({ result: "ok" })(); }
  });
  assert.equal(seenEnv.PATH, "/usr/bin");
  assert.equal(seenEnv.REAL_SECRET_TOKEN, undefined, "an unrelated real secret in Kairo's own env must never reach the spawned child");

  let seenCodexEnv;
  const spawn = (cmd, args, options) => {
    seenCodexEnv = options.env;
    const outFileIndex = args.indexOf("-o") + 1;
    const outFile = args[outFileIndex];
    const child = new EventEmitter();
    child.kill = () => {};
    setTimeout(async () => { await writeFile(outFile, "ok\n", "utf8"); child.emit("close", 0); }, 0);
    return child;
  };
  await askProvider({
    provider: "codex", question: "q", cwd: "/repo",
    sourceEnv: { PATH: "/usr/bin", REAL_SECRET_TOKEN: "sk-should-never-leak" },
    spawn
  });
  assert.equal(seenCodexEnv.REAL_SECRET_TOKEN, undefined);
});

test("claude: fails closed to error on malformed JSON or a missing result field", async () => {
  const malformed = await askProvider({
    provider: "claude", question: "q", cwd: "/repo", spawn: fakeClaudeSpawn({ malformed: true })
  });
  assert.equal(malformed.status, "error");

  const noResult = await askProvider({
    provider: "claude", question: "q", cwd: "/repo",
    spawn: () => fakeClaudeSpawn({ result: undefined })()
  });
  assert.equal(noResult.status, "error");
});

test("codex: reads the real answer from --output-last-message, never combining --sandbox with --approve-for-me", async () => {
  const seenArgs = [];
  const spawn = (cmd, args) => {
    seenArgs.push([cmd, args]);
    const outFileIndex = args.indexOf("-o") + 1;
    const outFile = args[outFileIndex];
    const child = new EventEmitter();
    child.kill = () => {};
    setTimeout(async () => {
      await writeFile(outFile, "4.\n", "utf8");
      child.emit("close", 0);
    }, 0);
    return child;
  };
  const answer = await askProvider({ provider: "codex", question: "What is 2+2?", cwd: "/repo", spawn });
  assert.equal(answer.status, "answered");
  assert.equal(answer.answer, "4.");
  const args = seenArgs[0][1];
  assert.ok(args.includes("--sandbox"));
  assert.ok(args.includes("read-only"));
  assert.ok(args.includes("--skip-git-repo-check"), "cwd may be a sanitized snapshot directory (deliberately not a real git repo)");
  assert.equal(args.includes("--approve-for-me"), false);
});

test("REGRESSION: codex's timeout resets on real output, so a genuinely slow-but-alive call isn't killed just for taking a while", async () => {
  const spawn = (_cmd, args) => {
    const outFileIndex = args.indexOf("-o") + 1;
    const outFile = args[outFileIndex];
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = () => {};
    // A real chunk arrives BEFORE the original timeoutMs elapses, then the
    // real answer arrives well AFTER it — an absolute deadline would have
    // killed this; an idle-reset one must not, since real output kept
    // arriving.
    // Generous margins: under full-suite load, timer callbacks can slip by
    // several ms, and a tight margin here made this test genuinely flaky —
    // this only needs to prove the reset happens, not measure exact timing.
    setTimeout(() => child.stdout.emit("data", "thinking...\n"), 60);
    setTimeout(async () => {
      await writeFile(outFile, "still alive.\n", "utf8");
      child.emit("close", 0);
    }, 120);
    return child;
  };
  const answer = await askProvider({ provider: "codex", question: "q", cwd: "/repo", timeoutMs: 80, spawn });
  assert.equal(answer.status, "answered");
  assert.equal(answer.answer, "still alive.");
});

test("REGRESSION: codex's timeout still fires when NOTHING real is ever produced", async () => {
  const spawn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = () => {};
    // Never emits data, never closes — a real hang.
    return child;
  };
  const answer = await askProvider({ provider: "codex", question: "q", cwd: "/repo", timeoutMs: 5, spawn });
  assert.equal(answer.status, "error");
  assert.match(answer.error, /idle-timed out/);
});

test("codex: fails closed to error when the output file is never written", async () => {
  const spawn = () => {
    const child = new EventEmitter();
    child.kill = () => {};
    setTimeout(() => child.emit("close", 0), 0);
    return child;
  };
  const answer = await askProvider({ provider: "codex", question: "q", cwd: "/repo", spawn });
  assert.equal(answer.status, "error");
});

test("an unsupported provider yields an honest 'unsupported' result, never a guess", async () => {
  const result = await askProvider({ provider: "opencode-go", question: "q", cwd: "/repo" });
  assert.equal(result.status, "unsupported");
  assert.match(result.error, /not supported/);
});

test("fails closed to error on a spawn failure or timeout, for both providers", async () => {
  const spawnError = await askProvider({
    provider: "claude", question: "q", cwd: "/repo",
    spawn: () => { throw new Error("claude: command not found"); }
  });
  assert.equal(spawnError.status, "error");

  const timeout = await askProvider({
    provider: "claude", question: "q", cwd: "/repo", timeoutMs: 5,
    spawn: () => { const c = new EventEmitter(); c.stdout = new EventEmitter(); c.kill = () => {}; return c; }
  });
  assert.equal(timeout.status, "error");
  assert.match(timeout.error, /timed out/);
});
