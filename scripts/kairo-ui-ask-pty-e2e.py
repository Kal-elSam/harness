#!/usr/bin/env python3
"""PTY end-to-end for the ASK path of kairo-ui (task A5, ask-real-progress-and-cancel).

Drives the REAL chain in a real PTY (TIOCSWINSZ sizes):

    Rust `kairo-ui` -> real kairo-ui-rpc-stdio.js (via the wrapper
    scripts/fixtures/kairo-ui-ask-e2e-sidecar.mjs) -> real conversation
    service submitTask/askQuestion -> real askProvider (quick-ask.js)
    -> FAKE provider script (scripts/fixtures/kairo-ui-ask-e2e-fake-provider.mjs)

Scenarios (each at every requested size):
  progress  real progress rows, then the answer exactly once, terminal restored
  cancel    Esc kills the provider child AND grandchild (also a SIGTERM-ignoring
            one), a "Cancelled" row shows, no answer, UI stays responsive
  switch    a session switch (Ctrl+N new session, Ctrl+L picker switch) during an
            ASK cancels it: children dead, nothing from the old turn leaks into
            the new session
  quit      quitting (Ctrl+C) during an ASK leaves no orphan process, exit 0
  restore   after a completed + a cancelled turn, relaunching the same session
            replays the same visible sequence (each item exactly once, in order)
  collide   a tool id reused by two ASK turns yields two independent Tool rows

NOT proven here: real provider CLIs (none is invoked), the Codex `--json`
schema (the fake emits the shape mapCodexEvent expects), Pi itself (fake bridge).
No network. All state lives in a temp dir; HOME/HARNESS_HOME point into it.

Env: KAIRO_UI_BINARY, KAIRO_PTY_SIZES ("60x30,100x30,160x48"),
     KAIRO_ASK_PTY_SCENARIOS (default: all of progress,cancel,switch,quit,
     restore,collide),
     KAIRO_ASK_PTY_KEEP=1 to keep the temp dirs, KAIRO_PTY_EVIDENCE_DIR.
"""

from __future__ import annotations

import sys

sys.dont_write_bytecode = True  # loading the sibling script via importlib must not leave __pycache__

import codecs
import errno
import fcntl
import importlib.util
import json
import os
import pty
import re
import select
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import time
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SIDECAR = ROOT / "scripts" / "fixtures" / "kairo-ui-ask-e2e-sidecar.mjs"
NODE = os.environ.get("KAIRO_UI_NODE") or os.environ.get("NODE") or "node"
EVIDENCE_DIR = Path(os.environ.get("KAIRO_PTY_EVIDENCE_DIR", "/tmp/kairo-pty-ask"))
SESSION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
ANSWER = "ZEBRA-ANSWER-"
ALL_SCENARIOS = ("progress", "cancel", "switch", "quit", "restore", "collide")
# Regression notes for the two scenarios that once exposed product defects
# (both fixed; kept in the default set):
#   quit    : the host used to SIGKILL the sidecar right after writing `stop`, so
#             cancelActiveAsk never ran and the detached provider tree was
#             orphaned; it now waits (bounded) for the sidecar to exit first.
#   collide : a tool id reused by a later turn used to rewrite the earlier
#             turn's Tool row; provider tool lookup is now scoped per turn.
DEFAULT_SCENARIOS = ("progress", "cancel", "switch", "quit", "restore", "collide")


