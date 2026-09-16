import test from "node:test";
import assert from "node:assert/strict";
import {
  applyEventToMetadata,
  createRunEvent,
  formatTranscriptEventText,
  normalizeAdapterEvent,
  transitionRunState
} from "../src/global/runtime/run-events.js";
import { RUN_STATES } from "../src/global/runtime/run-types.js";
import { createRunMetadata } from "../src/global/runtime/run-types.js";

test("normalizeAdapterEvent maps structured cursor events", () => {
  const event = normalizeAdapterEvent("cursor", {
    type: "tool_call",
    tool_name: "read_file",
    subtype: "started"
  });

  assert.equal(event.type, "agent.tool_call");
  assert.equal(event.source, "cursor");
  assert.equal(event.data.tool_name, "read_file");
});

test("normalizeAdapterEvent redacts prompt-like fields by default", () => {
  const event = normalizeAdapterEvent("cursor", {
    type: "assistant",
    prompt: "secret task",
    content: "do work"
  });

  assert.equal(event.data.prompt, "[REDACTED]");
  assert.equal(event.data.content, "[REDACTED]");
});

test("normalizeAdapterEvent can persist transcript fields when opted in", () => {
  const event = normalizeAdapterEvent(
    "cursor",
    { type: "assistant", content: "visible transcript" },
    { captureTranscript: true }
  );

  assert.equal(event.data.content, "visible transcript");
});

test("applyEventToMetadata tracks tools and token usage", () => {
  let metadata = createRunMetadata({
    runId: "run_1",
    agentId: "cursor",
    provider: "Cursor",
    task: "task",
    cwd: "/tmp",
    cliVersion: "0.2.1"
  });

  metadata = applyEventToMetadata(metadata, normalizeAdapterEvent("cursor", {
    type: "tool_call",
    tool_name: "shell"
  }));
  metadata = applyEventToMetadata(metadata, normalizeAdapterEvent("cursor", {
    type: "usage",
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    cost: 0.01
  }));

  assert.deepEqual(metadata.tools, ["shell"]);
  assert.deepEqual(metadata.tokenUsage, { input: 10, output: 5, total: 15 });
  assert.equal(metadata.cost, 0.01);
});

test("transitionRunState sets terminal timestamps", () => {
  const metadata = createRunMetadata({
    runId: "run_1",
    agentId: "cursor",
    provider: "Cursor",
    task: "task",
    cwd: "/tmp",
    cliVersion: "0.2.1"
  });

  const next = transitionRunState(metadata, RUN_STATES.COMPLETED, { exitCode: 0 });
  assert.equal(next.state, RUN_STATES.COMPLETED);
  assert.equal(next.exitCode, 0);
  assert.ok(next.completedAt);
});

test("createRunEvent never stores secrets in data", () => {
  const event = createRunEvent({
    runId: "run_1",
    type: "run.started",
    data: { apiKey: "sk-1234567890abcdefghijklmnop" }
  });

  assert.equal(event.data.apiKey, "[REDACTED]");
});

test("formatTranscriptEventText extracts a flat text/content string", () => {
  assert.equal(formatTranscriptEventText({ text: "Reading src/index.js…" }), "Reading src/index.js…");
  assert.equal(formatTranscriptEventText({ content: "Done." }), "Done.");
  assert.equal(formatTranscriptEventText("already a string"), "already a string");
});

test("formatTranscriptEventText joins a real Anthropic-style content-block array", () => {
  const data = { content: [{ type: "text", text: "I'll check the " }, { type: "text", text: "test suite first." }] };
  assert.equal(formatTranscriptEventText(data), "I'll check the test suite first.");
});

test("formatTranscriptEventText recurses into a nested message object", () => {
  const data = { message: { content: [{ type: "text", text: "Looking at the diff." }] } };
  assert.equal(formatTranscriptEventText(data), "Looking at the diff.");
});

test("formatTranscriptEventText falls back to result, then to a raw JSON dump — never silently drops real content", () => {
  assert.equal(formatTranscriptEventText({ result: "All tests passed." }), "All tests passed.");
  const unrecognized = { rawType: "weird_event", payload: { foo: "bar" } };
  const fallback = formatTranscriptEventText(unrecognized);
  assert.equal(fallback, JSON.stringify(unrecognized));
});

test("formatTranscriptEventText never throws on null/empty/non-string content-block text", () => {
  assert.equal(formatTranscriptEventText(null), "");
  assert.equal(formatTranscriptEventText({}), "{}");
  assert.equal(formatTranscriptEventText({ content: [{ type: "image", url: "x" }] }), JSON.stringify({ content: [{ type: "image", url: "x" }] }));
});
