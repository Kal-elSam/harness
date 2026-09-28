import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
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

// ---------------------------------------------------------------------------
// Abort signal + provider events (A1). Everything below uses injected fake
// spawn/children and an injected process killer — no real provider, no real
// process signals.
// ---------------------------------------------------------------------------

function groupChild(pid = 4242) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.directKills = [];
  child.kill = (sig) => { child.directKills.push(sig); };
  return child;
}

function stubSpawn(child, seen = []) {
  return (cmd, args, options) => { seen.push({ cmd, args, options }); return child; };
}

const ADAPTERS = [
  { provider: "claude", cmd: "claude", model: "m", ensure: false },
  { provider: "cursor", cmd: "cursor-agent", model: "m", ensure: false },
  { provider: "opencode-go", cmd: "opencode", model: "m", ensure: true },
  { provider: "codex", cmd: "codex", model: "m", ensure: false }
];

test("PARITY: with no signal and no onEvent every adapter spawns with the exact legacy options (no detached) and the same args as before", async () => {
  for (const a of ADAPTERS) {
    const seen = [];
    const child = groupChild();
    const spawn = (cmd, args, options) => {
      seen.push({ cmd, args, options });
      setTimeout(async () => {
        if (a.provider === "codex") await writeFile(args[args.indexOf("-o") + 1], "ok", "utf8");
        if (a.provider === "claude" || a.provider === "cursor") child.stdout.emit("data", JSON.stringify({ result: "ok" }));
        if (a.provider === "opencode-go") child.stdout.emit("data", JSON.stringify({ type: "text", part: { text: "ok" } }) + "\n");
        child.emit("close", 0);
      }, 0);
      return child;
    };
    const res = await askProvider({
      provider: a.provider, question: "q", model: a.model, cwd: "/repo", spawn,
      sourceEnv: { PATH: "/usr/bin" }, ensureOpencodeAskAgent: async () => {}
    });
    assert.equal(res.status, "answered", a.provider);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].cmd, a.cmd);
    assert.deepEqual(Object.keys(seen[0].options).sort(), ["cwd", "env", "stdio"], `${a.provider}: no extra spawn options`);
    assert.deepEqual(seen[0].options.stdio, ["ignore", "pipe", "pipe"]);
    assert.equal(seen[0].args.includes("--json") && a.provider === "codex", false, "codex: --json only when onEvent is set");
    assert.equal(seen[0].args.includes("--approve-for-me"), false);
    assert.deepEqual(child.directKills, [undefined], "legacy finish() still does exactly one argument-less child.kill()");
  }
});

test("abort BEFORE spawn: resolves cancelled and never spawns, for every adapter", async () => {
  for (const a of ADAPTERS) {
    let spawned = false;
    const ac = new AbortController();
    ac.abort();
    const res = await askProvider({
      provider: a.provider, question: "q", cwd: "/repo", signal: ac.signal,
      spawn: () => { spawned = true; return groupChild(); }, ensureOpencodeAskAgent: async () => {}
    });
    assert.deepEqual(res, { status: "cancelled", answer: null, error: null }, a.provider);
    assert.equal(spawned, false, a.provider);
  }
});

test("a signal makes the child a process-group leader (detached: true); everything else stays identical", async () => {
  for (const a of ADAPTERS) {
    const seen = [];
    const child = groupChild();
    const ac = new AbortController();
    const kills = [];
    const pending = askProvider({
      provider: a.provider, question: "q", cwd: "/repo", signal: ac.signal, spawn: stubSpawn(child, seen),
      ensureOpencodeAskAgent: async () => {},
      killProcess: (pid, sig) => { kills.push([pid, sig]); setImmediate(() => child.emit("close", null)); }
    });
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(seen[0].options.detached, true, a.provider);
    assert.deepEqual(seen[0].options.stdio, ["ignore", "pipe", "pipe"]);
    ac.abort();
    const res = await pending;
    assert.equal(res.status, "cancelled", a.provider);
  }
});

