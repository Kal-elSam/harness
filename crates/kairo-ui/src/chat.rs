//! Chat transcript + bridge event reducer (R3b).

use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Focus {
    #[default]
    Editor,
    Sidebar,
    Transcript,
}

impl Focus {
    pub fn next(self) -> Self {
        match self {
            Focus::Editor => Focus::Sidebar,
            Focus::Sidebar => Focus::Transcript,
            Focus::Transcript => Focus::Editor,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MessageRole {
    User,
    Assistant,
    /// Assistant "thinking" content — always its own row, never merged into
    /// `Assistant` text (Pi RPC's `thinking_start`/`thinking_delta`/
    /// `thinking_end` `assistantMessageEvent`s, mirroring `text_*`).
    Thinking,
    Tool,
    /// An assistant-stream-level error (`assistantMessageEvent.type ==
    /// "error"`, or a replayed message with `stopReason` `"error"`/
    /// `"aborted"`) — distinct from a failed *tool* result, which stays a
    /// `Tool` row with `is_error: true`.
    Error,
    System,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatMessage {
    pub role: MessageRole,
    pub content: String,
    pub streaming: bool,
    /// Set on a `Tool` row whose result was `isError: true`. Never set on
    /// other roles today; `MessageRole::Error` already carries the failure
    /// in its role, not this flag.
    pub is_error: bool,
    /// Pi `toolCallId` for `Tool` rows — correlates start/update/end so
    /// concurrent tools never clobber each other. `None` for every other role.
    pub tool_call_id: Option<String>,
}

/// Extract plain text from a Pi tool `result` / `partialResult` value.
///
/// Wire shapes (from vendored Pi JSON docs): `{ content: [{ type:"text",
/// text }] }`, a bare content array, a string, or `{ content: "…" }`.
fn tool_payload_text(value: Option<&Value>) -> String {
    let Some(value) = value else {
        return String::new();
    };
    if let Some(s) = value.as_str() {
        return s.trim().to_string();
    }
    let content = value.get("content").unwrap_or(value);
    if let Some(s) = content.as_str() {
        return s.trim().to_string();
    }
    let Some(blocks) = content.as_array() else {
        return String::new();
    };
    blocks
        .iter()
        .filter_map(|block| {
            if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                block.get("text").and_then(|t| t.as_str())
            } else {
                None
            }
        })
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_tool_running(name: &str, progress: &str) -> String {
    if progress.is_empty() {
        format!("▶ {name} …")
    } else {
        format!("▶ {name} …\n{progress}")
    }
}

fn format_tool_done(name: &str, is_error: bool, result: &str) -> String {
    let glyph = if is_error { "✖" } else { "✓" };
    if result.is_empty() {
        format!("{glyph} {name}")
    } else {
        format!("{glyph} {name}\n{result}")
    }
}

/// Stable content of the `System` row shown for a cancelled ASK turn. It is a
/// plain `system_message` on replay, so restored history reproduces it.
pub const CANCELLED_MARKER: &str = "Cancelled";

/// Prefix of the single per-turn ASK activity (`progress`) row.
const ACTIVITY_PREFIX: &str = "… ";

/// Message of an `error`/`failed` provider event, with a stable fallback.
fn provider_message(ev: &Value) -> String {
    ev.get("message")
        .and_then(|v| v.as_str())
        .filter(|m| !m.trim().is_empty())
        .unwrap_or("provider error")
        .to_string()
}

/// Turns remembered as finished so their late events are dropped.
const FINISHED_TURNS_CAP: usize = 16;

/// Bookkeeping for the ASK turn whose `provider_event`s are being rendered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProviderTurn {
    id: String,
    last_seq: u64,
    /// A non-empty `text` event already produced an Assistant row.
    has_text: bool,
    /// Index of this turn's single activity row, if any.
    activity_row: Option<usize>,
    /// Message of the most recent informational `error`, so a terminal
    /// `failed` carrying the same message adds no second Error row.
    last_error: Option<String>,
    /// First message index of this turn: provider tool ids restart on every
    /// ASK turn (fresh provider process), so id lookup never looks before it.
    row_floor: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatState {
    pub messages: Vec<ChatMessage>,
    pub scroll_offset: usize,
    pub is_streaming: bool,
    pub focus: Focus,
    /// An ASK-mode prompt was sent and its turn has not reached a terminal
    /// (`done|cancelled|failed`), `task_result`, `error` or session replace.
    /// Deliberately NOT `is_streaming`: that flag gates Pi-stream behaviour.
    pub ask_in_flight: bool,
    pub(crate) provider_turn: Option<ProviderTurn>,
    pub(crate) finished_turns: Vec<String>,
    /// During a transcript replay: index of the current replayed user turn's
    /// first row, so a tool id reused by a later replayed ASK turn does not
    /// rewrite an earlier turn's row. `None` outside a replay.
    pub(crate) replay_floor: Option<usize>,
}

impl Default for ChatState {
    fn default() -> Self {
        Self {
            messages: vec![ChatMessage {
                role: MessageRole::System,
                content: "Type /analyze to choose an analyst · then chat below.".into(),
                streaming: false,
                is_error: false,
                tool_call_id: None,
            }],
            scroll_offset: 0,
            is_streaming: false,
            focus: Focus::Editor,
            ask_in_flight: false,
            provider_turn: None,
            finished_turns: Vec::new(),
            replay_floor: None,
        }
    }
}

impl ChatState {
    pub fn submit_user(&mut self, text: String) {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return;
        }
        self.messages.push(ChatMessage {
            role: MessageRole::User,
            content: trimmed.to_string(),
            streaming: false,
            is_error: false,
            tool_call_id: None,
        });
    }

    /// Remove the last user message if it matches `text` (prompt send failed).
    pub fn pop_last_user_if_matches(&mut self, text: &str) {
        let trimmed = text.trim();
        if let Some(last) = self.messages.last() {
            if last.role == MessageRole::User && last.content == trimmed {
                self.messages.pop();
            }
        }
    }

    /// Drop an empty streaming assistant placeholder (engine died before deltas).
    pub fn cancel_empty_assistant_stream(&mut self) {
        if let Some(last) = self.messages.last() {
            if last.role == MessageRole::Assistant && last.streaming && last.content.is_empty() {
                self.messages.pop();
            }
        }
        self.is_streaming = self.messages.iter().any(|m| m.streaming);
    }

    pub fn push_mock_assistant_reply(&mut self, user_text: &str) {
        self.messages.push(ChatMessage {
            role: MessageRole::Assistant,
            content: format!("(local mock) Received: {user_text}"),
            streaming: false,
            is_error: false,
            tool_call_id: None,
        });
    }

    /// U4a: append a Kairo submitTask outcome (ASK answer or PLAN notice) as
    /// a System row — never starts a Pi assistant stream.
    pub fn push_kairo_reply(&mut self, text: String) {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return;
        }
        self.messages.push(ChatMessage {
            role: MessageRole::System,
            content: trimmed.to_string(),
            streaming: false,
            is_error: false,
            tool_call_id: None,
        });
    }

    /// Append `delta` to the current streaming row for `role`, starting a new
    /// row when the last message isn't already an open streaming row of the
    /// same role. This is what keeps `Thinking` and `Assistant` text as
    /// separate rows even while both stream concurrently — a `thinking_delta`
    /// never appends onto an in-flight `Assistant` row and vice versa.
    fn append_streaming(&mut self, role: MessageRole, delta: &str) {
        if delta.is_empty() {
            return;
        }
        if let Some(last) = self.messages.last_mut() {
            if last.role == role && last.streaming {
                last.content.push_str(delta);
                self.is_streaming = true;
                return;
            }
        }
        self.is_streaming = true;
        self.messages.push(ChatMessage {
            role,
            content: delta.to_string(),
            streaming: true,
            is_error: false,
            tool_call_id: None,
        });
    }

    /// Push a replay-only user/system row (see `pi-rpc-transcript.js`'s
    /// `user_message`/`system_message` markers).
    fn push_replay_message(&mut self, role: MessageRole, content: &str) {
        let trimmed = content.trim();
        if trimmed.is_empty() {
            return;
        }
        self.messages.push(ChatMessage {
            role,
            content: trimmed.to_string(),
            streaming: false,
            is_error: false,
            tool_call_id: None,
        });
    }

    /// Find the open `Tool` row for `tool_call_id` (Pi ids are globally
    /// unique, so live this searches the whole history; a replay searches only
    /// the current replayed user turn).
    fn find_tool_row_mut(&mut self, tool_call_id: &str) -> Option<&mut ChatMessage> {
        let floor = self.replay_floor.unwrap_or(0);
        self.find_tool_row_from(tool_call_id, floor)
    }

    fn find_tool_row_from(&mut self, tool_call_id: &str, floor: usize) -> Option<&mut ChatMessage> {
        let floor = floor.min(self.messages.len());
        self.messages[floor..].iter_mut().rev().find(|m| {
            m.role == MessageRole::Tool && m.tool_call_id.as_deref() == Some(tool_call_id)
        })
    }

    /// Replace chat with a restored session's history.
    ///
    /// `rows` are shaped exactly like the live sidecar/bridge events
    /// `apply_sidecar_event` already reduces (`message_update` with a
    /// `text_delta`/`thinking_delta`/`error` assistantMessageEvent,
    /// `tool_execution_start`/`tool_execution_end`, `agent_settled`), plus
    /// two replay-only markers a live stream never emits itself:
    /// `user_message` and `system_message` (`pi-rpc-transcript.js`'s own
    /// output shape). Feeding every non-replay-only row through the SAME
    /// reducer the live stream uses is what makes restored history render
    /// identically to live — text, thinking, tool rows, and errors can never
    /// diverge between the two paths because they share one implementation.
    pub fn replace_from_sidecar_transcript(&mut self, rows: &[Value]) {
        self.messages = vec![ChatMessage {
            role: MessageRole::System,
            content: "Type /analyze to choose an analyst · then chat below.".into(),
            streaming: false,
            is_error: false,
            tool_call_id: None,
        }];
        self.scroll_offset = 0;
        self.is_streaming = false;
        // A session replace ends any ASK turn; its late events are dropped.
        self.ask_in_flight = false;
        self.retire_provider_turn();
        for row in rows {
            match row.get("type").and_then(|v| v.as_str()) {
                Some("user_message") => {
                    self.replay_floor = Some(self.messages.len());
                    if let Some(content) = row.get("content").and_then(|v| v.as_str()) {
                        self.push_replay_message(MessageRole::User, content);
                    }
                }
                Some("system_message") => {
                    if let Some(content) = row.get("content").and_then(|v| v.as_str()) {
                        self.push_replay_message(MessageRole::System, content);
                    }
                }
                _ => self.apply_sidecar_event(row),
            }
        }
        self.replay_floor = None;
        // A restored session is never mid-stream — close every row so no
        // ghost "…" placeholder survives the switch.
        self.is_streaming = false;
        for msg in &mut self.messages {
            msg.streaming = false;
        }
    }

    /// An ASK-mode prompt was sent. Starts a fresh turn; a no-op while a turn
    /// is already in flight (the sidecar rejects a second prompt, and the
    /// running turn must keep its correlation state).
    pub fn begin_ask(&mut self) {
        if self.ask_in_flight {
            return;
        }
        self.retire_provider_turn();
        self.ask_in_flight = true;
    }

    /// Forget the current turn and remember its id so late events are dropped.
    fn retire_provider_turn(&mut self) {
        if let Some(turn) = self.provider_turn.take() {
            self.finished_turns.push(turn.id);
            if self.finished_turns.len() > FINISHED_TURNS_CAP {
                self.finished_turns.remove(0);
            }
        }
    }

    /// True when `text` events already showed this turn's answer, so the
    /// `task_result` answer must not be pushed a second time.
    pub fn ask_answer_already_shown(&self) -> bool {
        self.provider_turn.as_ref().is_some_and(|t| t.has_text)
    }

    /// Apply one sidecar `provider_event` (see `kairo-ui-rpc-stdio.js`).
    /// Terminal kinds are exactly `done`, `cancelled` and `failed`; `error`
    /// is informational and leaves the turn in flight.
    /// Returns whether the event was applied. Events are dropped when no ASK
    /// is in flight and no turn is active, for a foreign or finished turn,
    /// for a finished turn, or when `seq` is not strictly increasing.
    pub fn apply_provider_event(&mut self, ev: &Value) -> bool {
        let (Some(turn_id), Some(seq), Some(kind)) = (
            ev.get("turnId").and_then(|v| v.as_str()),
            ev.get("seq").and_then(|v| v.as_u64()),
            ev.get("kind").and_then(|v| v.as_str()),
        ) else {
            return false;
        };
        if self.finished_turns.iter().any(|t| t == turn_id) {
            return false;
        }
        match self.provider_turn.as_mut() {
            Some(turn) if turn.id != turn_id || seq <= turn.last_seq => {
                return false;
            }
            Some(turn) => turn.last_seq = seq,
            None => {
                // `failed` may arrive after a `{type:"error"}` record already
                // cleared the flag; it is still that turn's terminal.
                if !self.ask_in_flight && kind != "failed" {
                    return false;
                }
                self.provider_turn = Some(ProviderTurn {
                    id: turn_id.to_string(),
                    last_seq: seq,
                    has_text: false,
                    activity_row: None,
                    last_error: None,
                    row_floor: self.messages.len(),
                });
            }
        }
        match kind {
            "text" => {
                let text = ev.get("text").and_then(|v| v.as_str()).unwrap_or("");
                if !text.is_empty() {
                    self.append_ask_text(text);
                }
            }
            "progress" => {
                let summary = ev.get("summary").and_then(|v| v.as_str()).unwrap_or("").trim();
                if !summary.is_empty() {
                    self.set_activity(format!("{ACTIVITY_PREFIX}{summary}"));
                }
            }
            "tool_start" => self.apply_ask_tool(ev, None),
            "tool_end" => {
                let ok = ev.get("ok").and_then(|v| v.as_bool()).unwrap_or(true);
                self.apply_ask_tool(ev, Some(!ok));
            }
            // Informational: renders an Error row but the turn goes on.
            "error" => {
                let message = provider_message(ev);
                self.push_error_row(message.clone());
                if let Some(turn) = self.provider_turn.as_mut() {
                    turn.last_error = Some(message);
                }
            }
            // Terminal failure. Skips its Error row only when the turn's most
            // recent informational `error` carried the very same message.
            "failed" => {
                let message = provider_message(ev);
                let duplicate = self
                    .provider_turn
                    .as_ref()
                    .is_some_and(|t| t.last_error.as_deref() == Some(message.as_str()));
                self.finish_provider_turn();
                if !duplicate {
                    self.push_error_row(message);
                }
            }
            "cancelled" => {
                self.finish_provider_turn();
                self.messages.push(ChatMessage {
                    role: MessageRole::System,
                    content: CANCELLED_MARKER.to_string(),
                    streaming: false,
                    is_error: false,
                    tool_call_id: None,
                });
            }
            "done" => self.finish_provider_turn(),
            // `final` carries no text (the answer travels in `task_result`);
            // unknown kinds are ignored.
            _ => {}
        }
        true
    }

    fn push_error_row(&mut self, content: String) {
        self.messages.push(ChatMessage {
            role: MessageRole::Error,
            content,
            streaming: false,
            is_error: true,
            tool_call_id: None,
        });
    }

    /// Text goes to the open Assistant row or starts one. Only the row's own
    /// `streaming` flag is set — `is_streaming` stays untouched.
    fn append_ask_text(&mut self, text: &str) {
        if let Some(turn) = self.provider_turn.as_mut() {
            turn.has_text = true;
        }
        if let Some(last) = self.messages.last_mut() {
            if last.role == MessageRole::Assistant && last.streaming {
                last.content.push_str(text);
                return;
            }
        }
        self.messages.push(ChatMessage {
            role: MessageRole::Assistant,
            content: text.to_string(),
            streaming: true,
            is_error: false,
            tool_call_id: None,
        });
    }

    /// Update (or create) the turn's single activity row.
    fn set_activity(&mut self, content: String) {
        let existing = self
            .provider_turn
            .as_ref()
            .and_then(|t| t.activity_row)
            .filter(|&i| {
                self.messages
                    .get(i)
                    .is_some_and(|m| m.role == MessageRole::System && m.content.starts_with(ACTIVITY_PREFIX))
            });
        if let Some(i) = existing {
            self.messages[i].content = content;
            return;
        }
        self.messages.push(ChatMessage {
            role: MessageRole::System,
            content,
            streaming: false,
            is_error: false,
            tool_call_id: None,
        });
        let idx = self.messages.len() - 1;
        if let Some(turn) = self.provider_turn.as_mut() {
            turn.activity_row = Some(idx);
        }
    }

    /// `tool_start` (`failed == None`) / `tool_end` (`Some(failed)`), keyed by id.
    fn apply_ask_tool(&mut self, ev: &Value, failed: Option<bool>) {
        let name = ev.get("name").and_then(|v| v.as_str()).unwrap_or("tool");
        let id = ev.get("id").and_then(|v| v.as_str()).map(str::to_string);
        let (content, is_error) = match failed {
            None => (format_tool_running(name, ""), false),
            Some(err) => (format_tool_done(name, err, ""), err),
        };
        if let Some(id) = id.as_deref() {
            let floor = self.provider_turn.as_ref().map_or(0, |t| t.row_floor);
            if let Some(row) = self.find_tool_row_from(id, floor) {
                row.content = content;
                row.is_error = is_error;
                return;
            }
        }
        self.messages.push(ChatMessage {
            role: MessageRole::Tool,
            content,
            streaming: false,
            is_error,
            tool_call_id: id,
        });
    }

    /// Terminal bookkeeping shared by `done|cancelled|error`: close open
    /// rows, drop the activity row, mark the turn finished, clear the flag.
    fn finish_provider_turn(&mut self) {
        for msg in &mut self.messages {
            msg.streaming = false;
        }
        if let Some(turn) = self.provider_turn.as_mut() {
            if let Some(i) = turn.activity_row.take() {
                if self.messages.get(i).is_some_and(|m| m.content.starts_with(ACTIVITY_PREFIX)) {
                    self.messages.remove(i);
                }
            }
        }
        self.retire_provider_turn();
        self.ask_in_flight = false;
    }

    pub fn begin_assistant_stream(&mut self) {
        self.is_streaming = true;
        self.messages.push(ChatMessage {
            role: MessageRole::Assistant,
            content: String::new(),
            streaming: true,
            is_error: false,
            tool_call_id: None,
        });
    }

    pub fn scroll_page_up(&mut self, visible_rows: usize) {
        self.scroll_offset = self.scroll_offset.saturating_sub(visible_rows.max(1));
    }

    pub fn scroll_page_down(&mut self, visible_rows: usize, total_lines: usize) {
        let max = total_lines.saturating_sub(visible_rows.max(1));
        self.scroll_offset = (self.scroll_offset + visible_rows.max(1)).min(max);
    }

    /// Apply one JSONL sidecar / Pi event to the chat model.
    pub fn apply_sidecar_event(&mut self, record: &Value) {
        let Some(kind) = record.get("type").and_then(|v| v.as_str()) else {
            return;
        };
        match kind {
            "message_update" => {
                match record
                    .pointer("/assistantMessageEvent/type")
                    .and_then(|v| v.as_str())
                {
                    // `thinking_delta` shares the same `{delta}` shape as
                    // `text_delta` (see Pi RPC's `AssistantMessageEvent`
                    // union) but must land on its own `Thinking` row — never
                    // appended onto the streaming `Assistant` text row.
                    Some("thinking_delta") => {
                        if let Some(delta) = record
                            .pointer("/assistantMessageEvent/delta")
                            .and_then(|v| v.as_str())
                        {
                            self.append_streaming(MessageRole::Thinking, delta);
                        }
                    }
                    Some("text_delta") => {
                        if let Some(delta) = record
                            .pointer("/assistantMessageEvent/delta")
                            .and_then(|v| v.as_str())
                        {
                            self.append_streaming(MessageRole::Assistant, delta);
                        }
                    }
                    // `{ type: "error", error: { errorMessage } }` — a
                    // stream-level failure (aborted/errored turn), distinct
                    // from a failed tool result. Previously dropped entirely
                    // (no `delta` field, so the old delta-only check ignored
                    // it) — the transcript went silent on a real failure.
                    Some("error") => {
                        let message = record
                            .pointer("/assistantMessageEvent/error/errorMessage")
                            .and_then(|v| v.as_str())
                            .unwrap_or("assistant error");
                        self.is_streaming = false;
                        for msg in &mut self.messages {
                            if msg.streaming {
                                msg.streaming = false;
                            }
                        }
                        self.messages.push(ChatMessage {
                            role: MessageRole::Error,
                            content: message.to_string(),
                            streaming: false,
                            is_error: true,
                            tool_call_id: None,
                        });
                    }
                    _ => {}
                }
            }
            "tool_execution_start" => {
                let name = record
                    .get("toolName")
                    .and_then(|v| v.as_str())
                    .unwrap_or("tool");
                let tool_call_id = record
                    .get("toolCallId")
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
                // If Pi re-emits start for an existing id, refresh that row
                // instead of stacking a duplicate concurrent ghost.
                if let Some(id) = tool_call_id.as_deref() {
                    if let Some(row) = self.find_tool_row_mut(id) {
                        row.content = format_tool_running(name, "");
                        row.is_error = false;
                        return;
                    }
                }
                self.messages.push(ChatMessage {
                    role: MessageRole::Tool,
                    content: format_tool_running(name, ""),
                    streaming: false,
                    is_error: false,
                    tool_call_id,
                });
            }
            "tool_execution_update" => {
                let Some(id) = record.get("toolCallId").and_then(|v| v.as_str()) else {
                    return;
                };
                let name = record
                    .get("toolName")
                    .and_then(|v| v.as_str())
                    .unwrap_or("tool");
                let progress = tool_payload_text(record.get("partialResult"));
                if let Some(row) = self.find_tool_row_mut(id) {
                    row.content = format_tool_running(name, &progress);
                    row.is_error = false;
                }
            }
            "tool_execution_end" => {
                let name = record
                    .get("toolName")
                    .and_then(|v| v.as_str())
                    .unwrap_or("tool");
                let err = record
                    .get("isError")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let result_text = tool_payload_text(record.get("result"));
                let content = format_tool_done(name, err, &result_text);
                if let Some(id) = record.get("toolCallId").and_then(|v| v.as_str()) {
                    if let Some(row) = self.find_tool_row_mut(id) {
                        row.content = content;
                        row.is_error = err;
                        return;
                    }
                    self.messages.push(ChatMessage {
                        role: MessageRole::Tool,
                        content,
                        streaming: false,
                        is_error: err,
                        tool_call_id: Some(id.to_string()),
                    });
                    return;
                }
                // No toolCallId: push a final row (legacy / incomplete events).
                self.messages.push(ChatMessage {
                    role: MessageRole::Tool,
                    content,
                    streaming: false,
                    is_error: err,
                    tool_call_id: None,
                });
            }
            "agent_settled" => {
                self.is_streaming = false;
                for msg in &mut self.messages {
                    if msg.streaming {
                        msg.streaming = false;
                    }
                }
            }
            _ => {}
        }
    }
}

/// Sidebar j/k navigation only when sidebar has focus.
pub fn sidebar_accepts_selection_keys(focus: Focus) -> bool {
    focus == Focus::Sidebar
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// U3: full-envelope events exactly as the vendored fork types declare them
    /// (`AgentEvent` / `AssistantMessageEvent`): extra fields (`partial`,
    /// `message`, `contentIndex`, `args`) and lifecycle records the host does
    /// not render must neither add rows nor break the reducer, and a provider
    /// with no thinking and no tools must still render a plain answer.
    #[test]
    fn fork_shaped_envelopes_render_only_text_and_ignore_lifecycle_records() {
        let mut chat = ChatState::default();
        let partial = json!({ "role": "assistant", "content": [] });
        for record in [
            json!({ "type": "agent_start" }),
            json!({ "type": "turn_start" }),
            json!({ "type": "message_start", "message": partial }),
            json!({ "type": "message_update", "message": partial,
                    "assistantMessageEvent": { "type": "start", "partial": partial } }),
            json!({ "type": "message_update", "message": partial,
                    "assistantMessageEvent": { "type": "text_start", "contentIndex": 0, "partial": partial } }),
            json!({ "type": "message_update", "message": partial,
                    "assistantMessageEvent": { "type": "text_delta", "contentIndex": 0, "delta": "Hi", "partial": partial } }),
            json!({ "type": "message_update", "message": partial,
                    "assistantMessageEvent": { "type": "text_end", "contentIndex": 0, "content": "Hi", "partial": partial } }),
            json!({ "type": "message_update", "message": partial,
                    "assistantMessageEvent": { "type": "done", "reason": "stop", "message": partial } }),
            json!({ "type": "message_end", "message": partial }),
            json!({ "type": "turn_end", "message": partial, "toolResults": [] }),
            json!({ "type": "agent_end", "messages": [] }),
            json!({ "type": "agent_settled" }),
        ] {
            chat.apply_sidecar_event(&record);
        }
        // Default state seeds one System hint row; nothing else may be added.
        let rows: Vec<_> = chat
            .messages
            .iter()
            .filter(|m| m.role != MessageRole::System)
            .collect();
        assert_eq!(
            rows.len(),
            1,
            "only the assistant text row: {:?}",
            chat.messages
        );
        assert_eq!(rows[0].role, MessageRole::Assistant);
        assert_eq!(rows[0].content, "Hi");
        assert!(!rows[0].streaming);
        assert!(!chat.is_streaming);
    }

    /// U3: an aborted stream arrives as `{type:"error", reason:"aborted",
    /// error: AssistantMessage{ stopReason, errorMessage }}`.
    #[test]
    fn fork_shaped_aborted_stream_error_renders_error_row() {
        let mut chat = ChatState::default();
        chat.apply_sidecar_event(&json!({
            "type": "message_update",
            "message": { "role": "assistant", "content": [] },
            "assistantMessageEvent": {
                "type": "error",
                "reason": "aborted",
                "error": { "role": "assistant", "stopReason": "aborted",
                           "errorMessage": "Request was aborted", "content": [] }
            }
        }));
        let err = chat.messages.last().expect("error row");
        assert_eq!(err.role, MessageRole::Error);
        assert_eq!(err.content, "Request was aborted");
    }

    #[test]
    fn text_delta_appends_to_streaming_assistant() {
        let mut chat = ChatState::default();
        chat.apply_sidecar_event(&json!({
            "type": "message_update",
            "assistantMessageEvent": { "type": "text_delta", "delta": "Hello" }
        }));
        chat.apply_sidecar_event(&json!({
            "type": "message_update",
            "assistantMessageEvent": { "type": "text_delta", "delta": " world" }
        }));
        assert_eq!(
            chat.messages
                .iter()
                .filter(|m| m.role == MessageRole::Assistant)
                .count(),
            1
        );
        assert_eq!(
            chat.messages
                .iter()
                .find(|m| m.role == MessageRole::Assistant)
                .map(|m| m.content.as_str()),
            Some("Hello world")
        );
        assert!(chat.is_streaming);
        chat.apply_sidecar_event(&json!({ "type": "agent_settled" }));
        assert!(!chat.is_streaming);
        assert!(
            !chat
                .messages
                .iter()
                .find(|m| m.role == MessageRole::Assistant)
                .expect("assistant")
                .streaming
        );
    }

    #[test]
    fn tool_events_become_tool_rows() {
        let mut chat = ChatState::default();
        chat.apply_sidecar_event(&json!({
            "type": "tool_execution_start",
            "toolCallId": "call-1",
            "toolName": "Read"
        }));
        chat.apply_sidecar_event(&json!({
            "type": "tool_execution_end",
            "toolCallId": "call-1",
            "toolName": "Read",
            "isError": false
        }));
        let tools: Vec<_> = chat
            .messages
            .iter()
            .filter(|m| m.role == MessageRole::Tool)
            .map(|m| m.content.as_str())
            .collect();
        // Start + end correlate by toolCallId into ONE row (in-place update).
        assert_eq!(tools, vec!["✓ Read"]);
    }

    #[test]
    fn concurrent_tools_correlate_progress_and_result_by_tool_call_id() {
        let mut chat = ChatState::default();
        chat.apply_sidecar_event(&json!({
            "type": "tool_execution_start",
            "toolCallId": "a",
            "toolName": "Read"
        }));
        chat.apply_sidecar_event(&json!({
            "type": "tool_execution_start",
            "toolCallId": "b",
            "toolName": "Bash"
        }));
        chat.apply_sidecar_event(&json!({
            "type": "tool_execution_update",
            "toolCallId": "a",
            "toolName": "Read",
            "partialResult": { "content": [{ "type": "text", "text": "partial-a" }] }
        }));
        chat.apply_sidecar_event(&json!({
            "type": "tool_execution_update",
            "toolCallId": "b",
            "toolName": "Bash",
            "partialResult": { "content": [{ "type": "text", "text": "partial-b" }] }
        }));
        chat.apply_sidecar_event(&json!({
            "type": "tool_execution_end",
            "toolCallId": "b",
            "toolName": "Bash",
            "isError": true,
            "result": { "content": [{ "type": "text", "text": "bash failed" }] }
        }));
        chat.apply_sidecar_event(&json!({
            "type": "tool_execution_end",
            "toolCallId": "a",
            "toolName": "Read",
            "isError": false,
            "result": { "content": [{ "type": "text", "text": "file contents" }] }
        }));

        let tools: Vec<_> = chat
            .messages
            .iter()
            .filter(|m| m.role == MessageRole::Tool)
            .cloned()
            .collect();
        assert_eq!(tools.len(), 2, "concurrent tools must keep distinct rows");
        assert_eq!(tools[0].tool_call_id.as_deref(), Some("a"));
        assert!(tools[0].content.contains("✓ Read"));
        assert!(tools[0].content.contains("file contents"));
        assert!(!tools[0].is_error);
        assert!(!tools[0].content.contains("partial-b"));
        assert!(!tools[0].content.contains("bash failed"));
        assert_eq!(tools[1].tool_call_id.as_deref(), Some("b"));
        assert!(tools[1].content.contains("✖ Bash"));
        assert!(tools[1].content.contains("bash failed"));
        assert!(tools[1].is_error);
        assert!(!tools[1].content.contains("file contents"));
    }

    #[test]
    fn tool_execution_update_rewrites_matching_in_progress_row() {
        let mut chat = ChatState::default();
        chat.apply_sidecar_event(&json!({
            "type": "tool_execution_start",
            "toolCallId": "call-1",
            "toolName": "Bash"
        }));
        chat.apply_sidecar_event(&json!({
            "type": "tool_execution_update",
            "toolCallId": "call-1",
            "toolName": "Bash",
            "partialResult": { "content": [{ "type": "text", "text": "line 1" }] }
        }));
        let tools: Vec<_> = chat
            .messages
            .iter()
            .filter(|m| m.role == MessageRole::Tool)
            .collect();
        assert_eq!(tools.len(), 1);
        assert!(tools[0].content.starts_with('▶'));
        assert!(tools[0].content.contains("Bash"));
        assert!(tools[0].content.contains("line 1"));
    }

    #[test]
    fn tool_execution_end_preserves_result_and_error_content() {
        let mut chat = ChatState::default();
        chat.apply_sidecar_event(&json!({
            "type": "tool_execution_start",
            "toolCallId": "ok",
            "toolName": "Read"
        }));
        chat.apply_sidecar_event(&json!({
            "type": "tool_execution_end",
            "toolCallId": "ok",
            "toolName": "Read",
            "isError": false,
            "result": { "content": [{ "type": "text", "text": "hello from file" }] }
        }));
        let ok = chat
            .messages
            .iter()
            .find(|m| m.tool_call_id.as_deref() == Some("ok"))
            .expect("ok tool");
        assert!(ok.content.contains('✓'));
        assert!(ok.content.contains("hello from file"));
        assert!(
            ok.content.contains("✓ Read\nhello from file"),
            "tool name and result body must stay separated by a newline: {}",
            ok.content
        );
        assert!(!ok.is_error);

        let mut chat_err = ChatState::default();
        chat_err.apply_sidecar_event(&json!({
            "type": "tool_execution_start",
            "toolCallId": "err",
            "toolName": "Bash"
        }));
        chat_err.apply_sidecar_event(&json!({
            "type": "tool_execution_end",
            "toolCallId": "err",
            "toolName": "Bash",
            "isError": true,
            "result": { "content": [{ "type": "text", "text": "permission denied" }] }
        }));
        let err = chat_err
            .messages
            .iter()
            .find(|m| m.tool_call_id.as_deref() == Some("err"))
            .expect("err tool");
        assert!(err.content.contains('✖'));
        assert!(err.content.contains("permission denied"));
        assert!(err.is_error);
    }

    #[test]
    fn replay_restores_final_tool_result_without_invented_progress() {
        // Transcript restore emits start+end only — never fabricated updates.
        let events = vec![
            json!({
                "type": "tool_execution_start",
                "toolCallId": "call-1",
                "toolName": "Read"
            }),
            json!({
                "type": "tool_execution_end",
                "toolCallId": "call-1",
                "toolName": "Read",
                "isError": false,
                "result": { "content": [{ "type": "text", "text": "restored body" }] }
            }),
        ];
        assert!(
            events
                .iter()
                .all(|e| e.get("type").and_then(|t| t.as_str()) != Some("tool_execution_update")),
            "fixture must not invent intermediate progress"
        );

        let mut live = ChatState::default();
        for ev in &events {
            live.apply_sidecar_event(ev);
        }
        let mut replay = ChatState::default();
        replay.replace_from_sidecar_transcript(&events);

        let tool_rows = |chat: &ChatState| -> Vec<(Option<String>, String, bool)> {
            chat.messages
                .iter()
                .filter(|m| m.role == MessageRole::Tool)
                .map(|m| (m.tool_call_id.clone(), m.content.clone(), m.is_error))
                .collect()
        };
        assert_eq!(tool_rows(&live), tool_rows(&replay));
        assert_eq!(tool_rows(&replay).len(), 1);
        assert!(tool_rows(&replay)[0].1.contains("restored body"));
        assert!(tool_rows(&replay)[0].1.contains('✓'));
    }

    #[test]
    fn sidebar_keys_only_in_sidebar_focus() {
        assert!(!sidebar_accepts_selection_keys(Focus::Editor));
        assert!(sidebar_accepts_selection_keys(Focus::Sidebar));
        assert!(!sidebar_accepts_selection_keys(Focus::Transcript));
    }

    #[test]
    fn local_submit_adds_user_message() {
        let mut chat = ChatState::default();
        chat.submit_user("  hi there  ".into());
        assert!(chat
            .messages
            .iter()
            .any(|m| m.role == MessageRole::User && m.content == "hi there"));
    }

    #[test]
    fn pop_last_user_rolls_back_failed_send() {
        let mut chat = ChatState::default();
        chat.submit_user("keep me".into());
        chat.submit_user("rollback".into());
        chat.pop_last_user_if_matches("rollback");
        assert_eq!(
            chat.messages
                .iter()
                .filter(|m| m.role == MessageRole::User)
                .map(|m| m.content.as_str())
                .collect::<Vec<_>>(),
            vec!["keep me"]
        );
    }

    #[test]
    fn cancel_empty_assistant_stream_drops_ghost() {
        let mut chat = ChatState::default();
        chat.begin_assistant_stream();
        assert!(chat.is_streaming);
        chat.cancel_empty_assistant_stream();
        assert!(!chat.is_streaming);
        assert!(!chat
            .messages
            .iter()
            .any(|m| m.role == MessageRole::Assistant));
    }

    #[test]
    fn replace_transcript_from_sidecar_rows() {
        let mut chat = ChatState::default();
        chat.submit_user("old".into());
        chat.replace_from_sidecar_transcript(&[
            json!({ "type": "user_message", "content": "hello" }),
            json!({
                "type": "message_update",
                "assistantMessageEvent": { "type": "text_delta", "delta": "hi" }
            }),
            json!({ "type": "agent_settled" }),
        ]);
        assert!(chat
            .messages
            .iter()
            .any(|m| m.role == MessageRole::User && m.content == "hello"));
        assert!(chat
            .messages
            .iter()
            .any(|m| m.role == MessageRole::Assistant && m.content == "hi"));
        assert!(!chat
            .messages
            .iter()
            .any(|m| m.role == MessageRole::User && m.content == "old"));
        assert_eq!(chat.scroll_offset, 0);
        assert!(!chat.is_streaming);
    }

    #[test]
    fn thinking_delta_creates_distinct_row_never_merged_into_text() {
        let mut chat = ChatState::default();
        chat.apply_sidecar_event(&json!({
            "type": "message_update",
            "assistantMessageEvent": { "type": "thinking_delta", "delta": "Let me think" }
        }));
        chat.apply_sidecar_event(&json!({
            "type": "message_update",
            "assistantMessageEvent": { "type": "text_delta", "delta": "Answer" }
        }));
        let thinking: Vec<_> = chat
            .messages
            .iter()
            .filter(|m| m.role == MessageRole::Thinking)
            .collect();
        let assistant: Vec<_> = chat
            .messages
            .iter()
            .filter(|m| m.role == MessageRole::Assistant)
            .collect();
        assert_eq!(thinking.len(), 1);
        assert_eq!(thinking[0].content, "Let me think");
        assert_eq!(assistant.len(), 1);
        assert_eq!(assistant[0].content, "Answer");
        assert!(
            !assistant[0].content.contains("Let me think"),
            "thinking must never be concatenated into assistant text"
        );
    }

    #[test]
    fn assistant_stream_error_becomes_distinct_error_row() {
        let mut chat = ChatState::default();
        chat.begin_assistant_stream();
        chat.apply_sidecar_event(&json!({
            "type": "message_update",
            "assistantMessageEvent": {
                "type": "error",
                "reason": "error",
                "error": { "errorMessage": "provider timeout" }
            }
        }));
        assert!(chat
            .messages
            .iter()
            .any(|m| m.role == MessageRole::Error && m.content.contains("provider timeout")));
        assert!(
            !chat.is_streaming,
            "an assistant-stream error must close streaming"
        );
    }

    #[test]
    fn tool_execution_end_marks_error_flag_distinctly() {
        let mut chat = ChatState::default();
        chat.apply_sidecar_event(&json!({
            "type": "tool_execution_start",
            "toolCallId": "err",
            "toolName": "Bash"
        }));
        chat.apply_sidecar_event(&json!({
            "type": "tool_execution_end",
            "toolCallId": "err",
            "toolName": "Bash",
            "isError": true
        }));
        let last = chat.messages.last().expect("tool row");
        assert_eq!(last.role, MessageRole::Tool);
        assert!(
            last.is_error,
            "a failed tool result must be flagged distinctly"
        );
        assert!(last.content.starts_with('✖'));

        let mut chat_ok = ChatState::default();
        chat_ok.apply_sidecar_event(&json!({
            "type": "tool_execution_start",
            "toolCallId": "ok",
            "toolName": "Bash"
        }));
        chat_ok.apply_sidecar_event(&json!({
            "type": "tool_execution_end",
            "toolCallId": "ok",
            "toolName": "Bash",
            "isError": false
        }));
        let ok_last = chat_ok.messages.last().expect("tool row");
        assert!(!ok_last.is_error);
    }

    #[test]
    fn replayed_history_matches_live_event_sequence_for_mixed_turn() {
        // A single live sidecar/bridge event sequence covering every distinct
        // event category this slice cares about: thinking, text, tool-call,
        // tool-result, and an assistant-stream error.
        let live_events = vec![
            json!({
                "type": "message_update",
                "assistantMessageEvent": { "type": "thinking_delta", "delta": "Considering options" }
            }),
            json!({
                "type": "message_update",
                "assistantMessageEvent": { "type": "text_delta", "delta": "Here is the plan" }
            }),
            json!({
                "type": "tool_execution_start",
                "toolCallId": "call-read",
                "toolName": "Read"
            }),
            json!({
                "type": "tool_execution_end",
                "toolCallId": "call-read",
                "toolName": "Read",
                "isError": false,
                "result": { "content": [{ "type": "text", "text": "file ok" }] }
            }),
            json!({
                "type": "message_update",
                "assistantMessageEvent": {
                    "type": "error",
                    "error": { "errorMessage": "provider timeout" }
                }
            }),
            json!({ "type": "agent_settled" }),
        ];

        let mut live = ChatState::default();
        for ev in &live_events {
            live.apply_sidecar_event(ev);
        }

        // Replay the SAME events through the sidecar-transcript entry point
        // (this is what `switch_session`/`new_session` feeds on session
        // restore) and confirm it reduces to an identical row sequence.
        let mut replay = ChatState::default();
        replay.replace_from_sidecar_transcript(&live_events);

        let strip_system = |chat: &ChatState| -> Vec<(MessageRole, String, bool)> {
            chat.messages
                .iter()
                .filter(|m| m.role != MessageRole::System)
                .map(|m| (m.role.clone(), m.content.clone(), m.is_error))
                .collect()
        };
        let live_rows = strip_system(&live);
        let replay_rows = strip_system(&replay);
        assert_eq!(
            live_rows, replay_rows,
            "restored history must render the same ordered row sequence as it did live"
        );

        // Sanity: every distinct category from the brief is actually present,
        // not just coincidentally empty on both sides.
        assert!(live_rows
            .iter()
            .any(|(r, _, _)| *r == MessageRole::Thinking));
        assert!(live_rows
            .iter()
            .any(|(r, _, _)| *r == MessageRole::Assistant));
        assert!(live_rows.iter().any(|(r, _, _)| *r == MessageRole::Tool));
        assert!(live_rows.iter().any(|(r, _, _)| *r == MessageRole::Error));
    }

    #[test]
    fn cancel_empty_keeps_assistant_with_content() {
        let mut chat = ChatState::default();
        chat.begin_assistant_stream();
        if let Some(last) = chat.messages.last_mut() {
            last.content.push_str("partial");
        }
        chat.cancel_empty_assistant_stream();
        assert!(chat.is_streaming);
        assert_eq!(
            chat.messages
                .iter()
                .find(|m| m.role == MessageRole::Assistant)
                .map(|m| m.content.as_str()),
            Some("partial")
        );
    }

    // ---- A3: ASK provider events -------------------------------------

    fn pev(turn: &str, seq: u64, kind: &str, extra: Value) -> Value {
        let mut v = json!({ "type": "provider_event", "turnId": turn, "sessionId": "s1",
            "seq": seq, "provider": "codex", "kind": kind });
        if let (Some(o), Some(e)) = (v.as_object_mut(), extra.as_object()) {
            for (k, val) in e {
                o.insert(k.clone(), val.clone());
            }
        }
        v
    }

    fn rows(chat: &ChatState, role: MessageRole) -> Vec<&ChatMessage> {
        chat.messages.iter().filter(|m| m.role == role).collect()
    }

    #[test]
    fn provider_text_events_build_one_assistant_row_without_touching_is_streaming() {
        let mut chat = ChatState::default();
        chat.begin_ask();
        assert!(chat.ask_in_flight);
        chat.apply_provider_event(&pev("t1", 1, "text", json!({ "text": "Hel" })));
        chat.apply_provider_event(&pev("t1", 2, "text", json!({ "text": "lo" })));
        let a = rows(&chat, MessageRole::Assistant);
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].content, "Hello");
        assert!(a[0].streaming);
        assert!(!chat.is_streaming, "ASK must not reuse is_streaming");
        assert!(chat.ask_answer_already_shown());
        chat.apply_provider_event(&pev("t1", 3, "done", json!({})));
        assert!(!rows(&chat, MessageRole::Assistant)[0].streaming);
        assert!(!chat.ask_in_flight);
    }

