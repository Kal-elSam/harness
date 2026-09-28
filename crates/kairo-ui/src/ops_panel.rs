//! U5a: Operations hub state + line layout for the ratatui host.
//!
//! Payload mirrors sidecar `ops_snapshot`: health / fleet / usage / diagnostics.
//! Fail-closed empty states when the bridge has not yet delivered a snapshot.

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph, Widget};

use crate::surfaces::tone;

/// Read-only Operations hub lines from the Node sidecar.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct OpsPanelState {
    pub loading: bool,
    pub ok: bool,
    pub error: Option<String>,
    pub health: Vec<String>,
    pub fleet: Vec<String>,
    pub usage: Vec<String>,
    pub diagnostics: Vec<String>,
    pub hints: String,
    /// Scroll offset into the flattened body lines.
    pub scroll: usize,
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
            hints: "Esc → Work".into(),
            scroll: 0,
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
            .unwrap_or("Esc → Work · r refresh")
            .to_string();
        Self {
            loading: false,
            ok: record.get("ok").and_then(|v| v.as_bool()).unwrap_or(true),
            error,
            health: lines("health", "Health unavailable."),
            fleet: lines("fleet", "Fleet unavailable."),
            usage: lines("usage", "Usage unavailable."),
            diagnostics: lines("diagnostics", "Diagnostics unavailable."),
            hints,
            scroll: 0,
        }
    }

    /// Flatten sections with headings for the scrollable body.
    pub fn body_lines(&self) -> Vec<String> {
        let mut out = Vec::new();
        if let Some(err) = &self.error {
            out.push(format!("Error · {err}"));
            out.push(String::new());
        }
        push_section(&mut out, "Health", &self.health);
        push_section(&mut out, "Providers / fleet", &self.fleet);
        push_section(&mut out, "Usage", &self.usage);
        push_section(&mut out, "Diagnostics", &self.diagnostics);
        out
    }

    pub fn footer_hints(&self) -> &str {
        if self.hints.is_empty() {
            "Esc → Work · r refresh"
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
    let start = state.scroll.min(body.len().saturating_sub(1).max(0));
    let visible = body.iter().skip(start).take(body_budget);

    let mut lines: Vec<Line> = Vec::new();
    for (i, text) in visible.enumerate() {
        let is_heading = matches!(
            text.as_str(),
            "Health" | "Providers / fleet" | "Usage" | "Diagnostics"
        ) || text.starts_with("Error ·");
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
}

/// Paint Settings stub (U5a chrome only — full Settings is U5b).
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
            "Settings — U5b",
            inner.width,
            Style::default()
                .fg(tone::TEXT)
                .add_modifier(Modifier::BOLD)
                .bg(tone::WORK_BG),
        ),
        padded_span(
            "Profile edits, integrations, and interactive setup land in U5b.",
            inner.width,
            Style::default().fg(tone::MUTED).bg(tone::WORK_BG),
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
}
