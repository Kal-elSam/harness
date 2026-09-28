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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatState {
    pub messages: Vec<ChatMessage>,
    pub scroll_offset: usize,
    pub is_streaming: bool,
    pub focus: Focus,
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

    /// Find the open `Tool` row for `tool_call_id`, if any.
    fn find_tool_row_mut(&mut self, tool_call_id: &str) -> Option<&mut ChatMessage> {
        self.messages.iter_mut().rev().find(|m| {
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
        for row in rows {
            match row.get("type").and_then(|v| v.as_str()) {
                Some("user_message") => {
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
        // A restored session is never mid-stream — close every row so no
        // ghost "…" placeholder survives the switch.
        self.is_streaming = false;
        for msg in &mut self.messages {
            msg.streaming = false;
        }
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
}
