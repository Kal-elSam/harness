//! Painted shell surfaces — product chrome, not bare text on black.
//!
//! V1: native ratatui widgets for sidebar / work / USAGE with contrast,
//! borders, and spacing. Data is still placeholder until R5 wires snapshot.

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, List, ListItem, Paragraph, Widget};

use crate::layout::ShellRegions;

/// Kairo surface palette (session-local identity — not a Herdr clone).
pub mod tone {
    use ratatui::style::Color;

    pub const SIDEBAR_BG: Color = Color::Rgb(24, 24, 32);
    pub const WORK_BG: Color = Color::Rgb(12, 12, 16);
    pub const USAGE_BG: Color = Color::Rgb(36, 28, 52);
    pub const BORDER: Color = Color::Rgb(72, 72, 88);
    pub const BORDER_FOCUS: Color = Color::Rgb(140, 120, 200);
    pub const TEXT: Color = Color::Rgb(230, 230, 235);
    pub const MUTED: Color = Color::Rgb(130, 130, 145);
    pub const ACCENT: Color = Color::Rgb(180, 160, 255);
    pub const ERROR: Color = Color::Rgb(220, 90, 90);
    pub const SELECT_BG: Color = Color::Rgb(48, 40, 72);
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SidebarAgent {
    pub label: String,
    pub detail: String,
    pub blocked: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellViewModel {
    pub project: String,
    pub agents: Vec<SidebarAgent>,
    pub selected_agent: usize,
    pub work_title: String,
    pub work_body: Vec<String>,
    pub notice: Option<String>,
    pub usage_line: String,
}

impl Default for ShellViewModel {
    fn default() -> Self {
        Self {
            project: "kairo".into(),
            agents: vec![
                SidebarAgent {
                    label: "Orchestrator".into(),
                    detail: "idle · placeholder".into(),
                    blocked: false,
                },
                SidebarAgent {
                    label: "Builder".into(),
                    detail: "blocked · placeholder".into(),
                    blocked: true,
                },
            ],
            selected_agent: 0,
            work_title: "Welcome to Kairo".into(),
            work_body: vec![
                "Work surface — conversation will stream here.".into(),
                "Type below when the editor is wired (V2).".into(),
            ],
            notice: None,
            usage_line: "USAGE · waiting for bridge".into(),
        }
    }
}

/// Paint all shell regions for one frame.
pub fn render_shell(buf: &mut Buffer, regions: ShellRegions, model: &ShellViewModel) {
    if let Some(sidebar) = regions.sidebar {
        render_sidebar(buf, sidebar, model);
    }
    render_work(buf, regions.main, model);
    render_usage(buf, regions.usage, model);
}

fn render_sidebar(buf: &mut Buffer, area: Rect, model: &ShellViewModel) {
    let block = Block::default()
        .borders(Borders::RIGHT | Borders::TOP | Borders::BOTTOM)
        .border_style(Style::default().fg(tone::BORDER))
        .style(Style::default().bg(tone::SIDEBAR_BG))
        .title(Span::styled(
            format!(" ◈ {} ", truncate(&model.project, (area.width.saturating_sub(4)) as usize)),
            Style::default()
                .fg(tone::ACCENT)
                .add_modifier(Modifier::BOLD),
        ));
    let inner = block.inner(area);
    block.render(area, buf);

    let row_width = inner.width;
    let mut items: Vec<ListItem> = Vec::new();
    items.push(ListItem::new(padded_span(
        "AGENTS",
        row_width,
        Style::default()
            .fg(tone::MUTED)
            .add_modifier(Modifier::BOLD)
            .bg(tone::SIDEBAR_BG),
    )));
    for (i, agent) in model.agents.iter().enumerate() {
        let selected = i == model.selected_agent;
        let glyph = if agent.blocked { "✖" } else { "○" };
        let name_style = if selected {
            Style::default()
                .fg(tone::TEXT)
                .bg(tone::SELECT_BG)
                .add_modifier(Modifier::BOLD)
        } else if agent.blocked {
            Style::default().fg(tone::ERROR).bg(tone::SIDEBAR_BG)
        } else {
            Style::default().fg(tone::TEXT).bg(tone::SIDEBAR_BG)
        };
        let detail_style = if selected {
            Style::default().fg(tone::MUTED).bg(tone::SELECT_BG)
        } else {
            Style::default().fg(tone::MUTED).bg(tone::SIDEBAR_BG)
        };
        items.push(ListItem::new(padded_span(
            &format!("{glyph} {}", agent.label),
            row_width,
            name_style,
        )));
        items.push(ListItem::new(padded_span(
            &format!("  {}", agent.detail),
            row_width,
            detail_style,
        )));
    }
    List::new(items).render(inner, buf);
}

fn render_work(buf: &mut Buffer, area: Rect, model: &ShellViewModel) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(tone::BORDER_FOCUS))
        .style(Style::default().bg(tone::WORK_BG))
        .title(Span::styled(
            format!(" {} ", model.work_title),
            Style::default()
                .fg(tone::TEXT)
                .add_modifier(Modifier::BOLD),
        ));
    let inner = block.inner(area);
    block.render(area, buf);

    let mut lines: Vec<Line> = model
        .work_body
        .iter()
        .map(|s| Line::from(Span::styled(s.clone(), Style::default().fg(tone::TEXT))))
        .collect();
    if let Some(notice) = &model.notice {
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            format!("⚠ {notice}"),
            Style::default().fg(tone::ERROR).add_modifier(Modifier::BOLD),
        )));
    }
    Paragraph::new(lines)
        .style(Style::default().bg(tone::WORK_BG))
        .render(inner, buf);
}

