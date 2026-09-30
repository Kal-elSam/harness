//! Pi RPC `extension_ui` dialogs (U3b).
//!
//! Pi emits `extension_ui_request` on stdout; the host answers dialog methods
//! with a one-way `extension_ui_response` on stdin that reuses the **same**
//! request `id`. That write must never go through `bridge.request`'s pending
//! map — see `pi-rpc-bridge.js` `sendRaw` and the sidecar `extension_ui_response`
//! op.
//!
//! Concurrency policy: **one modal at a time, FIFO pending queue**. Dialog
//! ids never mix: cancel/confirm of the active dialog only builds a response
//! for that dialog's id; queued ids stay untouched until promoted.

use serde_json::{json, Value};
use std::collections::VecDeque;

/// Dialog / fire-and-forget methods we render or acknowledge.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExtensionUiMethod {
    Select,
    Confirm,
    Input,
    Editor,
    Notify,
    /// Fire-and-forget status / title / etc. — shown as a notice, no response.
    FireAndForget {
        method: String,
    },
}

impl ExtensionUiMethod {
    pub fn from_wire(method: &str) -> Self {
        match method {
            "select" => Self::Select,
            "confirm" => Self::Confirm,
            "input" => Self::Input,
            "editor" => Self::Editor,
            "notify" => Self::Notify,
            other => Self::FireAndForget {
                method: other.to_string(),
            },
        }
    }
}

/// Parsed request fields needed to render / answer a dialog.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtensionUiRequest {
    pub id: String,
    pub method: ExtensionUiMethod,
    pub title: String,
    pub message: Option<String>,
    pub options: Vec<String>,
    pub placeholder: Option<String>,
    pub prefill: Option<String>,
    pub notify_type: Option<String>,
}

impl ExtensionUiRequest {
    /// Parse a sidecar-forwarded `extension_ui_request` record. Missing `id`
    /// or `method` → `None` (never invent an id).
    pub fn from_record(record: &Value) -> Option<Self> {
        if record.get("type").and_then(|v| v.as_str()) != Some("extension_ui_request") {
            return None;
        }
        let id = record.get("id").and_then(|v| v.as_str())?.to_string();
        if id.is_empty() {
            return None;
        }
        let method_str = record.get("method").and_then(|v| v.as_str())?;
        let method = ExtensionUiMethod::from_wire(method_str);
        let title = record
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or(match &method {
                ExtensionUiMethod::Select => "Select",
                ExtensionUiMethod::Confirm => "Confirm",
                ExtensionUiMethod::Input => "Input",
                ExtensionUiMethod::Editor => "Editor",
                ExtensionUiMethod::Notify => "Notification",
                ExtensionUiMethod::FireAndForget { .. } => "Extension",
            })
            .to_string();
        let message = record
            .get("message")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let options = record
            .get("options")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|o| o.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let placeholder = record
            .get("placeholder")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let prefill = record
            .get("prefill")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let notify_type = record
            .get("notifyType")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        Some(Self {
            id,
            method,
            title,
            message,
            options,
            placeholder,
            prefill,
            notify_type,
        })
    }
}

/// Live modal state for the currently shown dialog (not notify).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtensionUiDialog {
    pub request: ExtensionUiRequest,
    /// Select / confirm highlight index.
    pub selected: usize,
    /// Input / editor draft (own buffer — never the chat compose box).
    pub draft: String,
}

impl ExtensionUiDialog {
    pub fn from_request(request: ExtensionUiRequest) -> Self {
        let draft = request.prefill.clone().unwrap_or_default();
        let selected = 0;
        Self {
            request,
            selected,
            draft,
        }
    }

    pub fn option_count(&self) -> usize {
        match self.request.method {
            ExtensionUiMethod::Select => self.request.options.len(),
            ExtensionUiMethod::Confirm => 2, // Yes / No
            _ => 0,
        }
    }

    pub fn move_down(&mut self) {
        let n = self.option_count();
        if n == 0 {
            return;
        }
        self.selected = (self.selected + 1) % n;
    }

