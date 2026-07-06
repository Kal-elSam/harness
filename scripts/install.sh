#!/usr/bin/env sh
# Bootstrap installer for Agentic Harness (@kal-elsam/harness).
#
# Safe by design:
#   - no sudo
#   - no shell profile changes
#   - does not install Cursor/Codex/OpenCode/Claude
#   - default ends with setup --dry-run (no writes)
#   - explicit apply: pass --yes to run setup --yes
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Kal-elSam/harness/main/scripts/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/Kal-elSam/harness/main/scripts/install.sh | sh -s -- --dry-run
#   curl -fsSL https://raw.githubusercontent.com/Kal-elSam/harness/main/scripts/install.sh | sh -s -- --yes
#   curl -fsSL https://raw.githubusercontent.com/Kal-elSam/harness/main/scripts/install.sh | sh -s -- --version 0.13.0
#   curl -fsSL https://raw.githubusercontent.com/Kal-elSam/harness/main/scripts/install.sh | sh -s -- --agents all --yes
#
set -eu

PACKAGE="@kal-elsam/harness"
VERSION="latest"
INSTALLER_DRY_RUN=0
APPLY=0
SETUP_EXTRA=""

usage() {
  printf '%s\n' \
    "Harness bootstrap installer" \
    "" \
    "Usage:" \
    "  install.sh [--dry-run] [--yes] [--version <semver|latest>]" \
    "             [--agents <list|all>] [--components <list>] [--no-default-components]" \
    "" \
    "Options:" \
    "  --dry-run              Print the plan only. Does not download or run harness." \
    "  --yes, -y              Apply setup (runs harness setup --yes)." \
    "  --version <version>    Package version to run (default: latest)." \
    "  --agents <list|all>    Passed through to harness setup." \
    "  --components <list>    Passed through to harness setup." \
    "  --no-default-components  Passed through to harness setup." \
    "  -h, --help             Show this help." \
    "" \
    "What it does:" \
    "  1. Checks for Node.js and npm." \
    "  2. Runs the package via npx (or npm exec) with setup --dry-run (default) or setup --yes (--yes)." \
    "  3. Prints next steps." \
    "" \
    "Security:" \
    "  - Never uses sudo." \
    "  - Never modifies shell profiles (.bashrc, .zshrc, etc.)." \
    "  - Never installs Cursor/Codex/OpenCode/Claude." \
    "  - Default preview only (setup --dry-run). Writes managed sections only with --yes."
}

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

append_setup_arg() {
  SETUP_EXTRA="${SETUP_EXTRA}${SETUP_EXTRA:+ }$1"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      INSTALLER_DRY_RUN=1
      shift
      ;;
    --yes|-y)
      APPLY=1
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
    --agents)
      [ "$#" -ge 2 ] || die "Missing value for --agents"
      append_setup_arg "--agents"
      append_setup_arg "$2"
      shift 2
      ;;
    --agents=*)
      append_setup_arg "$1"
      shift
      ;;
    --components)
      [ "$#" -ge 2 ] || die "Missing value for --components"
      append_setup_arg "--components"
      append_setup_arg "$2"
      shift 2
      ;;
    --components=*)
      append_setup_arg "$1"
      shift
      ;;
    --no-default-components)
      append_setup_arg "--no-default-components"
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

if [ "$APPLY" -eq 1 ]; then
  SETUP_MODE="--yes"
else
  SETUP_MODE="--dry-run"
fi

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
  RUN_CMD="npx --yes ${PACKAGE}@${VERSION} setup ${SETUP_MODE}${SETUP_EXTRA:+ ${SETUP_EXTRA}}"
else
  RUNNER="npm-exec"
  RUN_CMD="npm exec --yes --package=${PACKAGE}@${VERSION} -- harness setup ${SETUP_MODE}${SETUP_EXTRA:+ ${SETUP_EXTRA}}"
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
  "  - Configures managed sections only (never installs AI apps)." \
  "  - Never uses sudo or modifies shell profiles." \
  ""

if [ "$APPLY" -eq 1 ]; then
  printf '%s\n' \
    "  - Applies the ecosystem plan (setup --yes)." \
    "  - Writes managed agent sections and ~/.harness components." \
    ""
else
  printf '%s\n' \
    "  - Previews the local ecosystem plan (setup --dry-run)." \
    "  - Does NOT write agent configs or ~/.harness." \
    ""
fi

if [ "$INSTALLER_DRY_RUN" -eq 1 ]; then
  printf '%s\n' "Dry run: plan only. Nothing was downloaded or executed."
  exit 0
fi

if [ "$APPLY" -eq 1 ]; then
  printf '%s\n' "Applying setup..." ""
else
  printf '%s\n' "Running preview..." ""
fi

if [ "$RUNNER" = "npx" ]; then
  # shellcheck disable=SC2086
  npx --yes "${PACKAGE}@${VERSION}" setup ${SETUP_MODE} ${SETUP_EXTRA}
else
  # shellcheck disable=SC2086
  npm exec --yes --package="${PACKAGE}@${VERSION}" -- harness setup ${SETUP_MODE} ${SETUP_EXTRA}
fi

if [ "$APPLY" -eq 1 ]; then
  printf '%s\n' \
    "" \
    "Bootstrap complete (applied)." \
    "Next steps:" \
    "  1. Check health:    npx ${PACKAGE}@${VERSION} status" \
    "  2. Repair drift:    npx ${PACKAGE}@${VERSION} sync" \
    "  3. Adapter matrix:  npx ${PACKAGE}@${VERSION} adapters" \
    "" \
    "Version:" \
    "  Installed CLI:      npx ${PACKAGE} --version" \
    "  Published package:  npm view ${PACKAGE} version" \
    "  Update / converge:  npx ${PACKAGE}@latest sync"
else
  printf '%s\n' \
    "" \
    "Bootstrap complete." \
    "Next steps:" \
    "  1. Apply the plan:  npx ${PACKAGE}@${VERSION} setup --yes" \
    "     (or re-run installer: curl ... | sh -s -- --yes)" \
    "  2. Check health:    npx ${PACKAGE}@${VERSION} status" \
    "  3. Repair drift:    npx ${PACKAGE}@${VERSION} sync" \
    "" \
    "Version:" \
    "  Installed CLI:      npx ${PACKAGE} --version" \
    "  Published package:  npm view ${PACKAGE} version" \
    "  Update / converge:  npx ${PACKAGE}@latest sync"
fi
