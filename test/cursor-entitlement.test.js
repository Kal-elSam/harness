import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  CURSOR_ACCESS_STATUS, CURSOR_POOL, classifyCursorPool, detectCursorLimitFromOutput, probeCursorPoolAccess
} from "../src/global/observability/cursor-entitlement.js";

function fakeSpawn({ stdout = "", stderr = "", errorEvent = null, code = 0, signal = null } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  setTimeout(() => {
    if (stdout) child.stdout.emit("data", stdout);
    if (stderr) child.stderr.emit("data", stderr);
    if (errorEvent) child.emit("error", errorEvent);
    else child.emit("close", code, signal);
  }, 0);
  return child;
}

test("classifyCursorPool: Cursor's own Composer line is CURSOR_MODELS, everything else real is OTHER_MODELS", () => {
  assert.equal(classifyCursorPool({ id: "composer-2.5", displayName: "Composer 2.5" }), CURSOR_POOL.CURSOR_MODELS);
  assert.equal(classifyCursorPool({ id: "COMPOSER-1", displayName: "" }), CURSOR_POOL.CURSOR_MODELS, "case-insensitive");
  assert.equal(classifyCursorPool({ id: "gpt-5.3-codex-low", displayName: "GPT-5.3 Codex Low" }), CURSOR_POOL.OTHER_MODELS);
  assert.equal(classifyCursorPool({ id: "claude-fable-5-1", displayName: "Fable 5.1" }), CURSOR_POOL.OTHER_MODELS);
});

test("REGRESSION: probeCursorPoolAccess classifies a real successful answer as AVAILABLE", async () => {
  const result = await probeCursorPoolAccess({
    pool: CURSOR_POOL.OTHER_MODELS,
    modelId: "claude-fable-5-1",
    spawn: () => fakeSpawn({ stdout: JSON.stringify({ is_error: false, result: "Hi! I'm Fable." }), code: 0 })
  });
  assert.equal(result.pool, CURSOR_POOL.OTHER_MODELS);
  assert.equal(result.status, CURSOR_ACCESS_STATUS.AVAILABLE);
  assert.equal(result.reason, null);
});

test("REGRESSION: probeCursorPoolAccess classifies an explicit, recognized limit/quota error as EXHAUSTED", async () => {
  const result = await probeCursorPoolAccess({
    pool: CURSOR_POOL.OTHER_MODELS,
    modelId: "claude-fable-5-1",
    spawn: () => fakeSpawn({ stdout: JSON.stringify({ is_error: true, result: "You have exceeded your monthly limit." }), code: 0 })
  });
  assert.equal(result.status, CURSOR_ACCESS_STATUS.EXHAUSTED);
  assert.match(result.reason, /monthly limit/);
});

test("REGRESSION: probeCursorPoolAccess fails closed to UNVERIFIED on timeout, spawn error, broken JSON, an unrecognized error message, and a signal kill — never guesses AVAILABLE or EXHAUSTED", async () => {
  const timedOut = await probeCursorPoolAccess({
    pool: CURSOR_POOL.CURSOR_MODELS, modelId: "composer-2.5", timeoutMs: 5,
    spawn: () => { const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.kill = () => {}; return c; }
  });
  assert.equal(timedOut.status, CURSOR_ACCESS_STATUS.UNVERIFIED);

  const spawnFailed = await probeCursorPoolAccess({
    pool: CURSOR_POOL.CURSOR_MODELS, modelId: "composer-2.5",
    spawn: () => fakeSpawn({ errorEvent: Object.assign(new Error("spawn cursor-agent ENOENT"), { code: "ENOENT" }) })
  });
  assert.equal(spawnFailed.status, CURSOR_ACCESS_STATUS.UNVERIFIED);

  const brokenJson = await probeCursorPoolAccess({
    pool: CURSOR_POOL.CURSOR_MODELS, modelId: "composer-2.5",
    spawn: () => fakeSpawn({ stdout: "not-json{", code: 0 })
  });
  assert.equal(brokenJson.status, CURSOR_ACCESS_STATUS.UNVERIFIED);

  const unrecognizedError = await probeCursorPoolAccess({
    pool: CURSOR_POOL.CURSOR_MODELS, modelId: "composer-2.5",
    spawn: () => fakeSpawn({ stdout: JSON.stringify({ is_error: true, result: "Please log in to continue." }), code: 0 })
  });
  assert.equal(unrecognizedError.status, CURSOR_ACCESS_STATUS.UNVERIFIED, "an auth/login error is real evidence of a problem, but never a confirmed EXHAUSTED quota");

  const killed = await probeCursorPoolAccess({
    pool: CURSOR_POOL.CURSOR_MODELS, modelId: "composer-2.5",
    spawn: () => fakeSpawn({ code: null, signal: "SIGTERM" })
  });
  assert.equal(killed.status, CURSOR_ACCESS_STATUS.UNVERIFIED);
});

