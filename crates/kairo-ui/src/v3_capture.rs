//! Deterministic V3 visual fixture captures — Buffer dump (same paint as host).
//!
//! Label everything **FIXTURE mock — not live provider**. Never contacts Pi.
//! Does **not** mark V3 approved; artifacts are for human review only.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Color;
use ratatui_textarea::TextArea;
use serde_json::json;

use crate::chat::{ChatMessage, ChatState, Focus, MessageRole};
use crate::extension_ui::{ExtensionUiDialog, ExtensionUiRequest};
use crate::layout::split_shell;
use crate::ops_panel::{render_ops_panel, OpsPanelState};
use crate::plan_list::PlanListState;
use crate::settings_panel::{render_settings_panel, SettingsPanelState};
use crate::surfaces::{
    render_extension_ui, render_plan_list, render_shell, AgentState, BlockCause, ShellViewModel,
    SidebarAgent,
};
use crate::workspace_nav::WorkspaceView;

const FIXTURE_BANNER: &str = "FIXTURE mock — not live provider";

const SIZES: &[(u16, u16, &str)] = &[(60, 30, "60x30"), (100, 30, "100x30"), (160, 48, "160x48")];

const SCENARIOS: &[&str] = &["conversation", "tools", "plans", "dialog", "error"];

/// Entry from `kairo-ui --v3-capture [outdir]`. Returns process exit code.
pub fn run_capture(out_dir: PathBuf) -> i32 {
    match run_capture_inner(&out_dir) {
        Ok(n) => {
            eprintln!(
                "V3 visual fixtures: wrote {n} files under {} (NOT approved — awaiting human review)",
                out_dir.display()
            );
            0
        }
        Err(err) => {
            eprintln!("V3 capture failed: {err}");
            1
        }
    }
}

fn run_capture_inner(out_dir: &Path) -> io::Result<usize> {
    fs::create_dir_all(out_dir)?;
    let mut written = 0usize;
    for &(w, h, size_label) in SIZES {
        for &scenario in SCENARIOS {
            let area = Rect::new(0, 0, w, h);
            let mut buf = Buffer::empty(area);
            paint_scenario(&mut buf, area, scenario);
            let stem = format!("{size_label}-{scenario}");
            write_ansi(out_dir, &stem, &buf, area)?;
            write_txt(out_dir, &stem, &buf, area)?;
            write_html(out_dir, &stem, &buf, area)?;
            written += 3;
        }
    }
    // U5b cheap visual: Ops@60 and Settings@60 only (not every size matrix).
    for &(scenario, paint) in &[
        ("ops", paint_ops_fixture as fn(&mut Buffer, Rect)),
        ("settings", paint_settings_fixture as fn(&mut Buffer, Rect)),
    ] {
        let area = Rect::new(0, 0, 60, 30);
        let mut buf = Buffer::empty(area);
        paint(&mut buf, area);
        let stem = format!("60x30-{scenario}");
        write_ansi(out_dir, &stem, &buf, area)?;
        write_txt(out_dir, &stem, &buf, area)?;
        write_html(out_dir, &stem, &buf, area)?;
        written += 3;
    }
    write_readme(out_dir)?;
    written += 1;
    Ok(written)
}

fn paint_ops_fixture(buf: &mut Buffer, area: Rect) {
    let state = OpsPanelState::from_ops_record(&json!({
        "ok": true,
        "health": ["Control plane · HEALTHY (FIXTURE)"],
        "fleet": [
            "Fleet topology (kairo fleet) — not slash /providers",
            "opencode · fixture-orchestrator"
        ],
        "usage": ["Provider usage (/usage)", "Codex mock · 96%"],
        "diagnostics": ["Agents", "Detected: 1/1 (fixture)"],
        "runs": [{ "runId": "run-fixture", "state": "running", "agentId": "codex", "cancellable": true }],
        "alerts": [{ "alertId": "alt-fixture00000001", "state": "open", "title": "fixture alert" }],
        "reviews": [{ "reviewId": "rev-fixture", "state": "pass" }],
        "backups": ["fixture-snap-1"],
        "hints": "Esc → Work · r refresh · s sync · b rollback · c cancel · d dismiss · v reviews"
    }));
    let title = WorkspaceView::Operations.chrome_title();
    render_ops_panel(buf, area, &state, &title);
}

