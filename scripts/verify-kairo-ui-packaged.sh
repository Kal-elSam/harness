#!/usr/bin/env bash
# Verify a packed npm tarball as a complete executable package (U6).
#
# Usage:
#   scripts/verify-kairo-ui-packaged.sh <tarball.tgz> [expected-key]
#
# The tarball is extracted into a clean directory. The binary, resolver and
# launcher under test come from that extracted package. Only the mock sidecar
# fixture and the PTY driver are taken from this repository checkout, because
# they are test tooling and not part of the shipped runtime.
#
# Checks (run on the machine whose native key is expected):
#   a) the package's own resolver selects <expected-key> for this host
#   b) the package's own launcher selects and spawns that binary without Cargo
#      (no cargo on PATH, no crates/ or Cargo.toml in the extracted package)
#   c) the packaged binary's --v3-capture writes >= 10 files
#   d) PTY run (KAIRO_UI_BINARY -> packaged binary, --bridge, KAIRO_UI_BRIDGE=1)
#      with the mock sidecar at KAIRO_PTY_SIZES (default 60x30,100x30,160x48):
#      bridge connection, output, and alt-screen enter/leave restoration.
#   e) PTY run of the suggested-alternative confirmation modal against the
#      packaged binary (scripts/kairo-ui-alternative-modal-pty-e2e.py).
#
# The packaged binary must already be executable in the tarball: the script
# checks the mode BEFORE doing anything else and never chmods it.
#
# The mock sidecar does NOT prove real providers: it only proves that the
# packaged host binary starts, talks the bridge protocol, renders, and restores
# the terminal. Real provider runtimes are covered by other, separate evidence.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

die() {
  printf 'Packaged verification FAIL: %s\n' "$*" >&2
  exit 1
}

if [ "$#" -lt 1 ] || [ -z "${1:-}" ]; then
  printf 'usage: %s <tarball.tgz> [expected-key]\n' "$0" >&2
  exit 2
fi
TARBALL="$1"
[ -f "$TARBALL" ] || die "tarball not found: $TARBALL"

host_key() {
  local os arch
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) die "unsupported OS $(uname -s)" ;;
  esac
  case "$(uname -m)" in
    arm64 | aarch64) arch=arm64 ;;
    x86_64 | amd64) arch=x64 ;;
    *) die "unsupported arch $(uname -m)" ;;
  esac
  printf '%s-%s' "$os" "$arch"
}
EXPECTED_KEY="${2:-$(host_key)}"

NODE_BIN="$(command -v node)" || die "node not found on PATH"
PY_BIN="$(command -v python3)" || die "python3 not found on PATH"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/kairo-ui-packaged.XXXXXX")"
cleanup() {
  rm -rf "$WORK"
}
trap cleanup EXIT

EXTRACT="$WORK/extract"
mkdir -p "$EXTRACT"
tar -xzf "$TARBALL" -C "$EXTRACT"
PKG="$EXTRACT/package"
[ -d "$PKG" ] || die "tarball has no package/ root"
printf 'Extracted %s -> %s\n' "$TARBALL" "$PKG"

# Clean package: no Cargo sources, and a PATH that cannot reach cargo.
[ ! -e "$PKG/crates" ] || die "package ships crates/"
[ ! -e "$PKG/Cargo.toml" ] || die "package ships Cargo.toml"
NOCARGO_BIN="$WORK/bin"
mkdir -p "$NOCARGO_BIN"
ln -s "$NODE_BIN" "$NOCARGO_BIN/node"
ln -s "$PY_BIN" "$NOCARGO_BIN/python3"
NOCARGO_PATH="$NOCARGO_BIN:/usr/bin:/bin"
if PATH="$NOCARGO_PATH" command -v cargo >/dev/null 2>&1; then
  die "cargo is still reachable on the restricted PATH"
fi

