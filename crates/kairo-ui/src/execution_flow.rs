//! U4c execution flow: role select → planExecution preview → confirm/cancel
//! / MANUAL_HANDOFF. Nested modals own keys so list-focus `y`/`n` (approve/
//! reject) never fire while confirming execute.
//!
//! WAIT_FOR_PROJECT_TEAM + suggested-alternative is NEVER auto-executed: the
//! sidecar only previews it, and this modal asks for an explicit `y` naming
//! the concrete provider/model before `plans.execute` is sent.

use serde_json::Value;

/// Role picker before `plans.preview` — roles come from an active
/// `projectTeam` only (never inferred from task text).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoleSelectState {
    pub task_id: String,
    pub roles: Vec<String>,
    pub selected: usize,
    pub notice: Option<String>,
}

impl RoleSelectState {
    pub fn new(task_id: impl Into<String>, roles: Vec<String>) -> Self {
        Self {
            task_id: task_id.into(),
            roles,
            selected: 0,
            notice: None,
        }
    }

    pub fn move_down(&mut self) {
        if self.roles.is_empty() {
            return;
        }
        self.selected = (self.selected + 1) % self.roles.len();
    }

    pub fn move_up(&mut self) {
        if self.roles.is_empty() {
            return;
        }
        self.selected = if self.selected == 0 {
            self.roles.len() - 1
        } else {
            self.selected - 1
        };
    }

    pub fn selected_role(&self) -> Option<&str> {
        self.roles.get(self.selected).map(String::as_str)
    }

    pub fn footer_hints(&self) -> &'static str {
        "↑/↓ select · Enter preview · Esc cancel"
    }
}

/// Confirm-execute modal holding a fresh `plan_preview` record.
#[derive(Debug, Clone, PartialEq)]
pub struct ConfirmExecuteState {
    pub task_id: String,
    pub decision: String,
    pub role: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub why: Option<String>,
    pub confirmation_target: Option<Value>,
    pub task_prompt: Option<String>,
    pub model_ref_label: Option<String>,
    /// `provider · model` of `suggestedAlternative`, shown before the `y`.
    pub alternative_label: Option<String>,
    pub notice: Option<String>,
}

impl ConfirmExecuteState {
    /// Build from `{ type: "plan_preview", ... }`. Returns `None` only for a
    /// record that claims it was already executed (`autoExecuted: true`); the
    /// sidecar no longer emits that, so the guard is purely defensive.
    pub fn from_plan_preview(record: &Value) -> Option<Self> {
        if record.get("autoExecuted").and_then(|v| v.as_bool()) == Some(true) {
            return None;
        }
        let task_id = record
            .get("taskId")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())?
            .to_string();
        let decision = record
            .get("decision")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        let confirmation_target = record.get("confirmationTarget").and_then(|v| {
            if v.is_null() {
                None
            } else {
                Some(v.clone())
            }
        });
        let model_ref_label = record
            .pointer("/modelRef/displayName")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let alternative_label = record.get("suggestedAlternative").and_then(|alt| {
            let provider = alt.get("provider").and_then(|v| v.as_str())?;
            let model = alt
                .pointer("/model/displayName")
                .or_else(|| alt.pointer("/model/modelId"))
                .and_then(|v| v.as_str())
                .unwrap_or("unknown model");
            Some(format!("{provider} · {model}"))
        });
        Some(Self {
            task_id,
            decision,
            role: record
                .get("role")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            provider: record
                .get("provider")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            model: record
                .get("model")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            why: record
                .get("why")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            confirmation_target,
            task_prompt: record
                .get("taskPrompt")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            model_ref_label,
            alternative_label,
            notice: None,
        })
    }

    /// Only ROUTED / WAIT_FOR with a real target can confirm. MANUAL_HANDOFF
    /// and blocked WAIT_FOR with null target never launch.
    pub fn can_confirm(&self) -> bool {
        self.confirmation_target.is_some()
    }

    pub fn is_manual_handoff(&self) -> bool {
        self.decision == "MANUAL_HANDOFF"
    }

    pub fn prompt_lines(&self) -> Vec<String> {
        if self.decision == "ROUTED" {
            let model = self.model.as_deref().unwrap_or("default");
            let provider = self.provider.as_deref().unwrap_or("provider");
            return vec![
                format!(
                    "Execute \"{}\" with {} · {}? (y/n)",
                    self.task_id, provider, model
                ),
                format!("Why: {}", self.why.as_deref().unwrap_or("(none)")),
            ];
        }
        if self.is_manual_handoff() {
            let model = self
                .model_ref_label
                .as_deref()
                .or(self.model.as_deref())
                .unwrap_or("the assigned model");
            let provider = self.provider.as_deref().unwrap_or("provider");
            let role = self.role.as_deref().unwrap_or("role");
            return vec![
                format!("{role} is manual-only"),
                format!(
                    "Continue in {provider} with {model} — Kairo can't launch this automatically."
                ),
                "(n/esc to go back — task prompt is in the transcript)".into(),
            ];
        }
        if self.confirmation_target.is_some() {
            let role = self.role.as_deref().unwrap_or("role");
            let mut lines = vec![format!("Assigned model unavailable for {role}")];
            if let Some(alt) = self.alternative_label.as_deref() {
                lines.push(format!("Suggested alternative: {alt}"));
            }
            lines.push(
                self.why
                    .clone()
                    .unwrap_or_else(|| "Suggested alternative available.".into()),
            );
            let confirm = match self.alternative_label.as_deref() {
                Some(alt) => format!("Run {role} with {alt}? (y/n)"),
                None => "Confirm this alternative? (y/n)".into(),
            };
            lines.push(confirm);
            return lines;
        }
        vec![
            format!("Cannot auto-execute \"{}\"", self.task_id),
            self.why
                .clone()
                .unwrap_or_else(|| "no provider available".into()),
            "(n/esc to go back)".into(),
        ]
    }

    pub fn footer_hints(&self) -> &'static str {
        if self.can_confirm() {
            "y confirm · n/Esc cancel"
        } else {
            "n/Esc back (not launchable)"
        }
    }
}

