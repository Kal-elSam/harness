//! Settings Provider Connect flow — consume connections.status|preview|connect.
//! Pure state machine; host owns I/O and terminal yield/restore.

use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectStage {
    Loading,
    Browse,
    Previewing,
    Preview,
    Confirm,
    Yielding,
    Connecting,
    Result,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectProviderRow {
    pub provider: String,
    pub installation: String,
    pub authentication: String,
    pub action: String,
    pub quota: String,
    pub model_lines: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectPreviewData {
    pub provider: String,
    pub fingerprint: String,
    pub summary: String,
    pub scope: String,
    pub argv: Vec<String>,
    pub terminal: bool,
    pub browser: bool,
    pub lines: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderConnectFlow {
    pub stage: ConnectStage,
    pub providers: Vec<ConnectProviderRow>,
    pub cursor: usize,
    pub preview: Option<ConnectPreviewData>,
    pub error: Option<String>,
    pub result: Option<String>,
    /// True after a terminal_yield until terminal_restore — UI must not look "success".
    pub yielded: bool,
}

fn error_text(record: &Value) -> String {
    let reason = record
        .get("reason")
        .and_then(|v| v.as_str())
        .unwrap_or("error");
    match record
        .get("error")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    {
        Some(err) => format!("{reason} · {err}"),
        None => reason.to_string(),
    }
}

impl ProviderConnectFlow {
    pub fn loading() -> Self {
        Self {
            stage: ConnectStage::Loading,
            providers: Vec::new(),
            cursor: 0,
            preview: None,
            error: None,
            result: None,
            yielded: false,
        }
    }

    pub fn selected_provider(&self) -> Option<&ConnectProviderRow> {
        self.providers.get(self.cursor)
    }

    pub fn move_cursor(&mut self, delta: isize) {
        if self.providers.is_empty() {
            return;
        }
        let len = self.providers.len() as isize;
        let next = self.cursor as isize + delta;
        self.cursor = next.rem_euclid(len) as usize;
    }

    pub fn apply_status_record(&mut self, record: &Value) -> bool {
        if self.stage != ConnectStage::Loading && self.stage != ConnectStage::Browse {
            return false;
        }
        let inventory = record
            .get("inventory")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        self.providers = inventory
            .iter()
            .filter_map(|row| {
                let provider = row.get("provider")?.as_str()?.to_string();
                let models = row
                    .get("models")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|m| {
                                let id = m.get("modelId")?.as_str()?;
                                let access = m.get("access").and_then(|v| v.as_str()).unwrap_or("?");
                                let label = m
                                    .get("label")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or(id);
                                Some(format!("{label} · {access}"))
                            })
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                Some(ConnectProviderRow {
                    provider,
                    installation: row
                        .get("installation")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string(),
                    authentication: row
                        .get("authentication")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string(),
                    action: row
                        .get("action")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unavailable")
                        .to_string(),
                    quota: row
                        .get("quota")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string(),
                    model_lines: models,
                })
            })
            .collect();
        if self.cursor >= self.providers.len() {
            self.cursor = 0;
        }
        self.stage = ConnectStage::Browse;
        self.error = None;
        true
    }

    pub fn begin_preview(&mut self) -> Option<String> {
        if self.stage != ConnectStage::Browse {
            return None;
        }
        let action = self.selected_provider()?.action.clone();
        if action == "setup" {
            self.result = Some("CLI absent — use Setup (s) in Settings.".into());
            self.stage = ConnectStage::Result;
            return None;
        }
        if action != "connect" && action != "refresh" {
            self.result = Some(format!("Provider action unavailable ({action})."));
            self.stage = ConnectStage::Result;
            return None;
        }
        let provider = self.selected_provider()?.provider.clone();
        self.stage = ConnectStage::Previewing;
        self.preview = None;
        Some(provider)
    }

    pub fn apply_preview_record(&mut self, record: &Value) -> bool {
        if self.stage != ConnectStage::Previewing {
            return false;
        }
        if !record.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
            self.error = Some(format!("Preview failed · {}", error_text(record)));
            self.stage = ConnectStage::Result;
            self.yielded = false;
            return true;
        }
        let provider = record
            .get("provider")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let fingerprint = record
            .get("fingerprint")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if fingerprint.is_empty() {
            self.error = Some("Preview failed · missing fingerprint".into());
            self.stage = ConnectStage::Result;
            return true;
        }
        let surfaces = record.get("surfaces");
        let terminal = surfaces
            .and_then(|s| s.get("terminal"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let browser = surfaces
            .and_then(|s| s.get("browser"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let argv = record
            .get("argv")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let scope = record
            .get("scope")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let summary = record
            .get("summary")
            .and_then(|v| v.as_str())
            .unwrap_or("Authorize provider")
            .to_string();
        let mut lines = vec![
            format!("Provider · {provider}"),
            format!("Scope · {scope}"),
            format!("Command · {}", argv.join(" ")),
            format!(
                "Surfaces · terminal={} · browser={}",
                if terminal { "yes" } else { "no" },
                if browser { "yes" } else { "no" }
            ),
            summary.clone(),
        ];
        if browser {
            lines.push("Browser opens only if this authorized flow requires it.".into());
        }
        self.preview = Some(ConnectPreviewData {
            provider,
            fingerprint,
            summary,
            scope,
            argv,
            terminal,
            browser,
            lines,
        });
        self.stage = ConnectStage::Preview;
        true
    }

    pub fn open_confirm(&mut self) -> bool {
        if self.stage != ConnectStage::Preview || self.preview.is_none() {
            return false;
        }
        self.stage = ConnectStage::Confirm;
        true
    }

    pub fn cancel_confirm(&mut self) -> bool {
        if self.stage != ConnectStage::Confirm {
            return false;
        }
        self.stage = ConnectStage::Preview;
        true
    }

    /// Start connect after confirm. Returns (provider, fingerprint) to send.
    pub fn begin_connect(&mut self) -> Option<(String, String, bool)> {
        if self.stage != ConnectStage::Confirm {
            return None;
        }
        let preview = self.preview.as_ref()?;
        let terminal = preview.terminal;
        let provider = preview.provider.clone();
        let fingerprint = preview.fingerprint.clone();
        self.stage = if terminal {
            ConnectStage::Yielding
        } else {
            ConnectStage::Connecting
        };
        self.yielded = terminal;
        Some((provider, fingerprint, terminal))
    }

    pub fn mark_connecting_after_yield(&mut self) {
        if self.stage == ConnectStage::Yielding {
            self.stage = ConnectStage::Connecting;
        }
    }

    pub fn apply_connect_record(&mut self, record: &Value) -> bool {
        if self.stage != ConnectStage::Connecting
            && self.stage != ConnectStage::Yielding
            && self.stage != ConnectStage::Confirm
        {
            return false;
        }
        self.yielded = false;
        let ok = record.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
        let outcome = record
            .get("outcome")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let reason = record
            .get("reason")
            .and_then(|v| v.as_str())
            .unwrap_or(if ok { "connected" } else { "failed" });
        let label = record.get("label").and_then(|v| v.as_str());
        let connected = outcome == "connected"
            || reason == "login_completed"
            || (ok && reason == "connected");
        if connected {
            // Prefer adapter label when present; keep the inventory reminder if
            // the label is only the bare success token.
            let mut message = "Connected — refresh inventory to see verified models.".to_string();
            if let Some(l) = label {
                if !l.is_empty() && l != "Connected" {
                    message = l.to_string();
                }
            }
            self.result = Some(message);
            self.error = None;
        } else if reason == "auth_not_confirmed" {
            // Exit 0 without confirmed auth is not a connection.
            self.result = Some(label.unwrap_or("No conectado").into());
            self.error = None;
        } else if reason == "auth_check_incomplete" {
            // Login may have succeeded; only retry connections.status.
            self.result = Some(
                label
                    .unwrap_or("Not confirmed — retry the check")
                    .into(),
            );
            self.error = None;
        } else {
            // Cancel/fail must not look like success and must leave the flow usable.
            self.result = Some(
                label
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("Not connected · {reason}")),
            );
            self.error = None;
        }
        self.stage = ConnectStage::Result;
        true
    }

    pub fn apply_terminal_restore(&mut self, record: &Value) -> bool {
        self.yielded = false;
        if self.stage == ConnectStage::Yielding || self.stage == ConnectStage::Connecting {
            return self.apply_connect_record(record);
        }
        false
    }

    /// Escape / cancel: leave sub-stages without sticky busy flags.
    pub fn escape(&mut self) -> bool {
        match self.stage {
            ConnectStage::Loading | ConnectStage::Connecting | ConnectStage::Yielding => false,
            ConnectStage::Confirm => {
                self.stage = ConnectStage::Preview;
                true
            }
            ConnectStage::Preview | ConnectStage::Previewing => {
                self.preview = None;
                self.stage = ConnectStage::Browse;
                true
            }
            ConnectStage::Result => true, // host closes flow
            ConnectStage::Browse => true,
        }
    }

    pub fn body_lines(&self) -> Vec<String> {
        match self.stage {
            ConnectStage::Loading => vec!["Loading provider connections…".into()],
            ConnectStage::Browse => {
                let mut out = vec![
                    "Provider connections".into(),
                    "catalogued · verified · unverified · quota_limited are distinct.".into(),
                    String::new(),
                ];
                if self.providers.is_empty() {
                    out.push("  (no providers)".into());
                    return out;
                }
                for (i, p) in self.providers.iter().enumerate() {
                    let mark = if i == self.cursor { ">" } else { " " };
                    out.push(format!(
                        "{mark} {} · install={} · auth={} · action={}",
                        p.provider, p.installation, p.authentication, p.action
                    ));
                    out.push(format!("    quota={}", p.quota));
                    for line in &p.model_lines {
                        out.push(format!("    · {line}"));
                    }
                }
                out
            }
            ConnectStage::Previewing => vec!["Preparing authorization preview…".into()],
            ConnectStage::Preview => self
                .preview
                .as_ref()
                .map(|p| {
                    let mut lines = p.lines.clone();
                    lines.push(String::new());
                    lines.push("a authorize · Esc back".into());
                    lines
                })
                .unwrap_or_else(|| vec!["Preview unavailable.".into()]),
            ConnectStage::Confirm => vec![
                "Authorize this provider connection?".into(),
                self.preview
                    .as_ref()
                    .map(|p| p.scope.clone())
                    .unwrap_or_default(),
                "y confirm · n/Esc cancel".into(),
            ],
            ConnectStage::Yielding => vec![
                "Yielding terminal to provider CLI…".into(),
                "Kairo restores when the CLI exits.".into(),
            ],
            ConnectStage::Connecting => vec!["Connecting…".into()],
            ConnectStage::Result => {
                let mut out = Vec::new();
                if let Some(err) = &self.error {
                    out.push(err.clone());
                }
                if let Some(res) = &self.result {
                    out.push(res.clone());
                }
                out.push("Esc / Enter → back".into());
                out
            }
        }
    }

    pub fn footer_hints(&self) -> &'static str {
        match self.stage {
            ConnectStage::Loading | ConnectStage::Previewing | ConnectStage::Connecting => {
                "wait…"
            }
            ConnectStage::Yielding => "terminal yielded to CLI",
            ConnectStage::Browse => "↑↓ select · Enter preview · Esc close",
            ConnectStage::Preview => "a authorize · Esc back",
            ConnectStage::Confirm => "y confirm · n/Esc cancel",
            ConnectStage::Result => "Esc / Enter close",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn browse_inventory_and_setup_for_absent_cli() {
        let mut flow = ProviderConnectFlow::loading();
        assert!(flow.apply_status_record(&json!({
            "ok": true,
            "inventory": [{
                "provider": "cursor",
                "installation": "absent",
                "authentication": "absent",
                "action": "setup",
                "quota": "unknown",
                "models": []
            }]
        })));
        assert_eq!(flow.stage, ConnectStage::Browse);
        assert!(flow.begin_preview().is_none());
        assert_eq!(flow.stage, ConnectStage::Result);
        assert!(flow
            .result
            .as_deref()
            .unwrap_or("")
            .contains("CLI absent"));
    }

    #[test]
    fn preview_shows_provider_and_scope_before_confirm() {
        let mut flow = ProviderConnectFlow::loading();
        flow.apply_status_record(&json!({
            "ok": true,
            "inventory": [{
                "provider": "claude",
                "installation": "present",
                "authentication": "absent",
                "action": "connect",
                "quota": "unknown",
                "models": [{"modelId": "opus", "label": "Opus", "access": "catalogued"}]
            }]
        }));
        assert_eq!(flow.begin_preview().as_deref(), Some("claude"));
        assert!(flow.apply_preview_record(&json!({
            "ok": true,
            "provider": "claude",
            "fingerprint": "fp",
            "scope": "claude account · terminal",
            "summary": "Authorize Claude",
            "argv": ["claude", "auth", "login"],
            "surfaces": { "terminal": true, "browser": false }
        })));
        assert_eq!(flow.stage, ConnectStage::Preview);
        let body = flow.body_lines().join("\n");
        assert!(body.contains("Provider · claude"));
        assert!(body.contains("Scope · claude account"));
        assert!(flow.open_confirm());
        assert!(flow.cancel_confirm());
        assert_eq!(flow.stage, ConnectStage::Preview);
    }

    #[test]
    fn fail_and_cancel_clear_busy_without_false_success() {
        let mut flow = ProviderConnectFlow::loading();
        flow.apply_status_record(&json!({
            "ok": true,
            "inventory": [{
                "provider": "claude",
                "installation": "present",
                "authentication": "absent",
                "action": "connect",
                "quota": "unknown",
                "models": []
            }]
        }));
        flow.begin_preview();
        flow.apply_preview_record(&json!({
            "ok": true, "provider": "claude", "fingerprint": "fp",
            "scope": "s", "summary": "s", "argv": ["claude"],
            "surfaces": { "terminal": false, "browser": false }
        }));
        flow.open_confirm();
        let sent = flow.begin_connect().expect("connect");
        assert_eq!(sent.0, "claude");
        assert!(!flow.yielded);
        assert!(flow.apply_connect_record(&json!({ "ok": false, "reason": "cancelled" })));
        assert_eq!(flow.stage, ConnectStage::Result);
        assert!(!flow.yielded);
        assert!(flow.result.as_deref().unwrap_or("").contains("Not connected"));
        assert!(!flow.result.as_deref().unwrap_or("").contains("Connected —"));
    }

    #[test]
    fn auth_not_confirmed_shows_no_conectado() {
        let mut flow = ProviderConnectFlow::loading();
        flow.stage = ConnectStage::Connecting;
        assert!(flow.apply_connect_record(&json!({
            "ok": false,
            "outcome": "failed",
            "reason": "auth_not_confirmed"
        })));
        assert_eq!(flow.result.as_deref(), Some("No conectado"));
    }

    #[test]
    fn auth_check_incomplete_asks_to_retry_status_only() {
        let mut flow = ProviderConnectFlow::loading();
        flow.stage = ConnectStage::Connecting;
        assert!(flow.apply_connect_record(&json!({
            "ok": false,
            "outcome": "failed",
            "reason": "auth_check_incomplete"
        })));
        assert_eq!(
            flow.result.as_deref(),
            Some("Not confirmed — retry the check")
        );
    }

    #[test]
    fn bare_connected_label_keeps_inventory_reminder() {
        let mut flow = ProviderConnectFlow::loading();
        flow.stage = ConnectStage::Connecting;
        assert!(flow.apply_connect_record(&json!({
            "ok": true,
            "outcome": "connected",
            "reason": "login_completed",
            "label": "Connected"
        })));
        assert_eq!(
            flow.result.as_deref(),
            Some("Connected — refresh inventory to see verified models.")
        );
    }

    #[test]
    fn escape_from_preview_returns_to_browse() {
        let mut flow = ProviderConnectFlow::loading();
        flow.stage = ConnectStage::Preview;
        flow.preview = Some(ConnectPreviewData {
            provider: "x".into(),
            fingerprint: "fp".into(),
            summary: "s".into(),
            scope: "s".into(),
            argv: vec![],
            terminal: false,
            browser: false,
            lines: vec![],
        });
        assert!(flow.escape());
        assert_eq!(flow.stage, ConnectStage::Browse);
        assert!(flow.preview.is_none());
    }
}
