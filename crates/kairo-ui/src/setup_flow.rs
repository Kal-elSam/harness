//! U2: native setup flow inside Settings (select -> preview -> confirm -> apply).
//!
//! Pure state machine; the host (main.rs) owns I/O. Nothing is sent to the
//! sidecar except `settings.setup.load`, `.preview` (read-only dry run) and
//! `.apply` (only after the explicit confirm modal). Late or mismatched
//! responses are ignored by stage + selection guards.

use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SetupStage {
    /// `settings.setup.load` sent, waiting for options.
    Loading,
    /// Toggle agents / components.
    Select,
    /// Dry-run preview requested (read-only), waiting for the plan.
    Previewing,
    /// Plan shown; `a` opens the confirm modal.
    Preview,
    /// Explicit y/n modal before any write.
    Confirm,
    /// Apply sent, waiting for the result.
    Applying,
    /// Result or fatal error line; any close key leaves the flow.
    Result,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SetupItem {
    pub id: String,
    pub label: String,
    pub detail: String,
    pub selected: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SetupPreviewData {
    pub fingerprint: String,
    pub agents: Vec<String>,
    pub components: Vec<String>,
    pub summary: String,
    pub change_count: usize,
    pub lines: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SetupFlow {
    pub stage: SetupStage,
    pub agents: Vec<SetupItem>,
    pub components: Vec<SetupItem>,
    pub cursor: usize,
    pub preview: Option<SetupPreviewData>,
    /// Sorted selection sent with the in-flight preview (stale-response guard).
    requested: Option<(Vec<String>, Vec<String>)>,
    pub error: Option<String>,
    pub result: Option<String>,
}

fn sorted(mut v: Vec<String>) -> Vec<String> {
    v.sort();
    v
}

fn str_list(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
        .unwrap_or_default()
}

fn error_text(record: &Value) -> String {
    let reason = record.get("reason").and_then(|v| v.as_str()).unwrap_or("error");
    match record.get("error").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
        Some(err) => format!("{reason} · {err}"),
        None => reason.to_string(),
    }
}

impl SetupFlow {
    pub fn loading() -> Self {
        Self {
            stage: SetupStage::Loading,
            agents: Vec::new(),
            components: Vec::new(),
            cursor: 0,
            preview: None,
            requested: None,
            error: None,
            result: None,
        }
    }

    /// Accept the load response only while Loading.
    pub fn apply_load_record(&mut self, record: &Value) -> bool {
        if self.stage != SetupStage::Loading {
            return false;
        }
        if !record.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
            self.error = Some(format!("Setup unavailable · {}", error_text(record)));
            self.stage = SetupStage::Result;
            return true;
        }
        let defaults = record.get("defaults");
        let default_agents = str_list(defaults.and_then(|d| d.get("agents")));
        let default_components = str_list(defaults.and_then(|d| d.get("components")));
        let items = |key: &str, defaults: &[String]| -> Vec<SetupItem> {
            record
                .get(key)
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|entry| {
                            let id = entry.get("id")?.as_str()?.to_string();
                            let label = entry
                                .get("label")
                                .and_then(|v| v.as_str())
                                .unwrap_or(&id)
                                .to_string();
                            let mut detail = entry
                                .get("description")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            if entry.get("detected").and_then(|v| v.as_bool()).unwrap_or(false) {
                                detail = "detected".into();
                            }
                            Some(SetupItem {
                                selected: defaults.contains(&id),
                                id,
                                label,
                                detail,
                            })
                        })
                        .collect()
                })
                .unwrap_or_default()
        };
        self.agents = items("agents", &default_agents);
        self.components = items("components", &default_components);
        self.cursor = 0;
        self.stage = SetupStage::Select;
        self.error = None;
        true
    }

    pub fn selected_agents(&self) -> Vec<String> {
        self.agents.iter().filter(|i| i.selected).map(|i| i.id.clone()).collect()
    }

    pub fn selected_components(&self) -> Vec<String> {
        self.components.iter().filter(|i| i.selected).map(|i| i.id.clone()).collect()
    }

    fn item_count(&self) -> usize {
        self.agents.len() + self.components.len()
    }

    pub fn move_cursor(&mut self, delta: isize) {
        if self.stage != SetupStage::Select || self.item_count() == 0 {
            return;
        }
        let max = self.item_count() as isize - 1;
        self.cursor = (self.cursor as isize + delta).clamp(0, max) as usize;
    }

    /// Toggle the item under the cursor; any existing preview becomes invalid.
    pub fn toggle(&mut self) {
        if self.stage != SetupStage::Select {
            return;
        }
        let agent_count = self.agents.len();
        let item = if self.cursor < agent_count {
            self.agents.get_mut(self.cursor)
        } else {
            self.components.get_mut(self.cursor - agent_count)
        };
        if let Some(item) = item {
            item.selected = !item.selected;
            self.preview = None;
            self.error = None;
        }
    }

    /// Start a read-only preview. Returns the selection to send.
    pub fn begin_preview(&mut self) -> Option<(Vec<String>, Vec<String>)> {
        if self.stage != SetupStage::Select {
            return None;
        }
        let agents = self.selected_agents();
        if agents.is_empty() {
            self.error = Some("Select at least one agent before previewing.".into());
            return None;
        }
        let components = self.selected_components();
        self.requested = Some((sorted(agents.clone()), sorted(components.clone())));
        self.preview = None;
        self.error = None;
        self.result = None;
        self.stage = SetupStage::Previewing;
        Some((agents, components))
    }

    /// Accept a preview response only while Previewing and only for the
    /// selection that was requested.
    pub fn apply_preview_record(&mut self, record: &Value) -> bool {
        if self.stage != SetupStage::Previewing {
            return false;
        }
        if !record.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
            self.error = Some(format!("Preview failed · {}", error_text(record)));
            self.requested = None;
            self.stage = SetupStage::Select;
            return true;
        }
        let agents = str_list(record.get("agents"));
        let components = str_list(record.get("components"));
        let echoed = (sorted(agents.clone()), sorted(components.clone()));
        if self.requested.as_ref() != Some(&echoed) {
            return false;
        }
        let fingerprint = record
            .get("fingerprint")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if fingerprint.is_empty() {
            self.error = Some("Preview failed · missing fingerprint".into());
            self.requested = None;
            self.stage = SetupStage::Select;
            return true;
        }
        let lines = record
            .get("changes")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .map(|c| {
                        let get = |k: &str| c.get(k).and_then(|v| v.as_str()).unwrap_or("?");
                        format!("{} {} {}", get("action"), get("kind"), get("target"))
                    })
                    .collect()
            })
            .unwrap_or_default();
        self.preview = Some(SetupPreviewData {
            fingerprint,
            agents,
            components,
            summary: record
                .get("summary")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            change_count: record.get("changeCount").and_then(|v| v.as_u64()).unwrap_or(0) as usize,
            lines,
        });
        self.requested = None;
        self.stage = SetupStage::Preview;
        true
    }

    /// Open the explicit confirm modal (Preview only).
    pub fn begin_confirm(&mut self) -> bool {
        if self.stage == SetupStage::Preview && self.preview.is_some() {
            self.stage = SetupStage::Confirm;
            true
        } else {
            false
        }
    }

    /// `y` in the confirm modal: returns the previewed selection + fingerprint.
    pub fn confirm_apply(&mut self) -> Option<(Vec<String>, Vec<String>, String)> {
        if self.stage != SetupStage::Confirm {
            return None;
        }
        let preview = self.preview.as_ref()?;
        let out = (
            preview.agents.clone(),
            preview.components.clone(),
            preview.fingerprint.clone(),
        );
        self.stage = SetupStage::Applying;
        Some(out)
    }

    /// Accept the apply response only while Applying. `Some(ok)` when consumed.
    pub fn apply_result_record(&mut self, record: &Value) -> Option<bool> {
        if self.stage != SetupStage::Applying {
            return None;
        }
        let ok = record.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
        if ok {
            let agents = str_list(record.get("agents"));
            let components = str_list(record.get("components"));
            self.result = Some(format!(
                "Setup applied · agents: {} · components: {}",
                agents.join(", "),
                if components.is_empty() {
                    "core only".to_string()
                } else {
                    components.join(", ")
                }
            ));
            self.error = None;
        } else {
            self.error = Some(format!("Setup not applied · {}", error_text(record)));
            self.result = None;
        }
        self.preview = None;
        self.stage = SetupStage::Result;
        Some(ok)
    }

    /// Esc: step back one stage. Returns true when the flow should close.
    /// Never sends anything; a pending response is ignored once the stage moved.
    pub fn escape(&mut self) -> bool {
        match self.stage {
            SetupStage::Confirm => {
                self.stage = SetupStage::Preview;
                false
            }
            SetupStage::Preview => {
                self.preview = None;
                self.stage = SetupStage::Select;
                false
            }
            SetupStage::Previewing => {
                self.requested = None;
                self.stage = SetupStage::Select;
                false
            }
            _ => true,
        }
    }

    pub fn footer_hints(&self) -> &'static str {
        match self.stage {
            SetupStage::Loading => "Loading setup options… · Esc close",
            SetupStage::Select => "↑↓ move · Space toggle · p preview · Esc close",
            SetupStage::Previewing => "Previewing (nothing written)… · Esc back",
            SetupStage::Preview => "↑↓ scroll · a apply… · Esc back (nothing applied)",
            SetupStage::Confirm => "y apply · n/Esc cancel",
            SetupStage::Applying => "Applying… please wait",
            SetupStage::Result => "Esc close",
        }
    }

    /// Body-line index of the cursor row (used to keep it in view).
    pub fn cursor_line(&self) -> usize {
        let base = self.error.is_some() as usize * 2;
        if self.cursor < self.agents.len() {
            base + 1 + self.cursor
        } else {
            base + 1 + self.agents.len() + 1 + (self.cursor - self.agents.len())
        }
    }

    pub fn body_lines(&self) -> Vec<String> {
        let mut out = Vec::new();
        if let Some(err) = &self.error {
            out.push(format!("Error · {err}"));
            out.push(String::new());
        }
        match self.stage {
            SetupStage::Loading => out.push("Setup · loading options…".into()),
            SetupStage::Select | SetupStage::Previewing => {
                out.push("Setup · Agents".into());
                for (i, item) in self.agents.iter().enumerate() {
                    out.push(self.item_line(i, item));
                }
                out.push("Setup · Components".into());
                for (i, item) in self.components.iter().enumerate() {
                    out.push(self.item_line(self.agents.len() + i, item));
                }
                if self.stage == SetupStage::Previewing {
                    out.push(String::new());
                    out.push("  previewing… (dry run, nothing written)".into());
                }
            }
            SetupStage::Preview | SetupStage::Confirm | SetupStage::Applying => {
                out.push("Setup · Plan".into());
                if let Some(p) = &self.preview {
                    out.push(format!("  {}", p.summary));
                    out.push(format!("  agents: {}", p.agents.join(", ")));
                    out.push(format!(
                        "  components: {}",
                        if p.components.is_empty() {
                            "core only".to_string()
                        } else {
                            p.components.join(", ")
                        }
                    ));
                    for line in &p.lines {
                        out.push(format!("  {line}"));
                    }
                }
                if self.stage == SetupStage::Applying {
                    out.push(String::new());
                    out.push("  applying…".into());
                }
            }
            SetupStage::Result => {
                out.push("Setup · Result".into());
                if let Some(r) = &self.result {
                    out.push(format!("  {r}"));
                } else if self.error.is_none() {
                    out.push("  (no result)".into());
                }
            }
        }
        out
    }

    fn item_line(&self, index: usize, item: &SetupItem) -> String {
        let marker = if self.stage == SetupStage::Select && index == self.cursor {
            ">"
        } else {
            " "
        };
        let check = if item.selected { "x" } else { " " };
        if item.detail.is_empty() {
            format!(" {marker} [{check}] {} · {}", item.id, item.label)
        } else {
            format!(" {marker} [{check}] {} · {} ({})", item.id, item.label, item.detail)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn load_record() -> Value {
        json!({
            "type": "settings_setup_load",
            "ok": true,
            "agents": [
                { "id": "claude", "label": "Claude Code", "detected": true },
                { "id": "codex", "label": "Codex", "detected": false }
            ],
            "components": [
                { "id": "orchestrator", "label": "Orchestrator", "description": "Coordinates agents", "defaultEnabled": true },
                { "id": "engram-memory", "label": "Engram", "description": "Memory", "defaultEnabled": false }
            ],
            "defaults": { "agents": ["claude"], "components": ["orchestrator"] }
        })
    }

    fn preview_record(agents: &[&str], components: &[&str]) -> Value {
        json!({
            "type": "settings_setup_preview",
            "ok": true,
            "fingerprint": "fp-abc",
            "agents": agents,
            "components": components,
            "summary": "2 managed change(s) planned.",
            "changeCount": 2,
            "changes": [
                { "kind": "config", "action": "create", "target": ".claude/CLAUDE.md", "status": "planned" },
                { "kind": "config", "action": "update", "target": ".codex/AGENTS.md", "status": "planned" }
            ]
        })
    }

    fn loaded() -> SetupFlow {
        let mut flow = SetupFlow::loading();
        assert!(flow.apply_load_record(&load_record()));
        flow
    }

    #[test]
    fn load_record_populates_items_with_defaults_selected() {
        let flow = loaded();
        assert_eq!(flow.stage, SetupStage::Select);
        assert_eq!(flow.selected_agents(), vec!["claude".to_string()]);
        assert_eq!(flow.selected_components(), vec!["orchestrator".to_string()]);
        let body = flow.body_lines().join("\n");
        assert!(body.contains("Setup · Agents"), "{body}");
        assert!(body.contains("[x] claude"), "{body}");
        assert!(body.contains("(detected)"), "{body}");
        assert!(body.contains("[ ] codex"), "{body}");
        assert!(body.contains("[ ] engram-memory"), "{body}");
    }

    #[test]
    fn load_failure_is_visible_and_closable() {
        let mut flow = SetupFlow::loading();
        assert!(flow.apply_load_record(&json!({ "ok": false, "reason": "load_failed", "error": "boom" })));
        assert_eq!(flow.stage, SetupStage::Result);
        assert!(flow.body_lines().join("\n").contains("boom"));
        assert!(flow.escape());
    }

    #[test]
    fn load_record_ignored_when_not_loading() {
        let mut flow = loaded();
        flow.toggle();
        let before = flow.clone();
        assert!(!flow.apply_load_record(&load_record()));
        assert_eq!(flow, before);
    }

    #[test]
    fn cursor_moves_across_agents_then_components_and_toggle_flips() {
        let mut flow = loaded();
        flow.move_cursor(1);
        flow.toggle();
        assert_eq!(flow.selected_agents().len(), 2);
        flow.move_cursor(2);
        flow.toggle();
        assert_eq!(flow.selected_components(), vec!["orchestrator".to_string(), "engram-memory".to_string()]);
        flow.move_cursor(-10);
        assert_eq!(flow.cursor, 0);
        flow.move_cursor(100);
        assert_eq!(flow.cursor, 3);
    }

    #[test]
    fn begin_preview_requires_an_agent() {
        let mut flow = loaded();
        flow.toggle(); // unselect claude
        assert!(flow.begin_preview().is_none());
        assert_eq!(flow.stage, SetupStage::Select);
        assert!(flow.error.as_deref().unwrap_or("").contains("at least one agent"));
    }

    #[test]
    fn preview_flow_matching_response_moves_to_preview() {
        let mut flow = loaded();
        let (agents, components) = flow.begin_preview().unwrap();
        assert_eq!(agents, vec!["claude".to_string()]);
        assert_eq!(components, vec!["orchestrator".to_string()]);
        assert_eq!(flow.stage, SetupStage::Previewing);
        assert!(flow.apply_preview_record(&preview_record(&["claude"], &["orchestrator"])));
        assert_eq!(flow.stage, SetupStage::Preview);
        let body = flow.body_lines().join("\n");
        assert!(body.contains("2 managed change(s) planned."), "{body}");
        assert!(body.contains("create config .claude/CLAUDE.md"), "{body}");
    }

    #[test]
    fn mismatched_or_unsolicited_preview_is_ignored() {
        let mut flow = loaded();
        // Unsolicited: still in Select.
        assert!(!flow.apply_preview_record(&preview_record(&["claude"], &["orchestrator"])));
        assert_eq!(flow.stage, SetupStage::Select);
        flow.begin_preview().unwrap();
        // Response for a different selection.
        assert!(!flow.apply_preview_record(&preview_record(&["codex"], &[])));
        assert_eq!(flow.stage, SetupStage::Previewing);
        assert!(flow.preview.is_none());
    }

    #[test]
    fn invalid_selection_preview_error_returns_to_select_with_message() {
        let mut flow = loaded();
        flow.begin_preview().unwrap();
        assert!(flow.apply_preview_record(&json!({
            "ok": false, "reason": "invalid_selection", "error": "Unknown agent \"nope\"."
        })));
        assert_eq!(flow.stage, SetupStage::Select);
        assert!(flow.body_lines().join("\n").contains("Unknown agent"));
    }

    #[test]
    fn toggling_after_preview_invalidates_it() {
        let mut flow = loaded();
        flow.begin_preview().unwrap();
        flow.apply_preview_record(&preview_record(&["claude"], &["orchestrator"]));
        assert!(flow.escape() == false); // Preview -> Select
        assert_eq!(flow.stage, SetupStage::Select);
        assert!(flow.preview.is_none());
        assert!(flow.begin_confirm() == false);
    }

    #[test]
    fn confirm_requires_preview_and_escape_steps_back_without_sending() {
        let mut flow = loaded();
        assert!(!flow.begin_confirm());
        flow.begin_preview().unwrap();
        flow.apply_preview_record(&preview_record(&["claude"], &["orchestrator"]));
        assert!(flow.begin_confirm());
        assert_eq!(flow.stage, SetupStage::Confirm);
        assert!(!flow.escape());
        assert_eq!(flow.stage, SetupStage::Preview);
        assert!(flow.confirm_apply().is_none()); // not in Confirm
        assert!(flow.begin_confirm());
        let (agents, components, fingerprint) = flow.confirm_apply().unwrap();
        assert_eq!(agents, vec!["claude".to_string()]);
        assert_eq!(components, vec!["orchestrator".to_string()]);
        assert_eq!(fingerprint, "fp-abc");
        assert_eq!(flow.stage, SetupStage::Applying);
    }

    #[test]
    fn apply_result_success_and_failure_are_visible() {
        let mut flow = loaded();
        flow.begin_preview().unwrap();
        flow.apply_preview_record(&preview_record(&["claude"], &["orchestrator"]));
        flow.begin_confirm();
        flow.confirm_apply().unwrap();
        assert_eq!(flow.apply_result_record(&json!({ "ok": true, "reason": "applied" })), Some(true));
        assert_eq!(flow.stage, SetupStage::Result);
        assert!(flow.body_lines().join("\n").contains("Setup applied"));

        let mut flow = loaded();
        flow.begin_preview().unwrap();
        flow.apply_preview_record(&preview_record(&["claude"], &["orchestrator"]));
        flow.begin_confirm();
        flow.confirm_apply().unwrap();
        assert_eq!(
            flow.apply_result_record(&json!({ "ok": false, "reason": "stale_preview", "error": "Preview is out of date." })),
            Some(false)
        );
        let body = flow.body_lines().join("\n");
        assert!(body.contains("stale_preview") && body.contains("out of date"), "{body}");
    }

    #[test]
    fn apply_result_ignored_unless_applying() {
        let mut flow = loaded();
        assert_eq!(flow.apply_result_record(&json!({ "ok": true, "reason": "applied" })), None);
        assert_eq!(flow.stage, SetupStage::Select);
    }

    #[test]
    fn escape_from_select_and_loading_closes() {
        let mut flow = loaded();
        assert!(flow.escape());
        assert!(SetupFlow::loading().escape());
    }
}
