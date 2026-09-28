//! U4d: first-class Work | Project | Tasks | Sessions chrome.
//!
//! Empty-compose digits `1`–`4` switch views. Esc from a non-Work view returns
//! to Work. `p` / Ctrl+L may also enter Tasks / Sessions (plan-list execute
//! keys stay owned by the Tasks surface).

/// Which primary surface owns the main column.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum WorkspaceView {
    #[default]
    Work,
    Project,
    Tasks,
    Sessions,
}

impl WorkspaceView {
    pub fn label(self) -> &'static str {
        match self {
            WorkspaceView::Work => "Work",
            WorkspaceView::Project => "Project",
            WorkspaceView::Tasks => "Tasks",
            WorkspaceView::Sessions => "Sessions",
        }
    }

    pub fn chrome_title(self) -> String {
        format!(
            " 1 Work · 2 Project · 3 Tasks · 4 Sessions  · {} ",
            self.label()
        )
    }
}

/// Empty-compose digit → view. Prefer `1`–`4` (documented product choice).
pub fn view_from_digit(c: char) -> Option<WorkspaceView> {
    match c {
        '1' => Some(WorkspaceView::Work),
        '2' => Some(WorkspaceView::Project),
        '3' => Some(WorkspaceView::Tasks),
        '4' => Some(WorkspaceView::Sessions),
        _ => None,
    }
}

/// Esc from Project/Tasks/Sessions → Work. Esc on Work is a no-op here.
pub fn escape_to_work(current: WorkspaceView) -> Option<WorkspaceView> {
    match current {
        WorkspaceView::Work => None,
        WorkspaceView::Project | WorkspaceView::Tasks | WorkspaceView::Sessions => {
            Some(WorkspaceView::Work)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn digits_map_to_four_views() {
        assert_eq!(view_from_digit('1'), Some(WorkspaceView::Work));
        assert_eq!(view_from_digit('2'), Some(WorkspaceView::Project));
        assert_eq!(view_from_digit('3'), Some(WorkspaceView::Tasks));
        assert_eq!(view_from_digit('4'), Some(WorkspaceView::Sessions));
        assert_eq!(view_from_digit('5'), None);
        assert_eq!(view_from_digit('p'), None);
    }

    #[test]
    fn esc_returns_to_work_from_other_views() {
        assert_eq!(escape_to_work(WorkspaceView::Work), None);
        assert_eq!(
            escape_to_work(WorkspaceView::Project),
            Some(WorkspaceView::Work)
        );
        assert_eq!(
            escape_to_work(WorkspaceView::Tasks),
            Some(WorkspaceView::Work)
        );
        assert_eq!(
            escape_to_work(WorkspaceView::Sessions),
            Some(WorkspaceView::Work)
        );
    }

    #[test]
    fn chrome_names_active_view() {
        let title = WorkspaceView::Tasks.chrome_title();
        assert!(title.contains("3 Tasks"));
        assert!(title.contains("Tasks"));
    }
}