def _load_base():
    spec = importlib.util.spec_from_file_location("kairo_pty_base", ROOT / "scripts" / "kairo-ui-pty-e2e.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


BASE = _load_base()


# --------------------------------------------------------------------------
# Minimal VT screen (no third-party deps): enough for ratatui/crossterm output.
# --------------------------------------------------------------------------
class Screen:
    def __init__(self, rows: int, cols: int):
        self.rows, self.cols = rows, cols
        self.grid = [[" "] * cols for _ in range(rows)]
        self.r = self.c = 0
        self.dec = codecs.getincrementaldecoder("utf-8")(errors="replace")
        self.state = "text"
        self.buf = ""
        self.events: list[str] = []  # alt_on alt_off cur_show cur_hide

    def _width(self, ch: str) -> int:
        if unicodedata.combining(ch):
            return 0
        return 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1

    def _put(self, ch: str):
        w = self._width(ch)
        if w == 0:
            return
        if self.c + w > self.cols:
            self.c = 0
            self._lf()
        if 0 <= self.r < self.rows:
            self.grid[self.r][self.c] = ch
            if w == 2 and self.c + 1 < self.cols:
                self.grid[self.r][self.c + 1] = ""
        self.c += w

    def _lf(self):
        if self.r + 1 >= self.rows:
            self.grid.pop(0)
            self.grid.append([" "] * self.cols)
        else:
            self.r += 1

    def _clear(self):
        self.grid = [[" "] * self.cols for _ in range(self.rows)]

    def _csi(self, params: str, final: str):
        private = params.startswith("?")
        nums = [int(x) if x.isdigit() else 0 for x in params.lstrip("?>=<").split(";")] if params.lstrip("?>=<") else []
        n = lambda i, d: (nums[i] if i < len(nums) and nums[i] > 0 else d)  # noqa: E731
        if private and final in "hl":
            for code in nums:
                if code == 1049:
                    self.events.append("alt_on" if final == "h" else "alt_off")
                    if final == "h":
                        self._clear()
                        self.r = self.c = 0
                elif code == 25:
                    self.events.append("cur_show" if final == "h" else "cur_hide")
            return
        if params.startswith((">", "<", "=")) or private:
            return
        if final in "Hf":
            self.r = min(self.rows - 1, n(0, 1) - 1)
            self.c = min(self.cols - 1, n(1, 1) - 1)
        elif final == "A":
            self.r = max(0, self.r - n(0, 1))
        elif final == "B":
            self.r = min(self.rows - 1, self.r + n(0, 1))
        elif final == "C":
            self.c = min(self.cols - 1, self.c + n(0, 1))
        elif final == "D":
            self.c = max(0, self.c - n(0, 1))
        elif final == "G":
            self.c = min(self.cols - 1, n(0, 1) - 1)
        elif final == "d":
            self.r = min(self.rows - 1, n(0, 1) - 1)
        elif final == "J":
            mode = nums[0] if nums else 0
            if mode == 2 or mode == 3:
                self._clear()
            elif mode == 0:
                for cc in range(self.c, self.cols):
                    self.grid[self.r][cc] = " "
                for rr in range(self.r + 1, self.rows):
                    self.grid[rr] = [" "] * self.cols
            elif mode == 1:
                for cc in range(0, self.c + 1):
                    self.grid[self.r][cc] = " "
                for rr in range(0, self.r):
                    self.grid[rr] = [" "] * self.cols
        elif final == "K":
            mode = nums[0] if nums else 0
            rng = range(self.c, self.cols) if mode == 0 else range(0, self.c + 1) if mode == 1 else range(self.cols)
            for cc in rng:
                self.grid[self.r][cc] = " "
        elif final == "X":
            for cc in range(self.c, min(self.cols, self.c + n(0, 1))):
                self.grid[self.r][cc] = " "

    def feed(self, data: bytes):
        for ch in self.dec.decode(data):
            if self.state == "text":
                if ch == "\x1b":
                    self.state = "esc"
                elif ch == "\r":
                    self.c = 0
                elif ch == "\n":
                    self._lf()
                elif ch == "\b":
                    self.c = max(0, self.c - 1)
                elif ch == "\t":
                    self.c = min(self.cols - 1, (self.c // 8 + 1) * 8)
                elif ch >= " " and ch != "\x7f":
                    self._put(ch)
            elif self.state == "esc":
                if ch == "[":
                    self.state, self.buf = "csi", ""
                elif ch == "]":
                    self.state = "osc"
                elif ch in "()":
                    self.state = "skip1"
                else:
                    self.state = "text"
            elif self.state == "skip1":
                self.state = "text"
            elif self.state == "osc":
                if ch == "\x07":
                    self.state = "text"
                elif ch == "\x1b":
                    self.state = "osc_esc"
            elif self.state == "osc_esc":
                self.state = "text"
            elif self.state == "csi":
                if "@" <= ch <= "~":
                    self._csi(self.buf, ch)
                    self.state = "text"
                else:
                    self.buf += ch

    def lines(self) -> list[str]:
        return ["".join(row).rstrip() for row in self.grid]

    def text(self) -> str:
        return "\n".join(self.lines())


# --------------------------------------------------------------------------
# PTY session
# --------------------------------------------------------------------------
class Pty:
    def __init__(self, binary: Path, cols: int, rows: int, env: dict, cwd: Path):
        self.screen = Screen(rows, cols)
        self.raw = bytearray()
        master, slave = pty.openpty()
        BASE.set_winsize(master, rows, cols)
        BASE.set_winsize(slave, rows, cols)
        self.pid = os.fork()
        if self.pid == 0:
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
            os.chdir(str(cwd))
            os.execve(str(binary), [str(binary), "--bridge"], env)
            os._exit(127)
        os.close(slave)
        self.master = master
        self.status: int | None = None

    def pump(self, dur: float = 0.05):
        end = time.monotonic() + dur
        while True:
            left = max(0.0, end - time.monotonic())
            r, _, _ = select.select([self.master], [], [], left)
            if not r:
                break
            try:
                data = os.read(self.master, 65536)
            except OSError as err:
                if err.errno in (errno.EIO, errno.EAGAIN):
                    data = b""
                else:
                    raise
            if not data:
                break
            self.raw += data
            self.screen.feed(data)
            if time.monotonic() >= end:
                break
        self._reap()

    def _reap(self):
        if self.status is None:
            try:
                pid, st = os.waitpid(self.pid, os.WNOHANG)
            except ChildProcessError:
                self.status = 0
                return
            if pid == self.pid:
                self.status = st

    def send(self, payload: bytes):
        os.write(self.master, payload)

    def type_text(self, text: str):
        for ch in text:
            self.send(ch.encode())
            self.pump(0.01)

    def wait_for(self, pred, timeout: float) -> bool:
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            self.pump(0.05)
            if pred():
                return True
        return pred()

    def wait_exit(self, timeout: float) -> int | None:
        end = time.monotonic() + timeout
        while time.monotonic() < end and self.status is None:
            self.pump(0.05)
        if self.status is None:
            return None
        self.pump(0.3)
        if os.WIFEXITED(self.status):
            return os.WEXITSTATUS(self.status)
        if os.WIFSIGNALED(self.status):
            return 128 + os.WTERMSIG(self.status)
        return 1

    def _close_master(self):
        if getattr(self, "_master_closed", False):
            return
        self._master_closed = True
        try:
            os.close(self.master)
        except OSError:
            pass

    def kill(self, reap_timeout: float = 10.0):
        """SIGKILL the child and reap it, never blocking forever.

        The master is closed BEFORE waiting: on macOS a child that exits with unread output on its
        tty can sit in exit until the master is drained or closed, so a blocking waitpid() ahead of
        the close deadlocked the packaged verify on macos-15-intel. The reap polls with WNOHANG up to
        `reap_timeout` and then gives up with a warning instead of hanging the whole run.
        """
        if self.status is None:
            try:
                os.kill(self.pid, signal.SIGKILL)
            except (OSError, ChildProcessError):
                pass
            self._close_master()
            deadline = time.monotonic() + reap_timeout
            reaped = False
            while True:
                try:
                    pid, _ = os.waitpid(self.pid, os.WNOHANG)
                except ChildProcessError:
                    reaped = True
                    break
                except OSError:
                    break
                if pid == self.pid:
                    reaped = True
                    break
                if time.monotonic() >= deadline:
                    break
                time.sleep(0.02)
            if not reaped:
                print(f"warning: child pid={self.pid} was not reaped within {reap_timeout:.0f}s after SIGKILL", file=sys.stderr, flush=True)
            self.status = -1
        self._close_master()

    def text(self) -> str:
        return self.screen.text()

    def count(self, needle: str) -> int:
        return self.text().count(needle)


# --------------------------------------------------------------------------
# Scenario plumbing
# --------------------------------------------------------------------------
class Run:
    """One scenario at one size: temp dirs, launches, recorded checks."""

    def __init__(self, name: str, cols: int, rows: int, binary: Path):
        self.name, self.cols, self.rows, self.binary = name, cols, rows, binary
        self.base = Path(tempfile.mkdtemp(prefix="kairo-ask-e2e-")).resolve()
        self.home = self.base / "home"
        self.state = self.base / "state"
        self.proj = self.base / "proj"
        for d in (self.home, self.state, self.proj):
            d.mkdir(parents=True)
        self.checks: list[tuple[str, bool, str]] = []
        self.ptys: list[Pty] = []
        self.label = f"{name}@{cols}x{rows}"
        self.notes: list[str] = []
        self.tool_ids = ""

    def check(self, name: str, ok: bool, detail: str = ""):
        self.checks.append((name, bool(ok), detail))

    def env(self) -> dict:
        return {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "HOME": str(self.home),
            "HARNESS_HOME": str(self.home),
            "LANG": "en_US.UTF-8",
            "TERM": "xterm-256color",
            "COLUMNS": str(self.cols),
            "LINES": str(self.rows),
            "KAIRO_UI_BRIDGE": "1",
            "KAIRO_UI_RPC_SCRIPT": str(SIDECAR),
            "KAIRO_UI_NODE": NODE,
            "KAIRO_ASK_E2E_DIR": str(self.state),
            "KAIRO_SESSION_ID": SESSION_A,
            **({"KAIRO_ASK_E2E_TOOL_IDS": self.tool_ids} if self.tool_ids else {}),
        }

    def launch(self) -> Pty:
        marker = self.state / "sidecar.log"
        before = marker.read_text(errors="replace").count('out {"type":"ready"') if marker.exists() else 0
        p = Pty(self.binary, self.cols, self.rows, self.env(), self.proj)
        self.ptys.append(p)

        def ready() -> bool:
            if not marker.exists():
                return False
            return marker.read_text(errors="replace").count('out {"type":"ready"') > before

        ok = p.wait_for(ready, 20.0)
        self.check("sidecar ready", ok)
        p.pump(1.0)
        return p

    # ---- sidecar log helpers ----
    def log_lines(self) -> list[str]:
        f = self.state / "sidecar.log"
        return f.read_text(errors="replace").splitlines() if f.exists() else []

    def records(self) -> list[tuple[int, dict]]:
        out = []
        for i, line in enumerate(self.log_lines()):
            if line.startswith("out {"):
                try:
                    out.append((i, json.loads(line[4:])))
                except ValueError:
                    pass
        return out

    def ops(self) -> list[tuple[int, str]]:
        out = []
        for i, line in enumerate(self.log_lines()):
            if line.startswith("in {"):
                m = re.search(r'"op":\s*"([a-z_.]+)"', line)
                if m:
                    out.append((i, m.group(1)))
        return out

    def pids(self) -> dict[str, list[int]]:
        f = self.state / "pids.log"
        got: dict[str, list[int]] = {"child": [], "grandchild": []}
        if f.exists():
            for line in f.read_text(errors="replace").splitlines():
                m = re.match(r"(child|grandchild) (\d+)", line)
                if m and int(m.group(2)) not in got[m.group(1)]:
                    got[m.group(1)].append(int(m.group(2)))
        return got

    def pid_log(self) -> str:
        f = self.state / "pids.log"
        return f.read_text(errors="replace") if f.exists() else ""

    def wait_tree(self, want_grandchild: bool, timeout: float, p: Pty, count: int = 1) -> bool:
        def up() -> bool:
            d = self.pids()
            return len(d["child"]) >= count and (not want_grandchild or len(d["grandchild"]) >= count)

        return p.wait_for(up, timeout)

    def strays(self) -> list[str]:
        return find_strays(str(self.state))

    def close(self):
        for p in self.ptys:
            p.kill()
        # kill leftover fake processes for this run, then remove the temp dir
        for line in find_strays(str(self.state)):
            try:
                os.kill(int(line.split()[0]), signal.SIGKILL)
            except (OSError, ValueError):
                pass
        if not os.environ.get("KAIRO_ASK_PTY_KEEP"):
            shutil.rmtree(self.base, ignore_errors=True)


def find_strays(state_dir: str) -> list[str]:
    out = subprocess.run(["ps", "-axo", "pid=,stat=,command="], capture_output=True, text=True).stdout
    needle = f"--kairo-ask-e2e-marker={state_dir}"
    hits = []
    for line in out.splitlines():
        parts = line.split(None, 2)
        if len(parts) == 3 and needle in parts[2] and not parts[1].startswith("Z"):
            hits.append(line.strip())
    return hits


def alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    st = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
    return bool(st) and not st.startswith("Z")


def wait_dead(pids: list[int], timeout: float, p: Pty | None = None) -> bool:
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if not any(alive(x) for x in pids):
            return True
        if p is not None:
            p.pump(0.1)
        else:
            time.sleep(0.1)
    return not any(alive(x) for x in pids)


def terminal_restored(run: Run, p: Pty, exit_code: int | None, label: str = ""):
    ev = p.screen.events
    run.check(f"{label}exit 0", exit_code == 0, f"exit={exit_code}")
    run.check(f"{label}alt-screen entered", "alt_on" in ev)
    run.check(f"{label}alt-screen left (?1049l) last", "alt_off" in ev and ev.index("alt_off") >= 0 and "alt_on" in ev and len(ev) - 1 - ev[::-1].index("alt_off") > len(ev) - 1 - ev[::-1].index("alt_on"))
    last_hide = len(ev) - 1 - ev[::-1].index("cur_hide") if "cur_hide" in ev else -1
    last_show = len(ev) - 1 - ev[::-1].index("cur_show") if "cur_show" in ev else -1
    run.check(f"{label}cursor visible at exit", last_show > last_hide, f"hide@{last_hide} show@{last_show}")


def ask(p: Pty, text: str):
    p.type_text(text)
    p.pump(0.15)
    p.send(b"\r")


def answer_of(q: str) -> str:
    return f"{ANSWER}{q}"


def order_ok(text: str, needles: list[str]) -> tuple[bool, str]:
    pos = []
    for n in needles:
        idx = [i for i, line in enumerate(text.splitlines()) if n in line]
        pos.append(idx)
    detail = " ".join(f"{n!r}@{i}" for n, i in zip(needles, pos))
    if any(len(i) != 1 for i in pos):
        return False, detail
    flat = [i[0] for i in pos]
    return flat == sorted(flat) and len(set(flat)) == len(flat), detail


# --------------------------------------------------------------------------
# Scenarios
# --------------------------------------------------------------------------
def sc_progress(run: Run):
    p = run.launch()
    ask(p, "hello Q1")
    t0 = time.monotonic()
    seen_progress = p.wait_for(lambda: "Inspecting the repository layout" in p.text(), 15.0)
    t_prog = time.monotonic() - t0
    run.check("incremental progress row visible", seen_progress, f"after {t_prog:.1f}s")
    answered_before_progress = answer_of("Q1") in p.text() and not seen_progress
    seen_answer = p.wait_for(lambda: answer_of("Q1") in p.text(), 20.0)
    t_ans = time.monotonic() - t0
    run.check("progress appeared before the answer", seen_progress and t_prog < t_ans and not answered_before_progress, f"progress {t_prog:.1f}s < answer {t_ans:.1f}s")
    run.check("tool row visible", "ls -la" in p.text())
    p.pump(1.5)
    run.check("answer rendered exactly once on screen", p.count(answer_of("Q1")) == 1, f"count={p.count(answer_of('Q1'))}")
    run.check("progress row removed after the turn", "Inspecting the repository layout" not in p.text())
    recs = [r for _, r in run.records()]
    ans = [r for r in recs if r.get("type") == "task_result" and r.get("kind") == "answer"]
    run.check("sidecar emitted one task_result answer", len(ans) == 1, f"n={len(ans)}")
    terminals = [r for r in recs if r.get("type") == "provider_event" and r.get("kind") in ("done", "cancelled", "failed")]
    run.check("sidecar emitted exactly one terminal provider_event (done)", len(terminals) == 1 and terminals[0]["kind"] == "done", str([t.get("kind") for t in terminals]))
    notices = [r for r in recs if r.get("type") == "notice" and answer_of("Q1") in str(r.get("message"))]
    run.check("no duplicate notice carrying the answer", not notices)
    p.send(b"\x03")
    code = p.wait_exit(10.0)
    terminal_restored(run, p, code)
    run.check("no stray fake processes", not run.strays(), "; ".join(run.strays()))


def sc_cancel(run: Run, stubborn: bool = False):
    p = run.launch()
    word = "STUBBORN" if stubborn else "SLOW"
    ask(p, f"{word} Q2")
    run.check("provider child + grandchild started", run.wait_tree(True, 15.0, p))
    run.check("progress row visible while running", p.wait_for(lambda: "Inspecting the repository layout" in p.text(), 10.0))
    d = run.pids()
    p.pump(0.5)
    t0 = time.monotonic()
    p.send(b"\x1b")
    run.check("Cancelled row visible", p.wait_for(lambda: "Cancelled" in p.text(), 15.0), f"{time.monotonic() - t0:.1f}s")
    dead = wait_dead(d["child"] + d["grandchild"], 10.0, p)
    run.check("child AND grandchild dead", dead, f"pids={d} alive={[x for x in d['child'] + d['grandchild'] if alive(x)]}")
    if stubborn:
        run.check("SIGTERM was ignored, tree ended by escalation (SIGKILL)", "SIGTERM ignored" in run.pid_log())
    run.check("no answer marker after cancel", answer_of("Q2") not in p.text())
    p.pump(1.0)
    run.check("Cancelled shown once", p.count("Cancelled") == 1, f"count={p.count('Cancelled')}")
    recs = [r for _, r in run.records()]
    cancelled = [r for r in recs if r.get("type") == "provider_event" and r.get("kind") == "cancelled"]
    run.check("one terminal cancelled event, no task_result", len(cancelled) == 1 and not [r for r in recs if r.get("type") == "task_result"])
    # UI stays responsive: a new normal turn works
    ask(p, "hello Q3")
    run.check("follow-up turn answered (UI responsive)", p.wait_for(lambda: answer_of("Q3") in p.text(), 20.0))
    p.pump(1.0)
    run.check("follow-up answer once", p.count(answer_of("Q3")) == 1)
    p.send(b"\x03")
    code = p.wait_exit(10.0)
    terminal_restored(run, p, code)
    run.check("no stray fake processes", not run.strays(), "; ".join(run.strays()))


def sc_switch(run: Run):
    p = run.launch()
    ask(p, "SLOW Q4")
    run.check("turn 1 tree started", run.wait_tree(True, 15.0, p, 1))
    p.wait_for(lambda: "ls -la" in p.text(), 10.0)
    d1 = run.pids()
    p.pump(0.3)
    n_before = len(run.log_lines())
    p.send(b"\x0e")  # Ctrl+N -> new_session
    run.check("switch cancelled turn 1 tree", wait_dead(d1["child"] + d1["grandchild"], 12.0, p), f"pids={d1}")
    p.wait_for(lambda: "SLOW Q4" not in p.text(), 10.0)
    p.pump(2.0)
    new_ops = [op for i, op in run.ops() if i >= n_before]
    run.check("new_session op reached the sidecar", "new_session" in new_ops, str(new_ops))
    recs = run.records()
    idx_transcript = max((i for i, r in recs if r.get("type") == "transcript"), default=-1)
    old_turn = next((r["turnId"] for _, r in recs if r.get("type") == "provider_event"), None)
    late = [r for i, r in recs if i > idx_transcript and (r.get("type") == "task_result" or (r.get("type") == "provider_event" and r.get("turnId") == old_turn))]
    run.check("no old-turn event/result after the session switch", not late, str(late)[:200])
    text = p.text()
    run.check("old turn text absent in the new session", "SLOW Q4" not in text and "Cancelled" not in text and "Inspecting the repository" not in text)
    # Turn 2 in the new session, then the Ctrl+L session picker (switch_session_index) during it
    ask(p, "SLOW Q5")
    run.check("turn 2 tree started", run.wait_tree(True, 15.0, p, 2))
    d2 = run.pids()
    t2 = d2["child"][1:] + d2["grandchild"][1:]
    p.pump(0.3)
    n_before2 = len(run.log_lines())
    p.send(b"\x0c")  # Ctrl+L -> session picker, Down + Enter -> switch_session_index (to another session)
    p.pump(0.6)
    p.send(b"B")
    p.pump(0.3)
    p.send(b"\r")
    run.check("session index switch cancelled turn 2 tree", wait_dead(t2, 12.0, p), f"pids={t2}")
    p.pump(1.5)
    ops2 = [op for i, op in run.ops() if i >= n_before2]
    run.check("switch_session_index op reached the sidecar", "switch_session_index" in ops2, str(ops2))
    run.check("turn 2 text absent after switching away", "SLOW Q5" not in p.text())
    run.check(
        "destination session restored its own cancelled turn exactly once",
        p.count("SLOW Q4") == 1 and p.count("Cancelled") == 1,
        f"Q4={p.count('SLOW Q4')} Cancelled={p.count('Cancelled')}",
    )
    run.check("no answer marker anywhere", ANSWER not in p.text())
    # UI still works
    ask(p, "hello Q6")
    run.check("post-switch turn answered", p.wait_for(lambda: answer_of("Q6") in p.text(), 20.0))
    p.send(b"\x03")
    code = p.wait_exit(10.0)
    terminal_restored(run, p, code)
    all_pids = run.pids()
    run.check("all provider processes dead at exit", wait_dead(all_pids["child"] + all_pids["grandchild"], 8.0), str(all_pids))
    run.check("no stray fake processes", not run.strays(), "; ".join(run.strays()))


def sc_quit(run: Run):
    p = run.launch()
    ask(p, "SLOW Q7")
    run.check("provider tree started", run.wait_tree(True, 15.0, p))
    d = run.pids()
    p.pump(0.3)
    p.send(b"\x03")  # Ctrl+C quits
    code = p.wait_exit(12.0)
    terminal_restored(run, p, code)
    dead = wait_dead(d["child"] + d["grandchild"], 12.0)
    run.check("no orphan provider child/grandchild after quit", dead, f"pids={d} alive={[x for x in d['child'] + d['grandchild'] if alive(x)]}")
    run.check("no stray fake processes", not run.strays(), "; ".join(run.strays()))
    for line in run.strays():
        try:
            os.kill(int(line.split()[0]), signal.SIGKILL)
        except (OSError, ValueError):
            pass


def sc_restore(run: Run):
    p = run.launch()
    ask(p, "hello Q8")
    run.check("live: turn 1 answered", p.wait_for(lambda: answer_of("Q8") in p.text(), 20.0))
    p.pump(1.0)
    ask(p, "SLOW Q9")
    run.check("live: turn 2 tree started", run.wait_tree(True, 15.0, p))
    p.pump(0.5)
    p.send(b"\x1b")
    run.check("live: turn 2 cancelled", p.wait_for(lambda: "Cancelled" in p.text(), 15.0))
    p.pump(1.0)
    needles = ["hello Q8", "ls -la", answer_of("Q8"), "SLOW Q9", "Cancelled"]
    live_lines = p.screen.lines()

    def sequence(text: str) -> list[str]:
        # visible chat items in top-to-bottom order (one entry per matched line)
        seq = []
        for line in text.splitlines():
            for n in ("hello Q8", answer_of("Q8"), "SLOW Q9", "Cancelled"):
                if n in line:
                    seq.append(n)
            if "ls -la" in line:
                seq.append("ls -la")
        return seq

    live_seq = sequence("\n".join(live_lines))
    ok_live, det = order_ok("\n".join(live_lines), ["hello Q8"])
    run.check("live: chat items visible", all(n in "\n".join(live_lines) for n in needles), det)
    live_tools = "\n".join(live_lines).count("ls -la")
    run.check("live: one tool row per turn (2)", live_tools == 2, f"count={live_tools}")
    p.send(b"\x03")
    code = p.wait_exit(10.0)
    terminal_restored(run, p, code, "first run: ")
    d = run.pids()
    run.check("first run: no orphan after quit", wait_dead(d["child"] + d["grandchild"], 10.0), str(d))
    for line in run.strays():
        try:
            os.kill(int(line.split()[0]), signal.SIGKILL)
        except (OSError, ValueError):
            pass

    # relaunch the SAME session (KAIRO_SESSION_ID=A, same HARNESS_HOME / state)
    p2 = run.launch()
    run.check("restore: history rendered", p2.wait_for(lambda: answer_of("Q8") in p2.text() and "Cancelled" in p2.text(), 15.0))
    p2.pump(1.0)
    text2 = p2.text()
    restored_seq = sequence(text2)
    run.check("restore: same visible sequence as live", restored_seq == live_seq, f"live={live_seq} restored={restored_seq}")
    for n in ("hello Q8", answer_of("Q8"), "SLOW Q9", "Cancelled"):
        run.check(f"restore: {n!r} exactly once", text2.count(n) == 1, f"count={text2.count(n)}")
    ok_order, det2 = order_ok(text2, ["hello Q8", answer_of("Q8"), "SLOW Q9", "Cancelled"])
    run.check("restore: prompt -> answer -> prompt -> Cancelled in order", ok_order, det2)
    run.check("restore: one tool row per turn (2)", text2.count("ls -la") == 2, f"count={text2.count('ls -la')}")
    run.check("restore: no progress row resurrected", "Inspecting the repository layout" not in text2)
    p2.send(b"\x03")
    code2 = p2.wait_exit(10.0)
    terminal_restored(run, p2, code2, "second run: ")
    run.check("no stray fake processes", not run.strays(), "; ".join(run.strays()))


def sc_collide(run: Run):
    run.tool_ids = "fixed"
    p = run.launch()
    ask(p, "hello Q10")
    run.check("turn 1 answered", p.wait_for(lambda: answer_of("Q10") in p.text(), 20.0))
    p.pump(0.8)
    ask(p, "hello Q11")
    run.check("turn 2 answered", p.wait_for(lambda: answer_of("Q11") in p.text(), 20.0))
    p.pump(1.0)
    run.check("same tool id on two turns keeps two tool rows", p.count("ls -la") == 2, f"count={p.count('ls -la')}\n{p.text()[:600]}")
    p.send(b"\x03")
    terminal_restored(run, p, p.wait_exit(10.0))


def run_scenarios(binary: Path, sizes, scenarios):
    table: dict[tuple[str, str], tuple[bool, list, str]] = {}
    plan = []
    for cols, rows in sizes:
        for sc in scenarios:
            plan.append((sc, cols, rows))
            if sc == "cancel" and cols == 100:
                plan.append(("cancel-stubborn", cols, rows))
    for sc, cols, rows in plan:
        run = Run(sc, cols, rows, binary)
        err = ""
        t0 = time.monotonic()
        try:
            if sc == "progress":
                sc_progress(run)
            elif sc == "cancel":
                sc_cancel(run)
            elif sc == "cancel-stubborn":
                sc_cancel(run, stubborn=True)
            elif sc == "switch":
                sc_switch(run)
            elif sc == "quit":
                sc_quit(run)
            elif sc == "restore":
                sc_restore(run)
            elif sc == "collide":
                sc_collide(run)
        except Exception as exc:  # noqa: BLE001 - report, never hang
            err = f"EXCEPTION {type(exc).__name__}: {exc}"
            run.check("scenario ran to completion", False, err)
        finally:
            EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
            for i, pty_ in enumerate(run.ptys):
                (EVIDENCE_DIR / f"{run.label}.run{i}.screen.txt").write_text(pty_.text() + "\n", encoding="utf-8")
                (EVIDENCE_DIR / f"{run.label}.run{i}.typescript").write_bytes(bytes(pty_.raw))
            try:
                (EVIDENCE_DIR / f"{run.label}.sidecar.log").write_text("\n".join(run.log_lines()) + "\n", encoding="utf-8")
                (EVIDENCE_DIR / f"{run.label}.pids.log").write_text(run.pid_log(), encoding="utf-8")
            except OSError:
                pass
            leftovers = run.strays()
            run.close()
        ok = all(c[1] for c in run.checks) and bool(run.checks)
        table[(sc, f"{cols}x{rows}")] = (ok, run.checks, f"{time.monotonic() - t0:.0f}s")
        print(f"\n[{run.label}] {'PASS' if ok else 'FAIL'} ({table[(sc, f'{cols}x{rows}')][2]})")
        for name, cok, detail in run.checks:
            print(f"  {'ok  ' if cok else 'FAIL'} {name}" + (f"  -- {detail}" if detail and not cok else ""))
    return table, plan


def main():
    if sys.platform not in ("darwin", "linux"):
        print("SKIP: PTY e2e needs darwin/linux")
        raise SystemExit(0)
    if not SIDECAR.is_file():
        BASE.die(f"missing sidecar {SIDECAR}")
    binary = BASE.resolve_binary()
    sizes = BASE.parse_sizes(os.environ.get("KAIRO_PTY_SIZES"))
    scenarios = [s for s in os.environ.get("KAIRO_ASK_PTY_SCENARIOS", ",".join(DEFAULT_SCENARIOS)).split(",") if s]
    for s in scenarios:
        if s not in ALL_SCENARIOS:
            BASE.die(f"unknown scenario {s}")
    print(f"ASK PTY e2e binary={binary}\nASK PTY e2e sizes={sizes} scenarios={scenarios}\nASK PTY e2e evidence={EVIDENCE_DIR}")
    table, plan = run_scenarios(binary, sizes, scenarios)

    labels = [f"{c}x{r}" for c, r in sizes]
    names = []
    for sc, _c, _r in plan:
        if sc not in names:
            names.append(sc)
    print("\nRESULT TABLE")
    print("scenario".ljust(18) + "".join(l.ljust(14) for l in labels))
    failed = []
    for sc in names:
        row = sc.ljust(18)
        for l in labels:
            cell = table.get((sc, l))
            row += ("-" if cell is None else ("PASS" if cell[0] else "FAIL") + f" {cell[2]}").ljust(14)
            if cell is not None and not cell[0]:
                failed.append(f"{sc}@{l}")
        print(row)
    if failed:
        print("\nASK PTY e2e FAIL: " + ", ".join(failed), file=sys.stderr)
        raise SystemExit(1)
    print("\nASK PTY e2e PASS")


if __name__ == "__main__":
    main()