test("abort mid-run: SIGTERM goes to the process GROUP (-pid); cancelled resolves only after the child closed", async () => {
  const child = groupChild(777);
  const ac = new AbortController();
  const kills = [];
  let closed = false;
  const pending = askProvider({
    provider: "claude", question: "q", cwd: "/repo", signal: ac.signal, spawn: stubSpawn(child),
    killProcess: (pid, sig) => { kills.push([pid, sig]); }
  });
  let settled = false;
  pending.then(() => { settled = true; });
  await new Promise((r) => setTimeout(r, 5));
  ac.abort();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(kills, [[-777, "SIGTERM"]]);
  assert.equal(settled, false, "must not resolve before the child has closed");
  closed = true;
  child.emit("close", null);
  const res = await pending;
  assert.equal(closed, true);
  assert.deepEqual(res, { status: "cancelled", answer: null, error: null });
  assert.deepEqual(kills, [[-777, "SIGTERM"]], "no SIGKILL when the child exits within the grace period");
});

test("abort: a child that ignores SIGTERM is SIGKILLed after killGraceMs, then cancelled resolves", async () => {
  const child = groupChild(900);
  const ac = new AbortController();
  const kills = [];
  const pending = askProvider({
    provider: "cursor", question: "q", cwd: "/repo", signal: ac.signal, killGraceMs: 20, spawn: stubSpawn(child),
    killProcess: (pid, sig) => { kills.push([pid, sig]); } // never closes the child
  });
  await new Promise((r) => setTimeout(r, 5));
  ac.abort();
  const res = await pending;
  assert.equal(res.status, "cancelled");
  assert.deepEqual(kills, [[-900, "SIGTERM"], [-900, "SIGKILL"]]);
});

test("group kill failure falls back to the direct child kill", async () => {
  const child = groupChild(901);
  const ac = new AbortController();
  const pending = askProvider({
    provider: "claude", question: "q", cwd: "/repo", signal: ac.signal, killGraceMs: 10, spawn: stubSpawn(child),
    killProcess: () => { throw Object.assign(new Error("ESRCH"), { code: "ESRCH" }); }
  });
  await new Promise((r) => setTimeout(r, 5));
  ac.abort();
  const res = await pending;
  assert.equal(res.status, "cancelled");
  assert.deepEqual(child.directKills, ["SIGTERM", "SIGKILL"]);
});

test("a cancelled turn is never returned as answered even if the child already wrote a valid answer while dying", async () => {
  const child = groupChild(902);
  const ac = new AbortController();
  const pending = askProvider({
    provider: "claude", question: "q", cwd: "/repo", signal: ac.signal, spawn: stubSpawn(child),
    killProcess: () => {
      child.stdout.emit("data", JSON.stringify({ result: "late answer" }));
      setImmediate(() => child.emit("close", 0));
    }
  });
  await new Promise((r) => setTimeout(r, 5));
  ac.abort();
  const res = await pending;
  assert.equal(res.status, "cancelled");
  assert.equal(res.answer, null);
});

test("finish is idempotent: a normal close then a late abort does not kill or double-resolve", async () => {
  const child = groupChild(903);
  const ac = new AbortController();
  const kills = [];
  const pending = askProvider({
    provider: "claude", question: "q", cwd: "/repo", signal: ac.signal, spawn: stubSpawn(child),
    killProcess: (pid, sig) => { kills.push([pid, sig]); }
  });
  await new Promise((r) => setTimeout(r, 5));
  child.stdout.emit("data", JSON.stringify({ result: "done" }));
  child.emit("close", 0);
  const res = await pending;
  assert.equal(res.status, "answered");
  ac.abort();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(kills, [], "an already-exited child is never signalled");
  assert.deepEqual(child.directKills, []);
});

test("idle timeout is unchanged when a signal is present but never aborted", async () => {
  const child = groupChild(904);
  const ac = new AbortController();
  const res = await askProvider({
    provider: "claude", question: "q", cwd: "/repo", timeoutMs: 5, signal: ac.signal, spawn: stubSpawn(child),
    killProcess: () => {}
  });
  assert.equal(res.status, "error");
  assert.match(res.error, /idle-timed out/);
});

