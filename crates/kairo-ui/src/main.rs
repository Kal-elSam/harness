mod analyst_picker;
mod bridge;
mod chat;
mod engine;
mod execution_flow;
mod extension_ui;
mod layout;
mod ops_flow;
mod ops_panel;
mod plan_list;
mod recovery_picker;
mod role_editor;
mod session_picker;
mod settings_panel;
mod snapshot;
mod surfaces;
mod v3_capture;
mod workspace_nav;

use std::collections::HashMap;
use std::env;
use std::io::{self, stdout};
use std::path::PathBuf;

use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::backend::CrosstermBackend;
use ratatui::{Frame, Terminal};
use ratatui_textarea::{Input, Key, TextArea};

use analyst_picker::AnalystPickerState;
use bridge::BridgeClient;
use chat::{sidebar_accepts_selection_keys, ChatState, Focus};
use engine::{
    can_analyze_team, can_approve_team, decide_submit, next_work_mode, normalize_work_mode,
    parse_slash_command, slash_help_text, team_keys_available, EngineGate, SlashCommand,
    SubmitDecision,
};
use execution_flow::{ConfirmExecuteState, ExecutionModal, RoleSelectState};
use extension_ui::{ExtensionUiEvent, ExtensionUiMethod, ExtensionUiState};
use layout::split_shell;
use ops_flow::{OpsConfirmKind, OpsConfirmState};
use ops_panel::{OpsPanelState, OpsPickMode};
use plan_list::{PlanListState, PLAN_REQUESTED_HOST_COPY};
use recovery_picker::RecoveryPreviewState;
use role_editor::{can_edit_team_roles, RoleEditPhase, RoleEditorState};
use session_picker::SessionPickerState;
use settings_panel::SettingsPanelState;
use snapshot::apply_workspace_snapshot;
use surfaces::{
    render_analyst_picker, render_confirm_execute, render_extension_ui, render_operations_view,
    render_plan_list, render_project_view, render_recovery_preview, render_role_editor,
    render_role_select, render_session_picker, render_settings_view, render_shell, ShellViewModel,
};
use workspace_nav::{escape_to_work, view_from_digit, WorkspaceView};

// Keybindings (V2 + R3b + R4):
// - Tab: cycle focus Editor → Sidebar → Transcript
// - Shift+Tab: cycle WorkMode ASK → PLAN → AGENT → ASK (U4a; plain Tab stays focus)
// - Editor: type in textarea; Enter submits via sidecar submitTask (ASK answer / PLAN|AGENT plan); Esc aborts stream or moves focus to Sidebar
// - Sidebar: j/k or arrows move agent selection
// - Transcript: PgUp/PgDn scroll
// - q: quit when Editor is empty; Ctrl+C / Ctrl+Q always quit
// - Bridge only: Ctrl+M cycle Kairo model; Ctrl+N new Pi session; Ctrl+[ / Ctrl+] prev/next session on disk; Ctrl+K compact
// - Bridge only, session management (U3a): Ctrl+L opens a visible, labeled
//   session picker (j/k or arrows, Enter switches, Esc cancels locally — no
//   server call at all on cancel) instead of blind Ctrl+[/] cycling, which
//   still works unchanged. Ctrl+R renames the CURRENT session to whatever
//   is typed in the compose box (then clears it). Ctrl+F forks the CURRENT
//   session into a new one (RPC `clone`) — the source session is untouched.
//   Any unsent draft in the compose box is saved on quit and restored on
//   the next `kairo resume` of the same session.
// - Bridge only, team setup in this UI (no cockpit): type `/analyze` (or empty
//   compose + `a`) to open the analyst picker; `/approve` or `A` when suggested.
//   Esc cancels the picker; q / Ctrl+C quit (TTY restored before bridge kill).
// - Bridge only, availability + recovery (U2c): empty-compose `r` re-probes
//   provider availability on demand (sidebar/CTA update from real evidence,
//   never an invented quota/funds cause); empty-compose `R` builds a
//   strategy-recovery preview when the team is stale/blocked. In the
//   preview modal: Enter/`y` applies (re-verified against CURRENT
//   eligibility — a stale preview is refused and mutates nothing), `x`
//   explicitly rejects (closes the proposal, current team stays active),
//   Esc cancels locally (no server call at all).
// - Bridge only, plans / tasks (U4b+U4d): empty-compose `p` or `3` opens the
//   Tasks view (plan list owns execute keys). Empty-compose `1`–`4` switch
//   Work|Project|Tasks|Sessions; Esc returns to Work. Ctrl+L or `4` opens
//   Sessions. Bare `/project` → Project view; Enter on a SUGGESTED role opens
//   the per-role editor (ACTIVE/STALE refused).
// - Bridge only, slash set (U4d): /help /usage /providers /status
//   /models[--evidence|--verify-access[--refresh]] /why /clear /quit|/exit
//   /plan <task>; keep /analyze|/approve; unknown `/…` never goes to chat.
// - Bridge only, extension UI dialogs (U3b): Pi `extension_ui_request` opens
//   a one-at-a-time modal (FIFO queue for concurrent ids). Esc → cancelled
//   response with the same id; Enter confirms (select/confirm/input/editor);
//   j/k move select/confirm; notify is a notice only (no response). Engine
//   death / quit releases every open dialog so the host is never stuck.
// - n/c: demo notice clear (local, no bridge)

/// The two in-UI team setup actions (`a` / `A`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TeamOp {
    Analyze,
    Approve,
}

impl TeamOp {
    fn progress_notice(self) -> &'static str {
        match self {
            TeamOp::Analyze => "Analyzing project team…",
            TeamOp::Approve => "Approving project team…",
        }
    }

    fn label(self) -> &'static str {
        match self {
            TeamOp::Analyze => "Project analyze",
            TeamOp::Approve => "Team approve",
        }
    }
}

/// Prefer sidecar `pickerNotice`; fall back to a compact Claude absence line
/// when only the longer `unverifiedClaudeNotice` is present. Never invents
/// billing / funds causes.
fn preflight_picker_notice(record: &serde_json::Value) -> Option<String> {
    if let Some(notice) = record
        .get("pickerNotice")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        return Some(notice.to_string());
    }
    let has_unverified = record
        .get("unverifiedClaudeNotice")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .is_some_and(|s| !s.is_empty());
    if has_unverified {
        return Some("Claude: no disponible para análisis ahora".into());
    }
    None
}

/// Honest text for a `recovery` record outcome that does NOT (or no longer)
/// keep the preview modal open — never invents a cause; only the sidecar's
/// own `reason` is ever quoted (see `team-recovery.js`'s own outcomes).
fn recovery_preview_notice(outcome: &str, record: &serde_json::Value) -> String {
    let reason = record.get("reason").and_then(|v| v.as_str());
    match outcome {
        "baseline" => "Team availability baseline recorded — nothing blocked.".into(),
        "activated" => "Team recovered automatically — routes updated.".into(),
        "approved" => "Recovery applied — the recovered team is now active.".into(),
        "rejected" => "Recovery proposal rejected — the current team stays active.".into(),
        "skipped" => match reason {
            Some(r) => format!("No recovery needed right now ({r})."),
            None => "No recovery needed right now.".into(),
        },
        "kept-previous" => match reason {
            Some(r) => {
                format!("Could not recover the project team ({r}). The current team stays active.")
            }
            None => "Could not recover the project team. The current team stays active.".into(),
        },
        "error" => match reason {
            Some(r) => format!("Recovery action refused: {r}"),
            None => "Recovery action refused.".into(),
        },
        other => format!("Recovery outcome: {other}"),
    }
}

struct ShellApp {
    view: ShellViewModel,
    chat: ChatState,
    editor: TextArea<'static>,
    bridge: Option<BridgeClient>,
    engine: EngineGate,
    pi_session_count: usize,
    pi_session_index: usize,
    /// Last prompt accepted by the sidecar write path; restored if Pi rejects it.
    pending_prompt: Option<String>,
    /// A team op (analyze / approve) is in flight — one at a time.
    team_action_pending: bool,
    /// `project.preflight` was sent; waiting on its `preflight` record.
    preflight_pending: bool,
    /// The open analyst picker modal (T2) — `Some` while it owns key input.
    picker: Option<AnalystPickerState>,
    /// `team.revalidate` or `team.recovery.preview` was sent; a second one
    /// is refused with a notice instead of silently piling up.
    availability_action_pending: bool,
    /// The open strategy-recovery preview modal (U2c) — `Some` while it owns
    /// key input. Built only from an `outcome: "proposed"` `recovery`
    /// record, never invented.
    recovery_preview: Option<RecoveryPreviewState>,
    /// `team.recovery.apply` / `.reject` was sent; a second one is refused
    /// with a notice instead of racing the first.
    recovery_action_pending: bool,
    /// The real `sessions` rows last reported by the sidecar (path,
    /// sessionId, label, kairoSessionId) — the session picker (U3a) is
    /// built from this, never invented.
    pi_sessions: Vec<serde_json::Value>,
    /// The open session picker modal (U3a) — `Some` while it owns key input.
    session_picker: Option<SessionPickerState>,
    /// U4b: open plans / timeline list — `Some` while it owns key input
    /// (list-focus gates y/n so team `a`/`A` never clash).
    plan_list: Option<PlanListState>,
    /// True while `plans.list` / `plans.show` / `plans.decide` / U4c exec ops are in flight.
    plans_action_pending: bool,
    /// U4c: nested role-select / confirm-execute modal (owns keys above list).
    execution_modal: Option<ExecutionModal>,
    /// U4c: per-run transcript cursor (`runId` → nextIndex).
    run_transcript_cursors: HashMap<String, u64>,
    /// Pi extension_ui dialogs (U3b): one modal + FIFO queue, correlated by id.
    extension_ui: ExtensionUiState,
    /// The `ready` record's `draft` (if any) has been applied to the editor
    /// exactly once — never re-applied on a later `ready`/`engine` record.
    draft_restored: bool,
    /// U4d: Work | Project | Tasks | Sessions | Operations | Settings.
    workspace_view: WorkspaceView,
    /// U4d: per-role editor modal on Project (SUGGESTED only).
    role_editor: Option<RoleEditorState>,
    /// U5a/U5b: Operations hub state (None until first visit / snapshot).
    ops_panel: Option<OpsPanelState>,
    /// U5b: Settings panel state.
    settings_panel: Option<SettingsPanelState>,
    /// U4d: `/quit`/`/exit` requested from slash handling.
    quit_requested: bool,
}

impl ShellApp {
    fn new(bridge: Option<BridgeClient>) -> Self {
        let mut editor = TextArea::default();
        editor.set_placeholder_text("/analyze · Message…");
        let mut view = ShellViewModel::default();
        if bridge.is_some() {
            view.engine_line = "MODEL · starting".into();
        }
        Self {
            view,
            chat: ChatState::default(),
            editor,
            bridge,
            engine: EngineGate::default(),
            pi_session_count: 0,
            pi_session_index: 0,
            pending_prompt: None,
            team_action_pending: false,
            preflight_pending: false,
            picker: None,
            availability_action_pending: false,
            recovery_preview: None,
            recovery_action_pending: false,
            pi_sessions: Vec::new(),
            session_picker: None,
            plan_list: None,
            plans_action_pending: false,
            execution_modal: None,
            run_transcript_cursors: HashMap::new(),
            extension_ui: ExtensionUiState::default(),
            draft_restored: false,
            workspace_view: WorkspaceView::Work,
            role_editor: None,
            ops_panel: None,
            settings_panel: None,
            quit_requested: false,
        }
    }

    fn sync_engine_line(&mut self) {
        self.view.engine_line = self.engine.status_line();
    }

    /// Blocked-chat hint, recomputed from the current engine + real team state.
    fn sync_empty_hint(&mut self) {
        let hint = self
            .engine
            .work_empty_hint_lines(self.view.team_state.as_deref());
        self.view.work_empty_hint = hint;
    }

    fn ingest_sessions_record(&mut self, record: &serde_json::Value) {
        let Some(list) = record.get("sessions").and_then(|v| v.as_array()) else {
            return;
        };
        self.pi_sessions = list.clone();
        self.pi_session_count = list.len();
        if self.pi_session_index >= self.pi_session_count {
            self.pi_session_index = self.pi_session_count.saturating_sub(1);
        }
        if let Some(sid) = self.engine.session_id.as_deref() {
            for (i, entry) in list.iter().enumerate() {
                if entry
                    .get("sessionId")
                    .and_then(|v| v.as_str())
                    .is_some_and(|id| id == sid)
                {
                    self.pi_session_index = i;
                    break;
                }
            }
        }
    }

    /// U3a: applies the sidecar's `ready.draft` (unsent editor text saved
    /// on a previous quit for this exact Kairo session) exactly once. Never
    /// clobbers text the human already typed before `ready` arrived, and
    /// never re-applies on a later `ready` (e.g. after a reconnect).
    fn restore_draft_once(&mut self, record: &serde_json::Value) {
        if self.draft_restored {
            return;
        }
        self.draft_restored = true;
        if let Some(draft) = record.get("draft").and_then(|v| v.as_str()) {
            if !draft.is_empty() && self.editor.lines().join("").is_empty() {
                self.restore_editor(draft);
            }
        }
    }

    /// U3a close: apply a mid-session `{ type: "draft", text }` record from
    /// the sidecar after a successful switch/new/fork. Empty text clears the
    /// compose box (New/Fork); non-empty replaces it with the destination's
    /// saved draft (Switch). Cancelled transitions never emit this record,
    /// so the live editor stays as the human left it.
    fn apply_draft_record(&mut self, record: &serde_json::Value) {
        let text = record.get("text").and_then(|v| v.as_str()).unwrap_or("");
        if text.is_empty() {
            self.clear_editor();
        } else {
            self.restore_editor(text);
        }
    }

    /// Current compose-box contents — handed to the sidecar on
    /// switch/new/fork/stop so drafts land under the *active* Kairo id.
    fn editor_draft_text(&self) -> String {
        self.editor.lines().join("\n")
    }

    /// `Ctrl+L`: open the visible session picker (U3a) — real rows from the
    /// sidecar's last `sessions`/`ready` record, never invented. Refuses
    /// with a notice instead of opening an empty modal when nothing is
    /// known yet.
    fn open_session_picker(&mut self) {
        let picker = SessionPickerState::from_sessions(&self.pi_sessions, self.pi_session_index);
        if picker.is_empty() {
            self.view.notice =
                Some("No Pi session files for this project yet (RPC has no list_sessions)".into());
            return;
        }
        self.session_picker = Some(picker);
    }

