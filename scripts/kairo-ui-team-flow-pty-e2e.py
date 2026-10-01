#!/usr/bin/env python3
"""PTY end-to-end: Rust kairo-ui ↔ real sidecar for Plan 1 team flows (P1-T2 expand).

REAL infrastructure:
  - Rust `kairo-ui` binary in a real PTY (TIOCSWINSZ sizes + SIGWINCH resize)
  - `runKairoUiRpcStdio` op loop
  - session-registry `saveDraft`/`loadDraft` on disk under isolated HARNESS_HOME

SIMULATED (no real providers/CLIs/network):
  - Pi bridge, analyze/approve bodies, recovery proposal, submitTask chat text

Scenarios (KAIRO_TEAM_FLOW_SCENARIO, comma-separated):
  approve-chat       — A → chat at each size
  recovery-apply     — R → y
  recovery-reject    — R → x (prior team / no set_model)
  recovery-cancel    — R → Esc (local cancel; no apply/reject op)
  resize-preserve    — approve+chat @100, resize 100→60→100, content kept
  draft-restore      — type draft, Esc+q quit, relaunch same session; REAL draft store

Env: KAIRO_UI_BINARY, KAIRO_PTY_SIZES (default 60x30,100x30,160x48),
     KAIRO_PTY_EVIDENCE_DIR, KAIRO_TEAM_FLOW_PTY_KEEP=1.
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import shutil
import signal
import sys
import tempfile
import time
from pathlib import Path

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
SIDECAR = ROOT / "scripts" / "fixtures" / "kairo-ui-team-flow-e2e-sidecar.mjs"
NODE = os.environ.get("KAIRO_UI_NODE") or os.environ.get("NODE") or "node"
EVIDENCE_DIR = Path(os.environ.get("KAIRO_PTY_EVIDENCE_DIR", "/tmp/kairo-pty-team-flow"))
DEFAULT_SIZES = ((60, 30), (100, 30), (160, 48))
# Fixed UUID so stop→restart hits the same REAL session-registry draft path.
SESSION_ID = "dddddddd-0000-4000-8000-00000000000d"
DRAFT_MARKER = "keep-draft-real-session-store"


def _load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


BASE = _load("kairo_pty_base", "kairo-ui-pty-e2e.py")
ASK = _load("kairo_pty_ask", "kairo-ui-ask-pty-e2e.py")
Pty = ASK.Pty
Screen = ASK.Screen


def flat(pty) -> str:
    parts = []
    for line in pty.screen.lines():
        parts.append(
            line.replace("│", " ")
            .replace("┌", " ")
            .replace("┐", " ")
            .replace("└", " ")
            .replace("┘", " ")
            .replace("─", " ")
            .strip()
        )
    return re.sub(r"\s+", " ", " ".join(parts))


def resize_pty(p: Pty, cols: int, rows: int) -> None:
    """Resize the real PTY (TIOCSWINSZ + SIGWINCH) and the local screen model."""
    BASE.set_winsize(p.master, rows, cols)
    try:
        os.kill(p.pid, signal.SIGWINCH)
    except ProcessLookupError:
        pass
    p.screen = Screen(rows, cols)
    p.pump(0.8)


def find_draft_files(home: Path) -> list[Path]:
    root = home / ".harness" / "sessions"
    if not root.is_dir():
        return []
    return sorted(root.rglob("draft.json"))


class Run:
    def __init__(self, cols: int, rows: int, binary: Path, mode: str, shared_base: Path | None = None):
        self.cols, self.rows, self.binary, self.mode = cols, rows, binary, mode
        if shared_base is None:
            self.base = Path(tempfile.mkdtemp(prefix=f"kairo-team-{mode}-")).resolve()
            self._owns_base = True
        else:
            self.base = shared_base
            self._owns_base = False
        self.home = self.base / "home"
        self.state = self.base / "state"
        self.proj = self.base / "proj"
        for d in (self.home, self.state, self.proj):
            d.mkdir(parents=True, exist_ok=True)
        self.checks: list[tuple[str, bool, str]] = []
        self.pty: Pty | None = None
        self.session_id = SESSION_ID

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
            "KAIRO_TEAM_FLOW_E2E_DIR": str(self.state),
            "KAIRO_TEAM_FLOW_MODE": self.mode,
            "KAIRO_SESSION_ID": self.session_id,
        }

    def log_lines(self) -> list[str]:
        f = self.state / "sidecar.log"
        return f.read_text(errors="replace").splitlines() if f.exists() else []

    def clear_log(self):
        f = self.state / "sidecar.log"
        if f.exists():
            f.write_text("")

    def ops(self) -> list[str]:
        out = []
        for line in self.log_lines():
            if line.startswith("in {"):
                m = re.search(r'"op":\s*"([a-z_.]+)"', line)
                if m:
                    out.append(m.group(1))
        return out

    def ready_draft(self) -> str | None:
        for line in self.log_lines():
            if line.startswith("out {") and '"type":"ready"' in line[:40]:
                try:
                    rec = json.loads(line[4:])
                except ValueError:
                    continue
                draft = rec.get("draft")
                if isinstance(draft, str):
                    return draft
        return None

    def launch(self) -> Pty:
        # Fresh log per process so ops() is attributable to this launch.
        self.clear_log()
        p = Pty(self.binary, self.cols, self.rows, self.env(), self.proj)
        self.pty = p
        ok = p.wait_for(lambda: any('out {"type":"ready"' in l for l in self.log_lines()), 25.0)
        self.check("sidecar ready (REAL stdio loop)", ok)
        p.pump(0.8)
        return p

    def quit_from_editor(self, p: Pty) -> int | None:
        """Leave compose focus (Esc) then q — quit still persists editor via stop_with_draft."""
        p.send(b"\x1b")  # Esc → sidebar when editor has text
        p.pump(0.3)
        p.send(b"q")
        return p.wait_exit(10.0)

    def close(self, keep_base: bool = False):
        if self.pty:
            self.pty.kill()
            self.pty = None
        if self._owns_base and not keep_base and not os.environ.get("KAIRO_TEAM_FLOW_PTY_KEEP"):
            shutil.rmtree(self.base, ignore_errors=True)


def scenario_approve_chat(run: Run, evidence: Path):
    p = run.launch()
    sizes = f"{run.cols}x{run.rows}"
    (evidence / f"{sizes}.approve-chat.start.txt").write_text(p.text() + "\n", encoding="utf-8")

    p.send(b"A")
    approved = p.wait_for(lambda: "team.approve" in run.ops(), 15.0)
    run.check("A sends team.approve through REAL sidecar", approved, str(run.ops()))
    run.check(
        "approve handler ran (SIMULATED team)",
        any(l == "approve" for l in run.log_lines()),
        str(run.log_lines()[-20:]),
    )
    set_model = p.wait_for(lambda: any(l.startswith("set_model ") for l in run.log_lines()), 10.0)
    run.check("Architect re-applied via set_model (SIMULATED Pi)", set_model, str(run.log_lines()[-30:]))

    prompt = f"hello team flow {sizes}"
    p.type_text(prompt)
    p.pump(0.2)
    p.send(b"\r")
    chatted = p.wait_for(lambda: any(l.startswith("chat mode=") for l in run.log_lines()), 15.0)
    run.check("Enter routes prompt through submitTask (SIMULATED answer)", chatted, str(run.log_lines()[-30:]))
    run.check("prompt op reached sidecar", "prompt" in run.ops(), str(run.ops()))
    seen = p.wait_for(lambda: "SIMULATED reply" in flat(p) or prompt in flat(p), 12.0)
    run.check("chat text visible in Rust UI", seen, flat(p)[-400:])
    (evidence / f"{sizes}.approve-chat.after-chat.txt").write_text(p.text() + "\n", encoding="utf-8")

    code = run.quit_from_editor(p) if flat(p) else p.wait_exit(1.0)
    # After chat the compose box is usually empty — plain q works from editor.
    if code is None:
        p.send(b"q")
        code = p.wait_exit(10.0)
    run.check("host exits cleanly", code == 0, str(code))


def scenario_recovery(run: Run, evidence: Path, action: str):
    """action: apply | reject | cancel"""
    p = run.launch()
    sizes = f"{run.cols}x{run.rows}"
    (evidence / f"{sizes}.recovery-{action}.start.txt").write_text(p.text() + "\n", encoding="utf-8")

    p.send(b"R")
    previewed = p.wait_for(lambda: "team.recovery.preview" in run.ops(), 15.0)
    run.check("R sends team.recovery.preview", previewed, str(run.ops()))
    modal = p.wait_for(
        lambda: "rate-limited" in flat(p) or "Recovered team" in flat(p),
        12.0,
    )
    run.check("recovery preview surfaces SIMULATED cause in Rust UI", modal, flat(p)[-500:])
    (evidence / f"{sizes}.recovery-{action}.preview.txt").write_text(p.text() + "\n", encoding="utf-8")

    before_sets = [l for l in run.log_lines() if l.startswith("set_model ")]
    before_ops = list(run.ops())

    if action == "apply":
        p.send(b"y")
        applied = p.wait_for(lambda: "team.recovery.apply" in run.ops(), 15.0)
        run.check("y sends team.recovery.apply", applied, str(run.ops()))
        run.check("apply handler ran (SIMULATED)", any(l == "recovery.apply" for l in run.log_lines()), str(run.log_lines()[-20:]))
    elif action == "reject":
        p.send(b"x")
        rejected = p.wait_for(lambda: "team.recovery.reject" in run.ops(), 15.0)
        run.check("x sends team.recovery.reject", rejected, str(run.ops()))
        run.check("reject handler ran (SIMULATED)", any(l == "recovery.reject" for l in run.log_lines()), str(run.log_lines()[-20:]))
        after_sets = [l for l in run.log_lines() if l.startswith("set_model ")]
        run.check("reject never calls set_model — prior team kept", after_sets == before_sets, str(after_sets))
        run.check("reject never sent apply", "team.recovery.apply" not in run.ops(), str(run.ops()))
    else:  # cancel
        p.send(b"\x1b")  # Esc — local cancel, mutates nothing
        cancelled = p.wait_for(lambda: "Recovery preview cancelled" in flat(p), 8.0)
        run.check("Esc cancels recovery preview locally", cancelled, flat(p)[-400:])
        p.pump(0.4)
        run.check(
            "cancel sent neither apply nor reject",
            "team.recovery.apply" not in run.ops() and "team.recovery.reject" not in run.ops(),
            str(run.ops()),
        )
        run.check(
            "cancel added no set_model",
            [l for l in run.log_lines() if l.startswith("set_model ")] == before_sets,
            str(before_ops),
        )

    (evidence / f"{sizes}.recovery-{action}.done.txt").write_text(p.text() + "\n", encoding="utf-8")
    p.send(b"q")
    code = p.wait_exit(10.0)
    run.check("host exits cleanly", code == 0, str(code))


def scenario_resize_preserve(run: Run, evidence: Path):
    """Start @100×30, approve+chat, resize 100→60→100; content must survive."""
    assert run.cols == 100 and run.rows == 30, "resize-preserve expects a 100x30 start"
    p = run.launch()
    (evidence / "100x30.resize.start.txt").write_text(p.text() + "\n", encoding="utf-8")

    p.send(b"A")
    run.check("approve op", p.wait_for(lambda: "team.approve" in run.ops(), 15.0), str(run.ops()))
    p.wait_for(lambda: any(l.startswith("set_model ") for l in run.log_lines()), 10.0)

    marker = "keep-resize-marker-alpha"
    p.type_text(marker)
    p.pump(0.2)
    p.send(b"\r")
    run.check(
        "chat answered (SIMULATED)",
        p.wait_for(lambda: "SIMULATED reply" in flat(p) or marker in flat(p), 15.0),
        flat(p)[-400:],
    )
    before = flat(p)
    (evidence / "100x30.resize.before.txt").write_text(p.text() + "\n", encoding="utf-8")

    resize_pty(p, 60, 30)
    mid = flat(p)
    (evidence / "60x30.resize.mid.txt").write_text(p.text() + "\n", encoding="utf-8")
    run.check(
        "after 100→60 content still present (SIMULATED reply or marker)",
        "SIMULATED reply" in mid or marker in mid,
        mid[-500:],
    )

    resize_pty(p, 100, 30)
    back = flat(p)
    (evidence / "100x30.resize.back.txt").write_text(p.text() + "\n", encoding="utf-8")
    run.check(
        "after 60→100 content still present",
        "SIMULATED reply" in back or marker in back,
        back[-500:],
    )
    run.check(
        "resize path never sent recovery mutate ops",
        "team.recovery.apply" not in run.ops() and "team.recovery.reject" not in run.ops(),
        str(run.ops()),
    )
    # Selection/focus: compose still accepts input after resize round-trip.
    # Leading space avoids single-letter chrome hotkeys when the draft is empty.
    p.pump(0.4)
    p.type_text(" keep-post-resize")
    p.pump(0.5)
    run.check(
        "editor still accepts input after resize round-trip",
        "keep-post-resize" in flat(p),
        flat(p)[-300:],
    )

    code = run.quit_from_editor(p)
    run.check("host exits cleanly", code == 0, str(code))


def scenario_draft_restore(run: Run, evidence: Path):
    """stop→restart→restore via REAL session-registry draft under isolated HARNESS_HOME."""
    p = run.launch()
    (evidence / "draft-restore.first-ready.txt").write_text(p.text() + "\n", encoding="utf-8")
    first_draft = run.ready_draft()
    run.check("first launch has no prior draft", first_draft in (None, ""), str(first_draft))

    p.type_text(DRAFT_MARKER)
    p.pump(0.4)
    run.check("typed draft visible before quit", DRAFT_MARKER in flat(p), flat(p)[-300:])

    code = run.quit_from_editor(p)
    run.check("quit with non-empty editor exits cleanly", code == 0, str(code))

    # REAL store evidence on disk (isolated temp HOME — never the user home).
    drafts = find_draft_files(run.home)
    run.check("REAL draft.json written under isolated HARNESS_HOME", len(drafts) >= 1, str(drafts))
    disk_ok = False
    disk_detail = ""
    for path in drafts:
        try:
            doc = json.loads(path.read_text())
        except (OSError, ValueError) as exc:
            disk_detail = str(exc)
            continue
        disk_detail = json.dumps(doc)[:300]
        if doc.get("schema") == "kairo.session-draft/v1" and doc.get("text") == DRAFT_MARKER:
            disk_ok = True
            break
    run.check("REAL draft.json schema+text match typed marker", disk_ok, disk_detail)
    (evidence / "draft-restore.disk.json").write_text(
        "\n".join(f"{p}: {p.read_text()}" for p in drafts) + "\n",
        encoding="utf-8",
    )

    # Relaunch same isolated HOME + KAIRO_SESSION_ID (new PTY / new sidecar process).
    run2 = Run(run.cols, run.rows, run.binary, "approve-chat", shared_base=run.base)
    run2.session_id = run.session_id
    p2 = run2.launch()
    (evidence / "draft-restore.second-ready.txt").write_text(p2.text() + "\n", encoding="utf-8")
    restored = run2.ready_draft()
    run.check(
        "ready.draft restored from REAL session store",
        restored == DRAFT_MARKER,
        f"ready.draft={restored!r}",
    )
    visible = p2.wait_for(lambda: DRAFT_MARKER in flat(p2), 8.0)
    run.check("restored draft visible in Rust editor", visible, flat(p2)[-400:])

    # Fold run2 checks into run for reporting, then quit without wiping shared base yet.
    run.checks.extend(run2.checks)
    p2.send(b"\x1b")
    p2.pump(0.2)
    p2.send(b"q")
    code2 = p2.wait_exit(10.0)
    run.check("second launch exits cleanly", code2 == 0, str(code2))
    run2.pty = None


def main() -> int:
    binary = BASE.resolve_binary()
    sizes = BASE.parse_sizes(os.environ.get("KAIRO_PTY_SIZES"))
    raw = os.environ.get(
        "KAIRO_TEAM_FLOW_SCENARIO",
        "approve-chat,recovery-reject,recovery-apply,recovery-cancel,resize-preserve,draft-restore",
    )
    scenarios = [s.strip() for s in raw.split(",") if s.strip()]
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)

    failed = 0
    for scenario in scenarios:
        if scenario == "resize-preserve":
            size_list = [(100, 30)]
        elif scenario == "draft-restore":
            size_list = [(100, 30)]
        else:
            size_list = sizes

        for cols, rows in size_list:
            if scenario in ("approve-chat", "resize-preserve", "draft-restore"):
                mode = "approve-chat"
            elif scenario == "recovery-apply":
                mode = "recovery-apply"
            elif scenario in ("recovery-reject", "recovery-cancel"):
                mode = "recovery-reject"
            else:
                print(f"unknown scenario {scenario}", file=sys.stderr)
                return 2

            run = Run(cols, rows, binary, mode)
            evidence = EVIDENCE_DIR / f"{scenario}-{cols}x{rows}"
            evidence.mkdir(parents=True, exist_ok=True)
            try:
                if scenario == "approve-chat":
                    scenario_approve_chat(run, evidence)
                elif scenario == "recovery-apply":
                    scenario_recovery(run, evidence, "apply")
                elif scenario == "recovery-reject":
                    scenario_recovery(run, evidence, "reject")
                elif scenario == "recovery-cancel":
                    scenario_recovery(run, evidence, "cancel")
                elif scenario == "resize-preserve":
                    scenario_resize_preserve(run, evidence)
                elif scenario == "draft-restore":
                    scenario_draft_restore(run, evidence)
            except Exception as exc:  # noqa: BLE001
                run.check(f"scenario crashed: {exc}", False, repr(exc))
            finally:
                run.close()

            print(f"\n== {scenario} @{cols}x{rows} ==")
            for name, ok, detail in run.checks:
                mark = "PASS" if ok else "FAIL"
                print(f"  [{mark}] {name}" + (f" — {detail[:200]}" if detail and not ok else ""))
                if not ok:
                    failed += 1

    if failed:
        print(f"\nPTY team-flow FAIL: {failed} check(s)", file=sys.stderr)
        print(
            "REAL: Rust PTY + sidecar loop + session-registry drafts under temp HARNESS_HOME.\n"
            "SIMULATED: Pi, analyze/approve/recovery bodies, chat answers.",
            file=sys.stderr,
        )
        return 1
    print(
        "\nPTY team-flow PASS — REAL: Rust↔sidecar + session store; "
        "SIMULATED: Pi/analyst/recovery/chat providers"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
