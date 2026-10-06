import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildClaudeLaunch } from "../src/global/runtime/execution-adapters/claude.js";
import claude from "../src/global/runtime/execution-adapters/claude.js";
import { startRun } from "../src/global/runtime/run-manager.js";
import { readRunEvents } from "../src/global/runtime/run-store.js";
import { normalizeRunResult } from "../src/global/kernel/run-result-normalizer.js";
import { SANDBOX_EXEC_PATH } from "../src/global/runtime/readonly-containment.js";

// Claude Code 2.1.292 rejects `-p --output-format stream-json` without
// `--verbose` ("When using --print, --output-format=stream-json requires --verbose").

const TASK = "Do the thing";
// "safe" is the empty permission set (the standard launch), so it is covered by "standard".
const REAL_CWD = await realpath(tmpdir());
const modes = {
  standard: [],
  force: ["force"],
  yolo: ["yolo"],
  "read-only": ["read-only"]
};

function innerArgs(launch) {
  return launch.command === SANDBOX_EXEC_PATH ? launch.args.slice(3) : launch.args;
}

for (const [name, permissions] of Object.entries(modes)) {
  for (const model of [undefined, "haiku"]) {
    test(`claude ${name} launch (${model ? "with" : "without"} --model) passes --verbose exactly once right after stream-json`, () => {
      const launch = buildClaudeLaunch({ task: TASK, cwd: REAL_CWD, model, permissions });
      const args = innerArgs(launch);
      assert.equal(args.filter((a) => a === "--verbose").length, 1);
      const i = args.indexOf("stream-json");
      assert.equal(args[i - 1], "--output-format");
      assert.equal(args[i + 1], "--verbose");
      assert.equal(args[args.length - 1], TASK);
    });
  }
}

// ---- parser compatibility. ASSUMPTION: event shapes below follow Claude Code
// stream-json (system/init, assistant message with content blocks, user
// tool_result, terminal result with is_error/result/usage); only fields that
// the repo's parsing code reads are relied upon.
const INIT = { type: "system", subtype: "init", session_id: "s1", model: "m", tools: ["Read"] };
const ASSISTANT_TOOL = { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }], usage: { input_tokens: 1, output_tokens: 1 } } };
const USER_RESULT = { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "file body" }] } };
const ASSISTANT_TEXT = { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Intermediate thought" }] } };
const RESULT_OK = { type: "result", subtype: "success", is_error: false, result: "FINAL ANSWER", total_cost_usd: 0.01, usage: { input_tokens: 10, output_tokens: 5 } };
const RESULT_ERR = { type: "result", subtype: "success", is_error: true, result: "Credit balance is too low", usage: { input_tokens: 1, output_tokens: 0 } };

async function runWith(lines, exitCode) {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-claude-verbose-"));
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 5151;
    child.kill = () => child.emit("close", 130);
    setImmediate(() => {
      for (const l of lines) child.stdout.emit("data", `${JSON.stringify(l)}\n`);
      child.emit("close", exitCode);
    });
    return child;
  };
  const { runId, completion } = await startRun({
    homeDir, agentId: "claude", task: TASK, cwd: homeDir, captureTranscript: true,
    resolveAdapterImpl: () => ({ ...claude, preflight: async () => ({ ok: true }) }),
    spawnImpl
  });
  const final = await completion;
  const events = await readRunEvents(homeDir, runId);
  return { final, events, result: normalizeRunResult({ runId, metadata: final, events }) };
}

test("verbose stream (init, assistant, tool_result, result success): summary is the result text, run completed", async () => {
  const { final, result } = await runWith([INIT, ASSISTANT_TOOL, USER_RESULT, ASSISTANT_TEXT, RESULT_OK], 0);
  assert.equal(final.state, "completed");
  assert.equal(result.status, "completed");
  assert.equal(result.summary, "FINAL ANSWER");
});

test("verbose stream: non-result events do not pollute the summary and token usage from result is kept", async () => {
  const { final, result } = await runWith([INIT, ASSISTANT_TEXT, RESULT_OK], 0);
  assert.notEqual(result.summary, "Intermediate thought");
  assert.equal(final.tokenUsage?.input, 10);
  assert.equal(final.tokenUsage?.output, 5);
});

test("verbose stream failure variant (is_error result, exit 1): failed run carrying the error text", async () => {
  const { final, result } = await runWith([INIT, RESULT_ERR], 1);
  assert.equal(final.state, "failed");
  assert.equal(result.ok, false);
  assert.equal(result.status, "failed");
  assert.equal(result.summary, "Credit balance is too low");
});

test("verbose stream with no result line (killed): last assistant text block is the fallback summary", async () => {
  const { result } = await runWith([INIT, ASSISTANT_TEXT], 0);
  assert.equal(result.summary, "Intermediate thought");
});

test("assistant tool_use-only message is not accepted as a summary", async () => {
  const { result } = await runWith([INIT, ASSISTANT_TOOL], 0);
  assert.equal(result.status, "failed");
  assert.equal(result.error, "no summary produced");
});