    fn step_pi_session(&mut self, delta: i32) {
        if self.pi_session_count == 0 {
            self.view.notice =
                Some("No Pi session files for this project (RPC has no list_sessions)".into());
            return;
        }
        let count = self.pi_session_count as i32;
        let next = (self.pi_session_index as i32 + delta).rem_euclid(count) as usize;
        self.pi_session_index = next;
        let draft = self.editor_draft_text();
        if let Some(bridge) = self.bridge.as_mut() {
            if let Err(err) = bridge.switch_session_index_with_draft(next, &draft) {
                self.view.notice = Some(format!("Session switch failed: {err}"));
            }
        }
    }

    fn poll_bridge(&mut self) {
        let Some(bridge) = self.bridge.as_mut() else {
            return;
        };
        let events = bridge.drain_events();
        for record in events {
            self.ingest_record(record);
        }
    }

    /// Reduce one sidecar / Pi record into host state (also the test seam).
    fn ingest_record(&mut self, record: serde_json::Value) {
        let kind = record.get("type").and_then(|v| v.as_str());
        if kind == Some("engine_unavailable") {
            let reason = record
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or("engine unavailable");
            self.engine.status = "unavailable".into();
            self.engine.reason = Some(reason.to_string());
            self.view.notice = Some(format!("Pi engine unavailable: {reason}"));
            self.revert_failed_prompt();
            // U3b: release every open/queued dialog locally — Pi is gone,
            // so do not attempt cancelled writes (would go nowhere).
            let _ = self.extension_ui.release_all(false);
        }
        if kind == Some("ready") {
            self.engine = EngineGate::from_ready_record(&record);
            self.sync_engine_line();
            self.ingest_sessions_record(&record);
            self.restore_draft_once(&record);
            // Snapshot before the hint: the blocked-chat next step names
            // the team key that matches this record's real team state.
            if let Some(snap) = record.get("snapshot") {
                apply_workspace_snapshot(&mut self.view, snap);
            }
            self.sync_empty_hint();
            // Prefer engine open_notice over sessionsNote when chat cannot prompt.
            if let Some(notice) = self.engine.open_notice() {
                self.view.notice = Some(notice);
            } else if let Some(note) = record.get("sessionsNote").and_then(|v| v.as_str()) {
                if self.pi_session_count == 0 {
                    self.view.notice = Some(note.to_string());
                }
            } else if self
                .view
                .notice
                .as_deref()
                .is_some_and(|n| n.starts_with("Pi engine "))
            {
                self.view.notice = None;
            }
        } else if kind == Some("engine") {
            self.engine = EngineGate::from_sidecar_engine_record(&record);
            self.sync_engine_line();
            self.ingest_sessions_record(&record);
            self.sync_empty_hint();
            if let Some(notice) = self.engine.open_notice() {
                self.view.notice = Some(notice);
            }
        } else if kind == Some("snapshot") {
            if let Some(snap) = record.get("snapshot") {
                apply_workspace_snapshot(&mut self.view, snap);
                self.sync_empty_hint();
            }
        } else if kind == Some("team") {
            self.ingest_team_record(&record);
        } else if kind == Some("preflight") {
            self.ingest_preflight_record(&record);
        } else if kind == Some("availability") {
            self.ingest_availability_record(&record);
        } else if kind == Some("recovery") {
            self.ingest_recovery_record(&record);
        } else if kind == Some("sessions") {
            self.ingest_sessions_record(&record);
        } else if kind == Some("draft") {
            self.apply_draft_record(&record);
        } else if kind == Some("mode") {
            // U4a: restore / confirm WorkMode from the active Kairo session.
            if let Some(mode) = record.get("mode").and_then(|v| v.as_str()) {
                self.view.work_mode = normalize_work_mode(mode).to_string();
            }
        } else if kind == Some("provider_event") {
            self.ingest_provider_event(&record);
        } else if kind == Some("task_result") {
            self.ingest_task_result(&record);
        } else if kind == Some("plans") {
            self.ingest_plans_record(&record);
        } else if kind == Some("plan_detail") {
            self.ingest_plan_detail_record(&record);
        } else if kind == Some("plan_decision") {
            self.plans_action_pending = false;
        } else if kind == Some("plan_preview") {
            self.ingest_plan_preview_record(&record);
        } else if kind == Some("plan_execute") {
            self.ingest_plan_execute_record(&record);
        } else if kind == Some("plan_cancel") {
            self.plans_action_pending = false;
            self.execution_modal = None;
        } else if kind == Some("run_transcript") {
            self.ingest_run_transcript_record(&record);
        } else if kind == Some("slash_lines") {
            if let Some(lines) = record.get("lines").and_then(|v| v.as_array()) {
                for line in lines {
                    if let Some(text) = line.as_str() {
                        self.chat.push_kairo_reply(text.to_string());
                    }
                }
            }
        } else if kind == Some("ops_snapshot") {
            self.ops_panel = Some(OpsPanelState::from_ops_record(&record));
            if self.workspace_view == WorkspaceView::Operations {
                self.view.notice = Some("Operations snapshot updated.".into());
            }
        } else if kind == Some("ops_sync_preview") {
            if let Some(ops) = self.ops_panel.as_mut() {
                if record.get("ok").and_then(|v| v.as_bool()) == Some(false) {
                    ops.confirm = None;
                    self.view.notice = Some(format!(
                        "Sync preview failed: {}",
                        record
                            .get("error")
                            .or_else(|| record.get("reason"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown")
                    ));
                } else if record.get("hasChanges").and_then(|v| v.as_bool()) == Some(false) {
                    ops.confirm = None;
                    self.view.notice = Some("No pending governance changes.".into());
                } else {
                    ops.confirm = Some(OpsConfirmState::sync_apply(record.clone()));
                }
            }
        } else if kind == Some("ops_sync_result") {
            if let Some(ops) = self.ops_panel.as_mut() {
                ops.confirm = None;
            }
            let ok = record.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
            let reason = record
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or(if ok { "ok" } else { "failed" });
            self.view.notice = Some(format!("Sync · {reason}"));
            self.request_ops_snapshot();
        } else if kind == Some("ops_rollback_preview") {
            if let Some(ops) = self.ops_panel.as_mut() {
                if record.get("ok").and_then(|v| v.as_bool()) == Some(false) {
                    ops.confirm = None;
                    self.view.notice = Some(format!(
                        "Rollback preview failed: {}",
                        record
                            .get("error")
                            .or_else(|| record.get("reason"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown")
                    ));
                } else {
                    ops.pick_mode = OpsPickMode::None;
                    ops.confirm = Some(OpsConfirmState::rollback_apply(record.clone()));
                }
            }
        } else if kind == Some("ops_rollback_result") {
            if let Some(ops) = self.ops_panel.as_mut() {
                ops.confirm = None;
            }
            let ok = record.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
            let reason = record
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or(if ok { "ok" } else { "failed" });
            self.view.notice = Some(format!("Rollback · {reason}"));
            self.request_ops_snapshot();
        } else if kind == Some("ops_run_cancel") {
            if let Some(ops) = self.ops_panel.as_mut() {
                ops.confirm = None;
                ops.pick_mode = OpsPickMode::None;
            }
            let ok = record.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
            let run_id = record
                .get("runId")
                .and_then(|v| v.as_str())
                .unwrap_or("?");
            self.view.notice = Some(if ok {
                format!("Cancelled {run_id}")
            } else {
                format!(
                    "Cancel failed: {}",
                    record
                        .get("reason")
                        .and_then(|v| v.as_str())
                        .unwrap_or("error")
                )
            });
            self.request_ops_snapshot();
        } else if kind == Some("ops_alert_dismiss") {
            if let Some(ops) = self.ops_panel.as_mut() {
                ops.confirm = None;
                ops.pick_mode = OpsPickMode::None;
            }
            let ok = record.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
            self.view.notice = Some(if ok {
                "Alert dismissed".into()
            } else {
                format!(
                    "Dismiss failed: {}",
                    record
                        .get("reason")
                        .and_then(|v| v.as_str())
                        .unwrap_or("error")
                )
            });
            self.request_ops_snapshot();
        } else if kind == Some("settings_snapshot") {
            self.settings_panel = Some(SettingsPanelState::from_settings_record(&record));
            if self.workspace_view == WorkspaceView::Settings {
                self.view.notice = Some("Settings snapshot updated.".into());
            }
        } else if kind == Some("settings_integration_result") {
            if let Some(settings) = self.settings_panel.as_mut() {
                settings.clear_integration_confirm();
            }
            let ok = record.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
            let wrote = record
                .get("wroteFiles")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            self.view.notice = Some(if ok {
                format!(
                    "Integration intent recorded · wroteFiles={wrote}"
                )
            } else {
                format!(
                    "Integration confirm failed: {}",
                    record
                        .get("reason")
                        .and_then(|v| v.as_str())
                        .unwrap_or("error")
                )
            });
        } else if kind == Some("team_edit_catalog") {
            match RoleEditorState::from_catalog_record(&record) {
                Some(editor) => self.role_editor = Some(editor),
                None => {
                    self.role_editor = None;
                    self.view.notice =
                        Some("Edit catalog returned no usable models.".into());
                }
            }
        } else if kind == Some("team_edit_saved") {
            self.role_editor = None;
            if let Some(state) = record.get("state").and_then(|v| v.as_str()) {
                self.view.team_state = Some(state.to_string());
            }
            self.sync_empty_hint();
        } else if kind == Some("transcript") {
            if let Some(rows) = record.get("messages").and_then(|v| v.as_array()) {
                self.chat.replace_from_sidecar_transcript(rows);
                self.pending_prompt = None;
            }
        } else if kind == Some("notice") {
            if let Some(msg) = record.get("message").and_then(|v| v.as_str()) {
                self.view.notice = Some(msg.to_string());
            }
        } else if kind == Some("extension_ui_request") {
            self.ingest_extension_ui_request(&record);
        }
        if kind == Some("error") {
            let msg = record
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("bridge error");
            self.view.notice = Some(msg.to_string());
            // A rejected second prompt leaves the first ASK running.
            if msg != "A previous request is still running" {
                self.chat.ask_in_flight = false;
            }
            self.team_action_pending = false;
            self.availability_action_pending = false;
            self.recovery_action_pending = false;
            self.plans_action_pending = false;
            self.revert_failed_prompt();
        }
        // Real deltas mean the prompt was accepted — drop restore token.
        if kind == Some("message_update")
            && record
                .pointer("/assistantMessageEvent/delta")
                .and_then(|v| v.as_str())
                .is_some_and(|d| !d.is_empty())
        {
            self.pending_prompt = None;
        }
        if kind == Some("agent_settled") {
            self.pending_prompt = None;
            self.chat.ask_in_flight = false;
        }
        if kind != Some("transcript")
            && kind != Some("draft")
            && kind != Some("mode")
            && kind != Some("task_result")
            && kind != Some("provider_event")
            && kind != Some("plans")
            && kind != Some("plan_detail")
            && kind != Some("plan_decision")
            && kind != Some("plan_preview")
            && kind != Some("plan_execute")
            && kind != Some("plan_cancel")
            && kind != Some("run_transcript")
            && kind != Some("extension_ui_request")
        {
            self.chat.apply_sidecar_event(&record);
        }
    }

    /// A3: one ASK `provider_event` (progress / text / tools / terminals).
    fn ingest_provider_event(&mut self, record: &serde_json::Value) {
        if !self.chat.apply_provider_event(record) {
            return;
        }
        // Any applied event proves the sidecar accepted the prompt.
        self.pending_prompt = None;
        if !self.chat.ask_in_flight
            && self
                .view
                .notice
                .as_deref()
                .is_some_and(|n| n.starts_with("Submitting") || n == "Cancelling…")
        {
            self.view.notice = None;
        }
    }

    /// U4a: ASK answer or PLAN notice from sidecar submitTask — never Pi stream.
    fn ingest_task_result(&mut self, record: &serde_json::Value) {
        self.pending_prompt = None;
        self.chat.ask_in_flight = false;
        let kind = record.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        match kind {
            "answer" => {
                let provider = record
                    .get("provider")
                    .and_then(|v| v.as_str())
                    .unwrap_or("kairo");
                let model = record.get("model").and_then(|v| v.as_str());
                let answer = record.get("answer").and_then(|v| v.as_str()).unwrap_or("");
                let label = match model {
                    Some(m) if !m.is_empty() => format!("{provider} · {m}: {answer}"),
                    _ => format!("{provider}: {answer}"),
                };
                // `text` provider events already showed the answer: rendering
                // it again would duplicate it. Claude/Cursor turns only send
                // progress + final, so they (and legacy sidecars with no
                // provider events) still render the answer from here.
                if !self.chat.ask_answer_already_shown() {
                    self.chat.push_kairo_reply(label);
                }
            }
            "plan" => {
                // U4b: y/n (not `a`) — team analyze still owns bare `a`.
                self.chat.push_kairo_reply(PLAN_REQUESTED_HOST_COPY.into());
                // Sidecar also emits `plans` after a plan task_result; open
                // the list as soon as that arrives (ingest_plans_record).
                self.view.notice = Some(PLAN_REQUESTED_HOST_COPY.into());
            }
            _ => {}
        }
    }

    /// U4b/U4c: apply / refresh the plans list modal from a `plans` record.
    fn ingest_plans_record(&mut self, record: &serde_json::Value) {
        self.plans_action_pending = false;
        match self.plan_list.as_mut() {
            Some(list) => list.refresh_from_plans_record(record),
            None => {
                self.plan_list = Some(PlanListState::from_plans_record(record));
            }
        }
        self.request_active_run_transcripts();
    }

    /// U4b: Markdown detail from `plans.show`.
    fn ingest_plan_detail_record(&mut self, record: &serde_json::Value) {
        self.plans_action_pending = false;
        if let Some(list) = self.plan_list.as_mut() {
            list.apply_plan_detail(record);
        } else {
            let mut list = PlanListState::default();
            list.apply_plan_detail(record);
            self.plan_list = Some(list);
        }
    }

    /// U4a: optimistic Shift+Tab cycle; persist via sidecar; notice on write failure.
    fn cycle_work_mode(&mut self) {
        let next = next_work_mode(&self.view.work_mode).to_string();
        self.view.work_mode = next.clone();
        let Some(bridge) = self.bridge.as_mut() else {
            return;
        };
        if let Err(err) = bridge.set_mode(&next) {
            self.view.notice = Some(format!("Mode change not saved: {err}"));
        }
    }

    /// U3b: ingest a forwarded `extension_ui_request`. Notify becomes a
    /// notice; dialog methods open/queue the modal. Never invents an id.
    fn ingest_extension_ui_request(&mut self, record: &serde_json::Value) {
        match self.extension_ui.ingest(record) {
            Some(ExtensionUiEvent::Notice(text)) => {
                self.view.notice = Some(text);
            }
            Some(ExtensionUiEvent::DialogOpened) => {
                // Modal owns keys; clear a stale notice so the title reads clean.
                if self
                    .view
                    .notice
                    .as_deref()
                    .is_some_and(|n| n.starts_with('['))
                {
                    // Keep notify notices; dialog open itself needs no notice.
                }
            }
            Some(ExtensionUiEvent::DialogClosed { .. }) => {}
            None => {}
        }
    }

    /// Send a correlated one-way `extension_ui_response` (same id) via the
    /// sidecar — never through a typed RPC wait.
    fn send_extension_ui_response(&mut self, payload: serde_json::Value) {
        if let Some(bridge) = self.bridge.as_mut() {
            if let Err(err) = bridge.extension_ui_response(payload) {
                self.view.notice = Some(format!("extension_ui_response failed: {err}"));
            }
        }
    }

    /// Host quit / intentional teardown: cancel every open dialog while the
    /// bridge is still writable, then clear local state.
    fn release_extension_ui_on_quit(&mut self) {
        let payloads = self.extension_ui.release_all(true);
        for payload in payloads {
            self.send_extension_ui_response(payload);
        }
    }

    /// Sidecar `team` record for `project.analyze` / `team.approve`. The real
    /// summary text arrives as its own `notice`; this only tracks state.
    fn ingest_team_record(&mut self, record: &serde_json::Value) {
        self.team_action_pending = false;
        let ok = record.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
        if !ok {
            return;
        }
        if let Some(state) = record.get("state").and_then(|v| v.as_str()) {
            self.view.team_state = Some(state.to_string());
        }
        self.sync_empty_hint();
    }

    fn request_team_op(&mut self, op: TeamOp) {
        if self.team_action_pending {
            self.view.notice = Some("A project team action is already running…".into());
            return;
        }
        let Some(bridge) = self.bridge.as_mut() else {
            return;
        };
        let sent = match op {
            TeamOp::Analyze => bridge.analyze_project_team(),
            TeamOp::Approve => bridge.approve_project_team(),
        };
        match sent {
            Ok(()) => {
                self.team_action_pending = true;
                self.view.notice = Some(op.progress_notice().into());
            }
            Err(err) => {
                self.view.notice = Some(format!("{} failed: {err}", op.label()));
            }
        }
    }

    /// `a`: instead of analyzing immediately, fetch the real analyst
    /// catalog and let the human pick — the whole point of T2 (no cockpit,
    /// no invented models). One in-flight preflight/picker at a time.
    fn request_analyst_preflight(&mut self) {
        if self.team_action_pending || self.preflight_pending || self.picker.is_some() {
            return;
        }
        let Some(bridge) = self.bridge.as_mut() else {
            return;
        };
        match bridge.preflight_project_team() {
            Ok(()) => {
                self.preflight_pending = true;
                self.view.notice = Some("Loading analyst catalog…".into());
            }
            Err(err) => {
                self.view.notice = Some(format!("Loading analyst catalog failed: {err}"));
            }
        }
    }

    /// Sidecar `preflight` record: open the picker on success (unless the
    /// real catalog is empty — nothing to choose from), or report the real
    /// failure reason. Never invents a model when the catalog is empty.
    /// Sets `picker.notice` from `pickerNotice` (prefer) or a compact
    /// fallback derived from `unverifiedClaudeNotice` — never clears it
    /// when opening the modal.
    fn ingest_preflight_record(&mut self, record: &serde_json::Value) {
        self.preflight_pending = false;
        let ok = record.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
        if !ok {
            let reason = record
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or("preflight failed");
            self.view.notice = Some(format!("Loading analyst catalog failed: {reason}"));
            return;
        }
        let Some(catalog) = record.get("analystCatalog") else {
            self.view.notice = Some("Preflight returned no analyst catalog.".into());
            return;
        };
        let mut picker = AnalystPickerState::from_analyst_catalog(catalog);
        if picker.is_empty() {
            self.view.notice =
                Some("No ask-capable analyst model available for this project.".into());
            return;
        }
        picker.notice = preflight_picker_notice(record);
        self.view.notice = None;
        self.picker = Some(picker);
    }

    /// Enter on an available picker row: send `project.analyze` with the
    /// human's own chosen analyst (re-validated server-side, never trusted
    /// blindly) and close the modal.
    fn send_analyze_with_analyst(&mut self, analyst: serde_json::Value) {
        if self.team_action_pending {
            self.view.notice = Some("A project team action is already running…".into());
            return;
        }
        let Some(bridge) = self.bridge.as_mut() else {
            return;
        };
        match bridge.analyze_project_team_with(analyst) {
            Ok(()) => {
                self.team_action_pending = true;
                self.view.notice = Some(TeamOp::Analyze.progress_notice().into());
            }
            Err(err) => {
                self.view.notice = Some(format!("{} failed: {err}", TeamOp::Analyze.label()));
            }
        }
    }

    /// `r`: on-demand availability re-probe — the same real
    /// conversation-service probe a normal refresh eventually shows,
    /// forced now instead of waiting. One in flight at a time.
    fn request_revalidate(&mut self) {
        if self.availability_action_pending {
            self.view.notice = Some("Already revalidating availability…".into());
            return;
        }
        let Some(bridge) = self.bridge.as_mut() else {
            return;
        };
        match bridge.revalidate_team_availability() {
            Ok(()) => {
                self.availability_action_pending = true;
                self.view.notice = Some("Revalidating provider availability…".into());
            }
            Err(err) => {
                self.view.notice = Some(format!("Revalidate failed: {err}"));
            }
        }
    }

    /// Sidecar `availability` record (`team.revalidate`): tracks only
    /// pending state and an honest failure notice — the real per-role
    /// evidence arrives on the `snapshot` record that follows, never
    /// synthesized here.
    fn ingest_availability_record(&mut self, record: &serde_json::Value) {
        self.availability_action_pending = false;
        let ok = record.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
        if !ok {
            let reason = record
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or("live availability probe failed");
            self.view.notice = Some(reason.to_string());
        }
    }

    /// `R`: build (and persist) a strategy-recovery proposal for a
    /// stale/blocked team — never activates on its own. One in flight at a
    /// time; refuses while the preview modal is already open.
    fn request_recovery_preview(&mut self) {
        if self.recovery_action_pending || self.recovery_preview.is_some() {
            self.view.notice = Some("A recovery preview is already open or running…".into());
            return;
        }
        let Some(bridge) = self.bridge.as_mut() else {
            return;
        };
        match bridge.recovery_preview() {
            Ok(()) => {
                self.recovery_action_pending = true;
                self.view.notice = Some("Checking for a recovered team…".into());
            }
            Err(err) => {
                self.view.notice = Some(format!("Recovery preview failed: {err}"));
            }
        }
    }

    /// Sidecar `recovery` record. `op: "preview"` opens the modal only on a
    /// real `outcome: "proposed"` — any other outcome (baseline, skipped,
    /// kept-previous, activated, error) is reported as a plain notice, never
    /// a fabricated modal. `op: "apply"` / `"reject"` always close the modal
    /// and report the real outcome — a stale/refused apply never re-opens
    /// itself silently; the human presses `R` again for a fresh preview.
    fn ingest_recovery_record(&mut self, record: &serde_json::Value) {
        let op = record.get("op").and_then(|v| v.as_str()).unwrap_or("");
        let outcome = record.get("outcome").and_then(|v| v.as_str()).unwrap_or("");
        match op {
            "preview" => {
                self.recovery_action_pending = false;
                if outcome == "proposed" {
                    if let Some(preview) = RecoveryPreviewState::from_recovery_record(record) {
                        self.view.notice = None;
                        self.recovery_preview = Some(preview);
                        return;
                    }
                }
                self.recovery_preview = None;
                self.view.notice = Some(recovery_preview_notice(outcome, record));
            }
            "apply" | "reject" => {
                self.recovery_action_pending = false;
                self.recovery_preview = None;
                self.view.notice = Some(recovery_preview_notice(outcome, record));
            }
            _ => {}
        }
    }

    /// `x` while the preview modal is open: explicit reject — closes the
    /// proposal on the sidecar (the fingerprint), the current team is never
    /// touched.
    fn send_recovery_reject(&mut self) {
        if self.recovery_action_pending {
            return;
        }
        let Some(bridge) = self.bridge.as_mut() else {
            return;
        };
        match bridge.recovery_reject() {
            Ok(()) => {
                self.recovery_action_pending = true;
                self.view.notice = Some("Rejecting recovery proposal…".into());
            }
            Err(err) => {
                self.view.notice = Some(format!("Recovery reject failed: {err}"));
            }
        }
    }

    /// Enter/`y` while the preview modal is open: apply — the sidecar
    /// re-verifies against CURRENT eligibility before activating; a stale
    /// proposal comes back as an honest error and touches nothing.
    fn send_recovery_apply(&mut self) {
        if self.recovery_action_pending {
            return;
        }
        let Some(bridge) = self.bridge.as_mut() else {
            return;
        };
        match bridge.recovery_apply() {
            Ok(()) => {
                self.recovery_action_pending = true;
                self.view.notice = Some("Applying recovered team…".into());
            }
            Err(err) => {
                self.view.notice = Some(format!("Recovery apply failed: {err}"));
            }
        }
    }

    /// U4b: open (or refresh) the plans list via `plans.list`.
    fn request_plans_list(&mut self) {
        if self.plans_action_pending {
            self.view.notice = Some("A plans request is already running…".into());
            return;
        }
        let Some(bridge) = self.bridge.as_mut() else {
            return;
        };
        match bridge.plans_list() {
            Ok(()) => {
                self.plans_action_pending = true;
                self.view.notice = Some("Loading plans…".into());
            }
            Err(err) => {
                self.view.notice = Some(format!("plans.list failed: {err}"));
            }
        }
    }

    /// U4b: Enter on a list row → Markdown detail via `plans.show`.
    fn request_plan_show(&mut self) {
        let Some(task_id) = self
            .plan_list
            .as_ref()
            .and_then(|l| l.selected_row())
            .map(|r| r.task_id.clone())
        else {
            return;
        };
        if self.plans_action_pending {
            return;
        }
        let Some(bridge) = self.bridge.as_mut() else {
            return;
        };
        match bridge.plans_show(&task_id) {
            Ok(()) => {
                self.plans_action_pending = true;
                self.view.notice = Some(format!("Opening plan {task_id}…"));
            }
            Err(err) => {
                self.view.notice = Some(format!("plans.show failed: {err}"));
            }
        }
    }

    /// U4b: `y`/`n` while list-focused — never executePlan.
    fn request_plan_decide(&mut self, decision: &str) {
        if !self
            .plan_list
            .as_ref()
            .is_some_and(|l| l.can_decide(&self.view.work_mode))
        {
            if self.view.work_mode == "ask" {
                self.view.notice = Some("ASK mode is read-only — switch to PLAN or AGENT to decide.".into());
            }
            return;
        }
        let Some(task_id) = self
            .plan_list
            .as_ref()
            .and_then(|l| l.selected_row())
            .map(|r| r.task_id.clone())
        else {
            return;
        };
        if self.plans_action_pending {
            return;
        }
        let Some(bridge) = self.bridge.as_mut() else {
            return;
        };
        match bridge.plans_decide(&task_id, decision) {
            Ok(()) => {
                self.plans_action_pending = true;
                self.view.notice = Some(format!(
                    "{} plan {task_id}…",
                    if decision == "approved" {
                        "Approving"
                    } else {
                        "Rejecting"
                    }
                ));
            }
            Err(err) => {
                self.view.notice = Some(format!("plans.decide failed: {err}"));
            }
        }
    }

    /// U4c: `x` under list-focus — open role select when AGENT+approved+not_started.
    fn begin_execute_role_select(&mut self) {
        if !self
            .plan_list
            .as_ref()
            .is_some_and(|l| l.can_execute(&self.view.work_mode))
        {
            if self.view.work_mode != "agent" {
                self.view.notice =
                    Some("Switch to AGENT mode to execute an approved plan.".into());
            }
            return;
        }
        let Some(list) = self.plan_list.as_ref() else {
            return;
        };
        let Some(row) = list.selected_row() else {
            return;
        };
        let task_id = row.task_id.clone();
        let roles = list.project_team_roles.clone();
        if roles.is_empty() {
            self.view.notice = Some(
                "No active project team — analyze and approve one before executing.".into(),
            );
            return;
        }
        self.execution_modal = Some(ExecutionModal::RoleSelect(RoleSelectState::new(
            task_id, roles,
        )));
        self.view.notice = Some("Select a role for execution.".into());
    }

    /// U4c: `c` under list-focus — cancel active execution (never mode-gated).
    fn request_plan_cancel(&mut self) {
        if !self.plan_list.as_ref().is_some_and(|l| l.can_cancel()) {
            return;
        }
        let Some(task_id) = self
            .plan_list
            .as_ref()
            .and_then(|l| l.selected_row())
            .map(|r| r.task_id.clone())
        else {
            return;
        };
        if self.plans_action_pending {
            return;
        }
        let Some(bridge) = self.bridge.as_mut() else {
            return;
        };
        match bridge.plans_cancel(&task_id) {
            Ok(()) => {
                self.plans_action_pending = true;
                self.view.notice = Some(format!("Cancelling run for {task_id}…"));
            }
            Err(err) => {
                self.view.notice = Some(format!("plans.cancel failed: {err}"));
            }
        }
    }

    /// U4c: Enter on role select → `plans.preview`.
    fn request_plan_preview(&mut self, task_id: &str, role: &str) {
        if self.plans_action_pending {
            return;
        }
        let Some(bridge) = self.bridge.as_mut() else {
            return;
        };
        match bridge.plans_preview(task_id, role) {
            Ok(()) => {
                self.plans_action_pending = true;
                self.view.notice = Some(format!("Asking PROJECT TEAM who should execute {task_id}…"));
            }
            Err(err) => {
                self.view.notice = Some(format!("plans.preview failed: {err}"));
            }
        }
    }

    /// U4c: apply `plan_preview` — open confirm modal, or skip if auto-executed.
    fn ingest_plan_preview_record(&mut self, record: &serde_json::Value) {
        self.plans_action_pending = false;
        if record.get("autoExecuted").and_then(|v| v.as_bool()) == Some(true) {
            self.execution_modal = None;
            return;
        }
        if let Some(confirm) = ConfirmExecuteState::from_plan_preview(record) {
            if confirm.is_manual_handoff() {
                if let Some(prompt) = confirm.task_prompt.as_deref() {
                    let provider = confirm.provider.as_deref().unwrap_or("provider");
                    let model = confirm
                        .model_ref_label
                        .as_deref()
                        .or(confirm.model.as_deref())
                        .unwrap_or("the assigned model");
                    self.chat.push_kairo_reply(format!(
                        "{provider} · {model} can't be launched automatically — paste this into its chat:\n\n{prompt}"
                    ));
                }
            }
            self.execution_modal = Some(ExecutionModal::Confirm(confirm));
        } else {
            self.execution_modal = None;
        }
    }

    /// U4c: y on confirm → `plans.execute` with the exact confirmationTarget.
    fn request_plan_execute_confirm(&mut self) {
        let Some(ExecutionModal::Confirm(confirm)) = self.execution_modal.as_ref() else {
            return;
        };
        if !confirm.can_confirm() {
            return;
        }
        let task_id = confirm.task_id.clone();
        let Some(target) = confirm.confirmation_target.clone() else {
            return;
        };
        if self.plans_action_pending {
            return;
        }
        let Some(bridge) = self.bridge.as_mut() else {
            return;
        };
        match bridge.plans_execute(&task_id, &target) {
            Ok(()) => {
                self.plans_action_pending = true;
                self.view.notice = Some(format!("Executing {task_id}…"));
            }
            Err(err) => {
                self.view.notice = Some(format!("plans.execute failed: {err}"));
            }
        }
    }

    fn ingest_plan_execute_record(&mut self, record: &serde_json::Value) {
        self.plans_action_pending = false;
        self.execution_modal = None;
        if let Some(run_id) = record
            .pointer("/execution/runId")
            .and_then(|v| v.as_str())
        {
            self.run_transcript_cursors.entry(run_id.to_string()).or_insert(0);
            self.request_run_transcript(run_id, 0);
        }
    }

    fn ingest_run_transcript_record(&mut self, record: &serde_json::Value) {
        let run_id = record
            .get("runId")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if let Some(next) = record.get("nextIndex").and_then(|v| v.as_u64()) {
            if !run_id.is_empty() {
                self.run_transcript_cursors.insert(run_id.to_string(), next);
            }
        }
        if let Some(entries) = record.get("entries").and_then(|v| v.as_array()) {
            for entry in entries {
                let text = entry.get("text").and_then(|v| v.as_str()).unwrap_or("");
                if text.is_empty() {
                    continue;
                }
                let provider = entry.get("provider").and_then(|v| v.as_str());
                let line = match provider {
                    Some(p) if !p.is_empty() => format!("[{p}] {text}"),
                    _ => text.to_string(),
                };
                self.chat.push_kairo_reply(line);
            }
        }
    }

    fn request_run_transcript(&mut self, run_id: &str, since_index: u64) {
        let Some(bridge) = self.bridge.as_mut() else {
            return;
        };
        let _ = bridge.plans_transcript(run_id, since_index);
    }

    /// Poll active run transcripts after a plans refresh.
    fn request_active_run_transcripts(&mut self) {
        let Some(list) = self.plan_list.as_ref() else {
            return;
        };
        let targets: Vec<(String, u64)> = list
            .rows
            .iter()
            .filter(|r| r.exec_active)
            .filter_map(|r| {
                let run_id = r.run_id.as_ref()?;
                let since = *self.run_transcript_cursors.get(run_id).unwrap_or(&0);
                Some((run_id.clone(), since))
            })
            .collect();
        for (run_id, since) in targets {
            self.request_run_transcript(&run_id, since);
        }
    }

    fn submit_editor(&mut self) {
        let text = self.editor.lines().join("\n");
        if text.trim().is_empty() {
            return;
        }
        if let Some(cmd) = parse_slash_command(&text) {
            self.clear_editor();
            self.dispatch_slash(cmd);
            return;
        }
        let bridge_attached = self.bridge.is_some();
        match decide_submit(bridge_attached, &self.engine) {
            SubmitDecision::KeepDraft { notice } => {
                self.view.notice = Some(notice);
            }
            SubmitDecision::LocalMock => {
                self.chat.submit_user(text.clone());
                self.clear_editor();
                self.chat.push_mock_assistant_reply(text.trim());
            }
            SubmitDecision::SendToPi => {
                self.chat.submit_user(text.clone());
                self.clear_editor();
                match self.bridge.as_mut().expect("bridge").prompt(text.trim()) {
                    Ok(()) => {
                        // U4a: sidecar routes through submitTask — no Pi assistant stream.
                        self.pending_prompt = Some(text.trim().to_string());
                        // Rust knows the WorkMode: only ASK prompts run the
                        // provider path that emits `provider_event`s.
                        if self.view.work_mode == "ask" {
                            self.chat.begin_ask();
                        }
                        let mode = self.view.work_mode.to_uppercase();
                        self.view.notice = Some(format!("Submitting · {mode}…"));
                    }
                    Err(err) => {
                        self.chat.pop_last_user_if_matches(text.trim());
                        self.restore_editor(text.trim());
                        self.view.notice = Some(format!("Failed to send prompt: {err}"));
                    }
                }
            }
        }
    }

    /// U4d: host slash commands — never fall through to chat for unknown `/…`.
    fn dispatch_slash(&mut self, cmd: SlashCommand) {
        match cmd {
            SlashCommand::Help => {
                self.chat.push_kairo_reply(slash_help_text().into());
            }
            SlashCommand::Quit => {
                self.quit_requested = true;
            }
            SlashCommand::Clear => {
                self.chat.messages.clear();
                if let Some(bridge) = self.bridge.as_mut() {
                    if let Err(err) = bridge.clear_transcript() {
                        self.view.notice = Some(format!("/clear failed: {err}"));
                    }
                } else {
                    self.view.notice = Some("Transcript cleared (local).".into());
                }
            }
            SlashCommand::ProjectView => {
                self.set_workspace_view(WorkspaceView::Project);
            }
            SlashCommand::Analyze => {
                if self.bridge.is_none() {
                    self.view.notice = Some("No bridge — cannot run /analyze.".into());
                    return;
                }
                self.request_analyst_preflight();
            }
            SlashCommand::Approve => {
                if !can_approve_team(self.view.team_state.as_deref()) {
                    self.view.notice = Some(
                        "Nothing to approve yet — run /analyze and wait for a suggested team."
                            .into(),
                    );
                    return;
                }
                self.request_team_op(TeamOp::Approve);
            }
            SlashCommand::ProjectStatus => {
                if let Some(bridge) = self.bridge.as_mut() {
                    if let Err(err) = bridge.project_status() {
                        self.view.notice = Some(format!("/project status failed: {err}"));
                    }
                } else {
                    self.view.notice = Some("No bridge — cannot run /project status.".into());
                }
            }
            SlashCommand::ProjectRefresh => {
                if let Some(bridge) = self.bridge.as_mut() {
                    if let Err(err) = bridge.project_refresh() {
                        self.view.notice = Some(format!("/project refresh failed: {err}"));
                    } else {
                        self.view.notice = Some("Refreshing project strategy…".into());
                    }
                } else {
                    self.view.notice = Some("No bridge — cannot run /project refresh.".into());
                }
            }
            SlashCommand::Usage => self.request_slash_info("usage", serde_json::json!({})),
            SlashCommand::Providers => {
                self.request_slash_info("providers", serde_json::json!({}))
            }
            SlashCommand::Status => self.request_slash_info("status", serde_json::json!({})),
            SlashCommand::Why => self.request_slash_info("why", serde_json::json!({})),
            SlashCommand::Models {
                evidence,
                verify_access,
                refresh,
            } => self.request_slash_info(
                "models",
                serde_json::json!({
                    "evidence": evidence,
                    "verifyAccess": verify_access,
                    "refresh": refresh
                }),
            ),
            SlashCommand::Plan { task } => {
                if task.trim().is_empty() {
                    self.chat
                        .push_kairo_reply("Usage: /plan <task description>".into());
                    return;
                }
                if self.view.work_mode != "plan" {
                    self.view.work_mode = "plan".into();
                    if let Some(bridge) = self.bridge.as_mut() {
                        if let Err(err) = bridge.set_mode("plan") {
                            self.view.notice =
                                Some(format!("Mode change not saved: {err}"));
                        }
                    }
                }
                if self.bridge.is_none() {
                    self.chat.submit_user(format!("/plan {task}"));
                    self.chat
                        .push_kairo_reply("No bridge — cannot submit /plan.".into());
                    return;
                }
                self.chat.submit_user(format!("/plan {task}"));
                match self.bridge.as_mut().expect("bridge").prompt(task.trim()) {
                    Ok(()) => {
                        self.pending_prompt = Some(task.trim().to_string());
                        self.view.notice = Some("Submitting · PLAN…".into());
                    }
                    Err(err) => {
                        self.chat.pop_last_user_if_matches(&format!("/plan {task}"));
                        self.view.notice = Some(format!("/plan failed: {err}"));
                    }
                }
            }
            SlashCommand::Unknown { command } => {
                self.chat.push_kairo_reply(format!(
                    "Unknown command: {command}. Try /help."
                ));
            }
        }
    }

    fn request_slash_info(&mut self, kind: &str, flags: serde_json::Value) {
        let Some(bridge) = self.bridge.as_mut() else {
            self.view.notice = Some(format!("No bridge — cannot run /{kind}."));
            return;
        };
        if let Err(err) = bridge.slash_info(kind, flags) {
            self.view.notice = Some(format!("/{kind} failed: {err}"));
        }
    }

    fn set_workspace_view(&mut self, view: WorkspaceView) {
        self.workspace_view = view;
        self.view.work_title = view.label().into();
        match view {
            WorkspaceView::Work => {
                // Keep plan_list/session_picker if they were opened as modals from
                // Tasks/Sessions — closing the view clears them.
                self.plan_list = None;
                self.session_picker = None;
                self.role_editor = None;
                self.ops_panel = None;
                self.settings_panel = None;
                self.view.notice = Some("View: Work".into());
            }
            WorkspaceView::Project => {
                self.plan_list = None;
                self.session_picker = None;
                self.view.notice = Some(
                    "View: Project · Enter edits a SUGGESTED role · Esc → Work".into(),
                );
            }
            WorkspaceView::Tasks => {
                self.session_picker = None;
                self.role_editor = None;
                if self.bridge.is_some() {
                    self.request_plans_list();
                }
                self.view.notice = Some("View: Tasks".into());
            }
            WorkspaceView::Sessions => {
                self.plan_list = None;
                self.role_editor = None;
                if self.bridge.is_some() {
                    self.open_session_picker();
                }
                self.view.notice = Some("View: Sessions".into());
            }
            WorkspaceView::Operations => {
                self.plan_list = None;
                self.session_picker = None;
                self.role_editor = None;
                self.settings_panel = None;
                self.request_ops_snapshot();
                self.view.notice =
                    Some("View: Operations · s/b/c/d/v · Esc → Work".into());
            }
            WorkspaceView::Settings => {
                self.plan_list = None;
                self.session_picker = None;
                self.role_editor = None;
                self.ops_panel = None;
                self.request_settings_snapshot();
                self.view.notice =
                    Some("View: Settings · Enter confirm intent · Esc → Work".into());
            }
        }
    }

    fn request_ops_snapshot(&mut self) {
        self.ops_panel = Some(OpsPanelState::loading());
        let Some(bridge) = self.bridge.as_mut() else {
            self.ops_panel = Some(OpsPanelState::from_ops_record(&serde_json::json!({
                "ok": false,
                "error": "No bridge — cannot load operations.",
                "health": ["Health unavailable."],
                "fleet": ["Fleet topology (kairo fleet) — not slash /providers", "Fleet unavailable."],
                "usage": ["Usage unavailable."],
                "diagnostics": ["Diagnostics unavailable."],
                "hints": "Esc → Work"
            })));
            return;
        };
        if let Err(err) = bridge.ops_snapshot() {
            self.view.notice = Some(format!("ops.snapshot failed: {err}"));
        }
    }

    fn request_settings_snapshot(&mut self) {
        self.settings_panel = Some(SettingsPanelState::loading());
        let Some(bridge) = self.bridge.as_mut() else {
            self.settings_panel = Some(SettingsPanelState::from_settings_record(
                &serde_json::json!({
                    "ok": false,
                    "error": "No bridge — cannot load settings.",
                    "profile": ["Profile unavailable."],
                    "integrations": ["Integrations unavailable."],
                    "connections": ["Connections unavailable."],
                    "setup": {
                        "wired": false,
                        "label": "Interactive setup · not wired — use `kairo setup`"
                    },
                    "hints": "Esc → Work"
                }),
            ));
            return;
        };
        if let Err(err) = bridge.settings_snapshot() {
            self.view.notice = Some(format!("settings.snapshot failed: {err}"));
        }
    }

    fn begin_role_edit_for_selected(&mut self) {
        if !can_edit_team_roles(self.view.team_state.as_deref()) {
            self.view.notice = Some(
                "Role edit only while the team is SUGGESTED (ACTIVE/STALE are read-only)."
                    .into(),
            );
            return;
        }
        let Some(agent) = self.view.agents.get(self.view.selected_agent) else {
            self.view.notice = Some("No role selected.".into());
            return;
        };
        let role = agent.label.clone();
        let Some(bridge) = self.bridge.as_mut() else {
            self.view.notice = Some("No bridge — cannot edit roles.".into());
            return;
        };
        match bridge.team_edit_catalog(&role) {
            Ok(()) => {
                self.role_editor = Some(RoleEditorState::loading(role));
            }
            Err(err) => {
                self.view.notice = Some(format!("Edit catalog failed: {err}"));
            }
        }
    }

    /// Pi rejected the prompt (or died) before any assistant content — restore draft.
    fn revert_failed_prompt(&mut self) {
        self.chat.cancel_empty_assistant_stream();
        if let Some(text) = self.pending_prompt.take() {
            self.chat.pop_last_user_if_matches(&text);
            self.restore_editor(&text);
        }
    }

    fn clear_editor(&mut self) {
        self.editor = TextArea::default();
        self.editor.set_placeholder_text("/analyze · Message…");
    }

    fn restore_editor(&mut self, text: &str) {
        self.editor = TextArea::default();
        self.editor.insert_str(text);
        self.editor.set_placeholder_text("/analyze · Message…");
    }

    /// Esc during an in-flight ASK: ask the sidecar to cancel it. The flag is
    /// cleared only by the terminal `cancelled` record (or `task_result` /
    /// `error`), so a late answer cannot slip in unnoticed.
    fn cancel_ask(&mut self) {
        let Some(bridge) = self.bridge.as_mut() else {
            return;
        };
        match bridge.abort() {
            Ok(()) => self.view.notice = Some("Cancelling…".into()),
            Err(err) => self.view.notice = Some(format!("Cancel failed: {err}")),
        }
    }

    fn abort_stream(&mut self) {
        if self.chat.is_streaming {
            if let Some(bridge) = self.bridge.as_mut() {
                let _ = bridge.abort();
            }
            self.chat.is_streaming = false;
            for msg in &mut self.chat.messages {
                msg.streaming = false;
            }
        }
    }
}

fn bridge_enabled_from_env() -> bool {
    env::args().any(|a| a == "--bridge")
        || env::var("KAIRO_UI_BRIDGE")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false)
}

/// `--v3-capture [outdir]` — deterministic Buffer dumps for visual review.
/// Never opens a TTY / alternate screen; never contacts Pi.
fn v3_capture_outdir_from_args() -> Option<PathBuf> {
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--v3-capture" {
            let out = args
                .next()
                .filter(|a| !a.starts_with('-'))
                .map(PathBuf::from)
                .unwrap_or_else(|| {
                    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                        .join("../../docs/assets/v3-visual-fixtures")
                });
            return Some(out);
        }
    }
    None
}

fn main() -> io::Result<()> {
    if let Some(out_dir) = v3_capture_outdir_from_args() {
        let code = v3_capture::run_capture(out_dir);
        if code == 0 {
            return Ok(());
        }
        std::process::exit(code);
    }

    enable_raw_mode()?;
    execute!(stdout(), EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout());
    let mut terminal = Terminal::new(backend)?;

    let bridge = if bridge_enabled_from_env() {
        let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        BridgeClient::spawn(&cwd).ok()
    } else {
        None
    };

    let mut app = ShellApp::new(bridge);
    let result = run(&mut terminal, &mut app);

    // Always restore the real TTY first — never leave the user staring at a
    // frozen alternate screen while a wedged Node/Pi child is killed.
    let _ = disable_raw_mode();
    let _ = execute!(terminal.backend_mut(), LeaveAlternateScreen);
    let _ = terminal.show_cursor();

    // U3a: whatever is still in the compose box on quit is the draft to
    // restore on the next `kairo resume` of this session — captured before
    // the bridge (and the sidecar behind it) goes away.
    // U3b: cancel any open extension_ui dialogs first (same-id cancelled
    // responses) so Pi is never left blocked waiting on a dead host.
    app.release_extension_ui_on_quit();
    let draft_text = app.editor.lines().join("\n");
    if let Some(mut bridge) = app.bridge.take() {
        let _ = bridge.stop_with_draft(&draft_text);
    }

    result
}

fn run(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
    app: &mut ShellApp,
) -> io::Result<()> {
    loop {
        app.poll_bridge();
        terminal.draw(|frame| draw(frame, app))?;
        if !event::poll(std::time::Duration::from_millis(120))? {
            continue;
        }
        let Event::Key(key) = event::read()? else {
            continue;
        };
        if key.kind != KeyEventKind::Press {
            continue;
        }
        if handle_key(app, key)? {
            break;
        }
    }
    Ok(())
}

fn is_quit_chord(key: &KeyEvent) -> bool {
    if !key.modifiers.contains(KeyModifiers::CONTROL) {
        return false;
    }
    match key.code {
        // Terminals may report Ctrl+C/Q as upper- or lower-case; both quit.
        KeyCode::Char(c) => matches!(c.to_ascii_lowercase(), 'c' | 'q'),
        _ => false,
    }
}

fn handle_key(app: &mut ShellApp, key: KeyEvent) -> io::Result<bool> {
    if is_quit_chord(&key) {
        return Ok(true);
    }
    if app.quit_requested {
        return Ok(true);
    }
    // U3b: extension_ui modal owns every key while open (above other pickers)
    // so chat compose is never the path that answers a dialog.
    if app.extension_ui.is_open() {
        return Ok(handle_extension_ui_key(app, key));
    }
    // The analyst picker owns every key while open — Ctrl+C/Q above still
    // always quits, but nothing else falls through to chat/sidebar/bridge
    // shortcuts until the modal closes (Enter/Esc).
    if app.picker.is_some() {
        return Ok(handle_picker_key(app, key));
    }
    if app.recovery_preview.is_some() {
        return Ok(handle_recovery_key(app, key));
    }
    // U4d: role editor owns keys above Sessions/Tasks.
    if app.role_editor.is_some() {
        return Ok(handle_role_editor_key(app, key));
    }
    if app.session_picker.is_some() {
        return Ok(handle_session_picker_key(app, key));
    }
    // U4c: nested role/confirm owns keys ABOVE the plan list so list y/n
    // (approve/reject) never fires during confirm.
    if app.execution_modal.is_some() {
        return Ok(handle_execution_modal_key(app, key));
    }
    // U4b: plan list owns keys while open — team `a`/`A` never reach here.
    if app.plan_list.is_some() {
        return Ok(handle_plan_list_key(app, key));
    }
    if try_bridge_shortcut(app, key) {
        return Ok(false);
    }
    if try_view_shortcut(app, key) {
        return Ok(false);
    }
    if try_team_shortcut(app, key) {
        return Ok(false);
    }
    if try_recovery_shortcut(app, key) {
        return Ok(false);
    }
    if try_plan_shortcut(app, key) {
        return Ok(false);
    }

    // U4a: Shift+Tab cycles WorkMode from any focus; plain Tab stays focus.
    if key.code == KeyCode::BackTab
        || (key.code == KeyCode::Tab && key.modifiers.contains(KeyModifiers::SHIFT))
    {
        app.cycle_work_mode();
        return Ok(false);
    }

    // U4d/U5b: Esc from Project/Operations/Settings (no modal) → Work.
    // Nested ops/settings confirms own Esc first.
    if key.code == KeyCode::Esc
        && matches!(
            app.workspace_view,
            WorkspaceView::Project | WorkspaceView::Operations | WorkspaceView::Settings
        )
        && app.role_editor.is_none()
    {
        if app.workspace_view == WorkspaceView::Operations {
            if let Some(ops) = app.ops_panel.as_mut() {
                if ops.confirm.is_some() {
                    ops.confirm = None;
                    app.view.notice = Some("Cancelled — no mutation.".into());
                    return Ok(false);
                }
                if ops.pick_mode != OpsPickMode::None {
                    ops.pick_mode = OpsPickMode::None;
                    return Ok(false);
                }
            }
        }
        if app.workspace_view == WorkspaceView::Settings {
            if let Some(settings) = app.settings_panel.as_mut() {
                if settings.pending_integration_id.is_some() {
                    settings.clear_integration_confirm();
                    app.view.notice = Some("Cancelled — no files written.".into());
                    return Ok(false);
                }
            }
        }
        if let Some(next) = escape_to_work(app.workspace_view) {
            app.set_workspace_view(next);
            return Ok(false);
        }
    }

    // U5b: Operations owns scroll/refresh + mutation keys while visible.
    if app.workspace_view == WorkspaceView::Operations && app.ops_panel.is_some() {
        if handle_ops_keys(app, key) {
            return Ok(false);
        }
    }

    // U5b: Settings owns scroll / integration confirm while visible.
    if app.workspace_view == WorkspaceView::Settings && app.settings_panel.is_some() {
        if handle_settings_keys(app, key) {
            return Ok(false);
        }
    }

    match app.chat.focus {
        Focus::Editor => {
            if key.code == KeyCode::Tab {
                app.chat.focus = app.chat.focus.next();
                return Ok(false);
            }
            if key.code == KeyCode::Esc {
                if app.chat.ask_in_flight {
                    app.cancel_ask();
                } else if app.chat.is_streaming {
                    app.abort_stream();
                } else {
                    app.chat.focus = Focus::Sidebar;
                }
                return Ok(false);
            }
            if key.code == KeyCode::Enter && !key.modifiers.contains(KeyModifiers::SHIFT) {
                app.submit_editor();
                return Ok(app.quit_requested);
            }
            if key.code == KeyCode::Char('q') && app.editor.lines().join("").trim().is_empty() {
                return Ok(true);
            }
            if key.code == KeyCode::Char('n') && app.bridge.is_none() {
                app.view.notice = Some("Demo notice: engine unavailable (bridge not wired)".into());
                return Ok(false);
            }
            if key.code == KeyCode::Char('c') && !key.modifiers.contains(KeyModifiers::CONTROL) {
                app.view.notice = None;
                return Ok(false);
            }
            if let Some(input) = crossterm_to_textarea(key) {
                app.editor.input(input);
            }
            return Ok(false);
        }
        Focus::Sidebar => {
            match key.code {
                KeyCode::Tab => app.chat.focus = app.chat.focus.next(),
                KeyCode::Esc => {
                    if app.workspace_view == WorkspaceView::Project {
                        app.set_workspace_view(WorkspaceView::Work);
                    } else {
                        app.chat.focus = Focus::Editor;
                    }
                }
                KeyCode::Enter if app.workspace_view == WorkspaceView::Project => {
                    app.begin_role_edit_for_selected();
                }
                KeyCode::Char('q') => return Ok(true),
                KeyCode::Down | KeyCode::Char('j')
                    if sidebar_accepts_selection_keys(app.chat.focus) =>
                {
                    if !app.view.agents.is_empty() {
                        app.view.selected_agent =
                            (app.view.selected_agent + 1) % app.view.agents.len();
                    }
                }
                KeyCode::Up | KeyCode::Char('k')
                    if sidebar_accepts_selection_keys(app.chat.focus) =>
                {
                    if !app.view.agents.is_empty() {
                        app.view.selected_agent = (app.view.selected_agent + app.view.agents.len()
                            - 1)
                            % app.view.agents.len();
                    }
                }
                KeyCode::Char('n') if app.bridge.is_none() => {
                    app.view.notice =
                        Some("Demo notice: engine unavailable (bridge not wired)".into());
                }
                KeyCode::Char('c') => app.view.notice = None,
                _ => {}
            }
            return Ok(false);
        }
        Focus::Transcript => {
            match key.code {
                KeyCode::Tab => app.chat.focus = app.chat.focus.next(),
                KeyCode::Esc => app.chat.focus = Focus::Editor,
                KeyCode::Char('q') => return Ok(true),
                KeyCode::PageUp => {
                    let regions = split_shell(ratatui::layout::Rect::new(0, 0, 100, 30));
                    let work = layout::split_work_main(regions.main);
                    let inner_h = work.transcript.height.saturating_sub(2) as usize;
                    let total = app.chat.messages.len() + 2;
                    app.chat.scroll_page_up(inner_h.max(1));
                    let _ = total;
                }
                KeyCode::PageDown => {
                    let regions = split_shell(ratatui::layout::Rect::new(0, 0, 100, 30));
                    let work = layout::split_work_main(regions.main);
                    let inner_h = work.transcript.height.saturating_sub(2) as usize;
                    let total = app.chat.messages.len() + 4;
                    app.chat.scroll_page_down(inner_h.max(1), total);
                }
                KeyCode::Char('n') if app.bridge.is_none() => {
                    app.view.notice =
                        Some("Demo notice: engine unavailable (bridge not wired)".into());
                }
                KeyCode::Char('c') => app.view.notice = None,
                _ => {}
            }
            return Ok(false);
        }
    }
}

/// `a` = analyze project team, `A` = approve the suggestion — the whole
/// unblock-chat path, in this UI. From Editor focus they only fire while the
/// engine cannot prompt and the draft is empty, so a working compose box
/// never loses a typed character.
fn try_team_shortcut(app: &mut ShellApp, key: KeyEvent) -> bool {
    if app.bridge.is_none()
        || key
            .modifiers
            .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT)
    {
        return false;
    }
    if !team_keys_available(
        app.chat.focus == Focus::Editor,
        app.editor.lines().join("").trim().is_empty(),
        app.engine.can_prompt(),
    ) {
        return false;
    }
    match key.code {
        KeyCode::Char('a') if can_analyze_team(&app.engine) => {
            app.request_analyst_preflight();
            true
        }
        KeyCode::Char('A') if can_approve_team(app.view.team_state.as_deref()) => {
            app.request_team_op(TeamOp::Approve);
            true
        }
        _ => false,
    }
}