    #[test]
    fn provider_tool_events_correlate_by_id_and_mark_failures() {
        let mut chat = ChatState::default();
        chat.begin_ask();
        chat.apply_provider_event(&pev("t1", 1, "tool_start", json!({ "id": "a", "name": "shell" })));
        chat.apply_provider_event(&pev("t1", 2, "tool_start", json!({ "id": "b", "name": "read" })));
        chat.apply_provider_event(&pev("t1", 3, "tool_end", json!({ "id": "b", "name": "read", "ok": false })));
        chat.apply_provider_event(&pev("t1", 4, "tool_end", json!({ "id": "a", "name": "shell", "ok": true })));
        let t = rows(&chat, MessageRole::Tool);
        assert_eq!(t.len(), 2);
        let a = t.iter().find(|m| m.tool_call_id.as_deref() == Some("a")).unwrap();
        let b = t.iter().find(|m| m.tool_call_id.as_deref() == Some("b")).unwrap();
        assert!(!a.is_error && a.content.starts_with('\u{2713}'));
        assert!(b.is_error && b.content.starts_with('\u{2716}'));
    }

    fn tool_states(chat: &ChatState) -> Vec<(String, bool)> {
        rows(chat, MessageRole::Tool)
            .iter()
            .map(|m| (m.content.clone(), m.is_error))
            .collect()
    }

