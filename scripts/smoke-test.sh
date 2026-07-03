#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKDIR="$(mktemp -d)"
FAKE_HOME="$(mktemp -d)"
TARBALL=""

cleanup() {
  rm -rf "$WORKDIR" "$FAKE_HOME"
  if [ -n "$TARBALL" ] && [ -f "$ROOT/$TARBALL" ]; then
    rm -f "$ROOT/$TARBALL"
  fi
}
trap cleanup EXIT

assert_file_equals() {
  local file="$1"
  local expected="$2"
  local label="${3:-$file}"

  if [ "$(cat "$file")" != "$expected" ]; then
    echo "Assertion failed: $label content mismatch" >&2
    exit 1
  fi
}

assert_harness_home_isolated() {
  if [ -z "${HARNESS_HOME:-}" ]; then
    echo "HARNESS_HOME must be set for smoke tests" >&2
    exit 1
  fi

  if [ "$HARNESS_HOME" = "$HOME" ] || [ "$HARNESS_HOME" = "${HOME}/.harness" ]; then
    echo "Smoke must not use the real home directory" >&2
    exit 1
  fi

  if [ -d "$HOME/.harness" ] && [ "$HARNESS_HOME" = "$HOME/.harness" ]; then
    echo "Smoke must not touch real ~/.harness" >&2
    exit 1
  fi
}

echo "Packing $(node -p "require('$ROOT/package.json').name") from $ROOT"
TARBALL="$(cd "$ROOT" && npm pack --silent)"

echo "Installing tarball in $WORKDIR"
cd "$WORKDIR"
npm init -y >/dev/null
npm install "$ROOT/$TARBALL" >/dev/null

mkdir -p "$FAKE_HOME/.cursor" "$FAKE_HOME/.codex"
printf '%s\n' "SMOKE_USER_MARKER=before-install" >"$FAKE_HOME/.cursor/AGENTS.md"
export HARNESS_HOME="$FAKE_HOME"
assert_harness_home_isolated

echo
echo "== harness setup --dry-run =="
npx --no-install harness setup --dry-run

echo
echo "== harness status (before install) =="
if npx --no-install harness status; then
  echo "Expected status to fail before install" >&2
  exit 1
fi

echo
echo "== harness install --dry-run (agent-global) =="
npx --no-install harness install --dry-run

echo
echo "== harness install (agent-global) =="
npx --no-install harness install

echo
echo "== harness status (after install) =="
npx --no-install harness status

SNAPSHOT="$(ls -A "$FAKE_HOME/.harness/backups" | head -1)"
BACKUP_FILE="$(ls -A "$FAKE_HOME/.harness/backups/$SNAPSHOT" | head -1)"

if [ -z "$SNAPSHOT" ] || [ -z "$BACKUP_FILE" ]; then
  echo "Expected install to create a backup snapshot with files" >&2
  exit 1
fi

EXPECTED_BACKUP_CONTENT="$(cat "$FAKE_HOME/.harness/backups/$SNAPSHOT/$BACKUP_FILE")"

echo
echo "== harness doctor (agent-global) =="
npx --no-install harness doctor

echo
echo "== simulate drift + doctor detects it =="
rm -f "$FAKE_HOME/.harness/components/sdd-core/workflow.md"
node -e "
const fs = require('node:fs');
const path = require('node:path');
const config = path.join(process.env.HARNESS_HOME, '.cursor', 'AGENTS.md');
const content = fs.readFileSync(config, 'utf8');
fs.writeFileSync(config, content.replace('### SDD Core', '### Broken'));
"
if npx --no-install harness doctor; then
  echo "Expected doctor to fail after drift simulation" >&2
  exit 1
fi

echo
echo "== harness sync repairs drift =="
npx --no-install harness sync

echo
echo "== harness status after sync =="
npx --no-install harness status

echo
echo "== harness doctor after repair =="
npx --no-install harness doctor

echo
echo "== harness backups =="
npx --no-install harness backups

printf '%s\n' "SMOKE_USER_MARKER=corrupted" >"$FAKE_HOME/.cursor/AGENTS.md"
BEFORE_PREVIEW="$(cat "$FAKE_HOME/.cursor/AGENTS.md")"

echo
echo "== harness rollback preview (dry-run) =="
npx --no-install harness rollback --to "$SNAPSHOT"
AFTER_PREVIEW="$(cat "$FAKE_HOME/.cursor/AGENTS.md")"

if [ "$BEFORE_PREVIEW" != "$AFTER_PREVIEW" ]; then
  echo "Rollback preview mutated files" >&2
  exit 1
fi

if [ "$AFTER_PREVIEW" = "$EXPECTED_BACKUP_CONTENT" ]; then
  echo "Rollback preview unexpectedly restored content" >&2
  exit 1
fi

SNAPSHOT_COUNT_BEFORE="$(ls -A "$FAKE_HOME/.harness/backups" | wc -l | tr -d ' ')"

echo
echo "== harness rollback apply =="
npx --no-install harness rollback --to "$SNAPSHOT" --apply

assert_file_equals "$FAKE_HOME/.cursor/AGENTS.md" "$EXPECTED_BACKUP_CONTENT" "rollback target"

SNAPSHOT_COUNT_AFTER="$(ls -A "$FAKE_HOME/.harness/backups" | wc -l | tr -d ' ')"
if [ "$SNAPSHOT_COUNT_AFTER" -le "$SNAPSHOT_COUNT_BEFORE" ]; then
  echo "Expected rollback apply to create a safety backup snapshot" >&2
  exit 1
fi

echo
echo "== harness uninstall (agent-global) =="
npx --no-install harness uninstall

unset HARNESS_HOME

echo
echo "== harness install --scope=workspace --mode enterprise =="
npx --no-install harness install --scope=workspace --mode enterprise

echo
echo "== harness doctor --scope=workspace =="
npx --no-install harness doctor --scope=workspace

echo
echo "== harness update --scope=workspace --dry-run =="
npx --no-install harness update --scope=workspace --dry-run

echo
echo "Smoke test passed."
