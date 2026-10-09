#!/usr/bin/env python3
"""PTY end-to-end for decision D5: the analyst picker is reachable from the
real Ratatui `R` action while recovery is throttled (backoff / retries
exhausted), and only a deliberate Enter spends an attempt.

REAL:
  - the Rust `kairo-ui` binary in a real PTY (keys are real key bytes)
  - runKairoUiRpcStdio op loop (`team.recovery.preview`) and the host wrapper
    recoverKairoProjectTeam
  - the REAL conversation service, runTeamRecovery, availability fingerprint,
    analysis lock and on-disk stores (project strategy, availability-recovery
    record) under a temp HARNESS_HOME/project
SIMULATED (no provider, login or network): Pi bridge, provider eligibility and
analyst catalog (Go limited, Codex+Claude available), project profile scan,
sanitized snapshot, and the analyst adapter (it only counts its calls:
`analyzer-called` in the sidecar log).
The "automatic refresh" is the same host wrapper called WITHOUT the explicit
flag (what a Pi session refresh does), triggered through a file the sidecar
polls; Ratatui itself has no automatic recovery path to press.

Scenarios (both run by default): backoff, exhausted.
Per scenario it asserts: R opens the picker with no analysis, no `started`
record, attempts unchanged, no lock; an automatic refresh in that state
opens nothing and analyzes nothing; Esc leaves attempts unchanged; a
deliberate Enter analyzes exactly once (attempts +1, origin manual) and
yields a pending proposal while the ACTIVE strategy file stays byte-identical;
Esc on the proposal leaves attempts unchanged; R again REOPENS the pending
proposal and never analyzes again.

Run: python3 scripts/kairo-ui-recovery-throttle-pty-e2e.py
Env: KAIRO_UI_BINARY, KAIRO_RECOVERY_SCENARIOS ("backoff,exhausted"),
     KAIRO_RECOVERY_PTY_KEEP=1, KAIRO_PTY_EVIDENCE_DIR, KAIRO_PTY_SIZES.
"""

from __future__ import annotations

import sys

sys.dont_write_bytecode = True

import hashlib
import subprocess
import importlib.util
import json
import os
import re
import shutil
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SIDECAR = ROOT / "scripts" / "fixtures" / "kairo-ui-recovery-throttle-e2e-sidecar.mjs"
NODE = os.environ.get("KAIRO_UI_NODE") or os.environ.get("NODE") or "node"
EVIDENCE_DIR = Path(os.environ.get("KAIRO_PTY_EVIDENCE_DIR", "/tmp/kairo-pty-recovery-throttle"))


def _load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


BASE = _load("kairo_pty_base", "kairo-ui-pty-e2e.py")
ASK = _load("kairo_pty_ask", "kairo-ui-ask-pty-e2e.py")
Pty = ASK.Pty


def flat(pty) -> str:
    parts = []
    for line in pty.screen.lines():
        parts.append(
            line.replace("│", " ").replace("┌", " ").replace("┐", " ")
            .replace("└", " ").replace("┘", " ").replace("─", " ").strip()
        )
    return re.sub(r"\s+", " ", " ".join(parts))


