//! Strategy recovery preview (U2c): the in-UI equivalent of the Pi
//! extension's `kairo-team-approve` / `kairo-team-reject` commands, entirely
//! inside ratatui. Built from the sidecar's own `recovery` record
//! (`team.recovery.preview`'s `outcome: "proposed"` result — see
//! `conversation/team-recovery.js#runTeamRecovery` and
//! `kairo-ui-rpc-stdio.js`'s own doc). Nothing here is invented: the cause
//! rows and the replacement rows are read verbatim off that record, never
//! reclassified or given a fabricated quota/funds wording — that
//! classification already happened server-side against real eligibility
//! evidence.

use serde_json::Value;

/// One row of "what changed" — a role's REAL reason for losing its provider,
/// straight from `team-recovery.js#affectedEntries`. Never rewritten into a
/// quota/funds cause here.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecoveryCauseRow {
    pub role: String,
    pub model: String,
    pub reason: String,
}

/// One row of the proposed replacement team, from the already-verified
/// `proposal.projectTeam` the sidecar persisted (never activated yet).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecoveryReplacementRow {
    pub role: String,
    pub model: String,
}

/// The open recovery-preview modal. Built once from a `recovery` record
/// whose `outcome` is `"proposed"`; any other outcome yields no modal at
/// all (see `from_recovery_record`) — the caller shows a plain notice
/// instead.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RecoveryPreviewState {
    pub causes: Vec<RecoveryCauseRow>,
    pub replacements: Vec<RecoveryReplacementRow>,
    /// Set while `team.recovery.apply` / `.reject` is in flight, or after a
    /// refused (stale) apply names the real reason.
    pub notice: Option<String>,
}

impl RecoveryPreviewState {
    /// `None` for any outcome other than `"proposed"` — a baseline,
    /// already-handled, backed-off, kept-previous, activated or error
    /// outcome is never shown as an approve/reject modal; the caller
    /// decides how to notice it instead.
    pub fn from_recovery_record(record: &Value) -> Option<Self> {
        if record.get("outcome").and_then(|v| v.as_str()) != Some("proposed") {
            return None;
        }
        let causes = record
            .get("affected")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|entry| {
                        Some(RecoveryCauseRow {
                            role: entry.get("role")?.as_str()?.to_string(),
                            model: entry.get("model")?.as_str()?.to_string(),
                            reason: entry.get("reason")?.as_str()?.to_string(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        let replacements = record
            .get("proposal")
            .and_then(|p| p.get("projectTeam"))
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|entry| {
                        let role = entry.get("role")?.as_str()?.to_string();
                        let model = entry
                            .get("model")
                            .and_then(|m| m.get("displayName").or_else(|| m.get("modelId")))
                            .and_then(|v| v.as_str())
                            .unwrap_or("no eligible option")
                            .to_string();
                        Some(RecoveryReplacementRow { role, model })
                    })
                    .collect()
            })
            .unwrap_or_default();
        Some(Self {
            causes,
            replacements,
            notice: None,
        })
    }

    /// One line per cause row: `Role (Model: reason)` — the exact wording
    /// the Pi extension's own `recoveryNotice` uses, never re-derived.
    pub fn cause_lines(&self) -> Vec<String> {
        self.causes
            .iter()
            .map(|c| format!("{} ({}: {})", c.role, c.model, c.reason))
            .collect()
    }

    /// One line per replacement row: `Role → Model`.
    pub fn replacement_lines(&self) -> Vec<String> {
        self.replacements
            .iter()
            .map(|r| format!("{} → {}", r.role, r.model))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn proposed_record() -> Value {
        json!({
            "type": "recovery",
            "op": "preview",
            "outcome": "proposed",
            "fingerprint": "fp-1",
            "affected": [
                { "role": "Orchestrator", "model": "Kimi K3", "reason": "OpenCode Go monthly window is rate-limited" }
            ],
            "proposal": {
                "projectTeam": [
                    { "role": "Orchestrator", "model": { "displayName": "GPT-6 Terra", "adapterId": "codex" } },
                    { "role": "Reviewer", "model": null }
                ]
            }
        })
    }

    #[test]
    fn builds_causes_and_replacements_verbatim_from_a_proposed_record() {
        let state =
            RecoveryPreviewState::from_recovery_record(&proposed_record()).expect("proposed");
        assert_eq!(state.causes.len(), 1);
        assert_eq!(state.causes[0].role, "Orchestrator");
        assert_eq!(state.causes[0].model, "Kimi K3");
        assert_eq!(
            state.causes[0].reason,
            "OpenCode Go monthly window is rate-limited"
        );
        assert!(
            !state.causes[0].reason.to_lowercase().contains("quota"),
            "never rewrites a rate-limit reason into quota wording"
        );
        assert_eq!(state.replacements.len(), 2);
        assert_eq!(state.replacements[0].role, "Orchestrator");
        assert_eq!(state.replacements[0].model, "GPT-6 Terra");
        assert_eq!(state.replacements[1].role, "Reviewer");
        assert_eq!(state.replacements[1].model, "no eligible option");
    }

    #[test]
    fn cause_and_replacement_lines_match_the_pi_extensions_own_wording() {
        let state =
            RecoveryPreviewState::from_recovery_record(&proposed_record()).expect("proposed");
        assert_eq!(
            state.cause_lines(),
            vec!["Orchestrator (Kimi K3: OpenCode Go monthly window is rate-limited)".to_string()]
        );
        assert_eq!(
            state.replacement_lines(),
            vec![
                "Orchestrator → GPT-6 Terra".to_string(),
                "Reviewer → no eligible option".to_string()
            ]
        );
    }

    #[test]
    fn non_proposed_outcomes_never_open_a_modal() {
        for outcome in [
            "baseline",
            "skipped",
            "kept-previous",
            "activated",
            "error",
            "approved",
            "rejected",
        ] {
            let record = json!({ "outcome": outcome });
            assert!(
                RecoveryPreviewState::from_recovery_record(&record).is_none(),
                "outcome {outcome} must never open the preview modal"
            );
        }
    }

    #[test]
    fn malformed_rows_are_dropped_not_half_rendered() {
        let record = json!({
            "outcome": "proposed",
            "affected": [
                { "role": "Orchestrator" },
                { "role": "Builder", "model": "GPT-6", "reason": "not eligible" }
            ],
            "proposal": { "projectTeam": [ { "model": { "displayName": "X" } } ] }
        });
        let state = RecoveryPreviewState::from_recovery_record(&record).expect("proposed");
        assert_eq!(
            state.causes.len(),
            1,
            "the incomplete affected row is dropped"
        );
        assert_eq!(state.causes[0].role, "Builder");
        assert_eq!(
            state.replacements.len(),
            0,
            "the roleless projectTeam row is dropped"
        );
    }

    #[test]
    fn empty_affected_and_proposal_yield_empty_rows_never_invented_ones() {
        let record = json!({ "outcome": "proposed" });
        let state = RecoveryPreviewState::from_recovery_record(&record).expect("proposed");
        assert!(state.causes.is_empty());
        assert!(state.replacements.is_empty());
        assert!(state.cause_lines().is_empty());
    }
}