fn paint_settings_fixture(buf: &mut Buffer, area: Rect) {
    let state = SettingsPanelState::from_settings_record(&json!({
        "ok": true,
        "profile": ["PROFILE", "applyMode · prompt", "tokenBudget · 4000"],
        "integrations": ["available · Pi usage widget · 0.2.1 · MIT"],
        "connections": ["ok · Cursor MCP (fixture)"],
        "setup": {
            "wired": false,
            "label": "Interactive setup · not wired — use `kairo setup`"
        },
        "hints": "Esc → Work · ↑↓ browse · Enter preview · y/n confirm"
    }));
    let title = WorkspaceView::Settings.chrome_title();
    render_settings_panel(buf, area, &state, &title);
}

fn fixture_model(width: u16) -> ShellViewModel {
    let mut model = ShellViewModel {
        project: "V3-FIXTURE".into(),
        agents: vec![
            SidebarAgent {
                label: "Architect".into(),
                detail: "idle".into(),
                state: AgentState::Idle,
                cause: BlockCause::Unavailable,
            },
            SidebarAgent {
                label: "Builder".into(),
                detail: "rate limited".into(),
                state: AgentState::Blocked,
                cause: BlockCause::RateLimited,
            },
        ],
        selected_agent: 0,
        work_title: "Chat".into(),
        notice: Some(format!("{FIXTURE_BANNER} · V3-FIXTURE")),
        team_attention: None,
        work_empty_hint: None,
        usage_line: "USAGE · Codex mock 96% │ Claude mock 80%".into(),
        engine_line: "MODEL · mock-model · session v3-fixture-1".into(),
        team_state: Some("active".into()),
        work_mode: "plan".into(),
    };
    // Sidebar only paints when width ≥ 90; keep agents populated either way
    // so wide captures show them. Narrow frames simply omit the region.
    if width < 90 {
        model.notice = Some(format!(
            "{FIXTURE_BANNER} · V3-FIXTURE · sidebar collapsed (<90 cols)"
        ));
    }
    model
}

fn conversation_chat() -> ChatState {
    let mut chat = ChatState {
        messages: Vec::new(),
        scroll_offset: 0,
        is_streaming: false,
        focus: Focus::Transcript,
    };
    chat.messages.push(ChatMessage {
        role: MessageRole::User,
        content: "FIXTURE: outline the auth plan".into(),
        streaming: false,
        is_error: false,
        tool_call_id: None,
    });
    chat.messages.push(ChatMessage {
        role: MessageRole::Thinking,
        content: "FIXTURE thinking — weighing OAuth vs session cookies".into(),
        streaming: false,
        is_error: false,
        tool_call_id: None,
    });
    chat.messages.push(ChatMessage {
        role: MessageRole::Assistant,
        content: "FIXTURE assistant — propose OAuth login with refresh tokens.".into(),
        streaming: false,
        is_error: false,
        tool_call_id: None,
    });
    chat
}

fn tools_chat() -> ChatState {
    let mut chat = conversation_chat();
    chat.messages.push(ChatMessage {
        role: MessageRole::Tool,
        content: "✓ Read\nFIXTURE tool ok — src/auth/oauth.ts".into(),
        streaming: false,
        is_error: false,
        tool_call_id: Some("call_v3_1".into()),
    });
    chat.messages.push(ChatMessage {
        role: MessageRole::Tool,
        content: "✓ Grep\nFIXTURE tool ok — 3 matches".into(),
        streaming: false,
        is_error: false,
        tool_call_id: Some("call_v3_2".into()),
    });
    chat
}

fn error_chat() -> ChatState {
    let mut chat = conversation_chat();
    chat.messages.push(ChatMessage {
        role: MessageRole::Error,
        content: "FIXTURE error — provider timeout (mock)".into(),
        streaming: false,
        is_error: true,
        tool_call_id: None,
    });
    chat
}

fn fixture_plans() -> PlanListState {
    PlanListState::from_plans_record(&json!({
        "type": "plans",
        "timeline": [
            {
                "taskId": "v3-plan-aaaaaaaa-1111",
                "taskText": "FIXTURE plan — OAuth login flow",
                "state": "awaiting_approval",
                "approval": "not_decided",
                "planReady": true,
                "execution": { "state": "not_started", "active": false }
            },
            {
                "taskId": "v3-plan-bbbbbbbb-2222",
                "taskText": "FIXTURE plan — approved earlier",
                "state": "approved",
                "approval": "approved",
                "planReady": true,
                "execution": { "state": "not_started", "active": false }
            }
        ],
        "projectTeamRoles": ["Architect", "Builder"]
    }))
}

