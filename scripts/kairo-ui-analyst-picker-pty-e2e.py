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
  2. Enter sends ONE consented verify op; the modal shows "N/6 checks", the
     active check and a per-subscription problem summary; `d` shows the failed
     checks with their real (simulated) reasons and `d` goes back.
  3. Esc MID-RUN closes the modal: the run is NOT cancelled (a notice says so,
     the sidecar log keeps receiving progress records and finishes, still one
     verify op), and a finished notice appears.
  4. `a` again; Esc on the remaining confirmation skips it; the picker opens
     with the top three DISTINCT models, the star on the first, plain-language
     explanations that say why/what differs, the project context line, the
     partial-comparison acknowledgement and the denied-model cause.
  5. `m` shows the equivalent route (same model via Cursor) under manual.
  6. Enter on the star sends project.analyze with that exact model (the
     analysis itself is stubbed: no provider is called), `q` quits with the
     terminal restored.

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


def scenario_picker(run: Run, evidence: Path):
    p = run.launch()
    sizes = f"{run.cols}x{run.rows}"

    def snap(name: str):
        (evidence / f"{sizes}.{name}.txt").write_text(p.text() + "\n", encoding="utf-8")

    # 1. open the picker: confirmation screen, nothing probed, nothing sent.
    p.send(b"a")
    opened = p.wait_for(lambda: "Verify access before choosing an analyst" in flat(p), 20.0)
    run.check("the picker opens on the confirmation screen", opened, flat(p)[-300:])
    screen = flat(p)
    snap("1-confirmation")
    run.check("the plan names the subscriptions and the quota warning",
              "Claude: 4 model checks" in screen and "Cursor: 2 pool checks" in screen and "Makes 6 real provider calls" in screen, screen[-500:])
    run.check("the local project context is shown", "Proyecto analyst-e2e" in screen and "Node.js" in screen, screen[:400])
    run.check("discovery spawned no probe and sent no verify op", run.probes() == [] and "project.verify_access" not in run.ops(), str(run.ops()))

    # 2. consent: one verify op, live progress, problem summary, details.
    p.send(b"\r")
    seen_progress = p.wait_for(lambda: re.search(r"Verifying access… [0-5]/6 checks", flat(p)) is not None, 20.0)
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
    back = p.wait_for(lambda: re.search(r"Verifying access… \d/6 checks", flat(p)) is not None, 10.0)
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
    last = run.records("verification_progress")[-1]
    run.check("the final progress record is 6/6", (last["completed"], last["total"]) == (6, 6), json.dumps(last)[:200])
    fails = [r for r in run.records("verification_progress") if r.get("done") and r["done"]["status"] != "allowed"]
    run.check("the failed checks carry their real reasons", sorted((r["done"]["label"], r["done"]["status"]) for r in fails) ==
              [("Cursor models", "unverified"), ("claude-fable-5-1", "denied"), ("claude-sonnet-5", "unverified")], str(fails)[:300])

    # 4. reopen: the remaining unverified checks ask again; skipping opens the picker.
    p.send(b"a")
    again = p.wait_for(lambda: "Verify access before choosing an analyst" in flat(p), 20.0)
    run.check("the remaining unverified checks are offered again (2 pending)", again and "Makes 2 real provider calls" in flat(p), flat(p)[-400:])
    p.send(b"\x1b")
    ready = p.wait_for(lambda: "Select analyst" in flat(p) and "recommended" in flat(p), 20.0)
    screen = flat(p)
    snap("5-picker-main")
    run.check("the picker opens with the star", ready, screen[-500:])
    if run.cols >= 100:
        order = [screen.find(label) for label in ("gpt-5-6-sol · Codex", "kimi-k3 · OpenCode Go", "claude-opus-5 · Claude")]
        run.check("top three DISTINCT models in catalog order", all(i >= 0 for i in order) and order == sorted(order), str(order))
        run.check("the same model via Cursor is not a main row", "GPT-5.6 Sol · Cursor" not in screen, screen[-300:])
        run.check("the star is the first row", re.search(r"gpt-5-6-sol · Codex\s+★ recommended", screen) is not None, screen[:500])
        run.check("explanations say why and what differs", "puesto 1 de 7 modelos distintos" in screen and "lidera en razonamiento" in screen, screen[:900])
        run.check("the explanation uses the project context, not a model claim", "para analizar este proyecto (Node.js)" in screen, screen[:900])
    else:
        run.check("narrow terminal still shows the star row", "gpt-5-6-sol · Codex" in screen, screen[-500:])
    run.check("the partial comparison is acknowledged", "2 subscriptions not verified" in screen and "partial" in screen, screen[-400:])
    run.check("the denied model is reported as a per-subscription cause", "Claude: no disponible (verificado)" in screen, screen[-400:])

    # 5. manual view: the equivalent route.
    p.send(b"m")
    manual = p.wait_for(lambda: "Other verified analysts" in flat(p), 10.0)
    screen = flat(p)
    snap("6-picker-manual")
    run.check("m opens the manual view", manual, screen[-300:])
    run.check("the equivalent route says it carries the same evidence", "GPT-5.6 Sol · Cursor" in screen and "Misma evidencia que gpt-5-6-sol · Codex" in screen, screen[:700])
    p.send(b"m")
    p.wait_for(lambda: "Select analyst" in flat(p), 10.0)

    # 6. Enter on the star: project.analyze carries exactly that model.
    p.send(b"\r")
    sent = p.wait_for(lambda: any(l.startswith("analyze ") for l in run.log_lines()), 15.0)
    run.check("Enter sends project.analyze", sent and "project.analyze" in run.ops(), str(run.ops()))
    analyze = next((l for l in run.log_lines() if l.startswith("analyze ")), "analyze {}")
    payload = json.loads(analyze[len("analyze "):])
    run.check("the analyst sent is the star (gpt-5-6-sol via codex, recommended)",
              payload.get("model", {}).get("modelId") == "gpt-5-6-sol" and payload["model"]["adapterId"] == "codex" and payload.get("selectionSource") == "recommended", analyze[:300])
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
