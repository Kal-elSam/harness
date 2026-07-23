import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import {
  REVIEW_CODEX_ERROR_CODES, REVIEW_EXEC_ERROR_CODES, REVIEW_VALIDATION_ERROR_CODES,
  ReviewExecError, buildCodexReviewArgs, buildCodexReviewPrompt, parseCodexReviewJsonl,
  runBoundedProcess, runCodexReview
} from "../src/global/runtime/review/index.js";

const snap = (over = {}) => ({
  mode: "working-tree", cwd: "/repo", headSha: "abc", base: null, commit: null, fingerprint: "fp",
  totals: { fileCount: 1, changedLines: 1, diffBytes: 10 },
  files: [{ path: "a.js", status: "M", hash: "h", changedLines: 1 }], excluded: [], ...over
});
const finding = (path = "a.js", extra = {}) => JSON.stringify({
  findings: [{ severity: "medium", title: "Style", path, line: null, problem: "p", recommendation: "r" }],
  ...extra
});
const jsonl = (events) => `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;
const ok = (stdout, status = 0) => ({
  status, signal: null, timedOut: false, terminationFailed: false,
  stdoutOverflow: false, stderrOverflow: false, stdout, stderr: ""
});

function child({ exitStatus = 0, stdout = "", hang = false, onKill = null } = {}) {
  const c = new EventEmitter();
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.stdin = new EventEmitter();
  c.stdin.end = () => {};
  c.kill = (signal) => onKill?.(signal, c) ?? true;
  queueMicrotask(() => {
    if (hang) return;
    if (stdout) c.stdout.emit("data", stdout);
    c.emit("close", exitStatus, null);
  });
  return c;
}

test("codex argv, snapshot binding, JSONL, and process faults", async () => {
  const args = buildCodexReviewArgs(snap(), { model: "m" });
  assert.deepEqual(args.slice(0, 3), ["--ask-for-approval", "never", "exec"]);
  assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
  assert.ok(args.includes("--ephemeral") && !args.includes("--dangerously-bypass-approvals-and-sandbox"));
  assert.equal(args.at(-1), "-");
  if (spawnSync("which", ["codex"], { encoding: "utf8" }).status === 0) {
    assert.equal(spawnSync("codex", [...args.slice(0, -1), "--help"], { encoding: "utf8" }).status, 0);
    assert.equal(spawnSync("codex", ["exec", "--ask-for-approval", "never", "--help"], { encoding: "utf8" }).status, 2);
  }
  assert.match(buildCodexReviewPrompt(snap({ mode: "base", base: "main" })), /base=main/);
  assert.match(buildCodexReviewPrompt(snap({ mode: "commit", commit: "deadbeef" })), /commit=deadbeef/);
  assert.throws(() => buildCodexReviewArgs({ ...snap(), cwd: "" }), (e) => e.code === REVIEW_CODEX_ERROR_CODES.INVALID_CWD);
  assert.equal(parseCodexReviewJsonl(jsonl([
    { type: "item.completed", item: { id: "1", type: "agent_message", text: finding() } },
    { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 2, cached_input_tokens: 0, reasoning_output_tokens: 0 } }
  ]) + "{\"partial\"").usage.totalTokens, 3);
  assert.throws(() => parseCodexReviewJsonl("{bad}\n"), (e) => e.code === REVIEW_CODEX_ERROR_CODES.INVALID_JSONL);
  assert.throws(() => parseCodexReviewJsonl(jsonl([{ type: "turn.started" }])), (e) => (
    e.code === REVIEW_CODEX_ERROR_CODES.MISSING_AGENT_MESSAGE
  ));
  assert.throws(() => parseCodexReviewJsonl(jsonl([
    { type: "item.completed", item: { id: "1", type: "agent_message", text: finding() } },
    { type: "error", message: "late boom" }
  ])), (e) => e.code === REVIEW_CODEX_ERROR_CODES.STREAM_ERROR);
  const signals = [];
  assert.equal((await runBoundedProcess({
    command: "codex", args: ["x"], timeoutMs: 15, terminationGraceMs: 10, killGraceMs: 10,
    spawnImpl: () => child({
      hang: true,
      onKill: (signal, c) => {
        signals.push(signal);
        if (signal === "SIGKILL") queueMicrotask(() => c.emit("close", null, "SIGKILL"));
        return true;
      }
    })
  })).timedOut, true);
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  assert.equal((await runBoundedProcess({
    command: "codex", args: ["x"], stdoutLimit: 8, timeoutMs: 50,
    spawnImpl: () => child({ stdout: "0123456789ABCDEF" })
  })).stdoutOverflow, true);
  assert.equal((await runBoundedProcess({
    command: process.execPath, args: ["-e", "process.exit(0)"],
    stdin: "x".repeat(256 * 1024), timeoutMs: 5_000
  })).status, 0);

  let captured;
  const good = await runCodexReview({
    snapshot: snap(), model: "requested-model",
    runProcess: async (opts) => {
      captured = opts;
      return ok(jsonl([
        {
          type: "item.completed",
          item: {
            id: "1", type: "agent_message",
            text: finding("a.js", { model: "spoofed", usage: { inputTokens: 99, outputTokens: 99 } })
          }
        },
        { type: "turn.completed", usage: { input_tokens: 4, output_tokens: 5, cached_input_tokens: 0, reasoning_output_tokens: 0 } }
      ]));
    }
  });
  assert.equal(captured.cwd, "/repo");
  assert.equal(captured.args[captured.args.indexOf("-C") + 1], "/repo");
  assert.equal(good.model, "requested-model");
  assert.equal(good.usage.inputTokens, 4);
  await assert.rejects(() => runCodexReview({
    snapshot: snap({ cwd: null }), runProcess: async () => ok("{}")
  }), (e) => e.code === REVIEW_CODEX_ERROR_CODES.INVALID_CWD);
  await assert.rejects(() => runCodexReview({
    snapshot: snap(),
    runProcess: async () => ok(jsonl([
      { type: "item.completed", item: { id: "1", type: "agent_message", text: finding("other.js") } }
    ]))
  }), (e) => e.code === REVIEW_VALIDATION_ERROR_CODES.PATH_OUT_OF_SCOPE);
  await assert.rejects(() => runCodexReview({
    snapshot: snap(),
    runProcess: async () => ok(jsonl([
      { type: "item.completed", item: { id: "1", type: "agent_message", text: finding() } }
    ]), 1)
  }), (e) => e instanceof ReviewExecError && e.code === REVIEW_EXEC_ERROR_CODES.NONZERO_EXIT);
});