fn fixture_dialog() -> ExtensionUiDialog {
    let request = ExtensionUiRequest::from_record(&json!({
        "type": "extension_ui_request",
        "id": "v3-dialog-1",
        "method": "select",
        "title": "FIXTURE extension_ui select",
        "options": ["Allow", "Block", "Ask later"]
    }))
    .expect("fixture dialog request");
    ExtensionUiDialog::from_request(request)
}

fn paint_scenario(buf: &mut Buffer, area: Rect, scenario: &str) {
    let regions = split_shell(area);
    let model = fixture_model(area.width);
    let editor = TextArea::default();
    let chat = match scenario {
        "tools" => tools_chat(),
        "error" => error_chat(),
        _ => conversation_chat(),
    };
    let mut model = model;
    if scenario == "error" {
        model.notice = Some(format!(
            "{FIXTURE_BANNER} · ERROR notice — sidecar unavailable (mock)"
        ));
    }
    render_shell(buf, regions, &model, &chat, &editor);
    match scenario {
        "plans" => {
            let plans = fixture_plans();
            render_plan_list(buf, area, &plans, &model.work_mode);
        }
        "dialog" => {
            let dialog = fixture_dialog();
            render_extension_ui(buf, area, &dialog);
        }
        _ => {}
    }
}

fn rgb(color: Color) -> Option<(u8, u8, u8)> {
    match color {
        Color::Rgb(r, g, b) => Some((r, g, b)),
        Color::Reset => None,
        _ => None,
    }
}

fn write_ansi(out_dir: &Path, stem: &str, buf: &Buffer, area: Rect) -> io::Result<()> {
    let path = out_dir.join(format!("{stem}.ansi"));
    let mut out = String::new();
    out.push_str("\u{1b}[0m");
    let mut prev_fg: Option<(u8, u8, u8)> = None;
    let mut prev_bg: Option<(u8, u8, u8)> = None;
    for y in area.y..area.y.saturating_add(area.height) {
        for x in area.x..area.x.saturating_add(area.width) {
            let cell = &buf[(x, y)];
            let style = cell.style();
            let fg = style.fg.and_then(rgb);
            let bg = style.bg.and_then(rgb);
            if fg != prev_fg || bg != prev_bg {
                out.push_str("\u{1b}[0m");
                if let Some((r, g, b)) = fg {
                    out.push_str(&format!("\u{1b}[38;2;{r};{g};{b}m"));
                }
                if let Some((r, g, b)) = bg {
                    out.push_str(&format!("\u{1b}[48;2;{r};{g};{b}m"));
                }
                prev_fg = fg;
                prev_bg = bg;
            }
            out.push_str(cell.symbol());
        }
        out.push_str("\u{1b}[0m\n");
        prev_fg = None;
        prev_bg = None;
    }
    out.push_str("\u{1b}[0m");
    fs::write(path, out)
}

fn write_txt(out_dir: &Path, stem: &str, buf: &Buffer, area: Rect) -> io::Result<()> {
    let path = out_dir.join(format!("{stem}.txt"));
    let mut out = String::new();
    out.push_str(&format!("# {FIXTURE_BANNER}\n# size/scenario: {stem}\n"));
    for y in area.y..area.y.saturating_add(area.height) {
        for x in area.x..area.x.saturating_add(area.width) {
            out.push_str(buf[(x, y)].symbol());
        }
        out.push('\n');
    }
    fs::write(path, out)
}

