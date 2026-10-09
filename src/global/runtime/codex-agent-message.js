/**
 * Pure shared reader for Codex `agent_message` items. Used by the Codex adapter
 * (live parsing) and the run-result normalizer (read-time recovery of legacy
 * events), so the shape is defined in exactly one place.
 *
 * Accepts a parsed `codex exec --json` item event and returns the trimmed,
 * non-blank text only for `{type:"item.completed", item:{type:"agent_message", text}}`.
 */
export function codexAgentMessageText(event) {
  if (event == null || typeof event !== "object") return null;
  if (event.type !== "item.completed") return null;
  const item = event.item;
  if (item == null || typeof item !== "object" || item.type !== "agent_message") return null;
  if (typeof item.text !== "string") return null;
  const text = item.text.trim();
  return text === "" ? null : text;
}