class Run:
    def __init__(self, scenario: str, cols: int, rows: int, binary: Path):
        self.scenario, self.cols, self.rows, self.binary = scenario, cols, rows, binary
        self.base = Path(tempfile.mkdtemp(prefix=f"kairo-recovery-{scenario}-")).resolve()
        self.home, self.state, self.proj = self.base / "home", self.base / "state", self.base / "proj"
        for d in (self.home, self.state, self.proj):
            d.mkdir(parents=True)
        subprocess.run(["git", "init", "-q"], cwd=self.proj, check=True)
        self.checks: list[tuple[str, bool, str]] = []
        self.pty: Pty | None = None

    def check(self, name: str, ok: bool, detail: str = ""):
        self.checks.append((name, bool(ok), detail))

    def env(self) -> dict:
        return {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "HOME": str(self.home), "HARNESS_HOME": str(self.home),
            "LANG": "en_US.UTF-8", "TERM": "xterm-256color",
            "COLUMNS": str(self.cols), "LINES": str(self.rows),
            "KAIRO_UI_BRIDGE": "1", "KAIRO_UI_RPC_SCRIPT": str(SIDECAR), "KAIRO_UI_NODE": NODE,
            "KAIRO_RECOVERY_E2E_DIR": str(self.state), "KAIRO_RECOVERY_E2E_STATE": self.scenario,
        }

    def log_lines(self) -> list[str]:
        f = self.state / "sidecar.log"
        return f.read_text(errors="replace").splitlines() if f.exists() else []

    def ops(self, name: str = "team.recovery.preview") -> list[dict]:
        out = []
        for line in self.log_lines():
            if line.startswith("in {"):
                try:
                    rec = json.loads(line[3:])
                except ValueError:
                    continue
                if rec.get("op") == name:
                    out.append(rec)
        return out

    def records(self) -> list[dict]:
        out = []
        for line in self.log_lines():
            if line.startswith("out {") and '"type":"recovery"' in line[:40]:
                try:
                    out.append(json.loads(line[4:]))
                except ValueError:
                    pass
        return out

    def analyzer_calls(self) -> int:
        return sum(1 for l in self.log_lines() if l.startswith("analyzer-called"))

    def paths(self) -> dict:
        return json.loads((self.state / "paths.json").read_text())

    def record(self) -> dict:
        return json.loads(Path(self.paths()["recovery"]).read_text())

    def strategy_digest(self) -> str:
        return hashlib.sha256(Path(self.paths()["strategy"]).read_bytes()).hexdigest()

    def launch(self) -> Pty:
        p = Pty(self.binary, self.cols, self.rows, self.env(), self.proj)
        self.pty = p
        ok = p.wait_for(lambda: any('out {"type":"ready"' in l for l in self.log_lines()), 25.0)
        self.check("sidecar ready (REAL stdio loop, REAL stores seeded)", ok)
        p.pump(1.0)
        return p

    def close(self):
        if self.pty:
            self.pty.kill()
        if not os.environ.get("KAIRO_RECOVERY_PTY_KEEP"):
            shutil.rmtree(self.base, ignore_errors=True)


def focus_shortcuts(p: Pty):
    # Chat starts in editor focus; Esc moves to the shortcut surface (only
    # once: a second Esc would hand focus back to the editor).
    p.send(b"\x1b")
    p.pump(0.3)


def press_r(p: Pty):
    p.send(b"R")


