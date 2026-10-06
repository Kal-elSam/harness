#!/usr/bin/env bash
# Clean-install smoke: pack, install the tarball into a temp prefix OUTSIDE the
# checkout (isolated npm cache + HARNESS_HOME), then drive the INSTALLED copy.
# Needs the public npm registry (declared dependencies). No provider calls.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKDIR="$(mktemp -d)"
FAKE_HOME="$(mktemp -d)"
NPM_CACHE="$(mktemp -d)"
EMPTY_CWD="$(mktemp -d)"
TARBALL=""

cleanup() {
  rm -rf "$WORKDIR" "$FAKE_HOME" "$NPM_CACHE" "$EMPTY_CWD"
  if [ -n "$TARBALL" ] && [ -f "$ROOT/$TARBALL" ]; then
    rm -f "$ROOT/$TARBALL"
  fi
}
trap cleanup EXIT

assert_harness_home_isolated() {
  if [ -z "${HARNESS_HOME:-}" ]; then
    echo "HARNESS_HOME must be set for smoke tests" >&2
    exit 1
  fi
  if [ "$HARNESS_HOME" = "$HOME" ] || [ "$HARNESS_HOME" = "${HOME}/.harness" ]; then
    echo "Smoke must not use the real home directory" >&2
    exit 1
  fi
  case "$WORKDIR" in
    "$ROOT"/*) echo "Install prefix must be outside the checkout" >&2; exit 1 ;;
  esac
}

export HARNESS_HOME="$FAKE_HOME"
assert_harness_home_isolated

echo "== pack =="
TARBALL="$(cd "$ROOT" && npm pack --silent)"
echo "tarball: $TARBALL"

echo "== npm install into $WORKDIR (isolated cache) =="
cd "$WORKDIR"
npm init -y >/dev/null
npm install --cache "$NPM_CACHE" --no-audit --no-fund "$ROOT/$TARBALL" >/dev/null

PKG_NAME="$(node -p "require('$ROOT/package.json').name")"
INSTALLED="$WORKDIR/node_modules/$PKG_NAME"
BIN="$INSTALLED/bin/kairo.js"
[ -f "$BIN" ] || { echo "installed bin missing: $BIN" >&2; exit 1; }

# Scrubbed env: no repo paths, isolated home, neutral cwd.
run_clean() {
  (cd "$EMPTY_CWD" && env -i PATH="$PATH" HOME="$FAKE_HOME" HARNESS_HOME="$FAKE_HOME" "$@")
}

echo "== kairo --help (installed copy) =="
run_clean node "$BIN" --help | head -12

echo "== kairo mcp handshake (initialize + tools/list) =="
node "$ROOT/scripts/lib/clean-install-mcp-handshake.mjs" "$BIN" "$EMPTY_CWD" "$FAKE_HOME"

echo "== conversation service loads from installed copy =="
run_clean node --input-type=module -e '
import { pathToFileURL } from "node:url";
const mod = await import(pathToFileURL(process.argv[1]).href);
const service = mod.createConversationService({});
const ops = Object.keys(service).filter((k) => typeof service[k] === "function");
if (ops.length === 0) { console.error("service exposes no operations"); process.exit(1); }
console.log("createConversationService ok, operations:", ops.length);
' "$INSTALLED/src/global/conversation/service.js"

echo "== Pi fork dependency checklist (optional) =="
PI_PKG="@kal-elsam/kairo-pi-coding-agent"
PI_DIR="$INSTALLED/node_modules/$PI_PKG"
[ -d "$PI_DIR" ] || PI_DIR="$WORKDIR/node_modules/$PI_PKG"
if [ -f "$PI_DIR/package.json" ]; then
  echo "[x] $PI_PKG installed"
  echo "    path:    $PI_DIR"
  echo "    version: $(node -p "require('$PI_DIR/package.json').version")"
else
  echo "[ ] $PI_PKG NOT installed (optional here; the Pi host will refuse to start without it)"
fi

echo "== isolation: real home untouched by this run =="
if [ -n "$(find "$EMPTY_CWD" -mindepth 1 -print -quit)" ]; then
  echo "neutral cwd was written to" >&2
  exit 1
fi
echo "state written only under HARNESS_HOME: $(find "$FAKE_HOME" -type f | wc -l | tr -d ' ') files"

echo
echo "Clean-install smoke passed."
