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

/// Which body the modal shows: the modal opens in `Loading` the moment the
/// preflight request is sent, then becomes `Ready` (catalog arrived) or
/// `Error` (the request failed) — the failure stays inside the modal.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum PickerPhase {
    #[default]
    Ready,
    Loading,
    Error(String),
}

/// One per-provider exclusion row from the preflight record's additive
/// `exclusionCauses` (see project-team-sidecar.js `buildAnalystExclusionCauses`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExclusionCause {
    pub adapter_id: String,
    pub provider: String,
    pub cause: String,
    pub models: u64,
    pub reason: Option<String>,
}

impl ExclusionCause {
    /// Tolerant parse: `None` when the field is absent (older sidecar) so the
    /// caller keeps the `pickerNotice` fallback; malformed rows are dropped.
    pub fn list_from_record(record: &Value) -> Option<Vec<Self>> {
        let rows = record.get("exclusionCauses")?.as_array()?;
        Some(
            rows.iter()
                .filter_map(|row| {
                    let str_of = |k: &str| row.get(k).and_then(|v| v.as_str());
                    let provider = str_of("provider").or_else(|| str_of("adapterId"))?;
                    Some(Self {
                        adapter_id: str_of("adapterId").unwrap_or(provider).to_string(),
                        provider: provider.to_string(),
                        cause: str_of("cause").unwrap_or("").to_string(),
                        models: row.get("models").and_then(|v| v.as_u64()).unwrap_or(0),
                        reason: str_of("reason")
                            .map(str::trim)
                            .filter(|r| !r.is_empty())
                            .map(str::to_string),
                    })
                })
                .collect(),
        )
    }

    /// One short line per provider. Wording is distinct per cause (same
    /// Spanish register as the sidecar's own picker notices); unknown access
    /// and missing benchmarks are never worded as "unavailable".
    pub fn line(&self) -> String {
        let what = match self.cause.as_str() {
            "quota_exhausted" => "cuota agotada".to_string(),
            "unavailable_verified" => "no disponible (verificado)".to_string(),
            "policy_excluded" => "excluido por política".to_string(),
            "access_unknown" => "acceso sin verificar".to_string(),
            "unscored" => "sin benchmark (solo selección manual)".to_string(),
            other => format!("excluido ({other})"),
        };
        match &self.reason {
            Some(reason) => format!("{}: {what} — {reason}", self.provider),
            None => format!("{}: {what}", self.provider),
        }
    }
}

