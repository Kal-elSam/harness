//! Layout regions for the Kairo ratatui host.
//!
//! Contracts reused from the Pi shell bridge:
//! - ≥ [`SIDEBAR_MIN_COLUMNS`] → fixed [`SIDEBAR_COLUMNS`]-wide sidebar + main + usage strip
//! - &lt; that threshold → no sidebar (main gets full width) + compact strip

use ratatui::layout::{Constraint, Direction, Layout, Rect};

/// Fixed sidebar width when shown (terminal cells).
pub const SIDEBAR_COLUMNS: u16 = 28;

/// Columns below which the sidebar collapses.
pub const SIDEBAR_MIN_COLUMNS: u16 = 90;

/// Usage / status strip height (rows).
/// Must be ≥2 when the strip paints a top border: one row for the border,
/// one for visible `USAGE` text. A single row left the border consuming the
/// only cell and hid the label (V1 PTY review, 2026-09-26).
pub const USAGE_STRIP_ROWS: u16 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ShellRegions {
    pub sidebar: Option<Rect>,
    pub main: Rect,
    pub usage: Rect,
}

/// Split a full-frame `area` into sidebar (optional), main work surface, and usage strip.
pub fn split_shell(area: Rect) -> ShellRegions {
    let vertical = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Min(1),
            Constraint::Length(USAGE_STRIP_ROWS),
        ])
        .split(area);

    let body = vertical[0];
    let usage = vertical[1];

    if area.width >= SIDEBAR_MIN_COLUMNS && area.width > SIDEBAR_COLUMNS {
        let horizontal = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([
                Constraint::Length(SIDEBAR_COLUMNS),
                Constraint::Min(1),
            ])
            .split(body);
        ShellRegions {
            sidebar: Some(horizontal[0]),
            main: horizontal[1],
            usage,
        }
    } else {
        ShellRegions {
            sidebar: None,
            main: body,
            usage,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wide_terminal_reserves_28_col_sidebar() {
        let area = Rect::new(0, 0, 100, 30);
        let regions = split_shell(area);
        let sidebar = regions.sidebar.expect("sidebar at 100 cols");
        assert_eq!(sidebar.width, SIDEBAR_COLUMNS);
        assert_eq!(sidebar.height, 28); // body above 2-row usage
        assert_eq!(regions.main.x, SIDEBAR_COLUMNS);
        assert_eq!(regions.main.width, 100 - SIDEBAR_COLUMNS);
        assert_eq!(regions.usage.y, 28);
        assert_eq!(regions.usage.height, USAGE_STRIP_ROWS);
        assert_eq!(regions.usage.width, 100);
    }

    #[test]
    fn narrow_terminal_hides_sidebar() {
        let area = Rect::new(0, 0, 60, 30);
        let regions = split_shell(area);
        assert!(regions.sidebar.is_none());
        assert_eq!(regions.main.width, 60);
        assert_eq!(regions.main.height, 28);
        assert_eq!(regions.usage.width, 60);
        assert_eq!(regions.usage.height, USAGE_STRIP_ROWS);
    }

    #[test]
    fn usage_strip_reserves_two_rows_for_border_plus_label() {
        let regions = split_shell(Rect::new(0, 0, 100, 30));
        assert!(regions.usage.height >= 2);
    }

    #[test]
    fn threshold_89_hides_sidebar_90_shows() {
        let hide = split_shell(Rect::new(0, 0, 89, 24));
        assert!(hide.sidebar.is_none());
        let show = split_shell(Rect::new(0, 0, 90, 24));
        assert_eq!(show.sidebar.map(|r| r.width), Some(SIDEBAR_COLUMNS));
        assert_eq!(show.main.width, 90 - SIDEBAR_COLUMNS);
    }
}