/// U5b: Operations mutation keys + nested confirm (owns y/n while confirm open).
fn handle_ops_keys(app: &mut ShellApp, key: KeyEvent) -> bool {
    let Some(ops) = app.ops_panel.as_mut() else {
        return false;
    };

    // Nested confirm owns y/n first.
    if ops.confirm.is_some() {
        match key.code {
            KeyCode::Char('y') | KeyCode::Char('Y') => {
                let confirm = ops.confirm.clone();
                let Some(confirm) = confirm else {
                    return true;
                };
                match confirm.kind {
                    OpsConfirmKind::SyncApply => {
                        let Some(preview) = confirm.preview.clone() else {
                            ops.confirm = None;
                            app.view.notice = Some("Sync confirm missing preview.".into());
                            return true;
                        };
                        if let Some(bridge) = app.bridge.as_mut() {
                            if let Err(err) = bridge.ops_sync_apply(&preview) {
                                app.view.notice = Some(format!("ops.sync.apply failed: {err}"));
                            } else {
                                app.view.notice = Some("Applying sync…".into());
                            }
                        }
                    }
                    OpsConfirmKind::RollbackApply => {
                        let Some(preview) = confirm.preview.clone() else {
                            ops.confirm = None;
                            app.view.notice = Some("Rollback confirm missing preview.".into());
                            return true;
                        };
                        if let Some(bridge) = app.bridge.as_mut() {
                            if let Err(err) = bridge.ops_rollback_apply(&preview) {
                                app.view.notice =
                                    Some(format!("ops.rollback.apply failed: {err}"));
                            } else {
                                app.view.notice = Some("Applying rollback…".into());
                            }
                        }
                    }
                    OpsConfirmKind::CancelRun { run_id } => {
                        if let Some(bridge) = app.bridge.as_mut() {
                            if let Err(err) = bridge.ops_runs_cancel(&run_id) {
                                app.view.notice =
                                    Some(format!("ops.runs.cancel failed: {err}"));
                            } else {
                                app.view.notice = Some(format!("Cancelling {run_id}…"));
                            }
                        }
                    }
                    OpsConfirmKind::DismissAlert { alert_id } => {
                        if let Some(bridge) = app.bridge.as_mut() {
                            if let Err(err) = bridge.ops_alerts_dismiss(&alert_id) {
                                app.view.notice =
                                    Some(format!("ops.alerts.dismiss failed: {err}"));
                            } else {
                                app.view.notice = Some("Dismissing alert…".into());
                            }
                        }
                    }
                }
                return true;
            }
            KeyCode::Char('n') | KeyCode::Char('N') => {
                ops.confirm = None;
                app.view.notice = Some("Cancelled — no mutation.".into());
                return true;
            }
            _ => return true, // swallow other keys while confirm open
        }
    }

    // Pick-mode Enter selects the target.
    if ops.pick_mode != OpsPickMode::None {
        match key.code {
            KeyCode::Up | KeyCode::Char('k') => {
                ops.scroll_by(-1, 12);
                return true;
            }
            KeyCode::Down | KeyCode::Char('j') => {
                ops.scroll_by(1, 12);
                return true;
            }
            KeyCode::Enter => {
                match ops.pick_mode {
                    OpsPickMode::Run => {
                        if let Some(run_id) = ops.selected_cancellable_run_id().map(str::to_string)
                        {
                            ops.confirm = Some(OpsConfirmState::cancel_run(run_id));
                        } else {
                            app.view.notice =
                                Some("Selected run is not cancellable.".into());
                        }
                    }
                    OpsPickMode::Alert => {
                        if let Some(alert_id) = ops.selected_alert_id().map(str::to_string) {
                            ops.confirm = Some(OpsConfirmState::dismiss_alert(alert_id));
                        } else {
                            app.view.notice = Some("No alert selected.".into());
                        }
                    }
                    OpsPickMode::Backup => {
                        if let Some(name) = ops.selected_backup_name().map(str::to_string) {
                            if let Some(bridge) = app.bridge.as_mut() {
                                if let Err(err) = bridge.ops_rollback_preview(&name) {
                                    app.view.notice =
                                        Some(format!("ops.rollback.preview failed: {err}"));
                                } else {
                                    app.view.notice =
                                        Some(format!("Previewing rollback · {name}…"));
                                }
                            }
                        } else {
                            app.view.notice = Some("No backup selected.".into());
                        }
                    }
                    OpsPickMode::None => {}
                }
                return true;
            }
            _ => {}
        }
    }

    let plain = !key
        .modifiers
        .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT | KeyModifiers::SHIFT);
    match key.code {
        KeyCode::Up | KeyCode::Char('k') => {
            ops.scroll_by(-1, 12);
            true
        }
        KeyCode::Down | KeyCode::Char('j') => {
            ops.scroll_by(1, 12);
            true
        }
        KeyCode::Char('r') if plain => {
            app.request_ops_snapshot();
            true
        }
        KeyCode::Char('s') if plain => {
            if let Some(bridge) = app.bridge.as_mut() {
                if let Err(err) = bridge.ops_sync_preview() {
                    app.view.notice = Some(format!("ops.sync.preview failed: {err}"));
                } else {
                    app.view.notice = Some("Building sync preview…".into());
                }
            } else {
                app.view.notice = Some("No bridge — cannot sync.".into());
            }
            true
        }
        KeyCode::Char('b') if plain => {
            if ops.backups.is_empty() {
                app.view.notice = Some("No backups available for rollback.".into());
            } else {
                ops.pick_mode = OpsPickMode::Backup;
                ops.selected_backup = 0;
                app.view.notice = Some("Select backup · Enter preview · Esc clear".into());
            }
            true
        }
        KeyCode::Char('c') if plain => {
            let cancellable: Vec<_> = ops
                .runs
                .iter()
                .enumerate()
                .filter(|(_, r)| r.cancellable)
                .collect();
            if cancellable.is_empty() {
                app.view.notice = Some("No cancellable runs.".into());
            } else {
                ops.pick_mode = OpsPickMode::Run;
                ops.selected_run = cancellable[0].0;
                app.view.notice = Some("Select run · Enter confirm cancel · Esc clear".into());
            }
            true
        }
        KeyCode::Char('d') if plain => {
            if ops.alerts.is_empty() {
                app.view.notice = Some("No alerts to dismiss.".into());
            } else {
                ops.pick_mode = OpsPickMode::Alert;
                ops.selected_alert = 0;
                app.view.notice =
                    Some("Select alert · Enter confirm dismiss · Esc clear".into());
            }
            true
        }
        KeyCode::Char('v') if plain => {
            let n = ops.reviews.len();
            app.view.notice = Some(if n == 0 {
                "No review receipts.".into()
            } else {
                format!("{n} review receipt(s) listed (read-only).")
            });
            true
        }
        _ => false,
    }
}

