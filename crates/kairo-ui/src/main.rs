mod layout;

use std::io::{self, stdout};

use crossterm::event::{self, Event, KeyCode, KeyEventKind};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::backend::CrosstermBackend;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph};
use ratatui::{Frame, Terminal};

use layout::{split_shell, ShellRegions};

fn main() -> io::Result<()> {
    enable_raw_mode()?;
    execute!(stdout(), EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout());
    let mut terminal = Terminal::new(backend)?;

    let result = run(&mut terminal);

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;
    result
}

fn run(terminal: &mut Terminal<CrosstermBackend<io::Stdout>>) -> io::Result<()> {
    loop {
        terminal.draw(draw)?;
        if event::poll(std::time::Duration::from_millis(250))? {
            if let Event::Key(key) = event::read()? {
                if key.kind == KeyEventKind::Press
                    && (key.code == KeyCode::Char('q') || key.code == KeyCode::Esc)
                {
                    break;
                }
            }
        }
    }
    Ok(())
}

fn draw(frame: &mut Frame) {
    let regions = split_shell(frame.area());
    paint_shell(frame, regions);
}

fn paint_shell(frame: &mut Frame, regions: ShellRegions) {
    if let Some(sidebar) = regions.sidebar {
        let block = Block::default()
            .borders(Borders::RIGHT)
            .border_style(Style::default().fg(Color::DarkGray))
            .style(Style::default().bg(Color::Rgb(28, 28, 36)));
        let inner = block.inner(sidebar);
        frame.render_widget(block, sidebar);
        let body = Paragraph::new(vec![
            Line::from(Span::styled(
                "◈ kairo",
                Style::default()
                    .fg(Color::White)
                    .add_modifier(Modifier::BOLD),
            )),
            Line::from(""),
            Line::from(Span::styled(
                "AGENTS",
                Style::default()
                    .fg(Color::Gray)
                    .add_modifier(Modifier::BOLD),
            )),
            Line::from(Span::styled(
                "(bridge — no RPC yet)",
                Style::default().fg(Color::DarkGray),
            )),
        ]);
        frame.render_widget(body, inner);
    }

    let main_block = Block::default()
        .borders(Borders::NONE)
        .style(Style::default().bg(Color::Black));
    let main_inner = main_block.inner(regions.main);
    frame.render_widget(main_block, regions.main);
    let welcome = Paragraph::new(vec![
        Line::from(Span::styled(
            "Welcome to Kairo",
            Style::default()
                .fg(Color::White)
                .add_modifier(Modifier::BOLD),
        )),
        Line::from(Span::styled(
            "ratatui host scaffold — q/Esc to quit",
            Style::default().fg(Color::DarkGray),
        )),
    ]);
    frame.render_widget(welcome, main_inner);

    let usage = Paragraph::new(Line::from(Span::styled(
        " USAGE · (waiting for bridge) ",
        Style::default()
            .fg(Color::White)
            .bg(Color::Rgb(40, 32, 56)),
    )));
    frame.render_widget(usage, regions.usage);
}
