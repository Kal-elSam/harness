import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import codex from "../src/global/runtime/execution-adapters/codex.js";
import { codexAgentMessageText } from "../src/global/runtime/codex-agent-message.js";
import { normalizeRunResult } from "../src/global/kernel/run-result-normalizer.js";
import { composeTaskResult } from "../src/global/conversation/task-result.js";
import { pubTaskResult } from "../src/global/conversation/operations.js";
import { runPaths } from "../src/global/paths.js";
import { readRunEvents } from "../src/global/runtime/run-store.js";

// Hand-written fixtures: the legacy persisted shape wraps the raw codex item as
// agent.system { rawType, payload } instead of mapping it to an assistant event.
const RUN = "run_fixture_1";
const INTRO = "Intro: I will check the claims.";
const FINAL = "Verdict\n\n1. A: CONFIRMED.\n2. B: WRONG.";
const legacy = (text, over = {}) => ({
  type: "agent.system", source: "codex", runId: RUN,
  data: { rawType: "item.completed", payload: { item: { type: "agent_message", text } } },
  ...over
});
const transcript = (text) => ({ type: "run.transcript", source: "codex", runId: RUN, data: { text } });
const meta = (state, extra = {}) => ({ agentId: "codex", state, ...extra });
const run = (state, events, metaExtra) => normalizeRunResult({ runId: RUN, metadata: meta(state, metaExtra), events });

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

test("helper: returns trimmed text only for item.completed agent_message", () => {
  assert.equal(codexAgentMessageText({ type: "item.completed", item: { type: "agent_message", text: "  hi \n" } }), "hi");
  for (const bad of [
    null, undefined, "x", 3, [],
    { type: "item.started", item: { type: "agent_message", text: "x" } },
    { type: "item.completed", item: { type: "command_execution", text: "x" } },
    { type: "item.completed", item: { type: "agent_message", text: "   " } },
    { type: "item.completed", item: { type: "agent_message", text: 5 } },
    { type: "item.completed", item: { type: "agent_message" } },
    { type: "item.completed", item: null },
    { type: "item.completed" }
  ]) {
    assert.equal(codexAgentMessageText(bad), null);
  }
});

test("adapter maps agent_message through the shared helper contract", () => {
  const line = JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "hello" } });
  assert.deepEqual(codex.parseEventLine(line), { type: "assistant", text: "hello" });
  const blank = JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "  " } });
  assert.notEqual(codex.parseEventLine(blank)?.type, "assistant");
});

test("modern run.transcript has absolute priority over historical messages", () => {
  const r = run("completed", [legacy(INTRO), transcript("modern"), legacy(FINAL)]);
  assert.equal(r.ok, true);
  assert.equal(r.summary, "modern");
});

test("without transcript the LAST historical agent_message wins, intro ignored", () => {
  const r = run("completed", [legacy(INTRO), { type: "agent.system", source: "codex", runId: RUN, data: { rawType: "turn.started" } }, legacy(FINAL)]);
  assert.equal(r.ok, true);
  assert.equal(r.status, "completed");
  assert.equal(r.summary, FINAL);
});

test("wrong source or wrong runId events are ignored", () => {
  assert.equal(run("completed", [legacy(FINAL, { source: "claude" })]).error, "no summary produced");
  assert.equal(run("completed", [legacy(FINAL, { runId: "other" })]).error, "no summary produced");
  assert.equal(run("completed", [legacy(INTRO), legacy(FINAL, { runId: "other" })]).summary, INTRO);
  assert.equal(run("completed", [legacy(FINAL)], { agentId: "claude" }).error, "no summary produced");
});

test("event without runId is accepted when source and provider match", () => {
  const ev = legacy(FINAL);
  delete ev.runId;
  assert.equal(run("completed", [ev]).summary, FINAL);
});

test("an existing run.transcript event, even empty, blocks the fallback", () => {
  const r = run("completed", [legacy(FINAL), transcript("   ")]);
  assert.equal(r.ok, false);
  assert.equal(r.error, "no summary produced");
});

test("no messages at all keeps 'no summary produced'", () => {
  const r = run("completed", [{ type: "agent.system", source: "codex", data: { rawType: "turn.started" } }]);
  assert.equal(r.ok, false);
  assert.equal(r.error, "no summary produced");
  assert.equal(r.summary, null);
});

test("failed/cancelled/interrupted keep their state; recovered text is only a summary", () => {
  const failed = run("failed", [legacy(FINAL)], { error: "boom" });
  assert.equal(failed.ok, false);
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "boom");
  assert.equal(failed.summary, FINAL);
  const cancelled = run("cancelled", [legacy(FINAL)]);
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.status, "cancelled");
  const interrupted = run("interrupted", [legacy(FINAL)]);
  assert.equal(interrupted.ok, false);
  assert.equal(interrupted.status, "failed");
});

test("corrupt evidence never throws and is ignored", () => {
  const events = [
    null, 5, "x", [], { type: "agent.system", source: "codex" },
    { type: "agent.system", source: "codex", data: null },
    { type: "agent.system", source: "codex", data: { rawType: "item.completed" } },
    { type: "agent.system", source: "codex", data: { rawType: "item.completed", payload: null } },
    { type: "agent.system", source: "codex", data: { rawType: "item.completed", payload: { item: { type: "agent_message", text: 7 } } } },
    legacy(FINAL)
  ];
  assert.equal(run("completed", events).summary, FINAL);
  assert.equal(run("completed", events.slice(0, -1)).error, "no summary produced");
});

test("inputs are never mutated", () => {
  const events = deepFreeze([legacy(INTRO), legacy(FINAL)]);
  const metadata = deepFreeze(meta("completed"));
  const r = normalizeRunResult({ runId: RUN, metadata, events });
  assert.equal(r.summary, FINAL);
});

test("shared result path recovers a legacy run from a temp HARNESS_HOME and projection stays capped", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-legacy-summary-"));
  const long = `${"Paragraph. ".repeat(100)}END`;
  const { runDir, eventsPath } = runPaths(homeDir, RUN);
  await mkdir(runDir, { recursive: true });
  const events = [legacy(INTRO), legacy(long)];
  await writeFile(eventsPath, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);
  const stored = await readRunEvents(homeDir, RUN);
  const composed = await composeTaskResult({
    taskId: "t1", projectRoot: homeDir, link: { runId: RUN, agentId: "codex" },
    readRun: async () => meta("completed"), readEvents: async () => stored,
    normalize: normalizeRunResult,
    associate: ({ result }) => ({ result, reviewRef: { association: "unavailable" } }),
    readGentleContext: async () => ({})
  });
  assert.equal(composed.status, "terminal");
  assert.equal(composed.result.summary, long);
  const pub = pubTaskResult(composed);
  assert.equal(pub.result.status, "completed");
  assert.ok(pub.result.summary.length <= 503);
  assert.ok(pub.result.summary.endsWith("..."));
});