/// U5b: Settings scroll + curated integration intent confirm.
fn handle_settings_keys(app: &mut ShellApp, key: KeyEvent) -> bool {
    let Some(settings) = app.settings_panel.as_mut() else {
        return false;
    };

    if settings.pending_integration_id.is_some() {
        match key.code {
            KeyCode::Char('y') | KeyCode::Char('Y') => {
                let id = settings.pending_integration_id.clone().unwrap_or_default();
                if let Some(bridge) = app.bridge.as_mut() {
                    if let Err(err) = bridge.settings_integration_confirm(&id) {
                        app.view.notice =
                            Some(format!("settings.integration.confirm failed: {err}"));
                    } else {
                        app.view.notice = Some("Recording integration intent…".into());
                    }
                }
                return true;
            }
            KeyCode::Char('n') | KeyCode::Char('N') => {
                settings.clear_integration_confirm();
                app.view.notice = Some("Cancelled — no files written.".into());
                return true;
            }
            _ => return true,
        }
    }

    match key.code {
        KeyCode::Up | KeyCode::Char('k') => {
            settings.move_selection(-1);
            settings.scroll_by(-1, 12);
            true
        }
        KeyCode::Down | KeyCode::Char('j') => {
            settings.move_selection(1);
            settings.scroll_by(1, 12);
            true
        }
        KeyCode::Enter => {
            if settings.begin_integration_confirm() {
                app.view.notice =
                    Some("Confirm install intent? y confirm · n/Esc cancel".into());
            } else {
                app.view.notice = Some("No curated integration selected.".into());
            }
            true
        }
        KeyCode::Char('r')
            if !key
                .modifiers
                .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT | KeyModifiers::SHIFT) =>
        {
            app.request_settings_snapshot();
            true
        }
        _ => false,
    }
}

