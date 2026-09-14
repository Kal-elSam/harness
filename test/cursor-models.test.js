import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { parseCursorModelsOutput, readCursorModels } from "../src/global/observability/cursor-models.js";

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

test("parseCursorModelsOutput strips the spinner's ANSI codes and recognizes the real empty-account sentinel", () => {
  const raw = "\x1b[2K\x1b[GLoading models…\x1b[2K\x1b[1A\x1b[2K\x1b[GNo models available for this account.";
  assert.deepEqual(parseCursorModelsOutput(raw), []);
});

test("parseCursorModelsOutput treats remaining non-spinner lines as model names when the account has models", () => {
  const raw = "\x1b[2K\x1b[GLoading models…\x1b[2K\x1b[1A\x1b[2K\x1b[G\ngpt-5\nsonnet-4\n";
  assert.deepEqual(parseCursorModelsOutput(raw), ["gpt-5", "sonnet-4"]);
});

test("reads a real (possibly empty) answer as measured — empty is data, not a failure", async () => {
  const result = await readCursorModels({
    spawn: () => fakeSpawn({ stdout: "No models available for this account." })
  });
  assert.equal(result.status, "measured");
  assert.deepEqual(result.models, []);
});

test("a real crash (killed by a signal) is NEVER reinterpreted as a clean empty catalog, even with no stdout", async () => {
  const result = await readCursorModels({
    spawn: () => fakeSpawn({ stdout: "", stderr: "SecItemCopyMatching failed -50", signal: "SIGSEGV" })
  });
  assert.equal(result.status, "unknown");
  assert.deepEqual(result.models, []);
  assert.match(result.error, /SIGSEGV/);
  assert.match(result.error, /SecItemCopyMatching failed -50/);
});

test("a non-zero exit code is NEVER reinterpreted as a clean empty catalog", async () => {
  const result = await readCursorModels({
    spawn: () => fakeSpawn({ stdout: "", stderr: "some real failure", code: 1 })
  });
  assert.equal(result.status, "unknown");
  assert.match(result.error, /exited with code 1/);
  assert.match(result.error, /some real failure/);
});

test("fails closed to unknown on a spawn error or timeout", async () => {
  const spawnError = await readCursorModels({
    spawn: () => { throw new Error("cursor-agent: command not found"); }
  });
  assert.equal(spawnError.status, "unknown");
  assert.match(spawnError.error, /command not found/);

  const timeout = await readCursorModels({
    spawn: () => { const c = new EventEmitter(); c.stdout = new EventEmitter(); c.kill = () => {}; return c; },
    timeoutMs: 5
  });
  assert.equal(timeout.status, "unknown");
  assert.match(timeout.error, /timed out/);
});
