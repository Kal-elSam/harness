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
  assert.deepEqual(seenArgs[0], ["claude", ["-p", "What is 2+2?", "--output-format", "json", "--model", "claude-opus-5"]]);
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
  assert.equal(args.includes("--approve-for-me"), false);
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
