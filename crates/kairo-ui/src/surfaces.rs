//! Painted shell surfaces — product chrome, not bare text on black.

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, List, ListItem, Paragraph, Widget};
use ratatui_textarea::TextArea;

use crate::analyst_picker::{AnalystPickerState, PickerPhase, PickerView};
use crate::chat::{ChatMessage, ChatState, Focus, MessageRole};
use crate::extension_ui::{ExtensionUiDialog, ExtensionUiMethod};
use crate::layout::{split_work_main, ShellRegions};
use crate::execution_flow::{ConfirmExecuteState, RoleSelectState};
use crate::plan_list::PlanListState;
use crate::recovery_picker::RecoveryPreviewState;
use crate::role_editor::RoleEditorState;
use crate::session_picker::SessionPickerState;
use crate::ops_panel::{render_ops_panel, OpsPanelState};
use crate::settings_panel::{render_settings_panel, SettingsPanelState};
use crate::workspace_nav::WorkspaceView;

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

/// Evidenced reason a role is blocked, classified from the ORIGINAL
/// `stateReason` — never invented. `Unavailable` covers ambiguous evidence
/// (e.g. billing/entitlement wording with no explicit funds statement) and
/// is also the aggregate result when blocked roles disagree on cause.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum BlockCause {
    #[default]
    Unavailable,
    RateLimited,
    QuotaExhausted,
    NoFunds,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SidebarAgent {
    pub label: String,
    pub detail: String,
    pub state: AgentState,
    /// Classified from the original `stateReason`, not from `detail` — so
    /// aggregation (e.g. the chat CTA) never re-derives from already
    /// shortened/truncated text.
    pub cause: BlockCause,
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
    /// Sticky CTA when ≥1 team agent is blocked (honest unavailable copy).
    /// Independent of ephemeral `notice` so Pi/engine messages cannot hide it.
    /// One or two short lines so the chat column can paint the full CTA.
    pub team_attention: Option<Vec<String>>,
    /// Empty-chat copy when the engine cannot prompt (honest, not a fake conversation).
    pub work_empty_hint: Option<Vec<String>>,
    pub usage_line: String,
    /// Engine model / Pi session (second row of USAGE strip when bridge is on).
    pub engine_line: String,
    /// Snapshot `team.state` (`not_analyzed` / `suggested` / `active` / `stale`)
    /// when the bridge reported one — drives the in-UI analyze/approve hints.
    pub team_state: Option<String>,
    /// Derived presentation state from the projection's additive
    /// `team.presentation.state` (`complete`/`incomplete`/`blocked`/`verifying`).
    /// `None` = older sidecar without the field (legacy behavior).
    pub team_presentation: Option<String>,
    /// Whether the sidebar may list team roles. Presentation only; saved
    /// assignments are untouched. Defaults to true (legacy).
    pub roles_visible: bool,
    /// U4a WorkMode: ask | plan | agent (fail-closed default ask).
    pub work_mode: String,
}

impl Default for ShellViewModel {
    fn default() -> Self {
        Self {
            project: "kairo".into(),
            // Honest empty team — never invent Orchestrator/Builder placeholders.
            agents: Vec::new(),
            selected_agent: 0,
            work_title: "Chat".into(),
            notice: None,
            team_attention: None,
            work_empty_hint: None,
            usage_line: "USAGE · waiting for bridge".into(),
            engine_line: "MODEL · (local mock without --bridge)".into(),
            team_state: None,
            team_presentation: None,
            roles_visible: true,
            work_mode: "ask".into(),
        }
    }
}

/// Second line of the empty AGENTS list: the key that fills it, in this UI.
/// Sidebar copy while the roles list is hidden. The verifying wording never
/// mentions quota: unverified access is "still checking", not "missing".
fn hidden_team_notice_lines(model: &ShellViewModel) -> Vec<&'static str> {
    let mut lines = match model.team_presentation.as_deref() {
        Some("verifying") => vec!["Verifying team access…"],
        Some("blocked") => vec!["Team blocked"],
        _ => vec!["Team incomplete"],
    };
    // Re-analyze is driven by the Rust host + sidecar (`project.preflight`),
    // never by Pi RPC, so the hint is always honest.
    if model.team_state.as_deref() == Some("suggested") {
        lines.push("A = approve");
        lines.push("2 = edit team");
    }
    lines.push("a = re-analyze");
    lines
}

fn empty_team_key_hint(team_state: Option<&str>) -> &'static str {
    if team_state == Some("suggested") {
        "A = approve"
    } else {
        "a = analyze"
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
            format!(
                " ◈ {} ",
                truncate(&model.project, (area.width.saturating_sub(4)) as usize)
            ),
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
    if !model.roles_visible {
        // Whole roles list hidden (no partial team); compact state notice only.
        let notice_style = Style::default().fg(tone::MUTED).bg(tone::SIDEBAR_BG);
        for line in hidden_team_notice_lines(model) {
            items.push(ListItem::new(padded_span(line, row_width, notice_style)));
        }
    } else if model.agents.is_empty() {
        let empty_style = Style::default().fg(tone::MUTED).bg(tone::SIDEBAR_BG);
        items.push(ListItem::new(padded_span(
            "No team yet",
            row_width,
            empty_style,
        )));
        items.push(ListItem::new(padded_span(
            empty_team_key_hint(model.team_state.as_deref()),
            row_width,
            empty_style,
        )));
    } else {
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
    render_editor(buf, work.editor, chat.focus, editor, &model.work_mode);
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
            Style::default().fg(tone::TEXT).add_modifier(Modifier::BOLD),
        ));
    let inner = block.inner(area);
    block.render(area, buf);

    let mut lines: Vec<Line> = transcript_lines(chat, model, inner.width);
    if let Some(attention) = &model.team_attention {
        lines.push(Line::from(""));
        for line in attention {
            lines.push(Line::from(Span::styled(
                format!("⚠ {line}"),
                Style::default().fg(tone::WARN).add_modifier(Modifier::BOLD),
            )));
        }
    }
    if let Some(notice) = &model.notice {
        lines.push(Line::from(""));
        let notice_style = Style::default().fg(tone::WARN).add_modifier(Modifier::BOLD);
        lines.extend(wrap_notice(notice, inner.width, notice_style));
    }
    let total = lines.len();
    let visible = inner.height as usize;
    // Clamp to the LAST reachable window, not just `total`: a scroll offset
    // at or past the end must show the final `visible` rows (the real
    // cause of a wrapped notice), never an all-skipped blank pane.
    let max_start = total.saturating_sub(visible);
    let start = chat.scroll_offset.min(max_start);
    let slice: Vec<Line> = lines.into_iter().skip(start).take(visible).collect();
    Paragraph::new(slice)
        .style(Style::default().bg(tone::WORK_BG))
        .render(inner, buf);
}

fn is_empty_work_placeholder(content: &str) -> bool {
    content == "Type /analyze to choose an analyst · then chat below."
        || content == "Work surface — conversation streams above; type below."
}

fn transcript_has_conversation(chat: &ChatState) -> bool {
    chat.messages.iter().any(|m| match m.role {
        MessageRole::User
        | MessageRole::Assistant
        | MessageRole::Thinking
        | MessageRole::Tool
        | MessageRole::Error => true,
        MessageRole::System => !m.content.is_empty() && !is_empty_work_placeholder(&m.content),
    })
}

fn transcript_lines(chat: &ChatState, model: &ShellViewModel, width: u16) -> Vec<Line<'static>> {
    if !transcript_has_conversation(chat) {
        if let Some(hint) = &model.work_empty_hint {
            return hint
                .iter()
                .map(|line| {
                    Line::from(Span::styled(line.clone(), Style::default().fg(tone::MUTED)))
                })
                .collect();
        }
        return vec![Line::from(Span::styled(
            "Type /analyze to choose an analyst · then chat below.".to_string(),
            Style::default().fg(tone::MUTED),
        ))];
    }
    chat.messages
        .iter()
        .flat_map(|msg| message_to_lines(msg, width))
        .collect()
}

/// Paint one chat row as one or more screen lines: hard `\n` splits stay
/// separate (tool name vs result), and each segment word/char-wraps to
/// `width` so narrow terminals scroll instead of silently truncating.
fn message_to_lines(msg: &ChatMessage, width: u16) -> Vec<Line<'static>> {
    // Reuse the existing sober-hacker tone constants only: `Tool` already
    // distinguishes error vs success via `is_error` -> ERROR (never a new
    // color); `Thinking` reuses MUTED (System's own tone) plus ITALIC so it
    // never reads as ordinary assistant text or as a plain system line;
    // `Error` reuses the same ERROR red a failed tool row uses.
    let (prefix, color) = match msg.role {
        MessageRole::User => ("you", tone::USER),
        MessageRole::Assistant => ("assistant", tone::ASSISTANT),
        MessageRole::Thinking => ("thinking", tone::MUTED),
        MessageRole::Tool => (
            "tool",
            if msg.is_error {
                tone::ERROR
            } else {
                tone::TOOL
            },
        ),
        MessageRole::Error => ("error", tone::ERROR),
        MessageRole::System => ("", tone::MUTED),
    };
    let body = if msg.streaming && msg.content.is_empty() {
        "…".to_string()
    } else {
        msg.content.clone()
    };

    let width = (width as usize).max(1);
    let prefix_text = if prefix.is_empty() {
        String::new()
    } else {
        format!("{prefix}: ")
    };
    let prefix_cols = prefix_text.chars().count();
    let wrap_width = if prefix.is_empty() {
        width
    } else {
        width.saturating_sub(prefix_cols).max(1)
    };

    let thinking = msg.role == MessageRole::Thinking;
    let prefix_style = if thinking {
        Style::default()
            .fg(color)
            .add_modifier(Modifier::BOLD | Modifier::ITALIC)
    } else if prefix.is_empty() {
        Style::default().fg(color)
    } else {
        Style::default().fg(color).add_modifier(Modifier::BOLD)
    };
    let body_style = if thinking {
        Style::default().fg(color).add_modifier(Modifier::ITALIC)
    } else if prefix.is_empty() {
        Style::default().fg(color)
    } else {
        Style::default().fg(tone::TEXT)
    };

    let mut out: Vec<Line<'static>> = Vec::new();
    let mut is_first = true;
    for segment in body.split('\n') {
        for chunk in wrap_text_segment(segment, wrap_width) {
            if is_first {
                if prefix.is_empty() {
                    out.push(Line::from(Span::styled(chunk, body_style)));
                } else {
                    out.push(Line::from(vec![
                        Span::styled(prefix_text.clone(), prefix_style),
                        Span::styled(chunk, body_style),
                    ]));
                }
                is_first = false;
            } else {
                let indent = " ".repeat(prefix_cols);
                out.push(Line::from(Span::styled(
                    format!("{indent}{chunk}"),
                    body_style,
                )));
            }
        }
    }
    out
}

fn render_editor(buf: &mut Buffer, area: Rect, focus: Focus, editor: &TextArea<'_>, work_mode: &str) {
    let border = if focus == Focus::Editor {
        tone::BORDER_FOCUS
    } else {
        tone::BORDER
    };
    let title = crate::engine::compose_chrome_title(work_mode);
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(border))
        .style(Style::default().bg(tone::WORK_BG))
        .title(Span::styled(title, Style::default().fg(tone::MUTED)));
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

/// Centered popup rect, clamped to the real frame so it never panics on a
/// tiny terminal — `width`/`height` are upper bounds, not guarantees.
fn centered_rect(area: Rect, width: u16, height: u16) -> Rect {
    let width = width.min(area.width);
    let height = height.min(area.height);
    let x = area.x + (area.width.saturating_sub(width)) / 2;
    let y = area.y + (area.height.saturating_sub(height)) / 2;
    Rect::new(x, y, width, height)
}

