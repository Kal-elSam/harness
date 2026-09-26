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
        let line = serde_json::to_string(&payload).map_err(|e| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string())
        })?;
        writeln!(self.stdin, "{line}")?;
        self.stdin.flush()?;
        Ok(())
    }

    pub fn prompt(&mut self, message: &str) -> std::io::Result<()> {
        self.send_op(
            "prompt",
            serde_json::json!({ "message": message }),
        )
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

    /// Approve the suggested team; the sidecar re-applies Architect after it.
    pub fn approve_project_team(&mut self) -> std::io::Result<()> {
        self.send_op("team.approve", Value::Null)
    }

    pub fn new_session(&mut self) -> std::io::Result<()> {
        self.send_op("new_session", Value::Null)
    }

    pub fn switch_session_index(&mut self, index: usize) -> std::io::Result<()> {
        self.send_op(
            "switch_session_index",
            serde_json::json!({ "index": index }),
        )
    }

    pub fn stop(&mut self) -> std::io::Result<()> {
        let _ = self.send_op("stop", Value::Null);
        let _ = self.child.wait();
        Ok(())
    }
}

impl Drop for BridgeClient {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}
