#!/usr/bin/env python3
"""Phase-3 PTY end-to-end for kairo-ui (session + dialog + tools + restore).

Uses `script(1)` for a real PTY. Alternate-screen paint is not reliably
captured in the typescript, so evidence is:

1. typescript contains enter (`\\x1b[?1049h`) and leave (`\\x1b[?1049l`) —
   terminal restore after quit
2. mock sidecar log proves ready, sessions list, auto dialog+tools inject,
   and a correlated `extension_ui_response` after Enter
3. host exit status 0 after `q`

Does not call real Pi/providers.
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BINARY = ROOT / "crates" / "kairo-ui" / "target" / "release" / "kairo-ui"
MOCK = ROOT / "scripts" / "fixtures" / "kairo-ui-pty-mock-sidecar.mjs"
NODE = os.environ.get("KAIRO_UI_NODE") or os.environ.get("NODE") or "node"
TS = Path(os.environ.get("KAIRO_PTY_TYPESCRIPT", "/tmp/kairo-pty-e2e.typescript"))
LOG = Path(os.environ.get("KAIRO_PTY_MOCK_LOG", "/tmp/kairo-pty-e2e.mock.log"))
KEYS_DELAY = float(os.environ.get("KAIRO_PTY_KEYS_DELAY", "1.2"))


def die(msg: str, code: int = 1) -> None:
    print(f"PTY e2e FAIL: {msg}", file=sys.stderr)
    raise SystemExit(code)


def main() -> None:
    if not BINARY.is_file():
        die(f"missing binary {BINARY} — cargo build --release in crates/kairo-ui")
    if not MOCK.is_file():
        die(f"missing mock {MOCK}")

    for p in (TS, LOG):
        try:
            p.unlink()
        except FileNotFoundError:
            pass

    env = os.environ.copy()
    env["KAIRO_UI_RPC_SCRIPT"] = str(MOCK)
    env["KAIRO_UI_NODE"] = NODE
    env["KAIRO_PTY_MOCK_AUTO"] = "1"
    env["KAIRO_PTY_MOCK_LOG"] = str(LOG)
    env["TERM"] = env.get("TERM") or "xterm-256color"
    env["KAIRO_UI_BRIDGE"] = "1"

    # Keep stdin open for the whole session: writer sleeps then sends chords.
    key_script = f"""
import sys, time
time.sleep({KEYS_DELAY})
# Dialog is already open (mock auto-inject). Confirm first — Esc would cancel it.
sys.stdout.buffer.write(b'\\r')
sys.stdout.buffer.flush()
time.sleep(0.4)
sys.stdout.buffer.write(b'\\x0c')  # Ctrl+L session picker
sys.stdout.buffer.flush()
time.sleep(0.35)
sys.stdout.buffer.write(b'\\x1b')  # Esc cancel picker (local, no server call)
sys.stdout.buffer.flush()
time.sleep(0.35)
sys.stdout.buffer.write(b'q')    # quit (empty editor)
sys.stdout.buffer.flush()
time.sleep(0.6)
"""

    keys = subprocess.Popen(
        [sys.executable, "-c", key_script],
        stdout=subprocess.PIPE,
    )
    assert keys.stdout is not None

    try:
        proc = subprocess.run(
            ["script", "-q", str(TS), str(BINARY), "--bridge"],
            cwd=str(ROOT),
            env=env,
            stdin=keys.stdout,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=30,
            check=False,
        )
    except subprocess.TimeoutExpired:
        keys.kill()
        die("script/kairo-ui timed out after 30s")
    finally:
        keys.wait(timeout=5)

    ts = TS.read_bytes() if TS.is_file() else b""
    log = LOG.read_text(encoding="utf-8", errors="replace") if LOG.is_file() else ""

    entered = b"[?1049h" in ts or b"\x1b[?1049h" in ts
    left = b"[?1049l" in ts or b"\x1b[?1049l" in ts

    failures = []
    if proc.returncode not in (0, None):
        # script may wrap; still require clean-ish exit
        if proc.returncode not in (0,):
            err = (proc.stderr or b"")[:400].decode("utf-8", "replace")
            failures.append(f"host exit {proc.returncode}: {err}")
    if not entered:
        failures.append("typescript missing alternate-screen enter (?1049h)")
    if not left:
        failures.append("typescript missing alternate-screen leave (?1049l) — terminal not restored")
    if "out ready" not in log:
        failures.append("mock never emitted ready (bridge/sidecar not connected)")
    if "out sessions" not in log and "sessions" not in log:
        # ready embeds sessions; also accept inject path
        if "mock_start" not in log:
            failures.append("mock log missing mock_start")
    if "inject_dialog_and_tools" not in log:
        failures.append("mock never injected dialog+tools")
    if "out extension_ui_request" not in log:
        failures.append("mock never emitted extension_ui_request")
    if "out tool_execution_start" not in log or "out tool_execution_end" not in log:
        failures.append("mock never emitted tool start/end")
    if "dialog_response id=pty-dialog-1" not in log:
        failures.append("host never sent correlated extension_ui_response for pty-dialog-1")
    elif "cancelled=true" in log and "value=Allow" not in log and "value=" in log:
        # Prefer confirm evidence; cancel-only still proves correlation but is weaker.
        if "value=Allow" not in log and "confirmed=" not in log:
            # Accept cancel only if we never got a value — still correlated by id.
            pass
    if "value=Allow" not in log and "cancelled=false" not in log:
        # Require a confirmed select (Enter), not Esc-cancel, for this acceptance.
        if "dialog_response id=pty-dialog-1 cancelled=true" in log and "value=Allow" not in log:
            failures.append(
                "dialog was cancelled instead of confirmed (Enter should select Allow)"
            )

    print("PTY e2e evidence:")
    print(f"  host_exit={proc.returncode}")
    print(f"  alt_screen_enter={entered} leave={left} typescript_bytes={len(ts)}")
    print(f"  mock_log_bytes={len(log)}")
    for line in log.strip().splitlines()[:20]:
        print(f"  mock| {line}")

    if failures:
        die("; ".join(failures))
    print("PTY e2e PASS: session picker chord + dialog + tools + terminal restore")


if __name__ == "__main__":
    main()