    pub fn move_up(&mut self) {
        let n = self.option_count();
        if n == 0 {
            return;
        }
        self.selected = (self.selected + n - 1) % n;
    }

    /// Confirm the active dialog → a wire payload for the sidecar op, or
    /// `None` when Enter is not applicable (e.g. empty select list).
    pub fn confirm_response(&self) -> Option<Value> {
        let id = &self.request.id;
        match self.request.method {
            ExtensionUiMethod::Select => {
                let value = self.request.options.get(self.selected)?.clone();
                Some(json!({ "id": id, "value": value }))
            }
            ExtensionUiMethod::Confirm => {
                // 0 = Yes → confirmed:true, 1 = No → confirmed:false
                let confirmed = self.selected == 0;
                Some(json!({ "id": id, "confirmed": confirmed }))
            }
            ExtensionUiMethod::Input | ExtensionUiMethod::Editor => {
                Some(json!({ "id": id, "value": self.draft.clone() }))
            }
            ExtensionUiMethod::Notify | ExtensionUiMethod::FireAndForget { .. } => None,
        }
    }

    /// Esc / local cancel for **this** dialog only.
    pub fn cancel_response(&self) -> Value {
        json!({ "id": self.request.id, "cancelled": true })
    }

    pub fn confirm_labels(&self) -> [&'static str; 2] {
        ["Yes", "No"]
    }

    pub fn headline(&self) -> String {
        match (&self.request.method, &self.request.message) {
            (ExtensionUiMethod::Confirm, Some(msg)) if !msg.is_empty() => {
                format!("{} — {}", self.request.title, msg)
            }
            (ExtensionUiMethod::Input, _) => {
                if let Some(ph) = &self.request.placeholder {
                    format!("{} ({})", self.request.title, ph)
                } else {
                    self.request.title.clone()
                }
            }
            _ => self.request.title.clone(),
        }
    }
}

/// One-modal-at-a-time controller with a FIFO pending queue.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ExtensionUiState {
    pub active: Option<ExtensionUiDialog>,
    pub queue: VecDeque<ExtensionUiRequest>,
    /// Latest fire-and-forget notice text (notify / setStatus / setTitle).
    pub notice: Option<String>,
}

/// Outcome of ingesting a request or resolving the active dialog.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExtensionUiEvent {
    /// Show / update the fire-and-forget notice strip (no wire response).
    Notice(String),
    /// Active dialog changed (opened or promoted from queue).
    DialogOpened,
    /// Active dialog closed; carry the sidecar payload (or None when cleared
    /// locally without sending — e.g. engine death with no live bridge).
    DialogClosed { response: Option<Value> },
}

impl ExtensionUiState {
    /// Ingest a forwarded `extension_ui_request`. Notify / fire-and-forget
    /// never occupy the modal. Dialog methods open immediately or enqueue.
    pub fn ingest(&mut self, record: &Value) -> Option<ExtensionUiEvent> {
        let request = ExtensionUiRequest::from_record(record)?;
        match &request.method {
            ExtensionUiMethod::Notify => {
                let kind = request
                    .notify_type
                    .as_deref()
                    .unwrap_or("info")
                    .to_ascii_uppercase();
                let msg = request.message.unwrap_or_else(|| "(notify)".into());
                let text = format!("[{kind}] {msg}");
                self.notice = Some(text.clone());
                Some(ExtensionUiEvent::Notice(text))
            }
            ExtensionUiMethod::FireAndForget { method } => {
                let text = match method.as_str() {
                    "setStatus" => {
                        let key = record
                            .get("statusKey")
                            .and_then(|v| v.as_str())
                            .unwrap_or("?");
                        let status = record
                            .get("statusText")
                            .and_then(|v| v.as_str())
                            .unwrap_or("(cleared)");
                        format!("[status:{key}] {status}")
                    }
                    "setTitle" => {
                        let title = record
                            .get("title")
                            .and_then(|v| v.as_str())
                            .unwrap_or("(title)");
                        format!("[title] {title}")
                    }
                    "set_editor_text" => {
                        let text = record.get("text").and_then(|v| v.as_str()).unwrap_or("");
                        format!("[editor text set] {text}")
                    }
                    other => format!("[{other}]"),
                };
                self.notice = Some(text.clone());
                Some(ExtensionUiEvent::Notice(text))
            }
            ExtensionUiMethod::Select
            | ExtensionUiMethod::Confirm
            | ExtensionUiMethod::Input
            | ExtensionUiMethod::Editor => {
                if self.active.is_none() {
                    self.active = Some(ExtensionUiDialog::from_request(request));
                    Some(ExtensionUiEvent::DialogOpened)
                } else {
                    self.queue.push_back(request);
                    None
                }
            }
        }
    }

