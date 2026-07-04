#!/usr/bin/env bash
set -euo pipefail

PACKAGE="@kal-elsam/harness"
VERSION="latest"

while [ "$#" -gt 0 ]; do
  case "$1" in
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
    echo "HARNESS_HOME must be set for registry smoke tests" >&2
    exit 1
  fi

  if [ "$HARNESS_HOME" = "$HOME" ] || [ "$HARNESS_HOME" = "${HOME}/.harness" ]; then
    echo "Registry smoke must not use the real home directory" >&2
    exit 1
  fi
}

export HARNESS_HOME="$FAKE_HOME"
export npm_config_cache="$NPM_CACHE"
assert_harness_home_isolated

mkdir -p \
  "$FAKE_HOME/.cursor" \
  "$FAKE_HOME/.codex" \
  "$FAKE_HOME/.config/opencode" \
  "$FAKE_HOME/.claude"

echo "Installing ${PACKAGE}@${VERSION} from npm registry"
cd "$WORKDIR"
npm init -y >/dev/null
npm install "${PACKAGE}@${VERSION}" >/dev/null

INSTALLED_VERSION="$(node -p "require('./node_modules/${PACKAGE}/package.json').version")"
echo "Installed ${PACKAGE}@${INSTALLED_VERSION}"

if [ "$VERSION" != "latest" ] && [ "$INSTALLED_VERSION" != "$VERSION" ]; then
  echo "Expected version ${VERSION}, got ${INSTALLED_VERSION}" >&2
  exit 1
fi

CLI_VERSION="$(npx --no-install harness --version)"
if [ "$CLI_VERSION" != "$INSTALLED_VERSION" ]; then
  echo "harness --version (${CLI_VERSION}) does not match installed package (${INSTALLED_VERSION})" >&2
  exit 1
fi

echo
echo "== harness setup --dry-run =="
npx --no-install harness setup --dry-run

echo
echo "== harness setup --yes =="
npx --no-install harness setup --yes

echo
echo "== harness adapters --json =="
ADAPTERS_JSON="$(npx --no-install harness adapters --json)"
echo "$ADAPTERS_JSON"
node -e "
const payload = JSON.parse(process.argv[1]);
const expected = ['cursor', 'codex', 'opencode', 'claude'];
if (payload.managedCount !== 4 || payload.detectedCount !== 4) process.exit(1);
const managed = payload.adapters.filter((entry) => entry.managed).map((entry) => entry.id).sort();
if (JSON.stringify(managed) !== JSON.stringify(expected)) process.exit(1);
" "$ADAPTERS_JSON"

echo
echo "== harness status --json =="
STATUS_JSON="$(npx --no-install harness status --json)"
echo "$STATUS_JSON"
node -e "
const payload = JSON.parse(process.argv[1]);
if (!payload.ok || payload.overall !== 'ok') process.exit(1);
const managed = payload.agents.filter((agent) => agent.managed).map((agent) => agent.id).sort();
const expected = ['claude', 'codex', 'cursor', 'opencode'];
if (JSON.stringify(managed) !== JSON.stringify(expected)) process.exit(1);
" "$STATUS_JSON"

echo
echo "== simulate drift =="
rm -f "$FAKE_HOME/.harness/components/sdd-core/workflow.md"
node -e "
const fs = require('node:fs');
const path = require('node:path');
const config = path.join(process.env.HARNESS_HOME, '.config', 'opencode', 'AGENTS.md');
const content = fs.readFileSync(config, 'utf8');
fs.writeFileSync(config, content.replace('### SDD Core', '### Broken'));
"

echo
echo "== harness sync =="
npx --no-install harness sync

echo
echo "== harness status --json confirms OK =="
STATUS_JSON="$(npx --no-install harness status --json)"
echo "$STATUS_JSON"
OVERALL="$(node -e "const p=JSON.parse(process.argv[1]); if(!p.ok||p.overall!=='ok'){process.exit(1)} console.log(p.overall)" "$STATUS_JSON")"
if [ "$OVERALL" != "ok" ]; then
  echo "Expected status --json overall=ok after sync" >&2
  exit 1
fi

echo
echo "== harness uninstall =="
npx --no-install harness uninstall

echo
echo "Registry smoke test passed."
