//! Painted shell surfaces — product chrome, not bare text on black.

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, List, ListItem, Paragraph, Widget};
use ratatui_textarea::TextArea;

use crate::chat::{ChatMessage, ChatState, Focus, MessageRole};
use crate::layout::{split_work_main, ShellRegions};

/// Kairo sober hacker palette — graphite greens; accent green only for
/// brand / focus / selection. Semantic red / amber / user-blue stay distinct.
pub mod tone {
    use ratatui::style::Color;

    /// Work surface `#090F0E`.
    pub const WORK_BG: Color = Color::Rgb(0x09, 0x0f, 0x0e);
    /// Sidebar `#111A18`.
    pub const SIDEBAR_BG: Color = Color::Rgb(0x11, 0x1a, 0x18);
    /// USAGE strip `#13211C`.
    pub const USAGE_BG: Color = Color::Rgb(0x13, 0x21, 0x1c);
    /// Quiet graphite border (not purple, not accent green).
    pub const BORDER: Color = Color::Rgb(0x2c, 0x3d, 0x36);
    /// Brand / focus green `#5EE6A8`.
    pub const ACCENT: Color = Color::Rgb(0x5e, 0xe6, 0xa8);
    pub const BORDER_FOCUS: Color = ACCENT;
    /// Primary text `#E8F5EF`.
    pub const TEXT: Color = Color::Rgb(0xe8, 0xf5, 0xef);
    /// Secondary text `#9AB2A5`.
    pub const MUTED: Color = Color::Rgb(0x9a, 0xb2, 0xa5);
    /// Selection wash — dark green tint, not full accent fill.
    pub const SELECT_BG: Color = Color::Rgb(0x1a, 0x33, 0x2c);
    /// Blocked / hard error — red, never green.
    pub const ERROR: Color = Color::Rgb(0xdc, 0x5a, 0x5a);
    /// Notices and tool rows — amber.
    pub const WARN: Color = Color::Rgb(0xe0, 0xb4, 0x5c);
    pub const TOOL: Color = WARN;
    /// User messages — light blue (not green).
    pub const USER: Color = Color::Rgb(0x8e, 0xc8, 0xff);
    /// Assistant label — neutral mint-gray, not accent green.
    pub const ASSISTANT: Color = Color::Rgb(0xc5, 0xd4, 0xcc);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentState {
    Idle,
    Blocked,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SidebarAgent {
    pub label: String,
    pub detail: String,
    pub state: AgentState,
}

impl SidebarAgent {
    fn glyph(&self) -> &'static str {
        match self.state {
            AgentState::Blocked => "✖",
            AgentState::Idle => "○",
            AgentState::Unknown => "?",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellViewModel {
    pub project: String,
    pub agents: Vec<SidebarAgent>,
    pub selected_agent: usize,
    pub work_title: String,
    pub notice: Option<String>,
    pub usage_line: String,
    /// Engine model / Pi session (second row of USAGE strip when bridge is on).
    pub engine_line: String,
}

impl Default for ShellViewModel {
    fn default() -> Self {
        Self {
            project: "kairo".into(),
            agents: vec![
                SidebarAgent {
                    label: "Orchestrator".into(),
                    detail: "idle · placeholder".into(),
                    state: AgentState::Idle,
                },
                SidebarAgent {
                    label: "Builder".into(),
                    detail: "blocked · placeholder".into(),
                    state: AgentState::Blocked,
                },
            ],
            selected_agent: 0,
            work_title: "Chat".into(),
            notice: None,
            usage_line: "USAGE · waiting for bridge".into(),
            engine_line: "MODEL · (local mock without --bridge)".into(),
        }
    }
}

/// Paint all shell regions for one frame.
pub fn render_shell(
    buf: &mut Buffer,
    regions: ShellRegions,
    model: &ShellViewModel,
    chat: &ChatState,
    editor: &TextArea<'_>,
) {
    if let Some(sidebar) = regions.sidebar {
        render_sidebar(buf, sidebar, model, chat.focus);
    }
    render_work(buf, regions.main, model, chat, editor);
    render_usage(buf, regions.usage, model);
}

fn render_sidebar(buf: &mut Buffer, area: Rect, model: &ShellViewModel, focus: Focus) {
    let border = if focus == Focus::Sidebar {
        tone::BORDER_FOCUS
    } else {
        tone::BORDER
    };
    let block = Block::default()
        .borders(Borders::RIGHT | Borders::TOP | Borders::BOTTOM)
        .border_style(Style::default().fg(border))
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
        let glyph = agent.glyph();
        let name_style = if selected {
            Style::default()
                .fg(tone::TEXT)
                .bg(tone::SELECT_BG)
                .add_modifier(Modifier::BOLD)
        } else if agent.state == AgentState::Blocked {
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

fn render_work(
    buf: &mut Buffer,
    area: Rect,
    model: &ShellViewModel,
    chat: &ChatState,
    editor: &TextArea<'_>,
) {
    let work = split_work_main(area);
    render_transcript(buf, work.transcript, model, chat);
    render_editor(buf, work.editor, chat.focus, editor);
}

fn render_transcript(buf: &mut Buffer, area: Rect, model: &ShellViewModel, chat: &ChatState) {
    let border = if chat.focus == Focus::Transcript {
        tone::BORDER_FOCUS
    } else {
        tone::BORDER
    };
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(border))
        .style(Style::default().bg(tone::WORK_BG))
        .title(Span::styled(
            format!(" {} ", model.work_title),
            Style::default()
                .fg(tone::TEXT)
                .add_modifier(Modifier::BOLD),
        ));
    let inner = block.inner(area);
    block.render(area, buf);

    let mut lines: Vec<Line> = transcript_lines(chat);
    if let Some(notice) = &model.notice {
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            format!("⚠ {notice}"),
            Style::default().fg(tone::WARN).add_modifier(Modifier::BOLD),
        )));
    }
    let total = lines.len();
    let start = chat.scroll_offset.min(total);
    let visible = inner.height as usize;
    let slice: Vec<Line> = lines.into_iter().skip(start).take(visible).collect();
    Paragraph::new(slice)
        .style(Style::default().bg(tone::WORK_BG))
        .render(inner, buf);
}

fn transcript_lines(chat: &ChatState) -> Vec<Line<'static>> {
    chat.messages
        .iter()
        .flat_map(message_to_lines)
        .collect()
}

fn message_to_lines(msg: &ChatMessage) -> Vec<Line<'static>> {
    let (prefix, color) = match msg.role {
        MessageRole::User => ("you", tone::USER),
        MessageRole::Assistant => ("assistant", tone::ASSISTANT),
        MessageRole::Tool => ("tool", tone::TOOL),
        MessageRole::System => ("", tone::MUTED),
    };
    let body = if msg.streaming && msg.content.is_empty() {
        "…".to_string()
    } else {
        msg.content.clone()
    };
    if prefix.is_empty() {
        vec![Line::from(Span::styled(body, Style::default().fg(color)))]
    } else {
        vec![Line::from(vec![
            Span::styled(
                format!("{prefix}: "),
                Style::default()
                    .fg(color)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(body, Style::default().fg(tone::TEXT)),
        ])]
    }
}

fn render_editor(buf: &mut Buffer, area: Rect, focus: Focus, editor: &TextArea<'_>) {
    let border = if focus == Focus::Editor {
        tone::BORDER_FOCUS
    } else {
        tone::BORDER
    };
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(border))
        .style(Style::default().bg(tone::WORK_BG))
        .title(Span::styled(
            " compose ",
            Style::default().fg(tone::MUTED),
        ));
    let inner = block.inner(area);
    block.render(area, buf);
    let mut area_editor = editor.clone();
    area_editor.set_block(Block::default());
    area_editor.set_style(Style::default().fg(tone::TEXT).bg(tone::WORK_BG));
    area_editor.set_cursor_line_style(Style::default().bg(tone::SELECT_BG));
    area_editor.render(inner, buf);
}

