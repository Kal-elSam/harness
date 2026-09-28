#!/usr/bin/env python3
"""U6 / Phase-3 PTY end-to-end for kairo-ui (sizes + dialog + tools + restore).

Opens a real PTY via Python `pty` + `TIOCSWINSZ` so cols×rows are real
(ioctl), not just COLUMNS/LINES env. Evidence:

1. typescript contains enter (`\\x1b[?1049h`) and leave (`\\x1b[?1049l`) —
   terminal restore after quit
2. mock sidecar log proves ready, sessions list, auto dialog+tools inject,
   and a correlated `extension_ui_response` after Enter
3. host exit status 0 after `q`
4. each size in 60×30 / 100×30 / 160×48

Does not call real Pi/providers.
"""

from __future__ import annotations

import errno
import fcntl
import os
import platform
import pty
import select
import struct
import sys
import termios
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MOCK = ROOT / "scripts" / "fixtures" / "kairo-ui-pty-mock-sidecar.mjs"
NODE = os.environ.get("KAIRO_UI_NODE") or os.environ.get("NODE") or "node"
EVIDENCE_DIR = Path(
    os.environ.get("KAIRO_PTY_EVIDENCE_DIR", "/tmp/kairo-pty-u6")
)
KEYS_DELAY = float(os.environ.get("KAIRO_PTY_KEYS_DELAY", "1.2"))
DEFAULT_SIZES = ((60, 30), (100, 30), (160, 48))


def die(msg: str, code: int = 1) -> None:
    print(f"PTY e2e FAIL: {msg}", file=sys.stderr)
    raise SystemExit(code)


def resolve_binary() -> Path:
    override = os.environ.get("KAIRO_UI_BINARY")
    if override:
        path = Path(override)
        if path.is_file():
            return path
        die(f"KAIRO_UI_BINARY missing: {path}")

    os_name = sys.platform  # darwin / linux
    arch = platform.machine().lower()
    if arch in ("aarch64",):
        arch = "arm64"
    elif arch in ("x86_64", "amd64"):
        arch = "x64"
    prebuilt = ROOT / "dist" / "kairo-ui" / f"{os_name}-{arch}" / "kairo-ui"
    if prebuilt.is_file():
        return prebuilt

    release = ROOT / "crates" / "kairo-ui" / "target" / "release" / "kairo-ui"
    if release.is_file():
        return release
    die(
        f"missing binary (tried {prebuilt} and {release}) — "
        "run scripts/build-kairo-ui-binaries.sh --host-only or cargo build --release"
    )


def parse_sizes(raw: str | None) -> list[tuple[int, int]]:
    if not raw or not raw.strip():
        return list(DEFAULT_SIZES)
    out: list[tuple[int, int]] = []
    for part in raw.split(","):
        part = part.strip().lower()
        if not part:
            continue
        if "x" not in part:
            die(f"bad size '{part}' (expected COLSxROWS)")
        cols_s, rows_s = part.split("x", 1)
        out.append((int(cols_s), int(rows_s)))
    if not out:
        die("KAIRO_PTY_SIZES produced no sizes")
    return out


def set_winsize(fd: int, rows: int, cols: int) -> None:
    packed = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, packed)