fn write_html(out_dir: &Path, stem: &str, buf: &Buffer, area: Rect) -> io::Result<()> {
    let path = out_dir.join(format!("{stem}.html"));
    let mut body = String::new();
    for y in area.y..area.y.saturating_add(area.height) {
        for x in area.x..area.x.saturating_add(area.width) {
            let cell = &buf[(x, y)];
            let style = cell.style();
            let mut css = String::new();
            if let Some((r, g, b)) = style.fg.and_then(rgb) {
                css.push_str(&format!("color:rgb({r},{g},{b});"));
            }
            if let Some((r, g, b)) = style.bg.and_then(rgb) {
                css.push_str(&format!("background:rgb({r},{g},{b});"));
            }
            let sym = html_escape(cell.symbol());
            if css.is_empty() {
                body.push_str(&sym);
            } else {
                body.push_str(&format!("<span style=\"{css}\">{sym}</span>"));
            }
        }
        body.push('\n');
    }
    let html = format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>{stem} — V3 FIXTURE (not approved)</title>
<style>
body {{ background:#090F0E; color:#E8F5EF; margin:1rem; }}
pre {{ font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
       font-size:12px; line-height:1.15; white-space:pre; }}
.banner {{ color:#E0B45C; font-weight:bold; margin-bottom:0.75rem; }}
.note {{ color:#9AB2A5; margin-bottom:1rem; }}
</style>
</head>
<body>
<p class="banner">{FIXTURE_BANNER}</p>
<p class="note">{stem} · V3 not approved — awaiting human review · Buffer dump (same paint as host)</p>
<pre>{body}</pre>
</body>
</html>
"#
    );
    fs::write(path, html)
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn write_readme(out_dir: &Path) -> io::Result<()> {
    let path = out_dir.join("README.md");
    let mut matrix = String::new();
    for &(w, h, size) in SIZES {
        let sidebar = if w >= 90 {
            "sidebar visible (agents + USAGE)"
        } else {
            "sidebar collapsed (&lt;90 cols); USAGE still painted"
        };
        matrix.push_str(&format!("### {size} ({w}×{h}) — {sidebar}\n\n"));
        for &scenario in SCENARIOS {
            matrix.push_str(&format!(
                "- `{size}-{scenario}.ansi` / `.txt` / `.html`\n"
            ));
        }
        if w == 60 {
            matrix.push_str("- `60x30-ops.ansi` / `.txt` / `.html` (U5b)\n");
            matrix.push_str("- `60x30-settings.ansi` / `.txt` / `.html` (U5b)\n");
        }
        matrix.push('\n');
    }
    let body = format!(
        r#"# V3 visual fixtures (FIXTURE mock — not live provider)

**V3 is NOT approved.** These captures are for human review only. Do not treat
this directory as a visual gate pass.

All painted copy and sidecar data are **FIXTURE mock — not live provider**.
No Pi / real model was contacted.

## How to regenerate

From the repo root (or worktree):

```bash
scripts/kairo-ui-v3-capture
# or:
cd crates/kairo-ui && unset CARGO_TARGET_DIR && cargo run --release -- --v3-capture ../../docs/assets/v3-visual-fixtures
```

Optional live sidecar (never talks to Pi):

`scripts/fixtures/kairo-ui-v3-visual-mock-sidecar.mjs`

Prefer the Buffer dump path above — same `render_shell` / overlays as the host,
no TTY / `script(1)` flakiness.

## Matrix

{matrix}
## Review

- Open any `.html` in a browser (TrueColor spans, monospace).
- Or `cat` a `.ansi` in a TrueColor terminal (`cat docs/assets/v3-visual-fixtures/100x30-conversation.ansi`).
- Grep cues in `.txt`: `FIXTURE`, `you`, `assistant`, `thinking`, `Read`, `Plan`, `Extension`, `ERROR`.

**Status: V3 not approved — awaiting human review.**
"#
    );
    let mut f = fs::File::create(path)?;
    f.write_all(body.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_writes_expected_stems_to_temp() {
        let dir = std::env::temp_dir().join(format!(
            "kairo-v3-capture-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        let n = run_capture_inner(&dir).expect("capture ok");
        // 3 sizes × 5 scenarios × 3 formats + Ops@60 + Settings@60 × 3 + readme
        assert!(n >= 15 * 3 + 6 + 1, "expected matrix + u5b + readme, got {n}");
        let sample = fs::read_to_string(dir.join("100x30-conversation.txt")).unwrap();
        assert!(sample.contains("FIXTURE"));
        assert!(sample.contains("assistant") || sample.contains("you"));
        let tools = fs::read_to_string(dir.join("100x30-tools.txt")).unwrap();
        assert!(tools.contains("Read") || tools.contains("✓"));
        let plans = fs::read_to_string(dir.join("100x30-plans.txt")).unwrap();
        assert!(plans.contains("Plan") || plans.contains("OAuth") || plans.contains("awaiting"));
        let dialog = fs::read_to_string(dir.join("100x30-dialog.txt")).unwrap();
        assert!(dialog.contains("Extension") || dialog.contains("Allow"));
        let error = fs::read_to_string(dir.join("100x30-error.txt")).unwrap();
        assert!(error.contains("ERROR") || error.contains("error") || error.contains("timeout"));
        let narrow = fs::read_to_string(dir.join("60x30-conversation.txt")).unwrap();
        assert!(narrow.contains("collapsed") || narrow.contains("V3-FIXTURE"));
        let ops = fs::read_to_string(dir.join("60x30-ops.txt")).unwrap();
        assert!(ops.contains("Health") || ops.contains("kairo fleet") || ops.contains("Ops"));
        let settings = fs::read_to_string(dir.join("60x30-settings.txt")).unwrap();
        assert!(settings.contains("not wired") || settings.contains("Profile"));
        let _ = fs::remove_dir_all(&dir);
    }
}