/// The analyst picker (T2) — a centered modal over the work surface, the
/// in-UI equivalent of the cockpit's ProjectOverlay SELECT_ANALYST screen.
/// Two explicit views: the top-three main list and the remaining verified
/// options (`m` toggles). Only verified, usable rows are listed; the list
/// scrolls and the highlighted row is always painted. With pending access
/// checks it first shows the concrete confirmation screen (`Verify`), then a
/// waiting state (`Verifying`); both stay inside the modal.
pub fn render_analyst_picker(buf: &mut Buffer, area: Rect, picker: &AnalystPickerState) {
    let width = area.width.saturating_sub(6).clamp(36, 72);
    let text_width = width.saturating_sub(2);
    // Explanations wrap to the real modal width (minus the 4-space indent), so
    // row heights and scrolling follow what is actually painted.
    picker.description_width.set(text_width.saturating_sub(4) as usize);
    let error_text = match &picker.phase {
        PickerPhase::Error(reason) => Some(format!("Loading analyst catalog failed: {reason}")),
        _ => None,
    };
    let error_rows = error_text
        .as_deref()
        .map(|e| wrap_notice(e, text_width, Style::default()).len() as u16)
        .unwrap_or(0);
    let verify_lines: Option<Vec<String>> = match (&picker.phase, &picker.plan) {
        (PickerPhase::Verify, Some(plan)) => Some(plan.lines()),
        _ => None,
    };
    let empty_copy = if picker.view == PickerView::Main && !picker.alternatives.is_empty() {
        format!(
            "No qualified analyst — press m for manual alternatives ({}).",
            picker.alternatives.len()
        )
    } else if picker.view == PickerView::Manual {
        "No manual alternatives for this project.".to_string()
    } else {
        "No ask-capable analyst model available for this project.".to_string()
    };
    let list_rows: u16 = picker
        .active()
        .iter()
        .map(|o| o.height_at(text_width.saturating_sub(4) as usize) as u16)
        .sum::<u16>()
        .max(1);
    // Verifying body (progress) and the optional detail view (`d`): plain lines.
    let detail_lines: Option<Vec<String>> = if picker.show_details {
        let lines = picker.detail_source();
        (!lines.is_empty()).then_some(lines)
    } else {
        None
    };
    let verifying_lines: Option<Vec<String>> = match (&picker.phase, &detail_lines) {
        (PickerPhase::Verifying, None) => Some(
            picker
                .progress
                .clone()
                .unwrap_or_default()
                .lines(),
        ),
        _ => None,
    };
    let project_rows: u16 = picker
        .project_line
        .as_deref()
        .filter(|_| matches!(picker.phase, PickerPhase::Ready | PickerPhase::Verify))
        .map(|line| wrap_notice(line, text_width, Style::default()).len() as u16)
        .unwrap_or(0);
    let plain_rows = |lines: &[String]| -> u16 {
        lines
            .iter()
            .map(|l| wrap_notice(l, text_width, Style::default()).len() as u16)
            .sum::<u16>()
            .max(1)
    };
    let content_rows = match &picker.phase {
        _ if detail_lines.is_some() => plain_rows(detail_lines.as_deref().unwrap_or(&[])),
        _ if verifying_lines.is_some() => plain_rows(verifying_lines.as_deref().unwrap_or(&[])),
        _ if verify_lines.is_some() => verify_lines
            .as_ref()
            .map(|lines| {
                lines
                    .iter()
                    .map(|l| wrap_notice(l, text_width, Style::default()).len() as u16)
                    .sum()
            })
            .unwrap_or(1),
        PickerPhase::Ready if picker.is_empty() => {
            wrap_notice(&empty_copy, text_width, Style::default()).len() as u16
        }
        PickerPhase::Ready => list_rows,
        PickerPhase::Loading | PickerPhase::Verifying | PickerPhase::Verify => 1,
        PickerPhase::Error(_) => error_rows.max(1),
    }
    .saturating_add(project_rows);
    // Grow the popup to fit every wrapped notice row (not just one fixed
    // row) so a long or multiline notice's final cause stays visible
    // instead of being clipped at the modal's edge.
    let footer = picker.footer_text();
    let notice_rows = footer
        .as_deref()
        .map(|n| wrap_notice(n, text_width, Style::default()).len() as u16)
        .unwrap_or(0);
    let height = content_rows
        .saturating_add(3 + notice_rows)
        .min(area.height.saturating_sub(2).max(5));
    let popup = centered_rect(area, width, height);
    if popup.width == 0 || popup.height == 0 {
        return;
    }

    Clear.render(popup, buf);
    let title = match &picker.phase {
        PickerPhase::Ready if picker.show_details => " Verification details — d back · Esc close ".to_string(),
        PickerPhase::Ready => match picker.view {
            PickerView::Main => format!(
                " Select analyst — top {} · m others ({}) · Enter · Esc · q quit ",
                picker.options.len().max(1),
                picker.alternatives.len()
            ),
            PickerView::Manual => format!(
                " Other verified analysts — m top ({}) · Enter · Esc · q quit ",
                picker.options.len()
            ),
        },
        PickerPhase::Loading => " Select analyst — loading · Esc cancel · q/Ctrl+C quit ".to_string(),
        PickerPhase::Verify => " Verify access — Enter verify · Esc skip · q quit ".to_string(),
        PickerPhase::Verifying if picker.show_details => " Verification details — d back · Esc close (checks keep running) ".to_string(),
        PickerPhase::Verifying => " Verifying access — Esc close (checks keep running) · d details · q quit ".to_string(),
        PickerPhase::Error(_) => " Select analyst — r retry · Esc close · q/Ctrl+C quit ".to_string(),
    };
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(tone::BORDER_FOCUS))
        .style(Style::default().bg(tone::SIDEBAR_BG))
        .title(Span::styled(
            title,
            Style::default()
                .fg(tone::ACCENT)
                .add_modifier(Modifier::BOLD),
        ));
    let inner = block.inner(popup);
    block.render(popup, buf);
    if inner.height == 0 || inner.width == 0 {
        return;
    }

    let notice_style = Style::default()
        .fg(tone::WARN)
        .add_modifier(Modifier::BOLD)
        .bg(tone::SIDEBAR_BG);
    let footer_lines: Vec<Line> = footer
        .as_deref()
        .map(|n| wrap_notice(n, inner.width, notice_style))
        .unwrap_or_default();
    let mut lines: Vec<Line> = Vec::new();
    if let Some(project) = picker
        .project_line
        .as_deref()
        .filter(|_| matches!(picker.phase, PickerPhase::Ready | PickerPhase::Verify))
    {
        lines.extend(wrap_notice(
            project,
            inner.width,
            Style::default().fg(tone::MUTED).bg(tone::SIDEBAR_BG),
        ));
    }
    if let Some(details) = &detail_lines {
        for text in details {
            lines.extend(wrap_notice(
                text,
                inner.width,
                Style::default().fg(tone::TEXT).bg(tone::SIDEBAR_BG),
            ));
        }
    } else if let Some(progress) = &verifying_lines {
        for (i, text) in progress.iter().enumerate() {
            let style = if i == 0 {
                notice_style
            } else {
                Style::default().fg(tone::TEXT).bg(tone::SIDEBAR_BG)
            };
            lines.extend(wrap_notice(text, inner.width, style));
        }
    } else if let Some(verify) = &verify_lines {
        for (i, text) in verify.iter().enumerate() {
            let style = if i == 0 {
                notice_style
            } else {
                Style::default().fg(tone::TEXT).bg(tone::SIDEBAR_BG)
            };
            lines.extend(wrap_notice(text, inner.width, style));
        }
    } else if let Some(error) = &error_text {
        let style = Style::default()
            .fg(tone::ERROR)
            .add_modifier(Modifier::BOLD)
            .bg(tone::SIDEBAR_BG);
        lines.extend(wrap_notice(error, inner.width, style));
    } else if picker.phase == PickerPhase::Loading {
        lines.push(padded_span(
            "Loading analyst catalog…",
            inner.width,
            Style::default().fg(tone::MUTED).bg(tone::SIDEBAR_BG),
        ));
    } else if picker.is_empty() {
        lines.extend(wrap_notice(
            &empty_copy,
            inner.width,
            Style::default().fg(tone::MUTED).bg(tone::SIDEBAR_BG),
        ));
    } else {
        // The list window leaves room for the footer so a long list never
        // pushes the provider causes / notices out of the modal.
        let list_budget = (inner.height as usize)
            .saturating_sub(footer_lines.len())
            .max(1);
        let range = picker.visible_range(list_budget);
        let start = range.start;
        for (offset, option) in picker.active()[range].iter().enumerate() {
            let selected = start + offset == picker.selected;
            let row_style = if selected {
                Style::default()
                    .fg(tone::TEXT)
                    .bg(tone::SELECT_BG)
                    .add_modifier(Modifier::BOLD)
            } else if !option.available {
                Style::default().fg(tone::MUTED).bg(tone::SIDEBAR_BG)
            } else {
                Style::default().fg(tone::TEXT).bg(tone::SIDEBAR_BG)
            };
            let marker = if selected { "› " } else { "  " };
            lines.push(padded_span(
                &format!("{marker}{}", option.row_label()),
                inner.width,
                row_style,
            ));
            let desc_style = if selected {
                Style::default().fg(tone::MUTED).bg(tone::SELECT_BG)
            } else {
                Style::default().fg(tone::MUTED).bg(tone::SIDEBAR_BG)
            };
            for desc in option.description_lines(picker.text_width()) {
                lines.push(padded_span(&format!("    {desc}"), inner.width, desc_style));
            }
        }
    }
    lines.extend(footer_lines);
    Paragraph::new(lines)
        .style(Style::default().bg(tone::SIDEBAR_BG))
        .render(inner, buf);
}

/// Visible session picker (U3a) — a centered modal listing the real Pi
/// session files for this cwd, labeled by their bound Kairo session id
/// (the same id `kairo list`/`resume` use) when one exists. Replaces blind
/// Ctrl+[ / Ctrl+] cycling with an explicit choice.
pub fn render_session_picker(buf: &mut Buffer, area: Rect, picker: &SessionPickerState) {
    let content_rows = picker.options.len().max(1) as u16;
    let width = area.width.saturating_sub(6).clamp(36, 76);
    let height = content_rows
        .saturating_add(3)
        .min(area.height.saturating_sub(2).max(5));
    let popup = centered_rect(area, width, height);
    if popup.width == 0 || popup.height == 0 {
        return;
    }

    Clear.render(popup, buf);
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(tone::BORDER_FOCUS))
        .style(Style::default().bg(tone::SIDEBAR_BG))
        .title(Span::styled(
            " Switch session — j/k · Enter · Esc cancel · q/Ctrl+C quit ",
            Style::default()
                .fg(tone::ACCENT)
                .add_modifier(Modifier::BOLD),
        ));
    let inner = block.inner(popup);
    block.render(popup, buf);
    if inner.height == 0 || inner.width == 0 {
        return;
    }

    let mut lines: Vec<Line> = Vec::new();
    if picker.options.is_empty() {
        lines.push(padded_span(
            "No Pi session files on disk for this project yet.",
            inner.width,
            Style::default().fg(tone::MUTED).bg(tone::SIDEBAR_BG),
        ));
    } else {
        for (i, option) in picker.options.iter().enumerate() {
            let selected = i == picker.selected;
            let row_style = if selected {
                Style::default()
                    .fg(tone::TEXT)
                    .bg(tone::SELECT_BG)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(tone::TEXT).bg(tone::SIDEBAR_BG)
            };
            let marker = if selected { "› " } else { "  " };
            lines.push(padded_span(
                &format!("{marker}{}", option.row_label()),
                inner.width,
                row_style,
            ));
        }
    }
    Paragraph::new(lines)
        .style(Style::default().bg(tone::SIDEBAR_BG))
        .render(inner, buf);
}