BIN="$PKG/dist/kairo-ui/$EXPECTED_KEY/kairo-ui"
[ -f "$BIN" ] || die "package is missing dist/kairo-ui/$EXPECTED_KEY/kairo-ui"
# The binary must be executable exactly as the tarball ships it. Never chmod it
# here: that would hide a packing step that dropped the mode (e.g. 644).
# The octal mode comes from Node (already required), not stat: BSD and GNU stat
# take different flags, and GNU `stat -f` prints filesystem info instead of failing.
if [ ! -x "$BIN" ]; then
  BIN_MODE="$("$NODE_BIN" -e 'console.log((require("node:fs").statSync(process.argv[1]).mode & 0o777).toString(8))' "$BIN")"
  die "packaged binary is not executable as shipped (mode $BIN_MODE): $BIN"
fi

# (a) + (b): resolver and launcher come from the extracted package.
PKG_ROOT="$PKG" EXPECTED_KEY="$EXPECTED_KEY" PATH="$NOCARGO_PATH" \
  "$NODE_BIN" --input-type=module -e '
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const root = process.env.PKG_ROOT;
const key = process.env.EXPECTED_KEY;
const prebuilt = await import(pathToFileURL(join(root, "src/global/host/kairo-ui-prebuilt.js")));
const launcher = await import(pathToFileURL(join(root, "src/global/host/launch-ratatui-host.js")));
assert.equal(prebuilt.prebuiltBinaryKey(process.platform, process.arch), key);
const selected = prebuilt.resolvePrebuiltBinary({ packageRoot: root });
assert.equal(selected, join(root, "dist", "kairo-ui", key, "kairo-ui"));
console.log(`selection: ${key} -> ${selected}`);
let cargoCalls = 0;
let spawned = null;
await launcher.launchRatatuiHost({
  cwd: root,
  interactive: true,
  packageRoot: root,
  statImpl: () => ({ isDirectory: () => true }),
  cargoBuildImpl: async () => { cargoCalls += 1; return { status: 0 }; },
  spawnImpl: async (command, args, options) => { spawned = { command, args, options }; return { status: 0 }; }
});
assert.equal(cargoCalls, 0, "launcher invoked cargo");
assert.equal(spawned?.command, selected);
assert.deepEqual(spawned?.args, ["--bridge"]);
console.log("launch without cargo: OK");
' || die "resolver/launcher selection failed"

# (c) packaged binary --v3-capture.
CAP="$WORK/v3"
mkdir -p "$CAP"
PATH="$NOCARGO_PATH" "$BIN" --v3-capture "$CAP" >"$WORK/v3.log" 2>&1 \
  || die "--v3-capture exited non-zero: $(tr '\n' ' ' <"$WORK/v3.log")"
COUNT="$(find "$CAP" -type f | wc -l | tr -d ' ')"
[ "$COUNT" -ge 10 ] || die "--v3-capture wrote only $COUNT files"
printf 'v3-capture: %s files\n' "$COUNT"

# (d) PTY with the mock sidecar from the repo checkout.
EVIDENCE="${KAIRO_PTY_EVIDENCE_DIR:-$WORK/pty-evidence}"
PATH="$NOCARGO_PATH" \
  KAIRO_UI_BINARY="$BIN" \
  KAIRO_UI_BRIDGE=1 \
  KAIRO_UI_NODE="$NODE_BIN" \
  KAIRO_PTY_SIZES="${KAIRO_PTY_SIZES:-60x30,100x30,160x48}" \
  KAIRO_PTY_EVIDENCE_DIR="$EVIDENCE" \
  "$PY_BIN" "$ROOT/scripts/kairo-ui-pty-e2e.py" \
  || die "PTY e2e failed for the packaged binary"

# (e) suggested-alternative confirmation modal on the packaged binary (mock sidecar).
PATH="$NOCARGO_PATH" \
  KAIRO_UI_BINARY="$BIN" \
  KAIRO_UI_NODE="$NODE_BIN" \
  KAIRO_PTY_SIZES="${KAIRO_PTY_SIZES:-100x30}" \
  KAIRO_PTY_EVIDENCE_DIR="$EVIDENCE/alternative-modal" \
  "$PY_BIN" "$ROOT/scripts/kairo-ui-alternative-modal-pty-e2e.py" \
  || die "alternative-modal PTY failed for the packaged binary"

printf '\nPackaged verification PASS (%s): executable as shipped, selection, launch without cargo, v3-capture, PTY with mock sidecar, alternative-modal PTY.\n' "$EXPECTED_KEY"
printf 'Note: the mock sidecar does NOT prove real providers.\n'
