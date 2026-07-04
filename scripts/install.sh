#!/usr/bin/env sh
# Bootstrap installer for Agentic Harness (@kal-elsam/harness).
#
# Safe by design:
#   - no sudo
#   - no shell profile changes
#   - does not write agent configs or ~/.harness (only runs setup --dry-run)
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Kal-elSam/harness/main/scripts/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/Kal-elSam/harness/main/scripts/install.sh | sh -s -- --dry-run
#   curl -fsSL https://raw.githubusercontent.com/Kal-elSam/harness/main/scripts/install.sh | sh -s -- --version 0.11.0
#
set -eu

PACKAGE="@kal-elsam/harness"
VERSION="latest"
DRY_RUN=0

usage() {
  printf '%s\n' \
    "Harness bootstrap installer" \
    "" \
    "Usage:" \
    "  install.sh [--dry-run] [--version <semver|latest>]" \
    "" \
    "Options:" \
    "  --dry-run              Print the plan only. Does not download or run harness." \
    "  --version <version>    Package version to run (default: latest)." \
    "  -h, --help             Show this help." \
    "" \
    "What it does:" \
    "  1. Checks for Node.js and npm." \
    "  2. Runs the package via npx (or npm exec) with: setup --dry-run" \
    "  3. Prints next steps. Configs are written only when you run: harness setup" \
    "" \
    "Security:" \
    "  - Never uses sudo." \
    "  - Never modifies shell profiles (.bashrc, .zshrc, etc.)." \
    "  - Never writes ~/.harness or agent configs (setup --dry-run only)."
}

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --version)
      [ "$#" -ge 2 ] || die "Missing value for --version"
      VERSION="$2"
      shift 2
      ;;
    --version=*)
      VERSION="${1#*=}"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1 (try --help)"
      ;;
  esac
done

[ -n "$VERSION" ] || die "--version must not be empty"

require_cmd() {
  command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    die "Missing required command: ${command_name}
Install Node.js 18.18+ (includes npm), then re-run this installer.
https://nodejs.org/"
  fi
}

require_cmd node
require_cmd npm

NODE_VERSION="$(node --version 2>/dev/null || true)"
NPM_VERSION="$(npm --version 2>/dev/null || true)"

if command -v npx >/dev/null 2>&1; then
  RUNNER="npx"
  RUN_CMD="npx --yes ${PACKAGE}@${VERSION} setup --dry-run"
else
  RUNNER="npm-exec"
  RUN_CMD="npm exec --yes --package=${PACKAGE}@${VERSION} -- harness setup --dry-run"
fi

printf '%s\n' \
  "Harness bootstrap installer" \
  "===========================" \
  "" \
  "Prerequisites:" \
  "  node  ${NODE_VERSION:-unknown}" \
  "  npm   ${NPM_VERSION:-unknown}" \
  "  runner ${RUNNER}" \
  "" \
  "Will run:" \
  "  ${RUN_CMD}" \
  "" \
  "Effects:" \
  "  - Downloads/runs ${PACKAGE}@${VERSION} via npm (no global install required)." \
  "  - Previews the local ecosystem plan (setup --dry-run)." \
  "  - Does NOT write agent configs or ~/.harness." \
  "  - Does NOT use sudo or modify shell profiles." \
  ""

if [ "$DRY_RUN" -eq 1 ]; then
  printf '%s\n' "Dry run: plan only. Nothing was downloaded or executed."
  exit 0
fi

printf '%s\n' "Running preview..." ""

if [ "$RUNNER" = "npx" ]; then
  npx --yes "${PACKAGE}@${VERSION}" setup --dry-run
else
  npm exec --yes --package="${PACKAGE}@${VERSION}" -- harness setup --dry-run
fi

printf '%s\n' \
  "" \
  "Bootstrap complete." \
  "Next steps:" \
  "  1. Apply the plan:  npx ${PACKAGE}@${VERSION} setup" \
  "     (or: harness setup  if the CLI is already on your PATH)" \
  "  2. Check health:    npx ${PACKAGE}@${VERSION} status" \
  "  3. Repair drift:    npx ${PACKAGE}@${VERSION} sync" \
  "" \
  "Version:" \
  "  Installed CLI:      npx ${PACKAGE} --version" \
  "  Published package:  npm view ${PACKAGE} version" \
  "  Update / converge:  npx ${PACKAGE}@latest sync"
