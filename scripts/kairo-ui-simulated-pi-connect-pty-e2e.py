#!/usr/bin/env python3
"""PTY evidence (SIMULATED Pi): approval -> Architect -> set_model -> engine state.

REAL: Rust kairo-ui binary in a PTY, the real sidecar loop behind the transparent
      tee, the real openPiRpcBridge / resolveArchitectRouteForRpc / route provider,
      the persisted strategy store and the real conversation service behind
      `team.approve` (triggered by the real UI key: Esc, then `A`).
SIMULATED: the Pi child (scripts/fixtures/fake-pi-child.mjs, records every request to
      fake-pi-requests.jsonl) and adapter launchability (existing resolveAdapter seam).
NEVER: real providers, real Pi, network, credentials, analyst/model calls. Temp HOME
      and HARNESS_HOME; PATH is restricted so no provider CLI could even be found.

Every assertion reads recorded protocol (sidecar.jsonl + fake-pi-requests.jsonl);
nothing is inferred from screen text. A missing `ready` is an explicit FAIL.

This proves harness + host wiring. It does NOT prove the published Pi, a real
provider, or Architect launchability on a real machine.

Env: KAIRO_UI_BINARY, KAIRO_PTY_EVIDENCE_DIR (default: <tmp>/kairo-simulated-pi-connect),
     KAIRO_SIM_PI_SCENARIOS (comma list; default: all), KAIRO_SIM_PI_SIDECAR
     (self-test only: replace the tee sidecar to prove the explicit `ready` FAIL).
"""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
TEE_SIDECAR = Path(os.environ.get("KAIRO_SIM_PI_SIDECAR") or ROOT / "scripts" / "fixtures" / "kairo-ui-tee-sidecar.mjs")
SEED = ROOT / "scripts" / "seed-simulated-suggested-team.mjs"
NODE = shutil.which(os.environ.get("KAIRO_UI_NODE") or os.environ.get("NODE") or "node") or "node"
EVIDENCE_ROOT = Path(
    os.environ.get("KAIRO_PTY_EVIDENCE_DIR") or Path(tempfile.gettempdir()) / "kairo-simulated-pi-connect"
)
ARCHITECT_MODEL_ID = "codex::sim-architect-1"
NO_ROUTES_REASON = "No active strategy with automatic launchable projectTeam routes"
NO_ARCHITECT_REASON = "No Architect assignment with automatic access and a launchable adapter in projectTeam"
PI_TIMEOUT_MS = 1500


def _load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


BASE = _load("kairo_pty_base", "kairo-ui-pty-e2e.py")
ASK = _load("kairo_pty_ask", "kairo-ui-ask-pty-e2e.py")
EV = _load("kairo_sidecar_evidence", "kairo-sidecar-evidence.py")
Pty = ASK.Pty

# name -> (seed status, approve through the UI, expectation key)
SCENARIOS = {
    "positive": ("suggested", True),
    "no-architect-route": ("suggested", True),
    "unlaunchable-route": ("suggested", True),
    "set-model-fails": ("suggested", True),
    "placeholder-model": ("suggested", True),
    "silent-get-state": ("suggested", False),
    "silent-set-model": ("active", False),
}


def scenario_env(home: Path, evidence: Path, scenario: str, cols: int, rows: int) -> dict:
    return {
        # Restricted PATH: provider CLIs (codex/claude/cursor-agent/opencode) are not reachable.
        "PATH": "/usr/bin:/bin",
        "HOME": str(home),
        "HARNESS_HOME": str(home),
        "PI_CODING_AGENT_DIR": str(home / "pi-agent"),
        "LANG": "en_US.UTF-8",
        "TERM": "xterm-256color",
        "COLUMNS": str(cols),
        "LINES": str(rows),
        "KAIRO_UI_BRIDGE": "1",
        "KAIRO_UI_RPC_SCRIPT": str(TEE_SIDECAR),
        "KAIRO_UI_NODE": NODE,
        "KAIRO_PI_MODE": "simulated",
        "KAIRO_SIM_PI_SCENARIO": scenario,
        "KAIRO_SIM_PI_TIMEOUT_MS": str(PI_TIMEOUT_MS),
        "KAIRO_EVIDENCE_DIR": str(evidence),
    }


