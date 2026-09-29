// Rebuilds stored ASK turns (ask-events-store.js) into transcript rows and
// merges them into the Pi rows the sidecar emits as `{type:"transcript"}`.
//
// The Rust host replays those rows through `ChatState::
// replace_from_sidecar_transcript` (crates/kairo-ui/src/chat.rs): the
// replay-only `user_message` / `system_message` rows plus Pi-event-shaped rows
// (`message_update` text_delta/error, `tool_execution_start/end`,
// `agent_settled`) fed to the live Pi reducer. So restoring means producing the
// rows whose replay yields the SAME visible messages the live
// `apply_provider_event` + `task_result` path created. The mapping (live Rust
// -> replay row) implemented by `visibleRowsForTurn` + `toTranscriptRows`:
//
//   user prompt                 -> user_message {content}            (Rust trims; skipped when empty)
//   text (non-empty)            -> Assistant row; consecutive text merges into
//                                  the open row -> message_update text_delta
//   progress                    -> ONE System "… <summary>" row per turn,
//                                  removed at the terminal -> never visible
//                                  (but it does split a following text run)
//   tool_start / tool_end       -> ONE Tool row per id ("▶ name …" / "✓|✖ name",
//                                  ok=false -> error) -> tool_execution_start/end
//   error (informational)       -> Error row -> message_update error
//   failed {message}            -> Error row, unless the turn's latest
//                                  informational error had the same message
//   cancelled                   -> System row "Cancelled" -> system_message
//   answer (no text streamed)   -> System row "<provider> · <model>: <answer>"
//                                  (or "<provider>: <answer>"), i.e. what
//                                  `push_kairo_reply` renders -> system_message
//   final / unknown kinds       -> nothing
//
// One more live rule is mirrored: when a turn fails before ANY provider event
// was applied, the host's `{type:"error"}` handling (`revert_failed_prompt`)
// pops the just-added user row and puts the prompt back in the editor. So a
// `failed` turn with no non-terminal events restores WITHOUT its user row.

const ACTIVITY_PREFIX = "… ";
const CANCELLED_MARKER = "Cancelled";

function providerMessage(ev) {
  return typeof ev.message === "string" && ev.message.trim() ? ev.message : "provider error";
}

/**
 * Simulates the live Rust reducer for one turn and returns its visible
 * messages (before the user row): `{role, content, streaming?, ...}`.
 * @param {{events: object[], status: string|null}} turn
 */
export function visibleRowsForTurn(turn) {
  const msgs = [];
  let hasText = false;
  let activityIdx = null;
  let lastError = null;

  const findTool = (id) => {
    if (id == null) return null;
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      if (msgs[i].role === "tool" && msgs[i].toolCallId === id) return msgs[i];
    }
    return null;
  };
  const applyTool = (ev, failed) => {
    const name = typeof ev.name === "string" ? ev.name : "tool";
    const id = typeof ev.id === "string" ? ev.id : null;
    const state = failed === null ? "running" : "done";
    const isError = failed === true;
    const row = findTool(id);
    if (row) {
      row.state = state;
      row.isError = isError;
      row.toolName = name;
      return;
    }
    msgs.push({ role: "tool", toolName: name, toolCallId: id, state, isError });
  };
  const finish = () => {
    for (const m of msgs) m.streaming = false;
    if (activityIdx !== null) {
      if (msgs[activityIdx]?.content?.startsWith(ACTIVITY_PREFIX)) msgs.splice(activityIdx, 1);
      activityIdx = null;
    }
  };

  for (const ev of turn.events) {
    switch (ev.kind) {
      case "text": {
        if (typeof ev.text !== "string" || ev.text === "") break;
        hasText = true;
        const last = msgs.at(-1);
        if (last && last.role === "assistant" && last.streaming) last.content += ev.text;
        else msgs.push({ role: "assistant", content: ev.text, streaming: true });
        break;
      }
      case "progress": {
        const summary = typeof ev.summary === "string" ? ev.summary.trim() : "";
        if (!summary) break;
        const content = `${ACTIVITY_PREFIX}${summary}`;
        if (activityIdx !== null && msgs[activityIdx]?.role === "system"
          && msgs[activityIdx].content.startsWith(ACTIVITY_PREFIX)) {
          msgs[activityIdx].content = content;
        } else {
          msgs.push({ role: "system", content });
          activityIdx = msgs.length - 1;
        }
        break;
      }
      case "tool_start":
        applyTool(ev, null);
        break;
      case "tool_end":
        applyTool(ev, ev.ok === false);
        break;
      case "error": {
        const message = providerMessage(ev);
        msgs.push({ role: "error", content: message });
        lastError = message;
        break;
      }
      case "answer": {
        if (hasText) break;
        const provider = typeof ev.provider === "string" && ev.provider ? ev.provider : "kairo";
        const text = typeof ev.text === "string" ? ev.text : "";
        const label = typeof ev.model === "string" && ev.model
          ? `${provider} · ${ev.model}: ${text}`
          : `${provider}: ${text}`;
        if (label.trim()) msgs.push({ role: "system", content: label.trim() });
        break;
      }
      default:
        break;
    }
  }

  if (turn.status === "failed") {
    const message = providerMessage({ message: turn.message });
    finish();
    if (lastError !== message) msgs.push({ role: "error", content: message });
  } else if (turn.status === "cancelled") {
    finish();
    msgs.push({ role: "system", content: CANCELLED_MARKER });
  } else {
    // `done`, or a turn interrupted before its terminal record.
    finish();
  }
  return msgs;
}