test("codex: --json is added only when onEvent is set; -o stays; sandbox stays read-only", async () => {
  const seen = [];
  const mk = () => (cmd, args) => {
    seen.push(args);
    const child = groupChild();
    setTimeout(async () => { await writeFile(args[args.indexOf("-o") + 1], "a", "utf8"); child.emit("close", 0); }, 0);
    return child;
  };
  await askProvider({ provider: "codex", question: "q", cwd: "/repo", spawn: mk() });
  await askProvider({ provider: "codex", question: "q", cwd: "/repo", spawn: mk(), onEvent: () => {} });
  assert.equal(seen[0].includes("--json"), false);
  assert.equal(seen[1].includes("--json"), true);
  assert.ok(seen[1].includes("-o"));
  assert.equal(seen[1][seen[1].indexOf("--sandbox") + 1], "read-only");
  assert.equal(seen[1].includes("--approve-for-me"), false);
  assert.equal(seen[1][seen[1].length - 1], "q", "the question stays the last argument");
});

test("codex events: fragmented JSONL is correlated by item id, invalid lines are ignored, the final answer comes from -o exactly once", async () => {
  const events = [];
  const child = groupChild();
  let outFile;
  const spawn = (cmd, args) => { outFile = args[args.indexOf("-o") + 1]; return child; };
  const pending = askProvider({ provider: "codex", question: "q", cwd: "/repo", spawn, onEvent: (e) => events.push(e) });
  await new Promise((r) => setTimeout(r, 15));
  const start = JSON.stringify({ type: "item.started", item: { id: "item_1", type: "command_execution", command: "ls -la", status: "in_progress" } });
  child.stdout.emit("data", start.slice(0, 20));
  assert.deepEqual(events, [], "a partial line emits nothing yet");
  child.stdout.emit("data", start.slice(20) + "\nthis is not json\n");
  child.stdout.emit("data", JSON.stringify({ type: "item.completed", item: { id: "item_0", type: "reasoning", text: "thinking about it" } }) + "\n");
  child.stdout.emit("data", JSON.stringify({ type: "item.completed", item: { id: "item_1", type: "command_execution", command: "ls -la", exit_code: 0, status: "completed" } }) + "\n");
  child.stdout.emit("data", JSON.stringify({ type: "item.completed", item: { id: "item_2", type: "agent_message", text: "the answer" } }) + "\n");
  child.stdout.emit("data", JSON.stringify({ type: "mystery.event", foo: 1 }) + "\n");
  child.stdout.emit("data", '{"type":"error","message":"boom"}'); // partial trailing line, flushed at close
  await writeFile(outFile, "the answer\n", "utf8");
  child.emit("close", 0);
  const res = await pending;
  assert.deepEqual(res, { status: "answered", answer: "the answer", error: null });
  assert.deepEqual(events, [
    { kind: "tool_start", id: "item_1", name: "ls -la" },
    { kind: "progress", id: "item_0", summary: "thinking about it" },
    { kind: "tool_end", id: "item_1", name: "ls -la", ok: true },
    { kind: "error", message: "boom" },
    { kind: "final", text: "the answer" }
  ]);
  assert.equal(events.filter((e) => e.kind === "final").length, 1);
});

test("codex: a failed command maps to tool_end ok:false; a turn.failed maps to an error event", async () => {
  const events = [];
  const child = groupChild();
  let outFile;
  const pending = askProvider({
    provider: "codex", question: "q", cwd: "/repo", onEvent: (e) => events.push(e),
    spawn: (cmd, args) => { outFile = args[args.indexOf("-o") + 1]; return child; }
  });
  await new Promise((r) => setTimeout(r, 15));
  child.stdout.emit("data", JSON.stringify({ type: "item.started", item: { id: "i9", type: "command_execution", command: "false" } }) + "\n");
  child.stdout.emit("data", JSON.stringify({ type: "item.completed", item: { id: "i9", type: "command_execution", command: "false", exit_code: 1, status: "failed" } }) + "\n");
  child.stdout.emit("data", JSON.stringify({ type: "turn.failed", error: { message: "model exploded" } }) + "\n");
  child.emit("close", 1);
  const res = await pending;
  assert.equal(res.status, "error");
  assert.deepEqual(events, [
    { kind: "tool_start", id: "i9", name: "false" },
    { kind: "tool_end", id: "i9", name: "false", ok: false },
    { kind: "error", message: "model exploded" }
  ]);
  assert.ok(outFile);
});