class Run:
    def __init__(self, scenario: str):
        self.scenario = scenario
        self.checks: list[tuple[str, bool, str]] = []
        self.evidence = EVIDENCE_ROOT / scenario
        shutil.rmtree(self.evidence, ignore_errors=True)
        self.evidence.mkdir(parents=True, exist_ok=True)
        self.base = Path(tempfile.mkdtemp(prefix=f"kairo-sim-pi-{scenario}-")).resolve()
        self.home = self.base / "home"
        self.proj = self.base / "proj"
        for d in (self.home, self.proj, self.home / "pi-agent"):
            d.mkdir(parents=True, exist_ok=True)

    def check(self, name: str, ok: bool, detail: str = "") -> None:
        self.checks.append((name, bool(ok), detail))

    @property
    def sidecar_jsonl(self) -> Path:
        return self.evidence / EV.SIDECAR_JSONL

    @property
    def requests_jsonl(self) -> Path:
        return self.evidence / EV.FAKE_PI_REQUESTS

    def seed(self, status: str) -> bool:
        git = subprocess.run(["git", "init", "-q"], cwd=self.proj, capture_output=True, text=True)
        self.check("temp project is a git repo", git.returncode == 0, git.stderr.strip())
        env = os.environ.copy()
        env.update(
            KAIRO_SIM_PROJ=str(self.proj),
            KAIRO_SIM_HOME=str(self.home),
            KAIRO_SIM_PI_SCENARIO=self.scenario,
            KAIRO_SIM_SEED_STATUS=status,
            HARNESS_HOME=str(self.home),
        )
        seeded = subprocess.run([NODE, str(SEED)], cwd=str(ROOT), env=env, capture_output=True, text=True, timeout=120)
        (self.evidence / "seed.stdout.txt").write_text(seeded.stdout or "", encoding="utf-8")
        (self.evidence / "seed.stderr.txt").write_text(seeded.stderr or "", encoding="utf-8")
        self.check(f"seeded {status} strategy without calling the analyst", seeded.returncode == 0, seeded.stderr.strip())
        return seeded.returncode == 0


def flat(pty) -> str:
    return " ".join(line.strip() for line in pty.screen.lines() if line.strip())