/// U4d/U5a: empty-compose `1`–`6` switch Work|Project|Tasks|Sessions|Ops|Settings.
fn try_view_shortcut(app: &mut ShellApp, key: KeyEvent) -> bool {
    if key
        .modifiers
        .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT | KeyModifiers::SHIFT)
    {
        return false;
    }
    if !team_keys_available(
        app.chat.focus == Focus::Editor,
        app.editor.lines().join("").trim().is_empty(),
        app.engine.can_prompt(),
    ) {
        return false;
    }
    let KeyCode::Char(c) = key.code else {
        return false;
    };
    let Some(view) = view_from_digit(c) else {
        return false;
    };
    app.set_workspace_view(view);
    true
}

/// `p` opens Tasks view / plans list (U4b+U4d). Same empty-compose gate as
/// team setup so a typed character is never stolen. While the list is open,
/// `handle_plan_list_key` owns input — including `y`/`n` — so team `a`/`A`
/// cannot clash.
fn try_plan_shortcut(app: &mut ShellApp, key: KeyEvent) -> bool {
    if app.bridge.is_none()
        || key
            .modifiers
            .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT)
    {
        return false;
    }
    if !team_keys_available(
        app.chat.focus == Focus::Editor,
        app.editor.lines().join("").trim().is_empty(),
        app.engine.can_prompt(),
    ) {
        return false;
    }
    match key.code {
        KeyCode::Char('p') => {
            app.set_workspace_view(WorkspaceView::Tasks);
            true
        }
        _ => false,
    }
}

