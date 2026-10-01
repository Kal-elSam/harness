#!/usr/bin/env python3
"""PTY end-to-end: Rust kairo-ui ↔ real sidecar for Plan 1 team flows.

SIMULATED providers/Pi/analysis (no real CLIs, logins, or network).
REAL: Rust host binary + runKairoUiRpcStdio op loop via the team-flow fixture.

Scenarios (KAIRO_TEAM_FLOW_SCENARIO, comma-separated):
  approve-chat     — A approves pending team, type+Enter chats, q quits
  recovery-apply   — R opens recovery, Enter/y applies
  recovery-reject  — R opens recovery, x rejects without set_model

Env: KAIRO_UI_BINARY, KAIRO_PTY_SIZES (default 100x30), KAIRO_PTY_EVIDENCE_DIR,
     KAIRO_TEAM_FLOW_PTY_KEEP=1.
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
SIDECAR = ROOT / "scripts" / "fixtures" / "kairo-ui-team-flow-e2e-sidecar.mjs"
NODE = os.environ.get("KAIRO_UI_NODE") or os.environ.get("NODE") or "node"
EVIDENCE_DIR = Path(os.environ.get("KAIRO_PTY_EVIDENCE_DIR", "/tmp/kairo-pty-team-flow"))
DEFAULT_SIZES = ((100, 30),)


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
            line.replace("│", " ")
            .replace("┌", " ")
            .replace("┐", " ")
            .replace("└", " ")
            .replace("┘", " ")
            .replace("─", " ")
            .strip()
        )
    return re.sub(r"\s+", " ", " ".join(parts))


class Run:
    def __init__(self, cols: int, rows: int, binary: Path, mode: str):
        self.cols, self.rows, self.binary, self.mode = cols, rows, binary, mode
        self.base = Path(tempfile.mkdtemp(prefix=f"kairo-team-{mode}-")).resolve()
        self.home = self.base / "home"
        self.state = self.base / "state"
        self.proj = self.base / "proj"
        for d in (self.home, self.state, self.proj):
            d.mkdir(parents=True)
        self.checks: list[tuple[str, bool, str]] = []
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
            "KAIRO_TEAM_FLOW_E2E_DIR": str(self.state),
            "KAIRO_TEAM_FLOW_MODE": self.mode,
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

    def launch(self) -> Pty:
        p = Pty(self.binary, self.cols, self.rows, self.env(), self.proj)
        self.pty = p
        ok = p.wait_for(lambda: any('out {"type":"ready"' in l for l in self.log_lines()), 25.0)
        self.check("sidecar ready (REAL stdio loop)", ok)
        p.pump(0.8)
        return p

    def close(self):
        if self.pty:
            self.pty.kill()
        if not os.environ.get("KAIRO_TEAM_FLOW_PTY_KEEP"):
            shutil.rmtree(self.base, ignore_errors=True)


def scenario_approve_chat(run: Run, evidence: Path):
    p = run.launch()
    sizes = f"{run.cols}x{run.rows}"
    (evidence / f"{sizes}.approve-chat.start.txt").write_text(p.text() + "\n", encoding="utf-8")

    p.send(b"A")
    approved = p.wait_for(lambda: "team.approve" in run.ops(), 15.0)
    run.check("A sends team.approve through REAL sidecar", approved, str(run.ops()))
    run.check("approve handler ran (SIMULATED team)", any(l == "approve" for l in run.log_lines()), str(run.log_lines()[-20:]))
    set_model = p.wait_for(lambda: any(l.startswith("set_model ") for l in run.log_lines()), 10.0)
    run.check("Architect re-applied via set_model (SIMULATED Pi)", set_model, str(run.log_lines()[-30:]))
    (evidence / f"{sizes}.approve-chat.after-A.txt").write_text(p.text() + "\n", encoding="utf-8")

    p.send(b"hello team flow")
    p.pump(0.3)
    p.send(b"\r")
    chatted = p.wait_for(lambda: any(l.startswith("chat mode=") for l in run.log_lines()), 15.0)
    run.check("Enter routes prompt through submitTask (SIMULATED answer)", chatted, str(run.log_lines()[-30:]))
    run.check("prompt op reached sidecar", "prompt" in run.ops(), str(run.ops()))
    seen = p.wait_for(lambda: "SIMULATED reply" in flat(p) or "hello team flow" in flat(p), 12.0)
    run.check("chat text visible in Rust UI", seen, flat(p)[-400:])
    (evidence / f"{sizes}.approve-chat.after-chat.txt").write_text(p.text() + "\n", encoding="utf-8")

    p.send(b"q")
    code = p.wait_exit(10.0)
    run.check("host exits cleanly", code == 0, str(code))


def scenario_recovery(run: Run, evidence: Path, apply: bool):
    p = run.launch()
    sizes = f"{run.cols}x{run.rows}"
    label = "apply" if apply else "reject"
    (evidence / f"{sizes}.recovery-{label}.start.txt").write_text(p.text() + "\n", encoding="utf-8")

    p.send(b"R")
    previewed = p.wait_for(lambda: "team.recovery.preview" in run.ops(), 15.0)
    run.check("R sends team.recovery.preview", previewed, str(run.ops()))
    modal = p.wait_for(
        lambda: "rate-limited (simulated)" in flat(p) or "Recovery" in flat(p) or "proposed" in flat(p).lower(),
        12.0,
    )
    run.check("recovery preview surfaces SIMULATED cause in Rust UI", modal, flat(p)[-500:])
    (evidence / f"{sizes}.recovery-{label}.preview.txt").write_text(p.text() + "\n", encoding="utf-8")

    before_sets = [l for l in run.log_lines() if l.startswith("set_model ")]
    if apply:
        p.send(b"y")
        applied = p.wait_for(lambda: "team.recovery.apply" in run.ops(), 15.0)
        run.check("y/Enter sends team.recovery.apply", applied, str(run.ops()))
        run.check("apply handler ran", any(l == "recovery.apply" for l in run.log_lines()), str(run.log_lines()[-20:]))
    else:
        p.send(b"x")
        rejected = p.wait_for(lambda: "team.recovery.reject" in run.ops(), 15.0)
        run.check("x sends team.recovery.reject", rejected, str(run.ops()))
        run.check("reject handler ran", any(l == "recovery.reject" for l in run.log_lines()), str(run.log_lines()[-20:]))
        after_sets = [l for l in run.log_lines() if l.startswith("set_model ")]
        run.check("reject never calls set_model", after_sets == before_sets, str(after_sets))

    (evidence / f"{sizes}.recovery-{label}.done.txt").write_text(p.text() + "\n", encoding="utf-8")
    p.send(b"q")
    code = p.wait_exit(10.0)
    run.check("host exits cleanly", code == 0, str(code))


def main() -> int:
    binary = BASE.resolve_binary()
    sizes = BASE.parse_sizes(os.environ.get("KAIRO_PTY_SIZES"))
    raw = os.environ.get("KAIRO_TEAM_FLOW_SCENARIO", "approve-chat,recovery-reject,recovery-apply")
    scenarios = [s.strip() for s in raw.split(",") if s.strip()]
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)

    failed = 0
    for cols, rows in sizes:
        for scenario in scenarios:
            if scenario == "approve-chat":
                mode = "approve-chat"
            elif scenario == "recovery-apply":
                mode = "recovery-apply"
            elif scenario == "recovery-reject":
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
                    scenario_recovery(run, evidence, apply=True)
                else:
                    scenario_recovery(run, evidence, apply=False)
            except Exception as exc:  # noqa: BLE001 — surface as failed checks
                run.check(f"scenario crashed: {exc}", False, repr(exc))
            finally:
                run.close()

            print(f"\n== {scenario} @{cols}x{rows} ==")
            for name, ok, detail in run.checks:
                mark = "PASS" if ok else "FAIL"
                print(f"  [{mark}] {name}" + (f" — {detail[:180]}" if detail and not ok else ""))
                if not ok:
                    failed += 1

    if failed:
        print(f"\nPTY team-flow FAIL: {failed} check(s)", file=sys.stderr)
        return 1
    print("\nPTY team-flow PASS (SIMULATED providers; REAL Rust↔sidecar)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