test("cancelled codex never reads the -o file (even if it holds an answer), removes its tmp dir and emits no events after the abort", async () => {
  const events = [];
  const child = groupChild(950);
  const ac = new AbortController();
  let outFile;
  const pending = askProvider({
    provider: "codex", question: "q", cwd: "/repo", signal: ac.signal, onEvent: (e) => events.push(e),
    spawn: (cmd, args) => { outFile = args[args.indexOf("-o") + 1]; return child; },
    killProcess: () => {}
  });
  await new Promise((r) => setTimeout(r, 15));
  child.stdout.emit("data", JSON.stringify({ type: "item.started", item: { id: "a", type: "command_execution", command: "ls" } }) + "\n");
  ac.abort();
  await writeFile(outFile, "SHOULD NOT BE USED", "utf8");
  child.stdout.emit("data", JSON.stringify({ type: "item.completed", item: { id: "a", type: "command_execution", command: "ls", exit_code: 0 } }) + "\n");
  child.emit("close", null);
  const res = await pending;
  assert.deepEqual(res, { status: "cancelled", answer: null, error: null });
  assert.deepEqual(events.map((e) => e.kind), ["tool_start"], "nothing emitted after cancellation, no final");
  await assert.rejects(readFile(outFile, "utf8"), "the tmp dir is still removed");
});

test("opencode: text and error parts are emitted incrementally as chunks arrive", async () => {
  const events = [];
  const child = groupChild();
  const pending = askProvider({
    provider: "opencode-go", question: "q", cwd: "/repo", spawn: stubSpawn(child),
    ensureOpencodeAskAgent: async () => {}, onEvent: (e) => events.push(e)
  });
  await new Promise((r) => setTimeout(r, 10));
  const l1 = JSON.stringify({ type: "text", part: { text: "Hel" } });
  child.stdout.emit("data", l1.slice(0, 10));
  assert.deepEqual(events, []);
  child.stdout.emit("data", l1.slice(10) + "\n");
  assert.deepEqual(events, [{ kind: "text", text: "Hel" }], "emitted before the process closes");
  child.stdout.emit("data", JSON.stringify({ type: "text", part: { text: "lo" } }) + "\n");
  child.emit("close", 0);
  const res = await pending;
  assert.equal(res.answer, "Hello");
  assert.deepEqual(events, [{ kind: "text", text: "Hel" }, { kind: "text", text: "lo" }, { kind: "final" }]);

  const errEvents = [];
  const child2 = groupChild();
  const p2 = askProvider({
    provider: "opencode-go", question: "q", cwd: "/repo", spawn: stubSpawn(child2),
    ensureOpencodeAskAgent: async () => {}, onEvent: (e) => errEvents.push(e)
  });
  await new Promise((r) => setTimeout(r, 10));
  child2.stdout.emit("data", JSON.stringify({ type: "error", error: { data: { message: "quota" } } }) + "\n");
  child2.emit("close", 1);
  assert.equal((await p2).status, "error");
  assert.deepEqual(errEvents, [{ kind: "error", message: "quota" }]);
});

test("claude and cursor: no fake streaming — one progress marker, then the single final result", async () => {
  for (const provider of ["claude", "cursor"]) {
    const events = [];
    const child = groupChild();
    const pending = askProvider({ provider, question: "q", cwd: "/repo", spawn: stubSpawn(child), onEvent: (e) => events.push(e) });
    await new Promise((r) => setTimeout(r, 5));
    child.stdout.emit("data", JSON.stringify({ result: "ans" }));
    child.emit("close", 0);
    assert.equal((await pending).answer, "ans");
    assert.deepEqual(events.map((e) => e.kind), ["progress", "final"], provider);
    assert.equal(events[1].text, "ans");
  }
});

test("an onEvent that throws (or rejects) never breaks the run", async () => {
  for (const onEvent of [() => { throw new Error("boom"); }, async () => { throw new Error("async boom"); }]) {
    const child = groupChild();
    const pending = askProvider({
      provider: "opencode-go", question: "q", cwd: "/repo", spawn: stubSpawn(child),
      ensureOpencodeAskAgent: async () => {}, onEvent
    });
    await new Promise((r) => setTimeout(r, 10));
    child.stdout.emit("data", JSON.stringify({ type: "text", part: { text: "fine" } }) + "\n");
    child.emit("close", 0);
    assert.deepEqual(await pending, { status: "answered", answer: "fine", error: null });
  }
});
