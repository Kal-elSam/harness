//! Analyst picker (T2): the in-UI equivalent of the cockpit's own
//! ProjectOverlay SELECT_ANALYST state — the human chooses which Bootstrap
//! Analyst model runs `project.analyze`, before any provider call happens.
//! No cockpit dependency: driven entirely by the ratatui host's own
//! `project.preflight` sidecar op and its real `analystCatalog`.
//!
//! Never invents a model absent from the real catalog. The modal lists
//! **usable** models — unavailable adapters (rate-limited Go, etc.) stay out
//! of the picker entirely. Models whose access is UNVERIFIED (catalog
//! `accessVerified: false`, `selectable: true`) are listed after the verified
//! ones with an "acceso sin verificar" marker; they are never starred and the
//! sidecar re-verifies access when one is confirmed (T20).

use std::cell::Cell;

use serde_json::Value;

/// One real catalog entry (from `preflightProjectTeam`'s `analystCatalog`).
#[derive(Debug, Clone, PartialEq)]
pub struct AnalystOption {
    pub candidate_key: String,
    pub adapter_id: String,
    pub model_id: String,
    pub display_name: String,
    pub available: bool,
    /// `false` when the catalog says access is unverified (selectable, never
    /// starred, revalidated by the sidecar on confirm). Absent = verified.
    pub access_verified: bool,
    pub recommended: bool,
    pub tags: Vec<String>,
    /// Analyst fit 0..1 when the catalog has real evidence; `None` = unknown
    /// (absent or `null`), never an invented 0. A measured 0 stays `Some(0.0)`.
    pub fit: Option<f64>,
    /// Sidecar's short per-row explanation (real evidence only), if any.
    pub explanation: Option<String>,
}

/// Marker for rows whose access is not verified yet.
pub const ACCESS_UNVERIFIED_MARKER: &str = "acceso sin verificar";

impl AnalystOption {
    /// `<displayName>    <adapterId>` — model-first, never provider-first.
    /// Recommended gets an honest suffix; unavailable models are never listed.
    pub fn row_label(&self) -> String {
        let mut label = format!("{}    {}", self.display_name, self.adapter_id);
        if self.recommended {
            label.push_str("  ★ recommended");
        }
        if !self.access_verified {
            label.push_str("  · ");
            label.push_str(ACCESS_UNVERIFIED_MARKER);
        }
        label
    }

    /// Short secondary line — the real tag(s) and the sidecar's own
    /// explanation only, never invented.
    pub fn description(&self) -> String {
        let mut parts: Vec<String> = self
            .tags
            .iter()
            .map(|t| match t.as_str() {
                "quality" => "Quality fit".to_string(),
                "efficient" => "Efficient fit".to_string(),
                other => other.to_string(),
            })
            .collect();
        if let Some(explanation) = self.explanation.as_deref().filter(|e| !e.is_empty()) {
            parts.push(explanation.to_string());
        }
        if !self.access_verified {
            parts.push("se verifica al confirmar".to_string());
        }
        parts.join(" · ")
    }

    /// Lines this option takes in the list (label + optional description).
    pub fn height(&self) -> usize {
        if self.description().is_empty() {
            1
        } else {
            2
        }
    }
}

