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
echo "== kairo setup --dry-run =="
npx --no-install kairo setup --dry-run

echo
echo "== kairo status (before install) =="
if npx --no-install kairo status; then
  echo "Expected status to fail before install" >&2
  exit 1
fi

echo
echo "== kairo install --dry-run (agent-global) =="
npx --no-install kairo install --dry-run

echo
echo "== kairo install (agent-global) =="
npx --no-install kairo install

echo
echo "== kairo status (after install) =="
npx --no-install kairo status

echo
echo "== kairo components configure/verify sdd-core =="
npx --no-install kairo components configure sdd-core --agents codex,cursor --persona off --dry-run --json \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const p=JSON.parse(s);if(p.writes!==false||p.applied!==false)process.exit(1)})'
npx --no-install kairo components configure sdd-core --agents codex,cursor --persona off --yes --json \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const p=JSON.parse(s);const fs=require("fs");const path=require("path");if(!p.applied||!p.sessionRefreshRequired||!p.receipt?.id)process.exit(1);if(!fs.existsSync(path.join(process.env.HARNESS_HOME,".agents","skills","sdd-init","SKILL.md")))process.exit(1)})'
npx --no-install kairo components verify sdd-core --agents codex,cursor --json \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const p=JSON.parse(s);if(p.status!=="configured"||p.ok!==true)process.exit(1)})'

SNAPSHOT="$(ls -A "$FAKE_HOME/.harness/backups" | head -1)"
BACKUP_FILE="$(ls -A "$FAKE_HOME/.harness/backups/$SNAPSHOT" | head -1)"

if [ -z "$SNAPSHOT" ] || [ -z "$BACKUP_FILE" ]; then
  echo "Expected install to create a backup snapshot with files" >&2
  exit 1
fi

EXPECTED_BACKUP_CONTENT="$(cat "$FAKE_HOME/.harness/backups/$SNAPSHOT/$BACKUP_FILE")"

echo
echo "== kairo doctor (agent-global) =="
npx --no-install kairo doctor

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
if npx --no-install kairo doctor; then
  echo "Expected doctor to fail after drift simulation" >&2
  exit 1
fi

echo
echo "== kairo sync repairs drift =="
npx --no-install kairo sync --yes

echo
echo "== kairo status after sync =="
npx --no-install kairo status

echo
echo "== kairo doctor after repair =="
npx --no-install kairo doctor

echo
echo "== kairo history after sync =="
npx --no-install kairo history --json | node -e "
const fs = require('node:fs');
let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const parsed = JSON.parse(input.trim());
  if (!Array.isArray(parsed.events) || parsed.events.length < 1) {
    console.error('Expected history events after managed operations');
    process.exit(1);
  }
  const commands = new Set(parsed.events.map((event) => event.command));
  if (!commands.has('sync')) {
    console.error('Expected sync event in history');
    process.exit(1);
  }
});
"

echo
echo "== kairo backups =="
npx --no-install kairo backups

printf '%s\n' "SMOKE_USER_MARKER=corrupted" >"$FAKE_HOME/.cursor/AGENTS.md"
BEFORE_PREVIEW="$(cat "$FAKE_HOME/.cursor/AGENTS.md")"

echo
echo "== kairo rollback preview (dry-run) =="
npx --no-install kairo rollback --to "$SNAPSHOT"
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
echo "== kairo rollback apply =="
npx --no-install kairo rollback --to "$SNAPSHOT" --apply

assert_file_equals "$FAKE_HOME/.cursor/AGENTS.md" "$EXPECTED_BACKUP_CONTENT" "rollback target"

SNAPSHOT_COUNT_AFTER="$(ls -A "$FAKE_HOME/.harness/backups" | wc -l | tr -d ' ')"
if [ "$SNAPSHOT_COUNT_AFTER" -le "$SNAPSHOT_COUNT_BEFORE" ]; then
  echo "Expected rollback apply to create a safety backup snapshot" >&2
  exit 1
fi

echo
echo "== kairo uninstall (agent-global) =="
npx --no-install kairo uninstall

unset HARNESS_HOME

echo
echo "== kairo install --scope=workspace --mode enterprise =="
npx --no-install kairo install --scope=workspace --mode enterprise

echo
echo "== kairo doctor --scope=workspace =="
npx --no-install kairo doctor --scope=workspace

echo
echo "== kairo update --scope=workspace --dry-run =="
npx --no-install kairo update --scope=workspace --dry-run

echo
echo "Smoke test passed."
