//! U5b: nested Ops mutation confirms (sync / rollback / cancel / dismiss).
//!
//! Mirrors U4c confirm ownership: while open, y/n/Esc belong to this modal
//! and must not fall through to list/nav handlers.

use serde_json::Value;

/// Which mutation the nested confirm will fire on `y`.
#[derive(Debug, Clone, PartialEq)]
pub enum OpsConfirmKind {
    SyncApply,
    RollbackApply,
    CancelRun { run_id: String },
    DismissAlert { alert_id: String },
}

#[derive(Debug, Clone, PartialEq)]
pub struct OpsConfirmState {
    pub kind: OpsConfirmKind,
    pub title: String,
    pub lines: Vec<String>,
    /// Sync/rollback apply payload (fingerprint preview). Unused for cancel/dismiss.
    pub preview: Option<Value>,
}

impl OpsConfirmState {
    pub fn sync_apply(preview: Value) -> Self {
        let has_changes = preview
            .get("hasChanges")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let change_n = preview
            .get("changes")
            .and_then(|v| v.as_array())
            .map(|a| a.len())
            .unwrap_or(0);
        let mut lines = vec![
            if has_changes {
                format!("Apply governance sync · {change_n} change(s)?")
            } else {
                "No pending changes — apply is a no-op.".into()
            },
            "Confirm writes managed configs (reversible via rollback).".into(),
        ];
        if let Some(fp) = preview.get("fingerprint").and_then(|v| v.as_str()) {
            lines.push(format!("fingerprint · {}", &fp[..fp.len().min(12)]));
        }
        Self {
            kind: OpsConfirmKind::SyncApply,
            title: " Ops · confirm sync ".into(),
            lines,
            preview: Some(preview),
        }
    }

    pub fn rollback_apply(preview: Value) -> Self {
        let snap = preview
            .get("snapshot")
            .and_then(|v| v.as_str())
            .unwrap_or("?")
            .to_string();
        let file_n = preview
            .get("files")
            .and_then(|v| v.as_array())
            .map(|a| a.len())
            .unwrap_or(0);
        Self {
            kind: OpsConfirmKind::RollbackApply,
            title: " Ops · confirm rollback ".into(),
            lines: vec![
                format!("Restore snapshot · {snap} · {file_n} file(s)?"),
                "Confirm restores from backup (safety backup taken first).".into(),
            ],
            preview: Some(preview),
        }
    }

    pub fn cancel_run(run_id: impl Into<String>) -> Self {
        let run_id = run_id.into();
        Self {
            kind: OpsConfirmKind::CancelRun {
                run_id: run_id.clone(),
            },
            title: " Ops · cancel run ".into(),
            lines: vec![
                format!("Cancel run · {run_id}?"),
                "Sends SIGTERM to the supervised run.".into(),
            ],
            preview: None,
        }
    }

    pub fn dismiss_alert(alert_id: impl Into<String>) -> Self {
        let alert_id = alert_id.into();
        Self {
            kind: OpsConfirmKind::DismissAlert {
                alert_id: alert_id.clone(),
            },
            title: " Ops · dismiss alert ".into(),
            lines: vec![
                format!("Dismiss alert · {alert_id}?"),
                "Marks the alert dismissed (cockpit consent).".into(),
            ],
            preview: None,
        }
    }

    pub fn footer_hints(&self) -> &'static str {
        "y confirm · n/Esc cancel"
    }

    pub fn prompt_lines(&self) -> Vec<String> {
        let mut out = self.lines.clone();
        out.push(String::new());
        out.push(self.footer_hints().into());
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sync_confirm_mentions_change_count() {
        let state = OpsConfirmState::sync_apply(json!({
            "hasChanges": true,
            "fingerprint": "abcdef0123456789",
            "changes": [{}, {}]
        }));
        assert!(matches!(state.kind, OpsConfirmKind::SyncApply));
        assert!(state.prompt_lines()[0].contains("2 change"));
        assert!(state.footer_hints().contains("y confirm"));
    }

    #[test]
    fn cancel_and_dismiss_carry_ids() {
        let c = OpsConfirmState::cancel_run("run-1");
        assert!(matches!(
            c.kind,
            OpsConfirmKind::CancelRun { ref run_id } if run_id == "run-1"
        ));
        let d = OpsConfirmState::dismiss_alert("alt-1");
        assert!(matches!(
            d.kind,
            OpsConfirmKind::DismissAlert { ref alert_id } if alert_id == "alt-1"
        ));
    }
}