    #[test]
    fn a_tool_id_reused_by_a_later_ask_turn_makes_a_new_row() {
        let mut chat = ChatState::default();
        chat.begin_ask();
        chat.apply_provider_event(&pev("t1", 1, "tool_start", json!({ "id": "item_0", "name": "shell" })));
        chat.apply_provider_event(&pev("t1", 2, "tool_end", json!({ "id": "item_0", "name": "shell", "ok": true })));
        chat.apply_provider_event(&pev("t1", 3, "done", json!({})));
        chat.begin_ask();
        chat.apply_provider_event(&pev("t2", 1, "tool_start", json!({ "id": "item_0", "name": "read" })));
        let mid = tool_states(&chat);
        assert_eq!(mid.len(), 2, "turn 2 must add its own row: {mid:?}");
        assert!(mid[0].0.starts_with('\u{2713}'), "turn 1 row untouched: {mid:?}");
        assert!(mid[1].0.starts_with('\u{25B6}'), "turn 2 row running: {mid:?}");
        chat.apply_provider_event(&pev("t2", 2, "tool_end", json!({ "id": "item_0", "name": "read", "ok": false })));
        let end = tool_states(&chat);
        assert!(end[0].0.starts_with('\u{2713}') && !end[0].1, "turn 1 untouched by turn 2 end: {end:?}");
        assert!(end[1].0.starts_with('\u{2716}') && end[1].1, "{end:?}");
    }

