//! U5a: Operations hub state + line layout for the ratatui host.
//!
//! Payload mirrors sidecar `ops_snapshot`: health / fleet / usage / diagnostics.
//! Fail-closed empty states when the bridge has not yet delivered a snapshot.

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph, Widget};

use crate::ops_flow::OpsConfirmState;
use crate::surfaces::tone;

/// Read-only Operations hub lines from the Node sidecar (+ U5b actionable lists).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct OpsPanelState {
    pub loading: bool,
    pub ok: bool,
    pub error: Option<String>,
    pub health: Vec<String>,
    pub fleet: Vec<String>,
    pub usage: Vec<String>,
    pub diagnostics: Vec<String>,
    pub runs: Vec<OpsRunRow>,
    pub alerts: Vec<OpsAlertRow>,
    pub reviews: Vec<OpsReviewRow>,
    pub backups: Vec<String>,
    pub hints: String,
    /// Scroll offset into the flattened body lines.
    pub scroll: usize,
    pub selected_run: usize,
    pub selected_alert: usize,
    pub selected_backup: usize,
    pub confirm: Option<OpsConfirmState>,
    /// When set, ↑↓ moves this list instead of scrolling the body.
    pub pick_mode: OpsPickMode,
    pub selected_review: usize,
    /// U1: read-only run / review detail that replaces the hub body while open.
    pub detail: Option<OpsDetail>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum OpsPickMode {
    #[default]
    None,
    Run,
    Alert,
    Backup,
    /// U1: pick any run (cancellable or not) to open its detail.
    RunDetail,
    /// U1: pick a review receipt to open its detail.
    ReviewDetail,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpsDetailKind {
    Run,
    Review,
}

/// U1: detail view lines for one run or review receipt (read-only).
#[derive(Debug, Clone, PartialEq)]
pub struct OpsDetail {
    pub kind: OpsDetailKind,
    pub id: String,
    pub loading: bool,
    pub ok: bool,
    pub error: Option<String>,
    pub lines: Vec<String>,
    pub scroll: usize,
}

fn str_field<'a>(v: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(|x| x.as_str()).filter(|s| !s.is_empty())
}

impl OpsDetail {
    pub fn loading(kind: OpsDetailKind, id: &str) -> Self {
        let title = match kind {
            OpsDetailKind::Run => "Run detail",
            OpsDetailKind::Review => "Review detail",
        };
        Self {
            kind,
            id: id.to_string(),
            loading: true,
            ok: true,
            error: None,
            lines: vec![format!("{title} · {id}"), "  Loading…".into()],
            scroll: 0,
        }
    }

    pub fn matches(&self, kind: OpsDetailKind, id: &str) -> bool {
        self.kind == kind && self.id == id
    }

    /// Build detail lines from an `ops_run_show` / `ops_review_show` record.
    pub fn from_record(kind: OpsDetailKind, record: &serde_json::Value) -> Self {
        let requested = str_field(record, "requestedId").unwrap_or("?").to_string();
        let ok = record.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
        if !ok {
            let reason = str_field(record, "reason").unwrap_or("error");
            let message = str_field(record, "error").unwrap_or("Detail unavailable.");
            return Self {
                kind,
                id: requested.clone(),
                loading: false,
                ok: false,
                error: Some(message.to_string()),
                lines: vec![
                    format!("Error · {message}"),
                    format!("  reason: {reason}"),
                    format!("  id: {requested}"),
                ],
                scroll: 0,
            };
        }
        let lines = match kind {
            OpsDetailKind::Run => run_detail_lines(record),
            OpsDetailKind::Review => review_detail_lines(record),
        };
        Self {
            kind,
            id: requested,
            loading: false,
            ok: true,
            error: None,
            lines,
            scroll: 0,
        }
    }
}

