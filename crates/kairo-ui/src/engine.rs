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

/// The in-UI next step for a blocked chat. Prefer slash commands so compose
/// never steals a bare `a`/`A` keystroke when the engine looks connected.
pub fn team_next_step_line(team_state: Option<&str>) -> String {
    match team_state {
        Some("suggested") => {
            "Next: type /approve (or press A) — /analyze re-runs the picker.".into()
        }
        Some("active") | Some("stale") => {
            "Next: type /analyze to choose an analyst and re-analyze, then /approve.".into()
        }
        _ => "Next: type /analyze to choose an analyst, then /approve.".into(),
    }
}

/// Whether `a` may open the analyst picker. Always true when the bridge is
/// up — re-analyze is valid even after chat connects. Compose only yields
/// the bare key when the draft is empty (see `team_keys_available`).
pub fn can_analyze_team(_engine: &EngineGate) -> bool {
    true
}

/// Whether `A` (approve) is offered: a real suggested strategy must exist.
pub fn can_approve_team(team_state: Option<&str>) -> bool {
    team_state == Some("suggested")
}

/// Bare `a` / `A` only fire from an empty compose (or non-editor focus).
/// When the engine can prompt, empty-compose `a` still opens the picker so
/// re-analyze stays reachable; non-empty drafts keep every character.
pub fn team_keys_available(focus_is_editor: bool, editor_empty: bool, _can_prompt: bool) -> bool {
    if !focus_is_editor {
        return true;
    }
    editor_empty
}

/// Classify a compose submit that is a host slash command (not a Pi prompt).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlashCommand {
    Analyze,
    Approve,
}

/// Parse `/analyze`, `/project`, `/project analyze`, `/approve`, `/project approve`.
pub fn parse_slash_command(raw: &str) -> Option<SlashCommand> {
    let trimmed = raw.trim();
    if !trimmed.starts_with('/') {
        return None;
    }
    let body = trimmed.trim_start_matches('/').trim().to_ascii_lowercase();
    match body.as_str() {
        "analyze" | "project" | "project analyze" => Some(SlashCommand::Analyze),
        "approve" | "project approve" => Some(SlashCommand::Approve),
        _ => None,
    }
}

/// Decide whether Enter may leave the editor / start an assistant stream.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SubmitDecision {
    /// No bridge: local mock path (explicit non-Pi mode).
    LocalMock,
    /// Bridge attached — send `prompt` op to the sidecar (U4a: routes through
    /// `submitTask` for ASK/PLAN/AGENT; never requires Pi `can_prompt`).
    SendToPi,
    /// Bridge present but the host must keep the draft (reserved; U4a work
    /// modes no longer gate Enter on engine status).
    KeepDraft { notice: String },
}

pub fn decide_submit(bridge_attached: bool, _engine: &EngineGate) -> SubmitDecision {
    if !bridge_attached {
        return SubmitDecision::LocalMock;
    }
    SubmitDecision::SendToPi
}

/// Fail-closed WorkMode values — ask | plan | agent.
pub fn normalize_work_mode(mode: &str) -> &'static str {
    match mode {
        "ask" => "ask",
        "plan" => "plan",
        "agent" => "agent",
        _ => "ask",
    }
}

/// Shift+Tab cycle: ask → plan → agent → ask (plain Tab stays focus).
pub fn next_work_mode(mode: &str) -> &'static str {
    match normalize_work_mode(mode) {
        "ask" => "plan",
        "plan" => "agent",
        _ => "ask",
    }
}