    #[test]
    fn replayed_turns_reusing_a_tool_id_stay_separate_rows() {
        let mut chat = ChatState::default();
        chat.replace_from_sidecar_transcript(&[
            json!({ "type": "user_message", "content": "one" }),
            json!({ "type": "tool_execution_start", "toolName": "shell", "toolCallId": "item_0" }),
            json!({ "type": "tool_execution_end", "toolName": "shell", "toolCallId": "item_0", "isError": false }),
            json!({ "type": "user_message", "content": "two" }),
            json!({ "type": "tool_execution_start", "toolName": "read", "toolCallId": "item_0" }),
            json!({ "type": "tool_execution_end", "toolName": "read", "toolCallId": "item_0", "isError": true }),
        ]);
        let t = tool_states(&chat);
        assert_eq!(t.len(), 2, "{t:?}");
        assert!(t[0].0.starts_with('\u{2713}') && !t[0].1, "{t:?}");
        assert!(t[1].0.starts_with('\u{2716}') && t[1].1, "{t:?}");
    }

    #[test]
    fn pi_tool_execution_correlation_stays_global_by_tool_call_id() {
        let mut chat = ChatState::default();
        chat.apply_sidecar_event(&json!({ "type": "tool_execution_start", "toolName": "bash", "toolCallId": "p1" }));
        chat.push_replay_message(MessageRole::User, "next");
        chat.apply_sidecar_event(&json!({ "type": "tool_execution_end", "toolName": "bash", "toolCallId": "p1", "isError": false }));
        let t = tool_states(&chat);
        assert_eq!(t.len(), 1, "{t:?}");
        assert!(t[0].0.starts_with('\u{2713}'), "{t:?}");
    }