test("probeCursorPoolAccess requires a real modelId — never probes without one", async () => {
  const result = await probeCursorPoolAccess({ pool: CURSOR_POOL.CURSOR_MODELS, modelId: "" });
  assert.equal(result.status, CURSOR_ACCESS_STATUS.UNVERIFIED);
  assert.match(result.reason, /modelId is required/);
});

test("probeCursorPoolAccess uses the exact real, minimal, non-destructive argv shape", async () => {
  let seenArgs = null;
  await probeCursorPoolAccess({
    pool: CURSOR_POOL.OTHER_MODELS, modelId: "claude-fable-5-1",
    spawn: (cmd, args) => {
      assert.equal(cmd, "cursor-agent");
      seenArgs = args;
      return fakeSpawn({ stdout: JSON.stringify({ is_error: false, result: "hi" }), code: 0 });
    }
  });
  assert.deepEqual(seenArgs, ["-p", "hi", "--mode", "ask", "--model", "claude-fable-5-1", "--output-format", "json"]);
});

// --- detectCursorLimitFromOutput: reactive limit detection for a real
// execution's own output line — same classifier the probe itself uses.

test("detectCursorLimitFromOutput: a real stdout line with is_error:true and a matching result message is recognized", () => {
  const line = JSON.stringify({ type: "result", is_error: true, result: "You have hit your monthly limit for Composer." });
  const hit = detectCursorLimitFromOutput({ line, stream: "stdout" });
  assert.deepEqual(hit, { reason: "You have hit your monthly limit for Composer." });
});

test("detectCursorLimitFromOutput: an explicit matching message on stderr is recognized directly", () => {
  const hit = detectCursorLimitFromOutput({ line: "Error: rate limit exceeded, try again later", stream: "stderr" });
  assert.deepEqual(hit, { reason: "Error: rate limit exceeded, try again later" });
});

test("detectCursorLimitFromOutput: normal assistant stdout text is never scanned, even if it happens to mention a limit-sounding word", () => {
  const line = JSON.stringify({ type: "assistant", text: "I'll check your API rate limit configuration in the code." });
  assert.equal(detectCursorLimitFromOutput({ line, stream: "stdout" }), null);
});

test("detectCursorLimitFromOutput: a real is_error:true with an unrecognized message is never treated as a limit hit", () => {
  const line = JSON.stringify({ type: "result", is_error: true, result: "Network connection reset." });
  assert.equal(detectCursorLimitFromOutput({ line, stream: "stdout" }), null);
});

test("detectCursorLimitFromOutput: non-JSON stdout and unparseable lines never crash and are never treated as a limit hit", () => {
  assert.equal(detectCursorLimitFromOutput({ line: "not json at all", stream: "stdout" }), null);
  assert.equal(detectCursorLimitFromOutput({ line: "", stream: "stdout" }), null);
});

test("detectCursorLimitFromOutput: ordinary stderr noise that doesn't match the classifier is ignored", () => {
  assert.equal(detectCursorLimitFromOutput({ line: "warning: deprecated flag used", stream: "stderr" }), null);
});
