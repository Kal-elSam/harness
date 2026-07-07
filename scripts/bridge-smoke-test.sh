#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BRIDGE_DIR="$ROOT/packages/harness-bridge"
WORKDIR="$(mktemp -d)"
FAKE_HOME="$(mktemp -d)"
NPM_CACHE="$(mktemp -d)"

cleanup() {
  rm -rf "$WORKDIR" "$FAKE_HOME" "$NPM_CACHE"
}
trap cleanup EXIT

export HARNESS_HOME="$FAKE_HOME"
export npm_config_cache="$NPM_CACHE"

mkdir -p \
  "$FAKE_HOME/.cursor" \
  "$FAKE_HOME/.codex" \
  "$FAKE_HOME/.config/opencode" \
  "$FAKE_HOME/.claude"

echo "Packing @kal-elsam/kairo-runtime from $ROOT"
RUNTIME_TGZ="$(cd "$ROOT" && npm pack --silent --pack-destination "$WORKDIR")"
RUNTIME_TGZ_PATH="$WORKDIR/$RUNTIME_TGZ"

echo "Packing @kal-elsam/harness bridge"
BRIDGE_TGZ="$(cd "$BRIDGE_DIR" && npm pack --silent --pack-destination "$WORKDIR")"
BRIDGE_TGZ_PATH="$WORKDIR/$BRIDGE_TGZ"

INSTALL_DIR="$WORKDIR/project"
mkdir -p "$INSTALL_DIR"
(
  cd "$INSTALL_DIR"
  npm init -y >/dev/null
  npm install "$RUNTIME_TGZ_PATH" "$BRIDGE_TGZ_PATH" --ignore-scripts
)

HARNESS_BIN="$INSTALL_DIR/node_modules/@kal-elsam/harness/bin/harness.js"

echo
echo "== harness --version (warning on stderr, version on stdout) =="
VERSION_OUTPUT="$(node "$HARNESS_BIN" --version 2>"$WORKDIR/version.stderr" || true)"
VERSION_STDERR="$(cat "$WORKDIR/version.stderr")"

if ! grep -q "@kal-elsam/harness has moved to @kal-elsam/kairo-runtime" <<<"$VERSION_STDERR"; then
  echo "Expected migration warning on stderr" >&2
  echo "stderr: $VERSION_STDERR" >&2
  exit 1
fi

if ! grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' <<<"$VERSION_OUTPUT"; then
  echo "Expected semver on stdout, got: $VERSION_OUTPUT" >&2
  exit 1
fi

if grep -q "@kal-elsam/harness has moved" <<<"$VERSION_OUTPUT"; then
  echo "Migration warning must not appear on stdout" >&2
  exit 1
fi

echo "stdout version: $VERSION_OUTPUT"

echo
echo "== harness status --json (JSON on stdout only) =="
set +e
STATUS_OUTPUT="$(node "$HARNESS_BIN" status --json 2>"$WORKDIR/status.stderr")"
STATUS_EXIT=$?
set -e
STATUS_STDERR="$(cat "$WORKDIR/status.stderr")"

if [ "$STATUS_EXIT" -ne 0 ] && [ "$STATUS_EXIT" -ne 1 ]; then
  echo "Unexpected exit code from harness status --json: $STATUS_EXIT" >&2
  exit 1
fi

if ! grep -q "@kal-elsam/harness has moved to @kal-elsam/kairo-runtime" <<<"$STATUS_STDERR"; then
  echo "Expected migration warning on stderr for status --json" >&2
  exit 1
fi

node -e "JSON.parse(process.argv[1])" "$STATUS_OUTPUT"

if grep -q "@kal-elsam/harness has moved" <<<"$STATUS_OUTPUT"; then
  echo "Migration warning must not appear in JSON stdout" >&2
  exit 1
fi

echo
echo "Bridge smoke test passed."
