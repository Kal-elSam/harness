mod bridge;
mod chat;
mod layout;
mod snapshot;
mod surfaces;

use std::env;
use std::io::{self, stdout};
use std::path::PathBuf;

use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::backend::CrosstermBackend;
use ratatui::{Frame, Terminal};
use ratatui_textarea::{Input, Key, TextArea};

use bridge::BridgeClient;
use chat::{sidebar_accepts_selection_keys, ChatState, Focus};
use layout::split_shell;
use snapshot::apply_workspace_snapshot;
use surfaces::{render_shell, ShellViewModel};

// Keybindings (V2 + R3b):
// - Tab: cycle focus Editor → Sidebar → Transcript
// - Editor: type in textarea; Enter submits prompt; Esc aborts stream or moves focus to Sidebar
// - Sidebar: j/k or arrows move agent selection
// - Transcript: PgUp/PgDn scroll
// - q: quit when Editor is empty; Ctrl+C / Ctrl+Q always quit
// - n/c: demo notice clear (visual review)

struct ShellApp {
    view: ShellViewModel,
    chat: ChatState,
    editor: TextArea<'static>,
    bridge: Option<BridgeClient>,
}

impl ShellApp {
    fn new(bridge: Option<BridgeClient>) -> Self {
        let mut editor = TextArea::default();
        editor.set_placeholder_text("Message…");
        Self {
            view: ShellViewModel::default(),
            chat: ChatState::default(),
            editor,
            bridge,
        }
    }

    fn poll_bridge(&mut self) {
        let Some(bridge) = self.bridge.as_mut() else {
            return;
        };
        let events = bridge.drain_events();
        for record in events {
            let kind = record.get("type").and_then(|v| v.as_str());
            if kind == Some("engine_unavailable") {
                let reason = record
                    .get("reason")
                    .and_then(|v| v.as_str())
                    .unwrap_or("engine unavailable");
                self.view.notice = Some(format!("Pi engine unavailable: {reason}"));
            }
            if matches!(kind, Some("ready") | Some("snapshot")) {
                if let Some(snap) = record.get("snapshot") {
                    apply_workspace_snapshot(&mut self.view, snap);
                }
            }
            if kind == Some("error") {
                let msg = record
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("bridge error");
                self.view.notice = Some(msg.to_string());
            }
            self.chat.apply_sidecar_event(&record);
        }
    }

    fn submit_editor(&mut self) {
        let text = self.editor.lines().join("\n");
        if text.trim().is_empty() {
            return;
        }
        self.chat.submit_user(text.clone());
        self.editor = TextArea::default();
        self.editor.set_placeholder_text("Message…");

        if let Some(bridge) = self.bridge.as_mut() {
            let _ = bridge.prompt(text.trim());
            self.chat.begin_assistant_stream();
        } else {
            self.chat.push_mock_assistant_reply(text.trim());
        }
    }

    fn abort_stream(&mut self) {
        if self.chat.is_streaming {
            if let Some(bridge) = self.bridge.as_mut() {
                let _ = bridge.abort();
            }
            self.chat.is_streaming = false;
            for msg in &mut self.chat.messages {
                msg.streaming = false;
            }
        }
    }
}

fn bridge_enabled_from_env() -> bool {
    env::args().any(|a| a == "--bridge")
        || env::var("KAIRO_UI_BRIDGE")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false)
}

fn main() -> io::Result<()> {
    enable_raw_mode()?;
    execute!(stdout(), EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout());
    let mut terminal = Terminal::new(backend)?;

    let bridge = if bridge_enabled_from_env() {
        let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        BridgeClient::spawn(&cwd).ok()
    } else {
        None
    };

    let mut app = ShellApp::new(bridge);
    let result = run(&mut terminal, &mut app);

    if let Some(mut bridge) = app.bridge.take() {
        let _ = bridge.stop();
    }

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;
    result
}

fn run(terminal: &mut Terminal<CrosstermBackend<io::Stdout>>, app: &mut ShellApp) -> io::Result<()> {
    loop {
        app.poll_bridge();
        terminal.draw(|frame| draw(frame, app))?;
        if !event::poll(std::time::Duration::from_millis(120))? {
            continue;
        }
        let Event::Key(key) = event::read()? else {
            continue;
        };
        if key.kind != KeyEventKind::Press {
            continue;
        }
        if handle_key(app, key)? {
            break;
        }
    }
    Ok(())
}

