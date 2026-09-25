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

test("cursor: uses the real read-only --mode ask, never combined with --force/--yolo, and returns the real answer text", async () => {
  const seenArgs = [];
  const spawn = (cmd, args) => {
    seenArgs.push([cmd, args]);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setTimeout(() => {
      child.stdout.emit("data", JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "cuatro" }));
      child.emit("close", 0);
    }, 0);
    return child;
  };
  const answer = await askProvider({ provider: "cursor", question: "What is 2+2?", model: "gpt-6-astra", cwd: "/repo", spawn });
  assert.equal(answer.status, "answered");
  assert.equal(answer.answer, "cuatro");
  assert.deepEqual(seenArgs[0], ["cursor-agent", ["-p", "What is 2+2?", "--mode", "ask", "--output-format", "json", "--model", "gpt-6-astra"]]);
  assert.equal(seenArgs[0][1].includes("--force"), false);
  assert.equal(seenArgs[0][1].includes("--yolo"), false);
});

test("REGRESSION: cursor's real invalid-model failure (plain stderr text, non-zero exit, no JSON at all) is reported honestly, never as a generic malformed-JSON guess", async () => {
  const spawn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setTimeout(() => {
      child.stderr.emit("data", "Cannot use this model: not-a-real-model. Available models: ...");
      child.emit("close", 1);
    }, 0);
    return child;
  };
  const answer = await askProvider({ provider: "cursor", question: "q", model: "not-a-real-model", cwd: "/repo", spawn });
  assert.equal(answer.status, "error");
  assert.match(answer.error, /Cannot use this model/);
});

