//! Pi engine readiness from sidecar `ready.engine` (honest, fail-closed).

use serde_json::Value;

/// Snapshot of the bridge engine status after `ready`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineGate {
    pub status: String,
    pub reason: Option<String>,
    pub model_label: Option<String>,
    pub session_id: Option<String>,
}

impl Default for EngineGate {
    fn default() -> Self {
        Self {
            status: "starting".into(),
            reason: None,
            model_label: None,
            session_id: None,
        }
    }
}

impl EngineGate {
    pub fn from_ready_record(record: &Value) -> Self {
        Self::from_sidecar_engine_record(record)
    }

    /// `ready` / `engine` sidecar records (`engine` object plus optional `modelLabel`).
    pub fn from_sidecar_engine_record(record: &Value) -> Self {
        let engine = record.get("engine").cloned().unwrap_or(Value::Null);
        let mut gate = Self::from_engine_value(&engine);
        if let Some(label) = record
            .get("modelLabel")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            gate.model_label = Some(label.to_string());
        }
        gate
    }

    pub fn from_engine_value(engine: &Value) -> Self {
        let status = engine
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        let reason = engine
            .get("reason")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        let model_label = engine
            .get("modelLabel")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .or_else(|| {
                engine
                    .get("model")
                    .and_then(|m| m.get("id"))
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
            });
        let session_id = engine
            .get("sessionId")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        Self {
            status,
            reason,
            model_label,
            session_id,
        }
    }

    /// Second USAGE strip line: model + optional Pi session id.
    pub fn status_line(&self) -> String {
        let model = self
            .model_label
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or("no model");
        match self.session_id.as_deref().filter(|s| !s.is_empty()) {
            Some(id) => {
                let short = if id.len() > 10 {
                    format!("{}…", &id[..8])
                } else {
                    id.to_string()
                };
                format!("MODEL · {model} · session {short}")
            }
            None => format!("MODEL · {model}"),
        }
    }

    /// Only a fully connected engine may receive prompts.
    pub fn can_prompt(&self) -> bool {
        self.status == "connected"
    }

    /// Notice shown as soon as `ready` arrives when the engine cannot chat.
    pub fn open_notice(&self) -> Option<String> {
        if self.can_prompt() {
            return None;
        }
        Some(self.describe())
    }

    /// Empty-chat hint when the engine cannot prompt (actionable, short).
    pub fn work_empty_hint_lines(&self) -> Option<Vec<String>> {
        if self.can_prompt() {
            return None;
        }
        let line1 = match self.reason.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            Some(reason) => format!("Chat blocked: {} — {reason}", self.status),
            None => format!("Chat blocked: {}", self.status),
        };
        Some(vec![
            line1,
            "Next: kairo --legacy-cockpit → /project analyze → approve team, then reopen.".into(),
        ])
    }

    /// Why a prompt was refused (engine cannot receive it).
    pub fn reject_reason(&self) -> String {
        self.describe()
    }

    fn describe(&self) -> String {
        match (self.status.as_str(), self.reason.as_deref()) {
            ("connected", _) => "Pi engine connected".into(),
            (status, Some(reason)) => format!("Pi engine {status}: {reason}"),
            (status, None) => format!("Pi engine {status}"),
        }
    }
}

/// Decide whether Enter may leave the editor / start an assistant stream.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SubmitDecision {
    /// No bridge: local mock path (explicit non-Pi mode).
    LocalMock,
    /// Bridge ready and engine connected — send prompt.
    SendToPi,
    /// Bridge present but engine cannot take the prompt — keep draft, no ghost reply.
    KeepDraft { notice: String },
}

pub fn decide_submit(bridge_attached: bool, engine: &EngineGate) -> SubmitDecision {
    if !bridge_attached {
        return SubmitDecision::LocalMock;
    }
    if engine.can_prompt() {
        SubmitDecision::SendToPi
    } else {
        SubmitDecision::KeepDraft {
            notice: engine.reject_reason(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ready_unavailable_surfaces_real_reason() {
        let gate = EngineGate::from_ready_record(&json!({
            "type": "ready",
            "engine": {
                "status": "unavailable",
                "reason": "Cannot find package '@kal-elsam/kairo-pi-coding-agent'"
            }
        }));
        assert!(!gate.can_prompt());
        let notice = gate.open_notice().expect("notice");
        assert!(notice.contains("unavailable"));
        assert!(notice.contains("kairo-pi-coding-agent"));
    }

    #[test]
    fn ready_no_model_blocks_prompt_with_honest_status() {
        let gate = EngineGate::from_engine_value(&json!({
            "status": "no_model",
            "reason": "No model selected"
        }));
        assert!(!gate.can_prompt());
        assert_eq!(
            gate.open_notice().as_deref(),
            Some("Pi engine no_model: No model selected")
        );
        let hint = gate.work_empty_hint_lines().expect("hint");
        assert_eq!(hint[0], "Chat blocked: no_model — No model selected");
        assert!(hint[1].contains("legacy-cockpit"));
        assert!(hint[1].contains("/project analyze"));
    }

    #[test]
    fn connected_engine_allows_prompt_without_open_notice() {
        let gate = EngineGate::from_engine_value(&json!({
            "status": "connected",
            "reason": null,
            "model": { "id": "x" }
        }));
        assert!(gate.can_prompt());
        assert_eq!(gate.open_notice(), None);
        assert_eq!(gate.work_empty_hint_lines(), None);
        assert_eq!(decide_submit(true, &gate), SubmitDecision::SendToPi);
    }

    #[test]
    fn disconnected_bridge_keeps_draft_decision() {
        let gate = EngineGate::from_engine_value(&json!({
            "status": "unavailable",
            "reason": "Pi CLI path is empty"
        }));
        match decide_submit(true, &gate) {
            SubmitDecision::KeepDraft { notice } => {
                assert!(notice.contains("unavailable"));
                assert!(notice.contains("Pi CLI path is empty"));
            }
            other => panic!("expected KeepDraft, got {other:?}"),
        }
    }

    #[test]
    fn before_ready_keeps_draft_while_starting() {
        let gate = EngineGate::default();
        assert_eq!(gate.status, "starting");
        assert!(!gate.can_prompt());
        match decide_submit(true, &gate) {
            SubmitDecision::KeepDraft { notice } => {
                assert!(notice.contains("starting"));
            }
            other => panic!("expected KeepDraft, got {other:?}"),
        }
    }

    #[test]
    fn no_bridge_uses_local_mock_path() {
        assert_eq!(
            decide_submit(false, &EngineGate::default()),
            SubmitDecision::LocalMock
        );
    }

    #[test]
    fn status_line_shows_model_and_session_short_id() {
        let gate = EngineGate::from_sidecar_engine_record(&json!({
            "engine": {
                "status": "connected",
                "sessionId": "abcdef012345",
                "model": { "id": "codex::m1" }
            },
            "modelLabel": "GPT · Architect (codex::m1)"
        }));
        let line = gate.status_line();
        assert!(line.contains("MODEL ·"));
        assert!(line.contains("GPT · Architect"));
        assert!(line.contains("session abcdef01"));
    }
}
