import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { probeCursorAuth } from "../src/global/observability/cursor-auth.js";

function fakeSpawn({ stdout = "", stderr = "", code = 0, signal = null, errorEvent = null } = {}) {
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

test("probeCursorAuth always passes --trust — the probe's cwd is an OS tmpdir cursor-agent has never seen, and without --trust a real invocation blocks on an interactive Workspace Trust prompt instead of running", async () => {
  let seenArgs;
  await probeCursorAuth({ spawn: (cmd, args) => { seenArgs = args; return fakeSpawn({ stdout: JSON.stringify({ result: "ok" }) }); } });
  assert.ok(seenArgs.includes("--trust"));
});

test("probeCursorAuth reports authenticated: false with a concrete reason on the real 'Authentication required' failure mode — never trusts status/whoami's unreliable claim", async () => {
  const result = await probeCursorAuth({
    spawn: () => fakeSpawn({ stderr: "Error: Authentication required. Please run 'agent login' first, or set CURSOR_API_KEY environment variable.", code: 0 })
  });
  assert.equal(result.authenticated, false);
  assert.equal(result.status, "measured");
  assert.match(result.reason, /Authentication required/);
});

test("probeCursorAuth reports authenticated: true on a real clean success", async () => {
  const result = await probeCursorAuth({
    spawn: () => fakeSpawn({ stdout: JSON.stringify({ result: "ok" }), code: 0 })
  });
  assert.equal(result.authenticated, true);
  assert.equal(result.status, "measured");
  assert.equal(result.reason, null);
});

test("probeCursorAuth fails closed to 'unknown' (never a false authenticated:true) on a crash, non-zero exit, spawn error, or timeout", async () => {
  const crashed = await probeCursorAuth({ spawn: () => fakeSpawn({ signal: "SIGSEGV", stderr: "boom" }) });
  assert.equal(crashed.authenticated, false);
  assert.equal(crashed.status, "unknown");

  const nonZero = await probeCursorAuth({ spawn: () => fakeSpawn({ code: 1, stderr: "some real failure" }) });
  assert.equal(nonZero.authenticated, false);
  assert.equal(nonZero.status, "unknown");

  const spawnError = await probeCursorAuth({ spawn: () => { throw new Error("cursor-agent: command not found"); } });
  assert.equal(spawnError.authenticated, false);
  assert.equal(spawnError.status, "unknown");
  assert.match(spawnError.reason, /command not found/);

  const timeout = await probeCursorAuth({
    spawn: () => { const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.kill = () => {}; return c; },
    timeoutMs: 5
  });
  assert.equal(timeout.authenticated, false);
  assert.equal(timeout.status, "unknown");
  assert.match(timeout.reason, /timed out/);
});