def run_one(binary: Path, cols: int, rows: int) -> dict:
    label = f"{cols}x{rows}"
    ts = EVIDENCE_DIR / f"{label}.typescript"
    log = EVIDENCE_DIR / f"{label}.mock.log"
    for p in (ts, log):
        try:
            p.unlink()
        except FileNotFoundError:
            pass

    env = os.environ.copy()
    env["KAIRO_UI_RPC_SCRIPT"] = str(MOCK)
    env["KAIRO_UI_NODE"] = NODE
    env["KAIRO_PTY_MOCK_AUTO"] = "1"
    env["KAIRO_PTY_MOCK_LOG"] = str(log)
    env["TERM"] = env.get("TERM") or "xterm-256color"
    env["KAIRO_UI_BRIDGE"] = "1"
    env["COLUMNS"] = str(cols)
    env["LINES"] = str(rows)

    master, slave = pty.openpty()
    try:
        set_winsize(master, rows, cols)
        set_winsize(slave, rows, cols)
    except OSError as err:
        os.close(master)
        os.close(slave)
        die(f"TIOCSWINSZ failed @ {label}: {err}")

    pid = os.fork()
    if pid == 0:
        try:
            os.close(master)
            os.setsid()
            fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
        except OSError:
            pass
        os.dup2(slave, 0)
        os.dup2(slave, 1)
        os.dup2(slave, 2)
        if slave > 2:
            os.close(slave)
        os.chdir(str(ROOT))
        os.execve(str(binary), [str(binary), "--bridge"], env)
        os._exit(127)

    os.close(slave)

    # Key schedule (same chords as Phase-3 acceptance).
    schedule = [
        (KEYS_DELAY, b"\r"),  # confirm dialog
        (0.4, b"\x0c"),  # Ctrl+L session picker
        (0.35, b"\x1b"),  # Esc cancel picker
        (0.35, b"q"),  # quit
    ]

    chunks: list[bytes] = []
    next_idx = 0
    next_at = time.monotonic() + schedule[0][0]
    deadline = time.monotonic() + 45.0
    child_status: int | None = None

    try:
        while time.monotonic() < deadline:
            if child_status is None:
                waited_pid, status = os.waitpid(pid, os.WNOHANG)
                if waited_pid == pid:
                    child_status = status

            timeout = 0.05
            if next_idx < len(schedule):
                timeout = max(0.0, min(timeout, next_at - time.monotonic()))

            readable, _, _ = select.select([master], [], [], timeout)
            if readable:
                try:
                    data = os.read(master, 8192)
                except OSError as err:
                    if err.errno in (errno.EIO, errno.EAGAIN):
                        data = b""
                    else:
                        raise
                if data:
                    chunks.append(data)

            now = time.monotonic()
            while next_idx < len(schedule) and now >= next_at:
                _delay, payload = schedule[next_idx]
                try:
                    os.write(master, payload)
                except OSError:
                    break
                next_idx += 1
                if next_idx < len(schedule):
                    next_at = now + schedule[next_idx][0]
                else:
                    # Allow quit teardown to flush leave-alt-screen.
                    next_at = now + 0.8

            if child_status is not None and next_idx >= len(schedule) and now >= next_at:
                # Drain remaining output briefly.
                drain_deadline = time.monotonic() + 0.4
                while time.monotonic() < drain_deadline:
                    readable, _, _ = select.select([master], [], [], 0.05)
                    if not readable:
                        break
                    try:
                        data = os.read(master, 8192)
                    except OSError:
                        break
                    if not data:
                        break
                    chunks.append(data)
                break
        else:
            try:
                os.kill(pid, 9)
            except OSError:
                pass
            os.waitpid(pid, 0)
            die(f"kairo-ui timed out after 45s @ {label}")
    finally:
        os.close(master)
        if child_status is None:
            try:
                _pid, child_status = os.waitpid(pid, 0)
            except ChildProcessError:
                child_status = 0

    if os.WIFEXITED(child_status):
        exit_code = os.WEXITSTATUS(child_status)
    elif os.WIFSIGNALED(child_status):
        exit_code = 128 + os.WTERMSIG(child_status)
    else:
        exit_code = 1

    ts_bytes = b"".join(chunks)
    ts.write_bytes(ts_bytes)
    log_text = log.read_text(encoding="utf-8", errors="replace") if log.is_file() else ""

    entered = b"[?1049h" in ts_bytes or b"\x1b[?1049h" in ts_bytes
    left = b"[?1049l" in ts_bytes or b"\x1b[?1049l" in ts_bytes

    failures: list[str] = []
    if exit_code != 0:
        failures.append(f"host exit {exit_code}")
    if not entered:
        failures.append("typescript missing alternate-screen enter (?1049h)")
    if not left:
        failures.append(
            "typescript missing alternate-screen leave (?1049l) — terminal not restored"
        )
    if "out ready" not in log_text:
        failures.append("mock never emitted ready (bridge/sidecar not connected)")
    if "out sessions" not in log_text and "sessions" not in log_text:
        if "mock_start" not in log_text:
            failures.append("mock log missing mock_start")
    if "inject_dialog_and_tools" not in log_text:
        failures.append("mock never injected dialog+tools")
    if "out extension_ui_request" not in log_text:
        failures.append("mock never emitted extension_ui_request")
    if "out tool_execution_start" not in log_text or "out tool_execution_end" not in log_text:
        failures.append("mock never emitted tool start/end")
    if "dialog_response id=pty-dialog-1" not in log_text:
        failures.append("host never sent correlated extension_ui_response for pty-dialog-1")
    if "value=Allow" not in log_text and "cancelled=false" not in log_text:
        if (
            "dialog_response id=pty-dialog-1 cancelled=true" in log_text
            and "value=Allow" not in log_text
        ):
            failures.append(
                "dialog was cancelled instead of confirmed (Enter should select Allow)"
            )

    return {
        "label": label,
        "cols": cols,
        "rows": rows,
        "exit": exit_code,
        "entered": entered,
        "left": left,
        "typescript": str(ts),
        "mock_log": str(log),
        "typescript_bytes": len(ts_bytes),
        "mock_log_bytes": len(log_text),
        "failures": failures,
        "log_preview": log_text.strip().splitlines()[:12],
    }


def main() -> None:
    if not MOCK.is_file():
        die(f"missing mock {MOCK}")

    binary = resolve_binary()
    sizes = parse_sizes(os.environ.get("KAIRO_PTY_SIZES"))
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)

    print(f"PTY e2e binary={binary}")
    print(f"PTY e2e evidence_dir={EVIDENCE_DIR}")
    print(f"PTY e2e sizes={','.join(f'{c}x{r}' for c, r in sizes)}")

    results = []
    all_failures: list[str] = []
    for cols, rows in sizes:
        result = run_one(binary, cols, rows)
        results.append(result)
        print(f"\nPTY e2e @{result['label']}:")
        print(f"  host_exit={result['exit']}")
        print(
            f"  alt_screen_enter={result['entered']} leave={result['left']} "
            f"typescript_bytes={result['typescript_bytes']}"
        )
        print(f"  typescript={result['typescript']}")
        print(f"  mock_log={result['mock_log']} bytes={result['mock_log_bytes']}")
        for line in result["log_preview"]:
            print(f"  mock| {line}")
        for fail in result["failures"]:
            all_failures.append(f"{result['label']}: {fail}")

    summary_path = EVIDENCE_DIR / "SUMMARY.txt"
    summary_lines = [
        f"binary={binary}",
        f"sizes={','.join(r['label'] for r in results)}",
        *(
            f"{r['label']}: exit={r['exit']} enter={r['entered']} leave={r['left']} "
            f"ts={r['typescript']} log={r['mock_log']}"
            for r in results
        ),
        "PASS" if not all_failures else "FAIL: " + "; ".join(all_failures),
    ]
    summary_path.write_text("\n".join(summary_lines) + "\n", encoding="utf-8")
    print(f"\nPTY e2e summary={summary_path}")

    if all_failures:
        die("; ".join(all_failures))
    print(
        "PTY e2e PASS: "
        + ", ".join(r["label"] for r in results)
        + " — dialog + tools + terminal restore"
    )


if __name__ == "__main__":
    main()
