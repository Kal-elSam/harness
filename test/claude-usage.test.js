import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { parseClaudeUsageText, readClaudeUsage } from "../src/global/observability/claude-usage.js";

function fakeSpawn({ resultText, malformed = false, wrongShape = false, closeCode = 0, delay = 0 } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdin = { write() {} };
  child.kill = () => {};
  setTimeout(() => {
    if (malformed) {
      child.stdout.emit("data", "not-json");
    } else if (wrongShape) {
      child.stdout.emit("data", JSON.stringify({ local_command: "something-else", result: 42 }));
    } else {
      child.stdout.emit("data", JSON.stringify({ local_command: "usage", result: resultText }));
    }
    child.emit("close", closeCode);
  }, delay);
  return child;
}

test("parses session and weekly usage lines into normalized windows", () => {
  const text = [
    "You are currently using your subscription to power your Claude Code usage",
    "",
    "Current session: 0% used · resets Sep 11 at 7:09pm (America/Mexico_City)",
    "Current week (all models): 7% used · resets Sep 13 at 7:59am (America/Mexico_City)",
    "",
    "What's contributing to your limits usage?"
  ].join("\n");

  const windows = parseClaudeUsageText(text);
  assert.equal(windows.length, 2);
  assert.deepEqual(windows[0], {
    label: "Current session", usedPercent: 0, remainingPercent: 100,
    resetsAt: "Sep 11 at 7:09pm (America/Mexico_City)"
  });
  assert.deepEqual(windows[1], {
    label: "Current week (all models)", usedPercent: 7, remainingPercent: 93,
    resetsAt: "Sep 13 at 7:59am (America/Mexico_City)"
  });
});

test("reads real session/weekly percentages from claude -p \"/usage\" at zero cost", async () => {
  const result = await readClaudeUsage({
    spawn: () => fakeSpawn({
      resultText: "Current session: 34% used · resets Sep 11 at 8pm\nCurrent week (all models): 61% used · resets Sep 14 at 9am"
    })
  });
  assert.equal(result.status, "measured");
  assert.equal(result.primary.label, "Current session");
  assert.equal(result.primary.remainingPercent, 66);
  assert.equal(result.secondary.label, "Current week (all models)");
  assert.equal(result.secondary.remainingPercent, 39);
  assert.equal(result.error, null);
});

test("fails closed to unknown on malformed JSON, wrong response shape, or unparseable text", async () => {
  const malformed = await readClaudeUsage({ spawn: () => fakeSpawn({ malformed: true }) });
  assert.equal(malformed.status, "unknown");

  const wrongShape = await readClaudeUsage({ spawn: () => fakeSpawn({ wrongShape: true }) });
  assert.equal(wrongShape.status, "unknown");

  const noWindows = await readClaudeUsage({ spawn: () => fakeSpawn({ resultText: "nothing usage-shaped here" }) });
  assert.equal(noWindows.status, "unknown");
});

test("fails closed to unknown on timeout without leaving the child process running", async () => {
  let killed = false;
  const spawn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = () => { killed = true; };
    return child; // never emits close — simulates a hang
  };
  const result = await readClaudeUsage({ spawn, timeoutMs: 5 });
  assert.equal(result.status, "unknown");
  assert.match(result.error, /timed out/);
  assert.equal(killed, true);
});

test("fails closed to unknown when spawning the claude binary itself throws", async () => {
  const result = await readClaudeUsage({
    spawn: () => { throw new Error("claude: command not found"); }
  });
  assert.equal(result.status, "unknown");
  assert.match(result.error, /command not found/);
});