/// Which nested execution modal (if any) owns keys.
#[derive(Debug, Clone, PartialEq)]
pub enum ExecutionModal {
    RoleSelect(RoleSelectState),
    Confirm(ConfirmExecuteState),
}

impl ExecutionModal {
    pub fn swallows_team_keys(&self) -> bool {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn role_select_moves_and_confirms() {
        let mut state = RoleSelectState::new("task-1", vec!["Builder".into(), "Reviewer".into()]);
        assert_eq!(state.selected_role(), Some("Builder"));
        state.move_down();
        assert_eq!(state.selected_role(), Some("Reviewer"));
        state.move_up();
        assert_eq!(state.selected_role(), Some("Builder"));
    }

    #[test]
    fn confirm_from_routed_preview_is_confirmable() {
        let state = ConfirmExecuteState::from_plan_preview(&json!({
            "type": "plan_preview",
            "taskId": "task-1",
            "decision": "ROUTED",
            "role": "Builder",
            "provider": "codex",
            "model": "gpt-6-astra",
            "why": "reasoning",
            "confirmationTarget": {
                "role": "Builder",
                "selection": "assigned",
                "strategyFingerprint": "fp-1",
                "candidateKey": "codex::gpt-6-astra"
            },
            "autoExecuted": false
        }))
        .expect("confirm");
        assert!(state.can_confirm());
        assert!(!state.is_manual_handoff());
        let lines = state.prompt_lines();
        assert!(lines[0].contains("codex"));
        assert!(lines[0].contains("(y/n)"));
    }

    #[test]
    fn suggested_alternative_modal_names_role_provider_model_and_reason() {
        let state = ConfirmExecuteState::from_plan_preview(&json!({
            "type": "plan_preview",
            "taskId": "task-1",
            "decision": "WAIT_FOR_PROJECT_TEAM",
            "role": "Builder",
            "why": "GPT-6 Astra is unavailable",
            "confirmationTarget": {
                "role": "Builder",
                "selection": "suggested-alternative",
                "strategyFingerprint": "fp-1",
                "candidateKey": "claude::claude-opus-5"
            },
            "blockedAssignment": { "provider": "codex", "model": { "displayName": "GPT-6 Astra" } },
            "suggestedAlternative": {
                "provider": "claude",
                "model": { "displayName": "Claude Opus", "modelId": "claude-opus-5" }
            },
            "autoExecuted": false
        }))
        .expect("confirm");
        assert!(state.can_confirm());
        let text = state.prompt_lines().join("\n");
        assert!(text.contains("Builder"), "role: {text}");
        assert!(text.contains("claude"), "provider: {text}");
        assert!(text.contains("Claude Opus"), "model: {text}");
        assert!(text.contains("GPT-6 Astra is unavailable"), "reason: {text}");
        assert!(text.contains("(y/n)"), "explicit gate: {text}");
        assert_eq!(
            state
                .confirmation_target
                .as_ref()
                .and_then(|t| t.get("candidateKey"))
                .and_then(|v| v.as_str()),
            Some("claude::claude-opus-5"),
            "confirmationTarget stays intact"
        );
    }

    #[test]
    fn preview_claiming_prior_execution_never_opens_confirm_modal() {
        assert!(ConfirmExecuteState::from_plan_preview(&json!({
            "taskId": "task-1",
            "decision": "WAIT_FOR_PROJECT_TEAM",
            "confirmationTarget": { "selection": "suggested-alternative" },
            "autoExecuted": true
        }))
        .is_none());
    }

    #[test]
    fn manual_handoff_is_not_confirmable() {
        let state = ConfirmExecuteState::from_plan_preview(&json!({
            "taskId": "task-1",
            "decision": "MANUAL_HANDOFF",
            "role": "Builder",
            "provider": "cursor",
            "model": "cursor-model",
            "confirmationTarget": null,
            "taskPrompt": "# Plan\n\nDo it\n",
            "autoExecuted": false
        }))
        .expect("confirm");
        assert!(!state.can_confirm());
        assert!(state.is_manual_handoff());
        assert!(state.task_prompt.as_deref().unwrap().contains("# Plan"));
        assert!(state
            .prompt_lines()
            .iter()
            .any(|l| l.contains("manual-only")));
    }

    #[test]
    fn wait_without_target_blocks_confirm() {
        let state = ConfirmExecuteState::from_plan_preview(&json!({
            "taskId": "task-1",
            "decision": "WAIT_FOR_PROJECT_TEAM",
            "why": "no alternative",
            "confirmationTarget": null,
            "autoExecuted": false
        }))
        .expect("confirm");
        assert!(!state.can_confirm());
        assert!(state.prompt_lines()[0].contains("Cannot auto-execute"));
    }
}