fn run_detail_lines(record: &serde_json::Value) -> Vec<String> {
    let run = record.get("run").cloned().unwrap_or(serde_json::Value::Null);
    let g = |k: &str| str_field(&run, k);
    let mut out = vec![format!("Run detail · {}", g("runId").unwrap_or("?"))];
    out.push(format!("  State: {}", g("state").unwrap_or("unknown")));
    out.push(format!(
        "  Agent: {} ({}) · model {}",
        g("agentId").unwrap_or("?"),
        g("provider").unwrap_or("?"),
        g("model").unwrap_or("default")
    ));
    if let Some(t) = g("startedAt") {
        out.push(format!("  Started: {t}"));
    }
    if let Some(t) = g("completedAt") {
        out.push(format!("  Completed: {t}"));
    }
    let len = run.get("taskLength").and_then(|v| v.as_u64()).unwrap_or(0);
    out.push(format!(
        "  Task: digest {} ({len} chars, content not stored)",
        g("taskDigest").unwrap_or("unknown")
    ));
    if let Some(e) = g("error") {
        out.push(format!("  Error: {e}"));
    }
    out.push(String::new());
    let events = record
        .get("events")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    out.push(format!("Events ({})", events.len()));
    if record
        .get("eventsTruncated")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        out.push("  … older events omitted".into());
    }
    if events.is_empty() {
        out.push("  (none)".into());
    }
    for ev in &events {
        if ev.get("parseError").and_then(|v| v.as_bool()) == Some(true) {
            let line = ev.get("line").and_then(|v| v.as_u64()).unwrap_or(0);
            out.push(format!("  [parse error line {line}]"));
            continue;
        }
        out.push(format!(
            "  {} {} {}",
            str_field(ev, "timestamp").unwrap_or("-"),
            str_field(ev, "type").unwrap_or("?"),
            str_field(ev, "summary").unwrap_or("")
        ));
    }
    out
}

