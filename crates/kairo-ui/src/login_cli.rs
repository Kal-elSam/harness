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

/// The only argv the yielded login may run, per provider.
///
/// Source of truth: `LOGIN_ARGV` in
/// `src/global/provider-connections/allowlist.js`; a test below fails if the
/// two tables drift.
///
/// NOTE: this restricts WHICH operations may run. It does NOT guarantee the
/// identity of the executable that `PATH` resolves the program name to; that
/// hardening (absolute/verified binary paths) is a separate task.
pub const LOGIN_ARGV: &[(&str, &[&str])] = &[
    ("codex", &["codex", "login"]),
    ("claude", &["claude", "auth", "login", "--claudeai"]),
    ("cursor", &["cursor-agent", "login"]),
    ("opencode-go", &["opencode", "auth", "login"]),
];

/// Why a `terminal_yield` argv payload was refused before any spawn.
#[derive(Debug, PartialEq, Eq)]
pub enum ArgvRejection {
    NotAnArray,
    NonStringElement,
    NotAllowlisted,
}

/// Failure of [`spawn_login`]: refused by validation, or the spawner failed.
#[derive(Debug)]
pub enum LoginSpawnError {
    Rejected(ArgvRejection),
    Spawn(std::io::Error),
}

impl std::fmt::Display for LoginSpawnError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Rejected(reason) => write!(f, "argv rejected ({reason:?})"),
            Self::Spawn(err) => write!(f, "spawn failed ({err})"),
        }
    }
}

/// Validate the RAW JSON `argv` against [`LOGIN_ARGV`]. Accepts only an exact
/// match; any non-string element rejects the whole payload (never filtered).
pub fn validate_login_argv(raw: &Value) -> Result<Vec<String>, ArgvRejection> {
    let items = raw.as_array().ok_or(ArgvRejection::NotAnArray)?;
    let argv: Vec<&str> = items
        .iter()
        .map(|v| v.as_str().ok_or(ArgvRejection::NonStringElement))
        .collect::<Result<_, _>>()?;
    if LOGIN_ARGV.iter().any(|(_, allowed)| *allowed == argv.as_slice()) {
        Ok(argv.into_iter().map(str::to_string).collect())
    } else {
        Err(ArgvRejection::NotAllowlisted)
    }
}

/// Validate, then hand the argv to `spawn`. `spawn` is never called for a
/// rejected payload (the seam tests count calls through it).
pub fn spawn_login(
    raw: &Value,
    spawn: impl FnOnce(&[String]) -> std::io::Result<Child>,
) -> Result<Child, LoginSpawnError> {
    let argv = validate_login_argv(raw).map_err(LoginSpawnError::Rejected)?;
    spawn(&argv).map_err(LoginSpawnError::Spawn)
}

/// Production spawner: [`build_command`] (secrets stripped) then spawn.
pub fn spawn_real(argv: &[String]) -> std::io::Result<Child> {
    build_command(argv)
        .ok_or_else(|| std::io::Error::other("empty argv"))?
        .spawn()
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

    // ---- exact argv validation (Task A) ----

    fn js_login_argv() -> Vec<(String, Vec<String>)> {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../src/global/provider-connections/allowlist.js");
        let src = std::fs::read_to_string(&path).expect("read allowlist.js");
        let start = src
            .find("LOGIN_ARGV = deepFreeze({")
            .expect("LOGIN_ARGV in allowlist.js");
        let body = &src[start..];
        let body = &body[body.find('{').unwrap() + 1..];
        let body = &body[..body.find("})").unwrap()];
        body.lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(|l| {
                let (key, arr) = l.split_once(':').expect("key: [..] line");
                let arr = arr.trim().trim_end_matches(',');
                let argv: Vec<String> = serde_json::from_str(arr).expect("argv json array");
                (key.trim().trim_matches('"').to_string(), argv)
            })
            .collect()
    }

    #[test]
    fn login_argv_table_matches_the_js_allowlist() {
        let mut js = js_login_argv();
        assert_eq!(js.len(), 4, "JS LOGIN_ARGV parsed wrong: {js:?}");
        let mut rust: Vec<(String, Vec<String>)> = LOGIN_ARGV
            .iter()
            .map(|(k, a)| (k.to_string(), a.iter().map(|s| s.to_string()).collect()))
            .collect();
        js.sort();
        rust.sort();
        assert_eq!(rust, js);
    }

    #[test]
    fn validate_accepts_exactly_the_four_allowlisted_argv() {
        for (_, argv) in js_login_argv() {
            let got = validate_login_argv(&json!(argv)).expect("valid argv");
            assert_eq!(got, argv);
        }
    }

    fn rejected_payloads() -> Vec<Value> {
        vec![
            json!(["codex", "login", "--x"]),
            json!(["codex", "exec", "rm -rf /"]),
            json!(["codex"]),
            json!(["login"]),
            json!(["/usr/bin/codex", "login"]),
            json!(["env", "codex", "login"]),
            json!(["sh", "-c", "codex login"]),
            json!(["claude", "auth", "login"]),
            json!(["opencode", "auth", "login", "extra"]),
            json!(["cursor-agent", "login", ""]),
            json!(["Codex", "login"]),
            json!(["unknown", "cmd"]),
            json!([]),
            json!(["codex", 1, "login"]),
            json!(["codex", null, "login"]),
            json!(["codex", "login", 7]),
            json!([["codex", "login"]]),
            json!("codex login"),
            json!({"0": "codex", "1": "login"}),
            json!(null),
            json!(42),
        ]
    }

    #[test]
    fn validate_rejects_everything_else_including_non_string_elements() {
        for payload in rejected_payloads() {
            assert!(
                validate_login_argv(&payload).is_err(),
                "must reject {payload}"
            );
        }
    }

    #[test]
    fn spawn_login_calls_the_spawner_zero_times_for_every_rejected_payload() {
        use std::cell::Cell;
        for payload in rejected_payloads() {
            let calls = Cell::new(0);
            let out = spawn_login(&payload, |_| {
                calls.set(calls.get() + 1);
                Err(std::io::Error::other("must not be reached"))
            });
            assert!(matches!(out, Err(LoginSpawnError::Rejected(_))), "{payload}");
            assert_eq!(calls.get(), 0, "spawner reached for {payload}");
        }
    }

    #[test]
    fn spawn_login_calls_the_spawner_exactly_once_per_valid_payload() {
        use std::cell::{Cell, RefCell};
        for (_, argv) in js_login_argv() {
            let calls = Cell::new(0);
            let seen = RefCell::new(Vec::new());
            let out = spawn_login(&json!(argv), |a| {
                calls.set(calls.get() + 1);
                seen.borrow_mut().extend(a.iter().cloned());
                Err(std::io::Error::other("no real CLI in tests"))
            });
            assert!(matches!(out, Err(LoginSpawnError::Spawn(_))));
            assert_eq!(calls.get(), 1);
            assert_eq!(*seen.borrow(), argv);
        }
    }
}