def run_scenario(binary: Path, scenario: str, cols: int = 100, rows: int = 30) -> Run:
    seed_status, approve = SCENARIOS[scenario]
    run = Run(scenario)
    if not run.seed(seed_status):
        return run

    p = Pty(binary, cols, rows, scenario_env(run.home, run.evidence, scenario, cols, rows), run.proj)
    try:
        # 1. The REAL `ready` record, from sidecar.jsonl. Explicit timeout -> explicit FAIL.
        try:
            ready = EV.wait_for_ready(run.sidecar_jsonl, timeout_s=EV.READY_TIMEOUT_S, pump=p.pump)
        except EV.EvidenceTimeout as exc:
            run.check("real `ready` event arrived", False, str(exc))
            (run.evidence / "screen.on-ready-timeout.txt").write_text(p.text() + "\n", encoding="utf-8")
            return run
        run.check("real `ready` event arrived", True)
        engine0 = ready.get("engine") or {}
        records0, _ = EV.read_records(run.sidecar_jsonl)
        ready_idx = next(i for i, r in enumerate(records0) if r.get("type") == "ready")
        p.pump(0.8)
        (run.evidence / "screen.after-ready.txt").write_text(p.text() + "\n", encoding="utf-8")

        if scenario == "silent-get-state":
            run.check("ready.engine.status == unavailable", engine0.get("status") == "unavailable", json.dumps(engine0))
            run.check(
                "cause names the get_state timeout",
                "timed out waiting for get_state" in str(engine0.get("reason")),
                str(engine0.get("reason")),
            )
            run.check(
                "fake Pi recorded get_state only (unanswered), no set_model",
                [r["type"] for r in EV.read_records(run.requests_jsonl)[0]] == ["get_state"],
                json.dumps(EV.read_records(run.requests_jsonl)[0]),
            )
        elif scenario == "silent-set-model":
            run.check("ready.engine.status == no_model", engine0.get("status") == "no_model", json.dumps(engine0))
            reason = str(engine0.get("reason"))
            run.check(
                "cause names the set_model timeout",
                "set_model failed" in reason and "timed out waiting for set_model" in reason,
                reason,
            )
            run.check("fake Pi recorded one unanswered set_model", len(EV.requests_of_type(run.requests_jsonl, "set_model")) == 1)
        else:
            # Before approval the engine is NOT required to be connected: record the truth only.
            run.check("before approval: engine no_model (no active team)", engine0.get("status") == "no_model", json.dumps(engine0))
            run.check("before approval: reason is the existing no-routes text", engine0.get("reason") == NO_ROUTES_REASON, str(engine0.get("reason")))
            run.check(
                "before approval: fake Pi has not received set_model",
                len(EV.requests_of_type(run.requests_jsonl, "set_model")) == 0,
            )

        if approve:
            # Real UI keys: Esc (compose -> sidebar focus), then A (team.approve).
            p.send(b"\x1b")
            p.pump(0.4)
            p.send(b"A")
            try:
                team = EV.wait_for_record(
                    run.sidecar_jsonl,
                    lambda r: r.get("type") == "team" and r.get("op") == "team.approve",
                    timeout_s=15.0,
                    pump=p.pump,
                    after=ready_idx + 1,
                    what="`team` record for team.approve",
                )
                run.check("A reached the real service: team.approve ok", team.get("ok") is True, json.dumps(team))
                recs, _ = EV.read_records(run.sidecar_jsonl)
                team_idx = next(i for i, r in enumerate(recs) if r is not None and r.get("type") == "team" and r.get("op") == "team.approve")
                engine_rec = EV.wait_for_record(
                    run.sidecar_jsonl,
                    lambda r: r.get("type") == "engine",
                    timeout_s=15.0,
                    pump=p.pump,
                    after=team_idx,
                    what="`engine` record after approval",
                )
            except EV.EvidenceTimeout as exc:
                run.check("approval produced team + engine records", False, str(exc))
                (run.evidence / "screen.on-approve-timeout.txt").write_text(p.text() + "\n", encoding="utf-8")
                return run
            engine = engine_rec.get("engine") or {}
            sets = EV.requests_of_type(run.requests_jsonl, "set_model")
            types = [r["type"] for r in EV.read_records(run.requests_jsonl)[0]]
            summary = json.dumps({"engine": engine, "modelLabel": engine_rec.get("modelLabel")})

            if scenario == "positive":
                run.check("fake Pi received exactly one set_model", len(sets) == 1, json.dumps(sets))
                params = sets[0]["params"] if sets else {}
                run.check("set_model provider == kairo", params.get("provider") == "kairo", json.dumps(params))
                run.check("set_model modelId == expected Architect", params.get("modelId") == ARCHITECT_MODEL_ID, json.dumps(params))
                run.check("engine record status == connected", engine.get("status") == "connected", summary)
                run.check(
                    "engine model identity coherent with set_model (id + provider + label)",
                    (engine.get("model") or {}).get("id") == params.get("modelId")
                    and (engine.get("model") or {}).get("provider") == "kairo"
                    and engine_rec.get("modelLabel") == params.get("modelId"),
                    summary,
                )
                run.check(
                    "get_state follows set_model in the recorded protocol",
                    "set_model" in types and len(types) - 1 - types[::-1].index("get_state") > types.index("set_model"),
                    ",".join(types),
                )
            elif scenario == "no-architect-route":
                run.check("engine record status == no_model", engine.get("status") == "no_model", summary)
                run.check("cause is the existing missing-Architect text", engine.get("reason") == NO_ARCHITECT_REASON, summary)
                run.check("fake Pi did NOT receive set_model", len(sets) == 0, json.dumps(sets))
            elif scenario == "unlaunchable-route":
                run.check("engine record status == no_model", engine.get("status") == "no_model", summary)
                run.check("cause is the existing no-routes text", engine.get("reason") == NO_ROUTES_REASON, summary)
                run.check("fake Pi did NOT receive set_model", len(sets) == 0, json.dumps(sets))
            elif scenario == "set-model-fails":
                run.check("engine record status == no_model", engine.get("status") == "no_model", summary)
                run.check(
                    "cause names set_model failed + the Pi error",
                    "set_model failed" in str(engine.get("reason")) and "simulated set_model failure" in str(engine.get("reason")),
                    summary,
                )
                run.check("fake Pi received set_model (then rejected it)", len(sets) == 1, json.dumps(sets))
            elif scenario == "placeholder-model":
                run.check("engine record status == no_model", engine.get("status") == "no_model", summary)
                run.check("cause is the placeholder classification", engine.get("reason") == "No model selected", summary)
                run.check("no model identity claimed", engine.get("model") is None, summary)
                run.check("fake Pi received set_model (then reported the placeholder)", len(sets) == 1, json.dumps(sets))

        (run.evidence / "screen.final.txt").write_text(p.text() + "\n", encoding="utf-8")
        p.send(b"\x1b")
        p.pump(0.2)
        p.send(b"q")
        code = p.wait_exit(10.0)
        run.check("host exits cleanly", code == 0, str(code))
    except Exception as exc:  # noqa: BLE001
        run.check("no harness exception", False, f"{type(exc).__name__}: {exc}")
    finally:
        try:
            p.close() if hasattr(p, "close") else p.kill()
        except Exception:
            pass
    return run


