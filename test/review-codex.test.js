import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  REVIEW_CODEX_ERROR_CODES, REVIEW_EXEC_ERROR_CODES, REVIEW_VALIDATION_ERROR_CODES,
  ReviewExecError, buildCodexCliEnv, buildCodexReviewArgs, buildCodexReviewPrompt,
  parseCodexReviewJsonl, runBoundedProcess, runCodexReview
} from "../src/global/runtime/review/index.js";

const snap = () => ({
  mode: "working-tree", headSha: "abc", base: null, commit: null, fingerprint: "fp",
  totals: { fileCount: 1, changedLines: 1, diffBytes: 10 },
  files: [{ path: "a.js", status: "M", hash: "h", changedLines: 1 }], excluded: []
});
const finding = (path = "a.js") => JSON.stringify({
  findings: [{ severity: "medium", title: "Style", path, line: null, problem: "p", recommendation: "r" }]
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
  c.stdin = { end() {} };
  c.kill = (signal) => onKill?.(signal, c) ?? true;
  queueMicrotask(() => {
    if (hang) return;
    if (stdout) c.stdout.emit("data", stdout);
    c.emit("close", exitStatus, null);
  });
  return c;
}

test("codex command, JSONL, process faults, and validated review", async () => {
  const args = buildCodexReviewArgs({ cwd: "/repo", model: "m" });
  assert.ok(args.includes("--json") && args.includes("--ephemeral") && args.includes("--ignore-user-config"));
  assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
  assert.ok(!args.includes("--dangerously-bypass-approvals-and-sandbox"));
  assert.equal(args.at(-1), "-");
  assert.ok(!args.some((a) => String(a).includes("findings")));
  assert.match(buildCodexReviewPrompt(snap()), /mode=working-tree[\s\S]*a\.js/);
  assert.equal(buildCodexCliEnv({ PATH: "/bin", OPENAI_API_KEY: "sk", SECRET: "x" }).SECRET, undefined);
  assert.throws(() => buildCodexReviewArgs({ cwd: "" }), (e) => e.code === REVIEW_CODEX_ERROR_CODES.INVALID_CWD);

  const parsed = parseCodexReviewJsonl(jsonl([
    { type: "item.completed", item: { id: "1", type: "agent_message", text: finding() } },
    { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 2, cached_input_tokens: 0, reasoning_output_tokens: 0 } }
  ]) + "{\"type\":\"item.started\"");
  assert.equal(parsed.usage.totalTokens, 3);
  assert.throws(() => parseCodexReviewJsonl("{bad}\n"), (e) => e.code === REVIEW_CODEX_ERROR_CODES.INVALID_JSONL);
  assert.throws(() => parseCodexReviewJsonl(jsonl([{ type: "turn.started" }])), (e) => (
    e.code === REVIEW_CODEX_ERROR_CODES.MISSING_AGENT_MESSAGE
  ));
  assert.throws(() => parseCodexReviewJsonl(jsonl([
    { type: "item.completed", item: { id: "1", type: "agent_message", text: finding() } },
    { type: "error", message: "late boom" }
  ])), (e) => e.code === REVIEW_CODEX_ERROR_CODES.STREAM_ERROR);

  const nonzero = await runBoundedProcess({
    command: "codex", args: ["x"], spawnImpl: () => child({ exitStatus: 2, stdout: finding() }), timeoutMs: 50
  });
  assert.equal(nonzero.status, 2);
  const signals = [];
  const timed = await runBoundedProcess({
    command: "codex", args: ["x"], timeoutMs: 15, terminationGraceMs: 10, killGraceMs: 10,
    spawnImpl: () => child({
      hang: true,
      onKill: (signal, c) => {
        signals.push(signal);
        if (signal === "SIGKILL") queueMicrotask(() => c.emit("close", null, "SIGKILL"));
        return true;
      }
    })
  });
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(timed.timedOut, true);
  assert.equal((await runBoundedProcess({
    command: "codex", args: ["x"], stdoutLimit: 8, timeoutMs: 50,
    spawnImpl: () => child({ stdout: "0123456789ABCDEF" })
  })).stdoutOverflow, true);
  let late;
  await runBoundedProcess({
    command: "codex", args: ["x"], timeoutMs: 50,
    spawnImpl: () => { late = child({ stdout: "ok" }); return late; }
  });
  assert.doesNotThrow(() => late.emit("error", new Error("late")));

  const good = await runCodexReview({
    snapshot: snap(), cwd: "/repo",
    runProcess: async () => ok(jsonl([
      { type: "item.completed", item: { id: "1", type: "agent_message", text: finding() } },
      { type: "turn.completed", usage: { input_tokens: 4, output_tokens: 5, cached_input_tokens: 0, reasoning_output_tokens: 0 } }
    ]))
  });
  assert.equal(good.agentId, "codex");
  assert.equal(good.findings[0].path, "a.js");
  assert.equal(good.usage.inputTokens, 4);
  assert.equal(Object.hasOwn(good, "stdout"), false);
  await assert.rejects(() => runCodexReview({
    snapshot: snap(), cwd: "/repo",
    runProcess: async () => ok(jsonl([
      { type: "item.completed", item: { id: "1", type: "agent_message", text: finding("other.js") } }
    ]))
  }), (e) => e.code === REVIEW_VALIDATION_ERROR_CODES.PATH_OUT_OF_SCOPE);
  await assert.rejects(() => runCodexReview({
    snapshot: snap(), cwd: "/repo",
    runProcess: async () => ok(jsonl([
      { type: "item.completed", item: { id: "1", type: "agent_message", text: finding() } }
    ]), 1)
  }), (e) => e instanceof ReviewExecError && e.code === REVIEW_EXEC_ERROR_CODES.NONZERO_EXIT);
});
