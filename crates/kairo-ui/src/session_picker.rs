//! Visible session picker (U3a): the in-UI equivalent of `kairo list`,
//! replacing Ctrl+[ / Ctrl+] blind cycling with an explicit, labeled list.
//!
//! Built entirely from the sidecar's own `sessions` records (see
//! `kairo-ui-rpc-stdio.js`'s `annotateSessions`) — each Pi session file is
//! labeled by the real Kairo session id bound to it (the SAME id `kairo
//! list` / `kairo resume` use) when one exists, never an invented id.

use serde_json::Value;

/// One real session row: a Pi file plus whatever binding evidence the
/// sidecar attached to it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionOption {
    pub path: String,
    pub pi_session_id: Option<String>,
    pub pi_label: String,
    pub kairo_session_id: Option<String>,
}

impl SessionOption {
    /// Kairo id first (matches `kairo list`), the Pi-file label only as a
    /// fallback for a session never bound to a Kairo id (e.g. created
    /// outside `kairo start`/`resume`). Never invents a Kairo id absent
    /// from the wire.
    pub fn row_label(&self) -> String {
        match &self.kairo_session_id {
            Some(id) => format!("{}  ({})", short_kairo_id(id), self.pi_label),
            None => self.pi_label.clone(),
        }
    }
}

fn short_kairo_id(id: &str) -> String {
    if id.len() > 8 {
        format!("{}…", &id[..8])
    } else {
        id.to_string()
    }
}

/// State machine for the modal: real rows + selection, no notice needed —
/// switching a session never has an "unavailable row" case the way the
/// analyst picker does.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SessionPickerState {
    pub options: Vec<SessionOption>,
    pub selected: usize,
}

impl SessionPickerState {
    /// Build from the sidecar's own `sessions` array (`ready.sessions` /
    /// the `sessions` record), preselecting whichever row is the currently
    /// active Pi session (`current_index`, from the host's own tracking —
    /// see `pi_session_index` in `main.rs`). An entry missing `path` is
    /// dropped rather than rendered half-invented.
    pub fn from_sessions(sessions: &[Value], current_index: usize) -> Self {
        let options: Vec<SessionOption> = sessions
            .iter()
            .filter_map(|s| {
                let path = s.get("path").and_then(|v| v.as_str())?.to_string();
                let pi_session_id = s
                    .get("sessionId")
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
                let pi_label = s
                    .get("label")
                    .and_then(|v| v.as_str())
                    .unwrap_or("(unlabeled session)")
                    .to_string();
                let kairo_session_id = s
                    .get("kairoSessionId")
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
                Some(SessionOption {
                    path,
                    pi_session_id,
                    pi_label,
                    kairo_session_id,
                })
            })
            .collect();
        let selected = if options.is_empty() {
            0
        } else {
            current_index.min(options.len() - 1)
        };
        Self { options, selected }
    }

    pub fn is_empty(&self) -> bool {
        self.options.is_empty()
    }

    /// Move highlight forward, wrapping. A no-op on an empty list.
    pub fn move_down(&mut self) {
        if self.options.is_empty() {
            return;
        }
        self.selected = (self.selected + 1) % self.options.len();
    }

    pub fn move_up(&mut self) {
        if self.options.is_empty() {
            return;
        }
        self.selected = (self.selected + self.options.len() - 1) % self.options.len();
    }

    /// Enter: the real index to switch to (for `switch_session_index`), or
    /// `None` on an empty list. Never picks silently on the human's behalf
    /// — the caller sends this exact index, nothing inferred.
    pub fn confirm(&self) -> Option<usize> {
        if self.options.is_empty() {
            None
        } else {
            Some(self.selected)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sessions() -> Vec<Value> {
        vec![
            json!({ "path": "/x/a.jsonl", "sessionId": "pi-a", "label": "A (fresh)", "kairoSessionId": null }),
            json!({ "path": "/x/b.jsonl", "sessionId": "pi-b", "label": "B", "kairoSessionId": "aaaaaaaa-0000-0000-0000-000000000001" }),
        ]
    }

    #[test]
    fn bound_session_shows_the_kairo_id_kairo_list_uses_not_just_the_pi_label() {
        let picker = SessionPickerState::from_sessions(&sessions(), 0);
        assert_eq!(picker.options.len(), 2);
        assert!(picker.options[1].row_label().starts_with("aaaaaaaa…"));
        assert!(picker.options[1].row_label().contains("(B)"));
    }

    #[test]
    fn unbound_session_falls_back_to_the_pi_label_only_never_an_invented_kairo_id() {
        let picker = SessionPickerState::from_sessions(&sessions(), 0);
        assert_eq!(picker.options[0].row_label(), "A (fresh)");
        assert!(!picker.options[0].row_label().contains("aaaaaaaa"));
    }

    #[test]
    fn preselects_the_currently_active_session_by_index() {
        let picker = SessionPickerState::from_sessions(&sessions(), 1);
        assert_eq!(picker.selected, 1);
    }

    #[test]
    fn an_out_of_range_current_index_clamps_instead_of_panicking() {
        let picker = SessionPickerState::from_sessions(&sessions(), 99);
        assert_eq!(picker.selected, 1);
    }

    #[test]
    fn movement_wraps_in_both_directions() {
        let mut picker = SessionPickerState::from_sessions(&sessions(), 0);
        picker.move_up();
        assert_eq!(picker.selected, 1, "moving up from 0 wraps to the last row");
        picker.move_down();
        assert_eq!(
            picker.selected, 0,
            "moving down from the last row wraps to 0"
        );
    }

    #[test]
    fn confirm_returns_the_selected_real_index() {
        let mut picker = SessionPickerState::from_sessions(&sessions(), 0);
        picker.move_down();
        assert_eq!(picker.confirm(), Some(1));
    }

    #[test]
    fn empty_session_list_yields_an_empty_picker_that_never_confirms() {
        let picker = SessionPickerState::from_sessions(&[], 3);
        assert!(picker.is_empty());
        assert_eq!(picker.confirm(), None);
        assert_eq!(picker.selected, 0);
    }

    #[test]
    fn an_entry_missing_path_is_dropped_not_half_rendered() {
        let picker = SessionPickerState::from_sessions(
            &[
                json!({ "sessionId": "pi-x", "label": "No path" }),
                json!({ "path": "/x/ok.jsonl", "sessionId": "pi-ok", "label": "OK" }),
            ],
            0,
        );
        assert_eq!(picker.options.len(), 1);
        assert_eq!(picker.options[0].pi_label, "OK");
    }

    #[test]
    fn move_on_empty_list_is_a_safe_no_op() {
        let mut picker = SessionPickerState::from_sessions(&[], 0);
        picker.move_down();
        picker.move_up();
        assert_eq!(picker.selected, 0);
    }
}
