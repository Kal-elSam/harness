#!/usr/bin/env bash
# Cockpit smoke — layout/capabilities + package wiring (no PTY required).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "Kairo cockpit smoke"
node "$ROOT/scripts/cockpit-smoke.mjs"

node --test \
  test/fullscreen-session.test.js \
  test/layout.test.js \
  test/terminal-capabilities.test.js \
  test/cockpit-models.test.js \
  test/cockpit-controller.test.js \
  test/cockpit-frame.test.js

echo "Kairo cockpit smoke passed"
