//! Analyst picker (T2): the in-UI equivalent of the cockpit's own
//! ProjectOverlay SELECT_ANALYST state — the human chooses which Bootstrap
//! Analyst model runs `project.analyze`, before any provider call happens.
//! No cockpit dependency: driven entirely by the ratatui host's own
//! `project.preflight` sidecar op and its real `analystCatalog`.
//!
//! Never invents a model absent from the real catalog, and never silently
//! auto-selects an unavailable one — see `confirm()`.

use serde_json::Value;

/// One real catalog entry (from `preflightProjectTeam`'s `analystCatalog`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnalystOption {
    pub candidate_key: String,
    pub adapter_id: String,
    pub model_id: String,
    pub display_name: String,
    pub available: bool,
    pub recommended: bool,
    pub tags: Vec<String>,
}

impl AnalystOption {
    /// `<displayName>    <adapterId>` — model-first, matching the cockpit's
    /// own row shape (project-overlay.js buildSelectList), never
    /// provider-first. Recommended/unavailable get an honest suffix, never
    /// a fabricated claim for a model that doesn't actually carry it.
    pub fn row_label(&self) -> String {
        let mut label = format!("{}    {}", self.display_name, self.adapter_id);
        if self.recommended {
            label.push_str("  ★ recommended");
        }
        if !self.available {
            label.push_str("  (unavailable)");
        }
        label
    }

    /// Short secondary line — the real tag(s) only, never invented.
    pub fn description(&self) -> String {
        self.tags
            .iter()
            .map(|t| match t.as_str() {
                "quality" => "Quality fit".to_string(),
                "efficient" => "Efficient fit".to_string(),
                other => other.to_string(),
            })
            .collect::<Vec<_>>()
            .join(" · ")
    }
}

/// State machine for the modal: options + selection + an inline notice
/// (e.g. "that model isn't available"), never a silent no-op.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct AnalystPickerState {
    pub options: Vec<AnalystOption>,
    pub selected: usize,
    pub notice: Option<String>,
}

