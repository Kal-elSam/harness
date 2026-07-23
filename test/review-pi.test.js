import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import {
  REVIEW_PI_ERROR_CODES, REVIEW_EXEC_ERROR_CODES, REVIEW_VALIDATION_ERROR_CODES,
  ReviewExecError, buildPiReviewArgs, buildPiReviewPrompt, buildPiReviewStdin,
  parsePiReviewJsonl, runBoundedProcess, runPiReview
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
const assistantEnd = (text, extra = {}) => ({
  type: "message_end",
  message: {
    role: "assistant", content: [{ type: "text", text }],
    stopReason: "stop", usage: { input: 0, output: 0, totalTokens: 0 }, ...extra
  }
});
const turnEnd = (usage) => ({
  type: "turn_end", message: { role: "assistant", usage }, toolResults: []
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

test("pi argv, snapshot binding, JSONL, and process faults", async () => {
  const args = buildPiReviewArgs(snap(), { model: "m" });
  assert.deepEqual(args.slice(0, 5), ["--mode", "json", "--no-session", "--tools", "read,grep,find,ls"]);
  for (const flag of [
    "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-approve"
  ]) assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf("--model") + 1], "m");
  assert.ok(!args.includes(buildPiReviewPrompt(snap())));
  assert.equal(args.at(-1), "m");
  const tools = args[args.indexOf("--tools") + 1];
  assert.ok(!/\b(bash|write|edit)\b/.test(tools));
  const stdinSample = buildPiReviewStdin(snap(), "diff --git a/a.js b/a.js\n+ok\n");
  assert.match(stdinSample, /Bounded review mode=working-tree/);
  assert.match(stdinSample, /diff --git a\/a\.js/);
  assert.ok(!JSON.stringify(buildPiReviewArgs(snap())).includes("a.js"));
  if (spawnSync("which", ["pi"], { encoding: "utf8" }).status === 0) {
    const help = spawnSync("pi", ["--help"], { encoding: "utf8" });
    assert.equal(help.status, 0);
    const text = `${help.stdout}\n${help.stderr}`;
    for (const flag of ["--mode", "--no-session", "--tools", "--no-extensions", "--no-skills",
      "--no-prompt-templates", "--no-context-files", "--no-approve"]) {
      assert.match(text, new RegExp(flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  }
  assert.match(buildPiReviewPrompt(snap({ mode: "base", base: "main" })), /base=main/);
  assert.match(buildPiReviewPrompt(snap({ mode: "commit", commit: "deadbeef" })), /commit=deadbeef/);
  assert.throws(() => buildPiReviewArgs({ ...snap(), cwd: "" }), (e) => e.code === REVIEW_PI_ERROR_CODES.INVALID_CWD);
  assert.equal(parsePiReviewJsonl(jsonl([
    assistantEnd(finding()),
    turnEnd({ input: 1, output: 2, totalTokens: 3, cost: { total: 0.01 } })
  ]) + "{\"partial\"").usage.totalTokens, 3);
  assert.throws(() => parsePiReviewJsonl("{bad}\n"), (e) => e.code === REVIEW_PI_ERROR_CODES.INVALID_JSONL);
  assert.throws(() => parsePiReviewJsonl(jsonl([{ type: "turn_start" }])), (e) => (
    e.code === REVIEW_PI_ERROR_CODES.MISSING_AGENT_MESSAGE
  ));
  assert.throws(() => parsePiReviewJsonl(jsonl([
    assistantEnd(finding()),
    { type: "error", message: "late boom" }
  ])), (e) => e.code === REVIEW_PI_ERROR_CODES.STREAM_ERROR);
  assert.throws(() => parsePiReviewJsonl(jsonl([
    assistantEnd("", { stopReason: "error", errorMessage: "provider down", content: [] })
  ])), (e) => e.code === REVIEW_PI_ERROR_CODES.STREAM_ERROR);

  const signals = [];
  assert.equal((await runBoundedProcess({
    command: "pi", args: ["x"], timeoutMs: 15, terminationGraceMs: 10, killGraceMs: 10,
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
    command: "pi", args: ["x"], stdoutLimit: 8, timeoutMs: 50,
    spawnImpl: () => child({ stdout: "0123456789ABCDEF" })
  })).stdoutOverflow, true);

  let captured;
  const marker = "diff --git a/a.js b/a.js\n@@ -1 +1 @@\n-old\n+new\n";
  const good = await runPiReview({
    snapshot: snap(), model: "requested-model",
    buildPatch: async () => marker,
    runProcess: async (opts) => {
      captured = opts;
      return ok(jsonl([
        assistantEnd(finding("a.js", { model: "spoofed", usage: { inputTokens: 99, outputTokens: 99 } })),
        turnEnd({ input: 4, output: 5, totalTokens: 9, cost: { total: 0.02 } })
      ]));
    }
  });
  assert.equal(captured.cwd, "/repo");
  assert.equal(captured.command, "pi");
  assert.match(captured.stdin, /Scoped patch/);
  assert.match(captured.stdin, /diff --git a\/a\.js/);
  assert.ok(!captured.args.some((a) => String(a).includes("Bounded review") || String(a).includes("a.js")));
  assert.equal(good.agentId, "pi");
  assert.equal(good.model, "requested-model");
  assert.equal(good.usage.inputTokens, 4);
  assert.equal(good.usage.cost, 0.02);
  assert.equal("patch" in good, false);
  assert.equal("stdin" in good, false);
  assert.doesNotMatch(JSON.stringify(good), /diff --git|Scoped patch|-old/);
  await assert.rejects(() => runPiReview({
    snapshot: snap({ cwd: null }), buildPatch: async () => "", runProcess: async () => ok("{}")
  }), (e) => e.code === REVIEW_PI_ERROR_CODES.INVALID_CWD);
  await assert.rejects(() => runPiReview({
    snapshot: snap(), buildPatch: async () => marker,
    runProcess: async () => ok(jsonl([assistantEnd(finding("other.js"))]))
  }), (e) => e.code === REVIEW_VALIDATION_ERROR_CODES.PATH_OUT_OF_SCOPE);
  await assert.rejects(() => runPiReview({
    snapshot: snap(), buildPatch: async () => marker,
    runProcess: async () => ok(jsonl([assistantEnd(finding())]), 1)
  }), (e) => e instanceof ReviewExecError && e.code === REVIEW_EXEC_ERROR_CODES.NONZERO_EXIT);
});
