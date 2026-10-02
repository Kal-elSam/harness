//! Analyst picker (T2): the in-UI equivalent of the cockpit's own
//! ProjectOverlay SELECT_ANALYST state — the human chooses which Bootstrap
//! Analyst model runs `project.analyze`, before any provider call happens.
//! No cockpit dependency: driven entirely by the ratatui host's own
//! `project.preflight` sidecar op and its real `analystCatalog`.
//!
//! Never invents a model absent from the real catalog. The modal lists
//! **verified, available** models only (T23): unverified, denied, exhausted and
//! unavailable candidates never appear as rows; the sidecar reports them
//! separately by subscription. When the preflight carries pending access
//! checks the modal first shows a concrete confirmation screen (`Verify`):
//! Enter runs the consented verification (`project.verify_access`), Esc skips
//! it and opens the picker on already-verified options only.

use std::cell::Cell;

use serde_json::Value;

/// One real catalog entry (from `preflightProjectTeam`'s `analystCatalog`).
#[derive(Debug, Clone, PartialEq)]
pub struct AnalystOption {
    pub candidate_key: String,
    pub adapter_id: String,
    pub model_id: String,
    pub display_name: String,
    /// The subscription the model runs through (sidecar `subscription`, else
    /// the adapter id) — rows are identified by model AND subscription.
    pub subscription: String,
    pub available: bool,
    pub recommended: bool,
    pub tags: Vec<String>,
    /// Sidecar's plain-language per-row explanation (why it is here and what
    /// differs from the other options), if any. The catalog order (`rank`)
    /// stays in the sidecar: the host neither scores nor re-sorts rows.
    pub explanation: Option<String>,
}

/// Greedy word wrap to `width` characters; a word longer than the width is
/// hard-split. Never drops or reorders text.
pub fn wrap_words(text: &str, width: usize) -> Vec<String> {
    let width = width.max(1);
    let mut lines: Vec<String> = Vec::new();
    let mut current = String::new();
    for word in text.split_whitespace() {
        let mut word: Vec<char> = word.chars().collect();
        loop {
            let used = current.chars().count();
            let needed = word.len() + usize::from(used > 0);
            if used + needed <= width {
                if used > 0 {
                    current.push(' ');
                }
                current.extend(word.iter());
                break;
            }
            if used > 0 {
                lines.push(std::mem::take(&mut current));
                continue;
            }
            // A single word wider than the line: hard split.
            let head: String = word.drain(..width).collect();
            lines.push(head);
            if word.is_empty() {
                break;
            }
        }
    }
    if !current.is_empty() {
        lines.push(current);
    }
    lines
}

impl AnalystOption {
    /// `<displayName> · <subscription>` — model AND subscription, so the same
    /// model through two subscriptions is distinguishable. No star or rank.
    pub fn row_label(&self) -> String {
        format!("{} · {}", self.display_name, self.subscription)
    }

    /// Secondary line under the model label. Always empty: the picker is a
    /// flat model list (label only). Sidecar `explanation` may still arrive
    /// on the option for other surfaces; it is not painted in the list.
    pub fn description(&self) -> String {
        String::new()
    }

    /// Wrapped secondary lines — always empty (see [`Self::description`]).
    pub fn description_lines(&self, _width: usize) -> Vec<String> {
        Vec::new()
    }

    /// Rows in the list for this option (label only → always 1).
    pub fn height_at(&self, _width: usize) -> usize {
        1
    }
}

/// Width (in characters) an explanation line gets when the modal width is not
/// known yet (before the first render).
pub const DEFAULT_DESCRIPTION_WIDTH: usize = 64;

/// Which list the modal shows: the qualified main view (default) or the
/// explicit manual alternatives (no benchmark / unknown access).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PickerView {
    #[default]
    Main,
    Manual,
}

/// Which body the modal shows: the modal opens in `Loading` the moment the
/// preflight request is sent, then becomes `Verify` (pending access checks:
/// concrete confirmation screen), `Ready` (catalog arrived) or `Error` (the
/// request failed) — loading, verification and failure all stay inside the
/// modal. `Verifying` is the wait for the consented verification to finish.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum PickerPhase {
    #[default]
    Ready,
    Loading,
    Verify,
    Verifying,
    Error(String),
}

/// One check of the verification plan (Claude: a model; Cursor: a pool).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanCheck {
    pub label: String,
    pub pending: bool,
}

/// One subscription's share of the plan.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanSubscription {
    pub provider: String,
    /// `"model"` (Claude) or `"pool"` (Cursor).
    pub granularity: String,
    pub checks: Vec<PlanCheck>,
}

impl PlanSubscription {
    pub fn pending(&self) -> usize {
        self.checks.iter().filter(|c| c.pending).count()
    }
}

/// The concrete, never-executed verification plan from the preflight record's
/// additive `verificationPlan`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerificationPlan {
    pub pending: usize,
    pub reusable: usize,
    pub subscriptions: Vec<PlanSubscription>,
}