    #[test]
    fn provider_tool_end_without_start_still_renders_a_row() {
        let mut chat = ChatState::default();
        chat.begin_ask();
        chat.apply_provider_event(&pev("t1", 1, "tool_end", json!({ "id": "z", "name": "x", "ok": true })));
        assert_eq!(rows(&chat, MessageRole::Tool).len(), 1);
    }

    #[test]
    fn provider_progress_updates_a_single_activity_row_and_it_is_removed_on_done() {
        let mut chat = ChatState::default();
        chat.begin_ask();
        let base = chat.messages.len();
        chat.apply_provider_event(&pev("t1", 1, "progress", json!({ "id": "p1", "summary": "Thinking" })));
        chat.apply_provider_event(&pev("t1", 2, "progress", json!({ "id": "p2", "summary": "Reading files" })));
        chat.apply_provider_event(&pev("t1", 3, "progress", json!({ "summary": "Writing" })));
        assert_eq!(chat.messages.len(), base + 1, "progress must not spam rows");
        assert!(chat.messages.last().unwrap().content.contains("Writing"));
        assert!(!chat.ask_answer_already_shown(), "progress is not an answer");
        chat.apply_provider_event(&pev("t1", 4, "final", json!({})));
        chat.apply_provider_event(&pev("t1", 5, "done", json!({})));
        assert_eq!(chat.messages.len(), base, "activity row is dropped at the terminal");
    }

