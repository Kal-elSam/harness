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

mkdir -p "$FAKE_HOME/.cursor" "$FAKE_HOME/.codex"

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
echo "== harness install (agent-global) =="
npx --no-install harness install

echo
echo "== harness doctor (agent-global) =="
npx --no-install harness doctor

echo
echo "== harness update --dry-run (agent-global) =="
npx --no-install harness update --dry-run

echo
echo "== harness uninstall (agent-global) =="
npx --no-install harness uninstall

echo
echo "Registry smoke test passed."
