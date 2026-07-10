#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KAIRO=(node "$ROOT/bin/kairo.js")
WORKSPACE="${SMOKE_WORKSPACE:-$ROOT}"
HOME_DIR="${HARNESS_HOME:-$(mktemp -d /tmp/kairo-runtime-smoke-XXXXXX)}"
export HARNESS_HOME="$HOME_DIR"
export HARNESS_INK=0

PROMPT_A="List the files in the current directory and summarize in one sentence."
PROMPT_B="Reply with exactly the single word OK and nothing else."
PROMPT_SECRET="SMOKE_SECRET_PROMPT_$(date +%s)_do_not_persist"
SMOKE_MODEL="${SMOKE_MODEL:-}"

MODEL_ARGS=()
if [[ -n "$SMOKE_MODEL" ]]; then
  MODEL_ARGS=(--model "$SMOKE_MODEL")
fi

log() { printf '[smoke] %s\n' "$*"; }

assert_no_prompt() {
  local dir=$1 prompt=$2
  if grep -qF "$prompt" "$dir/state.json" 2>/dev/null; then
    echo "FAIL: prompt found in state.json for $dir" >&2
    return 1
  fi
  if grep -qF "$prompt" "$dir/events.jsonl" 2>/dev/null; then
    echo "FAIL: prompt found in events.jsonl for $dir" >&2
    return 1
  fi
  if [[ -f "$dir/handoff.json" ]]; then
    echo "FAIL: handoff.json still present for $dir" >&2
    return 1
  fi
}

log "HARNESS_HOME=$HOME_DIR"
log "WORKSPACE=$WORKSPACE"
if [[ -n "$SMOKE_MODEL" ]]; then
  log "SMOKE_MODEL=$SMOKE_MODEL"
else
  log "SMOKE_MODEL=(not set — Case 2 may fail if Codex default model is incompatible)"
fi

# --- Case 1: detached run + cross-process list/show/stop ---
log "=== Case 1: --no-wait + cross-process supervision ==="
START_A=$(python3 -c 'import time; print(int(time.time()*1000))')
OUT_A=$("${KAIRO[@]}" run --agent codex --task "$PROMPT_A" --cwd "$WORKSPACE" "${MODEL_ARGS[@]}" --no-wait 2>&1)
END_A=$(python3 -c 'import time; print(int(time.time()*1000))')
DUR_A=$((END_A - START_A))

RUN_ID=$(printf '%s\n' "$OUT_A" | sed -n 's/.*\(run_[a-z0-9_]*\).*/\1/p' | head -1)
if [[ -z "$RUN_ID" ]]; then
  echo "FAIL: could not parse runId from output:" >&2
  echo "$OUT_A" >&2
  exit 1
fi

log "Case 1 runId=$RUN_ID parent_return_ms=$DUR_A"
if (( DUR_A > 5000 )); then
  echo "FAIL: --no-wait took ${DUR_A}ms (>5000ms)" >&2
  exit 1
fi

sleep 1
LIST_B=$("${KAIRO[@]}" runs list --cwd "$WORKSPACE" 2>&1)
if printf '%s\n' "$LIST_B" | grep -q interrupted; then
  echo "FAIL: runs list shows interrupted" >&2
  echo "$LIST_B" >&2
  exit 1
fi
if ! printf '%s\n' "$LIST_B" | grep -q "$RUN_ID"; then
  echo "FAIL: run not listed" >&2
  echo "$LIST_B" >&2
  exit 1
fi
if ! printf '%s\n' "$LIST_B" | grep -Eq "running|starting"; then
  echo "FAIL: run not active in list" >&2
  echo "$LIST_B" >&2
  exit 1
fi

SHOW_B=$("${KAIRO[@]}" runs show "$RUN_ID" --cwd "$WORKSPACE" 2>&1)
if printf '%s\n' "$SHOW_B" | grep -q interrupted; then
  echo "FAIL: runs show reports interrupted" >&2
  echo "$SHOW_B" >&2
  exit 1
fi

START_STOP=$(python3 -c 'import time; print(int(time.time()*1000))')
STOP_B=$("${KAIRO[@]}" runs stop "$RUN_ID" --cwd "$WORKSPACE" 2>&1)
END_STOP=$(python3 -c 'import time; print(int(time.time()*1000))')
DUR_STOP=$((END_STOP - START_STOP))