/// State machine for the modal: options + selection + an inline notice
/// (e.g. "that model isn't available"), never a silent no-op.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct AnalystPickerState {
    pub options: Vec<AnalystOption>,
    pub selected: usize,
    pub notice: Option<String>,
    pub phase: PickerPhase,
    pub causes: Vec<ExclusionCause>,
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
            phase: PickerPhase::Ready,
            causes: Vec::new(),
        }
    }

    /// Modal shown while the preflight request is pending.
    pub fn loading() -> Self {
        Self {
            phase: PickerPhase::Loading,
            ..Self::default()
        }
    }

    /// Modal showing a preflight failure (retry / close).
    pub fn failed(reason: impl Into<String>) -> Self {
        Self {
            phase: PickerPhase::Error(reason.into()),
            ..Self::default()
        }
    }

    /// Footer text: per-provider cause lines (when the sidecar sent them)
    /// followed by any other notice (`pickerNotice` fallback, inline refusals).
    pub fn footer_text(&self) -> Option<String> {
        let mut parts: Vec<String> = self.causes.iter().map(ExclusionCause::line).collect();
        if let Some(notice) = &self.notice {
            parts.push(notice.clone());
        }
        if parts.is_empty() {
            None
        } else {
            Some(parts.join("\n"))
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
        if self.phase != PickerPhase::Ready {
            return None;
        }
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

    fn record_with_causes(causes: Value) -> Value {
        json!({ "ok": true, "exclusionCauses": causes })
    }

    #[test]
    fn default_state_is_ready_and_loading_error_constructors_set_the_phase() {
        assert_eq!(AnalystPickerState::default().phase, PickerPhase::Ready);
        let loading = AnalystPickerState::loading();
        assert_eq!(loading.phase, PickerPhase::Loading);
        assert!(loading.options.is_empty());
        let failed = AnalystPickerState::failed("sidecar timed out");
        assert_eq!(failed.phase, PickerPhase::Error("sidecar timed out".into()));
    }

    #[test]
    fn confirm_is_a_silent_noop_while_loading_or_failed() {
        let mut loading = AnalystPickerState::loading();
        assert!(loading.confirm().is_none());
        assert_eq!(loading.notice, None, "loading must not invent a notice");
        let mut failed = AnalystPickerState::failed("boom");
        assert!(failed.confirm().is_none());
        assert_eq!(failed.notice, None);
    }

    #[test]
    fn every_cause_has_distinct_wording_and_never_says_unavailable_for_unknowns() {
        let causes = ExclusionCause::list_from_record(&record_with_causes(json!([
            { "adapterId": "claude", "provider": "claude", "cause": "quota_exhausted", "models": 2, "reason": null },
            { "adapterId": "cursor", "provider": "cursor", "cause": "unavailable_verified", "models": 1, "reason": null },
            { "adapterId": "go", "provider": "go", "cause": "policy_excluded", "models": 1, "reason": null },
            { "adapterId": "codex", "provider": "codex", "cause": "access_unknown", "models": 1, "reason": null },
            { "adapterId": "zed", "provider": "zed", "cause": "unscored", "models": 3, "reason": null }
        ])))
        .expect("field present");
        let lines: Vec<String> = causes.iter().map(ExclusionCause::line).collect();
        assert_eq!(lines[0], "claude: cuota agotada");
        assert_eq!(lines[1], "cursor: no disponible (verificado)");
        assert_eq!(lines[2], "go: excluido por política");
        assert_eq!(lines[3], "codex: acceso sin verificar");
        assert_eq!(lines[4], "zed: sin benchmark (solo selección manual)");
        let unique: std::collections::HashSet<_> = lines.iter().map(|l| l.split(": ").nth(1).unwrap().to_string()).collect();
        assert_eq!(unique.len(), 5, "wording must be distinct per cause");
        assert!(!lines[3].contains("no disponible"));
        assert!(!lines[4].contains("no disponible"));
    }

    #[test]
    fn cause_reason_is_appended_and_unknown_cause_is_shown_verbatim_not_as_unavailable() {
        let causes = ExclusionCause::list_from_record(&record_with_causes(json!([
            { "adapterId": "claude", "provider": "claude", "cause": "quota_exhausted", "models": 1, "reason": "reset 5pm" },
            { "adapterId": "x", "provider": "x", "cause": "brand_new", "models": 1, "reason": null }
        ])))
        .unwrap();
        assert_eq!(causes[0].line(), "claude: cuota agotada — reset 5pm");
        assert_eq!(causes[1].line(), "x: excluido (brand_new)");
    }

    #[test]
    fn absent_field_yields_none_and_malformed_rows_are_dropped() {
        assert!(ExclusionCause::list_from_record(&json!({ "ok": true })).is_none());
        let causes = ExclusionCause::list_from_record(&record_with_causes(json!([
            { "cause": "unscored" },
            "junk",
            { "provider": "zed", "cause": "unscored" }
        ])))
        .unwrap();
        assert_eq!(causes.len(), 1);
        assert_eq!(causes[0].provider, "zed");
        assert_eq!(causes[0].models, 0, "missing models defaults, never invented");
    }

    #[test]
    fn footer_shows_causes_then_notice_and_falls_back_to_notice_alone() {
        let mut picker = AnalystPickerState::default();
        picker.notice = Some("Claude: cuota agotada".into());
        assert_eq!(picker.footer_text().as_deref(), Some("Claude: cuota agotada"));
        picker.causes = vec![ExclusionCause {
            adapter_id: "codex".into(),
            provider: "codex".into(),
            cause: "access_unknown".into(),
            models: 1,
            reason: None,
        }];
        assert_eq!(
            picker.footer_text().as_deref(),
            Some("codex: acceso sin verificar\nClaude: cuota agotada")
        );
        assert_eq!(AnalystPickerState::default().footer_text(), None);
    }
}