/// U4b: key routing while the plans list is open. ↑/↓ select, Enter detail,
/// Esc closes detail then list locally (and returns Tasks → Work), `y` approve
/// / `n` reject when awaiting_approval and mode ≠ ask. Bare `a`/`A` are
/// ignored here (team shortcuts never run while list-focused).
fn handle_plan_list_key(app: &mut ShellApp, key: KeyEvent) -> bool {
    if app.plan_list.is_none() {
        return false;
    }
    match key.code {
        KeyCode::Char('q') if !key.modifiers.contains(KeyModifiers::CONTROL) => {
            return true;
        }
        KeyCode::Esc => {
            let close_list = app
                .plan_list
                .as_mut()
                .map(|l| l.close_detail_or_list())
                .unwrap_or(true);
            if close_list {
                app.plan_list = None;
                if app.workspace_view == WorkspaceView::Tasks {
                    app.set_workspace_view(WorkspaceView::Work);
                } else {
                    app.view.notice = Some("Plans list closed.".into());
                }
            }
        }
        KeyCode::Down | KeyCode::Char('j') => {
            if let Some(list) = app.plan_list.as_mut() {
                list.move_down();
            }
        }
        KeyCode::Up | KeyCode::Char('k') => {
            if let Some(list) = app.plan_list.as_mut() {
                list.move_up();
            }
        }
        KeyCode::Enter if !key.modifiers.contains(KeyModifiers::SHIFT) => {
            app.request_plan_show();
        }
        KeyCode::Char('y') => {
            app.request_plan_decide("approved");
        }
        KeyCode::Char('n') => {
            app.request_plan_decide("rejected");
        }
        KeyCode::Char('x') => {
            app.begin_execute_role_select();
        }
        KeyCode::Char('c') if !key.modifiers.contains(KeyModifiers::CONTROL) => {
            app.request_plan_cancel();
        }
        // Explicitly ignore team keys while list-focused — never fall through.
        KeyCode::Char('a') | KeyCode::Char('A') => {}
        _ => {}
    }
    false
}

/// U4d: per-role editor key owner on Project.
fn handle_role_editor_key(app: &mut ShellApp, key: KeyEvent) -> bool {
    let Some(editor) = app.role_editor.as_mut() else {
        return false;
    };
    match editor.phase {
        RoleEditPhase::Loading | RoleEditPhase::Saving => {
            if key.code == KeyCode::Esc {
                app.role_editor = None;
                app.view.notice = Some("Role edit cancelled.".into());
            }
        }
        RoleEditPhase::ModelSearch => match key.code {
            KeyCode::Esc => {
                app.role_editor = None;
                app.view.notice = Some("Role edit cancelled.".into());
            }
            KeyCode::Down => editor.move_down(),
            KeyCode::Up => editor.move_up(),
            KeyCode::Char('j') if editor.query.is_empty() => editor.move_down(),
            KeyCode::Char('k') if editor.query.is_empty() => editor.move_up(),
            KeyCode::Enter if !key.modifiers.contains(KeyModifiers::SHIFT) => {
                editor.begin_confirm();
            }
            KeyCode::Backspace => {
                let mut q = editor.query.clone();
                q.pop();
                editor.set_query(q);
            }
            KeyCode::Char(c) if !key.modifiers.contains(KeyModifiers::CONTROL) => {
                let mut q = editor.query.clone();
                q.push(c);
                editor.set_query(q);
            }
            _ => {}
        },
        RoleEditPhase::Confirm => match key.code {
            KeyCode::Esc => editor.back_to_search(),
            KeyCode::Enter if !key.modifiers.contains(KeyModifiers::SHIFT) => {
                let role = editor.role.clone();
                let Some(key_str) = editor.pending_key.clone() else {
                    return false;
                };
                editor.begin_saving();
                if let Some(bridge) = app.bridge.as_mut() {
                    if let Err(err) = bridge.team_edit_assign(&role, &key_str) {
                        app.role_editor = None;
                        app.view.notice = Some(format!("Save failed: {err}"));
                    }
                }
            }
            _ => {}
        },
    }
    false
}

/// U4c: nested role-select / confirm-execute key owner. Esc cancels locally
/// (no server). `y`/`n` here decide execute confirm — never plan approve/reject.
/// Team `a`/`A` swallowed while open.
fn handle_execution_modal_key(app: &mut ShellApp, key: KeyEvent) -> bool {
    match app.execution_modal.as_mut() {
        Some(ExecutionModal::RoleSelect(state)) => match key.code {
            KeyCode::Char('q') if !key.modifiers.contains(KeyModifiers::CONTROL) => true,
            KeyCode::Esc => {
                app.execution_modal = None;
                app.view.notice = Some("Execution cancelled.".into());
                false
            }
            KeyCode::Down | KeyCode::Char('j') => {
                state.move_down();
                false
            }
            KeyCode::Up | KeyCode::Char('k') => {
                state.move_up();
                false
            }
            KeyCode::Enter if !key.modifiers.contains(KeyModifiers::SHIFT) => {
                let task_id = state.task_id.clone();
                let role = state.selected_role().map(str::to_string);
                app.execution_modal = None;
                if let Some(role) = role {
                    app.request_plan_preview(&task_id, &role);
                }
                false
            }
            KeyCode::Char('a') | KeyCode::Char('A') => false,
            _ => false,
        },
        Some(ExecutionModal::Confirm(_)) => match key.code {
            KeyCode::Char('q') if !key.modifiers.contains(KeyModifiers::CONTROL) => true,
            KeyCode::Esc | KeyCode::Char('n') => {
                app.execution_modal = None;
                app.view.notice = Some("Execution cancelled.".into());
                false
            }
            KeyCode::Char('y') => {
                app.request_plan_execute_confirm();
                false
            }
            KeyCode::Char('a') | KeyCode::Char('A') => false,
            _ => false,
        },
        None => false,
    }
}

/// `r` = revalidate availability on demand, `R` = preview a strategy
/// recovery. Same empty-compose-or-non-editor-focus gate as team setup
/// (`team_keys_available`) — bare keys never steal a typed character.
fn try_recovery_shortcut(app: &mut ShellApp, key: KeyEvent) -> bool {
    if app.bridge.is_none()
        || key
            .modifiers
            .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT)
    {
        return false;
    }
    if !team_keys_available(
        app.chat.focus == Focus::Editor,
        app.editor.lines().join("").trim().is_empty(),
        app.engine.can_prompt(),
    ) {
        return false;
    }
    match key.code {
        KeyCode::Char('r') => {
            app.request_revalidate();
            true
        }
        KeyCode::Char('R') => {
            app.request_recovery_preview();
            true
        }
        _ => false,
    }
}

