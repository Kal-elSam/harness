/**
 * Map Pi `get_messages` payloads into ratatui host transcript rows.
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

/**
 * @param {unknown[]|null|undefined} messages
 * @returns {Array<{ role: "user"|"assistant"|"system", content: string }>}
 */
export function mapPiMessagesToTranscriptRows(messages) {
  if (!Array.isArray(messages)) return [];
  const rows = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const role = msg.role;
    if (role === "user") {
      const content = textFromContent(msg.content);
      if (content) rows.push({ role: "user", content });
    } else if (role === "assistant") {
      const content = textFromContent(msg.content);
      if (content) rows.push({ role: "assistant", content });
    } else if (role === "compactionSummary" && typeof msg.summary === "string") {
      const summary = msg.summary.trim();
      if (summary) {
        rows.push({
          role: "system",
          content: `[compaction] ${summary}`
        });
      }
    }
  }
  return rows;
}