impl VerificationPlan {
    /// Tolerant parse: `None` when the field is absent/malformed (older
    /// sidecar), so the picker opens as before.
    pub fn from_record(record: &Value) -> Option<Self> {
        let plan = record.get("verificationPlan")?;
        let subs = plan.get("subscriptions")?.as_array()?;
        let subscriptions: Vec<PlanSubscription> = subs
            .iter()
            .filter_map(|sub| {
                let provider = sub
                    .get("provider")
                    .or_else(|| sub.get("adapterId"))
                    .and_then(|v| v.as_str())?
                    .to_string();
                let granularity = sub
                    .get("granularity")
                    .and_then(|v| v.as_str())
                    .unwrap_or("model")
                    .to_string();
                let checks = sub
                    .get("checks")
                    .and_then(|v| v.as_array())
                    .map(|checks| {
                        checks
                            .iter()
                            .filter_map(|c| {
                                let label = c
                                    .get("label")
                                    .or_else(|| c.get("modelId"))
                                    .and_then(|v| v.as_str())?
                                    .to_string();
                                let pending =
                                    c.get("state").and_then(|v| v.as_str()) == Some("pending");
                                Some(PlanCheck { label, pending })
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                Some(PlanSubscription {
                    provider,
                    granularity,
                    checks,
                })
            })
            .collect();
        let pending = subscriptions.iter().map(PlanSubscription::pending).sum();
        let reusable = subscriptions
            .iter()
            .map(|s| s.checks.len() - s.pending())
            .sum();
        Some(Self {
            pending,
            reusable,
            subscriptions,
        })
    }

    /// Subscriptions with at least one pending check.
    pub fn pending_subscriptions(&self) -> usize {
        self.subscriptions.iter().filter(|s| s.pending() > 0).count()
    }

    /// The confirmation screen body: which accounts, which checks, and the
    /// quota-consumption warning. Checks reused from fresh evidence make no call.
    pub fn lines(&self) -> Vec<String> {
        let mut lines = vec!["Verify access before choosing an analyst.".to_string()];
        for sub in self.subscriptions.iter().filter(|s| s.pending() > 0) {
            let unit = if sub.granularity == "pool" { "pool" } else { "model" };
            let n = sub.pending();
            let labels: Vec<&str> = sub
                .checks
                .iter()
                .filter(|c| c.pending)
                .map(|c| c.label.as_str())
                .collect();
            lines.push(format!(
                "{}: {n} {unit} check{} — {}",
                sub.provider,
                if n == 1 { "" } else { "s" },
                labels.join(", ")
            ));
        }
        if self.reusable > 0 {
            lines.push(format!(
                "{} check{} already verified — reused, no call.",
                self.reusable,
                if self.reusable == 1 { "" } else { "s" }
            ));
        }
        lines.push(format!(
            "Makes {} real provider call{} and may consume quota or account credit.",
            self.pending,
            if self.pending == 1 { "" } else { "s" }
        ));
        lines.push("Enter = verify · Esc = skip (only verified options are listed)".to_string());
        lines
    }
}

/// One line per verified subscription from a `verification` record's
/// `outcomes`: counts only (allowed / denied / unverified). The real reasons of
/// the failed checks stay in `outcome_details` (the detail view). Never invents
/// a result.
pub fn outcome_lines(outcomes: &Value) -> Vec<String> {
    let Some(rows) = outcomes.as_array() else {
        return Vec::new();
    };
    rows.iter()
        .filter_map(|row| {
            let provider = row
                .get("provider")
                .or_else(|| row.get("adapterId"))
                .and_then(|v| v.as_str())?;
            let count = |k: &str| row["counts"].get(k).and_then(|v| v.as_u64()).unwrap_or(0);
            Some(format!(
                "{provider}: {} allowed · {} denied · {} unverified",
                count("allowed"),
                count("denied"),
                count("unverified")
            ))
        })
        .collect()
}

/// One detail line per failed (denied / unverified) check of a `verification`
/// record, with its real reason: `Provider · label — status: reason`.
pub fn outcome_details(outcomes: &Value) -> Vec<String> {
    let Some(rows) = outcomes.as_array() else {
        return Vec::new();
    };
    let mut lines = Vec::new();
    for row in rows {
        let Some(provider) = row
            .get("provider")
            .or_else(|| row.get("adapterId"))
            .and_then(|v| v.as_str())
        else {
            continue;
        };
        for result in row.get("results").and_then(|v| v.as_array()).into_iter().flatten() {
            let status = result.get("status").and_then(|v| v.as_str()).unwrap_or("");
            if status != "denied" && status != "unverified" {
                continue;
            }
            let label = result
                .get("label")
                .or_else(|| result.get("modelId"))
                .and_then(|v| v.as_str())
                .unwrap_or("check");
            lines.push(issue_line(
                provider,
                label,
                status,
                result.get("reason").and_then(|v| v.as_str()),
            ));
        }
    }
    lines
}

fn issue_line(provider: &str, label: &str, status: &str, reason: Option<&str>) -> String {
    match reason.map(str::trim).filter(|r| !r.is_empty()) {
        Some(reason) => format!("{provider} · {label} — {status}: {reason}"),
        None => format!("{provider} · {label} — {status}"),
    }
}

/// A check that did not come back allowed (real status and reason).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProgressIssue {
    pub provider: String,
    pub label: String,
    pub status: String,
    pub reason: Option<String>,
}

/// Live state of a consented verification, from the sidecar's additive
/// `verification_progress` records: completed/total, the active checks and the
/// failed checks so far. It is tracked by the host independently of the modal:
/// closing the modal never cancels the run (nothing is sent to the sidecar).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct VerificationProgress {
    pub completed: usize,
    pub total: usize,
    /// `label · provider` of each check in flight.
    pub active: Vec<String>,
    pub issues: Vec<ProgressIssue>,
}

impl VerificationProgress {
    /// Tolerant update from one `verification_progress` record: a malformed
    /// field leaves the previous value (never a panic, never an invented count).
    pub fn apply_record(&mut self, record: &Value) {
        if let Some(total) = record.get("total").and_then(|v| v.as_u64()) {
            self.total = total as usize;
        }
        if let Some(completed) = record.get("completed").and_then(|v| v.as_u64()) {
            self.completed = completed as usize;
        }
        if let Some(active) = record.get("active").and_then(|v| v.as_array()) {
            self.active = active
                .iter()
                .filter_map(|check| {
                    let label = check.get("label").and_then(|v| v.as_str())?;
                    let provider = check.get("provider").and_then(|v| v.as_str());
                    Some(match provider {
                        Some(provider) => format!("{label} · {provider}"),
                        None => label.to_string(),
                    })
                })
                .collect();
        }
        if let Some(done) = record.get("done").filter(|d| d.is_object()) {
            let status = done.get("status").and_then(|v| v.as_str()).unwrap_or("");
            if status == "denied" || status == "unverified" {
                self.issues.push(ProgressIssue {
                    provider: done
                        .get("provider")
                        .and_then(|v| v.as_str())
                        .unwrap_or("provider")
                        .to_string(),
                    label: done
                        .get("label")
                        .and_then(|v| v.as_str())
                        .unwrap_or("check")
                        .to_string(),
                    status: status.to_string(),
                    reason: done
                        .get("reason")
                        .and_then(|v| v.as_str())
                        .map(str::trim)
                        .filter(|r| !r.is_empty())
                        .map(str::to_string),
                });
            }
        }
    }

    pub fn headline(&self) -> String {
        if self.total == 0 {
            "Verifying access… starting".to_string()
        } else {
            format!("Verifying access… {}/{} checks", self.completed, self.total)
        }
    }

    /// `Now: a · Claude, b · Cursor` (at most three, then `+N more`).
    pub fn active_line(&self) -> Option<String> {
        if self.active.is_empty() {
            return None;
        }
        let shown: Vec<&str> = self.active.iter().take(3).map(String::as_str).collect();
        let extra = self.active.len().saturating_sub(3);
        let mut line = format!("Now: {}", shown.join(", "));
        if extra > 0 {
            line.push_str(&format!(" (+{extra} more)"));
        }
        Some(line)
    }

    /// One short summary per subscription (counts only); the reasons live in
    /// the detail view.
    pub fn issue_summary(&self) -> Option<String> {
        if self.issues.is_empty() {
            return None;
        }
        let mut providers: Vec<&str> = Vec::new();
        for issue in &self.issues {
            if !providers.contains(&issue.provider.as_str()) {
                providers.push(issue.provider.as_str());
            }
        }
        let parts: Vec<String> = providers
            .iter()
            .map(|provider| {
                let count = |status: &str| {
                    self.issues
                        .iter()
                        .filter(|i| i.provider == *provider && i.status == status)
                        .count()
                };
                let mut bits = Vec::new();
                for status in ["denied", "unverified"] {
                    let n = count(status);
                    if n > 0 {
                        bits.push(format!("{n} {status}"));
                    }
                }
                format!("{provider} {}", bits.join(", "))
            })
            .collect();
        Some(format!("Problems: {} — d = details", parts.join(" · ")))
    }

    /// One line per failed check with its real reason (the detail view).
    pub fn detail_lines(&self) -> Vec<String> {
        self.issues
            .iter()
            .map(|i| issue_line(&i.provider, &i.label, &i.status, i.reason.as_deref()))
            .collect()
    }

    /// The waiting-screen body: headline, active checks, problem summary and
    /// the statement that closing the window does not cancel anything.
    pub fn lines(&self) -> Vec<String> {
        let mut lines = vec![self.headline()];
        lines.extend(self.active_line());
        lines.extend(self.issue_summary());
        lines.push(
            "Closing this window does not cancel the running checks; they finish in the background."
                .to_string(),
        );
        lines
    }
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
    /// is worded as a partial comparison and missing benchmarks are never
    /// worded as "unavailable".
    pub fn line(&self) -> String {
        let what = match self.cause.as_str() {
            "quota_reserve" => {
                if let Some(reason) = &self.reason {
                    if let Some(caps) = regex_percent(reason) {
                        format!("reserva baja ({caps}%)")
                    } else {
                        "reserva baja".to_string()
                    }
                } else {
                    "reserva baja".to_string()
                }
            }
            "rate_limited" => "ventana limitada".to_string(),
            "quota_exhausted" => "cuota agotada".to_string(),
            "unavailable_verified" => "no disponible".to_string(),
            "policy_excluded" => "excluido por política".to_string(),
            "access_unknown" => "sin verificar".to_string(),
            "unscored" => "sin benchmark".to_string(),
            other => format!("excluido ({other})"),
        };
        // Embed percent in `what` for quota_reserve; keep short for rate_limited /
        // access_unknown timeouts; otherwise append reason when present.
        let skip_reason = match self.cause.as_str() {
            "quota_reserve" if what.contains('%') => true,
            "rate_limited" => true,
            "access_unknown" => self
                .reason
                .as_deref()
                .is_some_and(|r| {
                    let lower = r.to_ascii_lowercase();
                    lower.contains("timeout") || lower.contains("timed out")
                }),
            _ => false,
        };
        match (&self.reason, skip_reason) {
            (Some(reason), false) => format!("{}: {what} — {reason}", self.provider),
            _ => format!("{}: {what}", self.provider),
        }
    }
}

fn regex_percent(reason: &str) -> Option<&str> {
    let bytes = reason.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            let start = i;
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                i += 1;
            }
            if i < bytes.len() && bytes[i] == b'%' {
                return std::str::from_utf8(&bytes[start..i]).ok();
            }
        } else {
            i += 1;
        }
    }
    None
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
    /// The pending/reusable checks, while the confirmation screen is up (or
    /// after it was skipped).
    pub plan: Option<VerificationPlan>,
    /// Subscriptions whose access could not be verified — a partial
    /// comparison is never presented as complete.
    pub not_verified: usize,
    /// Per-subscription outcome of a verification that just ran (counts only).
    pub outcome_lines: Vec<String>,
    /// Failed checks of the verification that just ran, with real reasons
    /// (shown on `d`, never in the summary).
    pub details: Vec<String>,
    /// Live progress while the consented verification runs.
    pub progress: Option<VerificationProgress>,
    /// `d`: the detail view replaces the body.
    pub show_details: bool,
    /// Local project context line (stack, architecture, risks) from the
    /// sidecar's local scan; it only contextualizes the explanations.
    pub project_line: Option<String>,
    /// Characters available for one explanation line; set by the renderer so
    /// row heights and scrolling follow the real modal width.
    pub description_width: Cell<usize>,
}

