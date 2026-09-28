//! Plan / timeline list (U4b + U4c gates): session-scoped tasks from the
//! sidecar's `plans` record (`service.snapshot` timeline). Detail is Markdown
//! from `plan_detail` (`showPlan`). Approve/reject go through `plans.decide`
//! only. Execute/cancel are gated here (`x`/`c`) but routed through the
//! nested U4c execution modals / `plans.execute` / `plans.cancel`.
//!
//! Keybindings (list-focus only — never clash with team `a`/`A`):
//! ↑/↓ move · Enter open Markdown detail · Esc close detail then list ·
//! `y` approve / `n` reject when `awaiting_approval` and WorkMode ≠ ask ·
//! `x` request execute when AGENT + approved + not_started ·
//! `c` cancel when execActive.

use serde_json::Value;

/// One timeline row from the sidecar `plans.timeline` array.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanRow {
    pub task_id: String,
    pub state: String,
    pub task_text: Option<String>,
    pub approval: String,
    pub plan_ready: bool,
    pub exec_state: String,
    pub exec_active: bool,
    pub run_id: Option<String>,
}

impl PlanRow {
    pub fn row_label(&self) -> String {
        let preview = self
            .task_text
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| {
                let one_line = s.lines().next().unwrap_or(s);
                if one_line.chars().count() > 48 {
                    let truncated: String = one_line.chars().take(45).collect();
                    format!("{truncated}…")
                } else {
                    one_line.to_string()
                }
            })
            .unwrap_or_else(|| "(no task text)".into());
        format!(
            "{} · {} — {}",
            short_task_id(&self.task_id),
            self.state,
            preview
        )
    }

    pub fn is_awaiting_approval(&self) -> bool {
        self.state == "awaiting_approval"
    }

    pub fn is_approved(&self) -> bool {
        self.state == "approved" || self.approval == "approved"
    }

    pub fn is_not_started(&self) -> bool {
        self.exec_state == "not_started"
    }
}

fn short_task_id(id: &str) -> String {
    if id.len() > 10 {
        format!("{}…", &id[..8])
    } else {
        id.to_string()
    }
}

/// Markdown detail for the selected plan (`plans.show` → `plan_detail`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanDetail {
    pub task_id: String,
    pub state: String,
    pub markdown: String,
}

/// Open plans list modal. Built from a `plans` record; detail is optional
/// until `plan_detail` arrives.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PlanListState {
    pub rows: Vec<PlanRow>,
    pub selected: usize,
    pub detail: Option<PlanDetail>,
    pub notice: Option<String>,
    /// Active ProjectStrategy roles from the sidecar (`projectTeamRoles`).
    pub project_team_roles: Vec<String>,
}