fn render_usage(buf: &mut Buffer, area: Rect, model: &ShellViewModel) {
    let block = Block::default()
        .borders(Borders::TOP)
        .border_style(Style::default().fg(tone::BORDER))
        .style(Style::default().bg(tone::USAGE_BG));
    let inner = block.inner(area);
    block.render(area, buf);
    if inner.height == 0 || inner.width == 0 {
        return;
    }
    let line_style = Style::default().fg(tone::TEXT).bg(tone::USAGE_BG);
    let muted = Style::default().fg(tone::MUTED).bg(tone::USAGE_BG);
    let mut lines = vec![Line::from(padded_span(
        &format!(" {} ", model.usage_line),
        inner.width,
        line_style,
    ))];
    if inner.height > 1 && !model.engine_line.is_empty() {
        lines.push(Line::from(padded_span(
            &format!(" {} ", model.engine_line),
            inner.width,
            muted,
        )));
    }
    Paragraph::new(lines).render(inner, buf);
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
    use crate::chat::ChatState;
    use crate::layout::split_shell;
    use ratatui::layout::Rect;

    fn cell_bg(buf: &Buffer, x: u16, y: u16) -> Color {
        buf[(x, y)].style().bg.unwrap_or(Color::Reset)
    }

    fn buffer_text(buf: &Buffer) -> String {
        buf.content().iter().map(|c| c.symbol().to_string()).collect()
    }

    fn default_editor() -> TextArea<'static> {
        TextArea::default()
    }

    #[test]
    fn wide_frame_paints_three_distinct_surface_backgrounds() {
        let area = Rect::new(0, 0, 100, 30);
        let regions = split_shell(area);
        let mut buf = Buffer::empty(area);
        render_shell(
            &mut buf,
            regions,
            &ShellViewModel::default(),
            &ChatState::default(),
            &default_editor(),
        );

        let sidebar = regions.sidebar.expect("sidebar");
        assert_eq!(cell_bg(&buf, sidebar.x + 1, sidebar.y + 1), tone::SIDEBAR_BG);
        assert_eq!(cell_bg(&buf, regions.main.x + 2, regions.main.y + 2), tone::WORK_BG);
        assert_eq!(
            cell_bg(&buf, regions.usage.x + 1, regions.usage.y + 1),
            tone::USAGE_BG
        );
    }

    #[test]
    fn transcript_shows_submitted_user_message() {
        let area = Rect::new(0, 0, 100, 30);
        let regions = split_shell(area);
        let mut buf = Buffer::empty(area);
        let mut chat = ChatState::default();
        chat.submit_user("hello kairo".into());
        render_shell(
            &mut buf,
            regions,
            &ShellViewModel::default(),
            &chat,
            &default_editor(),
        );
        let hay = buffer_text(&buf);
        assert!(
            hay.contains("hello kairo"),
            "submitted user text must appear in transcript: {hay}"
        );
    }

    #[test]
    fn editor_region_uses_compose_title() {
        let area = Rect::new(0, 0, 100, 30);
        let regions = split_shell(area);
        let mut buf = Buffer::empty(area);
        render_shell(
            &mut buf,
            regions,
            &ShellViewModel::default(),
            &ChatState::default(),
            &default_editor(),
        );
        assert!(
            buffer_text(&buf).contains("compose"),
            "editor strip should be labeled"
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
        render_shell(
            &mut buf,
            regions,
            &model,
            &ChatState::default(),
            &default_editor(),
        );
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
        let mut chat = ChatState::default();
        chat.focus = Focus::Sidebar;
        render_shell(
            &mut buf,
            regions,
            &model,
            &chat,
            &default_editor(),
        );

        let inner_y = sidebar.y + 1;
        let name_y = inner_y + 1;
        let far_x = sidebar.x + sidebar.width - 3;
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
        render_shell(
            &mut buf,
            regions,
            &model,
            &ChatState::default(),
            &default_editor(),
        );

        let hay = buffer_text(&buf);
        assert!(hay.contains("Pi engine unavailable"), "buffer missing notice: {hay}");
    }

    #[test]
    fn workspace_snapshot_usage_replaces_bridge_placeholder() {
        use crate::snapshot::apply_workspace_snapshot;
        use serde_json::json;

        let area = Rect::new(0, 0, 100, 30);
        let regions = split_shell(area);
        let mut buf = Buffer::empty(area);
        let mut model = ShellViewModel::default();
        apply_workspace_snapshot(
            &mut model,
            &json!({
                "project": { "label": "demo-repo" },
                "agents": [
                    { "label": "Orchestrator", "state": "idle", "provider": "opencode" }
                ],
                "subscriptions": {
                    "state": "ready",
                    "segments": ["Codex 5h 96%", "Claude ok"]
                }
            }),
        );
        render_shell(
            &mut buf,
            regions,
            &model,
            &ChatState::default(),
            &default_editor(),
        );
        let hay = buffer_text(&buf);
        assert!(
            hay.contains("Codex 5h 96%"),
            "USAGE must show real subscription segment, not bridge placeholder: {hay}"
        );
        assert!(
            !hay.contains("waiting for bridge"),
            "placeholder USAGE must be replaced: {hay}"
        );
        assert!(hay.contains("demo-repo"));
    }

    #[test]
    fn narrow_frame_has_no_sidebar_but_still_paints_work_and_usage() {
        let area = Rect::new(0, 0, 60, 20);
        let regions = split_shell(area);
        assert!(regions.sidebar.is_none());
        let mut buf = Buffer::empty(area);
        render_shell(
            &mut buf,
            regions,
            &ShellViewModel::default(),
            &ChatState::default(),
            &default_editor(),
        );
        assert_eq!(cell_bg(&buf, regions.main.x + 2, regions.main.y + 2), tone::WORK_BG);
        assert_eq!(
            cell_bg(&buf, regions.usage.x + 1, regions.usage.y + 1),
            tone::USAGE_BG
        );
        assert!(buffer_text(&buf).contains("USAGE"));
    }

    fn rgb_channels(c: Color) -> Option<(u8, u8, u8)> {
        match c {
            Color::Rgb(r, g, b) => Some((r, g, b)),
            _ => None,
        }
    }

    fn relative_luminance(c: Color) -> f64 {
        let (r, g, b) = rgb_channels(c).expect("theme colors are Rgb");
        let lin = |u: u8| {
            let s = f64::from(u) / 255.0;
            if s <= 0.03928 {
                s / 12.92
            } else {
                ((s + 0.055) / 1.055).powf(2.4)
            }
        };
        0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    }

    fn contrast_ratio(fg: Color, bg: Color) -> f64 {
        let (a, b) = (relative_luminance(fg), relative_luminance(bg));
        let (hi, lo) = if a > b { (a, b) } else { (b, a) };
        (hi + 0.05) / (lo + 0.05)
    }

    fn cell_fg(buf: &Buffer, x: u16, y: u16) -> Color {
        buf[(x, y)].style().fg.unwrap_or(Color::Reset)
    }

    #[test]
    fn hacker_theme_surfaces_are_graphite_green_not_violet() {
        assert_eq!(tone::WORK_BG, Color::Rgb(0x09, 0x0f, 0x0e));
        assert_eq!(tone::SIDEBAR_BG, Color::Rgb(0x11, 0x1a, 0x18));
        assert_eq!(tone::USAGE_BG, Color::Rgb(0x13, 0x21, 0x1c));
        assert_eq!(tone::ACCENT, Color::Rgb(0x5e, 0xe6, 0xa8));
        assert_eq!(tone::TEXT, Color::Rgb(0xe8, 0xf5, 0xef));
        assert_eq!(tone::MUTED, Color::Rgb(0x9a, 0xb2, 0xa5));
        // Surfaces must stay distinct.
        assert_ne!(tone::WORK_BG, tone::SIDEBAR_BG);
        assert_ne!(tone::SIDEBAR_BG, tone::USAGE_BG);
        assert_ne!(tone::WORK_BG, tone::USAGE_BG);
    }

    #[test]
    fn text_on_surfaces_meets_wcag_aa_contrast() {
        for bg in [tone::WORK_BG, tone::SIDEBAR_BG, tone::USAGE_BG, tone::SELECT_BG] {
            let ratio = contrast_ratio(tone::TEXT, bg);
            assert!(
                ratio >= 4.5,
                "TEXT on {bg:?} contrast {ratio:.2} must be ≥ 4.5"
            );
        }
        let muted_work = contrast_ratio(tone::MUTED, tone::WORK_BG);
        assert!(
            muted_work >= 3.0,
            "MUTED on WORK_BG contrast {muted_work:.2} must be ≥ 3.0 (large/UI text)"
        );
    }

    #[test]
    fn semantic_colors_stay_distinct_from_accent_green() {
        assert_ne!(tone::ERROR, tone::ACCENT);
        assert_ne!(tone::WARN, tone::ACCENT);
        assert_ne!(tone::USER, tone::ACCENT);
        assert_ne!(tone::ASSISTANT, tone::ACCENT);
        assert_ne!(tone::ERROR, tone::WARN);
        assert_ne!(tone::USER, tone::ERROR);
        assert_eq!(tone::TOOL, tone::WARN);
        assert_eq!(tone::BORDER_FOCUS, tone::ACCENT);
    }

    #[test]
    fn selection_and_blocked_states_keep_semantic_paint() {
        let area = Rect::new(0, 0, 100, 30);
        let regions = split_shell(area);
        let sidebar = regions.sidebar.expect("sidebar");
        let mut buf = Buffer::empty(area);
        let mut model = ShellViewModel::default();
        // Default: Orchestrator idle (selected), Builder blocked.
        model.selected_agent = 0;
        let mut chat = ChatState::default();
        chat.focus = Focus::Sidebar;
        render_shell(&mut buf, regions, &model, &chat, &default_editor());

        let name_y = sidebar.y + 2; // after title border + AGENTS
        let select_x = sidebar.x + sidebar.width - 3;
        assert_eq!(cell_bg(&buf, select_x, name_y), tone::SELECT_BG);

        // Builder name row: AGENTS + orch name + orch detail + builder name
        // inner starts at sidebar.y+1; items: 0 AGENTS, 1 orch name, 2 orch detail, 3 builder name
        let builder_name_y = sidebar.y + 1 + 3;
        let builder_x = sidebar.x + 2;
        assert_eq!(
            cell_fg(&buf, builder_x, builder_name_y),
            tone::ERROR,
            "blocked agent must paint ERROR red, not accent green"
        );
    }

    #[test]
    fn focus_border_uses_accent_green_not_chat_body() {
        let area = Rect::new(0, 0, 100, 30);
        let regions = split_shell(area);
        let mut buf = Buffer::empty(area);
        let mut chat = ChatState::default();
        chat.focus = Focus::Editor;
        chat.submit_user("hi".into());
        chat.push_mock_assistant_reply("hi");
        render_shell(
            &mut buf,
            regions,
            &ShellViewModel::default(),
            &chat,
            &default_editor(),
        );
        // Editor top border cell should be focus accent.
        let work = crate::layout::split_work_main(regions.main);
        let border_cell = buf[(work.editor.x, work.editor.y)].style().fg.unwrap_or(Color::Reset);
        assert_eq!(border_cell, tone::BORDER_FOCUS);

        // Assistant prefix must not use accent green (chat not tinted).
        let hay_styles_ok = tone::ASSISTANT != tone::ACCENT;
        assert!(hay_styles_ok);
        assert!(buffer_text(&buf).contains("assistant:"));
        assert!(buffer_text(&buf).contains("you:"));
    }

    #[test]
    fn notice_uses_amber_warn_not_error_red() {
        let area = Rect::new(0, 0, 100, 30);
        let regions = split_shell(area);
        let mut buf = Buffer::empty(area);
        let mut model = ShellViewModel::default();
        model.notice = Some("UNIQUE_NOTICE_TOKEN".into());
        render_shell(
            &mut buf,
            regions,
            &model,
            &ChatState::default(),
            &default_editor(),
        );
        // Find a cell whose symbol is part of the notice and check fg.
        let mut found_warn = false;
        for y in regions.main.y..regions.main.y + regions.main.height {
            for x in regions.main.x..regions.main.x + regions.main.width {
                let cell = &buf[(x, y)];
                if cell.symbol().contains('⚠') || cell.symbol() == "U" {
                    let fg = cell.style().fg.unwrap_or(Color::Reset);
                    if fg == tone::WARN {
                        found_warn = true;
                    }
                }
            }
        }
        assert!(
            found_warn,
            "notice glyph/text must use WARN amber, not ERROR or ACCENT"
        );
        assert_ne!(tone::WARN, tone::ERROR);
    }
}