/// Pi `extension_ui` dialog modal (U3b): select / confirm / input / editor.
/// One at a time; Esc cancels with the same request id. Notify never uses
/// this renderer (it becomes a notice strip only).
pub fn render_extension_ui(buf: &mut Buffer, area: Rect, dialog: &ExtensionUiDialog) {
    let headline = dialog.headline();
    let width = area.width.saturating_sub(6).clamp(36, 76);
    let content_rows: u16 = match dialog.request.method {
        ExtensionUiMethod::Select => dialog.request.options.len().max(1) as u16 + 1,
        ExtensionUiMethod::Confirm => 3,
        ExtensionUiMethod::Input | ExtensionUiMethod::Editor => {
            let draft_rows = dialog.draft.lines().count().max(1) as u16;
            draft_rows.saturating_add(2)
        }
        ExtensionUiMethod::Notify | ExtensionUiMethod::FireAndForget { .. } => 1,
    };
    let height = content_rows
        .saturating_add(3)
        .min(area.height.saturating_sub(2).max(5));
    let popup = centered_rect(area, width, height);
    if popup.width == 0 || popup.height == 0 {
        return;
    }

    Clear.render(popup, buf);
    let title = match dialog.request.method {
        ExtensionUiMethod::Select => " Extension · select — j/k · Enter · Esc cancel ",
        ExtensionUiMethod::Confirm => " Extension · confirm — y/n · Enter · Esc cancel ",
        ExtensionUiMethod::Input => " Extension · input — Enter submit · Esc cancel ",
        ExtensionUiMethod::Editor => {
            " Extension · editor — Enter submit · Shift+Enter newline · Esc "
        }
        ExtensionUiMethod::Notify | ExtensionUiMethod::FireAndForget { .. } => " Extension ",
    };
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(tone::BORDER_FOCUS))
        .style(Style::default().bg(tone::SIDEBAR_BG))
        .title(Span::styled(
            title,
            Style::default()
                .fg(tone::ACCENT)
                .add_modifier(Modifier::BOLD),
        ));
    let inner = block.inner(popup);
    block.render(popup, buf);
    if inner.height == 0 || inner.width == 0 {
        return;
    }

    let mut lines: Vec<Line> = Vec::new();
    lines.push(padded_span(
        &headline,
        inner.width,
        Style::default()
            .fg(tone::TEXT)
            .bg(tone::SIDEBAR_BG)
            .add_modifier(Modifier::BOLD),
    ));

    match dialog.request.method {
        ExtensionUiMethod::Select => {
            if dialog.request.options.is_empty() {
                lines.push(padded_span(
                    "(no options)",
                    inner.width,
                    Style::default().fg(tone::MUTED).bg(tone::SIDEBAR_BG),
                ));
            } else {
                for (i, option) in dialog.request.options.iter().enumerate() {
                    let selected = i == dialog.selected;
                    let row_style = if selected {
                        Style::default()
                            .fg(tone::TEXT)
                            .bg(tone::SELECT_BG)
                            .add_modifier(Modifier::BOLD)
                    } else {
                        Style::default().fg(tone::TEXT).bg(tone::SIDEBAR_BG)
                    };
                    let marker = if selected { "› " } else { "  " };
                    lines.push(padded_span(
                        &format!("{marker}{option}"),
                        inner.width,
                        row_style,
                    ));
                }
            }
        }
        ExtensionUiMethod::Confirm => {
            for (i, label) in dialog.confirm_labels().iter().enumerate() {
                let selected = i == dialog.selected;
                let row_style = if selected {
                    Style::default()
                        .fg(tone::TEXT)
                        .bg(tone::SELECT_BG)
                        .add_modifier(Modifier::BOLD)
                } else {
                    Style::default().fg(tone::TEXT).bg(tone::SIDEBAR_BG)
                };
                let marker = if selected { "› " } else { "  " };
                lines.push(padded_span(
                    &format!("{marker}{label}"),
                    inner.width,
                    row_style,
                ));
            }
        }
        ExtensionUiMethod::Input | ExtensionUiMethod::Editor => {
            let draft = if dialog.draft.is_empty() {
                dialog
                    .request
                    .placeholder
                    .as_deref()
                    .unwrap_or("(type…)")
                    .to_string()
            } else {
                dialog.draft.clone()
            };
            let style = if dialog.draft.is_empty() {
                Style::default().fg(tone::MUTED).bg(tone::SIDEBAR_BG)
            } else {
                Style::default().fg(tone::TEXT).bg(tone::SIDEBAR_BG)
            };
            for line in draft.lines() {
                lines.push(padded_span(line, inner.width, style));
            }
        }
        ExtensionUiMethod::Notify | ExtensionUiMethod::FireAndForget { .. } => {}
    }

    Paragraph::new(lines)
        .style(Style::default().bg(tone::SIDEBAR_BG))
        .render(inner, buf);
}

/// Strategy recovery preview modal (U2c): "what changed" (real cause rows)
/// and "what we'd switch to" (the already-verified proposal), never
/// invented. Enter/`y` apply, `x` reject, Esc cancels locally (mutates
/// nothing — no server call is made on Esc).
pub fn render_recovery_preview(buf: &mut Buffer, area: Rect, preview: &RecoveryPreviewState) {
    let cause_lines = preview.cause_lines();
    let replacement_lines = preview.replacement_lines();
    let width = area.width.saturating_sub(6).clamp(40, 76);
    let notice_rows = preview
        .notice
        .as_deref()
        .map(|n| wrap_notice(n, width.saturating_sub(2), Style::default()).len() as u16)
        .unwrap_or(0);
    // Header rows: "Why" + "Proposed" section titles, one row per cause,
    // one per replacement, plus the optional notice.
    let content_rows = 2 + cause_lines.len().max(1) as u16 + replacement_lines.len().max(1) as u16;
    let height = content_rows
        .saturating_add(3 + notice_rows)
        .min(area.height.saturating_sub(2).max(6));
    let popup = centered_rect(area, width, height);
    if popup.width == 0 || popup.height == 0 {
        return;
    }

    Clear.render(popup, buf);
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(tone::BORDER_FOCUS))
        .style(Style::default().bg(tone::SIDEBAR_BG))
        .title(Span::styled(
            " Recovered team — Enter/y apply · x reject · Esc cancel ",
            Style::default()
                .fg(tone::ACCENT)
                .add_modifier(Modifier::BOLD),
        ));
    let inner = block.inner(popup);
    block.render(popup, buf);
    if inner.height == 0 || inner.width == 0 {
        return;
    }

    let mut lines: Vec<Line> = Vec::new();
    lines.push(padded_span(
        "Why:",
        inner.width,
        Style::default()
            .fg(tone::MUTED)
            .bg(tone::SIDEBAR_BG)
            .add_modifier(Modifier::BOLD),
    ));
    if cause_lines.is_empty() {
        lines.push(padded_span(
            "  (no cause reported)",
            inner.width,
            Style::default().fg(tone::MUTED).bg(tone::SIDEBAR_BG),
        ));
    } else {
        for line in &cause_lines {
            lines.push(padded_span(
                &format!("  {line}"),
                inner.width,
                Style::default().fg(tone::TEXT).bg(tone::SIDEBAR_BG),
            ));
        }
    }
    lines.push(padded_span(
        "Proposed:",
        inner.width,
        Style::default()
            .fg(tone::MUTED)
            .bg(tone::SIDEBAR_BG)
            .add_modifier(Modifier::BOLD),
    ));
    if replacement_lines.is_empty() {
        lines.push(padded_span(
            "  (no verified alternative)",
            inner.width,
            Style::default().fg(tone::MUTED).bg(tone::SIDEBAR_BG),
        ));
    } else {
        for line in &replacement_lines {
            lines.push(padded_span(
                &format!("  {line}"),
                inner.width,
                Style::default().fg(tone::ACCENT).bg(tone::SIDEBAR_BG),
            ));
        }
    }
    if let Some(notice) = &preview.notice {
        let notice_style = Style::default()
            .fg(tone::WARN)
            .add_modifier(Modifier::BOLD)
            .bg(tone::SIDEBAR_BG);
        lines.extend(wrap_notice(notice, inner.width, notice_style));
    }
    Paragraph::new(lines)
        .style(Style::default().bg(tone::SIDEBAR_BG))
        .render(inner, buf);
}

/// U4b: plans / timeline list + optional Markdown detail. Action hints live
/// in a footer that may wrap to two lines (never only in the title — a
/// 60-col title silently drops `y approve` / `n reject`).
pub fn render_plan_list(buf: &mut Buffer, area: Rect, plans: &PlanListState, work_mode: &str) {
    let width = area.width.saturating_sub(4).clamp(44, 84);
    let hints = plans.footer_hints(work_mode);
    let inner_w = width.saturating_sub(2).max(1);
    let footer_text_lines = wrap_hint_lines(&hints, inner_w as usize);
    let footer_rows = footer_text_lines.len().max(1) as u16;
    let notice_rows = plans
        .notice
        .as_deref()
        .map(|n| wrap_notice(n, width.saturating_sub(2), Style::default()).len() as u16)
        .unwrap_or(0);

    if let Some(detail) = &plans.detail {
        let md_lines: Vec<&str> = detail.markdown.lines().collect();
        let content_rows = (md_lines.len().max(1) as u16).saturating_add(2);
        let height = content_rows
            .saturating_add(2 + notice_rows + footer_rows)
            .min(area.height.saturating_sub(2).max(8));
        let popup = centered_rect(area, width, height);
        if popup.width == 0 || popup.height == 0 {
            return;
        }
        Clear.render(popup, buf);
        let title = format!(
            " Plan {} · {} — Esc close detail ",
            detail.task_id.chars().take(8).collect::<String>(),
            detail.state
        );
        let block = Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(tone::BORDER_FOCUS))
            .style(Style::default().bg(tone::SIDEBAR_BG))
            .title(Span::styled(
                title,
                Style::default()
                    .fg(tone::ACCENT)
                    .add_modifier(Modifier::BOLD),
            ));
        let inner = block.inner(popup);
        block.render(popup, buf);
        if inner.height == 0 || inner.width == 0 {
            return;
        }
        let footer = wrap_hint_lines(&hints, inner.width as usize);
        let footer_budget = footer.len().min(2).max(1) as u16;
        let body_budget = inner.height.saturating_sub(footer_budget);
        let mut lines: Vec<Line> = Vec::new();
        for line in md_lines.iter().take(body_budget.saturating_sub(notice_rows) as usize) {
            lines.push(padded_span(
                line,
                inner.width,
                Style::default().fg(tone::TEXT).bg(tone::SIDEBAR_BG),
            ));
        }
        if lines.is_empty() {
            lines.push(padded_span(
                "(empty)",
                inner.width,
                Style::default().fg(tone::MUTED).bg(tone::SIDEBAR_BG),
            ));
        }
        if let Some(notice) = &plans.notice {
            let notice_style = Style::default()
                .fg(tone::WARN)
                .add_modifier(Modifier::BOLD)
                .bg(tone::SIDEBAR_BG);
            lines.extend(wrap_notice(notice, inner.width, notice_style));
        }
        // Footer may use up to two wrapped hint lines so approve/reject stay visible.
        for hint_line in footer.iter().take(2) {
            if (lines.len() as u16) >= inner.height {
                break;
            }
            lines.push(padded_span(
                hint_line,
                inner.width,
                Style::default().fg(tone::MUTED).bg(tone::SIDEBAR_BG),
            ));
        }
        Paragraph::new(lines)
            .style(Style::default().bg(tone::SIDEBAR_BG))
            .render(inner, buf);
        return;
    }

    let content_rows = plans.rows.len().max(1) as u16;
    let height = content_rows
        .saturating_add(2 + notice_rows + footer_rows)
        .min(area.height.saturating_sub(2).max(6));
    let popup = centered_rect(area, width, height);
    if popup.width == 0 || popup.height == 0 {
        return;
    }
    Clear.render(popup, buf);
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(tone::BORDER_FOCUS))
        .style(Style::default().bg(tone::SIDEBAR_BG))
        .title(Span::styled(
            " Plans / tasks ",
            Style::default()
                .fg(tone::ACCENT)
                .add_modifier(Modifier::BOLD),
        ));
    let inner = block.inner(popup);
    block.render(popup, buf);
    if inner.height == 0 || inner.width == 0 {
        return;
    }

    let footer = wrap_hint_lines(&hints, inner.width as usize);
    let mut lines: Vec<Line> = Vec::new();
    if plans.rows.is_empty() {
        lines.push(padded_span(
            "No plans for this session yet.",
            inner.width,
            Style::default().fg(tone::MUTED).bg(tone::SIDEBAR_BG),
        ));
    } else {
        for (i, row) in plans.rows.iter().enumerate() {
            let selected = i == plans.selected;
            let row_style = if selected {
                Style::default()
                    .fg(tone::TEXT)
                    .bg(tone::SELECT_BG)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(tone::TEXT).bg(tone::SIDEBAR_BG)
            };
            let marker = if selected { "› " } else { "  " };
            lines.push(padded_span(
                &format!("{marker}{}", row.row_label()),
                inner.width,
                row_style,
            ));
        }
    }
    if let Some(notice) = &plans.notice {
        let notice_style = Style::default()
            .fg(tone::WARN)
            .add_modifier(Modifier::BOLD)
            .bg(tone::SIDEBAR_BG);
        lines.extend(wrap_notice(notice, inner.width, notice_style));
    }
    for hint_line in footer.iter().take(2) {
        lines.push(padded_span(
            hint_line,
            inner.width,
            Style::default().fg(tone::MUTED).bg(tone::SIDEBAR_BG),
        ));
    }
    Paragraph::new(lines)
        .style(Style::default().bg(tone::SIDEBAR_BG))
        .render(inner, buf);
}

/// Wrap plan/action hint strings on ` · ` boundaries first so tokens like
/// `y approve` / `n reject` stay intact at narrow widths; fall back to
/// character wrap only when a single token exceeds `width`.
fn wrap_hint_lines(hints: &str, width: usize) -> Vec<String> {
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
    let mut out: Vec<String> = Vec::new();
    for line in lines {
        if line.chars().count() <= width {
            out.push(line);
        } else {
            out.extend(wrap_text_segment(&line, width));
        }
    }
    out
}

/// Word-wraps one segment (no `\n` inside it) to at most `width` visible
/// columns, falling back to character-wrapping a single word that alone
/// exceeds `width` (never truncated, never overrun). Always returns at
/// least one entry, including an empty one for a blank segment (an empty
/// line between two `\n`s in the source notice) so line counts stay
/// faithful to the original text.
fn wrap_text_segment(segment: &str, width: usize) -> Vec<String> {
    let width = width.max(1);
    let mut lines: Vec<String> = Vec::new();
    let mut current = String::new();
    for word in segment.split(' ') {
        if word.chars().count() > width {
            if !current.is_empty() {
                lines.push(std::mem::take(&mut current));
            }
            let mut chunk = String::new();
            for ch in word.chars() {
                if chunk.chars().count() >= width {
                    lines.push(std::mem::take(&mut chunk));
                }
                chunk.push(ch);
            }
            current = chunk;
            continue;
        }
        let candidate_len = if current.is_empty() {
            word.chars().count()
        } else {
            current.chars().count() + 1 + word.chars().count()
        };
        if candidate_len > width {
            lines.push(std::mem::take(&mut current));
            current = word.to_string();
        } else {
            if !current.is_empty() {
                current.push(' ');
            }
            current.push_str(word);
        }
    }
    if !current.is_empty() || lines.is_empty() {
        lines.push(current);
    }
    lines
}

