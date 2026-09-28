//! U4d/U5b: Work | Project | Tasks | Sessions | Operations | Settings.
//!
//! Empty-compose digits `1`–`6` switch views.
//! Esc from a non-Work view returns to Work.

/// Which primary surface owns the main column.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum WorkspaceView {
    #[default]
    Work,
    Project,
    Tasks,
    Sessions,
    /// U5a: read-only Operations hub (health / fleet / usage / diagnostics).
    Operations,
    /// Settings — profile / integrations / connections (U5b).
    Settings,
}

impl WorkspaceView {
    pub fn label(self) -> &'static str {
        match self {
            WorkspaceView::Work => "Work",
            WorkspaceView::Project => "Project",
            WorkspaceView::Tasks => "Tasks",
            WorkspaceView::Sessions => "Sessions",
            WorkspaceView::Operations => "Operations",
            WorkspaceView::Settings => "Settings",
        }
    }

    pub fn chrome_title(self) -> String {
        format!(
            " 1 Work · 2 Project · 3 Tasks · 4 Sessions · 5 Ops · 6 Settings  · {} ",
            self.label()
        )
    }
}

/// Empty-compose digit → view. `1`–`6` are live (Ops + Settings).
pub fn view_from_digit(c: char) -> Option<WorkspaceView> {
    match c {
        '1' => Some(WorkspaceView::Work),
        '2' => Some(WorkspaceView::Project),
        '3' => Some(WorkspaceView::Tasks),
        '4' => Some(WorkspaceView::Sessions),
        '5' => Some(WorkspaceView::Operations),
        '6' => Some(WorkspaceView::Settings),
        _ => None,
    }
}

/// Esc from any non-Work view → Work. Esc on Work is a no-op here.
pub fn escape_to_work(current: WorkspaceView) -> Option<WorkspaceView> {
    match current {
        WorkspaceView::Work => None,
        WorkspaceView::Project
        | WorkspaceView::Tasks
        | WorkspaceView::Sessions
        | WorkspaceView::Operations
        | WorkspaceView::Settings => Some(WorkspaceView::Work),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn digits_map_to_six_views() {
        assert_eq!(view_from_digit('1'), Some(WorkspaceView::Work));
        assert_eq!(view_from_digit('2'), Some(WorkspaceView::Project));
        assert_eq!(view_from_digit('3'), Some(WorkspaceView::Tasks));
        assert_eq!(view_from_digit('4'), Some(WorkspaceView::Sessions));
        assert_eq!(view_from_digit('5'), Some(WorkspaceView::Operations));
        assert_eq!(view_from_digit('6'), Some(WorkspaceView::Settings));
        assert_eq!(view_from_digit('7'), None);
        assert_eq!(view_from_digit('p'), None);
    }

    #[test]
    fn esc_returns_to_work_from_ops_and_settings() {
        assert_eq!(escape_to_work(WorkspaceView::Work), None);
        assert_eq!(
            escape_to_work(WorkspaceView::Operations),
            Some(WorkspaceView::Work)
        );
        assert_eq!(
            escape_to_work(WorkspaceView::Settings),
            Some(WorkspaceView::Work)
        );
        assert_eq!(
            escape_to_work(WorkspaceView::Project),
            Some(WorkspaceView::Work)
        );
    }

    #[test]
    fn chrome_names_ops_and_settings_stub() {
        let title = WorkspaceView::Operations.chrome_title();
        assert!(title.contains("5 Ops"));
        assert!(title.contains("6 Settings"));
        assert!(title.contains("Operations"));
    }
}