/// Compose chrome title matching cockpit: `Message Kairo · ASK`.
pub fn compose_chrome_title(mode: &str) -> String {
    format!(" Message Kairo · {} ", normalize_work_mode(mode).to_uppercase())
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
        // Team setup is in this UI via slash commands (and empty-compose a/A).
        assert!(hint[1].contains("/analyze"));
        assert!(hint[1].contains("/approve"));
        assert!(!hint[1].contains("legacy-cockpit"));
    }

    #[test]
    fn suggested_team_hint_asks_for_approval_not_another_analysis() {
        let gate = EngineGate::from_engine_value(&json!({
            "status": "no_model",
            "reason": "No active strategy with launchable projectTeam routes"
        }));
        let hint = gate.work_empty_hint_lines(Some("suggested")).expect("hint");
        assert!(hint[1].contains("/approve"));
        assert!(hint[1].contains("/analyze"));
        assert!(can_approve_team(Some("suggested")));
        assert!(!can_approve_team(Some("not_analyzed")));
        assert!(!can_approve_team(None));
        assert!(can_analyze_team(&gate));
    }

    #[test]
    fn analyze_key_stays_available_for_reanalyze_even_when_chat_works() {
        let connected = EngineGate::from_engine_value(&json!({
            "status": "connected",
            "model": { "id": "x" }
        }));
        assert!(can_analyze_team(&connected));
    }

    #[test]
    fn team_keys_only_fire_from_an_empty_compose_or_non_editor_focus() {
        // Empty compose: bare `a` may open the picker (even if chat works).
        assert!(team_keys_available(true, true, true));
        assert!(team_keys_available(true, true, false));
        // Non-empty draft: never steal characters.
        assert!(!team_keys_available(true, false, true));
        assert!(!team_keys_available(true, false, false));
        // Sidebar / transcript focus is never typing.
        assert!(team_keys_available(false, false, true));
    }

    #[test]
    fn parse_slash_command_recognizes_analyze_and_approve_aliases() {
        assert_eq!(parse_slash_command("/analyze"), Some(SlashCommand::Analyze));
        assert_eq!(
            parse_slash_command("  /Project Analyze  "),
            Some(SlashCommand::Analyze)
        );
        assert_eq!(parse_slash_command("/project"), Some(SlashCommand::Analyze));
        assert_eq!(parse_slash_command("/approve"), Some(SlashCommand::Approve));
        assert_eq!(
            parse_slash_command("/project approve"),
            Some(SlashCommand::Approve)
        );
        assert_eq!(parse_slash_command("hello"), None);
        assert_eq!(parse_slash_command("/unknown"), None);
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
    fn u4a_bridge_submit_does_not_require_pi_can_prompt() {
        let gate = EngineGate::from_engine_value(&json!({
            "status": "no_model",
            "reason": "No model selected"
        }));
        assert!(!gate.can_prompt());
        // ASK/PLAN/AGENT go through submitTask on the sidecar — Enter still sends.
        assert_eq!(decide_submit(true, &gate), SubmitDecision::SendToPi);
        assert_eq!(decide_submit(false, &gate), SubmitDecision::LocalMock);
    }

    #[test]
    fn next_work_mode_cycles_ask_plan_agent() {
        assert_eq!(next_work_mode("ask"), "plan");
        assert_eq!(next_work_mode("plan"), "agent");
        assert_eq!(next_work_mode("agent"), "ask");
        assert_eq!(next_work_mode("yolo"), "plan", "invalid fails closed to ask then cycles");
        assert_eq!(normalize_work_mode("yolo"), "ask");
        assert_eq!(normalize_work_mode("agent"), "agent");
    }

    #[test]
    fn compose_chrome_title_shows_live_mode() {
        assert_eq!(compose_chrome_title("ask"), " Message Kairo · ASK ");
        assert_eq!(compose_chrome_title("plan"), " Message Kairo · PLAN ");
        assert_eq!(compose_chrome_title("agent"), " Message Kairo · AGENT ");
        assert_eq!(compose_chrome_title("nope"), " Message Kairo · ASK ");
    }

    #[test]
    fn disconnected_bridge_still_routes_submit_via_sidecar() {
        let gate = EngineGate::from_engine_value(&json!({
            "status": "unavailable",
            "reason": "Pi CLI path is empty"
        }));
        // U4a: work-mode Enter is not gated on Pi engine health.
        assert_eq!(decide_submit(true, &gate), SubmitDecision::SendToPi);
    }

    #[test]
    fn before_ready_still_allows_sidecar_submit() {
        let gate = EngineGate::default();
        assert_eq!(gate.status, "starting");
        assert!(!gate.can_prompt());
        assert_eq!(decide_submit(true, &gate), SubmitDecision::SendToPi);
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