fn review_detail_lines(record: &serde_json::Value) -> Vec<String> {
    let review = record
        .get("review")
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    let g = |k: &str| str_field(&review, k);
    let mut out = vec![format!("Review detail · {}", g("reviewId").unwrap_or("?"))];
    out.push("  Receipt is read-only; this view grants no approval.".into());
    out.push(format!("  State: {}", g("state").unwrap_or("unknown")));
    out.push(format!(
        "  Agent: {} · model {}",
        g("agentId").unwrap_or("?"),
        g("model").unwrap_or("default")
    ));
    if let Some(t) = g("createdAt") {
        out.push(format!("  Created: {t}"));
    }
    if let Some(snap) = review.get("snapshot") {
        let files = snap.get("fileCount").and_then(|v| v.as_u64()).unwrap_or(0);
        out.push(format!(
            "  Snapshot: {} · {} · {files} file(s)",
            str_field(snap, "mode").unwrap_or("?"),
            str_field(snap, "headSha").unwrap_or("?")
        ));
    }
    out.push(String::new());
    let findings = review
        .get("findings")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    out.push(format!("Findings ({})", findings.len()));
    if findings.is_empty() {
        out.push("  (none)".into());
    }
    for f in &findings {
        let location = match (str_field(f, "path"), f.get("line").and_then(|v| v.as_u64())) {
            (Some(p), Some(l)) => format!(" · {p}:{l}"),
            (Some(p), None) => format!(" · {p}"),
            _ => String::new(),
        };
        out.push(format!(
            "  [{}] {}{location}",
            str_field(f, "severity").unwrap_or("?"),
            str_field(f, "title").unwrap_or("")
        ));
        if let Some(p) = str_field(f, "problem") {
            out.push(format!("      problem: {p}"));
        }
        if let Some(r) = str_field(f, "recommendation") {
            out.push(format!("      fix: {r}"));
        }
    }
    let warnings = review
        .get("warnings")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    if !warnings.is_empty() {
        out.push(String::new());
        out.push(format!("Warnings ({})", warnings.len()));
        for w in warnings.iter().filter_map(|w| w.as_str()) {
            out.push(format!("  {w}"));
        }
    }
    out
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpsRunRow {
    pub run_id: String,
    pub state: String,
    pub agent_id: Option<String>,
    pub cancellable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpsAlertRow {
    pub alert_id: String,
    pub state: String,
    pub title: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpsReviewRow {
    pub review_id: String,
    pub state: String,
}

impl OpsPanelState {
    pub fn loading() -> Self {
        Self {
            loading: true,
            ok: true,
            error: None,
            health: vec!["Loading operations…".into()],
            fleet: Vec::new(),
            usage: Vec::new(),
            diagnostics: Vec::new(),
            runs: Vec::new(),
            alerts: Vec::new(),
            reviews: Vec::new(),
            backups: Vec::new(),
            hints: "Esc → Work".into(),
            scroll: 0,
            selected_run: 0,
            selected_alert: 0,
            selected_backup: 0,
            confirm: None,
            pick_mode: OpsPickMode::None,
            selected_review: 0,
            detail: None,
        }
    }

    pub fn from_ops_record(record: &serde_json::Value) -> Self {
        let lines = |key: &str, fallback: &str| -> Vec<String> {
            record
                .get(key)
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect::<Vec<_>>()
                })
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| vec![fallback.into()])
        };
        let error = record
            .get("error")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        let hints = record
            .get("hints")
            .and_then(|v| v.as_str())
            .unwrap_or(
                "Esc → Work · r refresh · s sync · b rollback · c cancel · d dismiss · Enter run · v review",
            )
            .to_string();
        let runs = record
            .get("runs")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| {
                        let run_id = v.get("runId")?.as_str()?.to_string();
                        Some(OpsRunRow {
                            run_id,
                            state: v
                                .get("state")
                                .and_then(|s| s.as_str())
                                .unwrap_or("unknown")
                                .to_string(),
                            agent_id: v
                                .get("agentId")
                                .and_then(|s| s.as_str())
                                .map(str::to_string),
                            cancellable: v
                                .get("cancellable")
                                .and_then(|b| b.as_bool())
                                .unwrap_or(false),
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let alerts = record
            .get("alerts")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| {
                        let alert_id = v.get("alertId")?.as_str()?.to_string();
                        Some(OpsAlertRow {
                            alert_id,
                            state: v
                                .get("state")
                                .and_then(|s| s.as_str())
                                .unwrap_or("open")
                                .to_string(),
                            title: v
                                .get("title")
                                .and_then(|s| s.as_str())
                                .map(str::to_string),
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let reviews = record
            .get("reviews")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| {
                        let review_id = v.get("reviewId")?.as_str()?.to_string();
                        Some(OpsReviewRow {
                            review_id,
                            state: v
                                .get("state")
                                .and_then(|s| s.as_str())
                                .unwrap_or("unknown")
                                .to_string(),
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let backups = record
            .get("backups")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| {
                        if let Some(s) = v.as_str() {
                            return Some(s.to_string());
                        }
                        v.get("name")
                            .and_then(|n| n.as_str())
                            .map(str::to_string)
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        Self {
            loading: false,
            ok: record.get("ok").and_then(|v| v.as_bool()).unwrap_or(true),
            error,
            health: lines("health", "Health unavailable."),
            fleet: lines("fleet", "Fleet unavailable."),
            usage: lines("usage", "Usage unavailable."),
            diagnostics: lines("diagnostics", "Diagnostics unavailable."),
            runs,
            alerts,
            reviews,
            backups,
            hints,
            scroll: 0,
            selected_run: 0,
            selected_alert: 0,
            selected_backup: 0,
            confirm: None,
            pick_mode: OpsPickMode::None,
            selected_review: 0,
            detail: None,
        }
    }

    /// Flatten sections with headings for the scrollable body.
    pub fn body_lines(&self) -> Vec<String> {
        if let Some(detail) = &self.detail {
            return detail.lines.clone();
        }
        let mut out = Vec::new();
        if let Some(err) = &self.error {
            out.push(format!("Error · {err}"));
            out.push(String::new());
        }
        push_section(&mut out, "Health", &self.health);
        push_section(&mut out, "Providers / fleet", &self.fleet);
        push_section(&mut out, "Usage", &self.usage);
        push_section(&mut out, "Diagnostics", &self.diagnostics);

        out.push(String::new());
        out.push("Runs".into());
        if self.runs.is_empty() {
            out.push("  (none)".into());
        } else {
            for (i, run) in self.runs.iter().enumerate() {
                let picking = matches!(self.pick_mode, OpsPickMode::Run | OpsPickMode::RunDetail);
                let mark = if picking && i == self.selected_run {
                    "›"
                } else {
                    " "
                };
                let agent = run.agent_id.as_deref().unwrap_or("?");
                let cancel = if run.cancellable { " · cancellable" } else { "" };
                out.push(format!(
                    "{mark} {} · {} · {}{cancel}",
                    run.run_id, run.state, agent
                ));
            }
        }

        out.push(String::new());
        out.push("Alerts".into());
        if self.alerts.is_empty() {
            out.push("  (none)".into());
        } else {
            for (i, alert) in self.alerts.iter().enumerate() {
                let mark = if self.pick_mode == OpsPickMode::Alert && i == self.selected_alert {
                    "›"
                } else {
                    " "
                };
                let title = alert.title.as_deref().unwrap_or("");
                out.push(format!(
                    "{mark} {} · {} · {title}",
                    alert.alert_id, alert.state
                ));
            }
        }

        out.push(String::new());
        out.push("Reviews (read-only)".into());
        if self.reviews.is_empty() {
            out.push("  (none)".into());
        } else {
            for (i, review) in self.reviews.iter().enumerate() {
                let mark = if self.pick_mode == OpsPickMode::ReviewDetail
                    && i == self.selected_review
                {
                    "›"
                } else {
                    " "
                };
                out.push(format!("{mark} {} · {}", review.review_id, review.state));
            }
        }

        out.push(String::new());
        out.push("Backups".into());
        if self.backups.is_empty() {
            out.push("  (none)".into());
        } else {
            for (i, name) in self.backups.iter().enumerate() {
                let mark = if self.pick_mode == OpsPickMode::Backup && i == self.selected_backup {
                    "›"
                } else {
                    " "
                };
                out.push(format!("{mark} {name}"));
            }
        }
        out
    }

    pub fn footer_hints(&self) -> &str {
        if self.confirm.is_some() {
            return "y confirm · n/Esc cancel";
        }
        if self.detail.is_some() {
            return "↑↓ scroll · Esc back";
        }
        match self.pick_mode {
            OpsPickMode::RunDetail => "↑↓ select run · Enter open detail · Esc clear",
            OpsPickMode::ReviewDetail => "↑↓ select review · Enter open detail · Esc clear",
            OpsPickMode::Run => "↑↓ select run · Enter confirm cancel · Esc clear",
            OpsPickMode::Alert => "↑↓ select alert · Enter confirm dismiss · Esc clear",
            OpsPickMode::Backup => "↑↓ select backup · Enter preview rollback · Esc clear",
            OpsPickMode::None => {
                if self.hints.is_empty() {
                    "Esc → Work · r refresh"
                } else {
                    &self.hints
                }
            }
        }
    }

    /// Scroll offset in effect: the detail's own while a detail is open.
    pub fn effective_scroll(&self) -> usize {
        self.detail.as_ref().map_or(self.scroll, |d| d.scroll)
    }

    pub fn scroll_by(&mut self, delta: isize, viewport_rows: usize) {
        if let Some(detail) = self.detail.as_mut() {
            let max_scroll = detail.lines.len().saturating_sub(viewport_rows.max(1));
            let next = detail.scroll as isize + delta;
            detail.scroll = next.clamp(0, max_scroll as isize) as usize;
            return;
        }
        match self.pick_mode {
            OpsPickMode::RunDetail if !self.runs.is_empty() => {
                let len = self.runs.len() as isize;
                let next = self.selected_run as isize + delta;
                self.selected_run = next.rem_euclid(len) as usize;
            }
            OpsPickMode::ReviewDetail if !self.reviews.is_empty() => {
                let len = self.reviews.len() as isize;
                let next = self.selected_review as isize + delta;
                self.selected_review = next.rem_euclid(len) as usize;
            }
            OpsPickMode::Run if !self.runs.is_empty() => {
                let len = self.runs.len() as isize;
                let next = self.selected_run as isize + delta;
                self.selected_run = next.rem_euclid(len) as usize;
            }
            OpsPickMode::Alert if !self.alerts.is_empty() => {
                let len = self.alerts.len() as isize;
                let next = self.selected_alert as isize + delta;
                self.selected_alert = next.rem_euclid(len) as usize;
            }
            OpsPickMode::Backup if !self.backups.is_empty() => {
                let len = self.backups.len() as isize;
                let next = self.selected_backup as isize + delta;
                self.selected_backup = next.rem_euclid(len) as usize;
            }
            _ => {
                let total = self.body_lines().len();
                if total == 0 {
                    self.scroll = 0;
                    return;
                }
                let max_scroll = total.saturating_sub(viewport_rows.max(1));
                let next = self.scroll as isize + delta;
                self.scroll = next.clamp(0, max_scroll as isize) as usize;
            }
        }
    }

    pub fn selected_cancellable_run_id(&self) -> Option<&str> {
        self.runs
            .get(self.selected_run)
            .filter(|r| r.cancellable)
            .map(|r| r.run_id.as_str())
    }

    pub fn selected_run_id(&self) -> Option<&str> {
        self.runs.get(self.selected_run).map(|r| r.run_id.as_str())
    }

    pub fn selected_review_id(&self) -> Option<&str> {
        self.reviews
            .get(self.selected_review)
            .map(|r| r.review_id.as_str())
    }

    pub fn selected_alert_id(&self) -> Option<&str> {
        self.alerts
            .get(self.selected_alert)
            .map(|a| a.alert_id.as_str())
    }

    pub fn selected_backup_name(&self) -> Option<&str> {
        self.backups.get(self.selected_backup).map(String::as_str)
    }
}

fn push_section(out: &mut Vec<String>, title: &str, lines: &[String]) {
    if !out.is_empty() {
        out.push(String::new());
    }
    out.push(title.to_string());
    if lines.is_empty() {
        out.push("  (empty)".into());
    } else {
        for line in lines {
            out.push(format!("  {line}"));
        }
    }
}

/// Wrap panel body text to `width` without a line cap (unlike footer hints).
pub fn wrap_panel_body_line(text: &str, width: usize) -> Vec<String> {
    let width = width.max(1);
    if text.is_empty() {
        return vec![String::new()];
    }
    if text.chars().count() <= width {
        return vec![text.to_string()];
    }
    let mut out: Vec<String> = Vec::new();
    let mut current = String::new();
    for word in text.split_whitespace() {
        let candidate = if current.is_empty() {
            word.to_string()
        } else {
            format!("{current} {word}")
        };
        if candidate.chars().count() > width && !current.is_empty() {
            out.push(std::mem::take(&mut current));
            if word.chars().count() > width {
                let mut chunk = String::new();
                for ch in word.chars() {
                    if chunk.chars().count() >= width {
                        out.push(std::mem::take(&mut chunk));
                    }
                    chunk.push(ch);
                }
                current = chunk;
            } else {
                current = word.to_string();
            }
        } else if word.chars().count() > width && current.is_empty() {
            let mut chunk = String::new();
            for ch in word.chars() {
                if chunk.chars().count() >= width {
                    out.push(std::mem::take(&mut chunk));
                }
                chunk.push(ch);
            }
            current = chunk;
        } else {
            current = candidate;
        }
    }
    if !current.is_empty() {
        out.push(current);
    }
    if out.is_empty() {
        out.push(String::new());
    }
    out
}

/// Wrap action hints on ` · ` (≤2 lines) so Esc/refresh stay visible at 60 cols.
pub fn wrap_ops_hint_lines(hints: &str, width: usize) -> Vec<String> {
    let width = width.max(1);
    let mut lines: Vec<String> = Vec::new();
    let mut current = String::new();
    for part in hints.split(" · ") {
        let candidate = if current.is_empty() {
            part.to_string()
        } else {
            format!("{current} · {part}")
        };
        if candidate.chars().count() > width && !current.is_empty() {
            lines.push(std::mem::take(&mut current));
            current = part.to_string();
        } else {
            current = candidate;
        }
    }
    if !current.is_empty() || lines.is_empty() {
        lines.push(current);
    }
    // Cap at two lines; character-wrap only when a single token exceeds width.
    let mut out: Vec<String> = Vec::new();
    for line in lines {
        if out.len() >= 2 {
            break;
        }
        if line.chars().count() <= width {
            out.push(line);
        } else {
            let mut chunk = String::new();
            for ch in line.chars() {
                if chunk.chars().count() >= width {
                    if out.len() >= 2 {
                        break;
                    }
                    out.push(std::mem::take(&mut chunk));
                }
                chunk.push(ch);
            }
            if !chunk.is_empty() && out.len() < 2 {
                out.push(chunk);
            }
        }
    }
    if out.is_empty() {
        out.push(String::new());
    }
    out.truncate(2);
    out
}

fn padded_span(text: &str, width: u16, style: Style) -> Line<'static> {
    let w = width as usize;
    let mut s = text.to_string();
    let len = s.chars().count();
    if len < w {
        s.push_str(&" ".repeat(w - len));
    } else if len > w {
        s = s.chars().take(w).collect();
    }
    Line::from(Span::styled(s, style))
}

/// Paint the Operations hub into the work column.
pub fn render_ops_panel(buf: &mut Buffer, area: Rect, state: &OpsPanelState, chrome_title: &str) {
    if area.width == 0 || area.height == 0 {
        return;
    }
    let hints = state.footer_hints();
    let inner_w = area.width.saturating_sub(2).max(1) as usize;
    let footer_preview = wrap_ops_hint_lines(hints, inner_w);
    let footer_rows = footer_preview.len().min(2).max(1) as u16;

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(tone::BORDER))
        .style(Style::default().bg(tone::WORK_BG))
        .title(Span::styled(
            chrome_title.to_string(),
            Style::default()
                .fg(tone::ACCENT)
                .add_modifier(Modifier::BOLD),
        ));
    let inner = block.inner(area);
    block.render(area, buf);
    if inner.width == 0 || inner.height == 0 {
        return;
    }

    let body_budget = inner.height.saturating_sub(footer_rows).max(1) as usize;
    let body = state.body_lines();
    let start = state.effective_scroll().min(body.len().saturating_sub(1).max(0));
    let visible = body.iter().skip(start).take(body_budget);

    let mut lines: Vec<Line> = Vec::new();
    for (i, text) in visible.enumerate() {
        let is_heading = matches!(
            text.as_str(),
            "Health"
                | "Providers / fleet"
                | "Usage"
                | "Diagnostics"
                | "Runs"
                | "Alerts"
                | "Reviews (read-only)"
                | "Backups"
        ) || text.starts_with("Error ·")
            || text.starts_with("Run detail ·")
            || text.starts_with("Review detail ·")
            || text.starts_with("Events (")
            || text.starts_with("Findings (")
            || text.starts_with("Warnings (");
        let style = if is_heading {
            Style::default()
                .fg(tone::TEXT)
                .add_modifier(Modifier::BOLD)
                .bg(tone::WORK_BG)
        } else {
            Style::default().fg(tone::TEXT).bg(tone::WORK_BG)
        };
        let _ = i;
        lines.push(padded_span(text, inner.width, style));
    }
    while lines.len() < body_budget {
        lines.push(padded_span("", inner.width, Style::default().bg(tone::WORK_BG)));
    }

    let footer = wrap_ops_hint_lines(hints, inner.width as usize);
    for hint_line in footer.iter().take(2) {
        lines.push(padded_span(
            hint_line,
            inner.width,
            Style::default().fg(tone::MUTED).bg(tone::WORK_BG),
        ));
    }

    Paragraph::new(lines)
        .style(Style::default().bg(tone::WORK_BG))
        .render(inner, buf);

    if let Some(confirm) = &state.confirm {
        render_ops_confirm(buf, area, confirm);
    }
}

fn render_ops_confirm(buf: &mut Buffer, area: Rect, confirm: &OpsConfirmState) {
    use ratatui::widgets::Clear;
    let width = area.width.saturating_sub(6).clamp(40, 76);
    let rows = confirm.prompt_lines().len() as u16;
    let height = rows
        .saturating_add(2)
        .min(area.height.saturating_sub(2).max(6));
    let x = area.x + area.width.saturating_sub(width) / 2;
    let y = area.y + area.height.saturating_sub(height) / 2;
    let popup = Rect {
        x,
        y,
        width,
        height,
    };
    if popup.width == 0 || popup.height == 0 {
        return;
    }
    Clear.render(popup, buf);
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(tone::BORDER_FOCUS))
        .style(Style::default().bg(tone::SIDEBAR_BG))
        .title(Span::styled(
            confirm.title.clone(),
            Style::default()
                .fg(tone::ACCENT)
                .add_modifier(Modifier::BOLD),
        ));
    let inner = block.inner(popup);
    block.render(popup, buf);
    let mut lines: Vec<Line> = Vec::new();
    for text in confirm.prompt_lines() {
        lines.push(padded_span(
            &text,
            inner.width,
            Style::default().fg(tone::TEXT).bg(tone::SIDEBAR_BG),
        ));
    }
    Paragraph::new(lines)
        .style(Style::default().bg(tone::SIDEBAR_BG))
        .render(inner, buf);
}

/// Paint Settings stub (U5a chrome only — full Settings is U5b).
#[deprecated(note = "use settings_panel::render_settings_panel")]
pub fn render_settings_stub(buf: &mut Buffer, area: Rect, chrome_title: &str) {
    if area.width == 0 || area.height == 0 {
        return;
    }
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(tone::BORDER))
        .style(Style::default().bg(tone::WORK_BG))
        .title(Span::styled(
            chrome_title.to_string(),
            Style::default()
                .fg(tone::ACCENT)
                .add_modifier(Modifier::BOLD),
        ));
    let inner = block.inner(area);
    block.render(area, buf);
    if inner.width == 0 || inner.height == 0 {
        return;
    }
    let lines = vec![
        padded_span(
            "Settings",
            inner.width,
            Style::default()
                .fg(tone::TEXT)
                .add_modifier(Modifier::BOLD)
                .bg(tone::WORK_BG),
        ),
        padded_span(
            "Esc → Work",
            inner.width,
            Style::default().fg(tone::MUTED).bg(tone::WORK_BG),
        ),
    ];
    Paragraph::new(lines)
        .style(Style::default().bg(tone::WORK_BG))
        .render(inner, buf);
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::buffer::Buffer;
    use ratatui::layout::Rect;
    use serde_json::json;

    #[test]
    fn from_ops_record_maps_sections_and_honest_fleet_title() {
        let state = OpsPanelState::from_ops_record(&json!({
            "ok": true,
            "health": ["Control plane · HEALTHY"],
            "fleet": ["Fleet topology (kairo fleet) — not slash /providers", "Fleet floor"],
            "usage": ["MEASURED"],
            "diagnostics": ["Agents"],
            "hints": "Esc → Work · r refresh"
        }));
        assert!(state.ok);
        assert!(!state.loading);
        assert_eq!(state.health[0], "Control plane · HEALTHY");
        assert!(state.fleet[0].contains("kairo fleet"));
        assert!(!state.fleet[0].starts_with("/providers"));
        let body = state.body_lines().join("\n");
        assert!(body.contains("Providers / fleet"));
        assert!(body.contains("Diagnostics"));
    }

    #[test]
    fn from_ops_record_fail_closed_on_empty_payload() {
        let state = OpsPanelState::from_ops_record(&json!({ "ok": false, "error": "scan down" }));
        assert!(!state.ok);
        assert_eq!(state.error.as_deref(), Some("scan down"));
        assert!(state.health[0].contains("unavailable"));
        assert!(state.fleet[0].contains("unavailable"));
    }

    #[test]
    fn wrap_ops_hint_lines_keeps_esc_visible_at_60_cols() {
        let hints = "Esc → Work · r refresh · ↑↓ scroll";
        let lines = wrap_ops_hint_lines(hints, 60);
        assert!(lines.len() <= 2);
        let joined = lines.join(" ");
        assert!(joined.contains("Esc"));
        assert!(joined.contains("refresh") || joined.contains("scroll"));
    }

    #[test]
    fn wrap_ops_hint_lines_splits_on_narrow_width() {
        let hints = "Esc → Work · r refresh";
        let lines = wrap_ops_hint_lines(hints, 12);
        assert!(lines.len() <= 2);
        assert!(lines.iter().any(|l| l.contains("Esc")));
    }

    #[test]
    fn render_ops_panel_shows_sections_and_footer_at_60_cols() {
        let state = OpsPanelState::from_ops_record(&json!({
            "ok": true,
            "health": ["Control plane · HEALTHY"],
            "fleet": ["Fleet topology (kairo fleet) — not slash /providers"],
            "usage": ["Data unavailable"],
            "diagnostics": ["Agents", "Detected: 0/0"],
            "hints": "Esc → Work · r refresh"
        }));
        let area = Rect::new(0, 0, 60, 20);
        let mut buf = Buffer::empty(area);
        render_ops_panel(&mut buf, area, &state, " 1 Work · … · 5 Ops  · Operations ");
        let mut text = String::new();
        for y in 0..area.height {
            for x in 0..area.width {
                text.push_str(buf[(x, y)].symbol());
            }
            text.push('\n');
        }
        assert!(text.contains("Operations") || text.contains("Ops"));
        assert!(text.contains("Health") || text.contains("HEALTHY"));
        assert!(text.contains("Esc"));
        assert!(text.contains("fleet") || text.contains("Fleet") || text.contains("Providers"));
    }

    fn run_record() -> serde_json::Value {
        json!({
            "type": "ops_run_show",
            "ok": true,
            "requestedId": "run_a",
            "run": {
                "runId": "run_a", "state": "completed", "agentId": "cursor",
                "provider": "cursor", "model": null,
                "startedAt": "2026-01-01T00:00:00Z", "completedAt": "2026-01-01T00:01:00Z",
                "taskDigest": "abcd1234abcd1234", "taskLength": 42, "error": null
            },
            "events": [
                { "timestamp": "t1", "type": "process.stdout", "summary": "hello" },
                { "parseError": true, "line": 4, "message": "bad json" }
            ],
            "eventsTruncated": true
        })
    }

    #[test]
    fn run_detail_maps_state_digest_and_events() {
        let d = OpsDetail::from_record(OpsDetailKind::Run, &run_record());
        assert!(d.ok && !d.loading && d.error.is_none());
        let text = d.lines.join("\n");
        assert!(text.contains("State: completed"), "{text}");
        assert!(text.contains("abcd1234abcd1234") && text.contains("42 chars"), "{text}");
        assert!(text.contains("process.stdout") && text.contains("hello"), "{text}");
        assert!(text.contains("parse error") && text.contains("line 4"), "{text}");
        assert!(text.contains("older events omitted"), "{text}");
    }

    #[test]
    fn detail_error_record_is_honest_and_not_an_empty_success() {
        let d = OpsDetail::from_record(
            OpsDetailKind::Run,
            &json!({ "type": "ops_run_show", "ok": false, "reason": "not_found",
                     "error": "Run \"run_x\" not found.", "requestedId": "run_x" }),
        );
        assert!(!d.ok);
        assert_eq!(d.id, "run_x");
        let text = d.lines.join("\n");
        assert!(text.contains("not found"), "{text}");
        assert!(text.contains("not_found"), "{text}");
    }

    #[test]
    fn review_detail_maps_findings_and_is_read_only() {
        let d = OpsDetail::from_record(
            OpsDetailKind::Review,
            &json!({ "type": "ops_review_show", "ok": true, "requestedId": "rev-1",
                "review": { "reviewId": "rev-1", "state": "completed", "agentId": "codex",
                  "createdAt": "2026-01-01", "readOnly": true,
                  "snapshot": { "mode": "staged", "headSha": "abc", "fileCount": 2 },
                  "findings": [ { "severity": "high", "title": "Bad thing", "path": "a.js",
                                  "line": 3, "problem": "P", "recommendation": "R" } ],
                  "warnings": ["w1"] } }),
        );
        let text = d.lines.join("\n");
        assert!(text.contains("read-only"), "{text}");
        assert!(text.contains("[high] Bad thing") && text.contains("a.js:3"), "{text}");
        assert!(text.contains("w1") && text.contains("2 file"), "{text}");
        assert!(!text.to_lowercase().contains("approved"), "{text}");
    }

    #[test]
    fn pick_modes_select_any_run_and_review_for_detail() {
        let mut s = OpsPanelState::from_ops_record(&json!({
            "runs": [ { "runId": "r1", "state": "done" }, { "runId": "r2", "state": "failed" } ],
            "reviews": [ { "reviewId": "rev-a", "state": "completed" },
                         { "reviewId": "rev-b", "state": "failed" } ]
        }));
        s.pick_mode = OpsPickMode::RunDetail;
        s.scroll_by(1, 12);
        assert_eq!(s.selected_run_id(), Some("r2"));
        s.pick_mode = OpsPickMode::ReviewDetail;
        s.scroll_by(1, 12);
        assert_eq!(s.selected_review_id(), Some("rev-b"));
        assert!(s.body_lines().iter().any(|l| l.starts_with("› rev-b")));
        assert!(s.footer_hints().contains("Enter"));
    }

    #[test]
    fn render_detail_replaces_hub_body_and_scrolls_with_back_hint() {
        let mut s = OpsPanelState::from_ops_record(&json!({ "runs": [ { "runId": "run_a", "state": "x" } ] }));
        s.detail = Some(OpsDetail::from_record(OpsDetailKind::Run, &run_record()));
        assert!(s.footer_hints().contains("Esc"));
        let body = s.body_lines().join("\n");
        assert!(body.contains("Run detail") && !body.contains("Providers / fleet"), "{body}");
        let area = Rect::new(0, 0, 70, 20);
        let mut buf = Buffer::empty(area);
        render_ops_panel(&mut buf, area, &s, " Operations ");
        let mut text = String::new();
        for y in 0..area.height {
            for x in 0..area.width {
                text.push_str(buf[(x, y)].symbol());
            }
            text.push('\n');
        }
        assert!(text.contains("Run detail") && text.contains("abcd1234abcd1234"), "{text}");
    }

    #[test]
    fn detail_loading_state_shows_loading_line() {
        let d = OpsDetail::loading(OpsDetailKind::Review, "rev-1");
        assert!(d.loading);
        assert!(d.lines.join(" ").contains("Loading"));
        assert!(d.matches(OpsDetailKind::Review, "rev-1"));
        assert!(!d.matches(OpsDetailKind::Run, "rev-1"));
    }
}
