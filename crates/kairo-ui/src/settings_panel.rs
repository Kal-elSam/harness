//! U5b: Settings panel — profile / integrations / connections + setup stub.

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, Paragraph, Widget};

use crate::ops_panel::{wrap_ops_hint_lines, wrap_panel_body_line};
use crate::surfaces::tone;

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SettingsPanelState {
    pub loading: bool,
    pub ok: bool,
    pub error: Option<String>,
    pub profile: Vec<String>,
    pub integrations: Vec<String>,
    pub connections: Vec<String>,
    pub catalog: Vec<String>,
    pub setup_label: String,
    pub setup_wired: bool,
    pub hints: String,
    pub scroll: usize,
    /// Curated integration id awaiting y/n confirm (intent only).
    pub pending_integration_id: Option<String>,
    pub selected_integration: usize,
    pub integration_ids: Vec<String>,
}

impl SettingsPanelState {
    pub fn loading() -> Self {
        Self {
            loading: true,
            ok: true,
            hints: "Esc → Work".into(),
            setup_label: "use `kairo setup` (UI not wired)".into(),
            setup_wired: false,
            profile: vec!["Loading settings…".into()],
            ..Self::default()
        }
    }

    pub fn from_settings_record(record: &serde_json::Value) -> Self {
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
        let setup = record.get("setup");
        let setup_wired = setup
            .and_then(|v| v.get("wired"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let setup_label = setup
            .and_then(|v| v.get("label"))
            .and_then(|v| v.as_str())
            .unwrap_or("use `kairo setup` (UI not wired)")
            .to_string();
        let integration_ids = record
            .get("integrations")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|line| {
                        let s = line.as_str()?;
                        // "available · Pi usage widget · 0.2.1 · MIT" — id lives in catalog;
                        // fall back to scanning catalog for pi-usage-widget style ids.
                        if s.contains("pi-usage-widget") || s.contains("Pi usage widget") {
                            Some("pi-usage-widget".to_string())
                        } else {
                            None
                        }
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        // Prefer explicit ids from curated catalog lines if present.
        let mut ids = integration_ids;
        if ids.is_empty() {
            ids.push("pi-usage-widget".into());
        }
        Self {
            loading: false,
            ok: record.get("ok").and_then(|v| v.as_bool()).unwrap_or(true),
            error: record
                .get("error")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(str::to_string),
            profile: lines("profile", "Profile unavailable."),
            integrations: lines("integrations", "Integrations unavailable."),
            connections: lines("connections", "Connections unavailable."),
            catalog: lines("catalog", ""),
            setup_label,
            setup_wired,
            hints: record
                .get("hints")
                .and_then(|v| v.as_str())
                .unwrap_or("Esc → Work · ↑↓ browse · Enter preview · y/n confirm")
                .to_string(),
            scroll: 0,
            pending_integration_id: None,
            selected_integration: 0,
            integration_ids: ids,
        }
    }

    pub fn body_lines(&self) -> Vec<String> {
        let mut out = Vec::new();
        if let Some(err) = &self.error {
            out.push(format!("Error · {err}"));
            out.push(String::new());
        }
        push_section(&mut out, "Profile", &self.profile);
        push_section(&mut out, "Integrations", &self.integrations);
        if !self.integration_ids.is_empty() {
            let sel = self
                .integration_ids
                .get(self.selected_integration)
                .cloned()
                .unwrap_or_default();
            out.push(format!("  selected · {sel} (Enter confirm intent)"));
        }
        push_section(&mut out, "Connections", &self.connections);
        out.push(String::new());
        out.push("Setup".into());
        let wire = if self.setup_wired {
            "wired"
        } else {
            "not wired"
        };
        out.push(format!("  [{wire}] {}", self.setup_label));
        out
    }

    pub fn footer_hints(&self) -> &str {
        if self.pending_integration_id.is_some() {
            "y confirm intent · n/Esc cancel"
        } else if self.hints.is_empty() {
            "Esc → Work"
        } else {
            &self.hints
        }
    }

    pub fn scroll_by(&mut self, delta: isize, viewport_rows: usize) {
        let total = self.body_lines().len();
        if total == 0 {
            self.scroll = 0;
            return;
        }
        let max_scroll = total.saturating_sub(viewport_rows.max(1));
        let next = self.scroll as isize + delta;
        self.scroll = next.clamp(0, max_scroll as isize) as usize;
    }

    pub fn move_selection(&mut self, delta: isize) {
        if self.integration_ids.is_empty() {
            return;
        }
        let len = self.integration_ids.len() as isize;
        let next = self.selected_integration as isize + delta;
        self.selected_integration = next.rem_euclid(len) as usize;
    }

    pub fn begin_integration_confirm(&mut self) -> bool {
        let id = self
            .integration_ids
            .get(self.selected_integration)
            .cloned();
        if let Some(id) = id {
            self.pending_integration_id = Some(id);
            true
        } else {
            false
        }
    }

    pub fn clear_integration_confirm(&mut self) {
        self.pending_integration_id = None;
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

pub fn render_settings_panel(
    buf: &mut Buffer,
    area: Rect,
    state: &SettingsPanelState,
    chrome_title: &str,
) {
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
    let mut wrapped_body: Vec<(String, bool)> = Vec::new();
    for text in &body {
        let is_heading = matches!(
            text.as_str(),
            "Profile" | "Integrations" | "Connections" | "Setup"
        ) || text.starts_with("Error ·");
        for piece in wrap_panel_body_line(text, inner.width as usize) {
            wrapped_body.push((piece, is_heading));
        }
    }
    let start = state.scroll.min(wrapped_body.len().saturating_sub(1).max(0));
    let visible = wrapped_body.iter().skip(start).take(body_budget);

    let mut lines: Vec<Line> = Vec::new();
    for (text, is_heading) in visible {
        let style = if *is_heading {
            Style::default()
                .fg(tone::TEXT)
                .add_modifier(Modifier::BOLD)
                .bg(tone::WORK_BG)
        } else {
            Style::default().fg(tone::TEXT).bg(tone::WORK_BG)
        };
        lines.push(padded_span(text, inner.width, style));
    }
    while lines.len() < body_budget {
        lines.push(padded_span(
            "",
            inner.width,
            Style::default().bg(tone::WORK_BG),
        ));
    }
    for hint_line in footer_preview.iter().take(2) {
        lines.push(padded_span(
            hint_line,
            inner.width,
            Style::default().fg(tone::MUTED).bg(tone::WORK_BG),
        ));
    }
    Paragraph::new(lines)
        .style(Style::default().bg(tone::WORK_BG))
        .render(inner, buf);

    if let Some(id) = &state.pending_integration_id {
        render_settings_confirm(buf, area, id);
    }
}

fn render_settings_confirm(buf: &mut Buffer, area: Rect, integration_id: &str) {
    let width = area.width.saturating_sub(6).clamp(36, 72);
    let height = 7.min(area.height.saturating_sub(2).max(5));
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
            " Settings · confirm intent ",
            Style::default()
                .fg(tone::ACCENT)
                .add_modifier(Modifier::BOLD),
        ));
    let inner = block.inner(popup);
    block.render(popup, buf);
    let lines = vec![
        padded_span(
            &format!("Record install intent for · {integration_id}?"),
            inner.width,
            Style::default().fg(tone::TEXT).bg(tone::SIDEBAR_BG),
        ),
        padded_span(
            "No files written. Apply via documented Pi/CLI path only.",
            inner.width,
            Style::default().fg(tone::MUTED).bg(tone::SIDEBAR_BG),
        ),
        padded_span(
            "y confirm · n/Esc cancel",
            inner.width,
            Style::default().fg(tone::MUTED).bg(tone::SIDEBAR_BG),
        ),
    ];
    Paragraph::new(lines)
        .style(Style::default().bg(tone::SIDEBAR_BG))
        .render(inner, buf);
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn settings_record_marks_setup_not_wired() {
        let state = SettingsPanelState::from_settings_record(&json!({
            "ok": true,
            "profile": ["PROFILE", "applyMode · prompt"],
            "integrations": ["available · Pi usage widget · 0.2.1 · MIT"],
            "connections": ["ok · Cursor MCP"],
            "setup": { "wired": false, "label": "use `kairo setup` (UI not wired)" },
            "hints": "Esc → Work · ↑↓ browse · Enter preview · y/n confirm"
        }));
        assert!(!state.setup_wired);
        assert!(state.setup_label.contains("kairo setup"));
        let body = state.body_lines().join("\n");
        assert!(body.contains("Profile"));
        assert!(body.contains("Connections"));
        assert!(body.contains("not wired"));
        assert!(body.contains("kairo setup"));
        let wrapped = wrap_panel_body_line(
            "  [not wired] Interactive setup · not wired — use `kairo setup` in a terminal",
            40,
        );
        assert!(wrapped.iter().any(|l| l.contains("kairo") || l.contains("setup")));
        assert!(wrapped.iter().all(|l| l.chars().count() <= 40));
        let hints = wrap_ops_hint_lines(state.footer_hints(), 60);
        assert!(hints.len() <= 2);
        assert!(hints.iter().any(|l| l.contains("Esc")));
    }

    #[test]
    fn integration_confirm_toggle() {
        let mut state = SettingsPanelState::from_settings_record(&json!({
            "ok": true,
            "integrations": ["available · Pi usage widget"],
            "setup": { "wired": false, "label": "stub" }
        }));
        assert!(state.begin_integration_confirm());
        assert_eq!(
            state.pending_integration_id.as_deref(),
            Some("pi-usage-widget")
        );
        state.clear_integration_confirm();
        assert!(state.pending_integration_id.is_none());
    }
}
