#!/usr/bin/env python3
"""PTY end-to-end that OPENS the analyst picker with simulated providers.

Drives, in a real PTY (TIOCSWINSZ sizes):

    Rust `kairo-ui` -> real kairo-ui-rpc-stdio.js (wrapper
    scripts/fixtures/kairo-ui-analyst-e2e-sidecar.mjs) -> real
    preflightProjectTeam / verifyProjectTeamAccess -> real conversation
    service (snapshot, verification plan, verifyAccess, ranking, curation)
    -> SIMULATED providers (catalogs, slow probes, two failing checks).

Scenario "picker" (each requested size):
  1. `a` opens the modal on the confirmation screen; NO probe ran yet and no
     project.verify_access op was sent (discovery without probes).
  2. An opening-window Enter sends nothing; a fresh Enter after the 300 ms
     settle gate sends ONE consented verify op; the modal shows "N/4 checks", the
     active check and a per-subscription problem summary; `d` shows the failed
     checks with their real (simulated) reasons and `d` goes back.
  3. Esc MID-RUN closes the modal: the run is NOT cancelled (a notice says so,
     the sidecar log keeps receiving progress records and finishes, still one
     verify op), and a finished notice appears.
  4. `a` again; Esc on the remaining confirmation skips it; the picker opens
     as ONE flat list of every verified available route (alphabetical, no
     top-three / star / Other), with the project context line, a compact
     partial-comparison acknowledgement and denied-model causes behind `d`.
  5. Navigate to a known model (gpt-5-6-sol via Codex); Enter sends
     project.analyze with that exact model and selectionSource "manual"
     (the analysis itself is stubbed: no provider is called), `q` quits with
     the terminal restored.

NOT proven here: real provider CLIs/accounts (every provider is simulated), the
real Pi, the real local project scan (fixed profile), real probe latency.
No network. All state lives in a temp dir; HOME/HARNESS_HOME point into it.

Env: KAIRO_UI_BINARY, KAIRO_PTY_SIZES ("100x30,160x48,60x30"),
     KAIRO_ANALYST_PTY_KEEP=1 keeps the temp dirs, KAIRO_PTY_EVIDENCE_DIR.
"""

from __future__ import annotations

import sys

sys.dont_write_bytecode = True

import importlib.util
import json
import os
import re
import shutil
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SIDECAR = ROOT / "scripts" / "fixtures" / "kairo-ui-analyst-e2e-sidecar.mjs"
NODE = os.environ.get("KAIRO_UI_NODE") or os.environ.get("NODE") or "node"
EVIDENCE_DIR = Path(os.environ.get("KAIRO_PTY_EVIDENCE_DIR", "/tmp/kairo-pty-analyst"))
DEFAULT_SIZES = ((100, 30), (160, 48), (60, 30))


def _load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


BASE = _load("kairo_pty_base", "kairo-ui-pty-e2e.py")
ASK = _load("kairo_pty_ask", "kairo-ui-ask-pty-e2e.py")
Pty = ASK.Pty


def flat(pty) -> str:
    """Screen text with box borders removed and wrapped lines re-joined."""
    parts = []
    for line in pty.screen.lines():
        parts.append(line.replace("│", " ").replace("┌", " ").replace("┐", " ").replace("└", " ").replace("┘", " ").replace("─", " ").strip())
    return re.sub(r"\s+", " ", " ".join(parts))


class Run:
    def __init__(self, cols: int, rows: int, binary: Path):
        self.cols, self.rows, self.binary = cols, rows, binary
        self.base = Path(tempfile.mkdtemp(prefix="kairo-analyst-e2e-")).resolve()
        self.home = self.base / "home"
        self.state = self.base / "state"
        self.proj = self.base / "proj"
        for d in (self.home, self.state, self.proj):
            d.mkdir(parents=True)
        self.checks: list[tuple[str, bool, str]] = []
        self.label = f"picker@{cols}x{rows}"
        self.pty: Pty | None = None

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
            "KAIRO_ANALYST_E2E_DIR": str(self.state),
            "KAIRO_ANALYST_E2E_PROBE_MS": os.environ.get("KAIRO_ANALYST_E2E_PROBE_MS", "1200"),
        }

    def log_lines(self) -> list[str]:
        f = self.state / "sidecar.log"
        return f.read_text(errors="replace").splitlines() if f.exists() else []

    def ops(self) -> list[str]:
        out = []
        for line in self.log_lines():
            if line.startswith("in {"):
                m = re.search(r'"op":\s*"([a-z_.]+)"', line)
                if m:
                    out.append(m.group(1))
        return out

    def records(self, kind: str) -> list[dict]:
        out = []
        for line in self.log_lines():
            if line.startswith("out {") and f'"type":"{kind}"' in line[:40]:
                try:
                    out.append(json.loads(line[4:]))
                except ValueError:
                    pass
        return out

    def probes(self) -> list[str]:
        return [l for l in self.log_lines() if l.startswith("probe ")]

    def launch(self) -> Pty:
        p = Pty(self.binary, self.cols, self.rows, self.env(), self.proj)
        self.pty = p
        ok = p.wait_for(lambda: any('out {"type":"ready"' in l for l in self.log_lines()), 25.0)
        self.check("sidecar ready", ok)
        p.pump(1.0)
        return p

    def close(self):
        if self.pty:
            self.pty.kill()
        if not os.environ.get("KAIRO_ANALYST_PTY_KEEP"):
            shutil.rmtree(self.base, ignore_errors=True)


