//! Child-process construction for the yielded provider login CLI.

use std::process::{Child, Command, Stdio};
use std::time::Duration;

use serde_json::Value;

/// Env vars that carry provider credentials; removed from the yielded login
/// CLI's environment.
///
/// Source of truth: `SECRET_ENV_KEYS` in
/// `src/global/provider-connections/allowlist.js` (the JS side applies it via
/// `sanitizeEnv`). A test below fails if this list drifts from the JS one.
pub const SECRET_ENV_KEYS: &[&str] = &[
    "CURSOR_API_KEY",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "OPENAI_API_KEY",
    "CODEX_API_KEY",
    "OPENCODE_API_KEY",
];

/// Build the login CLI command with inherited stdio and secrets stripped.
/// `None` when `argv` is empty.
pub fn build_command(argv: &[String]) -> Option<Command> {
    let (program, args) = argv.split_first()?;
    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    for key in SECRET_ENV_KEYS {
        cmd.env_remove(key);
    }
    Some(cmd)
}

/// Run `child` to completion, killing and reaping it as soon as `cancelled`
/// returns true. Returns the exit code, or `None` when cancelled, signalled or
/// the wait failed.
pub fn wait_or_cancel(
    child: &mut Child,
    mut cancelled: impl FnMut() -> bool,
    poll: Duration,
) -> Option<i32> {
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.code(),
            Ok(None) => {}
            Err(_) => return None,
        }
        if cancelled() {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        std::thread::sleep(poll);
    }
}

/// Split `events` into stashed non-matching records and whether a
/// `terminal_cancel` for `session_id` was seen.
pub fn take_cancel(events: Vec<Value>, session_id: &str, stash: &mut Vec<Value>) -> bool {
    let mut cancelled = false;
    for record in events {
        let is_cancel = record.get("type").and_then(Value::as_str) == Some("terminal_cancel")
            && record.get("sessionId").and_then(Value::as_str) == Some(session_id);
        if is_cancel {
            cancelled = true;
        } else {
            stash.push(record);
        }
    }
    cancelled
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;
    use std::path::PathBuf;
    use std::time::Instant;
    use serde_json::json;

    fn js_secret_keys() -> Vec<String> {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../src/global/provider-connections/allowlist.js");
        let src = std::fs::read_to_string(&path).expect("read allowlist.js");
        let start = src
            .find("SECRET_ENV_KEYS = Object.freeze([")
            .expect("SECRET_ENV_KEYS in allowlist.js");
        let body = &src[start..];
        let body = &body[body.find('[').unwrap() + 1..];
        let body = &body[..body.find(']').unwrap()];
        body.split(',')
            .map(|s| s.trim().trim_matches('"').to_string())
            .filter(|s| !s.is_empty())
            .collect()
    }

    #[test]
    fn secret_env_keys_match_the_js_allowlist() {
        let js = js_secret_keys();
        assert!(!js.is_empty(), "JS list parsed empty");
        let rust: Vec<String> = SECRET_ENV_KEYS.iter().map(|s| s.to_string()).collect();
        assert_eq!(rust, js);
    }

    #[test]
    fn build_command_removes_every_secret_env_var() {
        let cmd = build_command(&["codex".into(), "login".into()]).unwrap();
        let envs: Vec<_> = cmd.get_envs().collect();
        for key in js_secret_keys() {
            assert!(
                envs.contains(&(OsStr::new(&key), None)),
                "{key} not removed from child env"
            );
        }
    }

    #[test]
    fn build_command_keeps_program_and_args_and_rejects_empty_argv() {
        let cmd = build_command(&["codex".into(), "login".into(), "--x".into()]).unwrap();
        assert_eq!(cmd.get_program(), "codex");
        let args: Vec<_> = cmd.get_args().collect();
        assert_eq!(args, ["login", "--x"]);
        assert!(build_command(&[]).is_none());
    }

    #[test]
    fn cancel_kills_and_reaps_the_child_without_waiting_for_it() {
        let mut child = Command::new("sleep").arg("30").spawn().unwrap();
        let mut polls = 0;
        let started = Instant::now();
        let code = wait_or_cancel(
            &mut child,
            || {
                polls += 1;
                polls >= 2
            },
            Duration::from_millis(10),
        );
        assert!(started.elapsed() < Duration::from_secs(1), "did not stop promptly");
        assert_eq!(code, None);
        assert!(
            matches!(child.try_wait(), Ok(Some(_))),
            "child must be reaped"
        );
    }

    #[test]
    fn natural_exit_reports_the_exit_code_without_cancel() {
        let mut child = Command::new("sh").args(["-c", "exit 3"]).spawn().unwrap();
        let code = wait_or_cancel(&mut child, || false, Duration::from_millis(10));
        assert_eq!(code, Some(3));
    }

    #[test]
    fn take_cancel_matches_only_its_session_and_stashes_the_rest() {
        let mut stash = Vec::new();
        let events = vec![
            json!({"type": "terminal_cancel", "sessionId": "other"}),
            json!({"type": "chat_delta", "text": "hi"}),
            json!({"type": "terminal_cancel", "sessionId": "s1"}),
        ];
        assert!(take_cancel(events, "s1", &mut stash));
        assert_eq!(stash.len(), 2);
        assert_eq!(stash[0]["sessionId"], "other");
        assert!(!take_cancel(vec![json!({"type": "ready"})], "s1", &mut stash));
        assert_eq!(stash.len(), 3);
    }
}
