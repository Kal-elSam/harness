#!/usr/bin/env sh
# Bootstrap installer for Kairo Runtime (@kal-elsam/kairo-runtime).
#
# Safe by design:
#   - no sudo
#   - no shell profile changes
#   - does not install Cursor/Codex/OpenCode/Claude/Pi
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

PACKAGE="@kal-elsam/kairo-runtime"
PREFERRED_CLI="kairo"
VERSION="latest"
INSTALLER_DRY_RUN=0
APPLY=0
SETUP_EXTRA=""

usage() {
  printf '%s\n' \
    "Kairo Runtime bootstrap installer" \
    "" \
    "Usage:" \
    "  install.sh [--dry-run] [--yes] [--version <semver|latest>]" \
    "             [--agents <list|all>] [--components <list>] [--no-default-components]" \
    "" \
    "Options:" \
    "  --dry-run              Print the plan only. Does not download or run kairo." \
    "  --yes, -y              Apply setup (runs kairo setup --yes)." \
    "  --version <version>    Package version to run (default: latest)." \
    "  --agents <list|all>    Passed through to kairo setup." \
    "  --components <list>    Passed through to kairo setup." \
    "  --no-default-components  Passed through to kairo setup." \
    "  -h, --help             Show this help." \
    "" \
    "What it does:" \
    "  1. Checks for Node.js and npm." \
    "  2. Installs ${PACKAGE} globally (adds kairo to npm global bin)." \
    "  3. Runs kairo setup --dry-run (default) or kairo setup --yes (--yes)." \
    "  4. Prints next steps." \
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

resolve_global_spec() {
  if [ "$VERSION" = "latest" ]; then
    printf '%s@latest' "$PACKAGE"
  else
    printf '%s@%s' "$PACKAGE" "$VERSION"
  fi
}

resolve_npm_global_bin() {
  npm_prefix="$(npm prefix -g 2>/dev/null || true)"
  [ -n "$npm_prefix" ] || return 1
  printf '%s/bin' "$(printf '%s' "$npm_prefix" | sed 's#/*$##')"
}

resolve_kairo_bin() {
  if command -v "$PREFERRED_CLI" >/dev/null 2>&1; then
    command -v "$PREFERRED_CLI"
    return 0
  fi

  global_bin="$(resolve_npm_global_bin || true)"
  if [ -n "$global_bin" ] && [ -x "${global_bin}/${PREFERRED_CLI}" ]; then
    printf '%s\n' "${global_bin}/${PREFERRED_CLI}"
    return 0
  fi

  return 1
}

print_path_hint_if_needed() {
  if command -v "$PREFERRED_CLI" >/dev/null 2>&1; then
    return 0
  fi

  global_bin="$(resolve_npm_global_bin || true)"
  if [ -n "$global_bin" ]; then
    printf '%s\n' \
      "" \
      "PATH note:" \
      "  ${PREFERRED_CLI} was installed to ${global_bin}." \
      "  Add it to PATH if the command is not found:" \
      "    export PATH=\"${global_bin}:\$PATH\""
  fi
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
Install Node.js 20.12+ (includes npm), then re-run this installer.
https://nodejs.org/"
  fi
}

require_cmd node
require_cmd npm

NODE_VERSION="$(node --version 2>/dev/null || true)"
NPM_VERSION="$(npm --version 2>/dev/null || true)"
GLOBAL_SPEC="$(resolve_global_spec)"
GLOBAL_INSTALL_CMD="npm install -g --force ${GLOBAL_SPEC}"
SETUP_CMD="${PREFERRED_CLI} setup ${SETUP_MODE}${SETUP_EXTRA:+ ${SETUP_EXTRA}}"

printf '%s\n' \
  "Kairo Runtime bootstrap installer" \
  "================================" \
  "" \
  "Prerequisites:" \
  "  node  ${NODE_VERSION:-unknown}" \
  "  npm   ${NPM_VERSION:-unknown}" \
  "" \
  "Will run:" \
  "  ${GLOBAL_INSTALL_CMD}" \
  "  ${SETUP_CMD}" \
  "" \
  "Effects:" \
  "  - Installs ${GLOBAL_SPEC} globally (kairo CLI in npm global bin)." \
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

printf '%s\n' "Installing global CLI..." ""
# shellcheck disable=SC2086
npm install -g --force ${GLOBAL_SPEC}

KAIRO_BIN="$(resolve_kairo_bin || true)"
if [ -z "$KAIRO_BIN" ]; then
  die "Installed ${GLOBAL_SPEC}, but ${PREFERRED_CLI} is not available.
Check npm global bin: $(resolve_npm_global_bin || echo unknown)
Add it to PATH, then re-run: ${SETUP_CMD}"
fi

if [ "$APPLY" -eq 1 ]; then
  printf '%s\n' "Applying setup..." ""
else
  printf '%s\n' "Running preview..." ""
fi

# shellcheck disable=SC2086
"$KAIRO_BIN" setup ${SETUP_MODE} ${SETUP_EXTRA}

if [ "$APPLY" -eq 1 ]; then
  printf '%s\n' \
    "" \
    "Bootstrap complete (applied)." \
    "Next steps:" \
    "  1. Check health:    ${PREFERRED_CLI} status" \
    "  2. Repair drift:    ${PREFERRED_CLI} sync" \
    "  3. Upgrade latest:  ${PREFERRED_CLI} upgrade --dry-run" \
    "" \
    "Version:" \
    "  Installed CLI:      ${PREFERRED_CLI} --version" \
    "  Published package:  npm view ${PACKAGE} version"
  print_path_hint_if_needed
else
  printf '%s\n' \
    "" \
    "Bootstrap complete." \
    "Next steps:" \
    "  1. Apply the plan:  ${PREFERRED_CLI} setup --yes" \
    "     (or re-run installer: curl ... | sh -s -- --yes)" \
    "  2. Check health:    ${PREFERRED_CLI} status" \
    "  3. Repair drift:    ${PREFERRED_CLI} sync" \
    "" \
    "Version:" \
    "  Installed CLI:      ${PREFERRED_CLI} --version" \
    "  Published package:  npm view ${PACKAGE} version" \
    "  Update / converge:  ${PREFERRED_CLI} sync"
  print_path_hint_if_needed
fi