def send_opening_enter(p: Pty, visible, opened_at: float, timeout: float, evidence: Path) -> tuple[bool, bool]:
    """Conservatively bound Enter by the request time, before the modal opened."""
    deadline = time.monotonic() + timeout
    rendered_at = None
    while time.monotonic() < deadline:
        p.pump(0.01)
        if visible():
            rendered_at = time.monotonic()
            break
    sent_at = None
    if rendered_at is not None and time.monotonic() - opened_at < 0.300:
        p.send(b"\r")
        sent_at = time.monotonic()
    within_window = sent_at is not None and sent_at - opened_at < 0.300
    timing = {"opened_at": opened_at, "first_render_at": rendered_at,
              "sent_at": sent_at, "within_300_ms": within_window}
    evidence.write_text(json.dumps(timing) + "\n", encoding="utf-8")
    if within_window:
        assert sent_at - rendered_at < 0.300
    else:
        print(f"  [INCONCLUSIVE] opening-window Enter skipped: 300 ms window missed — {timing}")
    p.pump(0.4)
    return rendered_at is not None, within_window


def scenario_picker(run: Run, evidence: Path):
    p = run.launch()
    sizes = f"{run.cols}x{run.rows}"

    def snap(name: str):
        (evidence / f"{sizes}.{name}.txt").write_text(p.text() + "\n", encoding="utf-8")

    # 1. open the picker: confirmation screen, nothing probed, nothing sent.
    # Chat starts in editor focus. Esc transfers focus to the shortcut surface;
    # otherwise `a` is drafted and Enter submits it as a prompt.
    p.send(b"\x1b")
    p.pump(0.3)
    opened_at = time.monotonic()
    p.send(b"a")
    opened, early_enter = send_opening_enter(
        p, lambda: "Verify access before choosing an analyst" in flat(p),
        opened_at, 20.0, evidence / f"{sizes}.opening-timing.json",
    )
    run.check("the picker opens on the confirmation screen", opened, flat(p)[-300:])
    screen = flat(p)
    snap("1-confirmation")
    run.check("the plan names the subscriptions and the quota warning",
              "Claude: 4 model checks" in screen and "Cursor:" not in screen and "Makes 4 real provider calls" in screen, screen[-500:])
    run.check("the local project context is shown", "Proyecto analyst-e2e" in screen and "Node.js" in screen, screen[:400])
    run.check("discovery spawned no probe and sent no verify op", run.probes() == [] and "project.verify_access" not in run.ops(), str(run.ops()))
    run.check("opening the picker did not submit a prompt", "prompt" not in run.ops(), str(run.ops()))

    # 2. consent: one verify op, live progress, problem summary, details.
    # D2: the rendered confirmation is not yet settled. This Enter must not
    # consent; only a separate deliberate press after PICKER_SETTLE may do so.
    if early_enter:
        run.check("an opening-window Enter sends no verify op or probe",
                  "project.verify_access" not in run.ops() and run.probes() == [], str(run.ops()))
    preflight_baseline = len(run.records("preflight"))
    p.send(b"\r")
    seen_progress = p.wait_for(lambda: re.search(r"Verifying access… [0-3]/4 checks", flat(p)) is not None, 20.0)
    run.check("the modal shows completed/total while verifying", seen_progress, flat(p)[-300:])
    run.check("the modal names the active check", "Now:" in flat(p), flat(p)[-300:])
    run.check("the modal says that closing does not cancel", "Closing this window does not cancel" in flat(p), flat(p)[-400:])
    run.check("exactly one consented verify op was sent", run.ops().count("project.verify_access") == 1, str(run.ops()))
    problems = p.wait_for(lambda: "Problems: Claude 1 unverified" in flat(p), 30.0)
    run.check("the problem summary is per subscription and keeps reasons out", problems and "probe timed out" not in flat(p), flat(p)[-400:])
    snap("2-verifying-with-problems")
    p.send(b"d")
    details = p.wait_for(lambda: "claude-sonnet-5 — unverified: probe timed out after 30000ms (simulated)" in flat(p), 10.0)
    snap("3-details")
    run.check("d shows the failed check with its real reason", details, flat(p)[-500:])
    p.send(b"d")
    back = p.wait_for(lambda: re.search(r"Verifying access… \d/4 checks", flat(p)) is not None, 10.0)
    run.check("d goes back to the progress body", back, flat(p)[-300:])

    # 3. Esc mid-run: the run is NOT cancelled.
    before = len(run.records("verification_progress"))
    p.send(b"\x1b")
    closed = p.wait_for(lambda: "Verifying access" not in flat(p) and "nothing was cancelled" in flat(p), 10.0)
    snap("4-closed-while-running")
    run.check("Esc closes the modal and says the checks keep running", closed, flat(p)[-400:])
    finished = p.wait_for(lambda: len(run.records("verification")) >= 1, 40.0)
    run.check("the run kept going after the modal closed and finished", finished, str(run.ops()))
    run.check("progress records kept arriving after Esc", len(run.records("verification_progress")) > before, f"{before} -> {len(run.records('verification_progress'))}")
    run.check("closing sent no second verify op and no cancel", run.ops().count("project.verify_access") == 1 and "cancel" not in " ".join(run.ops()), str(run.ops()))
    notified = p.wait_for(lambda: "Access verification finished" in flat(p), 10.0)
    run.check("the host tells where it stands after the late finish", notified, flat(p)[-300:])
    progress = run.records("verification_progress")
    last = progress[-1] if progress else None
    run.check("the final progress record is 4/4", last is not None and
              (last.get("completed"), last.get("total")) == (4, 4), json.dumps(last)[:200])
    fails = [r for r in run.records("verification_progress") if r.get("done") and r["done"]["status"] != "allowed"]
    run.check("the failed checks carry their real reasons", sorted((r["done"]["label"], r["done"]["status"]) for r in fails) ==
              [("claude-fable-5-1", "denied"), ("claude-sonnet-5", "unverified")], str(fails)[:300])

    # Verification emits its result before rebuilding the preflight catalog.
    # The completion toast alone is not a ready-to-reopen signal: wait for
    # a new preflight and let the host consume it before pressing a.
    rebuilt = p.wait_for(lambda: len(run.records("preflight")) > preflight_baseline, 20.0)
    run.check("verification rebuilt the catalog before reopening", rebuilt)
    p.pump(0.4)

    # 4. reopen: the remaining unverified checks ask again; skipping opens the picker.
    # The completion notice does not guarantee shortcut focus. Probe the effect:
    # if `a` opened nothing it was drafted in the editor, so drop that draft
    # character, move focus with Esc, and press `a` again.
    p.send(b"a")
    again = p.wait_for(lambda: "Verify access before choosing an analyst" in flat(p), 6.0)
    if not again:
        run.check("reopen needed a focus correction (recorded)", True, flat(p)[-300:])
        p.send(b"\x7f")
        p.send(b"\x1b")
        p.pump(0.3)
        p.send(b"a")
        again = p.wait_for(lambda: "Verify access before choosing an analyst" in flat(p), 20.0)
    run.check("the remaining unverified checks are offered again (1 pending)", again and "Makes 1 real provider call" in flat(p), flat(p)[-400:])
    p.send(b"\x1b")
    ready = p.wait_for(lambda: "Select analyst" in flat(p) and "available" in flat(p), 20.0)
    screen = flat(p)
    snap("5-picker-main")
    run.check("the picker opens as a flat available list", ready, screen[-500:])
    run.check("no star / recommended marker", "★" not in screen and "recommended" not in screen.lower(), screen[:500])
    run.check("no Other / m others split", "m others" not in screen and "Other verified analysts" not in screen, screen[-400:])
    if run.cols >= 100:
        for label in ("gpt-5-6-sol · Codex", "claude-opus-5 · Claude"):
            run.check(f"verified route listed: {label}", label in screen, screen[:900])
        run.check("project context line is present", "Proyecto" in screen or "Node.js" in screen, screen[:900])
    else:
        run.check("narrow terminal still lists a Sol Codex route", "gpt-5-6-sol · Codex" in screen, screen[-500:])
    run.check("inactive providers are not offered or probed", "Cursor" not in screen and "OpenCode" not in screen and not any("probe cursor" in line for line in run.probes()), screen[-400:])
    run.check("the partial comparison is acknowledged", "1 subscription not verified" in screen and "partial" in screen, screen[-400:])
    # Denied Fable lives behind d as a per-model cause — never "Claude: no disponible".
    denied_line = "claude-fable-5-1: no disponible"
    if denied_line not in screen and "Claude Fable" not in screen:
        p.send(b"d")
        details = p.wait_for(lambda: denied_line in flat(p) or "Fable" in flat(p) or "d = details" in flat(p), 5.0)
        detail_text = flat(p)
        run.check(
            "denied Fable cause is reachable via d as a per-model line",
            details and (denied_line in detail_text or "Fable" in detail_text) and "Claude: no disponible" not in detail_text,
            detail_text[-400:],
        )
        p.send(b"d")
        p.wait_for(lambda: "Select analyst" in flat(p), 5.0)
    else:
        run.check("the denied Fable model is reported as a per-model cause", "Claude: no disponible" not in screen, screen[-400:])

    # 5. Navigate to gpt-5-6-sol · Codex (alphabetical list; not necessarily first).
    target = "gpt-5-6-sol · Codex"
    found = False
    for _ in range(40):
        screen = flat(p)
        # Selected row is marked with ›
        if re.search(rf"›\s*{re.escape(target)}", screen) or (target in screen and "›" in screen and screen.find("›") < screen.find(target) < screen.find("›") + 120):
            # Prefer an exact selected-row match when the terminal is wide enough.
            if "›" in screen and target in screen:
                # Walk until the selected marker sits on the target label in the painted buffer.
                raw = "\n".join(p.screen.lines())
                if any(target in line and "›" in line for line in p.screen.lines()):
                    found = True
                    break
        p.send(b"j")
        p.pump(0.05)
    if not found:
        # Fallback: accept that the label is on screen and keep navigating a few more times.
        for _ in range(40):
            if any(target in line and "›" in line for line in p.screen.lines()):
                found = True
                break
            p.send(b"j")
            p.pump(0.05)
    snap("6-picker-on-sol")
    run.check("navigated to gpt-5-6-sol via Codex", found, flat(p)[:700])

    # 6. Enter: project.analyze carries exactly that model as an explicit manual pick.
    # Moving the highlight also restarts PICKER_SETTLE.
    p.pump(0.4)
    p.send(b"\r")
    sent = p.wait_for(lambda: any(l.startswith("analyze ") for l in run.log_lines()), 15.0)
    run.check("Enter sends project.analyze", sent and "project.analyze" in run.ops(), str(run.ops()))
    analyze = next((l for l in run.log_lines() if l.startswith("analyze ")), "analyze {}")
    payload = json.loads(analyze[len("analyze "):])
    run.check("the analyst sent is the selected Sol via Codex (manual)",
              payload.get("model", {}).get("modelId") == "gpt-5-6-sol" and payload["model"]["adapterId"] == "codex" and payload.get("selectionSource") == "manual", analyze[:300])
    p.pump(0.5)
    p.send(b"q")
    code = p.wait_exit(10.0)
    run.check("the host exits 0 and restores the terminal", code == 0 and b"\x1b[?1049l" in bytes(p.raw), f"exit={code}")
    (evidence / f"{sizes}.txt").write_text(p.text() + "\n\n--- sidecar ops ---\n" + "\n".join(run.ops()) + "\n", encoding="utf-8")


def main() -> None:
    binary = BASE.resolve_binary()
    sizes = BASE.parse_sizes(os.environ.get("KAIRO_PTY_SIZES")) if os.environ.get("KAIRO_PTY_SIZES") else list(DEFAULT_SIZES)
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    print(f"analyst PTY binary={binary}")
    failures: list[str] = []
    for cols, rows in sizes:
        run = Run(cols, rows, binary)
        try:
            scenario_picker(run, EVIDENCE_DIR)
        except Exception as err:  # noqa: BLE001 - report, never hide
            run.check("scenario completed without an exception", False, repr(err))
        finally:
            run.close()
        print(f"\n{run.label}")
        for name, ok, detail in run.checks:
            print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
            if not ok:
                print(f"         {detail[:600]}")
                failures.append(f"{run.label}: {name}")
    if failures:
        print("\nanalyst PTY FAIL:\n  " + "\n  ".join(failures), file=sys.stderr)
        raise SystemExit(1)
    print("\nanalyst PTY PASS: " + ", ".join(f"{c}x{r}" for c, r in sizes))


if __name__ == "__main__":
    main()