/// Splits a notice on `\n`, then word/char-wraps each segment to
/// `inner_width` — the first output line overall is prefixed `⚠ `, every
/// other line (whether wrapped within a segment or a later `\n` segment)
/// is indented by 2 spaces, so the wrapped block still reads as one
/// visual unit and no cause is clipped at the pane width. Returns owned
/// `Line`s so scroll offsets and popup sizing count real screen rows.

/// U4c: role picker before planExecution preview.
pub fn render_role_select(buf: &mut Buffer, area: Rect, state: &RoleSelectState) {
    let width = area.width.saturating_sub(6).clamp(36, 64);
    let content_rows = (state.roles.len().max(1) as u16).saturating_add(2);
    let height = content_rows
        .saturating_add(3)
        .min(area.height.saturating_sub(2).max(6));
    let popup = centered_rect(area, width, height);
    if popup.width == 0 || popup.height == 0 {
        return;
    }
    Clear.render(popup, buf);
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(tone::BORDER_FOCUS))
        .style(Style::default().bg(tone::SIDEBAR_BG))
        .title(Span::styled(
            " Which role is this task for? ",
            Style::default()
                .fg(tone::ACCENT)
                .add_modifier(Modifier::BOLD),
        ));
    let inner = block.inner(popup);
    block.render(popup, buf);
    if inner.height == 0 || inner.width == 0 {
        return;
    }
    let mut lines: Vec<Line> = Vec::new();
    for (i, role) in state.roles.iter().enumerate() {
        let marker = if i == state.selected { "> " } else { "  " };
        let style = if i == state.selected {
            Style::default()
                .fg(tone::ACCENT)
                .bg(tone::SELECT_BG)
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(tone::TEXT).bg(tone::SIDEBAR_BG)
        };
        lines.push(padded_span(&format!("{marker}{role}"), inner.width, style));
    }
    if lines.is_empty() {
        lines.push(padded_span(
            "(no roles)",
            inner.width,
            Style::default().fg(tone::MUTED).bg(tone::SIDEBAR_BG),
        ));
    }
    lines.push(padded_span(
        state.footer_hints(),
        inner.width,
        Style::default().fg(tone::MUTED).bg(tone::SIDEBAR_BG),
    ));
    Paragraph::new(lines)
        .style(Style::default().bg(tone::SIDEBAR_BG))
        .render(inner, buf);
}

/// U4c: confirm-execute nested modal — owns y/n so list approve/reject never fires.
pub fn render_confirm_execute(buf: &mut Buffer, area: Rect, state: &ConfirmExecuteState) {
    let width = area.width.saturating_sub(6).clamp(40, 76);
    let prompt = state.prompt_lines();
    let content_rows = prompt.len().max(1) as u16;
    let height = content_rows
        .saturating_add(3)
        .min(area.height.saturating_sub(2).max(6));
    let popup = centered_rect(area, width, height);
    if popup.width == 0 || popup.height == 0 {
        return;
    }
    Clear.render(popup, buf);
    let title = if state.can_confirm() {
        " Confirm execute "
    } else {
        " Cannot auto-execute "
    };
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(tone::BORDER_FOCUS))
        .style(Style::default().bg(tone::SIDEBAR_BG))
        .title(Span::styled(
            title,
            Style::default()
                .fg(tone::ACCENT)
                .add_modifier(Modifier::BOLD),
        ));
    let inner = block.inner(popup);
    block.render(popup, buf);
    if inner.height == 0 || inner.width == 0 {
        return;
    }
    let mut lines: Vec<Line> = Vec::new();
    for (i, line) in prompt.iter().enumerate() {
        let style = if i == 0 {
            Style::default()
                .fg(if state.can_confirm() {
                    tone::WARN
                } else {
                    tone::ERROR
                })
                .add_modifier(Modifier::BOLD)
                .bg(tone::SIDEBAR_BG)
        } else {
            Style::default().fg(tone::MUTED).bg(tone::SIDEBAR_BG)
        };
        lines.push(padded_span(line, inner.width, style));
    }
    lines.push(padded_span(
        state.footer_hints(),
        inner.width,
        Style::default().fg(tone::MUTED).bg(tone::SIDEBAR_BG),
    ));
    Paragraph::new(lines)
        .style(Style::default().bg(tone::SIDEBAR_BG))
        .render(inner, buf);
}

/// U4d: Project view — team/result surface with chrome that names the active view.
pub fn render_project_view(
    buf: &mut Buffer,
    regions: ShellRegions,
    model: &ShellViewModel,
    chat: &ChatState,
    editor: &TextArea<'_>,
    workspace: WorkspaceView,
) {
    if let Some(sidebar) = regions.sidebar {
        render_sidebar(buf, sidebar, model, chat.focus);
    }
    let work = split_work_main(regions.main);
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
            workspace.chrome_title_for_width(work.transcript.width),
            Style::default()
                .fg(tone::ACCENT)
                .add_modifier(Modifier::BOLD),
        ));
    let inner = block.inner(work.transcript);
    block.render(work.transcript, buf);
    let mut lines: Vec<Line> = Vec::new();
    let state = model.team_state.as_deref().unwrap_or("not_analyzed");
    lines.push(padded_span(
        &format!("Project team · {}", state.to_ascii_uppercase()),
        inner.width,
        Style::default()
            .fg(tone::TEXT)
            .add_modifier(Modifier::BOLD)
            .bg(tone::WORK_BG),
    ));
    if model.agents.is_empty() {
        lines.push(padded_span(
            "No roles yet — /analyze (or a) to suggest a team.",
            inner.width,
            Style::default().fg(tone::MUTED).bg(tone::WORK_BG),
        ));
    } else {
        for (i, agent) in model.agents.iter().enumerate() {
            let selected = i == model.selected_agent;
            let style = if selected {
                Style::default()
                    .fg(tone::TEXT)
                    .bg(tone::SELECT_BG)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(tone::TEXT).bg(tone::WORK_BG)
            };
            let marker = if selected { "› " } else { "  " };
            lines.push(padded_span(
                &format!("{marker}{} — {}", agent.label, agent.detail),
                inner.width,
                style,
            ));
        }
        let hint = if state == "suggested" {
            "Enter = edit selected role · A = approve · Esc → Work"
        } else {
            "ACTIVE/STALE are read-only · /analyze to re-suggest · Esc → Work"
        };
        lines.push(padded_span(
            hint,
            inner.width,
            Style::default().fg(tone::MUTED).bg(tone::WORK_BG),
        ));
    }
    Paragraph::new(lines)
        .style(Style::default().bg(tone::WORK_BG))
        .render(inner, buf);
    render_editor(buf, work.editor, chat.focus, editor, &model.work_mode);
    render_usage(buf, regions.usage, model);
}

/// U5a: Operations hub — sidebar + USAGE preserved; main column is read-only ops.
pub fn render_operations_view(
    buf: &mut Buffer,
    regions: ShellRegions,
    model: &ShellViewModel,
    chat: &ChatState,
    ops: &OpsPanelState,
    workspace: WorkspaceView,
) {
    if let Some(sidebar) = regions.sidebar {
        render_sidebar(buf, sidebar, model, chat.focus);
    }
    render_ops_panel(
        buf,
        regions.main,
        ops,
        &workspace.chrome_title_for_width(regions.main.width),
    );
    render_usage(buf, regions.usage, model);
}

/// U5b: Settings — profile / integrations / connections + setup stub.
pub fn render_settings_view(
    buf: &mut Buffer,
    regions: ShellRegions,
    model: &ShellViewModel,
    chat: &ChatState,
    settings: &SettingsPanelState,
    workspace: WorkspaceView,
) {
    if let Some(sidebar) = regions.sidebar {
        render_sidebar(buf, sidebar, model, chat.focus);
    }
    render_settings_panel(
        buf,
        regions.main,
        settings,
        &workspace.chrome_title_for_width(regions.main.width),
    );
    render_usage(buf, regions.usage, model);
}

/// U4d: per-role model search / confirm modal.
pub fn render_role_editor(buf: &mut Buffer, area: Rect, editor: &RoleEditorState) {
    let width = area.width.saturating_sub(6).clamp(40, 76);
    let rows = editor.filtered.len().max(1) as u16;
    let height = rows
        .saturating_add(5)
        .min(area.height.saturating_sub(2).max(8));
    let popup = centered_rect(area, width, height);
    if popup.width == 0 || popup.height == 0 {
        return;
    }
    Clear.render(popup, buf);
    let title = match editor.phase {
        crate::role_editor::RoleEditPhase::Loading => format!(" Edit {} · loading ", editor.role),
        crate::role_editor::RoleEditPhase::Saving => format!(" Edit {} · saving ", editor.role),
        crate::role_editor::RoleEditPhase::Confirm => format!(" Edit {} · confirm ", editor.role),
        crate::role_editor::RoleEditPhase::ModelSearch => {
            format!(" Edit {} · search ", editor.role)
        }
    };
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(tone::BORDER_FOCUS))
        .style(Style::default().bg(tone::SIDEBAR_BG))
        .title(Span::styled(
            title,
            Style::default()
                .fg(tone::ACCENT)
                .add_modifier(Modifier::BOLD),
        ));
    let inner = block.inner(popup);
    block.render(popup, buf);
    if inner.height == 0 || inner.width == 0 {
        return;
    }
    let mut lines: Vec<Line> = Vec::new();
    if !editor.query.is_empty()
        || matches!(
            editor.phase,
            crate::role_editor::RoleEditPhase::ModelSearch
        )
    {
        lines.push(padded_span(
            &format!("filter: {}", editor.query),
            inner.width,
            Style::default().fg(tone::MUTED).bg(tone::SIDEBAR_BG),
        ));
    }
    if editor.filtered.is_empty() {
        lines.push(padded_span(
            "(no candidates)",
            inner.width,
            Style::default().fg(tone::MUTED).bg(tone::SIDEBAR_BG),
        ));
    } else {
        for (i, &cand_idx) in editor.filtered.iter().enumerate() {
            let Some(c) = editor.candidates.get(cand_idx) else {
                continue;
            };
            let selected = i == editor.selected;
            let style = if selected {
                Style::default()
                    .fg(tone::TEXT)
                    .bg(tone::SELECT_BG)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(tone::TEXT).bg(tone::SIDEBAR_BG)
            };
            let marker = if selected { "› " } else { "  " };
            let tag = if c.tag.is_empty() {
                String::new()
            } else {
                format!(" · {}", c.tag)
            };
            lines.push(padded_span(
                &format!("{marker}{}  {}{tag}", c.display_name, c.adapter_id),
                inner.width,
                style,
            ));
        }
    }
    if let Some(notice) = &editor.notice {
        lines.push(padded_span(
            notice,
            inner.width,
            Style::default().fg(tone::WARN).bg(tone::SIDEBAR_BG),
        ));
    }
    lines.push(padded_span(
        editor.footer_hints(),
        inner.width,
        Style::default().fg(tone::MUTED).bg(tone::SIDEBAR_BG),
    ));
    Paragraph::new(lines)
        .style(Style::default().bg(tone::SIDEBAR_BG))
        .render(inner, buf);
}

