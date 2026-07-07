#!/usr/bin/env bash
set -euo pipefail

PACKAGE="@kal-elsam/kairo-runtime"
PREFERRED_CLI="kairo"
VERSION="latest"
REPO="Kal-elSam/harness"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --package)
      PACKAGE="$2"
      shift 2
      ;;
    --package=*)
      PACKAGE="${1#*=}"
      shift
      ;;
    --version)
      VERSION="$2"
      shift 2
      ;;
    --version=*)
      VERSION="${1#*=}"
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

WORKDIR="$(mktemp -d)"
FAKE_HOME="$(mktemp -d)"
NPM_CACHE="$(mktemp -d)"

cleanup() {
  rm -rf "$WORKDIR" "$FAKE_HOME" "$NPM_CACHE"
}
trap cleanup EXIT

assert_harness_home_isolated() {
  if [ -z "${HARNESS_HOME:-}" ]; then
    echo "HARNESS_HOME must be set for installer smoke tests" >&2
    exit 1
  fi

  if [ "$HARNESS_HOME" = "$HOME" ] || [ "$HARNESS_HOME" = "${HOME}/.harness" ]; then
    echo "Installer smoke must not use the real home directory" >&2
    exit 1
  fi
}

resolve_install_script_url() {
  if [ "$VERSION" = "latest" ]; then
    printf '%s\n' "https://raw.githubusercontent.com/${REPO}/main/scripts/install.sh"
    return
  fi

  printf '%s\n' "https://raw.githubusercontent.com/${REPO}/v${VERSION}/scripts/install.sh"
}

assert_no_harness_state() {
  if [ -d "$HARNESS_HOME/.harness" ]; then
    echo "Expected no ~/.harness state at $HARNESS_HOME/.harness" >&2
    exit 1
  fi
}

assert_status_ok() {
  local status_json="$1"
  node -e "
const payload = JSON.parse(process.argv[1]);
if (!payload.ok || payload.overall !== 'ok') {
  console.error('Expected status --json overall=ok');
  process.exit(1);
}
const managed = payload.agents.filter((agent) => agent.managed).map((agent) => agent.id).sort();
const expected = ['claude', 'codex', 'cursor', 'opencode'];
if (JSON.stringify(managed) !== JSON.stringify(expected)) {
  console.error('Expected all four agents managed');
  process.exit(1);
}
" "$status_json"
}

assert_managed_configs_removed() {
  node -e "
const fs = require('node:fs');
const path = require('node:path');
const home = process.env.HARNESS_HOME;
const targets = [
  '.cursor/AGENTS.md',
  '.codex/AGENTS.md',
  '.config/opencode/AGENTS.md',
  '.claude/CLAUDE.md'
];

for (const relativePath of targets) {
  const filePath = path.join(home, relativePath);
  if (!fs.existsSync(filePath)) continue;
  const content = fs.readFileSync(filePath, 'utf8');
  if (content.includes('<!-- harness:managed:start -->')) {
    console.error('Managed marker still present in ' + relativePath);
    process.exit(1);
  }
}
"
}

export HARNESS_HOME="$FAKE_HOME"
export npm_config_cache="$NPM_CACHE"
assert_harness_home_isolated

cd "$WORKDIR"

INSTALL_SCRIPT_URL="$(resolve_install_script_url)"
echo "Installer smoke for ${PACKAGE}@${VERSION}"
echo "Install script: ${INSTALL_SCRIPT_URL}"
echo "Harness home: ${HARNESS_HOME}"

echo
echo "== curl install.sh | sh --version ${VERSION} (preview, no writes) =="
curl -fsSL "$INSTALL_SCRIPT_URL" | sh -s -- --version "$VERSION"
assert_no_harness_state

mkdir -p \
  "$FAKE_HOME/.cursor" \
  "$FAKE_HOME/.codex" \
  "$FAKE_HOME/.config/opencode" \
  "$FAKE_HOME/.claude"

echo
echo "== curl install.sh | sh --version ${VERSION} --yes --agents all =="
curl -fsSL "$INSTALL_SCRIPT_URL" | sh -s -- --version "$VERSION" --yes --agents all

if [ ! -d "$FAKE_HOME/.harness" ]; then
  echo "Expected install.sh --yes to create ~/.harness state" >&2
  exit 1
fi

echo
echo "== ${PREFERRED_CLI} status --json =="
STATUS_JSON="$(npx --yes "${PACKAGE}@${VERSION}" status --json)"
echo "$STATUS_JSON"
assert_status_ok "$STATUS_JSON"

echo
echo "== ${PREFERRED_CLI} uninstall =="
npx --yes "${PACKAGE}@${VERSION}" uninstall
assert_managed_configs_removed

echo
echo "Installer smoke test passed."