impl AnalystPickerState {
    /// Build from the sidecar's `preflight` record's own `analystCatalog`
    /// (`{ recommendedModel, models: [...] }`) — see
    /// project-team-sidecar.js's `preflightProjectTeam`. An entry missing
    /// its required fields is dropped rather than rendered half-invented;
    /// an empty/absent catalog yields an empty picker.
    pub fn from_analyst_catalog(catalog: &Value) -> Self {
        let recommended_key = catalog
            .get("recommendedModel")
            .and_then(|m| m.get("candidateKey"))
            .and_then(|v| v.as_str());
        let models = catalog
            .get("models")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let mut options: Vec<AnalystOption> = models
            .iter()
            .filter_map(|m| {
                let candidate_key = m.get("candidateKey").and_then(|v| v.as_str())?.to_string();
                let adapter_id = m.get("adapterId").and_then(|v| v.as_str())?.to_string();
                let model_id = m.get("modelId").and_then(|v| v.as_str())?.to_string();
                let display_name = m
                    .get("displayName")
                    .and_then(|v| v.as_str())
                    .unwrap_or(model_id.as_str())
                    .to_string();
                let available = m.get("available").and_then(|v| v.as_bool()).unwrap_or(false);
                let tags: Vec<String> = m
                    .get("recommendationTags")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|t| t.as_str().map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_default();
                let recommended = recommended_key == Some(candidate_key.as_str());
                Some(AnalystOption {
                    candidate_key,
                    adapter_id,
                    model_id,
                    display_name,
                    available,
                    recommended,
                    tags,
                })
            })
            .collect();
        // Recommended first — same ordering the cockpit's own picker uses.
        options.sort_by_key(|o| !o.recommended);
        Self {
            options,
            selected: 0,
            notice: None,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.options.is_empty()
    }

    /// Move highlight forward, wrapping. Every row is reachable —
    /// including unavailable ones: "list all, only confirm available".
    pub fn move_down(&mut self) {
        if self.options.is_empty() {
            return;
        }
        self.selected = (self.selected + 1) % self.options.len();
        self.notice = None;
    }

    pub fn move_up(&mut self) {
        if self.options.is_empty() {
            return;
        }
        self.selected = (self.selected + self.options.len() - 1) % self.options.len();
        self.notice = None;
    }

    pub fn selected_option(&self) -> Option<&AnalystOption> {
        self.options.get(self.selected)
    }

    /// Enter: only an available model may be confirmed. An unavailable row
    /// stays highlighted with an honest inline notice — never a silent
    /// no-op, and never an auto-jump to a different row.
    pub fn confirm(&mut self) -> Option<AnalystOption> {
        let message = match self.selected_option() {
            Some(option) if !option.available => Some(format!(
                "{} is not available right now — pick another model.",
                option.display_name
            )),
            Some(option) => return Some(option.clone()),
            None => return None,
        };
        self.notice = message;
        None
    }

    /// The clean `analyst` payload `project.analyze` expects over the wire
    /// — the same shape as project-team-sidecar.js's `pickDefaultAnalyst` /
    /// the cockpit's own ProjectOverlay onSelect
    /// (`{model, selectionSource, recommendationTags, choice}`).
    pub fn analyst_payload(option: &AnalystOption) -> Value {
        let selection_source = if option.recommended {
            "recommended"
        } else {
            "manual"
        };
        let choice: Option<&str> = if option.tags.iter().any(|t| t == "quality") {
            Some("quality")
        } else if option.tags.iter().any(|t| t == "efficient") {
            Some("efficient")
        } else {
            None
        };
        serde_json::json!({
            "model": {
                "adapterId": option.adapter_id,
                "modelId": option.model_id,
                "displayName": option.display_name,
            },
            "selectionSource": selection_source,
            "recommendationTags": option.tags,
            "choice": choice,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn catalog() -> Value {
        json!({
            "recommendedModel": { "candidateKey": "codex::gpt" },
            "models": [
                {
                    "candidateKey": "claude::sonnet", "adapterId": "claude", "modelId": "sonnet",
                    "displayName": "Claude Sonnet", "available": true, "recommendationTags": []
                },
                {
                    "candidateKey": "codex::gpt", "adapterId": "codex", "modelId": "gpt",
                    "displayName": "GPT", "available": true, "recommendationTags": ["quality"]
                },
                {
                    "candidateKey": "cursor::x", "adapterId": "cursor", "modelId": "x",
                    "displayName": "Cursor X", "available": false, "recommendationTags": []
                }
            ]
        })
    }

    #[test]
    fn recommended_model_sorts_first_and_is_flagged() {
        let picker = AnalystPickerState::from_analyst_catalog(&catalog());
        assert_eq!(picker.options.len(), 3);
        assert_eq!(picker.options[0].adapter_id, "codex");
        assert!(picker.options[0].recommended);
        assert!(picker.options[0].row_label().contains("recommended"));
    }

    #[test]
    fn movement_wraps_and_covers_every_row_including_unavailable() {
        let mut picker = AnalystPickerState::from_analyst_catalog(&catalog());
        assert_eq!(picker.selected, 0);
        picker.move_down();
        picker.move_down();
        assert_eq!(picker.selected, 2);
        assert!(!picker.options[2].available);
        picker.move_down();
        assert_eq!(picker.selected, 0, "movement wraps forward");
        picker.move_up();
        assert_eq!(picker.selected, 2, "movement wraps backward too");
    }

    #[test]
    fn confirm_refuses_an_unavailable_model_and_keeps_it_selected() {
        let mut picker = AnalystPickerState::from_analyst_catalog(&catalog());
        picker.selected = 2;
        assert!(picker.confirm().is_none());
        assert!(picker.notice.is_some());
        assert!(picker.notice.as_deref().unwrap().contains("Cursor X"));
        assert_eq!(picker.selected, 2, "stays on the same row, never silently jumps");
    }

    #[test]
    fn confirm_returns_the_available_option_and_never_fabricates_a_notice() {
        let mut picker = AnalystPickerState::from_analyst_catalog(&catalog());
        let picked = picker.confirm().expect("recommended model is available");
        assert_eq!(picked.adapter_id, "codex");
        assert_eq!(picker.notice, None);
    }

    #[test]
    fn moving_after_a_refused_confirm_clears_the_stale_notice() {
        let mut picker = AnalystPickerState::from_analyst_catalog(&catalog());
        picker.selected = 2;
        assert!(picker.confirm().is_none());
        assert!(picker.notice.is_some());
        picker.move_up();
        assert_eq!(picker.notice, None, "a fresh selection must not carry a stale refusal notice");
    }

    #[test]
    fn payload_matches_the_clean_modelref_shape_the_sidecar_expects() {
        let option = AnalystOption {
            candidate_key: "codex::gpt".into(),
            adapter_id: "codex".into(),
            model_id: "gpt".into(),
            display_name: "GPT".into(),
            available: true,
            recommended: true,
            tags: vec!["quality".into()],
        };
        let payload = AnalystPickerState::analyst_payload(&option);
        assert_eq!(payload["model"]["adapterId"], "codex");
        assert_eq!(payload["model"]["modelId"], "gpt");
        assert_eq!(payload["model"]["displayName"], "GPT");
        assert_eq!(payload["selectionSource"], "recommended");
        assert_eq!(payload["choice"], "quality");
        assert_eq!(payload["recommendationTags"][0], "quality");
    }

    #[test]
    fn manual_pick_with_no_tags_has_a_null_choice_never_a_fabricated_one() {
        let option = AnalystOption {
            candidate_key: "claude::sonnet".into(),
            adapter_id: "claude".into(),
            model_id: "sonnet".into(),
            display_name: "Claude Sonnet".into(),
            available: true,
            recommended: false,
            tags: vec![],
        };
        let payload = AnalystPickerState::analyst_payload(&option);
        assert_eq!(payload["selectionSource"], "manual");
        assert!(payload["choice"].is_null());
    }

    #[test]
    fn empty_catalog_yields_empty_picker_never_invented_rows() {
        let mut picker = AnalystPickerState::from_analyst_catalog(&json!({ "models": [] }));
        assert!(picker.is_empty());
        assert!(picker.confirm().is_none());

        let absent = AnalystPickerState::from_analyst_catalog(&json!({}));
        assert!(absent.is_empty());
    }

    #[test]
    fn a_malformed_entry_missing_required_fields_is_dropped_not_half_rendered() {
        let picker = AnalystPickerState::from_analyst_catalog(&json!({
            "models": [
                { "adapterId": "codex" },
                {
                    "candidateKey": "claude::sonnet", "adapterId": "claude", "modelId": "sonnet",
                    "displayName": "Claude Sonnet", "available": true
                }
            ]
        }));
        assert_eq!(picker.options.len(), 1);
        assert_eq!(picker.options[0].adapter_id, "claude");
    }
}