    #[test]
    fn provider_error_is_informational_and_keeps_the_turn_in_flight() {
        let mut chat = ChatState::default();
        chat.begin_ask();
        chat.apply_provider_event(&pev("t1", 1, "text", json!({ "text": "par" })));
        chat.apply_provider_event(&pev("t1", 2, "error", json!({ "message": "hiccup" })));
        let e = rows(&chat, MessageRole::Error);
        assert_eq!(e.len(), 1);
        assert_eq!(e[0].content, "hiccup");
        assert!(e[0].is_error);
        assert!(chat.ask_in_flight, "a non-terminal error must not end the turn");
        // later events of the same turn are still applied
        assert!(chat.apply_provider_event(&pev("t1", 3, "progress", json!({ "summary": "retrying" }))));
        assert!(chat.apply_provider_event(&pev("t1", 4, "text", json!({ "text": "tial" }))));
        assert!(chat.ask_in_flight);
        assert!(chat.apply_provider_event(&pev("t1", 5, "done", json!({}))));
        assert!(!chat.ask_in_flight);
    }

    #[test]
    fn provider_failed_terminal_shows_error_row_clears_flags_and_ignores_late_events() {
        let mut chat = ChatState::default();
        chat.begin_ask();
        chat.apply_provider_event(&pev("t1", 1, "text", json!({ "text": "par" })));
        chat.apply_provider_event(&pev("t1", 2, "failed", json!({ "message": "boom" })));
        let e = rows(&chat, MessageRole::Error);
        assert_eq!(e.len(), 1);
        assert_eq!(e[0].content, "boom");
        assert!(e[0].is_error);
        assert!(!chat.ask_in_flight);
        assert!(chat.messages.iter().all(|m| !m.streaming));
        let n = chat.messages.len();
        assert!(!chat.apply_provider_event(&pev("t1", 3, "failed", json!({ "message": "boom" }))));
        assert!(!chat.apply_provider_event(&pev("t1", 4, "text", json!({ "text": "late" }))));
        assert!(!chat.apply_provider_event(&pev("t1", 5, "done", json!({}))));
        assert_eq!(chat.messages.len(), n);
    }