    /// Confirm the active dialog; promote the next queued one if any.
    pub fn confirm_active(&mut self) -> Option<ExtensionUiEvent> {
        let dialog = self.active.as_ref()?;
        let response = dialog.confirm_response()?;
        self.active = None;
        self.promote_next();
        Some(ExtensionUiEvent::DialogClosed {
            response: Some(response),
        })
    }

    /// Cancel the active dialog only — queued ids stay pending.
    pub fn cancel_active(&mut self) -> Option<ExtensionUiEvent> {
        let dialog = self.active.as_ref()?;
        let response = dialog.cancel_response();
        self.active = None;
        self.promote_next();
        Some(ExtensionUiEvent::DialogClosed {
            response: Some(response),
        })
    }

    /// Engine death / host quit: drop every dialog. When `send_cancelled` is
    /// true, return cancelled payloads for the active + queued ids (caller
    /// sends them if still connected); otherwise clear silently so the host
    /// is never stuck and unrelated pending RPC requests are untouched.
    pub fn release_all(&mut self, send_cancelled: bool) -> Vec<Value> {
        let mut ids = Vec::new();
        if let Some(active) = self.active.take() {
            ids.push(active.request.id);
        }
        while let Some(req) = self.queue.pop_front() {
            ids.push(req.id);
        }
        if !send_cancelled {
            return Vec::new();
        }
        ids.into_iter()
            .map(|id| json!({ "id": id, "cancelled": true }))
            .collect()
    }

    fn promote_next(&mut self) {
        if self.active.is_some() {
            return;
        }
        if let Some(next) = self.queue.pop_front() {
            self.active = Some(ExtensionUiDialog::from_request(next));
        }
    }