def main() -> int:
    binary = BASE.resolve_binary()
    if not TEE_SIDECAR.is_file():
        print(f"Simulated-Pi connect FAIL: missing sidecar {TEE_SIDECAR}", file=sys.stderr)
        return 1
    names = [s.strip() for s in (os.environ.get("KAIRO_SIM_PI_SCENARIOS") or ",".join(SCENARIOS)).split(",") if s.strip()]
    unknown = [n for n in names if n not in SCENARIOS]
    if unknown:
        print(f"Simulated-Pi connect FAIL: unknown scenario(s) {unknown}", file=sys.stderr)
        return 2

    EVIDENCE_ROOT.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    print(f"== simulated-Pi connect evidence (SIMULATED Pi, no providers/network) ==\nbinary: {binary}\nevidence: {EVIDENCE_ROOT}")
    report = []
    failed = 0
    for name in names:
        run = run_scenario(binary, name)
        bad = [c for c in run.checks if not c[1]]
        failed += len(bad)
        print(f"\n[{name}] {'PASS' if not bad else 'FAIL'}")
        for check_name, ok, detail in run.checks:
            print(f"  [{'PASS' if ok else 'FAIL'}] {check_name}" + (f" — {detail[:240]}" if detail and not ok else ""))
        report.append({
            "scenario": name,
            "checks": [{"name": n, "ok": ok, "detail": d[:500]} for n, ok, d in run.checks],
            "evidenceDir": str(run.evidence),
        })
        shutil.rmtree(run.base, ignore_errors=True)

    (EVIDENCE_ROOT / "RESULT.json").write_text(
        json.dumps(
            {
                "label": "simulated Pi",
                "proves": "harness + host wiring (approval -> Architect -> set_model -> engine record)",
                "doesNotProve": "published Pi, a real provider, or Architect launchability on a real machine",
                "elapsedSec": round(time.monotonic() - started, 1),
                "failed": failed,
                "scenarios": report,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    if failed:
        print(f"\nSimulated-Pi connect FAIL: {failed} check(s)", file=sys.stderr)
        return 1
    print("\nSimulated-Pi connect PASS (simulated Pi)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
