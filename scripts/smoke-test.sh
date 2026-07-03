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

echo "Packing $(node -p "require('$ROOT/package.json').name") from $ROOT"
TARBALL="$(cd "$ROOT" && npm pack --silent)"

echo "Installing tarball in $WORKDIR"
cd "$WORKDIR"
npm init -y >/dev/null
npm install "$ROOT/$TARBALL" >/dev/null

mkdir -p "$FAKE_HOME/.cursor" "$FAKE_HOME/.codex"
export HARNESS_HOME="$FAKE_HOME"

echo
echo "== harness install --dry-run (agent-global) =="
npx --no-install harness install --dry-run

echo
echo "== harness install (agent-global) =="
npx --no-install harness install

echo
echo "== harness doctor (agent-global) =="
npx --no-install harness doctor

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