    pub fn is_open(&self) -> bool {
        self.active.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn response_preserves_the_original_request_id() {
        let mut state = ExtensionUiState::default();
        state.ingest(&json!({
            "type": "extension_ui_request",
            "id": "uuid-1",
            "method": "select",
            "title": "Allow?",
            "options": ["Allow", "Block"]
        }));
        let ev = state.confirm_active().expect("confirm");
        match ev {
            ExtensionUiEvent::DialogClosed {
                response: Some(payload),
            } => {
                assert_eq!(payload.get("id").and_then(|v| v.as_str()), Some("uuid-1"));
                assert_eq!(payload.get("value").and_then(|v| v.as_str()), Some("Allow"));
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn queued_dialogs_keep_correlation_cancel_does_not_resolve_another() {
        let mut state = ExtensionUiState::default();
        state.ingest(&json!({
            "type": "extension_ui_request",
            "id": "first",
            "method": "confirm",
            "title": "One",
            "message": "first"
        }));
        state.ingest(&json!({
            "type": "extension_ui_request",
            "id": "second",
            "method": "select",
            "title": "Two",
            "options": ["A", "B"]
        }));
        assert_eq!(state.active.as_ref().unwrap().request.id, "first");
        assert_eq!(state.queue.len(), 1);
        assert_eq!(state.queue[0].id, "second");

        let cancel = state.cancel_active().expect("cancel first");
        match cancel {
            ExtensionUiEvent::DialogClosed {
                response: Some(payload),
            } => {
                assert_eq!(payload.get("id").and_then(|v| v.as_str()), Some("first"));
                assert_eq!(
                    payload.get("cancelled").and_then(|v| v.as_bool()),
                    Some(true)
                );
                assert!(payload.get("value").is_none());
            }
            other => panic!("unexpected {other:?}"),
        }
        // Second is now active — never cancelled by the first cancel.
        assert_eq!(state.active.as_ref().unwrap().request.id, "second");
        let confirm = state.confirm_active().expect("confirm second");
        match confirm {
            ExtensionUiEvent::DialogClosed {
                response: Some(payload),
            } => {
                assert_eq!(payload.get("id").and_then(|v| v.as_str()), Some("second"));
                assert_eq!(payload.get("value").and_then(|v| v.as_str()), Some("A"));
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn engine_death_releases_dialogs_without_mixing_ids() {
        let mut state = ExtensionUiState::default();
        state.ingest(&json!({
            "type": "extension_ui_request",
            "id": "alive-1",
            "method": "input",
            "title": "Name"
        }));
        state.ingest(&json!({
            "type": "extension_ui_request",
            "id": "alive-2",
            "method": "editor",
            "title": "Edit",
            "prefill": "hi"
        }));
        let cancelled = state.release_all(true);
        assert_eq!(cancelled.len(), 2);
        assert_eq!(cancelled[0]["id"], "alive-1");
        assert_eq!(cancelled[0]["cancelled"], true);
        assert_eq!(cancelled[1]["id"], "alive-2");
        assert_eq!(cancelled[1]["cancelled"], true);
        assert!(!state.is_open());
        assert!(state.queue.is_empty());

        // Silent release (host quit / already disconnected) leaves no payloads
        // and clears state so the UI is not stuck.
        state.ingest(&json!({
            "type": "extension_ui_request",
            "id": "stuck",
            "method": "confirm",
            "title": "x",
            "message": "y"
        }));
        let silent = state.release_all(false);
        assert!(silent.is_empty());
        assert!(!state.is_open());
    }

    #[test]
    fn notify_shows_without_requiring_a_response() {
        let mut state = ExtensionUiState::default();
        let ev = state.ingest(&json!({
            "type": "extension_ui_request",
            "id": "n1",
            "method": "notify",
            "message": "Command blocked",
            "notifyType": "warning"
        }));
        match ev {
            Some(ExtensionUiEvent::Notice(text)) => {
                assert!(text.contains("WARNING"));
                assert!(text.contains("Command blocked"));
            }
            other => panic!("expected Notice, got {other:?}"),
        }
        assert!(!state.is_open(), "notify must not open a modal");
        assert!(state.queue.is_empty());
        assert!(state.confirm_active().is_none());
    }

    #[test]
    fn confirm_yes_no_and_input_editor_payload_shapes() {
        let mut state = ExtensionUiState::default();
        state.ingest(&json!({
            "type": "extension_ui_request",
            "id": "c1",
            "method": "confirm",
            "title": "Clear?",
            "message": "All messages will be lost."
        }));
        {
            let d = state.active.as_mut().unwrap();
            d.move_down(); // No
            assert_eq!(d.selected, 1);
        }
        let no = state.confirm_active().unwrap();
        match no {
            ExtensionUiEvent::DialogClosed { response: Some(p) } => {
                assert_eq!(p["id"], "c1");
                assert_eq!(p["confirmed"], false);
            }
            other => panic!("{other:?}"),
        }

        state.ingest(&json!({
            "type": "extension_ui_request",
            "id": "i1",
            "method": "input",
            "title": "Enter",
            "placeholder": "type…"
        }));
        state.active.as_mut().unwrap().draft = "hello".into();
        let input = state.confirm_active().unwrap();
        match input {
            ExtensionUiEvent::DialogClosed { response: Some(p) } => {
                assert_eq!(p["id"], "i1");
                assert_eq!(p["value"], "hello");
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn missing_id_is_ignored_never_invented() {
        let mut state = ExtensionUiState::default();
        assert!(state
            .ingest(&json!({
                "type": "extension_ui_request",
                "method": "select",
                "options": ["A"]
            }))
            .is_none());
        assert!(!state.is_open());
    }
}
