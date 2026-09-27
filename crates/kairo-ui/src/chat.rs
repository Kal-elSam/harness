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
    Tool,
    System,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatMessage {
    pub role: MessageRole,
    pub content: String,
    pub streaming: bool,
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
        });
    }

    /// Replace chat with Pi transcript rows from the sidecar (`get_messages` mapping).
    pub fn replace_from_sidecar_transcript(&mut self, rows: &[Value]) {
        let mut messages = vec![ChatMessage {
            role: MessageRole::System,
            content: "Type /analyze to choose an analyst · then chat below.".into(),
            streaming: false,
        }];
        for row in rows {
            let Some(obj) = row.as_object() else {
                continue;
            };
            let content = obj
                .get("content")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty());
            let Some(content) = content else {
                continue;
            };
            let role = match obj.get("role").and_then(|v| v.as_str()) {
                Some("user") => MessageRole::User,
                Some("assistant") => MessageRole::Assistant,
                Some("system") => MessageRole::System,
                _ => continue,
            };
            messages.push(ChatMessage {
                role,
                content: content.to_string(),
                streaming: false,
            });
        }
        self.messages = messages;
        self.scroll_offset = 0;
        self.is_streaming = false;
    }

    pub fn begin_assistant_stream(&mut self) {
        self.is_streaming = true;
        self.messages.push(ChatMessage {
            role: MessageRole::Assistant,
            content: String::new(),
            streaming: true,
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
                if let Some(delta) = record
                    .pointer("/assistantMessageEvent/delta")
                    .and_then(|v| v.as_str())
                {
                    if !self.is_streaming {
                        self.begin_assistant_stream();
                    }
                    if let Some(last) = self.messages.last_mut() {
                        if last.role == MessageRole::Assistant && last.streaming {
                            last.content.push_str(delta);
                        }
                    }
                }
            }
            "tool_execution_start" => {
                let name = record
                    .get("toolName")
                    .and_then(|v| v.as_str())
                    .unwrap_or("tool");
                self.messages.push(ChatMessage {
                    role: MessageRole::Tool,
                    content: format!("▶ {name} …"),
                    streaming: false,
                });
            }
            "tool_execution_end" => {
                let name = record
                    .get("toolName")
                    .and_then(|v| v.as_str())
                    .unwrap_or("tool");
                let err = record.get("isError").and_then(|v| v.as_bool()).unwrap_or(false);
                let glyph = if err { "✖" } else { "✓" };
                self.messages.push(ChatMessage {
                    role: MessageRole::Tool,
                    content: format!("{glyph} {name}"),
                    streaming: false,
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
            "toolName": "Read"
        }));
        chat.apply_sidecar_event(&json!({
            "type": "tool_execution_end",
            "toolName": "Read",
            "isError": false
        }));
        let tools: Vec<_> = chat
            .messages
            .iter()
            .filter(|m| m.role == MessageRole::Tool)
            .map(|m| m.content.as_str())
            .collect();
        assert_eq!(tools, vec!["▶ Read …", "✓ Read"]);
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
        assert!(
            chat.messages
                .iter()
                .any(|m| m.role == MessageRole::User && m.content == "hi there")
        );
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
        assert!(
            !chat
                .messages
                .iter()
                .any(|m| m.role == MessageRole::Assistant)
        );
    }

    #[test]
    fn replace_transcript_from_sidecar_rows() {
        let mut chat = ChatState::default();
        chat.submit_user("old".into());
        chat.replace_from_sidecar_transcript(&[
            json!({ "role": "user", "content": "hello" }),
            json!({ "role": "assistant", "content": "hi" }),
        ]);
        assert!(
            chat.messages
                .iter()
                .any(|m| m.role == MessageRole::User && m.content == "hello")
        );
        assert!(
            chat.messages
                .iter()
                .any(|m| m.role == MessageRole::Assistant && m.content == "hi")
        );
        assert!(
            !chat
                .messages
                .iter()
                .any(|m| m.role == MessageRole::User && m.content == "old")
        );
        assert_eq!(chat.scroll_offset, 0);
        assert!(!chat.is_streaming);
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
