import assert from "node:assert/strict";
import { test } from "node:test";
import { mapPiMessagesToTranscriptRows } from "../src/global/host/pi-rpc-transcript.js";

test("mapPiMessagesToTranscriptRows keeps user and assistant text", () => {
  const rows = mapPiMessagesToTranscriptRows([
    {
      role: "user",
      content: [{ type: "text", text: "  hello  " }]
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "world" }]
    }
  ]);
  assert.deepEqual(rows, [
    { type: "user_message", content: "hello" },
    { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "world" } },
    { type: "agent_settled" }
  ]);
});

test("mapPiMessagesToTranscriptRows maps compaction summaries to system rows", () => {
  const rows = mapPiMessagesToTranscriptRows([
    { role: "compactionSummary", summary: "Earlier work summarized" }
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, "system_message");
  assert.match(rows[0].content, /compaction/);
});

test("mapPiMessagesToTranscriptRows keeps thinking blocks distinct from text", () => {
  const rows = mapPiMessagesToTranscriptRows([
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "considering options" },
        { type: "text", text: "here is the answer" }
      ]
    }
  ]);
  assert.deepEqual(rows, [
    { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "considering options" } },
    { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "here is the answer" } },
    { type: "agent_settled" }
  ]);
});

test("mapPiMessagesToTranscriptRows reconstructs tool-call/tool-result pairs and marks errors", () => {
  const rows = mapPiMessagesToTranscriptRows([
    {
      role: "assistant",
      content: [{ type: "toolCall", id: "call-1", name: "Read", arguments: {} }]
    },
    {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "Read",
      content: [{ type: "text", text: "ENOENT: missing" }],
      isError: true
    }
  ]);
  assert.deepEqual(rows, [
    { type: "tool_execution_start", toolCallId: "call-1", toolName: "Read" },
    {
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "Read",
      isError: true,
      result: { content: [{ type: "text", text: "ENOENT: missing" }] }
    },
    { type: "agent_settled" }
  ]);
  assert.ok(
    !rows.some((r) => r.type === "tool_execution_update"),
    "restore must not invent intermediate progress Pi did not persist"
  );
});

test("mapPiMessagesToTranscriptRows restores final tool result content by toolCallId", () => {
  const rows = mapPiMessagesToTranscriptRows([
    {
      role: "assistant",
      content: [
        { type: "toolCall", id: "a", name: "Read", arguments: {} },
        { type: "toolCall", id: "b", name: "Bash", arguments: {} }
      ]
    },
    {
      role: "toolResult",
      toolCallId: "a",
      toolName: "Read",
      content: [{ type: "text", text: "file-a" }],
      isError: false
    },
    {
      role: "toolResult",
      toolCallId: "b",
      toolName: "Bash",
      content: [{ type: "text", text: "bash-b" }],
      isError: false
    }
  ]);
  const starts = rows.filter((r) => r.type === "tool_execution_start");
  const ends = rows.filter((r) => r.type === "tool_execution_end");
  assert.deepEqual(
    starts.map((r) => r.toolCallId),
    ["a", "b"]
  );
  assert.deepEqual(
    ends.map((r) => ({ id: r.toolCallId, text: r.result.content[0].text })),
    [
      { id: "a", text: "file-a" },
      { id: "b", text: "bash-b" }
    ]
  );
  assert.ok(!rows.some((r) => r.type === "tool_execution_update"));
});

test("mapPiMessagesToTranscriptRows surfaces a terminal assistant error distinctly", () => {
  const rows = mapPiMessagesToTranscriptRows([
    {
      role: "assistant",
      content: [{ type: "text", text: "partial answer" }],
      stopReason: "error",
      errorMessage: "provider timeout"
    }
  ]);
  assert.deepEqual(rows, [
    { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "partial answer" } },
    {
      type: "message_update",
      assistantMessageEvent: { type: "error", error: { errorMessage: "provider timeout" } }
    },
    { type: "agent_settled" }
  ]);
});

test("mapPiMessagesToTranscriptRows reconstructs a full mixed turn in live order", () => {
  const rows = mapPiMessagesToTranscriptRows([
    { role: "user", content: [{ type: "text", text: "do the thing" }] },
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "planning" },
        { type: "text", text: "on it" },
        { type: "toolCall", id: "call-1", name: "Bash", arguments: {} }
      ]
    },
    {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "Bash",
      content: [],
      isError: false
    }
  ]);
  assert.deepEqual(
    rows.map((r) => r.type),
    [
      "user_message",
      "message_update",
      "message_update",
      "tool_execution_start",
      "tool_execution_end",
      "agent_settled"
    ]
  );
  assert.equal(rows[1].assistantMessageEvent.type, "thinking_delta");
  assert.equal(rows[2].assistantMessageEvent.type, "text_delta");
});