function toTranscriptRows(msgs) {
  const rows = [];
  let prevAssistant = false;
  let anyAssistant = false;
  for (const m of msgs) {
    if (m.role === "assistant") {
      // Two adjacent Assistant rows stay separate live; settle between them
      // so the replay does not merge them into one.
      if (prevAssistant) rows.push({ type: "agent_settled" });
      rows.push({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: m.content } });
      prevAssistant = true;
      anyAssistant = true;
      continue;
    }
    prevAssistant = false;
    if (m.role === "tool") {
      const base = { toolName: m.toolName };
      if (m.toolCallId) base.toolCallId = m.toolCallId;
      // An id-less finished row exists live only as the row a bare tool_end
      // created, so replay just that; every other row replays start (+ end).
      if (!(m.state === "done" && !m.toolCallId)) rows.push({ type: "tool_execution_start", ...base });
      if (m.state === "done") rows.push({ type: "tool_execution_end", ...base, isError: m.isError === true });
    } else if (m.role === "error") {
      rows.push({
        type: "message_update",
        assistantMessageEvent: { type: "error", error: { errorMessage: m.content } }
      });
    } else if (m.role === "system") {
      rows.push({ type: "system_message", content: m.content });
    }
  }
  if (anyAssistant) rows.push({ type: "agent_settled" });
  return rows;
}

/** Transcript rows for one stored turn: `user_message` first, then the visible rows. */
export function transcriptRowsForTurn(turn, { includeUser = true } = {}) {
  const rows = [];
  const prompt = typeof turn.prompt === "string" ? turn.prompt.trim() : "";
  const applied = turn.events.length > 0;
  // Live, a turn that failed before any event was applied loses its user row
  // (`revert_failed_prompt`): the prompt returns to the editor instead.
  const revertedByEarlyFailure = turn.status === "failed" && !applied;
  if (includeUser && prompt && !revertedByEarlyFailure) rows.push({ type: "user_message", content: prompt });
  rows.push(...toTranscriptRows(visibleRowsForTurn(turn)));
  return rows;
}

/**
 * Inserts the stored turns into `piRows` without removing or reordering any Pi
 * row. Each turn goes after the first `piAnchor` Pi rows (clamped to the row
 * count); a `null` anchor means "at the end". Turn order is always preserved:
 * a turn never lands before an earlier turn, so an anchor smaller than its
 * predecessor's (e.g. after a compaction shrank the Pi history) is raised to
 * the predecessor's. Same-anchor turns keep turn order.
 *
 * Duplicate guard: a turn's `user_message` is omitted when the Pi row right
 * before its insertion point is a `user_message` with identical text and no
 * earlier ASK turn was inserted at that point. A real earlier Pi prompt with
 * that text would normally be followed by an assistant reply, so an unanswered
 * identical Pi user row directly before the anchor is the same submission.
 * @param {object[]} piRows
 * @param {Array<object>} turns from readAskTurns
 */
export function mergeAskTurnsIntoRows(piRows, turns) {
  const pi = Array.isArray(piRows) ? piRows : [];
  if (!Array.isArray(turns) || turns.length === 0) return pi;
  const byAnchor = new Map();
  let floor = 0;
  for (const turn of turns) {
    const wanted = turn.piAnchor === null || turn.piAnchor === undefined ? pi.length : turn.piAnchor;
    const anchor = Math.min(pi.length, Math.max(floor, wanted));
    floor = anchor;
    if (!byAnchor.has(anchor)) byAnchor.set(anchor, []);
    byAnchor.get(anchor).push(turn);
  }
  const out = [];
  const insertAt = (position) => {
    const group = byAnchor.get(position);
    if (!group) return;
    group.forEach((turn, index) => {
      const before = pi[position - 1];
      const prompt = typeof turn.prompt === "string" ? turn.prompt.trim() : "";
      const duplicate = index === 0 && before?.type === "user_message"
        && typeof before.content === "string" && before.content.trim() === prompt;
      out.push(...transcriptRowsForTurn(turn, { includeUser: !duplicate }));
    });
  };
  for (let i = 0; i < pi.length; i += 1) {
    insertAt(i);
    out.push(pi[i]);
  }
  insertAt(pi.length);
  return out;
}