impl PlanListState {
    /// Build from `{ type: "plans", timeline: [...], projectTeamRoles?: [...] }`.
    /// Rows missing `taskId` are dropped rather than half-rendered.
    pub fn from_plans_record(record: &Value) -> Self {
        let rows: Vec<PlanRow> = record
            .get("timeline")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|entry| {
                        let task_id = entry.get("taskId")?.as_str()?.to_string();
                        let state = entry
                            .get("state")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown")
                            .to_string();
                        let task_text = entry
                            .get("taskText")
                            .and_then(|v| v.as_str())
                            .map(str::to_string);
                        let approval = entry
                            .get("approval")
                            .and_then(|v| v.as_str())
                            .unwrap_or("not_decided")
                            .to_string();
                        let plan_ready = entry
                            .get("planReady")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);
                        let exec = entry.get("execution");
                        let exec_state = exec
                            .and_then(|e| e.get("state"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("not_started")
                            .to_string();
                        let exec_active = exec
                            .and_then(|e| e.get("active"))
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);
                        let run_id = exec
                            .and_then(|e| e.get("runId"))
                            .and_then(|v| v.as_str())
                            .map(str::to_string);
                        Some(PlanRow {
                            task_id,
                            state,
                            task_text,
                            approval,
                            plan_ready,
                            exec_state,
                            exec_active,
                            run_id,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        let project_team_roles = record
            .get("projectTeamRoles")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        Self {
            rows,
            selected: 0,
            detail: None,
            notice: None,
            project_team_roles,
        }
    }

    /// Refresh rows from a new `plans` record while preserving selection
    /// (and clearing detail when the selected task disappeared).
    pub fn refresh_from_plans_record(&mut self, record: &Value) {
        let previous_id = self.selected_row().map(|r| r.task_id.clone());
        let next = Self::from_plans_record(record);
        self.rows = next.rows;
        self.project_team_roles = next.project_team_roles;
        if self.rows.is_empty() {
            self.selected = 0;
            self.detail = None;
            return;
        }
        if let Some(id) = previous_id {
            if let Some(idx) = self.rows.iter().position(|r| r.task_id == id) {
                self.selected = idx;
            } else {
                self.selected = self.selected.min(self.rows.len() - 1);
                self.detail = None;
            }
        } else {
            self.selected = self.selected.min(self.rows.len() - 1);
        }
        if let Some(detail) = &self.detail {
            if !self.rows.iter().any(|r| r.task_id == detail.task_id) {
                self.detail = None;
            }
        }
    }

    pub fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }

    pub fn move_down(&mut self) {
        if self.rows.is_empty() || self.detail.is_some() {
            return;
        }
        self.selected = (self.selected + 1) % self.rows.len();
    }

    pub fn move_up(&mut self) {
        if self.rows.is_empty() || self.detail.is_some() {
            return;
        }
        self.selected = if self.selected == 0 {
            self.rows.len() - 1
        } else {
            self.selected - 1
        };
    }

    pub fn selected_row(&self) -> Option<&PlanRow> {
        self.rows.get(self.selected)
    }

    /// Approve/reject only when the selected row awaits approval and
    /// WorkMode is not ASK (strictly read-only).
    pub fn can_decide(&self, work_mode: &str) -> bool {
        if work_mode == "ask" {
            return false;
        }
        self.selected_row()
            .is_some_and(PlanRow::is_awaiting_approval)
    }

    /// Execute only in AGENT mode for an approved, not-yet-started plan
    /// (cockpit `isActionAvailable("execute")` parity). Cancel is separate.
    pub fn can_execute(&self, work_mode: &str) -> bool {
        if work_mode != "agent" {
            return false;
        }
        self.selected_row()
            .is_some_and(|r| r.is_approved() && r.is_not_started() && !r.exec_active)
    }

    /// Cancel whenever the selected row has an active execution — never
    /// mode-gated (safety action).
    pub fn can_cancel(&self) -> bool {
        self.selected_row().is_some_and(|r| r.exec_active)
    }

    /// Prefer planMarkdown; fall back to taskMarkdown; honest empty copy.
    pub fn apply_plan_detail(&mut self, record: &Value) {
        let task_id = record
            .get("taskId")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if task_id.is_empty() {
            self.notice = Some("plan_detail missing taskId".into());
            return;
        }
        let state = record
            .get("state")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        let plan_md = record
            .get("planMarkdown")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let task_md = record
            .get("taskMarkdown")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let markdown = if !plan_md.is_empty() {
            plan_md.to_string()
        } else if !task_md.is_empty() {
            task_md.to_string()
        } else {
            "(no plan markdown yet)".into()
        };
        self.detail = Some(PlanDetail {
            task_id,
            state,
            markdown,
        });
        self.notice = None;
    }

    /// Esc: close detail first; caller closes the list when detail is None.
    pub fn close_detail_or_list(&mut self) -> bool {
        if self.detail.take().is_some() {
            return false;
        }
        true
    }

    pub fn footer_hints(&self, work_mode: &str) -> String {
        if self.detail.is_some() {
            return "Esc close detail · ↑/↓ list · y approve · n reject (when awaiting)".into();
        }
        let mut parts = vec![
            "↑/↓ select".to_string(),
            "Enter open".to_string(),
            "Esc close".to_string(),
        ];
        if self.can_decide(work_mode) {
            parts.push("y approve".into());
            parts.push("n reject".into());
        } else if work_mode == "ask" {
            parts.push("ASK: read-only".into());
        }
        if self.can_execute(work_mode) {
            parts.push("x execute".into());
        }
        if self.can_cancel() {
            parts.push("c cancel".into());
        }
        parts.join(" · ")
    }
}

/// Host-facing copy after a plan is requested (must not say "press a").
pub const PLAN_REQUESTED_HOST_COPY: &str =
    "Plan requested from Codex. Press p for plans, then y to approve or n to reject.";

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn timeline_record() -> Value {
        json!({
            "type": "plans",
            "timeline": [
                {
                    "taskId": "aaaaaaaa-1111-4000-8000-000000000001",
                    "taskText": "Add OAuth login flow for the web app",
                    "state": "awaiting_approval",
                    "approval": "not_decided",
                    "planReady": true
                },
                {
                    "taskId": "task-2",
                    "taskText": "Done thing",
                    "state": "approved",
                    "approval": "approved",
                    "planReady": true
                }
            ]
        })
    }

    #[test]
    fn from_plans_record_builds_rows_verbatim() {
        let state = PlanListState::from_plans_record(&timeline_record());
        assert_eq!(state.rows.len(), 2);
        assert_eq!(state.rows[0].state, "awaiting_approval");
        assert!(state.rows[0].is_awaiting_approval());
        assert!(!state.rows[1].is_awaiting_approval());
        assert!(state.rows[0].row_label().contains("awaiting_approval"));
    }

    #[test]
    fn move_up_down_wrap_and_skip_when_detail_open() {
        let mut state = PlanListState::from_plans_record(&timeline_record());
        state.move_down();
        assert_eq!(state.selected, 1);
        state.move_down();
        assert_eq!(state.selected, 0);
        state.move_up();
        assert_eq!(state.selected, 1);
        state.detail = Some(PlanDetail {
            task_id: "task-2".into(),
            state: "approved".into(),
            markdown: "# Plan".into(),
        });
        let before = state.selected;
        state.move_down();
        state.move_up();
        assert_eq!(state.selected, before);
    }

    #[test]
    fn can_decide_requires_awaiting_approval_and_non_ask_mode() {
        let state = PlanListState::from_plans_record(&timeline_record());
        assert!(!state.can_decide("ask"));
        assert!(state.can_decide("plan"));
        assert!(state.can_decide("agent"));
        let mut approved_only = PlanListState::from_plans_record(&json!({
            "timeline": [{
                "taskId": "t",
                "state": "approved",
                "approval": "approved",
                "planReady": true
            }]
        }));
        assert!(!approved_only.can_decide("agent"));
        approved_only.selected = 0;
    }

    #[test]
    fn apply_plan_detail_prefers_plan_markdown() {
        let mut state = PlanListState::from_plans_record(&timeline_record());
        state.apply_plan_detail(&json!({
            "type": "plan_detail",
            "taskId": "task-1",
            "state": "awaiting_approval",
            "taskMarkdown": "# Task\n",
            "planMarkdown": "# Plan\n\nDo it\n"
        }));
        let detail = state.detail.expect("detail");
        assert!(detail.markdown.contains("# Plan"));
        assert!(!detail.markdown.contains("# Task"));
    }

    #[test]
    fn apply_plan_detail_falls_back_to_task_markdown() {
        let mut state = PlanListState::default();
        state.apply_plan_detail(&json!({
            "taskId": "t1",
            "state": "draft",
            "taskMarkdown": "# Task only\n",
            "planMarkdown": null
        }));
        assert_eq!(
            state.detail.as_ref().map(|d| d.markdown.as_str()),
            Some("# Task only")
        );
    }

    #[test]
    fn esc_closes_detail_before_list() {
        let mut state = PlanListState::from_plans_record(&timeline_record());
        state.detail = Some(PlanDetail {
            task_id: "x".into(),
            state: "awaiting_approval".into(),
            markdown: "md".into(),
        });
        assert!(!state.close_detail_or_list());
        assert!(state.detail.is_none());
        assert!(state.close_detail_or_list());
    }

    #[test]
    fn refresh_preserves_selected_task_id() {
        let mut state = PlanListState::from_plans_record(&timeline_record());
        state.selected = 1;
        state.refresh_from_plans_record(&timeline_record());
        assert_eq!(
            state.selected_row().map(|r| r.task_id.as_str()),
            Some("task-2")
        );
    }

    #[test]
    fn footer_hints_never_advertise_a_for_approve() {
        let state = PlanListState::from_plans_record(&timeline_record());
        let hints = state.footer_hints("plan");
        assert!(hints.contains("y approve"));
        assert!(hints.contains("n reject"));
        assert!(!hints.contains("a approve"));
        assert!(!PLAN_REQUESTED_HOST_COPY.contains("press a to approve"));
        assert!(PLAN_REQUESTED_HOST_COPY.contains("y to approve"));
    }

    #[test]
    fn can_execute_requires_agent_approved_not_started() {
        let mut state = PlanListState::from_plans_record(&json!({
            "timeline": [{
                "taskId": "t",
                "state": "approved",
                "approval": "approved",
                "planReady": true,
                "execution": { "state": "not_started", "active": false }
            }],
            "projectTeamRoles": ["Builder"]
        }));
        assert!(!state.can_execute("ask"));
        assert!(!state.can_execute("plan"));
        assert!(state.can_execute("agent"));
        assert!(!state.can_cancel());
        state.rows[0].exec_active = true;
        state.rows[0].exec_state = "running".into();
        assert!(!state.can_execute("agent"));
        assert!(state.can_cancel());
        assert_eq!(state.project_team_roles, vec!["Builder".to_string()]);
    }

    #[test]
    fn footer_hints_advertise_x_and_c_when_gated() {
        let state = PlanListState::from_plans_record(&json!({
            "timeline": [{
                "taskId": "t",
                "state": "approved",
                "approval": "approved",
                "execution": { "state": "not_started", "active": false }
            }]
        }));
        let hints = state.footer_hints("agent");
        assert!(hints.contains("x execute"));
        assert!(!hints.contains("c cancel"));
    }

    #[test]
    fn drops_malformed_rows_without_task_id() {
        let state = PlanListState::from_plans_record(&json!({
            "timeline": [
                { "state": "awaiting_approval" },
                { "taskId": "ok", "state": "awaiting_approval", "approval": "not_decided" }
            ]
        }));
        assert_eq!(state.rows.len(), 1);
        assert_eq!(state.rows[0].task_id, "ok");
        assert_eq!(state.rows[0].exec_state, "not_started");
    }
}
