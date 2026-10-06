import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import codex from "../src/global/runtime/execution-adapters/codex.js";
import { startRun, stopRun } from "../src/global/runtime/run-manager.js";
import { readRunEvents } from "../src/global/runtime/run-store.js";
import { normalizeRunResult } from "../src/global/kernel/run-result-normalizer.js";
import { composeTaskResult } from "../src/global/conversation/task-result.js";
import { pubTaskResult } from "../src/global/conversation/operations.js";

// ASSUMPTION: event shapes are hand-written copies of the shapes observed in one
// real `codex exec --json` run (thread.started, turn.started, item.started /
// item.completed with item.type agent_message | command_execution, and a
// terminal usage payload). Only fields the repo's parser reads are relied upon.
const THREAD = { type: "thread.started", thread_id: "t-fixture" };
const TURN = { type: "turn.started" };
const msg = (text) => ({ type: "item.completed", item: { id: "i", type: "agent_message", text } });
const CMD_STARTED = { type: "item.started", item: { id: "c", type: "command_execution", command: "/bin/zsh -lc 'rg x'", status: "in_progress" } };
const CMD_DONE = { type: "item.completed", item: { id: "c", type: "command_execution", command: "/bin/zsh -lc 'rg x'", aggregated_output: "SECRET-LOOKING OUTPUT", exit_code: 0, status: "completed" } };
const TURN_DONE = { type: "turn.completed", usage: { input_tokens: 140833, cached_input_tokens: 0, output_tokens: 776 } };

const INTRO = "I will verify each claim against the sources.";
const FINAL = "Verdict\n\n1. Claim A: CONFIRMED.\n2. Claim B: WRONG.\n\nSummary: 1 confirmed, 1 wrong.";

async function runWith(lines, exitCode = 0, { cancel = false } = {}) {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-codex-summary-"));
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 6161;
    child.kill = () => child.emit("close", 130);
    setImmediate(() => {
      child.stdout.emit("data", "Reading additional input from stdin...\n");
      for (const l of lines) child.stdout.emit("data", `${JSON.stringify(l)}\n`);
      if (!cancel) child.emit("close", exitCode);
    });
    return child;
  };
  const { runId, completion } = await startRun({
    homeDir, agentId: "codex", task: "review", cwd: homeDir, captureTranscript: true,
    resolveAdapterImpl: () => ({ ...codex, preflight: async () => ({ ok: true }) }),
    spawnImpl
  });
  if (cancel) {
    await new Promise((r) => setTimeout(r, 50));
    await stopRun(homeDir, runId);
  }
  const final = await completion;
  const events = await readRunEvents(homeDir, runId);
  return { homeDir, runId, final, events, result: normalizeRunResult({ runId, metadata: final, events }) };
}

test("summary is the LAST agent_message (multi-paragraph preserved), not the intro", async () => {
  const { final, result } = await runWith([THREAD, TURN, msg(INTRO), CMD_STARTED, CMD_DONE, msg(FINAL), TURN_DONE]);
  assert.equal(final.state, "completed");
  assert.equal(result.ok, true);
  assert.equal(result.status, "completed");
  assert.equal(result.summary, FINAL);
});

test("a run whose only agent_message is the intro uses it as the summary", async () => {
  const { result } = await runWith([THREAD, TURN, msg(INTRO), TURN_DONE]);
  assert.equal(result.status, "completed");
  assert.equal(result.summary, INTRO);
});

test("command_execution items and usage do not pollute the summary", async () => {
  const { result } = await runWith([THREAD, TURN, msg(FINAL), CMD_STARTED, CMD_DONE, TURN_DONE]);
  // Last agent_message wins even if command items trail it.
  assert.equal(result.summary, FINAL);
  assert.ok(!result.summary.includes("SECRET-LOOKING"));
});

test("no agent_message at all stays typed as no summary produced", async () => {
  const { result } = await runWith([THREAD, TURN, CMD_STARTED, CMD_DONE, TURN_DONE]);
  assert.equal(result.ok, false);
  assert.equal(result.status, "failed");
  assert.equal(result.error, "no summary produced");
  assert.equal(result.summary, null);
});

test("empty or non-string agent_message text is not a summary", async () => {
  const { result } = await runWith([THREAD, msg("   "), { type: "item.completed", item: { type: "agent_message" } }, TURN_DONE]);
  assert.equal(result.error, "no summary produced");
});

test("failed run (exit 1) is never a completed result from partial messages", async () => {
  const { final, result } = await runWith([THREAD, msg(INTRO)], 1);
  assert.equal(final.state, "failed");
  assert.equal(result.ok, false);
  assert.equal(result.status, "failed");
});

test("cancelled run stays cancelled and never ok, partial text is not a completed result", async () => {
  const { final, result } = await runWith([THREAD, TURN, msg(INTRO)], 0, { cancel: true });
  assert.equal(final.state, "cancelled");
  assert.equal(result.ok, false);
  assert.equal(result.status, "cancelled");
});

test("token usage lands in run metadata without an invented cost", async () => {
  const { final } = await runWith([THREAD, TURN, msg(FINAL), TURN_DONE]);
  assert.equal(final.tokenUsage?.input, 140833);
  assert.equal(final.tokenUsage?.output, 776);
  assert.equal(final.tokenUsage?.total ?? null, null);
  assert.equal(final.cost ?? null, null);
});

test("shared taskResult projection exposes the Codex summary under the 500-char cap; service path keeps it raw", async () => {
  const long = `${"Paragraph. ".repeat(100)}END`;
  const { homeDir, runId, final, events } = await runWith([THREAD, TURN, msg(long), TURN_DONE]);
  const composed = await composeTaskResult({
    taskId: "t1", projectRoot: homeDir, link: { runId, agentId: "codex" },
    readRun: async () => final, readEvents: async () => events,
    normalize: normalizeRunResult,
    associate: ({ result }) => ({ result, reviewRef: { association: "unavailable" } }),
    readGentleContext: async () => ({})
  });
  assert.equal(composed.status, "terminal");
  assert.equal(composed.result.summary, long);
  const pub = pubTaskResult(composed);
  assert.equal(pub.result.status, "completed");
  assert.ok(pub.result.summary.length <= 503); // existing cap: 500 chars + "..." suffix
  assert.ok(pub.result.summary.endsWith("..."));
  assert.ok(pub.result.summary.startsWith("Paragraph."));
});