    #[test]
    fn failed_after_an_identical_informational_error_adds_no_second_error_row() {
        // Rule: `failed` skips its Error row only when the turn's most recent
        // informational `error` carried the very same message.
        let mut chat = ChatState::default();
        chat.begin_ask();
        chat.apply_provider_event(&pev("t1", 1, "error", json!({ "message": "boom" })));
        chat.apply_provider_event(&pev("t1", 2, "failed", json!({ "message": "boom" })));
        assert_eq!(rows(&chat, MessageRole::Error).len(), 1);
        assert!(!chat.ask_in_flight);

        // A different terminal message still gets its own row.
        let mut chat = ChatState::default();
        chat.begin_ask();
        chat.apply_provider_event(&pev("t2", 1, "error", json!({ "message": "hiccup" })));
        chat.apply_provider_event(&pev("t2", 2, "failed", json!({ "message": "fatal" })));
        let e = rows(&chat, MessageRole::Error);
        assert_eq!(e.len(), 2);
        assert_eq!(e[1].content, "fatal");
    }

    #[test]
    fn esc_state_survives_an_informational_error_and_only_failed_clears_it() {
        let mut chat = ChatState::default();
        chat.begin_ask();
        chat.apply_provider_event(&pev("t1", 1, "error", json!({ "message": "x" })));
        chat.apply_provider_event(&pev("t1", 2, "progress", json!({ "summary": "still" })));
        assert!(chat.ask_in_flight);
        chat.apply_provider_event(&pev("t1", 3, "failed", json!({ "message": "x" })));
        assert!(!chat.ask_in_flight);
    }

