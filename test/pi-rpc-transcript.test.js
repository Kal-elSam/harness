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
    { role: "user", content: "hello" },
    { role: "assistant", content: "world" }
  ]);
});

test("mapPiMessagesToTranscriptRows maps compaction summaries to system rows", () => {
  const rows = mapPiMessagesToTranscriptRows([
    { role: "compactionSummary", summary: "Earlier work summarized" }
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, "system");
  assert.match(rows[0].content, /compaction/);
});
