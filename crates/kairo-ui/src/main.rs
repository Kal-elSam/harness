mod analyst_picker;
mod bridge;
mod chat;
mod engine;
mod layout;
mod recovery_picker;
mod snapshot;
mod surfaces;

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
    can_analyze_team, can_approve_team, decide_submit, parse_slash_command, team_keys_available,
    EngineGate, SlashCommand, SubmitDecision,
};
use layout::split_shell;
use recovery_picker::RecoveryPreviewState;
use snapshot::apply_workspace_snapshot;
use surfaces::{render_analyst_picker, render_recovery_preview, render_shell, ShellViewModel};

// Keybindings (V2 + R3b + R4):
// - Tab: cycle focus Editor → Sidebar → Transcript
// - Editor: type in textarea; Enter submits prompt; Esc aborts stream or moves focus to Sidebar
// - Sidebar: j/k or arrows move agent selection
// - Transcript: PgUp/PgDn scroll
// - q: quit when Editor is empty; Ctrl+C / Ctrl+Q always quit
// - Bridge only: Ctrl+M cycle Kairo model; Ctrl+N new Pi session; Ctrl+[ / Ctrl+] prev/next session on disk; Ctrl+K compact
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

    fn step_pi_session(&mut self, delta: i32) {
        if self.pi_session_count == 0 {
            self.view.notice = Some(
                "No Pi session files for this project (RPC has no list_sessions)".into(),
            );
            return;
        }
        let count = self.pi_session_count as i32;
        let next = (self.pi_session_index as i32 + delta).rem_euclid(count) as usize;
        self.pi_session_index = next;
        if let Some(bridge) = self.bridge.as_mut() {
            if let Err(err) = bridge.switch_session_index(next) {
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
            }
            if kind == Some("ready") {
                self.engine = EngineGate::from_ready_record(&record);
                self.sync_engine_line();
                self.ingest_sessions_record(&record);
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
            } else if kind == Some("transcript") {
                if let Some(rows) = record.get("messages").and_then(|v| v.as_array()) {
                    self.chat.replace_from_sidecar_transcript(rows);
                    self.pending_prompt = None;
                }
            } else if kind == Some("notice") {
                if let Some(msg) = record.get("message").and_then(|v| v.as_str()) {
                    self.view.notice = Some(msg.to_string());
                }
            }
            if kind == Some("error") {
                let msg = record
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("bridge error");
                self.view.notice = Some(msg.to_string());
                self.team_action_pending = false;
                self.availability_action_pending = false;
                self.recovery_action_pending = false;
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
            }
            if kind != Some("transcript") {
                self.chat.apply_sidecar_event(&record);
            }
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

    fn submit_editor(&mut self) {
        let text = self.editor.lines().join("\n");
        if text.trim().is_empty() {
            return;
        }
        if let Some(cmd) = parse_slash_command(&text) {
            self.clear_editor();
            match cmd {
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
            }
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
                        self.pending_prompt = Some(text.trim().to_string());
                        self.chat.begin_assistant_stream();
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

fn main() -> io::Result<()> {
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

    if let Some(mut bridge) = app.bridge.take() {
        let _ = bridge.stop();
    }

    result
}

fn run(terminal: &mut Terminal<CrosstermBackend<io::Stdout>>, app: &mut ShellApp) -> io::Result<()> {
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
    // The analyst picker owns every key while open — Ctrl+C/Q above still
    // always quits, but nothing else falls through to chat/sidebar/bridge
    // shortcuts until the modal closes (Enter/Esc).
    if app.picker.is_some() {
        return Ok(handle_picker_key(app, key));
    }
    if app.recovery_preview.is_some() {
        return Ok(handle_recovery_key(app, key));
    }
    if try_bridge_shortcut(app, key) {
        return Ok(false);
    }
    if try_team_shortcut(app, key) {
        return Ok(false);
    }
    if try_recovery_shortcut(app, key) {
        return Ok(false);
    }

    match app.chat.focus {
        Focus::Editor => {
            if key.code == KeyCode::Tab {
                app.chat.focus = app.chat.focus.next();
                return Ok(false);
            }
            if key.code == KeyCode::Esc {
                if app.chat.is_streaming {
                    app.abort_stream();
                } else {
                    app.chat.focus = Focus::Sidebar;
                }
                return Ok(false);
            }
            if key.code == KeyCode::Enter && !key.modifiers.contains(KeyModifiers::SHIFT) {
                app.submit_editor();
                return Ok(false);
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
                KeyCode::Esc => app.chat.focus = Focus::Editor,
                KeyCode::Char('q') => return Ok(true),
                KeyCode::Down | KeyCode::Char('j') if sidebar_accepts_selection_keys(app.chat.focus) => {
                    if !app.view.agents.is_empty() {
                        app.view.selected_agent =
                            (app.view.selected_agent + 1) % app.view.agents.len();
                    }
                }
                KeyCode::Up | KeyCode::Char('k') if sidebar_accepts_selection_keys(app.chat.focus) => {
                    if !app.view.agents.is_empty() {
                        app.view.selected_agent = (app.view.selected_agent + app.view.agents.len() - 1)
                            % app.view.agents.len();
                    }
                }
                KeyCode::Char('n') if app.bridge.is_none() => {
                    app.view.notice = Some("Demo notice: engine unavailable (bridge not wired)".into());
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
                    app.view.notice = Some("Demo notice: engine unavailable (bridge not wired)".into());
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
        KeyCode::Char('n') => {
            if let Err(err) = bridge.new_session() {
                app.view.notice = Some(format!("New session failed: {err}"));
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
    render_shell(
        frame.buffer_mut(),
        regions,
        &app.view,
        &app.chat,
        &app.editor,
    );
    if let Some(picker) = &app.picker {
        render_analyst_picker(frame.buffer_mut(), area, picker);
    }
    if let Some(preview) = &app.recovery_preview {
        render_recovery_preview(frame.buffer_mut(), area, preview);
    }
}
