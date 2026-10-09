#!/usr/bin/env bash
# Prepare isolated packaged-host no_model check + V3 visual captures for human acceptance.
# No credentials. No network. No push/publish.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

EVIDENCE="${KAIRO_ACCEPTANCE_EVIDENCE_DIR:-/tmp/kairo-acceptance-$(date -u +%Y%m%dT%H%M%SZ)}"
BIN="${KAIRO_UI_BINARY:-$ROOT/dist/kairo-ui/darwin-arm64/kairo-ui}"
mkdir -p "$EVIDENCE/packaged-no-model" "$EVIDENCE/v3-visual"

if [[ ! -x "$BIN" ]]; then
  echo "missing prebuilt: $BIN — run scripts/build-kairo-ui-binaries.sh first" >&2
  exit 2
fi

echo "== packaged no_model PTY (SIMULATED Pi by default) =="
export KAIRO_UI_BINARY="$BIN"
export KAIRO_PTY_EVIDENCE_DIR="$EVIDENCE/packaged-no-model"
# Scrub common credential env for this process tree.
unset ANTHROPIC_API_KEY OPENAI_API_KEY CURSOR_API_KEY OPENCODE_API_KEY \
  CLAUDE_API_KEY CODEX_API_KEY GOOGLE_API_KEY GEMINI_API_KEY 2>/dev/null || true
if [[ "${KAIRO_PACKAGED_NO_MODEL_REAL_PI:-}" == "1" ]]; then
  echo "REAL Pi mode requested — will FAIL (not fall back) if published CLI missing."
  export KAIRO_PACKAGED_NO_MODEL_REAL_PI=1
  export KAIRO_PTY_EVIDENCE_DIR="$EVIDENCE/packaged-no-model-real-pi"
  mkdir -p "$KAIRO_PTY_EVIDENCE_DIR"
fi
python3 "$ROOT/scripts/kairo-ui-packaged-no-model-pty-e2e.py"

echo "== v3-capture for human visual acceptance =="
NOCARGO_PATH="/usr/bin:/bin:/usr/sbin:/sbin"
# Prefer node from PATH for nothing here — binary only.
PATH="$NOCARGO_PATH" "$BIN" --v3-capture "$EVIDENCE/v3-visual" | tee "$EVIDENCE/v3-capture.log"
COUNT="$(find "$EVIDENCE/v3-visual" -type f | wc -l | tr -d ' ')"
echo "v3 files: $COUNT"

cat >"$EVIDENCE/ACCEPTANCE.md" <<EOF
# Kairo acceptance pack

Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)
Binary: \`$BIN\`
HEAD: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)

## 1. Packaged host — no_model

### Default (already run): SIMULATED Pi
Path: \`packaged-no-model/\`
- Prebuilt \`kairo-ui\` + real classifier + **simulated** Pi placeholder child.
- Labels integration wiring only — **does not certify** published Pi.

### Real published Pi (offline) — needs authorization
Command (after explicit auth):
\`KAIRO_PACKAGED_NO_MODEL_REAL_PI=1 pnpm smoke:kairo-packaged-no-model\`
- Temp HOME / HARNESS_HOME / PI_CODING_AGENT_DIR; \`--offline\`; no credentials.
- If published CLI missing → **fail** (exit 2); no silent simulation fallback.

## 2. V3 visual fixtures (human approval)

Path: \`v3-visual/\`

- Auto-generated screens at 60×30 / 100×30 / 160×48 (conversation, tools, plans,
  dialog, error) plus Ops/Settings @60.
- Labeled **FIXTURE mock — not live provider**.
- Open the \`.html\` (or \`.txt\`) files and mark accept / reject per screen.
- These do **not** auto-approve the product.

## Still out of scope here

- Real provider ASK runs (need per-provider authorization).
- Foreign-platform package runtime exec (darwin-x64 / linux).
- Native review U3 consent (U1/U2 declined).
EOF

echo
echo "Acceptance pack ready: $EVIDENCE"
echo "Start with: $EVIDENCE/ACCEPTANCE.md"
