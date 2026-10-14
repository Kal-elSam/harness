//! CRT phosphor skin shared by every Ratatui surface.
//! Sources: preserve/ratatui-owned-window-crt surfaces::tone and Pi CRT skin.

use ratatui::style::{Color, Modifier, Style};
use ratatui::symbols::border;
use ratatui::text::Line;
use ratatui::widgets::Block;
use std::sync::LazyLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Palette {
    pub work_bg: Color,
    pub sidebar_bg: Color,
    pub usage_bg: Color,
    pub border: Color,
    pub accent: Color,
    pub border_focus: Color,
    pub text: Color,
    pub muted: Color,
    pub select_bg: Color,
    pub error: Color,
    pub warn: Color,
    pub tool: Color,
    pub user: Color,
    pub assistant: Color,
    pub select_fg: Color,
    pub crt: bool,
}

const CLASSIC: Palette = Palette {
    work_bg: Color::Rgb(0x09, 0x0f, 0x0e),
    sidebar_bg: Color::Rgb(0x11, 0x1a, 0x18),
    usage_bg: Color::Rgb(0x13, 0x21, 0x1c),
    border: Color::Rgb(0x2c, 0x3d, 0x36),
    accent: Color::Rgb(0x5e, 0xe6, 0xa8),
    border_focus: Color::Rgb(0x5e, 0xe6, 0xa8),
    text: Color::Rgb(0xe8, 0xf5, 0xef),
    muted: Color::Rgb(0x9a, 0xb2, 0xa5),
    select_bg: Color::Rgb(0x1a, 0x33, 0x2c),
    error: Color::Rgb(0xdc, 0x5a, 0x5a),
    warn: Color::Rgb(0xe0, 0xb4, 0x5c),
    tool: Color::Rgb(0xe0, 0xb4, 0x5c),
    user: Color::Rgb(0x8e, 0xc8, 0xff),
    assistant: Color::Rgb(0xc5, 0xd4, 0xcc),
    select_fg: Color::Rgb(0xe8, 0xf5, 0xef),
    crt: false,
};

/// P1 phosphor hierarchy; only selected cells use black ink on a green plate.
const CRT: Palette = Palette {
    work_bg: Color::Rgb(0, 0, 0),
    sidebar_bg: Color::Rgb(0, 20, 10),
    usage_bg: Color::Rgb(0, 31, 16),
    border: Color::Rgb(34, 204, 68),
    accent: Color::Rgb(0, 255, 65),
    border_focus: Color::Rgb(0, 255, 65),
    text: Color::Rgb(51, 255, 102),
    muted: Color::Rgb(46, 204, 113),
    select_bg: Color::Rgb(0, 255, 65),
    error: Color::Rgb(153, 255, 153),
    warn: Color::Rgb(102, 238, 85),
    tool: Color::Rgb(102, 238, 85),
    user: Color::Rgb(51, 255, 102),
    assistant: Color::Rgb(46, 204, 113),
    select_fg: Color::Rgb(0, 0, 0),
    crt: true,
};

/// Match the existing Pi skin's opt-out exactly; no new theme setting.
fn palette_for(raw: Option<&str>) -> Palette {
    match raw.map(str::to_ascii_lowercase).as_deref() {
        Some("0" | "false" | "off" | "no") => CLASSIC,
        _ => CRT,
    }
}

/// Resolve once per process; rendering never mutates settings or environment.
pub fn palette() -> &'static Palette {
    static PALETTE: LazyLock<Palette> =
        LazyLock::new(|| palette_for(std::env::var("KAIRO_PROTOTYPE_THEME").ok().as_deref()));
    &PALETTE
}

pub fn base() -> Style {
    Style::default().fg(palette().text).bg(palette().work_bg)
}

pub fn selection() -> Style {
    Style::default()
        .fg(palette().select_fg)
        .bg(palette().select_bg)
        .add_modifier(Modifier::BOLD)
}

/// ASCII borders avoid font-dependent box glyphs in the terminal host.
pub fn block() -> Block<'static> {
    let block = Block::default().style(base());
    if palette().crt {
        block.border_set(border::Set {
            top_left: "+",
            top_right: "+",
            bottom_left: "+",
            bottom_right: "+",
            vertical_left: "|",
            vertical_right: "|",
            horizontal_top: "-",
            horizontal_bottom: "-",
        })
    } else {
        block
    }
}

/// Normalize only block titles. Transcript and modal payload text stay verbatim.
pub fn title<'a>(text: impl Into<Line<'a>>) -> Line<'a> {
    let mut line = text.into();
    if palette().crt {
        for span in &mut line.spans {
            span.content = span
                .content
                .replace('·', ".")
                .replace('→', "->")
                .replace('↑', "up")
                .replace('↓', "down")
                .replace('—', "-")
                .replace('…', "...")
                .into();
        }
    }
    line
}

/// Change only product chrome, never user messages, code, or provider payloads.
pub fn glyph(crt: &'static str, classic: &'static str) -> &'static str {
    if palette().crt {
        crt
    } else {
        classic
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_palette_is_crt_without_a_setting() {
        assert_eq!(palette_for(None), CRT);
        assert_eq!(CRT.work_bg, Color::Rgb(0, 0, 0));
        assert_eq!(CRT.accent, Color::Rgb(0, 255, 65));
        assert_eq!(CRT.select_fg, CRT.work_bg);
        assert_eq!(CRT.select_bg, CRT.accent);
        assert_ne!(CRT.warn, CRT.error);
    }

    #[test]
    fn documented_pi_opt_out_preserves_classic_palette() {
        for value in ["0", "false", "off", "no", "OFF", "False"] {
            assert_eq!(palette_for(Some(value)), CLASSIC, "{value}");
        }
        for value in ["", "1", "true", "on", "crt", "classic", "unknown"] {
            assert_eq!(palette_for(Some(value)), CRT, "{value}");
        }
    }
}
