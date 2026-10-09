//! U4d per-role project-team editor on the Project view.
//!
//! Flow: RESULT role list → EDIT_LOADING → EDIT_MODEL_SEARCH → EDIT_CONFIRM
//! → EDIT_SAVING → RESULT. Writes only when the strategy is SUGGESTED —
//! ACTIVE/STALE are refused by the service (and gated here before request).

use serde_json::Value;

/// Host-side edit phase (mirrors cockpit `project-overlay.js` EDIT_*).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoleEditPhase {
    Loading,
    ModelSearch,
    Confirm,
    Saving,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EditCandidate {
    pub candidate_key: String,
    pub display_name: String,
    pub adapter_id: String,
    pub tag: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RoleEditorState {
    pub phase: RoleEditPhase,
    pub role: String,
    pub query: String,
    pub candidates: Vec<EditCandidate>,
    pub filtered: Vec<usize>,
    pub selected: usize,
    pub pending_key: Option<String>,
    pub notice: Option<String>,
}

impl RoleEditorState {
    pub fn loading(role: impl Into<String>) -> Self {
        Self {
            phase: RoleEditPhase::Loading,
            role: role.into(),
            query: String::new(),
            candidates: Vec::new(),
            filtered: Vec::new(),
            selected: 0,
            pending_key: None,
            notice: Some("Reading catalog…".into()),
        }
    }

    /// Build search UI from a `team.edit.catalog` sidecar record.
    pub fn from_catalog_record(record: &Value) -> Option<Self> {
        let role = record
            .get("role")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())?
            .to_string();
        let models = record.get("models").and_then(|v| v.as_array())?;
        let current_key = record
            .get("currentCandidateKey")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let recommended_key = record
            .get("recommendedCandidateKey")
            .and_then(|v| v.as_str())
            .unwrap_or(current_key);
        let mut candidates = Vec::new();
        for model in models {
            let key = model
                .get("candidateKey")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if key.is_empty() {
                continue;
            }
            let display_name = model
                .get("displayName")
                .and_then(|v| v.as_str())
                .unwrap_or(&key)
                .to_string();
            let adapter_id = model
                .get("adapterId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let mut tags = Vec::new();
            if key == current_key {
                tags.push("current");
            }
            if key == recommended_key {
                tags.push("recommended");
            }
            if model.get("evidenceStatus").and_then(|v| v.as_str()) == Some("unscored") {
                tags.push("unscored");
            }
            if model.get("accessMode").and_then(|v| v.as_str()) == Some("manual") {
                tags.push("manual");
            }
            candidates.push(EditCandidate {
                candidate_key: key,
                display_name,
                adapter_id,
                tag: tags.join(" · "),
            });
        }
        let filtered: Vec<usize> = (0..candidates.len()).collect();
        Some(Self {
            phase: RoleEditPhase::ModelSearch,
            role,
            query: String::new(),
            candidates,
            filtered,
            selected: 0,
            pending_key: None,
            notice: None,
        })
    }

    pub fn set_query(&mut self, query: String) {
        self.query = query;
        let q = self.query.to_ascii_lowercase();
        self.filtered = self
            .candidates
            .iter()
            .enumerate()
            .filter(|(_, c)| {
                if q.is_empty() {
                    return true;
                }
                let hay = format!("{} {}", c.display_name, c.adapter_id).to_ascii_lowercase();
                hay.contains(&q)
            })
            .map(|(i, _)| i)
            .collect();
        self.selected = 0;
    }

    pub fn move_down(&mut self) {
        if self.filtered.is_empty() {
            return;
        }
        self.selected = (self.selected + 1) % self.filtered.len();
    }

    pub fn move_up(&mut self) {
        if self.filtered.is_empty() {
            return;
        }
        self.selected = if self.selected == 0 {
            self.filtered.len() - 1
        } else {
            self.selected - 1
        };
    }

    pub fn selected_candidate(&self) -> Option<&EditCandidate> {
        let idx = *self.filtered.get(self.selected)?;
        self.candidates.get(idx)
    }

    pub fn begin_confirm(&mut self) -> bool {
        let Some(c) = self.selected_candidate() else {
            return false;
        };
        let key = c.candidate_key.clone();
        let notice = format!(
            "Assign {} · {} to {}? Enter confirm · Esc back",
            c.adapter_id, c.display_name, self.role
        );
        self.pending_key = Some(key);
        self.phase = RoleEditPhase::Confirm;
        self.notice = Some(notice);
        true
    }

    pub fn back_to_search(&mut self) {
        self.phase = RoleEditPhase::ModelSearch;
        self.pending_key = None;
        self.notice = None;
    }

    pub fn begin_saving(&mut self) {
        self.phase = RoleEditPhase::Saving;
        self.notice = Some("Saving assignment…".into());
    }

    pub fn footer_hints(&self) -> &'static str {
        match self.phase {
            RoleEditPhase::Loading | RoleEditPhase::Saving => "…",
            RoleEditPhase::ModelSearch => "type to search · ↑/↓ · Enter confirm · Esc back",
            RoleEditPhase::Confirm => "Enter save · Esc back to search",
        }
    }
}

/// Only SUGGESTED strategies accept role edits (service also refuses ACTIVE/STALE).
pub fn can_edit_team_roles(team_state: Option<&str>) -> bool {
    team_state == Some("suggested")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn suggested_only_is_editable() {
        assert!(can_edit_team_roles(Some("suggested")));
        assert!(!can_edit_team_roles(Some("active")));
        assert!(!can_edit_team_roles(Some("stale")));
        assert!(!can_edit_team_roles(Some("not_analyzed")));
        assert!(!can_edit_team_roles(None));
    }

    #[test]
    fn catalog_record_opens_model_search() {
        let editor = RoleEditorState::from_catalog_record(&json!({
            "role": "Builder",
            "currentCandidateKey": "codex::a",
            "recommendedCandidateKey": "codex::a",
            "models": [
                {
                    "candidateKey": "codex::a",
                    "displayName": "GPT A",
                    "adapterId": "codex",
                    "evidenceStatus": "scored"
                },
                {
                    "candidateKey": "claude::b",
                    "displayName": "Claude B",
                    "adapterId": "claude",
                    "evidenceStatus": "unscored",
                    "accessMode": "manual"
                }
            ]
        }))
        .expect("catalog");
        assert_eq!(editor.phase, RoleEditPhase::ModelSearch);
        assert_eq!(editor.role, "Builder");
        assert_eq!(editor.candidates.len(), 2);
        assert!(editor.candidates[0].tag.contains("current"));
        assert!(editor.candidates[1].tag.contains("unscored"));
        assert!(editor.candidates[1].tag.contains("manual"));
    }

    #[test]
    fn search_filters_and_confirm_sets_pending() {
        let mut editor = RoleEditorState::from_catalog_record(&json!({
            "role": "Builder",
            "models": [
                { "candidateKey": "codex::a", "displayName": "Alpha", "adapterId": "codex" },
                { "candidateKey": "claude::b", "displayName": "Bravo", "adapterId": "claude" }
            ]
        }))
        .unwrap();
        editor.set_query("brav".into());
        assert_eq!(editor.filtered.len(), 1);
        assert!(editor.begin_confirm());
        assert_eq!(editor.phase, RoleEditPhase::Confirm);
        assert_eq!(editor.pending_key.as_deref(), Some("claude::b"));
        editor.back_to_search();
        assert_eq!(editor.phase, RoleEditPhase::ModelSearch);
    }
}
