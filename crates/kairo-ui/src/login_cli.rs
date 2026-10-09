//! Child-process construction for the yielded provider login CLI.

use std::process::{Command, Stdio};

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;
    use std::path::PathBuf;

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
}
