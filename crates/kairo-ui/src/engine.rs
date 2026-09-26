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
    /// `team_state` is the snapshot's own `team.state` when known — it only
    /// picks which in-UI next step to name; team setup never leaves this UI.
    pub fn work_empty_hint_lines(&self, team_state: Option<&str>) -> Option<Vec<String>> {
        if self.can_prompt() {
            return None;
        }
        let line1 = match self.reason.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            Some(reason) => format!("Chat blocked: {} — {reason}", self.status),
            None => format!("Chat blocked: {}", self.status),
        };
        Some(vec![line1, team_next_step_line(team_state)])
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

/// The in-UI next step for a blocked chat: `a` analyzes this project's team
/// (default analyst, headless) and `A` approves the suggestion. Both run
/// through the sidecar — no cockpit, no slash command, no second UI.
pub fn team_next_step_line(team_state: Option<&str>) -> String {
    match team_state {
        Some("suggested") => "Next: press A to approve the suggested team (a re-analyzes).".into(),
        Some("active") | Some("stale") => {
            "Next: press a to re-analyze this project's team, then A to approve.".into()
        }
        _ => "Next: press a to analyze project team, then A to approve.".into(),
    }
}

/// Whether `a` (analyze) is offered: only while chat is blocked, so a
/// connected session never loses `a` as a typed character.
pub fn can_analyze_team(engine: &EngineGate) -> bool {
    !engine.can_prompt()
}

/// Whether `A` (approve) is offered: a real suggested strategy must exist.
pub fn can_approve_team(team_state: Option<&str>) -> bool {
    team_state == Some("suggested")
}

/// Whether the `a` / `A` team keys may be read as keys at all. A compose box
/// that can send keeps every character; Sidebar / Transcript focus is not
/// typing, so the keys stay available there.
pub fn team_keys_available(focus_is_editor: bool, editor_empty: bool, can_prompt: bool) -> bool {
    if !focus_is_editor {
        return true;
    }
    editor_empty && !can_prompt
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
        let hint = gate.work_empty_hint_lines(None).expect("hint");
        assert_eq!(hint[0], "Chat blocked: no_model — No model selected");
        // Team setup is in this UI: keys, never a cockpit round trip.
        assert!(hint[1].contains("press a"));
        assert!(hint[1].contains("A to approve"));
        assert!(!hint[1].contains("legacy-cockpit"));
        assert!(!hint[1].contains("/project analyze"));
    }

    #[test]
    fn suggested_team_hint_asks_for_approval_not_another_analysis() {
        let gate = EngineGate::from_engine_value(&json!({
            "status": "no_model",
            "reason": "No active strategy with launchable projectTeam routes"
        }));
        let hint = gate.work_empty_hint_lines(Some("suggested")).expect("hint");
        assert!(hint[1].contains("press A to approve"));
        assert!(can_approve_team(Some("suggested")));
        assert!(!can_approve_team(Some("not_analyzed")));
        assert!(!can_approve_team(None));
        assert!(can_analyze_team(&gate));
    }

    #[test]
    fn analyze_key_is_not_offered_while_chat_works() {
        let connected = EngineGate::from_engine_value(&json!({
            "status": "connected",
            "model": { "id": "x" }
        }));
        assert!(!can_analyze_team(&connected));
    }

    #[test]
    fn team_keys_never_steal_characters_from_a_working_compose_box() {
        // Editor focus, chat works: 'a' is a character, not a command.
        assert!(!team_keys_available(true, true, true));
        assert!(!team_keys_available(true, false, true));
        // Editor focus with a draft the engine cannot send: keep the draft.
        assert!(!team_keys_available(true, false, false));
        // Blocked chat, empty draft: the key is the only useful action.
        assert!(team_keys_available(true, true, false));
        // Sidebar / transcript focus is never typing.
        assert!(team_keys_available(false, false, true));
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
        assert_eq!(gate.work_empty_hint_lines(None), None);
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