/// Which list the modal shows: the qualified main view (default) or the
/// explicit manual alternatives (no benchmark / unknown access).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PickerView {
    #[default]
    Main,
    Manual,
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
#[derive(Debug, Clone, PartialEq, Default)]
pub struct AnalystPickerState {
    /// MAIN view rows (qualified candidates), in the sidecar's order.
    pub options: Vec<AnalystOption>,
    /// MANUAL alternatives (no benchmark / unknown access): never starred,
    /// never auto-selected. Empty for an older sidecar without the field.
    pub alternatives: Vec<AnalystOption>,
    pub view: PickerView,
    /// Highlighted row inside the ACTIVE view.
    pub selected: usize,
    /// First visible row of the active view (kept stable while scrolling).
    pub scroll: Cell<usize>,
    pub notice: Option<String>,
    pub phase: PickerPhase,
    pub causes: Vec<ExclusionCause>,
    /// `Some(option)` while the provider-call warning for an unknown-access
    /// row waits for its explicit second confirmation.
    pub warning: Option<AnalystOption>,
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
        let parse_list = |key: &str, allow_recommended: bool| -> Vec<AnalystOption> {
            let models = catalog
                .get(key)
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let mut options: Vec<AnalystOption> = models
                .iter()
                .filter_map(|m| Self::parse_option(m, recommended_key, allow_recommended))
                .collect();
            // Recommended first when the catalog's own recommendedModel
            // survived; known fit before unknown fit (stable otherwise, so
            // the sidecar's order is preserved). Never auto-promote the first
            // row — ★ only for a real recommendation.
            options.sort_by_key(|o| (!o.recommended, o.fit.is_none()));
            options
        };
        Self {
            options: parse_list("models", true),
            // Manual alternatives are never starred, whatever the pointer says.
            alternatives: parse_list("alternatives", false),
            ..Self::default()
        }
    }

    fn parse_option(
        m: &Value,
        recommended_key: Option<&str>,
        allow_recommended: bool,
    ) -> Option<AnalystOption> {
        let available = m.get("available").and_then(|v| v.as_bool()).unwrap_or(false);
        let selectable = m.get("selectable").and_then(|v| v.as_bool()).unwrap_or(false);
        let access_verified = m.get("accessVerified").and_then(|v| v.as_bool()).unwrap_or(true);
        // Product rule: only usable analysts appear in the modal, plus
        // selectable ones whose access is unverified (T20).
        if !available && !(selectable && !access_verified) {
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
            .map(|arr| arr.iter().filter_map(|t| t.as_str().map(str::to_string)).collect())
            .unwrap_or_default();
        let recommended =
            allow_recommended && access_verified && recommended_key == Some(candidate_key.as_str());
        // null / absent / non-numeric fit = unknown (never coerced to 0).
        let fit = m.get("fit").and_then(|v| v.as_f64()).filter(|f| f.is_finite());
        let explanation = m
            .get("explanation")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|e| !e.is_empty())
            .map(str::to_string);
        Some(AnalystOption {
            candidate_key,
            adapter_id,
            model_id,
            display_name,
            available,
            access_verified,
            recommended,
            tags,
            fit,
            explanation,
        })
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

    /// `true` when the ACTIVE view has no rows.
    pub fn is_empty(&self) -> bool {
        self.active().is_empty()
    }

    /// Rows of the active view.
    pub fn active(&self) -> &[AnalystOption] {
        match self.view {
            PickerView::Main => &self.options,
            PickerView::Manual => &self.alternatives,
        }
    }

    /// `m`: switch between the qualified list and the manual alternatives.
    /// Clears any pending warning; selection restarts at the top.
    pub fn toggle_view(&mut self) {
        if self.phase != PickerPhase::Ready {
            return;
        }
        self.view = match self.view {
            PickerView::Main => PickerView::Manual,
            PickerView::Manual => PickerView::Main,
        };
        self.selected = 0;
        self.scroll.set(0);
        self.warning = None;
    }

    /// Move highlight forward, wrapping across the active view's rows.
    /// Preserves `notice` (e.g. preflight provider-absence copy).
    pub fn move_down(&mut self) {
        let len = self.active().len();
        if len == 0 || self.warning.is_some() {
            return;
        }
        self.selected = (self.selected + 1) % len;
    }

    pub fn move_up(&mut self) {
        let len = self.active().len();
        if len == 0 || self.warning.is_some() {
            return;
        }
        self.selected = (self.selected + len - 1) % len;
    }

    pub fn selected_option(&self) -> Option<&AnalystOption> {
        self.active().get(self.selected)
    }

    /// Visible slice `[start, end)` of the active view for `rows` content
    /// lines: the highlighted row is always inside it, and the window only
    /// moves when the highlight would leave it.
    pub fn visible_range(&self, rows: usize) -> std::ops::Range<usize> {
        let options = self.active();
        if options.is_empty() || rows == 0 {
            return 0..0;
        }
        let selected = self.selected.min(options.len() - 1);
        let mut start = self.scroll.get().min(selected);
        let span = |from: usize| -> usize { options[from..=selected].iter().map(AnalystOption::height).sum() };
        while start < selected && span(start) > rows {
            start += 1;
        }
        self.scroll.set(start);
        let mut end = start;
        let mut used = 0;
        while end < options.len() && used + options[end].height() <= rows.max(1) {
            used += options[end].height();
            end += 1;
        }
        start..end.max(selected + 1).min(options.len())
    }

    /// Esc while the provider-call warning is up: back to the list (the
    /// picker stays open). Returns `true` when a warning was dismissed.
    pub fn cancel_warning(&mut self) -> bool {
        self.warning.take().is_some()
    }

    /// Enter: confirm the highlighted model. A verified, available row is
    /// returned at once. An UNKNOWN-access row first raises a warning (the
    /// verification calls the provider and may consume account) and returns
    /// `None`; only a second Enter on that warning returns it. Unavailable
    /// verified rows are refused with an inline notice (defense in depth).
    pub fn confirm(&mut self) -> Option<AnalystOption> {
        if self.phase != PickerPhase::Ready {
            return None;
        }
        if let Some(pending) = self.warning.take() {
            return Some(pending);
        }
        let message = match self.selected_option() {
            Some(option) if !option.available && option.access_verified => Some(format!(
                "{} is not available right now — pick another model.",
                option.display_name
            )),
            Some(option) if !option.access_verified => {
                self.warning = Some(option.clone());
                self.notice = None;
                return None;
            }
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
        let mut payload = serde_json::json!({
            "model": {
                "adapterId": option.adapter_id,
                "modelId": option.model_id,
                "displayName": option.display_name,
            },
            "selectionSource": selection_source,
            "recommendationTags": option.tags,
            "choice": choice,
        });
        // The payload is only ever built after the explicit second
        // confirmation (see `confirm`), so an unknown-access pick carries it.
        if !option.access_verified {
            payload["accessCheckConfirmed"] = Value::Bool(true);
        }
        payload
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
            access_verified: true,
            recommended: true,
            tags: vec!["quality".into()],
            fit: None,
            explanation: None,
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
            access_verified: true,
            recommended: false,
            tags: vec![],
            fit: None,
            explanation: None,
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

    fn unverified_catalog() -> Value {
        json!({
            "recommendedModel": { "candidateKey": "claude::unv" },
            "models": [
                {
                    "candidateKey": "codex::gpt", "adapterId": "codex", "modelId": "gpt",
                    "displayName": "GPT", "available": true, "accessVerified": true,
                    "selectable": true, "recommendationTags": []
                },
                {
                    "candidateKey": "claude::unv", "adapterId": "claude", "modelId": "unv",
                    "displayName": "Claude Unverified", "available": false, "accessVerified": false,
                    "selectable": true, "cause": "access_unknown", "recommendationTags": ["quality"]
                },
                {
                    "candidateKey": "cursor::down", "adapterId": "cursor", "modelId": "down",
                    "displayName": "Cursor Down", "available": false, "accessVerified": true,
                    "selectable": false, "cause": "quota_exhausted", "recommendationTags": []
                }
            ]
        })
    }

    #[test]
    fn unverified_access_rows_are_listed_marked_and_never_starred() {
        let picker = AnalystPickerState::from_analyst_catalog(&unverified_catalog());
        assert_eq!(picker.options.len(), 2, "selectable unverified row kept; unusable Cursor row dropped");
        let unv = picker.options.iter().find(|o| o.adapter_id == "claude").expect("unverified row");
        assert!(!unv.access_verified);
        assert!(!unv.available);
        assert!(!unv.recommended, "a catalog pointer must never star an unverified row");
        assert!(unv.row_label().contains("acceso sin verificar"), "{}", unv.row_label());
        assert!(!unv.row_label().contains("recommended"));
        let verified = picker.options.iter().find(|o| o.adapter_id == "codex").unwrap();
        assert!(verified.access_verified);
        assert!(!verified.row_label().contains("sin verificar"));
        assert_eq!(picker.options[0].adapter_id, "codex", "verified rows stay ahead (sidecar order preserved)");
    }

    #[test]
    fn confirming_an_unverified_row_warns_first_and_needs_a_second_confirmation() {
        let mut picker = AnalystPickerState::from_analyst_catalog(&unverified_catalog());
        picker.move_down();
        assert!(picker.confirm().is_none(), "first Enter must NOT send anything");
        let warning = picker.warning.clone().expect("the provider-call warning is raised");
        assert_eq!(warning.model_id, "unv");
        assert!(picker.notice.is_none());
        let picked = picker.confirm().expect("second Enter confirms");
        assert_eq!(picked.model_id, "unv");
        assert!(picker.warning.is_none());
        let payload = AnalystPickerState::analyst_payload(&picked);
        assert_eq!(payload["selectionSource"], "manual");
        assert_eq!(payload["model"]["modelId"], "unv");
        assert_eq!(payload["model"]["adapterId"], "claude");
        assert_eq!(payload["accessCheckConfirmed"], true);
    }

    #[test]
    fn esc_on_the_warning_returns_to_the_list_without_confirming() {
        let mut picker = AnalystPickerState::from_analyst_catalog(&unverified_catalog());
        picker.move_down();
        assert!(picker.confirm().is_none());
        assert!(picker.cancel_warning());
        assert!(picker.warning.is_none());
        assert!(!picker.cancel_warning(), "nothing left to cancel");
        // A fresh Enter warns again (the confirmation is never remembered).
        assert!(picker.confirm().is_none());
        assert!(picker.warning.is_some());
    }

    #[test]
    fn movement_is_frozen_while_the_warning_is_up_and_toggling_clears_it() {
        let mut picker = AnalystPickerState::from_analyst_catalog(&unverified_catalog());
        picker.move_down();
        picker.confirm();
        let at = picker.selected;
        picker.move_down();
        picker.move_up();
        assert_eq!(picker.selected, at);
        picker.toggle_view();
        assert!(picker.warning.is_none());
    }

    #[test]
    fn a_verified_payload_never_carries_the_access_confirmation_flag() {
        let mut picker = AnalystPickerState::from_analyst_catalog(&catalog());
        let picked = picker.confirm().unwrap();
        let payload = AnalystPickerState::analyst_payload(&picked);
        assert!(payload.get("accessCheckConfirmed").is_none());
    }

    fn views_catalog() -> Value {
        json!({
            "recommendedModel": { "candidateKey": "codex::a" },
            "models": [
                { "candidateKey": "codex::a", "adapterId": "codex", "modelId": "a", "displayName": "Alpha",
                  "available": true, "accessVerified": true, "fit": 0.8, "explanation": "razonamiento 0.80 · código 0.70 · confianza 0.90",
                  "recommendationTags": ["quality"], "listing": "main" },
                { "candidateKey": "claude::a", "adapterId": "claude", "modelId": "a", "displayName": "Alpha",
                  "available": true, "accessVerified": true, "fit": 0.0, "recommendationTags": [], "listing": "main" },
                { "candidateKey": "codex::nofit", "adapterId": "codex", "modelId": "nofit", "displayName": "NoFit",
                  "available": true, "accessVerified": true, "fit": null, "recommendationTags": [], "listing": "main" }
            ],
            "alternatives": [
                { "candidateKey": "cursor::unscored", "adapterId": "cursor", "modelId": "unscored", "displayName": "Unscored",
                  "available": true, "accessVerified": true, "fit": null, "recommendationTags": [], "listing": "manual" },
                { "candidateKey": "claude::unv", "adapterId": "claude", "modelId": "unv", "displayName": "Unv",
                  "available": false, "selectable": true, "accessVerified": false, "fit": 0.4, "recommendationTags": ["quality"], "listing": "manual" },
                { "candidateKey": "cursor::down", "adapterId": "cursor", "modelId": "down", "displayName": "Down",
                  "available": false, "selectable": false, "accessVerified": true, "recommendationTags": [] }
            ]
        })
    }

    #[test]
    fn main_and_manual_views_are_separate_lists_and_the_star_only_lives_in_main() {
        let mut picker = AnalystPickerState::from_analyst_catalog(&views_catalog());
        assert_eq!(picker.view, PickerView::Main);
        assert_eq!(picker.options.len(), 3);
        assert_eq!(picker.alternatives.len(), 2, "unusable row dropped, both manual rows kept");
        assert!(picker.options[0].recommended);
        assert!(picker.alternatives.iter().all(|o| !o.recommended));
        picker.toggle_view();
        assert_eq!(picker.view, PickerView::Manual);
        assert_eq!(picker.active().len(), 2);
        assert_eq!(picker.selected, 0);
        picker.toggle_view();
        assert_eq!(picker.view, PickerView::Main);
    }

    #[test]
    fn a_null_fit_is_unknown_and_sorts_after_known_fits_while_a_measured_zero_stays_known() {
        let picker = AnalystPickerState::from_analyst_catalog(&views_catalog());
        let fits: Vec<Option<f64>> = picker.options.iter().map(|o| o.fit).collect();
        assert_eq!(fits, vec![Some(0.8), Some(0.0), None]);
        // Absent (legacy) fit is also unknown, never 0.
        let legacy = AnalystPickerState::from_analyst_catalog(&json!({
            "models": [{ "candidateKey": "a::b", "adapterId": "a", "modelId": "b", "available": true }]
        }));
        assert_eq!(legacy.options[0].fit, None);
        // Manual view: known fit (Unv 0.4, unverified) precedes unknown (Unscored).
        assert_eq!(picker.alternatives[0].model_id, "unv");
        assert_eq!(picker.alternatives[1].model_id, "unscored");
    }

    #[test]
    fn the_same_model_through_two_subscriptions_keeps_both_rows_keyed_by_candidate_key() {
        let picker = AnalystPickerState::from_analyst_catalog(&views_catalog());
        let alphas: Vec<&str> = picker
            .options
            .iter()
            .filter(|o| o.display_name == "Alpha")
            .map(|o| o.candidate_key.as_str())
            .collect();
        assert_eq!(alphas.len(), 2);
        assert!(alphas.contains(&"codex::a") && alphas.contains(&"claude::a"));
    }

    #[test]
    fn explanation_is_part_of_the_row_description() {
        let picker = AnalystPickerState::from_analyst_catalog(&views_catalog());
        assert!(picker.options[0].description().contains("razonamiento 0.80"));
        assert!(picker.options[0].description().contains("Quality fit"));
    }

    #[test]
    fn manual_unverified_rows_confirm_through_the_warning_too() {
        let mut picker = AnalystPickerState::from_analyst_catalog(&views_catalog());
        picker.toggle_view();
        assert_eq!(picker.selected_option().unwrap().model_id, "unv");
        assert!(picker.confirm().is_none());
        assert!(picker.warning.is_some());
        // A manual but verified (unscored) row needs no warning.
        picker.cancel_warning();
        picker.move_down();
        assert_eq!(picker.confirm().unwrap().model_id, "unscored");
    }

    fn many_options(n: usize) -> AnalystPickerState {
        let models: Vec<Value> = (0..n)
            .map(|i| {
                json!({ "candidateKey": format!("x::m{i}"), "adapterId": "x", "modelId": format!("m{i}"),
                        "displayName": format!("Model {i}"), "available": true, "accessVerified": true,
                        "fit": 0.9 - (i as f64) / 1000.0, "recommendationTags": [] })
            })
            .collect();
        AnalystPickerState::from_analyst_catalog(&json!({ "models": models }))
    }

    #[test]
    fn there_is_no_row_cap_every_option_is_kept() {
        assert_eq!(many_options(40).options.len(), 40);
    }

    #[test]
    fn the_visible_window_follows_the_selection_and_never_hides_it() {
        let mut picker = many_options(40);
        // 10 content lines, every option is 1 line (no description).
        assert_eq!(picker.visible_range(10), 0..10);
        for _ in 0..25 {
            picker.move_down();
        }
        let range = picker.visible_range(10);
        assert!(range.contains(&picker.selected), "{range:?} must contain {}", picker.selected);
        assert_eq!(range.len(), 10);
        // Moving up inside the window does not scroll it.
        picker.move_up();
        assert_eq!(picker.visible_range(10), range);
        // Wrapping to the top scrolls back to the first rows.
        for _ in 0..(picker.selected) {
            picker.move_up();
        }
        assert_eq!(picker.selected, 0);
        assert_eq!(picker.visible_range(10), 0..10);
        // Wrapping up from the top lands on the last row, visible.
        picker.move_up();
        assert_eq!(picker.selected, 39);
        assert!(picker.visible_range(10).contains(&39));
    }

    #[test]
    fn a_tiny_window_still_shows_the_selected_row() {
        let mut picker = many_options(5);
        picker.move_down();
        picker.move_down();
        let range = picker.visible_range(1);
        assert!(range.contains(&2));
    }
    #[test]
    fn a_stale_unavailable_verified_row_is_still_refused_and_absent_fields_stay_tolerant() {
        let mut stale = AnalystPickerState::from_analyst_catalog(&json!({
            "models": [{ "candidateKey": "a::b", "adapterId": "a", "modelId": "b", "available": true }]
        }));
        assert!(stale.options[0].access_verified, "absent accessVerified means verified/legacy");
        stale.options[0].available = false;
        assert!(stale.confirm().is_none());
        assert!(stale.notice.as_deref().unwrap_or("").contains("not available"));
    }
}
