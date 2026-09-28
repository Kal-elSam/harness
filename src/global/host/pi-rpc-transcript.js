/**
 * Map Pi `get_messages` payloads into ratatui host transcript rows.
 *
 * Rows are shaped like the same live sidecar/bridge events the ratatui host's
 * `ChatState::apply_sidecar_event` reducer already consumes (`message_update`
 * with a `text_delta`/`thinking_delta`/`error` assistantMessageEvent,
 * `tool_execution_start`/`tool_execution_end`, `agent_settled`), plus two
 * replay-only markers (`user_message`, `system_message`) for the turns the
 * live stream never emits as bridge events (the human's own messages and
 * synthetic system rows). Reusing the live event shape means the Rust host
 * can replay history through the SAME reducer it uses for a live stream —
 * text, thinking, tool-call/result, and error rows never diverge between a
 * live session and one restored via `switch_session`/`new_session`.
 */

function textFromContent(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function indexToolResultsByCallId(messages) {
  const byCallId = new Map();
  for (const msg of messages) {
    if (msg?.role === "toolResult" && typeof msg.toolCallId === "string") {
      byCallId.set(msg.toolCallId, msg);
    }
  }
  return byCallId;
}

/**
 * @param {unknown[]|null|undefined} messages
 * @returns {Array<object>} sidecar-event-shaped rows, in live order
 */
export function mapPiMessagesToTranscriptRows(messages) {
  if (!Array.isArray(messages)) return [];
  const rows = [];
  const toolResultsByCallId = indexToolResultsByCallId(messages);

  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;

    if (msg.role === "user") {
      const content = textFromContent(msg.content);
      if (content) rows.push({ type: "user_message", content });
      continue;
    }

    if (msg.role === "compactionSummary" && typeof msg.summary === "string") {
      const summary = msg.summary.trim();
      if (summary) rows.push({ type: "system_message", content: `[compaction] ${summary}` });
      continue;
    }

    if (msg.role !== "assistant") continue;

    let wroteRow = false;
    const blocks = Array.isArray(msg.content) ? msg.content : [];
    for (const block of blocks) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "text" && typeof block.text === "string") {
        const text = block.text.trim();
        if (text) {
          rows.push({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: text } });
          wroteRow = true;
        }
      } else if (block.type === "thinking" && typeof block.thinking === "string") {
        const thinking = block.thinking.trim();
        if (thinking) {
          rows.push({
            type: "message_update",
            assistantMessageEvent: { type: "thinking_delta", delta: thinking }
          });
          wroteRow = true;
        }
      } else if (block.type === "toolCall" && typeof block.name === "string") {
        rows.push({ type: "tool_execution_start", toolName: block.name });
        wroteRow = true;
        const result = toolResultsByCallId.get(block.id);
        if (result) {
          rows.push({
            type: "tool_execution_end",
            toolName: block.name,
            isError: Boolean(result.isError)
          });
        }
      }
    }

    if (msg.stopReason === "error" || msg.stopReason === "aborted") {
      const errorMessage =
        typeof msg.errorMessage === "string" && msg.errorMessage.trim()
          ? msg.errorMessage.trim()
          : `assistant ${msg.stopReason}`;
      rows.push({
        type: "message_update",
        assistantMessageEvent: { type: "error", error: { errorMessage } }
      });
      wroteRow = true;
    }

    if (wroteRow) rows.push({ type: "agent_settled" });
  }

  return rows;
}
