import test from "node:test";
import assert from "node:assert/strict";
import opencodeAdapter, { parseOpencodeEventLine } from "../src/global/runtime/execution-adapters/opencode.js";

// Every fixture below is copied verbatim from a real `opencode run --format
// json` invocation against a live account (captured while investigating why
// OpenCode Go never competes in AI TEAM) — not invented event shapes.

const REAL_TOOL_USE_EVENT = JSON.stringify({
  type: "tool_use",
  timestamp: 1789235349832,
  sessionID: "ses_f69435135ffexoeIAklH7HEq8l",
  part: {
    type: "tool",
    tool: "bash",
    callID: "call_9F8pg0AAyA6jZwfb3AETv1zd",
    state: {
      status: "completed",
      input: { command: "cat test-file.txt", workdir: "/tmp" },
      output: "hello world\n",
      title: "cat test-file.txt"
    },
    id: "prt_096bcc881001UeopRaXd42TLCK",
    sessionID: "ses_f69435135ffexoeIAklH7HEq8l",
    messageID: "msg_096bcb1ed001SwNs6DGIxeU00B"
  }
});

const REAL_STEP_FINISH_EVENT = JSON.stringify({
  type: "step_finish",
  timestamp: 1789235326583,
  sessionID: "ses_f6943a4e7ffewQAxdx3Ga5nNcI",
  part: {
    id: "prt_096bc6e6d001Bh4FMRJtp4dC6U",
    reason: "stop",
    messageID: "msg_096bc5e9d001otd6CxJfqnR50g",
    sessionID: "ses_f6943a4e7ffewQAxdx3Ga5nNcI",
    type: "step-finish",
    tokens: { total: 32543, input: 3, output: 5, reasoning: 0, cache: { write: 32535, read: 0 } },
    cost: 0.00814035
  }
});

const REAL_ERROR_EVENT = JSON.stringify({
  type: "error",
  timestamp: 1789235575574,
  sessionID: "ses_f693fc809ffey00HAUw0sW4LKL",
  error: { name: "UnknownError", data: { message: "Unexpected server error. Check server logs for details.", ref: "err_45261f6f" } }
});

const REAL_TEXT_EVENT = JSON.stringify({
  type: "text",
  timestamp: 1789235326484,
  sessionID: "ses_f6943a4e7ffewQAxdx3Ga5nNcI",
  part: { id: "prt_096bc6ccf001NjRmdlf1hbrQwL", type: "text", text: "OK" }
});

test("parseOpencodeEventLine maps a real tool_use event to a tool_call, using its actual tool name and status", () => {
  const result = parseOpencodeEventLine(REAL_TOOL_USE_EVENT);
  assert.deepEqual(result, { type: "tool_call", tool_name: "bash", status: "completed" });
});

test("parseOpencodeEventLine maps a real step_finish event to usage with its actual tokens and cost", () => {
  const result = parseOpencodeEventLine(REAL_STEP_FINISH_EVENT);
  assert.deepEqual(result, { type: "usage", inputTokens: 3, outputTokens: 5, totalTokens: 32543, cost: 0.00814035 });
});

test("parseOpencodeEventLine passes a real error event through unmodified rather than inventing a shape for it", () => {
  const result = parseOpencodeEventLine(REAL_ERROR_EVENT);
  assert.equal(result.type, "error");
  assert.equal(result.error.name, "UnknownError");
});

test("parseOpencodeEventLine passes an unmodeled real event (text) through raw, same fallback as the other adapters", () => {
  const result = parseOpencodeEventLine(REAL_TEXT_EVENT);
  assert.equal(result.type, "text");
});

test("parseOpencodeEventLine returns null for unparseable noise lines (e.g. skill-registry log output mixed into stdout)", () => {
  assert.equal(parseOpencodeEventLine("[skill-registry] skipping refresh: not a project root: /"), null);
  assert.equal(parseOpencodeEventLine(""), null);
});

test("buildLaunch requests real JSON output and passes the caller's model ref through unmodified", () => {
  const launch = opencodeAdapter.buildLaunch({ task: "Fix the bug", cwd: "/tmp", model: "opencode-go/hy3", permissions: [] });
  assert.equal(launch.command, "opencode");
  assert.deepEqual(launch.args, ["run", "--format", "json", "--model", "opencode-go/hy3", "Fix the bug"]);
});

test("buildLaunch adds --auto only for yolo/force/all permissions, the real flag this CLI actually supports", () => {
  const launch = opencodeAdapter.buildLaunch({ task: "Fix the bug", cwd: "/tmp", permissions: ["yolo"] });
  assert.ok(launch.args.includes("--auto"));
});

test("opencode adapter stays not-launchable even though it now honestly reports structured-event support", () => {
  const availability = opencodeAdapter.availability();
  assert.equal(availability.launchable, false);
});