test("claude, codex, and cursor all spawn with a real SCRUBBED env, never Kairo's own unfiltered process.env — a real secret (e.g. a provider API key) must never reach the child process", async () => {
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

  let seenCursorEnv;
  const cursorSpawn = (cmd, args, options) => {
    seenCursorEnv = options.env;
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setTimeout(() => {
      child.stdout.emit("data", JSON.stringify({ result: "ok", is_error: false }));
      child.emit("close", 0);
    }, 0);
    return child;
  };
  await askProvider({
    provider: "cursor", question: "q", cwd: "/repo",
    sourceEnv: { PATH: "/usr/bin", REAL_SECRET_TOKEN: "sk-should-never-leak" },
    spawn: cursorSpawn
  });
  assert.equal(seenCursorEnv.REAL_SECRET_TOKEN, undefined);
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

test("REGRESSION: codex's timeout resets on real output, so a genuinely slow-but-alive call isn't killed just for taking a while", async (t) => {
  // Mocked setTimeout makes this deterministic: real timers slipped under
  // full-suite load and made the old 20ms-margin version flaky. File I/O
  // (mkdtemp/writeFile/readFile) is not a timer, so it stays real.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let child;
  let outFile;
  let markSpawned;
  const spawned = new Promise((resolve) => { markSpawned = resolve; });
  const spawn = (_cmd, args) => {
    outFile = args[args.indexOf("-o") + 1];
    child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = () => {};
    markSpawned();
    return child;
  };
  const pending = askProvider({ provider: "codex", question: "q", cwd: "/repo", timeoutMs: 80, spawn });
  await spawned;

  t.mock.timers.tick(60); // before the original 80ms deadline
  child.stdout.emit("data", "thinking...\n"); // real output: deadline moves to 140ms
  t.mock.timers.tick(60); // 120ms: past the original deadline, before the reset one
  await writeFile(outFile, "still alive.\n", "utf8");
  child.emit("close", 0);

  const answer = await pending;
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

test("REGRESSION: codex's real stderr surfaces when it fails without writing its output file — never a bare ENOENT that hides why it actually failed", async () => {
  const spawn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setTimeout(() => {
      child.stderr.emit("data", "Error: rate limit exceeded, retry after 60s\n");
      child.emit("close", 1);
    }, 0);
    return child;
  };
  const answer = await askProvider({ provider: "codex", question: "q", cwd: "/repo", spawn });
  assert.equal(answer.status, "error");
  assert.match(answer.error, /rate limit exceeded/, "the real codex failure reason must surface — a raw ENOENT about the missing output file explains nothing to the user");
});

function fakeOpencodeSpawn(ndjsonLines) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setTimeout(() => {
      child.stdout.emit("data", ndjsonLines.map((line) => JSON.stringify(line)).join("\n") + "\n");
      child.emit("close", 0);
    }, 0);
    return child;
  };
}

test("opencode-go: ensures the real read-only agent first, then runs --agent kairo-ask with the real fully-qualified model ref, accumulating real text events into the answer", async () => {
  const ensureCalls = [];
  const seenArgs = [];
  const answer = await askProvider({
    provider: "opencode-go", question: "What is this project about?", model: "kimi-k3", cwd: "/repo",
    ensureOpencodeAskAgent: async () => { ensureCalls.push(true); },
    spawn: (cmd, args) => {
      seenArgs.push([cmd, args]);
      return fakeOpencodeSpawn([
        { type: "step_start" },
        { type: "text", part: { type: "text", text: "It orchestrates " } },
        { type: "text", part: { type: "text", text: "Codex/Claude/OpenCode." } },
        { type: "step_finish" }
      ])();
    }
  });
  assert.equal(ensureCalls.length, 1, "the real read-only agent must be ensured before every real opencode call");
  assert.equal(answer.status, "answered");
  assert.equal(answer.answer, "It orchestrates Codex/Claude/OpenCode.");
  assert.deepEqual(seenArgs[0], ["opencode", ["run", "--agent", "kairo-ask", "--format", "json", "--model", "opencode-go/kimi-k3", "What is this project about?"]]);
});

test("opencode-zen: the real fully-qualified model ref uses the 'opencode/' prefix, never 'opencode-go/'", async () => {
  const seenArgs = [];
  await askProvider({
    provider: "opencode-zen", question: "q", model: "kimi-k3", cwd: "/repo",
    ensureOpencodeAskAgent: async () => {},
    spawn: (cmd, args) => { seenArgs.push([cmd, args]); return fakeOpencodeSpawn([{ type: "text", part: { type: "text", text: "ok" } }])(); }
  });
  assert.ok(seenArgs[0][1].includes("opencode/kimi-k3"));
  assert.equal(seenArgs[0][1].includes("opencode-go/kimi-k3"), false);
});

test("REGRESSION: a real opencode error event is reported honestly, never silently dropped in favor of whatever partial text arrived first", async () => {
  const answer = await askProvider({
    provider: "opencode-go", question: "q", model: "kimi-k3", cwd: "/repo",
    ensureOpencodeAskAgent: async () => {},
    spawn: () => fakeOpencodeSpawn([
      { type: "error", error: { name: "APIError", data: { message: "Upstream request failed: quota exceeded" } } }
    ])()
  });
  assert.equal(answer.status, "error");
  assert.match(answer.error, /quota exceeded/);
});

test("REGRESSION: if ensuring the real read-only agent itself fails, opencode is never spawned at all", async () => {
  let spawnCalled = false;
  const answer = await askProvider({
    provider: "opencode-go", question: "q", model: "kimi-k3", cwd: "/repo",
    ensureOpencodeAskAgent: async () => { throw new Error("disk full"); },
    spawn: () => { spawnCalled = true; return fakeOpencodeSpawn([{ type: "text", part: { type: "text", text: "ok" } }])(); }
  });
  assert.equal(answer.status, "error");
  assert.match(answer.error, /disk full/);
  assert.equal(spawnCalled, false, "never spawn a real opencode process if Kairo can't first guarantee it's read-only");
});

test("an unsupported provider yields an honest 'unsupported' result, never a guess", async () => {
  const result = await askProvider({ provider: "some-future-provider", question: "q", cwd: "/repo" });
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