fn handle_key(app: &mut ShellApp, key: KeyEvent) -> io::Result<bool> {
    if key.modifiers.contains(KeyModifiers::CONTROL)
        && matches!(key.code, KeyCode::Char('c') | KeyCode::Char('q'))
    {
        return Ok(true);
    }

    match app.chat.focus {
        Focus::Editor => {
            if key.code == KeyCode::Tab {
                app.chat.focus = app.chat.focus.next();
                return Ok(false);
            }
            if key.code == KeyCode::Esc {
                if app.chat.is_streaming {
                    app.abort_stream();
                } else {
                    app.chat.focus = Focus::Sidebar;
                }
                return Ok(false);
            }
            if key.code == KeyCode::Enter && !key.modifiers.contains(KeyModifiers::SHIFT) {
                app.submit_editor();
                return Ok(false);
            }
            if key.code == KeyCode::Char('q') && app.editor.lines().join("").trim().is_empty() {
                return Ok(true);
            }
            if key.code == KeyCode::Char('n') {
                app.view.notice = Some("Demo notice: engine unavailable (bridge not wired)".into());
                return Ok(false);
            }
            if key.code == KeyCode::Char('c') && !key.modifiers.contains(KeyModifiers::CONTROL) {
                app.view.notice = None;
                return Ok(false);
            }
            if let Some(input) = crossterm_to_textarea(key) {
                app.editor.input(input);
            }
            return Ok(false);
        }
        Focus::Sidebar => {
            match key.code {
                KeyCode::Tab => app.chat.focus = app.chat.focus.next(),
                KeyCode::Esc => app.chat.focus = Focus::Editor,
                KeyCode::Char('q') => return Ok(true),
                KeyCode::Down | KeyCode::Char('j') if sidebar_accepts_selection_keys(app.chat.focus) => {
                    if !app.view.agents.is_empty() {
                        app.view.selected_agent =
                            (app.view.selected_agent + 1) % app.view.agents.len();
                    }
                }
                KeyCode::Up | KeyCode::Char('k') if sidebar_accepts_selection_keys(app.chat.focus) => {
                    if !app.view.agents.is_empty() {
                        app.view.selected_agent = (app.view.selected_agent + app.view.agents.len() - 1)
                            % app.view.agents.len();
                    }
                }
                KeyCode::Char('n') => {
                    app.view.notice = Some("Demo notice: engine unavailable (bridge not wired)".into());
                }
                KeyCode::Char('c') => app.view.notice = None,
                _ => {}
            }
            return Ok(false);
        }
        Focus::Transcript => {
            match key.code {
                KeyCode::Tab => app.chat.focus = app.chat.focus.next(),
                KeyCode::Esc => app.chat.focus = Focus::Editor,
                KeyCode::Char('q') => return Ok(true),
                KeyCode::PageUp => {
                    let regions = split_shell(ratatui::layout::Rect::new(0, 0, 100, 30));
                    let work = layout::split_work_main(regions.main);
                    let inner_h = work.transcript.height.saturating_sub(2) as usize;
                    let total = app.chat.messages.len() + 2;
                    app.chat.scroll_page_up(inner_h.max(1));
                    let _ = total;
                }
                KeyCode::PageDown => {
                    let regions = split_shell(ratatui::layout::Rect::new(0, 0, 100, 30));
                    let work = layout::split_work_main(regions.main);
                    let inner_h = work.transcript.height.saturating_sub(2) as usize;
                    let total = app.chat.messages.len() + 4;
                    app.chat.scroll_page_down(inner_h.max(1), total);
                }
                KeyCode::Char('n') => {
                    app.view.notice = Some("Demo notice: engine unavailable (bridge not wired)".into());
                }
                KeyCode::Char('c') => app.view.notice = None,
                _ => {}
            }
            return Ok(false);
        }
    }
}

fn crossterm_to_textarea(key: KeyEvent) -> Option<Input> {
    match key.code {
        KeyCode::Char(c) => Some(Input {
            key: Key::Char(c),
            ctrl: key.modifiers.contains(KeyModifiers::CONTROL),
            alt: key.modifiers.contains(KeyModifiers::ALT),
            shift: key.modifiers.contains(KeyModifiers::SHIFT),
        }),
        KeyCode::Backspace => Some(Input {
            key: Key::Backspace,
            ctrl: false,
            alt: false,
            shift: false,
        }),
        KeyCode::Delete => Some(Input {
            key: Key::Delete,
            ctrl: false,
            alt: false,
            shift: false,
        }),
        KeyCode::Left => Some(Input {
            key: Key::Left,
            ctrl: key.modifiers.contains(KeyModifiers::CONTROL),
            alt: false,
            shift: key.modifiers.contains(KeyModifiers::SHIFT),
        }),
        KeyCode::Right => Some(Input {
            key: Key::Right,
            ctrl: key.modifiers.contains(KeyModifiers::CONTROL),
            alt: false,
            shift: key.modifiers.contains(KeyModifiers::SHIFT),
        }),
        KeyCode::Up => Some(Input {
            key: Key::Up,
            ctrl: false,
            alt: false,
            shift: false,
        }),
        KeyCode::Down => Some(Input {
            key: Key::Down,
            ctrl: false,
            alt: false,
            shift: false,
        }),
        KeyCode::Home => Some(Input {
            key: Key::Home,
            ctrl: key.modifiers.contains(KeyModifiers::CONTROL),
            alt: false,
            shift: false,
        }),
        KeyCode::End => Some(Input {
            key: Key::End,
            ctrl: key.modifiers.contains(KeyModifiers::CONTROL),
            alt: false,
            shift: false,
        }),
        _ => None,
    }
}

fn draw(frame: &mut Frame, app: &ShellApp) {
    let regions = split_shell(frame.area());
    render_shell(
        frame.buffer_mut(),
        regions,
        &app.view,
        &app.chat,
        &app.editor,
    );
}