def scenario(run: Run, evidence: Path):
    p = run.launch()
    seeded_attempts = 3 if run.scenario == "exhausted" else 1
    throttle = "retries-exhausted" if run.scenario == "exhausted" else "retry-later"
    seeded = run.record()
    run.check("seed: the recovery record is throttled for the current fingerprint",
              seeded["outcome"] == "analysis-failed" and seeded["attempts"] == seeded_attempts, json.dumps(seeded)[:300])
    strategy_before = run.strategy_digest()
    record_before = run.record()

    def snap(name: str):
        (evidence / f"{run.scenario}.{name}.txt").write_text(p.text() + "\n", encoding="utf-8")

    # 1. R opens the picker; nothing is analyzed or spent.
    focus_shortcuts(p)
    press_r(p)
    opened = p.wait_for(lambda: "Automatic retries are paused" in flat(p), 20.0)
    snap("1-picker")
    run.check("R sends team.recovery.preview WITHOUT an analyst", len(run.ops()) == 1 and "analyst" not in run.ops()[0], str(run.ops()))
    run.check("R opens the analyst picker while throttled", opened, flat(p)[-500:])
    sel = run.records()[0] if run.records() else {}
    run.check("the selection payload says it was throttled (%s)" % throttle,
              sel.get("outcome") == "analyst_selection_required" and sel.get("throttled") == throttle, json.dumps(sel)[:300])
    run.check("no analysis started", run.analyzer_calls() == 0)
    run.check("no `started` record and attempts unchanged", run.record() == record_before, json.dumps(run.record())[:300])
    run.check("no analysis lock left behind", not list(Path(run.paths()["recovery"]).parent.glob("*lock*")), str(list(Path(run.paths()["recovery"]).parent.iterdir())))

    # 2. An automatic refresh in the same state opens nothing, analyzes nothing.
    ops_before, screen_before = len(run.log_lines()), flat(p)
    (run.state / "trigger-auto").write_text("1")
    got = p.wait_for(lambda: any(l.startswith("auto-result ") for l in run.log_lines()), 10.0)
    auto = json.loads(next((l[len("auto-result "):] for l in run.log_lines() if l.startswith("auto-result ")), "{}"))
    run.check("automatic refresh ran through the same host wrapper", got, str(auto)[:300])
    run.check("automatic refresh updates state only: skipped, no picker data",
              auto.get("outcome") == "skipped" and "analystCatalog" not in auto and "suggestedAnalyst" not in auto, json.dumps(auto)[:300])
    p.pump(0.5)
    run.check("automatic refresh opened nothing in the UI", flat(p) == screen_before)
    run.check("automatic refresh analyzed nothing and spent no attempt", run.analyzer_calls() == 0 and run.record() == record_before)

    # 3. Esc leaves attempts unchanged.
    p.send(b"\x1b")
    closed = p.wait_for(lambda: "Automatic retries are paused" not in flat(p), 8.0)
    run.check("Esc closes the picker", closed, flat(p)[-300:])
    p.pump(0.4)
    run.check("Esc left attempts, record and analysis untouched", run.record() == record_before and run.analyzer_calls() == 0 and len(run.ops()) == 1)

    # 4. R again, then a deliberate Enter: exactly one analysis.
    press_r(p)
    p.wait_for(lambda: "Automatic retries are paused" in flat(p), 20.0)
    p.pump(1.0)  # the picker's anti-repeat settle window
    p.send(b"\r")
    proposed = p.wait_for(lambda: any(r.get("outcome") == "proposed" for r in run.records()), 30.0)
    p.pump(0.5)
    snap("2-proposal")
    run.check("a deliberate Enter sends ONE preview carrying the chosen analyst",
              len(run.ops()) == 3 and "analyst" in run.ops()[-1] and run.ops()[-1]["analyst"].get("selectionSource") == "manual", str(run.ops())[-400:])
    run.check("exactly one analysis ran", run.analyzer_calls() == 1, str(run.analyzer_calls()))
    after = run.record()
    run.check("attempts +1, origin manual, proposal pending",
              proposed and after["attempts"] == seeded_attempts + 1 and after.get("origin") == "manual" and after["outcome"] == "proposed",
              json.dumps({k: after.get(k) for k in ("outcome", "attempts", "origin")}))
    run.check("the ACTIVE strategy file is byte-identical", run.strategy_digest() == strategy_before)
    shown = p.wait_for(lambda: "rate-limited" in flat(p) or "Recovered team" in flat(p), 10.0)
    run.check("the pending proposal is shown in the UI", shown, flat(p)[-400:])

    # 5. Esc on the proposal keeps attempts; R reopens it without a new analysis.
    p.send(b"\x1b")
    p.wait_for(lambda: "Recovery preview cancelled" in flat(p), 8.0)
    p.pump(0.4)
    run.check("Esc on the proposal leaves attempts unchanged", run.record() == after)
    proposal_id = next((r.get("proposalId") for r in run.records() if r.get("outcome") == "proposed"), None)
    n_ops = len(run.ops())
    p.send(b"R")
    reopened = p.wait_for(lambda: len(run.ops()) == n_ops + 1 and run.records()[-1].get("outcome") == "proposed", 15.0)
    p.pump(0.5)
    snap("3-reopened")
    last = run.records()[-1]
    run.check("R reopens the pending proposal (same id)", reopened and last.get("proposalId") == proposal_id and proposal_id, json.dumps(last)[:300])
    run.check("reopening sent no analyst and analyzed nothing new", "analyst" not in run.ops()[-1] and run.analyzer_calls() == 1)
    run.check("reopening spent no attempt", run.record() == after)
    run.check("the active strategy is still byte-identical", run.strategy_digest() == strategy_before)

    p.send(b"\x1b")
    p.pump(0.3)
    p.send(b"q")
    code = p.wait_exit(10.0)
    run.check("host exits cleanly", code == 0, str(code))


def main() -> None:
    binary = BASE.resolve_binary()
    sizes = BASE.parse_sizes(os.environ.get("KAIRO_PTY_SIZES")) if os.environ.get("KAIRO_PTY_SIZES") else [(120, 40)]
    scenarios = [s.strip() for s in os.environ.get("KAIRO_RECOVERY_SCENARIOS", "backoff,exhausted").split(",") if s.strip()]
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    print(f"recovery-throttle PTY binary={binary}")
    failures: list[str] = []
    for name in scenarios:
        for cols, rows in sizes:
            run = Run(name, cols, rows, binary)
            try:
                scenario(run, EVIDENCE_DIR)
            except Exception as err:  # noqa: BLE001 - report, never hide
                run.check("scenario completed without an exception", False, repr(err))
            finally:
                run.close()
            print(f"\n{name}@{cols}x{rows}")
            for check, ok, detail in run.checks:
                print(f"  [{'PASS' if ok else 'FAIL'}] {check}")
                if not ok:
                    print(f"         {detail[:600]}")
                    failures.append(f"{name}: {check}")
    if failures:
        print("\nrecovery-throttle PTY FAIL:\n  " + "\n  ".join(failures), file=sys.stderr)
        raise SystemExit(1)
    print("\nrecovery-throttle PTY PASS: " + ", ".join(scenarios))


if __name__ == "__main__":
    main()
