//! Node JSONL sidecar client (`kairo-ui-rpc-stdio.js`).

use std::env;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::thread;

use serde_json::Value;

/// Resolve sidecar script under the harness repo root.
pub fn resolve_sidecar_script() -> Option<PathBuf> {
    if let Ok(path) = env::var("KAIRO_UI_RPC_SCRIPT") {
        let p = PathBuf::from(path);
        if p.is_file() {
            return Some(p);
        }
    }
    let mut dir = env::current_dir().ok()?;
    for _ in 0..8 {
        let candidate = dir.join("src/global/host/kairo-ui-rpc-stdio.js");
        if candidate.is_file() {
            return Some(candidate);
        }
        if !dir.pop() {
            break;
        }
    }
    None
}

pub struct BridgeClient {
    child: Child,
    stdin: std::process::ChildStdin,
    events: Receiver<Value>,
    stopped: bool,
}

impl BridgeClient {
    pub fn spawn(cwd: &Path) -> std::io::Result<Self> {
        let script = resolve_sidecar_script().ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "kairo-ui-rpc-stdio.js not found (set KAIRO_UI_RPC_SCRIPT or run from repo)",
            )
        })?;
        let node = env::var("KAIRO_UI_NODE").unwrap_or_else(|_| "node".into());
        let mut child = Command::new(node)
            .arg(script)
            .arg("--cwd")
            .arg(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;
        let stdout = child.stdout.take().expect("stdout");
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(raw) => {
                        if raw.trim().is_empty() {
                            continue;
                        }
                        if let Ok(value) = serde_json::from_str::<Value>(&raw) {
                            let _ = tx.send(value);
                        }
                    }
                    Err(_) => break,
                }
            }
        });
        let stdin = child.stdin.take().expect("stdin");
        Ok(Self {
            child,
            stdin,
            events: rx,
            stopped: false,
        })
    }

    pub fn drain_events(&self) -> Vec<Value> {
        let mut out = Vec::new();
        while let Ok(v) = self.events.try_recv() {
            out.push(v);
        }
        out
    }

    pub fn send_op(&mut self, op: &str, extra: Value) -> std::io::Result<()> {
        let mut payload = serde_json::json!({ "op": op });
        if let Some(obj) = payload.as_object_mut() {
            if let Some(map) = extra.as_object() {
                for (k, v) in map {
                    obj.insert(k.clone(), v.clone());
                }
            }
        }
        let line = serde_json::to_string(&payload)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))?;
        writeln!(self.stdin, "{line}")?;
        self.stdin.flush()?;
        Ok(())
    }

    pub fn prompt(&mut self, message: &str) -> std::io::Result<()> {
        self.send_op("prompt", serde_json::json!({ "message": message }))
    }

    /// U4a: persist WorkMode under the active Kairo session (sidecar → service.setMode).
    pub fn set_mode(&mut self, mode: &str) -> std::io::Result<()> {
        self.send_op("set_mode", serde_json::json!({ "mode": mode }))
    }

    pub fn abort(&mut self) -> std::io::Result<()> {
        self.send_op("abort", Value::Null)
    }

    pub fn cycle_model(&mut self) -> std::io::Result<()> {
        self.send_op("cycle_model", Value::Null)
    }

    pub fn compact_session(&mut self) -> std::io::Result<()> {
        self.send_op("compact", Value::Null)
    }

    /// Analyze this project's team with the default analyst (headless).
    pub fn analyze_project_team(&mut self) -> std::io::Result<()> {
        self.send_op("project.analyze", Value::Null)
    }

    /// Analyze with the human's own picked analyst (see `analyst_picker`) —
    /// same clean modelRef shape `project-team-sidecar.js` expects.
    pub fn analyze_project_team_with(&mut self, analyst: Value) -> std::io::Result<()> {
        self.send_op("project.analyze", serde_json::json!({ "analyst": analyst }))
    }

    /// Read-only: fetch the real analyst catalog for the in-UI picker (T2).
    pub fn preflight_project_team(&mut self) -> std::io::Result<()> {
        self.send_op("project.preflight", Value::Null)
    }

    /// Approve the suggested team; the sidecar re-applies Architect after it.
    pub fn approve_project_team(&mut self) -> std::io::Result<()> {
        self.send_op("team.approve", Value::Null)
    }

    /// On-demand availability re-probe (U2c): real re-probe through the
    /// existing shared service, never a local guess. Answers with an
    /// `availability` record followed by a fresh `snapshot`.
    pub fn revalidate_team_availability(&mut self) -> std::io::Result<()> {
        self.send_op("team.revalidate", Value::Null)
    }

    /// Build (and persist) a SUGGESTED strategy-recovery proposal — never
    /// activates. Answers with a `recovery` record (`op: "preview"`).
    pub fn recovery_preview(&mut self) -> std::io::Result<()> {
        self.send_op("team.recovery.preview", Value::Null)
    }

    /// Approve the pending recovery proposal. The sidecar re-verifies it
    /// against CURRENT eligibility first — a stale proposal comes back as
    /// `outcome: "error"` and never touches the model or the strategy.
    pub fn recovery_apply(&mut self) -> std::io::Result<()> {
        self.send_op("team.recovery.apply", Value::Null)
    }

    /// Reject the pending recovery proposal — only closes the fingerprint;
    /// the active team was never touched by the proposal.
    pub fn recovery_reject(&mut self) -> std::io::Result<()> {
        self.send_op("team.recovery.reject", Value::Null)
    }

    pub fn new_session(&mut self) -> std::io::Result<()> {
        self.new_session_with_draft("")
    }

    /// Same as `new_session`, but also hands the sidecar the live compose-box
    /// text so it can save that draft under the *current* active Kairo id
    /// before the transition (U3a close).
    pub fn new_session_with_draft(&mut self, draft: &str) -> std::io::Result<()> {
        self.send_op("new_session", serde_json::json!({ "draft": draft }))
    }

    pub fn switch_session_index(&mut self, index: usize) -> std::io::Result<()> {
        self.switch_session_index_with_draft(index, "")
    }

    /// Switch with the live compose-box draft so the sidecar can persist it
    /// under the outgoing active Kairo id before moving (U3a close).
    pub fn switch_session_index_with_draft(
        &mut self,
        index: usize,
        draft: &str,
    ) -> std::io::Result<()> {
        self.send_op(
            "switch_session_index",
            serde_json::json!({ "index": index, "draft": draft }),
        )
    }

    /// Rename the CURRENTLY active session (Pi RPC's `set_session_name` has
    /// no sessionPath — it always applies to whichever session is live).
    pub fn rename_session(&mut self, name: &str) -> std::io::Result<()> {
        self.send_op("rename_session", serde_json::json!({ "name": name }))
    }

    /// Fork the CURRENTLY active session into a new one, distinct from the
    /// source (source untouched) — see the sidecar's own `fork_session`
    /// handler for why this uses RPC `clone`, not the entry-based `fork`.
    pub fn fork_session(&mut self) -> std::io::Result<()> {
        self.fork_session_with_draft("")
    }

    /// Fork and save the live compose-box draft under the source's active
    /// Kairo id before the clone (U3a close). Destination draft is empty.
    pub fn fork_session_with_draft(&mut self, draft: &str) -> std::io::Result<()> {
        self.send_op("fork_session", serde_json::json!({ "draft": draft }))
    }

    /// U3b: one-way `extension_ui_response` — `extra` must carry the original
    /// request `id` plus `value` / `confirmed` / `cancelled`. Never waits for
    /// a typed RPC response envelope.
    pub fn extension_ui_response(&mut self, extra: Value) -> std::io::Result<()> {
        self.send_op("extension_ui_response", extra)
    }

    /// U4b: session-scoped plan timeline (`service.snapshot` → timeline).
    pub fn plans_list(&mut self) -> std::io::Result<()> {
        self.send_op("plans.list", Value::Null)
    }

    /// U4b: Markdown detail for one plan (`showPlan`).
    pub fn plans_show(&mut self, task_id: &str) -> std::io::Result<()> {
        self.send_op("plans.show", serde_json::json!({ "taskId": task_id }))
    }

    /// U4b: approve or reject (`decidePlan`) — never execute.
    pub fn plans_decide(&mut self, task_id: &str, decision: &str) -> std::io::Result<()> {
        self.send_op(
            "plans.decide",
            serde_json::json!({ "taskId": task_id, "decision": decision }),
        )
    }

    /// Force-stop the Node sidecar. Never block the TTY on a wedged child:
    /// best-effort cooperative `stop`, then kill + wait. Idempotent for Drop.
    pub fn stop(&mut self) -> std::io::Result<()> {
        self.stop_with_draft("")
    }

    /// Same as `stop`, but also asks the sidecar to persist `draft` (the
    /// unsent editor text) for the bound Kairo session before exiting —
    /// U3a: draft survives quit -> resume. An empty `draft` still reaches
    /// the sidecar so a previously saved draft gets cleared once the human
    /// sent their message and quit with an empty compose box.
    pub fn stop_with_draft(&mut self, draft: &str) -> std::io::Result<()> {
        if self.stopped {
            return Ok(());
        }
        self.stopped = true;
        let _ = self.send_op("stop", serde_json::json!({ "draft": draft }));
        let _ = self.child.kill();
        let _ = self.child.wait();
        Ok(())
    }
}

impl Drop for BridgeClient {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}
