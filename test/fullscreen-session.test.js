import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import ansiEscapes from "ansi-escapes";
import {
  createFullscreenSession,
  withFullscreenSession
} from "../src/global/ink/fullscreen-session.js";

function createMockStdout({ isTTY = true } = {}) {
  const chunks = [];
  return {
    isTTY,
    chunks,
    write(chunk) {
      chunks.push(String(chunk));
      return true;
    }
  };
}

function createMockProcess() {
  const emitter = new EventEmitter();
  emitter.exitCodes = [];
  emitter.exit = (code) => {
    emitter.exitCodes.push(code);
  };
  return emitter;
}

test("fullscreen session enters and leaves exactly once", () => {
  const stdout = createMockStdout();
  const session = createFullscreenSession({
    stdout,
    processRef: createMockProcess(),
    onSignal: () => {}
  });

  assert.equal(session.enter(), true);
  assert.equal(session.isActive(), true);
  assert.equal(session.enter(), false);
  assert.ok(stdout.chunks.includes(ansiEscapes.enterAlternativeScreen));
  assert.ok(stdout.chunks.includes(ansiEscapes.cursorHide));

  assert.equal(session.leave(), true);
  assert.equal(session.isActive(), false);
  assert.equal(session.leave(), false);
  assert.ok(stdout.chunks.includes(ansiEscapes.exitAlternativeScreen));
  assert.ok(stdout.chunks.includes(ansiEscapes.cursorShow));
});

test("fullscreen session does not activate when not a TTY", () => {
  const stdout = createMockStdout({ isTTY: false });
  const session = createFullscreenSession({
    stdout,
    enabled: false,
    processRef: createMockProcess()
  });

  assert.equal(session.enter(), false);
  assert.equal(session.isActive(), false);
  assert.deepEqual(stdout.chunks, []);
});

test("fullscreen session restores on signal exactly once", () => {
  const stdout = createMockStdout();
  const processRef = createMockProcess();
  const signals = [];
  const session = createFullscreenSession({
    stdout,
    processRef,
    onSignal: (signal) => signals.push(signal)
  });

  session.enter();
  processRef.emit("SIGINT");
  assert.deepEqual(signals, ["SIGINT"]);
  assert.equal(session.isActive(), false);
  assert.equal(session.leave(), false);
  assert.ok(stdout.chunks.includes(ansiEscapes.exitAlternativeScreen));

  processRef.emit("SIGINT");
  assert.deepEqual(signals, ["SIGINT"]);
});

test("withFullscreenSession leaves after success and after throw", async () => {
  const stdout = createMockStdout();
  const processRef = createMockProcess();

  await withFullscreenSession({ stdout, processRef, onSignal: () => {} }, async (session) => {
    assert.equal(session.isActive(), true);
    return "ok";
  });

  assert.ok(stdout.chunks.includes(ansiEscapes.exitAlternativeScreen));

  const stdout2 = createMockStdout();
  await assert.rejects(
    () => withFullscreenSession({ stdout: stdout2, processRef, onSignal: () => {} }, async () => {
      throw new Error("boom");
    }),
    /boom/
  );
  assert.ok(stdout2.chunks.includes(ansiEscapes.exitAlternativeScreen));
});

test("withFullscreenSession does not leave a parent-owned active session", async () => {
  const stdout = createMockStdout();
  const processRef = createMockProcess();
  const parent = createFullscreenSession({ stdout, processRef, onSignal: () => {} });
  parent.enter();

  await withFullscreenSession(parent, async (session) => {
    assert.equal(session.isActive(), true);
  });

  assert.equal(parent.isActive(), true);
  parent.leave();
});