sleep 1
FINAL_A=$("${KAIRO[@]}" runs show "$RUN_ID" --json --cwd "$WORKSPACE")
STATE_A=$(printf '%s\n' "$FINAL_A" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);console.log(j.metadata.state)})')
if [[ "$STATE_A" != "cancelled" ]]; then
  echo "FAIL: expected cancelled, got $STATE_A" >&2
  exit 1
fi

RUN_DIR_A="$HOME_DIR/.harness/runs/$RUN_ID"
assert_no_prompt "$RUN_DIR_A" "$PROMPT_A"
log "Case 1 PASS state=$STATE_A stop_ms=$DUR_STOP"

# --- Case 2: normal completion (must be completed) ---
log "=== Case 2: wait for normal completion ==="
START_B=$(python3 -c 'import time; print(int(time.time()*1000))')
OUT_B=$("${KAIRO[@]}" run --agent codex --task "$PROMPT_B" --cwd "$WORKSPACE" --permissions yolo "${MODEL_ARGS[@]}" 2>&1)
END_B=$(python3 -c 'import time; print(int(time.time()*1000))')
DUR_B=$((END_B - START_B))

RUN_ID_B=$(printf '%s\n' "$OUT_B" | sed -n 's/.*\(run_[a-z0-9_]*\).*/\1/p' | head -1)
FINAL_B=$("${KAIRO[@]}" runs show "$RUN_ID_B" --json --cwd "$WORKSPACE")
STATE_B=$(printf '%s\n' "$FINAL_B" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);console.log(j.metadata.state)})')

if [[ "$STATE_B" != "completed" ]]; then
  echo "FAIL: expected completed, got $STATE_B" >&2
  echo "$OUT_B" >&2
  if [[ -z "$SMOKE_MODEL" ]]; then
    echo "Hint: set SMOKE_MODEL to a Codex model compatible with your account/CLI version." >&2
  fi
  exit 1
fi

RUN_DIR_B="$HOME_DIR/.harness/runs/$RUN_ID_B"
assert_no_prompt "$RUN_DIR_B" "$PROMPT_B"
log "Case 2 PASS runId=$RUN_ID_B state=$STATE_B duration_ms=$DUR_B"

# --- Case 3: privacy spot-check with unique secret prompt ---
log "=== Case 3: privacy secret prompt ==="
START_C=$(python3 -c 'import time; print(int(time.time()*1000))')
OUT_C=$("${KAIRO[@]}" run --agent codex --task "$PROMPT_SECRET" --cwd "$WORKSPACE" --permissions yolo "${MODEL_ARGS[@]}" --no-wait 2>&1)
RUN_ID_C=$(printf '%s\n' "$OUT_C" | sed -n 's/.*\(run_[a-z0-9_]*\).*/\1/p' | head -1)
sleep 2
"${KAIRO[@]}" runs stop "$RUN_ID_C" --cwd "$WORKSPACE" >/dev/null 2>&1 || true
sleep 1
RUN_DIR_C="$HOME_DIR/.harness/runs/$RUN_ID_C"
assert_no_prompt "$RUN_DIR_C" "$PROMPT_SECRET"
END_C=$(python3 -c 'import time; print(int(time.time()*1000))')
DUR_C=$((END_C - START_C))
log "Case 3 PASS runId=$RUN_ID_C duration_ms=$DUR_C"

printf '\n=== SMOKE SUMMARY ===\n'
printf 'Case 1 (detach+stop): runId=%s state=%s parent_ms=%s stop_ms=%s\n' "$RUN_ID" "$STATE_A" "$DUR_A" "$DUR_STOP"
printf 'Case 2 (complete):    runId=%s state=%s duration_ms=%s model=%s\n' "$RUN_ID_B" "$STATE_B" "$DUR_B" "${SMOKE_MODEL:-default}"
printf 'Case 3 (privacy):     runId=%s duration_ms=%s\n' "$RUN_ID_C" "$DUR_C"
printf 'HARNESS_HOME=%s\n' "$HOME_DIR"
printf 'ALL PASS\n'