fn wrap_notice(notice: &str, inner_width: u16, style: Style) -> Vec<Line<'static>> {
    // "⚠ " and "  " are both 2 columns, so the wrap width is the same
    // whether a line is the leading prefix or a continuation indent.
    let avail = (inner_width as usize).saturating_sub(2).max(1);
    let mut out: Vec<Line<'static>> = Vec::new();
    let mut is_first = true;
    for segment in notice.split('\n') {
        for wrapped in wrap_text_segment(segment, avail) {
            let text = if is_first {
                format!("⚠ {wrapped}")
            } else {
                format!("  {wrapped}")
            };
            out.push(Line::from(Span::styled(text, style)));
            is_first = false;
        }
    }
    out
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
        buf.content()
            .iter()
            .map(|c| c.symbol().to_string())
            .collect()
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
        assert_eq!(
            cell_bg(&buf, sidebar.x + 1, sidebar.y + 1),
            tone::SIDEBAR_BG
        );
        assert_eq!(
            cell_bg(&buf, regions.main.x + 2, regions.main.y + 2),
            tone::WORK_BG
        );
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
    fn thinking_row_renders_distinct_from_assistant_row() {
        let assistant = ChatMessage {
            role: MessageRole::Assistant,
            content: "hi there".into(),
            streaming: false,
            is_error: false,
            tool_call_id: None,
        };
        let thinking = ChatMessage {
            role: MessageRole::Thinking,
            content: "pondering the question".into(),
            streaming: false,
            is_error: false,
            tool_call_id: None,
        };
        let assistant_line = &message_to_lines(&assistant, 120)[0];
        let thinking_line = &message_to_lines(&thinking, 120)[0];

        let assistant_prefix = assistant_line.spans[0].content.to_string();
        let thinking_prefix = thinking_line.spans[0].content.to_string();
        assert!(assistant_prefix.contains("assistant"));
        assert!(thinking_prefix.contains("thinking"));
        assert_ne!(
            assistant_prefix, thinking_prefix,
            "thinking must never render under the assistant prefix"
        );

        // Distinct style, not just distinct label: thinking is italic, the
        // assistant body is not — so a thinking row never reads as the
        // model's actual answer even at a glance.
        let thinking_body_style = thinking_line.spans[1].style;
        let assistant_body_style = assistant_line.spans[1].style;
        assert!(thinking_body_style.add_modifier.contains(Modifier::ITALIC));
        assert!(!assistant_body_style.add_modifier.contains(Modifier::ITALIC));
    }

    #[test]
    fn tool_error_row_is_visually_distinct_from_tool_success_row() {
        let ok = ChatMessage {
            role: MessageRole::Tool,
            content: "✓ Read".into(),
            streaming: false,
            is_error: false,
            tool_call_id: None,
        };
        let err = ChatMessage {
            role: MessageRole::Tool,
            content: "✖ Read".into(),
            streaming: false,
            is_error: true,
            tool_call_id: None,
        };
        let ok_color = message_to_lines(&ok, 120)[0].spans[0].style.fg;
        let err_color = message_to_lines(&err, 120)[0].spans[0].style.fg;
        assert_eq!(ok_color, Some(tone::TOOL));
        assert_eq!(err_color, Some(tone::ERROR));
        assert_ne!(
            ok_color, err_color,
            "a failed tool result must not share the successful-tool color"
        );
    }

    #[test]
    fn assistant_stream_error_row_uses_error_tone() {
        let err = ChatMessage {
            role: MessageRole::Error,
            content: "provider timeout".into(),
            streaming: false,
            is_error: true,
            tool_call_id: None,
        };
        let line = &message_to_lines(&err, 120)[0];
        assert_eq!(line.spans[0].style.fg, Some(tone::ERROR));
        assert!(line.spans[0].content.contains("error"));
    }

    fn line_plain(line: &Line<'_>) -> String {
        line.spans.iter().map(|s| s.content.as_ref()).collect()
    }

    #[test]
    fn message_to_lines_wraps_long_thinking_and_assistant_at_narrow_width() {
        let thinking_body =
            "FIXTURE thinking — weighing OAuth vs session cookies and refresh tokens carefully";
        let assistant_body =
            "FIXTURE assistant — propose OAuth login with refresh tokens and short-lived access.";
        let thinking = ChatMessage {
            role: MessageRole::Thinking,
            content: thinking_body.into(),
            streaming: false,
            is_error: false,
            tool_call_id: None,
        };
        let assistant = ChatMessage {
            role: MessageRole::Assistant,
            content: assistant_body.into(),
            streaming: false,
            is_error: false,
            tool_call_id: None,
        };
        // Inner chat width at 60 cols is typically ~58; use 50 to force wrap.
        let width = 50u16;
        let thinking_lines = message_to_lines(&thinking, width);
        let assistant_lines = message_to_lines(&assistant, width);
        assert!(
            thinking_lines.len() > 1,
            "long thinking must wrap to multiple screen lines, got {}",
            thinking_lines.len()
        );
        assert!(
            assistant_lines.len() > 1,
            "long assistant must wrap to multiple screen lines, got {}",
            assistant_lines.len()
        );
        for line in thinking_lines.iter().chain(assistant_lines.iter()) {
            assert!(
                line_plain(line).chars().count() <= width as usize,
                "wrapped line must not exceed pane width: {}",
                line_plain(line)
            );
        }
        let thinking_rejoined: String = thinking_lines
            .iter()
            .map(|l| {
                let s = line_plain(l);
                s.strip_prefix("thinking: ")
                    .unwrap_or(s.trim_start())
                    .to_string()
            })
            .collect::<Vec<_>>()
            .join(" ");
        // Spaces between wrap chunks match wrap_text_segment word breaks.
        let thinking_compact: String = thinking_rejoined.split_whitespace().collect();
        let expected_t: String = thinking_body.split_whitespace().collect();
        assert_eq!(
            thinking_compact, expected_t,
            "wrap must not drop thinking tokens"
        );
        assert!(
            thinking_rejoined.contains("cookies") || thinking_compact.contains("cookies"),
            "final thinking tokens must remain reachable after wrap"
        );
        let assistant_joined: String = assistant_lines
            .iter()
            .map(|l| {
                let s = line_plain(l);
                s.strip_prefix("assistant: ")
                    .unwrap_or(s.trim_start())
                    .to_string()
            })
            .collect::<Vec<_>>()
            .join(" ");
        let assistant_compact: String = assistant_joined.split_whitespace().collect();
        let expected_a: String = assistant_body.split_whitespace().collect();
        assert_eq!(
            assistant_compact, expected_a,
            "wrap must not drop assistant tokens"
        );
    }

    #[test]
    fn tool_message_separates_name_from_result_body() {
        let msg = ChatMessage {
            role: MessageRole::Tool,
            content: "✓ Read\nFIXTURE tool ok — src/auth/oauth.ts".into(),
            streaming: false,
            is_error: false,
            tool_call_id: Some("call_1".into()),
        };
        let lines = message_to_lines(&msg, 80);
        assert!(
            lines.len() >= 2,
            "tool name and result must paint as separate lines, got {}",
            lines.len()
        );
        let first = line_plain(&lines[0]);
        let second = line_plain(&lines[1]);
        assert!(
            first.contains("✓ Read") && !first.contains("FIXTURE"),
            "first line is the tool name only: {first}"
        );
        assert!(
            second.contains("FIXTURE tool ok") && !second.contains("✓ Read"),
            "second line is the result body: {second}"
        );
        let hay: String = lines.iter().map(line_plain).collect();
        assert!(
            !hay.contains("ReadFIXTURE"),
            "name and result must not concatenate: {hay}"
        );
    }

    #[test]
    fn plan_list_footer_keeps_approve_reject_visible_at_60_cols() {
        use serde_json::json;
        let plans = PlanListState::from_plans_record(&json!({
            "type": "plans",
            "timeline": [{
                "taskId": "v3-plan-aaaaaaaa-1111",
                "taskText": "FIXTURE plan — OAuth login flow",
                "state": "awaiting_approval",
                "approval": "not_decided",
                "planReady": true,
                "execution": { "state": "not_started", "active": false }
            }],
            "projectTeamRoles": ["Architect"]
        }));
        assert!(plans.can_decide("plan"));
        let area = Rect::new(0, 0, 60, 30);
        let mut buf = Buffer::empty(area);
        render_plan_list(&mut buf, area, &plans, "plan");
        let hay = buffer_text(&buf);
        assert!(
            hay.contains("y approve"),
            "60-col plans footer must keep approve hint: {hay}"
        );
        assert!(
            hay.contains("n reject"),
            "60-col plans footer must keep reject hint: {hay}"
        );
        // Title stays short — hints belong in the footer, not the clipped title.
        assert!(
            hay.contains("Plans / tasks"),
            "plans title must remain: {hay}"
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
        let hay = buffer_text(&buf);
        assert!(
            hay.contains("Message Kairo") && hay.contains("ASK"),
            "compose chrome must show live WorkMode like cockpit: {hay}"
        );
    }

    #[test]
    fn compose_chrome_reflects_work_mode_change() {
        let area = Rect::new(0, 0, 100, 30);
        let regions = split_shell(area);
        let mut buf = Buffer::empty(area);
        let mut model = ShellViewModel::default();
        model.work_mode = "agent".into();
        render_shell(
            &mut buf,
            regions,
            &model,
            &ChatState::default(),
            &default_editor(),
        );
        let hay = buffer_text(&buf);
        assert!(
            hay.contains("AGENT"),
            "compose title must update when WorkMode changes: {hay}"
        );
        assert!(!hay.contains(" ASK "), "must not still show ASK when mode is agent");
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
        model.agents = vec![SidebarAgent {
            label: "Orchestrator".into(),
            detail: "idle".into(),
            state: AgentState::Idle,
            cause: BlockCause::Unavailable,
        }];
        model.selected_agent = 0;
        let mut chat = ChatState::default();
        chat.focus = Focus::Sidebar;
        render_shell(&mut buf, regions, &model, &chat, &default_editor());

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
        assert!(
            hay.contains("Pi engine unavailable"),
            "buffer missing notice: {hay}"
        );
    }

    #[test]
    fn work_surface_wraps_multiline_notice_showing_every_line() {
        let area = Rect::new(0, 0, 100, 30);
        let regions = split_shell(area);
        let mut buf = Buffer::empty(area);
        let mut model = ShellViewModel::default();
        model.notice = Some("first line of notice\nsecond line of notice\nTHIRD_LINE_TOKEN".into());
        render_shell(
            &mut buf,
            regions,
            &model,
            &ChatState::default(),
            &default_editor(),
        );

        let hay = buffer_text(&buf);
        assert!(
            hay.contains("first"),
            "buffer missing first notice line: {hay}"
        );
        assert!(
            hay.contains("second"),
            "buffer missing second notice line: {hay}"
        );
        assert!(
            hay.contains("THIRD_LINE_TOKEN"),
            "buffer missing final notice line — multiline notices must not clip the last line: {hay}"
        );
    }

    #[test]
    fn work_surface_wraps_long_notice_in_narrow_area_and_reaches_final_token_when_scrolled() {
        let area = Rect::new(0, 0, 30, 24);
        let regions = split_shell(area);
        let mut buf = Buffer::empty(area);
        let mut model = ShellViewModel::default();
        let long_notice = format!("{}FINAL_SUFFIX_TOKEN", "word ".repeat(40));
        model.notice = Some(long_notice);
        let mut chat = ChatState::default();
        // Scroll to the end so the final wrapped row (the real cause) is
        // reachable, not just proven to exist off-screen.
        chat.scroll_offset = usize::MAX / 2;
        render_shell(&mut buf, regions, &model, &chat, &default_editor());

        let hay = buffer_text(&buf);
        assert!(
            hay.contains("FINAL_SUFFIX_TOKEN"),
            "long single-line notice must word-wrap in a narrow area so its final token is reachable: {hay}"
        );
    }

    #[test]
    fn analyst_picker_modal_grows_to_fit_and_shows_a_long_wrapped_notice() {
        use crate::analyst_picker::{AnalystOption, AnalystPickerState};

        let area = Rect::new(0, 0, 100, 30);
        let long_notice = format!("{}FINAL_SUFFIX_TOKEN", "word ".repeat(30));
        let picker = AnalystPickerState {
            options: vec![AnalystOption {
                candidate_key: "codex::gpt".into(),
                adapter_id: "codex".into(),
                model_id: "gpt".into(),
                display_name: "GPT".into(),
                available: true,
                subscription: "codex".into(),
                recommended: false,
                tags: vec![],
                explanation: None,
            }],
            selected: 0,
            notice: Some(long_notice),
            ..Default::default()
        };
        let mut buf = Buffer::empty(area);
        render_analyst_picker(&mut buf, area, &picker);

        let hay = buffer_text(&buf);
        assert!(
            hay.contains("FINAL_SUFFIX_TOKEN"),
            "picker's long notice must wrap (and the popup grow to fit) so the final token is visible: {hay}"
        );
    }

    #[test]
    fn analyst_picker_modal_never_paints_an_unverified_access_row() {
        use crate::analyst_picker::AnalystPickerState;
        use serde_json::json;

        let area = Rect::new(0, 0, 100, 30);
        let picker = AnalystPickerState::from_analyst_catalog(&json!({
            "models": [
                { "candidateKey": "codex::gpt", "adapterId": "codex", "modelId": "gpt",
                  "displayName": "GPT Verified", "available": true, "accessVerified": true, "selectable": true },
                { "candidateKey": "claude::unv", "adapterId": "claude", "modelId": "unv",
                  "displayName": "Claude Unverified", "available": false, "accessVerified": false, "selectable": true }
            ]
        }));
        let mut buf = Buffer::empty(area);
        render_analyst_picker(&mut buf, area, &picker);
        let hay = buffer_text(&buf);
        assert!(hay.contains("GPT Verified"), "{hay}");
        assert!(!hay.contains("Claude Unverified"), "unknown access is reported separately, never listed: {hay}");
        assert!(!hay.contains("acceso sin verificar"), "{hay}");
    }

    #[test]
    fn recovery_preview_modal_shows_the_real_cause_and_the_proposed_replacement() {
        use crate::recovery_picker::{
            RecoveryCauseRow, RecoveryPreviewState, RecoveryReplacementRow,
        };

        let area = Rect::new(0, 0, 100, 30);
        let preview = RecoveryPreviewState {
            causes: vec![RecoveryCauseRow {
                role: "Orchestrator".into(),
                model: "Kimi K3".into(),
                reason: "OpenCode Go monthly window is rate-limited".into(),
            }],
            replacements: vec![RecoveryReplacementRow {
                role: "Orchestrator".into(),
                model: "GPT-6 Terra".into(),
            }],
            notice: None,
        };
        let mut buf = Buffer::empty(area);
        render_recovery_preview(&mut buf, area, &preview);

        let hay = buffer_text(&buf);
        assert!(hay.contains("Orchestrator"));
        assert!(hay.contains("rate-limited"));
        assert!(
            !hay.to_lowercase().contains("quota"),
            "must never show an invented quota cause: {hay}"
        );
        assert!(hay.contains("GPT-6"));
        assert!(hay.contains("apply"));
        assert!(hay.contains("reject"));
    }

    #[test]
    fn recovery_preview_modal_grows_to_fit_a_long_wrapped_refusal_notice() {
        use crate::recovery_picker::RecoveryPreviewState;

        let area = Rect::new(0, 0, 100, 30);
        let long_notice = format!(
            "{}FINAL_SUFFIX_TOKEN",
            "The active team changed since the proposal was built ".repeat(4)
        );
        let preview = RecoveryPreviewState {
            causes: vec![],
            replacements: vec![],
            notice: Some(long_notice),
        };
        let mut buf = Buffer::empty(area);
        render_recovery_preview(&mut buf, area, &preview);

        let hay = buffer_text(&buf);
        assert!(
            hay.contains("FINAL_SUFFIX_TOKEN"),
            "a stale-apply refusal notice must wrap (and the popup grow) so the final token is visible: {hay}"
        );
    }

    #[test]
    fn recovery_preview_modal_never_invents_rows_when_the_record_had_none() {
        use crate::recovery_picker::RecoveryPreviewState;

        let area = Rect::new(0, 0, 100, 30);
        let preview = RecoveryPreviewState::default();
        let mut buf = Buffer::empty(area);
        render_recovery_preview(&mut buf, area, &preview);

        let hay = buffer_text(&buf);
        assert!(hay.contains("no cause reported"));
        assert!(hay.contains("no verified alternative"));
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
        assert_eq!(
            cell_bg(&buf, regions.main.x + 2, regions.main.y + 2),
            tone::WORK_BG
        );
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
        for bg in [
            tone::WORK_BG,
            tone::SIDEBAR_BG,
            tone::USAGE_BG,
            tone::SELECT_BG,
        ] {
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
        model.agents = vec![
            SidebarAgent {
                label: "Orchestrator".into(),
                detail: "idle".into(),
                state: AgentState::Idle,
                cause: BlockCause::Unavailable,
            },
            SidebarAgent {
                label: "Builder".into(),
                detail: "blocked".into(),
                state: AgentState::Blocked,
                cause: BlockCause::Unavailable,
            },
        ];
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
    fn empty_agents_paint_honest_no_team_copy() {
        let area = Rect::new(0, 0, 100, 30);
        let regions = split_shell(area);
        let mut buf = Buffer::empty(area);
        let model = ShellViewModel::default();
        assert!(
            model.agents.is_empty(),
            "default must not invent team roles"
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
            hay.contains("No team yet"),
            "empty AGENTS hint missing: {hay}"
        );
        assert!(
            hay.contains("a = analyze"),
            "empty sidebar must name the in-UI analyze key: {hay}"
        );
        assert!(
            !hay.contains("Orchestrator"),
            "must not invent Orchestrator"
        );
        assert!(!hay.contains("Builder"), "must not invent Builder");
    }

    fn hidden_model(state: &str) -> ShellViewModel {
        let mut model = ShellViewModel::default();
        model.agents = vec![
            SidebarAgent {
                label: "Orchestrator".into(),
                detail: "kimi".into(),
                state: AgentState::Idle,
                cause: BlockCause::Unavailable,
            },
            SidebarAgent {
                label: "Builder".into(),
                detail: "codex".into(),
                state: AgentState::Blocked,
                cause: BlockCause::Unavailable,
            },
        ];
        model.team_state = Some("active".into());
        model.team_presentation = Some(state.into());
        model.roles_visible = false;
        model
    }

    fn sidebar_hay(model: &ShellViewModel) -> String {
        let area = Rect::new(0, 0, 100, 30);
        let regions = split_shell(area);
        let mut buf = Buffer::empty(area);
        render_shell(
            &mut buf,
            regions,
            model,
            &ChatState::default(),
            &default_editor(),
        );
        buffer_text(&buf)
    }

    #[test]
    fn hidden_roles_show_compact_notice_per_state_and_no_role_rows() {
        for (state, needle) in [
            ("incomplete", "Team incomplete"),
            ("blocked", "Team blocked"),
            ("verifying", "Verifying team access"),
        ] {
            let hay = sidebar_hay(&hidden_model(state));
            assert!(hay.contains(needle), "{state}: missing {needle}: {hay}");
            assert!(!hay.contains("Orchestrator"), "{state}: role leaked: {hay}");
            assert!(!hay.contains("Builder"), "{state}: role leaked: {hay}");
        }
    }

    #[test]
    fn hidden_roles_notice_names_the_reanalyze_key_in_every_state() {
        for state in ["incomplete", "blocked", "verifying"] {
            let hay = sidebar_hay(&hidden_model(state));
            assert!(hay.contains("a = re-analyze"), "{state}: no key hint: {hay}");
        }
    }

    #[test]
    fn suggested_hidden_team_still_offers_approve_alongside_reanalyze() {
        let mut model = hidden_model("incomplete");
        model.team_state = Some("suggested".into());
        let hay = sidebar_hay(&model);
        assert!(hay.contains("A = approve"), "{hay}");
        assert!(hay.contains("a = re-analyze"), "{hay}");
    }

    #[test]
    fn verifying_notice_never_mentions_quota() {
        let hay = sidebar_hay(&hidden_model("verifying")).to_ascii_lowercase();
        assert!(!hay.contains("quota"), "verifying must not claim quota: {hay}");
        assert!(!hay.contains("funds"), "verifying must not claim funds: {hay}");
    }

    #[test]
    fn visible_roles_render_again_when_the_team_is_complete() {
        let mut model = hidden_model("complete");
        model.roles_visible = true;
        let hay = sidebar_hay(&model);
        assert!(hay.contains("Orchestrator") && hay.contains("Builder"), "{hay}");
        assert!(!hay.contains("Team incomplete"));
    }

    #[test]
    fn empty_sidebar_offers_approve_key_once_a_team_is_suggested() {
        let area = Rect::new(0, 0, 100, 30);
        let regions = split_shell(area);
        let mut buf = Buffer::empty(area);
        let mut model = ShellViewModel::default();
        model.team_state = Some("suggested".into());
        render_shell(
            &mut buf,
            regions,
            &model,
            &ChatState::default(),
            &default_editor(),
        );
        let hay = buffer_text(&buf);
        assert!(hay.contains("No team yet"));
        assert!(
            hay.contains("A = approve"),
            "a suggested team needs approval, not another analysis: {hay}"
        );
    }

    #[test]
    fn hidden_suggested_team_sidebar_points_to_the_team_editor_without_listing_roles() {
        let area = Rect::new(0, 0, 100, 30);
        let regions = split_shell(area);
        let mut buf = Buffer::empty(area);
        let mut model = ShellViewModel::default();
        model.team_presentation = Some("incomplete".into());
        model.roles_visible = false;
        model.team_state = Some("suggested".into());
        model.agents = vec![SidebarAgent {
            label: "SecretRoleName".into(),
            detail: "codex".into(),
            state: AgentState::Idle,
            cause: Default::default(),
        }];
        render_shell(&mut buf, regions, &model, &ChatState::default(), &default_editor());
        let hay = buffer_text(&buf);
        assert!(hay.contains("2 = edit team"), "{hay}");
        assert!(!hay.contains("SecretRoleName"), "the sidebar must not list roles: {hay}");
    }

    #[test]
    fn work_empty_hint_replaces_generic_work_surface_copy() {
        let area = Rect::new(0, 0, 100, 30);
        let regions = split_shell(area);
        let mut buf = Buffer::empty(area);
        let mut model = ShellViewModel::default();
        model.work_empty_hint = Some(vec![
            "Chat blocked: no_model — No active strategy with automatic launchable projectTeam routes"
                .into(),
            "Next: type /analyze to choose an analyst, then /approve.".into(),
        ]);
        render_shell(
            &mut buf,
            regions,
            &model,
            &ChatState::default(),
            &default_editor(),
        );
        let hay = buffer_text(&buf);
        assert!(
            hay.contains("Chat blocked: no_model"),
            "actionable empty hint missing: {hay}"
        );
        assert!(
            hay.contains("/analyze"),
            "next-step hint must name /analyze: {hay}"
        );
        assert!(
            !hay.contains("legacy-cockpit"),
            "cockpit must never be the recommended path: {hay}"
        );
        assert!(
            !hay.contains("conversation streams"),
            "generic Work surface placeholder must not win: {hay}"
        );
    }

    #[test]
    fn team_attention_banner_paints_reanalyze_cta_when_roles_are_blocked() {
        let area = Rect::new(0, 0, 100, 30);
        let regions = split_shell(area);
        let mut buf = Buffer::empty(area);
        let mut model = ShellViewModel::default();
        model.team_attention = Some(vec![
            "5 roles blocked — rate-limited.".into(),
            "Type /analyze to reassign.".into(),
        ]);
        model.agents = vec![SidebarAgent {
            label: "Architect".into(),
            detail: "OpenCode Go · rate-limited · /analyze".into(),
            state: AgentState::Blocked,
            cause: BlockCause::RateLimited,
        }];
        render_shell(
            &mut buf,
            regions,
            &model,
            &ChatState::default(),
            &default_editor(),
        );
        let hay = buffer_text(&buf);
        assert!(
            hay.contains("Type /analyze to reassign"),
            "blocked-team CTA missing from chat surface: {hay}"
        );
        assert!(
            hay.contains("rate-limited"),
            "CTA must explain the evidenced rate-limit cause: {hay}"
        );
        assert!(
            hay.contains("OpenCode Go"),
            "sidebar must keep naming the provider: {hay}"
        );
        assert!(
            !hay.contains("quota") && !hay.contains("funds"),
            "rate-limit evidence must never render as quota/funds: {hay}"
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
        let border_cell = buf[(work.editor.x, work.editor.y)]
            .style()
            .fg
            .unwrap_or(Color::Reset);
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

    #[test]
    fn analyst_picker_modal_paints_title_and_available_rows_only() {
        use crate::analyst_picker::AnalystPickerState;

        let area = Rect::new(0, 0, 100, 30);
        let picker = AnalystPickerState::from_analyst_catalog(&serde_json::json!({
            "recommendedModel": { "candidateKey": "codex::gpt" },
            "models": [
                { "candidateKey": "codex::gpt", "adapterId": "codex", "modelId": "gpt", "displayName": "GPT", "available": true, "recommendationTags": ["quality"] },
                { "candidateKey": "cursor::x", "adapterId": "cursor", "modelId": "x", "displayName": "Cursor X", "available": false, "recommendationTags": [] }
            ]
        }));
        let mut buf = Buffer::empty(area);
        render_analyst_picker(&mut buf, area, &picker);
        let hay = buffer_text(&buf);
        assert!(hay.contains("Select analyst"), "modal title missing: {hay}");
        assert!(hay.contains("GPT"), "recommended model row missing: {hay}");
        assert!(hay.contains("codex"), "adapter id must be visible: {hay}");
        assert!(
            !hay.contains("Cursor X"),
            "unavailable model must NOT be listed: {hay}"
        );
        assert!(
            !hay.contains("(unavailable)"),
            "unavailable marker must not appear: {hay}"
        );
        assert!(
            hay.contains("recommended"),
            "recommended marker missing: {hay}"
        );
    }

    #[test]
    fn analyst_picker_modal_highlights_the_selected_row_with_select_bg() {
        use crate::analyst_picker::AnalystPickerState;

        let area = Rect::new(0, 0, 100, 30);
        let picker = AnalystPickerState::from_analyst_catalog(&serde_json::json!({
            "models": [
                { "candidateKey": "codex::gpt", "adapterId": "codex", "modelId": "gpt", "displayName": "GPT", "available": true, "recommendationTags": [] },
                { "candidateKey": "claude::s", "adapterId": "claude", "modelId": "s", "displayName": "Claude S", "available": true, "recommendationTags": [] }
            ]
        }));
        let mut buf = Buffer::empty(area);
        render_analyst_picker(&mut buf, area, &picker);

        let popup = centered_rect(
            area,
            area.width.saturating_sub(6).clamp(36, 72),
            5, // 2 options + 3 chrome (single-line rows)
        );
        let inner_y = popup.y + 1;
        let far_x = popup.x + popup.width - 2;
        assert_eq!(
            cell_bg(&buf, far_x, inner_y),
            tone::SELECT_BG,
            "the first (selected) row must paint the full-width selection background"
        );
    }

    #[test]
    fn session_picker_modal_shows_the_kairo_id_for_a_bound_session_and_the_pi_label_for_an_unbound_one(
    ) {
        use crate::session_picker::SessionPickerState;

        let area = Rect::new(0, 0, 100, 30);
        let picker = SessionPickerState::from_sessions(
            &[
                serde_json::json!({ "path": "/x/a.jsonl", "sessionId": "pi-a", "label": "Fresh session", "kairoSessionId": null }),
                serde_json::json!({ "path": "/x/b.jsonl", "sessionId": "pi-b", "label": "B", "kairoSessionId": "aaaaaaaa-0000-0000-0000-000000000001" }),
            ],
            0,
        );
        let mut buf = Buffer::empty(area);
        render_session_picker(&mut buf, area, &picker);
        let hay = buffer_text(&buf);
        assert!(hay.contains("Switch session"), "modal title missing: {hay}");
        assert!(
            hay.contains("Fresh session"),
            "unbound row's Pi label missing: {hay}"
        );
        assert!(
            hay.contains("aaaaaaaa"),
            "bound row must show the real Kairo id: {hay}"
        );
    }

    #[test]
    fn session_picker_modal_highlights_the_selected_row_with_select_bg() {
        use crate::session_picker::SessionPickerState;

        let area = Rect::new(0, 0, 100, 30);
        let picker = SessionPickerState::from_sessions(
            &[
                serde_json::json!({ "path": "/x/a.jsonl", "sessionId": "pi-a", "label": "A" }),
                serde_json::json!({ "path": "/x/b.jsonl", "sessionId": "pi-b", "label": "B" }),
            ],
            0,
        );
        let mut buf = Buffer::empty(area);
        render_session_picker(&mut buf, area, &picker);

        let popup = centered_rect(area, area.width.saturating_sub(6).clamp(36, 76), 5);
        let inner_y = popup.y + 1;
        let far_x = popup.x + popup.width - 2;
        assert_eq!(
            cell_bg(&buf, far_x, inner_y),
            tone::SELECT_BG,
            "the selected row must paint the full-width selection background"
        );
    }

    #[test]
    fn session_picker_modal_on_an_empty_list_says_so_honestly() {
        use crate::session_picker::SessionPickerState;

        let area = Rect::new(0, 0, 100, 30);
        let picker = SessionPickerState::from_sessions(&[], 0);
        let mut buf = Buffer::empty(area);
        render_session_picker(&mut buf, area, &picker);
        let hay = buffer_text(&buf);
        assert!(
            hay.contains("No Pi session files"),
            "empty picker must say so honestly, never invent a row: {hay}"
        );
    }

    #[test]
    fn analyst_picker_modal_all_unavailable_catalog_shows_empty_copy() {
        use crate::analyst_picker::AnalystPickerState;

        let area = Rect::new(0, 0, 100, 30);
        let picker = AnalystPickerState::from_analyst_catalog(&serde_json::json!({
            "models": [
                { "candidateKey": "cursor::x", "adapterId": "cursor", "modelId": "x", "displayName": "Cursor X", "available": false, "recommendationTags": [] }
            ]
        }));
        assert!(picker.is_empty());
        let mut buf = Buffer::empty(area);
        render_analyst_picker(&mut buf, area, &picker);
        let hay = buffer_text(&buf);
        assert!(
            hay.contains("No ask-capable analyst"),
            "empty-catalog copy missing: {hay}"
        );
        assert!(
            !hay.contains("Cursor X"),
            "unavailable must not paint: {hay}"
        );
    }

    #[test]
    fn analyst_picker_modal_on_an_empty_catalog_says_so_honestly() {
        use crate::analyst_picker::AnalystPickerState;

        let area = Rect::new(0, 0, 100, 30);
        let picker = AnalystPickerState::from_analyst_catalog(&serde_json::json!({ "models": [] }));
        let mut buf = Buffer::empty(area);
        render_analyst_picker(&mut buf, area, &picker);
        let hay = buffer_text(&buf);
        assert!(
            hay.contains("No ask-capable analyst"),
            "empty-catalog copy missing: {hay}"
        );
    }

    #[test]
    fn analyst_picker_modal_loading_state_is_explicit_with_cancel_hint() {
        use crate::analyst_picker::AnalystPickerState;

        let area = Rect::new(0, 0, 100, 30);
        let mut buf = Buffer::empty(area);
        render_analyst_picker(&mut buf, area, &AnalystPickerState::loading());
        let hay = buffer_text(&buf);
        assert!(hay.contains("Loading analyst catalog"), "loading copy missing: {hay}");
        assert!(hay.contains("Esc cancel"), "cancel hint missing: {hay}");
        assert!(
            !hay.contains("No ask-capable analyst"),
            "loading must not claim the catalog is empty: {hay}"
        );
    }

    #[test]
    fn analyst_picker_modal_error_state_shows_failure_and_retry_close_hints() {
        use crate::analyst_picker::AnalystPickerState;

        let area = Rect::new(0, 0, 100, 30);
        let mut buf = Buffer::empty(area);
        render_analyst_picker(&mut buf, area, &AnalystPickerState::failed("sidecar timed out"));
        let hay = buffer_text(&buf);
        assert!(hay.contains("sidecar timed out"), "failure reason missing: {hay}");
        assert!(hay.contains("r retry"), "retry hint missing: {hay}");
        assert!(hay.contains("Esc close"), "close hint missing: {hay}");
        assert!(!hay.contains("No ask-capable analyst"), "error is not an empty catalog: {hay}");
    }

    #[test]
    fn analyst_picker_modal_renders_each_exclusion_cause_with_distinct_wording() {
        use crate::analyst_picker::{AnalystPickerState, ExclusionCause};

        let area = Rect::new(0, 0, 100, 30);
        let mut picker = AnalystPickerState::from_analyst_catalog(&serde_json::json!({ "models": [] }));
        picker.causes = ExclusionCause::list_from_record(&serde_json::json!({
            "exclusionCauses": [
                { "adapterId": "claude", "provider": "claude", "cause": "quota_exhausted", "models": 1, "reason": null },
                { "adapterId": "codex", "provider": "codex", "cause": "access_unknown", "models": 1, "reason": null },
                { "adapterId": "zed", "provider": "zed", "cause": "unscored", "models": 1, "reason": null }
            ]
        }))
        .unwrap();
        let mut buf = Buffer::empty(area);
        render_analyst_picker(&mut buf, area, &picker);
        let hay = buffer_text(&buf);
        assert!(hay.contains("No ask-capable analyst"), "empty message stays honest: {hay}");
        assert!(hay.contains("claude: cuota agotada"), "{hay}");
        assert!(hay.contains("codex: no verificado — comparación parcial"), "{hay}");
        assert!(hay.contains("zed: sin benchmark (solo selección manual)"), "{hay}");
        assert!(!hay.contains("no disponible"), "unknowns must not read as unavailable: {hay}");
    }

    fn picker_with_views() -> crate::analyst_picker::AnalystPickerState {
        crate::analyst_picker::AnalystPickerState::from_analyst_catalog(&serde_json::json!({
            "models": [
                { "candidateKey": "codex::a", "adapterId": "codex", "modelId": "a", "displayName": "Qualified Alpha",
                  "available": true, "accessVerified": true, "fit": 0.8,
                  "explanation": "razonamiento excelente · código sólido · confianza alta", "recommendationTags": [] }
            ],
            "alternatives": [
                { "candidateKey": "cursor::u", "adapterId": "cursor", "modelId": "u", "displayName": "Manual Unscored",
                  "available": true, "accessVerified": true, "fit": null,
                  "explanation": "sin benchmark · solo manual", "recommendationTags": [] },
                { "candidateKey": "claude::v", "adapterId": "claude", "modelId": "v", "displayName": "Manual Unverified",
                  "available": false, "selectable": true, "accessVerified": false, "fit": 0.4, "recommendationTags": [] }
            ]
        }))
    }

    #[test]
    fn analyst_picker_main_view_shows_qualified_rows_with_explanation_and_advertises_the_manual_view() {
        let area = Rect::new(0, 0, 100, 30);
        let picker = picker_with_views();
        let mut buf = Buffer::empty(area);
        render_analyst_picker(&mut buf, area, &picker);
        let hay = buffer_text(&buf);
        assert!(hay.contains("Qualified Alpha"), "{hay}");
        assert!(hay.contains("razonamiento excelente"), "per-row plain-language explanation missing: {hay}");
        assert!(!hay.contains("0.80"), "decimals never reach the modal: {hay}");
        assert!(hay.contains("Qualified Alpha · codex"), "rows are identified by model AND subscription: {hay}");
        assert!(!hay.contains("Manual Unscored"), "manual rows stay out of the main view: {hay}");
        assert!(hay.contains("m others (1)"), "the other verified options must be discoverable with their count: {hay}");
    }

    #[test]
    fn analyst_picker_manual_view_lists_only_verified_alternatives_and_points_back() {
        let area = Rect::new(0, 0, 100, 30);
        let mut picker = picker_with_views();
        picker.toggle_view();
        let mut buf = Buffer::empty(area);
        render_analyst_picker(&mut buf, area, &picker);
        let hay = buffer_text(&buf);
        assert!(hay.contains("Other verified analysts"), "{hay}");
        assert!(hay.contains("Manual Unscored"), "{hay}");
        assert!(!hay.contains("Manual Unverified"), "unverified rows never list: {hay}");
        assert!(!hay.contains("Qualified Alpha"), "{hay}");
        assert!(!hay.contains("recommended"), "manual rows are never starred: {hay}");
        assert!(hay.contains("m top (1)"), "{hay}");
    }

    #[test]
    fn analyst_picker_empty_main_view_points_to_the_manual_alternatives() {
        let area = Rect::new(0, 0, 100, 30);
        let picker = crate::analyst_picker::AnalystPickerState::from_analyst_catalog(&serde_json::json!({
            "models": [],
            "alternatives": [
                { "candidateKey": "cursor::u", "adapterId": "cursor", "modelId": "u", "displayName": "Manual Unscored",
                  "available": true, "accessVerified": true, "fit": null, "recommendationTags": [] }
            ]
        }));
        let mut buf = Buffer::empty(area);
        render_analyst_picker(&mut buf, area, &picker);
        let hay = buffer_text(&buf);
        assert!(hay.contains("No qualified analyst"), "{hay}");
        assert!(hay.contains("manual alternatives"), "{hay}");
    }

    fn progress_of(records: &[serde_json::Value]) -> crate::analyst_picker::VerificationProgress {
        let mut progress = crate::analyst_picker::VerificationProgress::default();
        for record in records {
            progress.apply_record(record);
        }
        progress
    }

    fn progress_record(completed: u64, total: u64, active: serde_json::Value, done: serde_json::Value) -> serde_json::Value {
        serde_json::json!({ "type": "verification_progress", "completed": completed, "total": total, "active": active, "done": done })
    }

    fn verifying_picker_with_problems() -> crate::analyst_picker::AnalystPickerState {
        use crate::analyst_picker::{AnalystPickerState, PickerPhase};
        let mut picker = AnalystPickerState::default();
        picker.phase = PickerPhase::Verifying;
        picker.progress = Some(progress_of(&[
            progress_record(
                1, 5,
                serde_json::json!([{ "label": "Pool B", "provider": "Cursor" }]),
                serde_json::json!({ "label": "Claude B", "provider": "Claude", "status": "unverified", "reason": "probe timed out after 30000ms" }),
            ),
            progress_record(
                2, 5,
                serde_json::json!([{ "label": "Pool B", "provider": "Cursor" }]),
                serde_json::json!({ "label": "Claude A", "provider": "Claude", "status": "allowed", "reason": null }),
            ),
        ]));
        picker
    }

    #[test]
    fn analyst_picker_verifying_modal_shows_progress_the_active_check_a_problem_summary_and_the_no_cancel_statement() {
        let area = Rect::new(0, 0, 100, 30);
        let mut buf = Buffer::empty(area);
        render_analyst_picker(&mut buf, area, &verifying_picker_with_problems());
        let hay = buffer_text(&buf);
        assert!(hay.contains("Verifying access… 2/5 checks"), "{hay}");
        assert!(hay.contains("Now: Pool B · Cursor"), "{hay}");
        assert!(hay.contains("Problems: Claude 1 unverified"), "{hay}");
        assert!(hay.contains("d = details"), "{hay}");
        assert!(hay.contains("Closing this window does not cancel"), "{hay}");
        assert!(!hay.contains("probe timed out"), "the reason stays in the detail view: {hay}");
        assert!(!hay.contains("Enter = verify"), "no second consent prompt while running: {hay}");
    }

    #[test]
    fn analyst_picker_details_view_lists_each_failed_check_with_its_real_reason() {
        let area = Rect::new(0, 0, 100, 30);
        let mut picker = verifying_picker_with_problems();
        picker.toggle_details();
        let mut buf = Buffer::empty(area);
        render_analyst_picker(&mut buf, area, &picker);
        let hay = buffer_text(&buf);
        assert!(hay.contains("Claude · Claude B — unverified: probe timed out after 30000ms"), "{hay}");
        assert!(!hay.contains("Now: Pool B"), "the detail view replaces the progress body: {hay}");
        picker.toggle_details();
        let mut buf = Buffer::empty(area);
        render_analyst_picker(&mut buf, area, &picker);
        assert!(buffer_text(&buf).contains("Verifying access… 2/5 checks"));
    }

    #[test]
    fn analyst_picker_ready_state_summarizes_failed_checks_and_opens_their_details_on_d() {
        let area = Rect::new(0, 0, 100, 30);
        let mut picker = picker_with_views();
        picker.outcome_lines = vec!["Cursor: 0 allowed · 0 denied · 1 unverified".into()];
        picker.details = vec!["Cursor · Other models — unverified: login required".into()];
        let mut buf = Buffer::empty(area);
        render_analyst_picker(&mut buf, area, &picker);
        let hay = buffer_text(&buf);
        assert!(hay.contains("Cursor: 0 allowed · 0 denied · 1 unverified"), "{hay}");
        assert!(hay.contains("1 check did not pass — d = details"), "{hay}");
        assert!(!hay.contains("login required"), "the reason is not in the summary: {hay}");
        picker.toggle_details();
        let mut buf = Buffer::empty(area);
        render_analyst_picker(&mut buf, area, &picker);
        let hay = buffer_text(&buf);
        assert!(hay.contains("Cursor · Other models — unverified: login required"), "{hay}");
        assert!(!hay.contains("Qualified Alpha"), "{hay}");
    }

    #[test]
    fn analyst_picker_rows_wrap_their_long_explanations_so_the_whole_reason_is_visible() {
        let area = Rect::new(0, 0, 80, 30);
        let long = "Recomendado para analizar este proyecto (Node.js): puesto 1 de 8 modelos distintos con evidencia comparable · lidera en código · razonamiento por debajo de GPT";
        let picker = crate::analyst_picker::AnalystPickerState::from_analyst_catalog(&serde_json::json!({
            "recommendedModel": { "candidateKey": "a::b" },
            "models": [
                { "candidateKey": "a::b", "adapterId": "a", "modelId": "b", "displayName": "Alpha", "available": true,
                  "accessVerified": true, "explanation": long, "recommendationTags": ["quality"] },
                { "candidateKey": "a::c", "adapterId": "a", "modelId": "c", "displayName": "Bravo", "available": true,
                  "accessVerified": true, "explanation": "razonamiento por debajo de Alpha · lidera en código", "recommendationTags": [] }
            ]
        }));
        let mut buf = Buffer::empty(area);
        render_analyst_picker(&mut buf, area, &picker);
        let hay = buffer_text(&buf);
        for needle in ["Recomendado para analizar este proyecto", "razonamiento por debajo de GPT", "Bravo", "lidera en código"] {
            assert!(hay.contains(needle), "missing {needle:?} in: {hay}");
        }
    }

    #[test]
    fn analyst_picker_shows_the_local_project_context_line_without_affecting_rows() {
        let area = Rect::new(0, 0, 100, 30);
        let mut picker = picker_with_views();
        picker.project_line = Some("Proyecto demo · Node.js · riesgos: sin script de test".into());
        let mut buf = Buffer::empty(area);
        render_analyst_picker(&mut buf, area, &picker);
        let hay = buffer_text(&buf);
        assert!(hay.contains("Proyecto demo · Node.js · riesgos: sin script de test"), "{hay}");
        assert!(hay.contains("Qualified Alpha"), "{hay}");
    }

    fn verify_picker() -> crate::analyst_picker::AnalystPickerState {
        use crate::analyst_picker::{AnalystPickerState, PickerPhase, VerificationPlan};
        let record = serde_json::json!({ "verificationPlan": {
            "subscriptions": [
                { "provider": "Claude", "granularity": "model", "checks": [
                    { "label": "Claude A", "state": "pending" }, { "label": "Claude B", "state": "pending" },
                    { "label": "Claude C", "state": "reusable" } ] },
                { "provider": "Cursor", "granularity": "pool", "checks": [
                    { "label": "Other models", "state": "pending" } ] }
            ] } });
        let mut picker = AnalystPickerState::from_analyst_catalog(&serde_json::json!({ "models": [] }));
        picker.plan = VerificationPlan::from_record(&record);
        picker.phase = PickerPhase::Verify;
        picker
    }

    #[test]
    fn analyst_picker_confirmation_screen_lists_accounts_checks_reuse_and_the_quota_warning() {
        let area = Rect::new(0, 0, 100, 30);
        let mut buf = Buffer::empty(area);
        render_analyst_picker(&mut buf, area, &verify_picker());
        let hay = buffer_text(&buf);
        assert!(hay.contains("Verify access before choosing an analyst"), "{hay}");
        assert!(hay.contains("Claude: 2 model checks — Claude A, Claude B"), "{hay}");
        assert!(hay.contains("Cursor: 1 pool check — Other models"), "deduplicated per pool: {hay}");
        assert!(hay.contains("1 check already verified — reused, no call"), "{hay}");
        assert!(hay.contains("Makes 3 real provider calls and may consume quota or account credit"), "{hay}");
        assert!(hay.contains("Enter = verify") && hay.contains("Esc = skip"), "{hay}");
        assert!(!hay.contains("No ask-capable analyst"), "the confirmation is not an empty catalog: {hay}");
    }

    #[test]
    fn analyst_picker_verifying_state_stays_inside_the_modal() {
        let area = Rect::new(0, 0, 100, 30);
        let mut picker = verify_picker();
        picker.begin_verifying();
        let mut buf = Buffer::empty(area);
        render_analyst_picker(&mut buf, area, &picker);
        let hay = buffer_text(&buf);
        assert!(hay.contains("Verifying access… starting"), "{hay}");
        assert!(hay.contains("Closing this window does not cancel"), "T24 (rewritten): the waiting screen says closing is not a cancel: {hay}");
        assert!(!hay.contains("Enter = verify"), "no second consent prompt while running: {hay}");
    }

    #[test]
    fn analyst_picker_ready_state_acknowledges_unverified_subscriptions_so_the_comparison_is_never_presented_as_complete() {
        let area = Rect::new(0, 0, 100, 30);
        let mut picker = picker_with_views();
        picker.not_verified = 2;
        let mut buf = Buffer::empty(area);
        render_analyst_picker(&mut buf, area, &picker);
        let hay = buffer_text(&buf);
        assert!(hay.contains("2 subscriptions not verified"), "{hay}");
        assert!(hay.contains("partial"), "{hay}");
    }

    #[test]
    fn analyst_picker_scrolls_so_the_selected_row_is_always_painted_with_no_cap() {
        let models: Vec<serde_json::Value> = (0..40)
            .map(|i| serde_json::json!({
                "candidateKey": format!("x::m{i}"), "adapterId": "x", "modelId": format!("m{i}"),
                "displayName": format!("Model {i:02}"), "available": true, "accessVerified": true,
                "fit": 0.9 - (i as f64) / 1000.0, "recommendationTags": []
            }))
            .collect();
        let mut picker = crate::analyst_picker::AnalystPickerState::from_analyst_catalog(
            &serde_json::json!({ "models": models }),
        );
        let area = Rect::new(0, 0, 100, 16);
        let mut buf = Buffer::empty(area);
        render_analyst_picker(&mut buf, area, &picker);
        let top = buffer_text(&buf);
        assert!(top.contains("Model 00"), "{top}");
        assert!(!top.contains("Model 30"), "list must be windowed, not fully drawn: {top}");
        for _ in 0..30 {
            picker.move_down();
        }
        let mut buf = Buffer::empty(area);
        render_analyst_picker(&mut buf, area, &picker);
        let mid = buffer_text(&buf);
        assert!(mid.contains("Model 30"), "the highlighted row must be visible: {mid}");
        assert!(!mid.contains("Model 00"), "{mid}");
        // Last row reachable (wrap up from the top).
        let mut picker2 = crate::analyst_picker::AnalystPickerState::from_analyst_catalog(
            &serde_json::json!({ "models": (0..40).map(|i| serde_json::json!({
                "candidateKey": format!("x::m{i}"), "adapterId": "x", "modelId": format!("m{i}"),
                "displayName": format!("Model {i:02}"), "available": true, "accessVerified": true,
                "fit": 0.9 - (i as f64) / 1000.0, "recommendationTags": [] })).collect::<Vec<_>>() }),
        );
        picker2.move_up();
        let mut buf = Buffer::empty(area);
        render_analyst_picker(&mut buf, area, &picker2);
        assert!(buffer_text(&buf).contains("Model 39"), "all 40 rows reachable");
    }

    #[test]
    fn analyst_picker_keeps_the_footer_visible_when_the_list_scrolls() {
        let models: Vec<serde_json::Value> = (0..40)
            .map(|i| serde_json::json!({
                "candidateKey": format!("x::m{i}"), "adapterId": "x", "modelId": format!("m{i}"),
                "displayName": format!("Model {i:02}"), "available": true, "accessVerified": true,
                "fit": 0.5, "recommendationTags": []
            }))
            .collect();
        let mut picker = crate::analyst_picker::AnalystPickerState::from_analyst_catalog(
            &serde_json::json!({ "models": models }),
        );
        picker.notice = Some("FOOTER_TOKEN".into());
        for _ in 0..20 {
            picker.move_down();
        }
        let area = Rect::new(0, 0, 100, 14);
        let mut buf = Buffer::empty(area);
        render_analyst_picker(&mut buf, area, &picker);
        let hay = buffer_text(&buf);
        assert!(hay.contains("FOOTER_TOKEN"), "{hay}");
        assert!(hay.contains("Model 20"), "{hay}");
    }

    #[test]
    fn analyst_picker_modal_without_causes_keeps_the_picker_notice_fallback() {
        use crate::analyst_picker::AnalystPickerState;

        let area = Rect::new(0, 0, 100, 30);
        let mut picker = AnalystPickerState::from_analyst_catalog(&serde_json::json!({ "models": [] }));
        picker.notice = Some("Claude: acceso sin verificar".into());
        let mut buf = Buffer::empty(area);
        render_analyst_picker(&mut buf, area, &picker);
        assert!(buffer_text(&buf).contains("Claude: acceso sin verificar"));
    }

    #[test]
    fn extension_ui_select_modal_shows_title_and_options() {
        use crate::extension_ui::{ExtensionUiDialog, ExtensionUiRequest};

        let area = Rect::new(0, 0, 100, 30);
        let dialog = ExtensionUiDialog::from_request(
            ExtensionUiRequest::from_record(&serde_json::json!({
                "type": "extension_ui_request",
                "id": "sel-1",
                "method": "select",
                "title": "Allow dangerous command?",
                "options": ["Allow", "Block"]
            }))
            .expect("parse"),
        );
        let mut buf = Buffer::empty(area);
        render_extension_ui(&mut buf, area, &dialog);
        let hay = buffer_text(&buf);
        assert!(
            hay.contains("Allow dangerous command?"),
            "title missing: {hay}"
        );
        assert!(hay.contains("Allow"), "option missing: {hay}");
        assert!(hay.contains("Block"), "option missing: {hay}");
        assert!(hay.contains("select"), "modal chrome missing: {hay}");
    }

    #[test]
    fn extension_ui_confirm_modal_shows_yes_no() {
        use crate::extension_ui::ExtensionUiDialog;

        let area = Rect::new(0, 0, 100, 30);
        let dialog = ExtensionUiDialog::from_request(
            crate::extension_ui::ExtensionUiRequest::from_record(&serde_json::json!({
                "type": "extension_ui_request",
                "id": "c-1",
                "method": "confirm",
                "title": "Clear session?",
                "message": "All messages will be lost."
            }))
            .expect("parse"),
        );
        let mut buf = Buffer::empty(area);
        render_extension_ui(&mut buf, area, &dialog);
        let hay = buffer_text(&buf);
        assert!(hay.contains("Clear session?"), "title missing: {hay}");
        assert!(hay.contains("Yes"), "Yes missing: {hay}");
        assert!(hay.contains("No"), "No missing: {hay}");
    }
}
