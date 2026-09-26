mod layout;
mod surfaces;

use std::io::{self, stdout};

use crossterm::event::{self, Event, KeyCode, KeyEventKind};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::backend::CrosstermBackend;
use ratatui::{Frame, Terminal};

use layout::split_shell;
use surfaces::{render_shell, ShellViewModel};

fn main() -> io::Result<()> {
    enable_raw_mode()?;
    execute!(stdout(), EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout());
    let mut terminal = Terminal::new(backend)?;

    let mut model = ShellViewModel::default();
    let result = run(&mut terminal, &mut model);

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;
    result
}

fn run(terminal: &mut Terminal<CrosstermBackend<io::Stdout>>, model: &mut ShellViewModel) -> io::Result<()> {
    loop {
        terminal.draw(|frame| draw(frame, model))?;
        if !event::poll(std::time::Duration::from_millis(250))? {
            continue;
        }
        let Event::Key(key) = event::read()? else {
            continue;
        };
        if key.kind != KeyEventKind::Press {
            continue;
        }
        match key.code {
            KeyCode::Char('q') | KeyCode::Esc => break,
            KeyCode::Char('n') => {
                // Demo notice for visual review — not a live Pi error.
                model.notice = Some("Demo notice: engine unavailable (bridge not wired)".into());
            }
            KeyCode::Char('c') => {
                model.notice = None;
            }
            KeyCode::Down | KeyCode::Char('j') => {
                if !model.agents.is_empty() {
                    model.selected_agent = (model.selected_agent + 1) % model.agents.len();
                }
            }
            KeyCode::Up | KeyCode::Char('k') => {
                if !model.agents.is_empty() {
                    model.selected_agent = (model.selected_agent + model.agents.len() - 1)
                        % model.agents.len();
                }
            }
            _ => {}
        }
    }
    Ok(())
}

fn draw(frame: &mut Frame, model: &ShellViewModel) {
    let regions = split_shell(frame.area());
    render_shell(frame.buffer_mut(), regions, model);
}
