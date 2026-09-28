#!/usr/bin/env bash
# Build kairo-ui prebuilts into dist/kairo-ui/<platform-arch>/kairo-ui
#
# Supported keys (npm package layout):
#   darwin-arm64  darwin-x64  linux-arm64  linux-x64
#
# On a typical Apple Silicon Mac only darwin-arm64 builds natively.
# Other targets are attempted via cargo --target when the toolchain is
# installed; otherwise they are skipped honestly (layout + JS resolver
# tests still cover all four selection keys).
#
# CI matrix placeholder (not wired in this repo yet):
#   - macos-14  → darwin-arm64 (+ optional darwin-x64 cross)
#   - ubuntu-22.04 (x64) → linux-x64
#   - ubuntu-22.04-arm / qemu → linux-arm64
# Produce artifacts under dist/kairo-ui/<key>/kairo-ui and attach to the
# npm pack step before publish.
#
# Usage:
#   scripts/build-kairo-ui-binaries.sh
#   scripts/build-kairo-ui-binaries.sh --host-only
#   scripts/build-kairo-ui-binaries.sh --target darwin-arm64
#
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CRATE="$ROOT/crates/kairo-ui"
OUT_ROOT="$ROOT/dist/kairo-ui"
MANIFEST="$CRATE/Cargo.toml"
HOST_ONLY=0
ONLY_TARGET=""

usage() {
  cat <<'EOF'
Usage: build-kairo-ui-binaries.sh [--host-only] [--target <key>]

  --host-only     Build only the current host platform/arch.
  --target <key>  Build one of: darwin-arm64, darwin-x64, linux-arm64, linux-x64.
EOF
}

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --host-only) HOST_ONLY=1; shift ;;
    --target)
      [ "$#" -ge 2 ] || die "--target requires a key"
      ONLY_TARGET="$2"
      shift 2
      ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[ -f "$MANIFEST" ] || die "missing crate manifest: $MANIFEST"

host_os="$(uname -s | tr '[:upper:]' '[:lower:]')"
host_arch_raw="$(uname -m)"
case "$host_arch_raw" in
  arm64|aarch64) host_arch="arm64" ;;
  x86_64|amd64) host_arch="x64" ;;
  *) die "unsupported host arch: $host_arch_raw" ;;
esac

case "$host_os" in
  darwin|linux) ;;
  *) die "unsupported host OS: $host_os (Windows ui stays CLI-only)" ;;
esac

host_key="${host_os}-${host_arch}"

# key → rustc target triple
rust_target_for() {
  case "$1" in
    darwin-arm64) printf '%s\n' "aarch64-apple-darwin" ;;
    darwin-x64) printf '%s\n' "x86_64-apple-darwin" ;;
    linux-arm64) printf '%s\n' "aarch64-unknown-linux-gnu" ;;
    linux-x64) printf '%s\n' "x86_64-unknown-linux-gnu" ;;
    *) return 1 ;;
  esac
}

has_rust_target() {
  rustup target list --installed 2>/dev/null | grep -qx "$1"
}

copy_built() {
  local key="$1"
  local built="$2"
  local dest_dir="$OUT_ROOT/$key"
  mkdir -p "$dest_dir"
  cp "$built" "$dest_dir/kairo-ui"
  chmod +x "$dest_dir/kairo-ui"
  printf 'built %s → %s\n' "$key" "$dest_dir/kairo-ui"
}

build_one() {
  local key="$1"
  local rust_target
  rust_target="$(rust_target_for "$key")" || die "unknown target key: $key"

  if [ "$key" = "$host_key" ]; then
    (
      cd "$ROOT"
      unset CARGO_TARGET_DIR
      cargo build --release --manifest-path "$MANIFEST"
    )
    copy_built "$key" "$CRATE/target/release/kairo-ui"
    return 0
  fi

  if ! command -v rustup >/dev/null 2>&1; then
    printf 'skip %s — rustup not available for cross-compile\n' "$key"
    return 0
  fi
  if ! has_rust_target "$rust_target"; then
    printf 'skip %s — rustup target %s not installed (install with: rustup target add %s)\n' \
      "$key" "$rust_target" "$rust_target"
    return 0
  fi

  if ! (
    cd "$ROOT"
    unset CARGO_TARGET_DIR
    cargo build --release --manifest-path "$MANIFEST" --target "$rust_target"
  ); then
    printf 'skip %s — cargo cross-build for %s failed (linker/toolchain)\n' "$key" "$rust_target"
    return 0
  fi

  local candidate="$CRATE/target/$rust_target/release/kairo-ui"
  if [ ! -f "$candidate" ]; then
    printf 'skip %s — expected binary missing after build: %s\n' "$key" "$candidate"
    return 0
  fi
  copy_built "$key" "$candidate"
}

mkdir -p "$OUT_ROOT"

if [ -n "$ONLY_TARGET" ]; then
  build_one "$ONLY_TARGET"
elif [ "$HOST_ONLY" -eq 1 ]; then
  build_one "$host_key"
else
  for key in darwin-arm64 darwin-x64 linux-arm64 linux-x64; do
    build_one "$key"
  done
fi

printf '\nLayout under %s:\n' "$OUT_ROOT"
for key in darwin-arm64 darwin-x64 linux-arm64 linux-x64; do
  if [ -x "$OUT_ROOT/$key/kairo-ui" ]; then
    printf '  [ok]   %s\n' "$key"
  else
    printf '  [miss] %s  (selection still tested in JS; CI/cross fills this)\n' "$key"
  fi
done