fn render_usage(buf: &mut Buffer, area: Rect, model: &ShellViewModel) {
    // Top border + one content row (USAGE_STRIP_ROWS == 2). Never paint a
    // bordered strip into a 1-row rect — the border eats the only line.
    let block = Block::default()
        .borders(Borders::TOP)
        .border_style(Style::default().fg(tone::BORDER))
        .style(Style::default().bg(tone::USAGE_BG));
    let inner = block.inner(area);
    block.render(area, buf);
    if inner.height == 0 || inner.width == 0 {
        return;
    }
    Paragraph::new(padded_span(
        &format!(" {} ", model.usage_line),
        inner.width,
        Style::default().fg(tone::TEXT).bg(tone::USAGE_BG),
    ))
    .render(inner, buf);
}

/// One list/paragraph line padded to `width` so background fills the row.
fn padded_span(text: &str, width: u16, style: Style) -> Line<'static> {
    let w = width as usize;
    let truncated = truncate(text, w);
    let pad = w.saturating_sub(truncated.chars().count());
    let mut line = truncated;
    line.extend(std::iter::repeat_n(' ', pad));
    Line::from(Span::styled(line, style))
}

fn truncate(s: &str, max: usize) -> String {
    if max == 0 {
        return String::new();
    }
    let mut out = String::new();
    for (i, ch) in s.chars().enumerate() {
        if i >= max {
            break;
        }
        out.push(ch);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::split_shell;
    use ratatui::layout::Rect;

    fn cell_bg(buf: &Buffer, x: u16, y: u16) -> Color {
        buf[(x, y)].style().bg.unwrap_or(Color::Reset)
    }

    fn buffer_text(buf: &Buffer) -> String {
        buf.content().iter().map(|c| c.symbol().to_string()).collect()
    }

    #[test]
    fn wide_frame_paints_three_distinct_surface_backgrounds() {
        let area = Rect::new(0, 0, 100, 30);
        let regions = split_shell(area);
        let mut buf = Buffer::empty(area);
        render_shell(&mut buf, regions, &ShellViewModel::default());

        let sidebar = regions.sidebar.expect("sidebar");
        assert_eq!(cell_bg(&buf, sidebar.x + 1, sidebar.y + 1), tone::SIDEBAR_BG);
        assert_eq!(cell_bg(&buf, regions.main.x + 2, regions.main.y + 2), tone::WORK_BG);
        // Content row is below the top border of the USAGE strip.
        assert_eq!(
            cell_bg(&buf, regions.usage.x + 1, regions.usage.y + 1),
            tone::USAGE_BG
        );
    }

    #[test]
    fn usage_strip_shows_usage_text_not_only_border() {
        let area = Rect::new(0, 0, 100, 30);
        let regions = split_shell(area);
        assert!(regions.usage.height >= 2, "usage must leave a row for text");
        let mut buf = Buffer::empty(area);
        let mut model = ShellViewModel::default();
        model.usage_line = "USAGE · Codex 5h 96%".into();
        render_shell(&mut buf, regions, &model);
        let hay = buffer_text(&buf);
        assert!(
            hay.contains("USAGE") && hay.contains("Codex"),
            "USAGE label must be visible in the buffer, not eaten by the border: {hay}"
        );
    }

    #[test]
    fn selected_agent_row_highlight_spans_full_sidebar_inner_width() {
        let area = Rect::new(0, 0, 100, 30);
        let regions = split_shell(area);
        let sidebar = regions.sidebar.expect("sidebar");
        let mut buf = Buffer::empty(area);
        let mut model = ShellViewModel::default();
        model.selected_agent = 0;
        render_shell(&mut buf, regions, &model);

        // Title row + AGENTS + first agent name row ≈ y = sidebar.y + 1 (title) is border;
        // inner starts at y+1. AGENTS at inner.y, name at inner.y+1.
        let inner_y = sidebar.y + 1;
        let name_y = inner_y + 1; // after AGENTS header
        let far_x = sidebar.x + sidebar.width - 3; // inside, left of right border
        assert_eq!(
            cell_bg(&buf, far_x, name_y),
            tone::SELECT_BG,
            "selection must fill the row, not only the label glyphs"
        );
    }

    #[test]
    fn work_surface_shows_notice_when_present() {
        let area = Rect::new(0, 0, 100, 24);
        let regions = split_shell(area);
        let mut buf = Buffer::empty(area);
        let mut model = ShellViewModel::default();
        model.notice = Some("Pi engine unavailable".into());
        render_shell(&mut buf, regions, &model);

        let hay = buffer_text(&buf);
        assert!(hay.contains("Pi engine unavailable"), "buffer missing notice: {hay}");
    }

    #[test]
    fn narrow_frame_has_no_sidebar_but_still_paints_work_and_usage() {
        let area = Rect::new(0, 0, 60, 20);
        let regions = split_shell(area);
        assert!(regions.sidebar.is_none());
        let mut buf = Buffer::empty(area);
        render_shell(&mut buf, regions, &ShellViewModel::default());
        assert_eq!(cell_bg(&buf, regions.main.x + 2, regions.main.y + 2), tone::WORK_BG);
        assert_eq!(
            cell_bg(&buf, regions.usage.x + 1, regions.usage.y + 1),
            tone::USAGE_BG
        );
        assert!(buffer_text(&buf).contains("USAGE"));
    }
}