impl AnalystPickerState {
    /// Build from the sidecar's `preflight` `analystCatalog` (T26 flat list:
    /// `{ recommendedModel: null, models: [...], alternatives: [] }`). An entry
    /// missing required fields is dropped; an empty catalog yields an empty
    /// picker. Legacy payloads that still send `alternatives` are merged into
    /// the one list so nothing usable is lost; there is never a star.
    pub fn from_analyst_catalog(catalog: &Value) -> Self {
        let parse_list = |key: &str| -> Vec<AnalystOption> {
            let models = catalog
                .get(key)
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            models.iter().filter_map(Self::parse_option).collect()
        };
        let mut options = parse_list("models");
        for row in parse_list("alternatives") {
            if !options.iter().any(|o| o.candidate_key == row.candidate_key) {
                options.push(row);
            }
        }
        Self {
            options,
            alternatives: Vec::new(),
            view: PickerView::Main,
            ..Self::default()
        }
    }

    fn parse_option(m: &Value) -> Option<AnalystOption> {
        let available = m.get("available").and_then(|v| v.as_bool()).unwrap_or(false);
        let access_verified = m.get("accessVerified").and_then(|v| v.as_bool()).unwrap_or(true);
        // Only VERIFIED, available analysts are rows. Unknown access is
        // reported separately, never listed.
        if !available || !access_verified {
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
        let subscription = m
            .get("subscription")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(adapter_id.as_str())
            .to_string();
        let tags: Vec<String> = m
            .get("recommendationTags")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|t| t.as_str().map(str::to_string)).collect())
            .unwrap_or_default();
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
            subscription,
            available,
            recommended: false,
            tags,
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