/// U3b: key routing while an extension_ui dialog is open. Esc cancels with
/// the active id only; Enter confirms; j/k move select/confirm; input/editor
/// type into the dialog's own draft (never the chat compose box).
/// Plain `q` quits only on select/confirm — never while typing into input/editor.
fn handle_extension_ui_key(app: &mut ShellApp, key: KeyEvent) -> bool {
    let Some(dialog) = app.extension_ui.active.as_mut() else {
        return false;
    };
    let method = dialog.request.method.clone();
    match key.code {
        KeyCode::Char('q')
            if !key.modifiers.contains(KeyModifiers::CONTROL)
                && matches!(
                    method,
                    ExtensionUiMethod::Select | ExtensionUiMethod::Confirm
                ) =>
        {
            return true;
        }
        KeyCode::Esc => {
            if let Some(ExtensionUiEvent::DialogClosed {
                response: Some(payload),
            }) = app.extension_ui.cancel_active()
            {
                app.send_extension_ui_response(payload);
            }
            return false;
        }
        KeyCode::Enter if !key.modifiers.contains(KeyModifiers::SHIFT) => {
            if let Some(ExtensionUiEvent::DialogClosed {
                response: Some(payload),
            }) = app.extension_ui.confirm_active()
            {
                app.send_extension_ui_response(payload);
            }
            return false;
        }
        KeyCode::Down | KeyCode::Char('j')
            if matches!(
                method,
                ExtensionUiMethod::Select | ExtensionUiMethod::Confirm
            ) =>
        {
            if let Some(d) = app.extension_ui.active.as_mut() {
                d.move_down();
            }
        }
        KeyCode::Up | KeyCode::Char('k')
            if matches!(
                method,
                ExtensionUiMethod::Select | ExtensionUiMethod::Confirm
            ) =>
        {
            if let Some(d) = app.extension_ui.active.as_mut() {
                d.move_up();
            }
        }
        KeyCode::Char('y') if matches!(method, ExtensionUiMethod::Confirm) => {
            if let Some(d) = app.extension_ui.active.as_mut() {
                d.selected = 0;
            }
            if let Some(ExtensionUiEvent::DialogClosed {
                response: Some(payload),
            }) = app.extension_ui.confirm_active()
            {
                app.send_extension_ui_response(payload);
            }
        }
        KeyCode::Char('n') if matches!(method, ExtensionUiMethod::Confirm) => {
            if let Some(d) = app.extension_ui.active.as_mut() {
                d.selected = 1;
            }
            if let Some(ExtensionUiEvent::DialogClosed {
                response: Some(payload),
            }) = app.extension_ui.confirm_active()
            {
                app.send_extension_ui_response(payload);
            }
        }
        KeyCode::Backspace
            if matches!(method, ExtensionUiMethod::Input | ExtensionUiMethod::Editor) =>
        {
            if let Some(d) = app.extension_ui.active.as_mut() {
                d.draft.pop();
            }
        }
        KeyCode::Char(c)
            if matches!(method, ExtensionUiMethod::Input | ExtensionUiMethod::Editor)
                && !key.modifiers.contains(KeyModifiers::CONTROL)
                && !key.modifiers.contains(KeyModifiers::ALT) =>
        {
            if let Some(d) = app.extension_ui.active.as_mut() {
                if matches!(method, ExtensionUiMethod::Editor)
                    && key.modifiers.contains(KeyModifiers::SHIFT)
                    && c == '\n'
                {
                    d.draft.push('\n');
                } else {
                    d.draft.push(c);
                }
            }
        }
        KeyCode::Enter if key.modifiers.contains(KeyModifiers::SHIFT) => {
            // Shift+Enter inserts a newline in editor mode only.
            if matches!(method, ExtensionUiMethod::Editor) {
                if let Some(d) = app.extension_ui.active.as_mut() {
                    d.draft.push('\n');
                }
            }
        }
        _ => {}
    }
    false
}

/// Key routing while the recovery-preview modal is open — it owns every key
/// until it closes. Enter/`y` apply, `x` explicit reject, Esc cancels
/// LOCALLY (no server call at all — cancel mutates nothing by construction).
/// Returns `true` when the host should quit (plain `q`; Ctrl+C/Q handled
/// before this runs).
fn handle_recovery_key(app: &mut ShellApp, key: KeyEvent) -> bool {
    if app.recovery_preview.is_none() {
        return false;
    }
    match key.code {
        KeyCode::Char('q') if !key.modifiers.contains(KeyModifiers::CONTROL) => {
            return true;
        }
        KeyCode::Esc => {
            app.recovery_preview = None;
            app.view.notice = Some("Recovery preview cancelled.".into());
        }
        KeyCode::Enter | KeyCode::Char('y') => {
            app.send_recovery_apply();
        }
        KeyCode::Char('x') => {
            app.send_recovery_reject();
        }
        _ => {}
    }
    false
}

/// Key routing while the session picker modal is open (U3a) — it owns every
/// key until it closes. Enter switches to the highlighted real session; Esc
/// cancels LOCALLY (no server call at all — mutates nothing by
/// construction, same guarantee as the recovery-preview modal's cancel).
/// Returns `true` when the host should quit (plain `q`; Ctrl+C/Q handled
/// before this runs).
fn handle_session_picker_key(app: &mut ShellApp, key: KeyEvent) -> bool {
    let Some(picker) = app.session_picker.as_mut() else {
        return false;
    };
    match key.code {
        KeyCode::Down | KeyCode::Char('j') => picker.move_down(),
        KeyCode::Up | KeyCode::Char('k') => picker.move_up(),
        KeyCode::Char('q') if !key.modifiers.contains(KeyModifiers::CONTROL) => {
            return true;
        }
        KeyCode::Esc => {
            app.session_picker = None;
            if app.workspace_view == WorkspaceView::Sessions {
                app.set_workspace_view(WorkspaceView::Work);
            } else {
                app.view.notice = Some("Session picker cancelled.".into());
            }
        }
        KeyCode::Enter => {
            if let Some(index) = picker.confirm() {
                app.session_picker = None;
                app.pi_session_index = index;
                let draft = app.editor_draft_text();
                if let Some(bridge) = app.bridge.as_mut() {
                    if let Err(err) = bridge.switch_session_index_with_draft(index, &draft) {
                        app.view.notice = Some(format!("Session switch failed: {err}"));
                    }
                }
            }
        }
        _ => {}
    }
    false
}

/// Key routing while the analyst picker modal is open — the picker owns
/// movement/confirm/cancel until it closes. Returns `true` when the host
/// should quit (plain `q`; Ctrl+C/Q are handled before this runs).
fn handle_picker_key(app: &mut ShellApp, key: KeyEvent) -> bool {
    let Some(picker) = app.picker.as_mut() else {
        return false;
    };
    match key.code {
        KeyCode::Down | KeyCode::Char('j') => picker.move_down(),
        KeyCode::Up | KeyCode::Char('k') => picker.move_up(),
        KeyCode::Char('q') if !key.modifiers.contains(KeyModifiers::CONTROL) => {
            return true;
        }
        KeyCode::Esc => {
            app.picker = None;
            app.view.notice = Some("Analyst picker cancelled.".into());
        }
        KeyCode::Enter => {
            if let Some(option) = picker.confirm() {
                let payload = AnalystPickerState::analyst_payload(&option);
                app.picker = None;
                app.send_analyze_with_analyst(payload);
            }
        }
        _ => {}
    }
    false
}

fn try_bridge_shortcut(app: &mut ShellApp, key: KeyEvent) -> bool {
    if app.bridge.is_none() || !key.modifiers.contains(KeyModifiers::CONTROL) {
        return false;
    }
    // U3a: session picker / rename / fork need `&mut app` themselves
    // (picker) or read the compose box before touching the bridge (rename)
    // — handled here, before taking the bridge borrow below.
    match key.code {
        KeyCode::Char('l') => {
            app.set_workspace_view(WorkspaceView::Sessions);
            return true;
        }
        KeyCode::Char('r') => {
            let name = app.editor.lines().join("\n").trim().to_string();
            if name.is_empty() {
                app.view.notice = Some(
                    "Type a name in the compose box, then Ctrl+R to rename the session.".into(),
                );
                return true;
            }
            let result = app.bridge.as_mut().expect("bridge").rename_session(&name);
            match result {
                Ok(()) => {
                    app.clear_editor();
                    app.view.notice = Some("Renaming session…".into());
                }
                Err(err) => app.view.notice = Some(format!("Rename failed: {err}")),
            }
            return true;
        }
        KeyCode::Char('f') => {
            let draft = app.editor_draft_text();
            if let Err(err) = app
                .bridge
                .as_mut()
                .expect("bridge")
                .fork_session_with_draft(&draft)
            {
                app.view.notice = Some(format!("Fork failed: {err}"));
            } else {
                app.view.notice = Some("Forking session…".into());
            }
            return true;
        }
        KeyCode::Char('n') => {
            let draft = app.editor_draft_text();
            if let Err(err) = app
                .bridge
                .as_mut()
                .expect("bridge")
                .new_session_with_draft(&draft)
            {
                app.view.notice = Some(format!("New session failed: {err}"));
            }
            return true;
        }
        _ => {}
    }
    let Some(bridge) = app.bridge.as_mut() else {
        return false;
    };
    match key.code {
        KeyCode::Char('m') => {
            if let Err(err) = bridge.cycle_model() {
                app.view.notice = Some(format!("Model switch failed: {err}"));
            }
            true
        }
        KeyCode::Char('[') => {
            app.step_pi_session(-1);
            true
        }
        KeyCode::Char(']') => {
            app.step_pi_session(1);
            true
        }
        KeyCode::Char('k') => {
            if let Err(err) = bridge.compact_session() {
                app.view.notice = Some(format!("Compact failed: {err}"));
            }
            true
        }
        _ => false,
    }
}

fn crossterm_to_textarea(key: KeyEvent) -> Option<Input> {
    match key.code {
        KeyCode::Char(c) => Some(Input {
            key: Key::Char(c),
            ctrl: key.modifiers.contains(KeyModifiers::CONTROL),
            alt: key.modifiers.contains(KeyModifiers::ALT),
            shift: key.modifiers.contains(KeyModifiers::SHIFT),
        }),
        KeyCode::Backspace => Some(Input {
            key: Key::Backspace,
            ctrl: false,
            alt: false,
            shift: false,
        }),
        KeyCode::Delete => Some(Input {
            key: Key::Delete,
            ctrl: false,
            alt: false,
            shift: false,
        }),
        KeyCode::Left => Some(Input {
            key: Key::Left,
            ctrl: key.modifiers.contains(KeyModifiers::CONTROL),
            alt: false,
            shift: key.modifiers.contains(KeyModifiers::SHIFT),
        }),
        KeyCode::Right => Some(Input {
            key: Key::Right,
            ctrl: key.modifiers.contains(KeyModifiers::CONTROL),
            alt: false,
            shift: key.modifiers.contains(KeyModifiers::SHIFT),
        }),
        KeyCode::Up => Some(Input {
            key: Key::Up,
            ctrl: false,
            alt: false,
            shift: false,
        }),
        KeyCode::Down => Some(Input {
            key: Key::Down,
            ctrl: false,
            alt: false,
            shift: false,
        }),
        KeyCode::Home => Some(Input {
            key: Key::Home,
            ctrl: key.modifiers.contains(KeyModifiers::CONTROL),
            alt: false,
            shift: false,
        }),
        KeyCode::End => Some(Input {
            key: Key::End,
            ctrl: key.modifiers.contains(KeyModifiers::CONTROL),
            alt: false,
            shift: false,
        }),
        _ => None,
    }
}

