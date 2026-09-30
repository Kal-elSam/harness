//! Analyst picker (T2): the in-UI equivalent of the cockpit's own
//! ProjectOverlay SELECT_ANALYST state — the human chooses which Bootstrap
//! Analyst model runs `project.analyze`, before any provider call happens.
//! No cockpit dependency: driven entirely by the ratatui host's own
//! `project.preflight` sidecar op and its real `analystCatalog`.
//!
//! Never invents a model absent from the real catalog. The modal lists
//! **only available** models — unavailable adapters (rate-limited Go, etc.)
//! stay out of the picker entirely.

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
    /// `<displayName>    <adapterId>` — model-first, never provider-first.
    /// Recommended gets an honest suffix; unavailable models are never listed.
    pub fn row_label(&self) -> String {
        let mut label = format!("{}    {}", self.display_name, self.adapter_id);
        if self.recommended {
            label.push_str("  ★ recommended");
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
                let available = m.get("available").and_then(|v| v.as_bool()).unwrap_or(false);
                // Product rule: only usable analysts appear in the modal.
                if !available {
                    return None;
                }
                let candidate_key = m.get("candidateKey").and_then(|v| v.as_str())?.to_string();
                let adapter_id = m.get("adapterId").and_then(|v| v.as_str())?.to_string();
                let model_id = m.get("modelId").and_then(|v| v.as_str())?.to_string();
                let display_name = m
                    .get("displayName")
                    .and_then(|v| v.as_str())
                    .unwrap_or(model_id.as_str())
                    .to_string();
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
                    available: true,
                    recommended,
                    tags,
                })
            })
            .collect();
        // Recommended first when the catalog's own recommendedModel survived.
        // Never auto-promote the first row — ★ only for a real recommendation.
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

    /// Move highlight forward, wrapping across available rows only.
    /// Preserves `notice` (e.g. preflight provider-absence copy).
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

    pub fn selected_option(&self) -> Option<&AnalystOption> {
        self.options.get(self.selected)
    }

    /// Enter: confirm the highlighted available model. Defense in depth —
    /// unavailable rows are never listed, but a stale `available: false`
    /// still refuses with an inline notice instead of a silent no-op.
    pub fn confirm(&mut self) -> Option<AnalystOption> {
        let message = match self.selected_option() {
            Some(option) if !option.available => Some(format!(
                "{} is not available right now — pick another model.",
                option.display_name
            )),
            Some(option) => return Some(option.clone()),
            None => Some("No available analyst in the catalog right now.".into()),
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
        assert_eq!(picker.options.len(), 2, "unavailable Cursor X must be filtered out");
        assert_eq!(picker.options[0].adapter_id, "codex");
        assert!(picker.options[0].recommended);
        assert!(picker.options[0].row_label().contains("recommended"));
        assert!(!picker.options.iter().any(|o| o.adapter_id == "cursor"));
    }

    #[test]
    fn unavailable_models_are_never_listed() {
        let picker = AnalystPickerState::from_analyst_catalog(&catalog());
        assert!(picker.options.iter().all(|o| o.available));
        assert!(!picker
            .options
            .iter()
            .any(|o| o.row_label().contains("(unavailable)")));
    }

    #[test]
    fn movement_wraps_across_available_rows_only() {
        let mut picker = AnalystPickerState::from_analyst_catalog(&catalog());
        assert_eq!(picker.options.len(), 2);
        assert_eq!(picker.selected, 0);
        picker.move_down();
        assert_eq!(picker.selected, 1);
        assert_eq!(picker.options[1].adapter_id, "claude");
        picker.move_down();
        assert_eq!(picker.selected, 0, "movement wraps forward");
        picker.move_up();
        assert_eq!(picker.selected, 1, "movement wraps backward too");
    }

    #[test]
    fn confirm_returns_the_available_option_and_never_fabricates_a_notice() {
        let mut picker = AnalystPickerState::from_analyst_catalog(&catalog());
        let picked = picker.confirm().expect("recommended model is available");
        assert_eq!(picked.adapter_id, "codex");
        assert_eq!(picker.notice, None);
    }

    #[test]
    fn all_unavailable_catalog_yields_empty_picker() {
        let picker = AnalystPickerState::from_analyst_catalog(&json!({
            "recommendedModel": { "candidateKey": "go::x" },
            "models": [
                {
                    "candidateKey": "go::x", "adapterId": "opencode-go", "modelId": "x",
                    "displayName": "Go X", "available": false, "recommendationTags": ["quality"]
                }
            ]
        }));
        assert!(picker.is_empty());
    }

    #[test]
    fn when_recommended_is_unavailable_no_row_gets_auto_star() {
        let picker = AnalystPickerState::from_analyst_catalog(&json!({
            "recommendedModel": { "candidateKey": "go::x" },
            "models": [
                {
                    "candidateKey": "go::x", "adapterId": "opencode-go", "modelId": "x",
                    "displayName": "Go X", "available": false, "recommendationTags": ["quality"]
                },
                {
                    "candidateKey": "claude::s", "adapterId": "claude", "modelId": "s",
                    "displayName": "Claude S", "available": true, "recommendationTags": []
                }
            ]
        }));
        assert_eq!(picker.options.len(), 1);
        assert_eq!(picker.options[0].adapter_id, "claude");
        assert!(
            !picker.options[0].recommended,
            "★ must never be invented when catalog recommendedModel is absent from listed rows"
        );
        assert!(!picker.options[0].row_label().contains("recommended"));
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
