import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  parseOpencodeJsonEvents,
  runOpencodeJson,
  sanitizeCliStderr
} from "../src/global/intelligence/backends/opencode-cli.js";

function createFakeSpawn(lines, { exitCode = 0, stderrLines = [], onSpawn } = {}) {
  return (command, args, options) => {
    onSpawn?.({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = (signal) => {
      child.emit("close", signal === "SIGTERM" ? null : 1);
    };

    setImmediate(() => {
      for (const line of lines) {
        child.stdout.emit("data", `${line}\n`);
      }
      for (const line of stderrLines) {
        child.stderr.emit("data", `${line}\n`);
      }
      child.emit("close", exitCode);
    });

    return child;
  };
}

test("runOpencodeJson uses exact non-mutating args and never --auto", async () => {
  const calls = [];
  const result = await runOpencodeJson({
    modelRef: "opencode/claude-haiku-4-5",
    prompt: "diagnose only",
    cwd: "/tmp/workspace",
    env: { PATH: "/usr/bin" },
    spawnImpl: createFakeSpawn(
      [JSON.stringify({ type: "text", part: { text: "ok" } })],
      {
        onSpawn: (call) => calls.push(call)
      }
    )
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "opencode");
  assert.deepEqual(calls[0].args, [
    "run",
    "--format",
    "json",
    "--model",
    "opencode/claude-haiku-4-5",
    "diagnose only"
  ]);
  assert.ok(!calls[0].args.includes("--auto"));
  assert.equal(calls[0].options.cwd, "/tmp/workspace");
  assert.equal(calls[0].options.env.PATH, "/usr/bin");
  assert.deepEqual(calls[0].options.stdio, ["ignore", "pipe", "pipe"]);
  assert.equal(result.status, 0);
  assert.equal(result.timedOut, false);
  assert.match(result.stdout, /"text"/);
});

test("parseOpencodeJsonEvents concatenates incremental text events", () => {
  const stdout = [
    JSON.stringify({ type: "text", part: { text: "Hello" } }),
    JSON.stringify({ type: "text", text: " " }),
    JSON.stringify({ type: "text", part: { text: "world" } })
  ].join("\n");

  const parsed = parseOpencodeJsonEvents(stdout);
  assert.equal(parsed.content, "Hello world");
  assert.equal(parsed.error, null);
  assert.equal(parsed.events.length, 3);
});

test("parseOpencodeJsonEvents normalizes usage tokens cache and cost", () => {
  const stdout = [
    JSON.stringify({ type: "text", part: { text: "answer" } }),
    JSON.stringify({
      type: "step_finish",
      part: {
        tokens: {
          input: 12,
          output: 4,
          cache: { read: 3 }
        },
        cost: 0.0021
      }
    })
  ].join("\n");

  const parsed = parseOpencodeJsonEvents(stdout);
  assert.equal(parsed.content, "answer");
  assert.deepEqual(parsed.usage, {
    inputTokens: 12,
    outputTokens: 4,
    cachedTokens: 3,
    estimatedCost: 0.0021
  });
});

test("parseOpencodeJsonEvents surfaces structured error events", () => {
  const stdout = JSON.stringify({
    type: "error",
    error: { message: "provider rejected request" }
  });
  const parsed = parseOpencodeJsonEvents(stdout);
  assert.equal(parsed.content, null);
  assert.equal(parsed.error, "provider rejected request");
  assert.equal(parsed.events.length, 1);
});

test("parseOpencodeJsonEvents rejects malformed JSON stdout", () => {
  const parsed = parseOpencodeJsonEvents("not-json\nalso-bad");
  assert.equal(parsed.content, null);
  assert.match(parsed.error, /malformed JSON/i);
  assert.equal(parsed.events.length, 0);
});

function hangChild({ onKill, unref } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  if (unref) child.unref = unref;
  child.kill = (signal) => onKill?.(signal, child) ?? true;
  return child;
}

test("runOpencodeJson supervises SIGTERM → SIGKILL, races, and kill faults", async () => {
  const opts = { timeoutMs: 10, terminationGraceMs: 15, killGraceMs: 15 };
  const modelRef = "opencode/claude-haiku-4-5";

  const termSignals = [];
  const term = await runOpencodeJson({
    modelRef, prompt: "hang", ...opts, terminationGraceMs: 40, killGraceMs: 40,
    spawnImpl: () => hangChild({
      onKill: (signal, child) => {
        termSignals.push(signal);
        if (signal === "SIGTERM") setImmediate(() => child.emit("close", null, "SIGTERM"));
        return true;
      }
    })
  });
  assert.equal(term.timedOut, true);
  assert.equal(term.terminationFailed, false);
  assert.equal(term.signal, "SIGTERM");
  assert.deepEqual(termSignals, ["SIGTERM"]);

  const ignoreSignals = [];
  let unrefed = false;
  const ignored = await runOpencodeJson({
    modelRef, prompt: "hang", ...opts,
    spawnImpl: () => hangChild({
      unref: () => { unrefed = true; },
      onKill: (signal) => { ignoreSignals.push(signal); return true; }
    })
  });
  assert.equal(ignored.terminationFailed, true);
  assert.deepEqual(ignoreSignals, ["SIGTERM", "SIGKILL"]);
  assert.equal(unrefed, true);

  const killSignals = [];
  const killed = await runOpencodeJson({
    modelRef, prompt: "hang", ...opts, killGraceMs: 40,
    spawnImpl: () => hangChild({
      onKill: (signal, child) => {
        killSignals.push(signal);
        if (signal === "SIGKILL") setImmediate(() => child.emit("close", null, "SIGKILL"));
        return true;
      }
    })
  });
  assert.equal(killed.terminationFailed, false);
  assert.equal(killed.signal, "SIGKILL");
  assert.deepEqual(killSignals, ["SIGTERM", "SIGKILL"]);

  const raced = await runOpencodeJson({
    modelRef, prompt: "race", ...opts, terminationGraceMs: 30, killGraceMs: 30,
    spawnImpl: () => hangChild({
      onKill: (signal, child) => {
        if (signal === "SIGTERM") {
          setImmediate(() => child.emit("close", null, "SIGTERM"));
          setImmediate(() => child.emit("close", null, "SIGTERM"));
        }
        throw new Error("kill blew up");
      }
    })
  });
  assert.equal(raced.timedOut, true);
  assert.equal(raced.signal, "SIGTERM");

  const falseKill = await runOpencodeJson({
    modelRef, prompt: "x", ...opts, terminationGraceMs: 10, killGraceMs: 10,
    spawnImpl: () => hangChild({ onKill: () => false })
  });
  assert.equal(falseKill.terminationFailed, true);
});

test("sanitizeCliStderr redacts secrets and limits length", () => {
  const redacted = sanitizeCliStderr(
    "OPENCODE_API_KEY=sk-secret TOKEN: abc123 PASSWORD=p@ss CREDENTIAL=xyz"
  );
  assert.match(redacted, /OPENCODE_API_KEY=\[REDACTED].*TOKEN=\[REDACTED]/);
  assert.ok(!redacted.includes("sk-secret"));
  assert.ok(sanitizeCliStderr("x".repeat(600), { limit: 40 }).endsWith("…"));
});

test("runOpencodeJson rejects spawn process errors", async () => {
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => {
      const error = new Error("spawn opencode ENOENT");
      error.code = "ENOENT";
      child.emit("error", error);
    });
    return child;
  };

  await assert.rejects(
    () =>
      runOpencodeJson({
        modelRef: "opencode/claude-haiku-4-5",
        prompt: "x",
        spawnImpl
      }),
    (error) => error.code === "ENOENT"
  );
});

test("runOpencodeJson captures stderr alongside stdout", async () => {
  const result = await runOpencodeJson({
    modelRef: "opencode/claude-haiku-4-5",
    prompt: "x",
    spawnImpl: createFakeSpawn(
      [JSON.stringify({ type: "text", part: { text: "ok" } })],
      { stderrLines: ["warn: slow"], exitCode: 0 }
    )
  });

  assert.match(result.stdout, /ok/);
  assert.match(result.stderr, /warn: slow/);
});