fn draw(frame: &mut Frame, app: &ShellApp) {
    let area = frame.area();
    let regions = split_shell(area);
    // U4d/U5a: non-Work chrome views replace the Work chat column.
    match app.workspace_view {
        WorkspaceView::Project if app.plan_list.is_none() => {
            render_project_view(
                frame.buffer_mut(),
                regions,
                &app.view,
                &app.chat,
                &app.editor,
                app.workspace_view,
            );
        }
        WorkspaceView::Operations => {
            let ops = app
                .ops_panel
                .as_ref()
                .cloned()
                .unwrap_or_else(OpsPanelState::loading);
            render_operations_view(
                frame.buffer_mut(),
                regions,
                &app.view,
                &app.chat,
                &ops,
                app.workspace_view,
            );
        }
        WorkspaceView::Settings => {
            let settings = app
                .settings_panel
                .as_ref()
                .cloned()
                .unwrap_or_else(SettingsPanelState::loading);
            render_settings_view(
                frame.buffer_mut(),
                regions,
                &app.view,
                &app.chat,
                &settings,
                app.workspace_view,
            );
        }
        _ => {
            render_shell(
                frame.buffer_mut(),
                regions,
                &app.view,
                &app.chat,
                &app.editor,
            );
        }
    }
    if let Some(picker) = &app.picker {
        render_analyst_picker(frame.buffer_mut(), area, picker);
    }
    if let Some(preview) = &app.recovery_preview {
        render_recovery_preview(frame.buffer_mut(), area, preview);
    }
    if let Some(picker) = &app.session_picker {
        render_session_picker(frame.buffer_mut(), area, picker);
    }
    if let Some(plans) = &app.plan_list {
        render_plan_list(frame.buffer_mut(), area, plans, &app.view.work_mode);
    }
    if let Some(editor) = &app.role_editor {
        render_role_editor(frame.buffer_mut(), area, editor);
    }
    match &app.execution_modal {
        Some(ExecutionModal::RoleSelect(state)) => {
            render_role_select(frame.buffer_mut(), area, state);
        }
        Some(ExecutionModal::Confirm(state)) => {
            render_confirm_execute(frame.buffer_mut(), area, state);
        }
        None => {}
    }
    if let Some(dialog) = &app.extension_ui.active {
        render_extension_ui(frame.buffer_mut(), area, dialog);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn press(c: char) -> KeyEvent {
        KeyEvent::new(KeyCode::Char(c), KeyModifiers::NONE)
    }

    #[test]
    fn input_dialog_types_word_with_q_without_quitting() {
        let mut app = ShellApp::new(None);
        app.extension_ui.ingest(&json!({
            "type": "extension_ui_request",
            "id": "input-1",
            "method": "input",
            "title": "Name",
            "placeholder": "type here"
        }));
        assert!(app.extension_ui.is_open());

        for c in ['r', 'e', 'q', 'u', 'e', 's', 't'] {
            let should_quit = handle_key(&mut app, press(c)).expect("key");
            assert!(!should_quit, "plain '{c}' must not quit an input dialog");
        }

        let draft = app
            .extension_ui
            .active
            .as_ref()
            .map(|d| d.draft.as_str())
            .unwrap_or("");
        assert_eq!(draft, "request");
        assert!(app.extension_ui.is_open());
    }

    #[test]
    fn select_dialog_plain_q_still_quits() {
        let mut app = ShellApp::new(None);
        app.extension_ui.ingest(&json!({
            "type": "extension_ui_request",
            "id": "select-1",
            "method": "select",
            "title": "Pick",
            "options": ["A", "B"]
        }));
        let should_quit = handle_key(&mut app, press('q')).expect("key");
        assert!(should_quit, "plain q must still quit select dialogs");
    }

    #[test]
    fn plan_list_focus_uses_y_n_not_a_and_esc_closes_locally() {
        let mut app = ShellApp::new(None);
        app.view.work_mode = "plan".into();
        app.view.team_state = Some("suggested".into());
        app.plan_list = Some(PlanListState::from_plans_record(&json!({
            "timeline": [{
                "taskId": "task-1",
                "taskText": "Add OAuth",
                "state": "awaiting_approval",
                "approval": "not_decided",
                "planReady": true
            }]
        })));
        // Bare `a` must NOT close the list or trigger team analyze while focused.
        let should_quit = handle_key(&mut app, press('a')).expect("key");
        assert!(!should_quit);
        assert!(app.plan_list.is_some(), "a must be ignored in list-focus");
        assert!(app.picker.is_none(), "a must not open analyst picker");

        // Esc closes list locally with no bridge.
        let should_quit = handle_key(&mut app, KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE))
            .expect("esc");
        assert!(!should_quit);
        assert!(app.plan_list.is_none());
    }

    #[test]
    fn plan_list_ask_mode_blocks_approve_reject() {
        let mut app = ShellApp::new(None);
        app.view.work_mode = "ask".into();
        app.plan_list = Some(PlanListState::from_plans_record(&json!({
            "timeline": [{
                "taskId": "task-1",
                "state": "awaiting_approval",
                "approval": "not_decided",
                "planReady": true
            }]
        })));
        let _ = handle_key(&mut app, press('y')).expect("y");
        assert!(
            app.view
                .notice
                .as_deref()
                .is_some_and(|n| n.contains("ASK") || n.contains("read-only")),
            "ASK must refuse decide: {:?}",
            app.view.notice
        );
        assert!(!app.plans_action_pending);
    }

    #[test]
    fn u4c_confirm_modal_owns_y_n_so_list_decide_never_fires() {
        let mut app = ShellApp::new(None);
        app.view.work_mode = "agent".into();
        app.plan_list = Some(PlanListState::from_plans_record(&json!({
            "timeline": [{
                "taskId": "task-1",
                "state": "awaiting_approval",
                "approval": "not_decided",
                "planReady": true
            }],
            "projectTeamRoles": ["Builder"]
        })));
        app.execution_modal = Some(ExecutionModal::Confirm(
            ConfirmExecuteState::from_plan_preview(&json!({
                "taskId": "task-1",
                "decision": "ROUTED",
                "provider": "codex",
                "model": "gpt-6-astra",
                "why": "ok",
                "confirmationTarget": {
                    "role": "Builder",
                    "selection": "assigned",
                    "strategyFingerprint": "fp-1",
                    "candidateKey": "codex::gpt-6-astra"
                },
                "autoExecuted": false
            }))
            .unwrap(),
        ));
        // y goes to execute confirm path (pending) — list still awaiting_approval
        // so if y leaked to list it would set plans_action_pending via decide.
        // Without a bridge, request_plan_execute_confirm returns early; modal stays.
        let _ = handle_key(&mut app, press('y')).expect("y");
        assert!(
            matches!(app.execution_modal, Some(ExecutionModal::Confirm(_))),
            "confirm modal must still own the flow without a bridge"
        );
        assert!(!app.plans_action_pending, "list decide must not fire under confirm");

        let _ = handle_key(&mut app, press('a')).expect("a");
        assert!(app.picker.is_none(), "team a swallowed during confirm");
        assert!(app.execution_modal.is_some());

        let _ = handle_key(&mut app, KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE)).expect("esc");
        assert!(app.execution_modal.is_none());
        assert!(
            app.view
                .notice
                .as_deref()
                .is_some_and(|n| n.contains("cancelled")),
            "Esc cancels locally: {:?}",
            app.view.notice
        );
        assert!(app.plan_list.is_some(), "Esc on confirm must not close the plan list");
    }

    #[test]
    fn u4c_x_opens_role_select_only_for_agent_approved_not_started() {
        let mut app = ShellApp::new(None);
        app.view.work_mode = "agent".into();
        app.plan_list = Some(PlanListState::from_plans_record(&json!({
            "timeline": [{
                "taskId": "task-1",
                "state": "approved",
                "approval": "approved",
                "execution": { "state": "not_started", "active": false }
            }],
            "projectTeamRoles": ["Builder", "Reviewer"]
        })));
        let _ = handle_key(&mut app, press('x')).expect("x");
        assert!(matches!(
            app.execution_modal,
            Some(ExecutionModal::RoleSelect(_))
        ));
        // team A swallowed
        let _ = handle_key(&mut app, press('A')).expect("A");
        assert!(app.picker.is_none());
        assert!(matches!(
            app.execution_modal,
            Some(ExecutionModal::RoleSelect(_))
        ));
        let _ = handle_key(&mut app, KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE)).expect("esc");
        assert!(app.execution_modal.is_none());
    }

    #[test]
    fn u4c_manual_handoff_ingest_pushes_task_prompt_and_blocks_confirm() {
        let mut app = ShellApp::new(None);
        app.ingest_plan_preview_record(&json!({
            "type": "plan_preview",
            "taskId": "task-1",
            "decision": "MANUAL_HANDOFF",
            "role": "Builder",
            "provider": "cursor",
            "model": "cursor-model",
            "confirmationTarget": null,
            "taskPrompt": "# Plan\n\nDo the thing\n",
            "autoExecuted": false
        }));
        let Some(ExecutionModal::Confirm(confirm)) = &app.execution_modal else {
            panic!("expected confirm modal for manual handoff");
        };
        assert!(!confirm.can_confirm());
        assert!(app
            .chat
            .messages
            .iter()
            .any(|m| m.content.contains("Do the thing")));
    }

    // ---- A3: ASK provider events, in-flight flag, Esc cancel ---------

    fn recorder_app(mode: &str) -> (ShellApp, PathBuf) {
        let path = env::temp_dir().join(format!(
            "kairo-ui-a3-{}-{}.log",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let bridge = BridgeClient::spawn_recorder(&path).expect("recorder");
        let mut app = ShellApp::new(Some(bridge));
        app.view.work_mode = mode.into();
        (app, path)
    }

    fn recorded_ops(path: &PathBuf, want: usize) -> String {
        for _ in 0..200 {
            let text = std::fs::read_to_string(path).unwrap_or_default();
            if text.lines().count() >= want {
                return text;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        std::fs::read_to_string(path).unwrap_or_default()
    }

    fn pe(turn: &str, seq: u64, kind: &str, extra: serde_json::Value) -> serde_json::Value {
        let mut v = json!({ "type": "provider_event", "turnId": turn, "sessionId": "s",
            "seq": seq, "provider": "codex", "kind": kind });
        if let (Some(o), Some(e)) = (v.as_object_mut(), extra.as_object()) {
            for (k, val) in e {
                o.insert(k.clone(), val.clone());
            }
        }
        v
    }

    fn esc() -> KeyEvent {
        KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE)
    }

    #[test]
    fn ask_mode_send_sets_ask_in_flight_and_other_modes_do_not() {
        let (mut app, path) = recorder_app("ask");
        app.editor.insert_str("hello");
        app.submit_editor();
        assert!(app.chat.ask_in_flight);
        assert!(!app.chat.is_streaming);
        assert!(recorded_ops(&path, 1).contains("\"prompt\""));
        let _ = std::fs::remove_file(&path);

        let (mut app, path) = recorder_app("plan");
        app.editor.insert_str("hello");
        app.submit_editor();
        assert!(!app.chat.ask_in_flight, "PLAN prompts never set the ASK flag");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn esc_with_ask_in_flight_sends_abort_and_keeps_waiting_for_the_terminal() {
        let (mut app, path) = recorder_app("ask");
        app.chat.begin_ask();
        handle_key(&mut app, esc()).expect("esc");
        assert!(recorded_ops(&path, 1).contains("\"abort\""));
        assert_eq!(app.view.notice.as_deref(), Some("Cancelling…"));
        assert!(app.chat.ask_in_flight, "cleared only by the terminal record");
        assert_eq!(app.chat.focus, Focus::Editor);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn esc_while_pi_streaming_still_aborts_the_stream() {
        let (mut app, path) = recorder_app("ask");
        app.chat.is_streaming = true;
        handle_key(&mut app, esc()).expect("esc");
        assert!(recorded_ops(&path, 1).contains("\"abort\""));
        assert!(!app.chat.is_streaming);
        assert!(app.view.notice.as_deref() != Some("Cancelling…"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn esc_when_idle_moves_focus_and_sends_nothing() {
        let (mut app, path) = recorder_app("ask");
        handle_key(&mut app, esc()).expect("esc");
        assert_eq!(app.chat.focus, Focus::Sidebar);
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert!(!recorded_ops(&path, 0).contains("abort"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn provider_events_render_and_are_kept_out_of_the_pi_reducer() {
        let mut app = ShellApp::new(None);
        app.chat.begin_ask();
        app.pending_prompt = Some("q".into());
        app.ingest_record(pe("t1", 1, "progress", json!({ "summary": "Working" })));
        app.ingest_record(pe("t1", 2, "text", json!({ "text": "Hi" })));
        app.ingest_record(pe("t1", 3, "tool_start", json!({ "id": "a", "name": "sh" })));
        app.ingest_record(pe("t1", 4, "tool_end", json!({ "id": "a", "name": "sh", "ok": true })));
        assert!(app.pending_prompt.is_none());
        assert!(app.chat.ask_in_flight);
        let roles: Vec<_> = app.chat.messages.iter().map(|m| m.role.clone()).collect();
        assert!(roles.contains(&chat::MessageRole::Assistant));
        assert!(roles.contains(&chat::MessageRole::Tool));
        assert!(!app.chat.is_streaming, "Pi reducer must not see provider_event");
        app.ingest_record(pe("t1", 5, "done", json!({})));
        assert!(!app.chat.ask_in_flight);
    }

    #[test]
    fn cancelled_terminal_clears_flag_and_notice() {
        let mut app = ShellApp::new(None);
        app.chat.begin_ask();
        app.view.notice = Some("Cancelling…".into());
        app.ingest_record(pe("t1", 1, "cancelled", json!({})));
        assert!(!app.chat.ask_in_flight);
        assert_eq!(app.chat.messages.last().unwrap().content, "Cancelled");
        assert_ne!(app.view.notice.as_deref(), Some("Cancelling…"));
    }

    #[test]
    fn task_result_after_streamed_text_is_not_rendered_twice() {
        let mut app = ShellApp::new(None);
        app.chat.begin_ask();
        app.ingest_record(pe("t1", 1, "text", json!({ "text": "The answer" })));
        let before = app.chat.messages.len();
        app.ingest_record(json!({ "type": "task_result", "kind": "answer",
            "provider": "codex", "model": "m", "answer": "The answer" }));
        assert_eq!(app.chat.messages.len(), before, "no duplicate answer row");
        assert!(!app.chat.ask_in_flight, "task_result clears the flag");
    }

    #[test]
    fn task_result_without_text_events_still_renders_the_answer() {
        let mut app = ShellApp::new(None);
        app.chat.begin_ask();
        app.ingest_record(pe("t1", 1, "progress", json!({ "summary": "Working" })));
        app.ingest_record(json!({ "type": "task_result", "kind": "answer",
            "provider": "claude", "model": "m", "answer": "Final" }));
        assert!(app
            .chat
            .messages
            .iter()
            .any(|m| m.content.contains("claude · m: Final")));
        // legacy path: no provider events at all
        let mut legacy = ShellApp::new(None);
        legacy.ingest_record(json!({ "type": "task_result", "kind": "answer",
            "provider": "claude", "answer": "Old" }));
        assert!(legacy.chat.messages.iter().any(|m| m.content == "claude: Old"));
    }

    #[test]
    fn error_record_clears_ask_flag_but_rejected_second_prompt_does_not() {
        let mut app = ShellApp::new(None);
        app.chat.begin_ask();
        app.ingest_record(json!({ "type": "error", "message": "A previous request is still running" }));
        assert!(app.chat.ask_in_flight, "the first ASK is still running");
        app.ingest_record(json!({ "type": "error", "message": "boom" }));
        assert!(!app.chat.ask_in_flight);
    }

    #[test]
    fn error_record_then_failed_still_renders_one_error_row() {
        // The sidecar emits `{type:"error"}` (clears the flag) and then the
        // terminal `failed`; the Error row must still appear exactly once.
        let mut app = ShellApp::new(None);
        app.chat.begin_ask();
        app.ingest_record(json!({ "type": "error", "message": "boom" }));
        assert!(!app.chat.ask_in_flight);
        app.ingest_record(pe("t1", 1, "failed", json!({ "message": "boom" })));
        let errs = app
            .chat
            .messages
            .iter()
            .filter(|m| m.role == chat::MessageRole::Error)
            .count();
        assert_eq!(errs, 1);
        assert!(!app.chat.ask_in_flight);
    }

    #[test]
    fn informational_error_keeps_esc_cancelling() {
        let (mut app, path) = recorder_app("ask");
        app.chat.begin_ask();
        app.ingest_record(pe("t1", 1, "error", json!({ "message": "hiccup" })));
        app.ingest_record(pe("t1", 2, "progress", json!({ "summary": "retrying" })));
        assert!(app.chat.ask_in_flight);
        handle_key(&mut app, esc()).expect("esc");
        assert!(recorded_ops(&path, 1).contains("\"abort\""));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn agent_settled_and_transcript_clear_the_ask_flag() {
        let mut app = ShellApp::new(None);
        app.chat.begin_ask();
        app.ingest_record(json!({ "type": "agent_settled" }));
        assert!(!app.chat.ask_in_flight);
        app.chat.begin_ask();
        app.ingest_record(json!({ "type": "transcript", "messages": [] }));
        assert!(!app.chat.ask_in_flight);
    }
}
