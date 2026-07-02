#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKDIR="$(mktemp -d)"
TARBALL=""

cleanup() {
  rm -rf "$WORKDIR"
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

echo
echo "== harness init --mode enterprise =="
npx --no-install harness init --mode enterprise

echo
echo "== harness doctor =="
npx --no-install harness doctor

echo
echo "== harness update --dry-run =="
npx --no-install harness update --dry-run

echo
echo "Smoke test passed."