    /// Enter on the confirmation screen: the consented verification was
    /// requested; the modal waits (inside itself) for the rebuilt catalog.
    pub fn begin_verifying(&mut self) {
        if self.phase == PickerPhase::Verify {
            self.phase = PickerPhase::Verifying;
        }
    }

    /// Esc on the confirmation screen: nothing is sent; the picker opens with
    /// only the already-verified options and says how many subscriptions were
    /// not verified. Returns `true` when a confirmation screen was skipped.
    pub fn skip_verification(&mut self) -> bool {
        if self.phase != PickerPhase::Verify {
            return false;
        }
        self.phase = PickerPhase::Ready;
        if let Some(plan) = &self.plan {
            self.not_verified = self.not_verified.max(plan.pending_subscriptions());
        }
        true
    }

    /// Footer text: outcome counts of a verification that just ran, then at
    /// most one compact partial-comparison / failed-check acknowledgement that
    /// points to `d`. Per-provider cause lines live in the detail view — never
    /// dumped into the list footer (T25). A leftover notice (no causes/details)
    /// still paints in the footer so older sidecars keep a fallback.
    pub fn footer_text(&self) -> Option<String> {
        let mut parts: Vec<String> = self.outcome_lines.clone();
        if self.not_verified > 0 {
            parts.push(format!(
                "{} subscription{} not verified — the comparison is partial",
                self.not_verified,
                if self.not_verified == 1 { "" } else { "s" }
            ));
        }
        let detail_count = match self.phase {
            PickerPhase::Ready => self.details.len() + self.causes.len(),
            _ => 0,
        };
        if self.phase == PickerPhase::Ready && detail_count > 0 {
            parts.push(format!(
                "{} detail line{} — d = details",
                detail_count,
                if detail_count == 1 { "" } else { "s" }
            ));
        } else if let Some(notice) = &self.notice {
            if !notice.is_empty() {
                parts.push(notice.clone());
            }
        }
        if parts.is_empty() {
            None
        } else {
            Some(parts.join("\n"))
        }
    }

    /// The detail lines `d` shows in the current phase: the failed checks of
    /// the live run while verifying; otherwise failed checks of the run that
    /// just ended plus per-provider exclusion causes. Notices stay in the
    /// footer fallback path — never duplicated here.
    pub fn detail_source(&self) -> Vec<String> {
        match (&self.phase, &self.progress) {
            (PickerPhase::Verifying, Some(progress)) => progress.detail_lines(),
            (PickerPhase::Ready, _) => {
                let mut lines = self.details.clone();
                lines.extend(self.causes.iter().map(ExclusionCause::line));
                lines
            }
            _ => Vec::new(),
        }
    }

