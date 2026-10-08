#!/usr/bin/env python3
"""PTY end-to-end for the suggested-alternative confirmation modal.

Drives the Rust `kairo-ui` host (KAIRO_UI_BINARY, e.g. the binary installed from
a packed tarball) against scripts/fixtures/kairo-ui-alternative-modal-sidecar.mjs,
a mock sidecar that emits one `plan_preview` with a `suggestedAlternative` and a
`confirmationTarget`. Three scenarios, each in a fresh PTY:

  confirm : the modal names the role, provider and model; Enter sends nothing;
            `y` sends exactly one `plans.execute` carrying the received
            target (taskId + confirmationTarget, deep-equal); a repeated `y`
            while the request is pending does not send a second one.
  n       : `n` closes the modal and sends no plans.execute / plans.decide.
  esc     : Esc closes the modal and sends no plans.execute / plans.decide.

Asserted from the ops the mock sidecar logged (never from screen text alone).
NOT proven here: real providers (none are started), real plan previews (the
mock emits the preview; its shape mirrors the real sidecar's `plans.preview`),
the executed run itself.  No network.  All state lives in a temp dir.

Env: KAIRO_UI_BINARY, KAIRO_PTY_SIZES ("100x30,60x30"), KAIRO_UI_NODE,
     KAIRO_PTY_EVIDENCE_DIR, KAIRO_ALT_PTY_KEEP=1 keeps the temp dirs.
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
SIDECAR = ROOT / "scripts" / "fixtures" / "kairo-ui-alternative-modal-sidecar.mjs"
NODE = os.environ.get("KAIRO_UI_NODE") or os.environ.get("NODE") or "node"
EVIDENCE_DIR = Path(os.environ.get("KAIRO_PTY_EVIDENCE_DIR", "/tmp/kairo-pty-alternative-modal"))
DEFAULT_SIZES = ((100, 30), (60, 30))
EXPECTED_TARGET = {
    "role": "Builder",
    "selection": "suggested-alternative",
    "strategyFingerprint": "fp-alt-e2e",
    "candidateKey": "claude::claude-opus-5",
}
SETTLE_S = 0.8


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
        self.base = Path(tempfile.mkdtemp(prefix="kairo-alt-e2e-")).resolve()
        self.home = self.base / "home"
        self.proj = self.base / "proj"
        self.log = self.base / "sidecar.log"
        for d in (self.home, self.proj):
            d.mkdir(parents=True)
        self.checks: list[tuple[str, bool, str]] = []
        self.label = f"{scenario}@{cols}x{rows}"
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
            "KAIRO_ALT_E2E_LOG": str(self.log),
        }

    def lines(self) -> list[str]:
        return self.log.read_text(errors="replace").splitlines() if self.log.exists() else []

    def ops(self) -> list[dict]:
        out = []
        for line in self.lines():
            if line.startswith("in {"):
                try:
                    out.append(json.loads(line[3:]))
                except ValueError:
                    pass
        return out

    def plan_ops(self, name: str | None = None) -> list[dict]:
        return [o for o in self.ops() if str(o.get("op", "")).startswith("plans.") and (name is None or o.get("op") == name)]

    def launch(self) -> Pty:
        p = Pty(self.binary, self.cols, self.rows, self.env(), self.proj)
        self.pty = p
        ok = p.wait_for(lambda: "out plan_preview" in self.lines(), 25.0)
        self.check("sidecar emitted the plan preview", ok)
        shown = p.wait_for(lambda: "Suggested alternative" in flat(p), 15.0)
        self.check("the confirmation modal opened", shown, flat(p)[-300:])
        p.pump(0.3)
        return p

    def close(self):
        if self.pty:
            self.pty.kill()
        if not os.environ.get("KAIRO_ALT_PTY_KEEP"):
            shutil.rmtree(self.base, ignore_errors=True)


def snap(run: Run, name: str, p: Pty):
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    (EVIDENCE_DIR / f"{run.label}.{name}.txt").write_text(p.text() + "\n", encoding="utf-8")


def scenario_confirm(run: Run):
    p = run.launch()
    screen = flat(p)
    snap(run, "1-modal", p)
    run.check("the modal names the role", "Builder" in screen, screen[-400:])
    run.check("the modal names the provider and model", "claude" in screen and "Claude Opus" in screen, screen[-400:])
    run.check("the modal asks for y/n", "(y/n)" in screen, screen[-400:])
    run.check("opening the modal sent no plan op", run.plan_ops() == [], str(run.plan_ops()))

    p.send(b"\r")
    p.pump(SETTLE_S)
    snap(run, "2-after-enter", p)
    run.check("Enter does not execute", run.plan_ops("plans.execute") == [], str(run.plan_ops()))
    run.check("the modal is still open after Enter", "Suggested alternative" in flat(p), flat(p)[-300:])

    p.send(b"y")
    sent = p.wait_for(lambda: len(run.plan_ops("plans.execute")) >= 1, 10.0)
    p.pump(SETTLE_S)
    executes = run.plan_ops("plans.execute")
    run.check("y sends plans.execute", sent and len(executes) >= 1, str(run.plan_ops()))
    if executes:
        run.check("plans.execute carries exactly the received taskId", executes[0].get("taskId") == "task-alt-1", json.dumps(executes[0]))
        run.check("plans.execute carries exactly the received confirmationTarget", executes[0].get("confirmationTarget") == EXPECTED_TARGET, json.dumps(executes[0]))

    p.send(b"y")
    p.pump(SETTLE_S)
    snap(run, "3-after-repeated-y", p)
    run.check("a repeated y while pending does not duplicate", len(run.plan_ops("plans.execute")) == 1, str(run.plan_ops()))
    run.check("no plans.decide was sent", run.plan_ops("plans.decide") == [], str(run.plan_ops()))


def scenario_cancel(run: Run, key: bytes, label: str):
    p = run.launch()
    snap(run, "1-modal", p)
    p.send(key)
    p.pump(SETTLE_S)
    snap(run, "2-after-cancel", p)
    run.check(f"{label} closes the modal", "Suggested alternative" not in flat(p), flat(p)[-300:])
    run.check(f"{label} sends no plans.execute", run.plan_ops("plans.execute") == [], str(run.plan_ops()))
    run.check(f"{label} sends no plans.decide", run.plan_ops("plans.decide") == [], str(run.plan_ops()))
    run.check(f"{label} sends no plan op at all", run.plan_ops() == [], str(run.plan_ops()))


SCENARIOS = (
    ("confirm", scenario_confirm),
    ("n", lambda run: scenario_cancel(run, b"n", "n")),
    ("esc", lambda run: scenario_cancel(run, b"\x1b", "Esc")),
)


def main() -> None:
    binary = BASE.resolve_binary()
    sizes = BASE.parse_sizes(os.environ.get("KAIRO_PTY_SIZES")) if os.environ.get("KAIRO_PTY_SIZES") else list(DEFAULT_SIZES)
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    print(f"alternative-modal PTY binary={binary}")
    failures: list[str] = []
    for cols, rows in sizes:
        for name, fn in SCENARIOS:
            run = Run(name, cols, rows, binary)
            try:
                fn(run)
            except Exception as err:  # noqa: BLE001 - report, never hide
                run.check("scenario completed without an exception", False, repr(err))
            finally:
                run.close()
            print(f"\n{run.label}")
            for check_name, ok, detail in run.checks:
                print(f"  [{'PASS' if ok else 'FAIL'}] {check_name}")
                if not ok:
                    print(f"         {detail[:600]}")
                    failures.append(f"{run.label}: {check_name}")
    if failures:
        print("\nalternative-modal PTY FAIL:\n  " + "\n  ".join(failures), file=sys.stderr)
        raise SystemExit(1)
    print("\nalternative-modal PTY PASS: " + ", ".join(f"{c}x{r}" for c, r in sizes))


if __name__ == "__main__":
    main()
