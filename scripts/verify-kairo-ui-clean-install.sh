#!/usr/bin/env bash
# Stage a crate-less package root from dist/kairo-ui and run clean-install checks.
#
# Requires all four prebuilts:
#   dist/kairo-ui/{darwin-arm64,darwin-x64,linux-arm64,linux-x64}/kairo-ui
#
# Usage:
#   scripts/verify-kairo-ui-clean-install.sh
#
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist/kairo-ui"
KEYS=(darwin-arm64 darwin-x64 linux-arm64 linux-x64)

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

for key in "${KEYS[@]}"; do
  bin="$DIST/$key/kairo-ui"
  [ -x "$bin" ] || die "missing prebuilt: $bin (run scripts/build-kairo-ui-binaries.sh first)"
done

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/kairo-ui-clean-install.XXXXXX")"
cleanup() {
  rm -rf "$STAGE"
}
trap cleanup EXIT

mkdir -p "$STAGE/src/global/host"
# Minimal sidecar path so launchRatatuiHost can resolve KAIRO_UI_RPC_SCRIPT.
printf '%s\n' '// clean-install sidecar stub' >"$STAGE/src/global/host/kairo-ui-rpc-stdio.js"

for key in "${KEYS[@]}"; do
  mkdir -p "$STAGE/dist/kairo-ui/$key"
  cp "$DIST/$key/kairo-ui" "$STAGE/dist/kairo-ui/$key/kairo-ui"
  chmod +x "$STAGE/dist/kairo-ui/$key/kairo-ui"
done

# Prove the staged root has no Cargo sources.
if [ -e "$STAGE/crates" ] || [ -e "$STAGE/Cargo.toml" ]; then
  die "staged root unexpectedly contains crates/ or Cargo.toml"
fi

printf 'Staged clean-install root: %s\n' "$STAGE"
printf 'Artifact sizes:\n'
for key in "${KEYS[@]}"; do
  size="$(wc -c <"$STAGE/dist/kairo-ui/$key/kairo-ui" | tr -d ' ')"
  printf '  %s  %s bytes\n' "$key" "$size"
  file "$STAGE/dist/kairo-ui/$key/kairo-ui" || true
done

export KAIRO_UI_CLEAN_INSTALL_ROOT="$STAGE"
export KAIRO_UI_VERIFY_CLEAN_INSTALL=1
cd "$ROOT"
node --test test/kairo-ui-clean-install.test.js

printf '\nClean-install verification PASS (host exec + 4-way selection; foreign exec gaps recorded in test).\n'