    /// `d`: switch between the normal body and the failed-check details. Does
    /// nothing when there is nothing to show.
    pub fn toggle_details(&mut self) {
        if self.show_details {
            self.show_details = false;
        } else if !self.detail_source().is_empty() {
            self.show_details = true;
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

    /// `m` is a no-op (T26): one flat list, no Other view.
    pub fn toggle_view(&mut self) {}

    /// Move highlight forward, wrapping across the active view's rows.
    /// Preserves `notice` (e.g. preflight provider-absence copy).
    pub fn move_down(&mut self) {
        let len = self.active().len();
        if len == 0 || self.phase != PickerPhase::Ready {
            return;
        }
        self.selected = (self.selected + 1) % len;
    }

    pub fn move_up(&mut self) {
        let len = self.active().len();
        if len == 0 || self.phase != PickerPhase::Ready {
            return;
        }
        self.selected = (self.selected + len - 1) % len;
    }

    pub fn selected_option(&self) -> Option<&AnalystOption> {
        self.active().get(self.selected)
    }

    /// Characters one explanation line gets (renderer-provided; a default
    /// before the first render).
    pub fn text_width(&self) -> usize {
        match self.description_width.get() {
            0 => DEFAULT_DESCRIPTION_WIDTH,
            width => width,
        }
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
        let width = self.text_width();
        let span = |from: usize| -> usize { options[from..=selected].iter().map(|o| o.height_at(width)).sum() };
        while start < selected && span(start) > rows {
            start += 1;
        }
        self.scroll.set(start);
        let mut end = start;
        let mut used = 0;
        while end < options.len() && used + options[end].height_at(width) <= rows.max(1) {
            used += options[end].height_at(width);
            end += 1;
        }
        start..end.max(selected + 1).min(options.len())
    }

    /// Enter: confirm the highlighted model. Every listed row is verified, so
    /// it is returned at once; an unavailable row is refused with an inline
    /// notice (defense in depth).
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
        // T26: every pick is an explicit human choice (never a star).
        serde_json::json!({
            "model": {
                "adapterId": option.adapter_id,
                "modelId": option.model_id,
                "displayName": option.display_name,
            },
            "selectionSource": "manual",
            "recommendationTags": [],
            "choice": null,
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
                    "candidateKey": "codex::gpt", "adapterId": "codex", "modelId": "gpt",
                    "displayName": "GPT", "available": true, "recommendationTags": ["quality"]
                },
                {
                    "candidateKey": "claude::sonnet", "adapterId": "claude", "modelId": "sonnet",
                    "displayName": "Claude Sonnet", "available": true, "recommendationTags": []
                },
                {
                    "candidateKey": "cursor::x", "adapterId": "cursor", "modelId": "x",
                    "displayName": "Cursor X", "available": false, "recommendationTags": []
                }
            ]
        })
    }

    #[test]
    fn unavailable_rows_are_filtered_and_no_star_is_painted() {
        let picker = AnalystPickerState::from_analyst_catalog(&json!({
            "recommendedModel": { "candidateKey": "codex::gpt" },
            "models": [
                { "candidateKey": "codex::gpt", "adapterId": "codex", "modelId": "gpt", "displayName": "GPT",
                  "available": true, "accessVerified": true, "recommendationTags": ["quality"] },
                { "candidateKey": "claude::down", "adapterId": "claude", "modelId": "down", "displayName": "Down",
                  "available": false, "accessVerified": true }
            ]
        }));
        assert_eq!(picker.options.len(), 1);
        assert!(!picker.options[0].recommended);
        assert!(!picker.options[0].row_label().contains("recommended"));
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
            subscription: "Codex".into(),
            recommended: true,
            tags: vec!["quality".into()],
            explanation: None,
        };
        let payload = AnalystPickerState::analyst_payload(&option);
        assert_eq!(payload["model"]["adapterId"], "codex");
        assert_eq!(payload["model"]["modelId"], "gpt");
        assert_eq!(payload["model"]["displayName"], "GPT");
        assert_eq!(payload["selectionSource"], "manual");
        assert!(payload["choice"].is_null());
        assert_eq!(payload["recommendationTags"], serde_json::json!([]));
    }

    #[test]
    fn manual_pick_with_no_tags_has_a_null_choice_never_a_fabricated_one() {
        let option = AnalystOption {
            candidate_key: "claude::sonnet".into(),
            adapter_id: "claude".into(),
            model_id: "sonnet".into(),
            display_name: "Claude Sonnet".into(),
            available: true,
            subscription: "Codex".into(),
            recommended: false,
            tags: vec![],
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
        assert_eq!(lines[1], "cursor: no disponible");
        assert_eq!(lines[2], "go: excluido por política");
        assert_eq!(lines[3], "codex: sin verificar");
        assert_eq!(lines[4], "zed: sin benchmark");
        let unique: std::collections::HashSet<_> = lines.iter().map(|l| l.split(": ").nth(1).unwrap().to_string()).collect();
        assert_eq!(unique.len(), 5, "wording must be distinct per cause");
        assert!(!lines[3].contains("no disponible"));
        assert!(!lines[4].contains("no disponible"));
    }

    #[test]
    fn quota_reserve_and_rate_limited_have_concise_spanish_distinct_from_exhausted() {
        let causes = ExclusionCause::list_from_record(&record_with_causes(json!([
            { "adapterId": "claude", "provider": "Claude", "cause": "quota_reserve", "models": 1, "reason": "Claude 5h window is limited (4% left)" },
            { "adapterId": "go", "provider": "OpenCode Go", "cause": "rate_limited", "models": 1, "reason": "OpenCode Go monthly window is rate-limited" },
            { "adapterId": "codex", "provider": "Codex", "cause": "quota_exhausted", "models": 1, "reason": null }
        ])))
        .expect("field present");
        assert_eq!(causes[0].line(), "Claude: reserva baja (4%)");
        assert_eq!(causes[1].line(), "OpenCode Go: ventana limitada");
        assert_eq!(causes[2].line(), "Codex: cuota agotada");
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
    fn footer_keeps_compact_acknowledgement_and_moves_causes_behind_d() {
        let mut picker = AnalystPickerState::default();
        picker.notice = Some("Comparación parcial — d = detalles".into());
        assert_eq!(
            picker.footer_text().as_deref(),
            Some("Comparación parcial — d = detalles")
        );
        picker.causes = vec![ExclusionCause {
            adapter_id: "codex".into(),
            provider: "codex".into(),
            cause: "access_unknown".into(),
            models: 1,
            reason: None,
        }];
        assert_eq!(
            picker.footer_text().as_deref(),
            Some("1 detail line — d = details")
        );
        assert!(picker
            .detail_source()
            .iter()
            .any(|line| line.contains("sin verificar")));
        assert_eq!(AnalystPickerState::default().footer_text(), None);
    }

    fn views_catalog() -> Value {
        json!({
            "recommendedModel": { "candidateKey": "codex::a" },
            "models": [
                { "candidateKey": "codex::a", "adapterId": "codex", "modelId": "a", "displayName": "Alpha",
                  "available": true, "accessVerified": true, "fit": 0.8, "explanation": "razonamiento excelente · código sólido · confianza alta",
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
    fn flat_list_merges_legacy_alternatives_and_never_stars_or_toggles_other() {
        let mut picker = AnalystPickerState::from_analyst_catalog(&views_catalog());
        assert_eq!(picker.view, PickerView::Main);
        assert_eq!(picker.alternatives.len(), 0);
        assert!(picker.options.len() >= 3, "legacy alternatives fold into options");
        assert!(picker.options.iter().all(|o| !o.recommended));
        let before = picker.view;
        picker.toggle_view();
        assert_eq!(picker.view, before, "m is a no-op");
    }


    #[test]
    fn flat_list_keeps_sidecar_models_and_folds_verified_legacy_alternatives() {
        let picker = AnalystPickerState::from_analyst_catalog(&views_catalog());
        let keys: Vec<&str> = picker.options.iter().map(|o| o.candidate_key.as_str()).collect();
        assert!(keys.contains(&"codex::a"));
        assert!(keys.contains(&"cursor::unscored"), "legacy manual row folds in");
        assert!(!keys.iter().any(|k| *k == "claude::unv"), "unverified never lists");
        assert_eq!(picker.alternatives.len(), 0);
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
    fn the_picker_list_is_label_only_even_when_sidecar_sends_explanations() {
        let picker = AnalystPickerState::from_analyst_catalog(&views_catalog());
        assert!(
            picker.options[0].explanation.as_deref().is_some_and(|e| !e.is_empty()),
            "sidecar still delivers explanation payloads"
        );
        assert_eq!(picker.options[0].description(), "");
        assert!(picker.options[0].description_lines(64).is_empty());
        assert_eq!(picker.options[0].height_at(64), 1);
        assert_eq!(picker.options[1].description(), "");
        assert_eq!(picker.options[1].height_at(64), 1);
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
        assert_eq!(stale.options.len(), 1, "absent accessVerified means verified/legacy");
        stale.options[0].available = false;
        assert!(stale.confirm().is_none());
        assert!(stale.notice.as_deref().unwrap_or("").contains("not available"));
    }

    // ---- T23: verified rows only, model + subscription, verification plan ----

    #[test]
    fn unverified_and_unavailable_rows_are_never_listed_in_either_view() {
        let picker = AnalystPickerState::from_analyst_catalog(&json!({
            "models": [
                { "candidateKey": "claude::unv", "adapterId": "claude", "modelId": "unv", "displayName": "Unv",
                  "available": false, "selectable": true, "accessVerified": false },
                { "candidateKey": "claude::sneaky", "adapterId": "claude", "modelId": "sneaky", "displayName": "Sneaky",
                  "available": true, "accessVerified": false },
                { "candidateKey": "codex::ok", "adapterId": "codex", "modelId": "ok", "displayName": "Ok", "available": true }
            ],
            "alternatives": [
                { "candidateKey": "cursor::unv", "adapterId": "cursor", "modelId": "unv", "displayName": "CUnv",
                  "available": false, "selectable": true, "accessVerified": false }
            ]
        }));
        assert_eq!(picker.options.iter().map(|o| o.model_id.as_str()).collect::<Vec<_>>(), vec!["ok"]);
        assert!(picker.alternatives.is_empty());
    }

    #[test]
    fn rows_are_identified_by_model_and_subscription() {
        let picker = AnalystPickerState::from_analyst_catalog(&json!({
            "models": [
                { "candidateKey": "codex::gpt-x", "adapterId": "codex", "modelId": "gpt-x", "displayName": "GPT-X",
                  "subscription": "Codex", "available": true },
                { "candidateKey": "cursor::gpt-x", "adapterId": "cursor", "modelId": "gpt-x", "displayName": "GPT-X",
                  "subscription": "Cursor", "available": true },
                { "candidateKey": "claude::legacy", "adapterId": "claude", "modelId": "legacy", "displayName": "Legacy",
                  "available": true }
            ]
        }));
        let labels: Vec<String> = picker.options.iter().map(AnalystOption::row_label).collect();
        assert_eq!(labels, vec!["GPT-X · Codex", "GPT-X · Cursor", "Legacy · claude"]);
    }

    fn plan_record() -> Value {
        json!({ "verificationPlan": {
            "subscriptions": [
                { "provider": "Claude", "granularity": "model", "checks": [
                    { "label": "Claude A", "state": "pending" }, { "label": "Claude B", "state": "reusable" } ] },
                { "provider": "Cursor", "granularity": "pool", "checks": [
                    { "label": "Cursor models", "state": "pending" }, { "label": "Other models", "state": "pending" } ] },
                { "provider": "Codex", "granularity": "model", "checks": [ { "label": "x", "state": "reusable" } ] }
            ] } })
    }

    #[test]
    fn plan_parse_counts_pending_and_reusable_and_lists_only_pending_checks() {
        let plan = VerificationPlan::from_record(&plan_record()).expect("plan");
        assert_eq!((plan.pending, plan.reusable), (3, 2));
        assert_eq!(plan.pending_subscriptions(), 2);
        let lines = plan.lines();
        assert_eq!(lines[1], "Claude: 1 model check — Claude A");
        assert_eq!(lines[2], "Cursor: 2 pool checks — Cursor models, Other models");
        assert!(lines.iter().all(|l| !l.starts_with("Codex")), "a fully reusable subscription makes no call");
        assert_eq!(lines[3], "2 checks already verified — reused, no call.");
        assert!(lines.last().unwrap().contains("Enter = verify"));
        assert!(lines.iter().any(|l| l.contains("Makes 3 real provider calls and may consume quota")));
    }

    #[test]
    fn plan_absent_or_malformed_is_none_so_an_older_sidecar_opens_straight_to_the_picker() {
        assert!(VerificationPlan::from_record(&json!({})).is_none());
        assert!(VerificationPlan::from_record(&json!({ "verificationPlan": null })).is_none());
        assert!(VerificationPlan::from_record(&json!({ "verificationPlan": { "subscriptions": "x" } })).is_none());
        let empty = VerificationPlan::from_record(&json!({ "verificationPlan": { "subscriptions": [] } })).unwrap();
        assert_eq!(empty.pending, 0);
    }

    #[test]
    fn skip_verification_opens_the_picker_and_counts_the_unverified_subscriptions() {
        let mut picker = AnalystPickerState::default();
        picker.plan = VerificationPlan::from_record(&plan_record());
        picker.phase = PickerPhase::Verify;
        assert!(picker.confirm().is_none(), "Enter on the confirmation is the host's job, never a pick");
        assert!(picker.skip_verification());
        assert_eq!(picker.phase, PickerPhase::Ready);
        assert_eq!(picker.not_verified, 2);
        assert!(picker.footer_text().unwrap().starts_with("2 subscriptions not verified"));
        assert!(!picker.skip_verification(), "nothing left to skip");
    }

    #[test]
    fn begin_verifying_only_moves_the_confirmation_screen() {
        let mut ready = AnalystPickerState::default();
        ready.begin_verifying();
        assert_eq!(ready.phase, PickerPhase::Ready);
        let mut verify = AnalystPickerState { phase: PickerPhase::Verify, ..Default::default() };
        verify.begin_verifying();
        assert_eq!(verify.phase, PickerPhase::Verifying);
        assert!(verify.confirm().is_none());
        verify.toggle_view();
        assert_eq!(verify.view, PickerView::Main);
    }

    #[test]
    fn outcome_lines_report_each_subscription_with_counts_only_and_invent_nothing() {
        // T24 (rewritten): reasons moved to the separate detail view.
        let lines = outcome_lines(&json!([
            { "provider": "Claude", "counts": { "allowed": 1, "denied": 1, "unverified": 0 }, "results": [] },
            { "provider": "Cursor", "counts": { "allowed": 0, "denied": 0, "unverified": 2 },
              "results": [ { "status": "unverified", "reason": "login required" } ] }
        ]));
        assert_eq!(lines[0], "Claude: 1 allowed · 1 denied · 0 unverified");
        assert_eq!(lines[1], "Cursor: 0 allowed · 0 denied · 2 unverified");
        assert!(outcome_lines(&json!(null)).is_empty());
    }

    #[test]
    fn footer_order_is_outcomes_then_not_verified_then_compact_details_pointer() {
        let picker = AnalystPickerState {
            outcome_lines: vec!["Cursor: 1 allowed · 0 denied · 0 unverified".into()],
            not_verified: 1,
            causes: vec![ExclusionCause {
                adapter_id: "claude".into(),
                provider: "Claude".into(),
                cause: "quota_exhausted".into(),
                models: 1,
                reason: None,
            }],
            notice: Some("Comparación parcial — d = detalles".into()),
            ..Default::default()
        };
        assert_eq!(
            picker.footer_text().unwrap(),
            "Cursor: 1 allowed · 0 denied · 0 unverified\n1 subscription not verified — the comparison is partial\n1 detail line — d = details"
        );
        assert_eq!(
            picker.detail_source(),
            vec!["Claude: cuota agotada".to_string()]
        );
    }

    // ---- T24: progress, error summary, details, explanations ----

    fn progress_record(completed: u64, total: u64, active: Value, done: Value) -> Value {
        json!({ "type": "verification_progress", "completed": completed, "total": total, "active": active, "done": done })
    }

    fn check(label: &str, provider: &str) -> Value {
        json!({ "id": format!("{provider}::{label}"), "label": label, "adapterId": provider.to_lowercase(), "provider": provider })
    }

    #[test]
    fn verification_progress_tracks_counts_the_active_check_and_failed_checks() {
        let mut progress = VerificationProgress::default();
        assert_eq!(progress.headline(), "Verifying access… starting");
        progress.apply_record(&progress_record(0, 3, json!([check("Claude B", "Claude")]), Value::Null));
        assert_eq!(progress.headline(), "Verifying access… 0/3 checks");
        assert_eq!(progress.active_line().as_deref(), Some("Now: Claude B · Claude"));
        let mut done = check("Claude B", "Claude");
        done["status"] = json!("unverified");
        done["reason"] = json!("probe timed out after 30000ms");
        progress.apply_record(&progress_record(1, 3, json!([check("Pool A", "Cursor"), check("Pool B", "Cursor")]), done));
        assert_eq!(progress.headline(), "Verifying access… 1/3 checks");
        assert_eq!(progress.active_line().as_deref(), Some("Now: Pool A · Cursor, Pool B · Cursor"));
        assert_eq!(progress.issues.len(), 1);
        let mut ok = check("Pool A", "Cursor");
        ok["status"] = json!("allowed");
        progress.apply_record(&progress_record(2, 3, json!([check("Pool B", "Cursor")]), ok));
        assert_eq!(progress.issues.len(), 1, "an allowed check is not a problem");
        assert_eq!(progress.completed, 2);
    }

    #[test]
    fn errors_are_summarized_per_subscription_and_the_details_stay_separate() {
        let mut progress = VerificationProgress::default();
        for (provider, label, status, reason) in [
            ("Claude", "Claude A", "denied", "credits_required"),
            ("Claude", "Claude B", "unverified", "probe timed out after 30000ms"),
            ("Cursor", "Other models", "unverified", "login required"),
        ] {
            let mut done = check(label, provider);
            done["status"] = json!(status);
            done["reason"] = json!(reason);
            progress.apply_record(&progress_record(1, 3, json!([]), done));
        }
        let summary = progress.issue_summary().expect("there are problems");
        assert_eq!(summary, "Problems: Claude 1 denied, 1 unverified · Cursor 1 unverified — d = details");
        assert!(!summary.contains("credits_required") && !summary.contains("timed out"), "reasons stay in the detail view: {summary}");
        let details = progress.detail_lines();
        assert_eq!(details[0], "Claude · Claude A — denied: credits_required");
        assert_eq!(details[1], "Claude · Claude B — unverified: probe timed out after 30000ms");
        assert_eq!(details[2], "Cursor · Other models — unverified: login required");
        assert_eq!(VerificationProgress::default().issue_summary(), None);
    }

    #[test]
    fn the_progress_body_says_that_closing_the_modal_does_not_cancel_the_checks() {
        let body = VerificationProgress::default().lines().join("\n");
        assert!(body.contains("Closing this window does not cancel"), "{body}");
        assert!(body.contains("keep running") || body.contains("finish in the background"), "{body}");
    }

    #[test]
    fn a_progress_record_with_a_bad_shape_never_panics_or_invents_counts() {
        let mut progress = VerificationProgress::default();
        progress.apply_record(&json!({ "type": "verification_progress" }));
        assert_eq!((progress.completed, progress.total), (0, 0));
        progress.apply_record(&json!({ "completed": "x", "total": -1, "active": "no", "done": 7 }));
        assert_eq!((progress.completed, progress.total), (0, 0));
        assert!(progress.active.is_empty() && progress.issues.is_empty());
    }

    #[test]
    fn outcome_details_list_each_failed_check_with_its_real_reason() {
        let outcomes = json!([
            { "provider": "Claude", "counts": { "allowed": 1, "denied": 1, "unverified": 0 },
              "results": [ { "label": "Claude A", "status": "allowed", "reason": null },
                           { "label": "Claude B", "status": "denied", "reason": "credits_required" } ] },
            { "provider": "Cursor", "counts": { "allowed": 0, "denied": 0, "unverified": 1 },
              "results": [ { "label": "Other models", "status": "unverified", "reason": "login required" } ] }
        ]);
        assert_eq!(
            outcome_details(&outcomes),
            vec![
                "Claude · Claude B — denied: credits_required".to_string(),
                "Cursor · Other models — unverified: login required".to_string()
            ]
        );
        assert!(outcome_details(&json!(null)).is_empty());
    }

    #[test]
    fn sidecar_order_is_authoritative_the_host_never_re_sorts_rows() {
        let picker = AnalystPickerState::from_analyst_catalog(&catalog_in_sidecar_order());
        let keys: Vec<&str> = picker.options.iter().map(|o| o.candidate_key.as_str()).collect();
        assert_eq!(keys, vec!["claude::sonnet", "codex::gpt"], "host keeps sidecar order");
        assert!(picker.options.iter().all(|o| !o.recommended));
    }


    fn catalog_in_sidecar_order() -> Value {
        json!({
            "recommendedModel": { "candidateKey": "codex::gpt" },
            "models": [
                { "candidateKey": "claude::sonnet", "adapterId": "claude", "modelId": "sonnet", "displayName": "Claude Sonnet", "available": true, "recommendationTags": [] },
                { "candidateKey": "codex::gpt", "adapterId": "codex", "modelId": "gpt", "displayName": "GPT", "available": true, "recommendationTags": ["quality"] }
            ]
        })
    }

    #[test]
    fn a_long_sidecar_explanation_does_not_inflate_the_list_row() {
        let long = "Recomendado para comprender este proyecto (Node.js) y proponer el equipo · destaca en código entre las opciones con evidencia comparable";
        let picker = AnalystPickerState::from_analyst_catalog(&json!({
            "models": [{ "candidateKey": "a::b", "adapterId": "a", "modelId": "b", "displayName": "B", "available": true, "explanation": long }]
        }));
        let option = &picker.options[0];
        assert_eq!(option.explanation.as_deref(), Some(long));
        assert!(option.description_lines(40).is_empty());
        assert_eq!(option.height_at(40), 1);
        assert_eq!(option.height_at(400), 1);
    }

    #[test]
    fn details_toggle_only_when_there_is_something_to_show() {
        let mut picker = AnalystPickerState::default();
        picker.toggle_details();
        assert!(!picker.show_details, "no details, no toggle");
        picker.details = vec!["Cursor · Other models — unverified: login required".into()];
        picker.toggle_details();
        assert!(picker.show_details);
        picker.toggle_details();
        assert!(!picker.show_details);
        let mut verifying = AnalystPickerState { phase: PickerPhase::Verifying, ..Default::default() };
        verifying.toggle_details();
        assert!(!verifying.show_details, "nothing failed yet");
        let mut progress = VerificationProgress::default();
        let mut done = check("Pool", "Cursor");
        done["status"] = json!("unverified");
        progress.apply_record(&progress_record(1, 1, json!([]), done));
        verifying.progress = Some(progress);
        verifying.toggle_details();
        assert!(verifying.show_details);
    }

    #[test]
    fn the_outcome_summary_counts_only_and_points_at_the_details() {
        let outcomes = json!([{ "provider": "Cursor", "counts": { "allowed": 0, "denied": 0, "unverified": 2 },
            "results": [ { "label": "A", "status": "unverified", "reason": "login required" } ] }]);
        let lines = outcome_lines(&outcomes);
        assert_eq!(lines, vec!["Cursor: 0 allowed · 0 denied · 2 unverified".to_string()]);
        let picker = AnalystPickerState {
            outcome_lines: lines,
            details: outcome_details(&outcomes),
            ..Default::default()
        };
        assert!(picker.footer_text().unwrap().contains("d = details"));
    }
}