    #[test]
    fn events_after_done_are_ignored() {
        let mut chat = ChatState::default();
        chat.begin_ask();
        chat.apply_provider_event(&pev("t1", 1, "done", json!({})));
        let n = chat.messages.len();
        assert!(!chat.apply_provider_event(&pev("t1", 2, "error", json!({ "message": "late" }))));
        assert!(!chat.apply_provider_event(&pev("t1", 3, "failed", json!({ "message": "late" }))));
        assert_eq!(chat.messages.len(), n);
    }

    #[test]
    fn provider_cancelled_terminal_shows_cancelled_row_and_ignores_late_events() {
        let mut chat = ChatState::default();
        chat.begin_ask();
        chat.apply_provider_event(&pev("t1", 1, "text", json!({ "text": "par" })));
        chat.apply_provider_event(&pev("t1", 2, "cancelled", json!({})));
        let last = chat.messages.last().unwrap();
        assert_eq!(last.role, MessageRole::System);
        assert_eq!(last.content, CANCELLED_MARKER);
        assert!(!chat.ask_in_flight);
        assert!(chat.messages.iter().all(|m| !m.streaming));
        let n = chat.messages.len();
        assert!(!chat.apply_provider_event(&pev("t1", 3, "text", json!({ "text": "late" }))));
        assert!(!chat.apply_provider_event(&pev("t1", 4, "done", json!({}))));
        assert_eq!(chat.messages.len(), n);
    }

    #[test]
    fn late_events_of_a_cancelled_turn_do_not_leak_into_the_next_turn() {
        let mut chat = ChatState::default();
        chat.begin_ask();
        chat.apply_provider_event(&pev("t1", 1, "cancelled", json!({})));
        chat.begin_ask();
        assert!(!chat.apply_provider_event(&pev("t1", 9, "text", json!({ "text": "late" }))));
        assert!(chat.ask_in_flight, "old turn must not end the new one");
        assert!(chat.apply_provider_event(&pev("t2", 1, "text", json!({ "text": "new" }))));
    }

    #[test]
    fn foreign_turn_duplicate_and_out_of_order_events_are_ignored() {
        let mut chat = ChatState::default();
        chat.begin_ask();
        assert!(chat.apply_provider_event(&pev("t1", 2, "text", json!({ "text": "a" }))));
        assert!(!chat.apply_provider_event(&pev("t1", 2, "text", json!({ "text": "dup" }))));
        assert!(!chat.apply_provider_event(&pev("t1", 1, "text", json!({ "text": "old" }))));
        assert!(!chat.apply_provider_event(&pev("other", 3, "text", json!({ "text": "x" }))));
        assert!(!chat.apply_provider_event(&pev("other", 4, "cancelled", json!({}))));
        assert!(chat.ask_in_flight);
        assert_eq!(rows(&chat, MessageRole::Assistant)[0].content, "a");
    }

    #[test]
    fn provider_events_without_an_ask_in_flight_are_ignored() {
        let mut chat = ChatState::default();
        let n = chat.messages.len();
        assert!(!chat.apply_provider_event(&pev("t1", 1, "text", json!({ "text": "x" }))));
        assert_eq!(chat.messages.len(), n);
    }

    #[test]
    fn begin_ask_while_in_flight_keeps_the_active_turn() {
        let mut chat = ChatState::default();
        chat.begin_ask();
        chat.apply_provider_event(&pev("t1", 1, "text", json!({ "text": "a" })));
        chat.begin_ask(); // rejected second prompt path
        assert!(chat.apply_provider_event(&pev("t1", 2, "text", json!({ "text": "b" }))));
        assert_eq!(rows(&chat, MessageRole::Assistant)[0].content, "ab");
    }

    #[test]
    fn transcript_replace_clears_ask_state_and_ignores_the_old_turn() {
        let mut chat = ChatState::default();
        chat.begin_ask();
        chat.apply_provider_event(&pev("t1", 1, "text", json!({ "text": "a" })));
        chat.replace_from_sidecar_transcript(&[]);
        assert!(!chat.ask_in_flight);
        assert!(!chat.apply_provider_event(&pev("t1", 2, "cancelled", json!({}))));
        chat.begin_ask();
        assert!(!chat.apply_provider_event(&pev("t1", 3, "text", json!({ "text": "late" }))));
    }

    #[test]
    fn cancelled_row_round_trips_through_transcript_replay() {
        let mut live = ChatState::default();
        live.begin_ask();
        live.apply_provider_event(&pev("t1", 1, "cancelled", json!({})));
        let stored: Vec<Value> = live
            .messages
            .iter()
            .skip(1)
            .map(|m| json!({ "type": "system_message", "content": m.content }))
            .collect();
        let mut restored = ChatState::default();
        restored.replace_from_sidecar_transcript(&stored);
        assert_eq!(restored.messages, live.messages);
    }

    #[test]
    fn task_result_dedup_only_when_text_events_showed_the_answer() {
        let mut chat = ChatState::default();
        chat.begin_ask();
        assert!(!chat.ask_answer_already_shown());
        chat.apply_provider_event(&pev("t1", 1, "text", json!({ "text": "hi" })));
        assert!(chat.ask_answer_already_shown());
    }
}
