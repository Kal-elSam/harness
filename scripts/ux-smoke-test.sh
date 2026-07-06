#!/usr/bin/env bash
# UX smoke — read-only terminal output checks for clarity and copy consistency.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HARNESS_BIN="$ROOT/bin/harness.js"
FAKE_HOME="$(mktemp -d)"
CAPTURE_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$FAKE_HOME" "$CAPTURE_DIR"
}
trap cleanup EXIT

export HARNESS_HOME="$FAKE_HOME"

run_capture() {
  local label="$1"
  shift
  local outfile="$CAPTURE_DIR/${label}.txt"
  local errfile="$CAPTURE_DIR/${label}.stderr.txt"
  local status=0

  set +e
  node "$HARNESS_BIN" "$@" >"$outfile" 2>"$errfile"
  status=$?
  set -e

  echo "$status" >"$CAPTURE_DIR/${label}.exit"
  echo "== $label =="
  cat "$outfile"
  if [ -s "$errfile" ]; then
    cat "$errfile" >&2
  fi
  return 0
}

assert_contains() {
  local file="$1"
  local needle="$2"
  local label="${3:-$file}"

  if ! grep -Fq "$needle" "$file"; then
    echo "UX smoke failed: expected '$needle' in $label" >&2
    exit 1
  fi
}

assert_not_contains() {
  local file="$1"
  local needle="$2"
  local label="${3:-$file}"

  if grep -Fq "$needle" "$file"; then
    echo "UX smoke failed: did not expect '$needle' in $label" >&2
    exit 1
  fi
}

assert_exit() {
  local label="$1"
  local expected="$2"
  local actual

  actual="$(cat "$CAPTURE_DIR/${label}.exit")"
  if [ "$actual" != "$expected" ]; then
    echo "UX smoke failed: $label exit $actual, expected $expected" >&2
    exit 1
  fi
}

mkdir -p "$FAKE_HOME/.cursor" "$FAKE_HOME/.codex"
printf '%s\n' "# user content" >"$FAKE_HOME/.cursor/AGENTS.md"

echo "Harness UX smoke — capturing terminal output to $CAPTURE_DIR"
echo

run_capture help help
assert_contains "$CAPTURE_DIR/help.txt" "JSON output (--json on supported commands):"
assert_contains "$CAPTURE_DIR/help.txt" "report"
assert_contains "$CAPTURE_DIR/help.txt" "More examples: README.md"
assert_not_contains "$CAPTURE_DIR/help.txt" "Stable fields: ok, overall"
assert_exit help 0

run_capture setup-dry-run setup --dry-run
assert_contains "$CAPTURE_DIR/setup-dry-run.txt" "Dry run: nothing was written."
assert_contains "$CAPTURE_DIR/setup-dry-run.txt" "Backups planned:"
assert_exit setup-dry-run 0

run_capture status-missing status
assert_contains "$CAPTURE_DIR/status-missing.txt" "Overall: MISSING"
assert_exit status-missing 1

run_capture setup-yes setup --yes --agents cursor
assert_exit setup-yes 0

run_capture status-ok status
assert_contains "$CAPTURE_DIR/status-ok.txt" "Overall: OK"
assert_exit status-ok 0

rm -f "$FAKE_HOME/.harness/components/sdd-core/workflow.md"

run_capture status-drift status
assert_contains "$CAPTURE_DIR/status-drift.txt" "Overall: DRIFT"
assert_exit status-drift 1

run_capture sync-dry-run sync --dry-run --yes
assert_contains "$CAPTURE_DIR/sync-dry-run.txt" "Planned repairs:"
assert_contains "$CAPTURE_DIR/sync-dry-run.txt" "Backups planned:"
assert_exit sync-dry-run 1

run_capture history history
assert_contains "$CAPTURE_DIR/history.txt" "Harness history"
assert_exit history 0

run_capture history-last history last
assert_contains "$CAPTURE_DIR/history-last.txt" "Harness history last"
assert_exit history-last 0

run_capture report report
assert_contains "$CAPTURE_DIR/report.txt" "Harness report"
assert_contains "$CAPTURE_DIR/report.txt" "Diff:"
assert_exit report 1

run_capture invalid-command not-a-command
assert_contains "$CAPTURE_DIR/invalid-command.stderr.txt" 'Unknown command "not-a-command"'
assert_exit invalid-command 1

run_capture invalid-limit history --limit 0
assert_contains "$CAPTURE_DIR/invalid-limit.stderr.txt" "Invalid --limit"
assert_exit invalid-limit 1

run_capture consent-missing setup --agents cursor
assert_contains "$CAPTURE_DIR/consent-missing.stderr.txt" "Non-interactive setup requires"
assert_exit consent-missing 1

echo
echo "UX smoke passed. Captures kept in $CAPTURE_DIR until exit."
