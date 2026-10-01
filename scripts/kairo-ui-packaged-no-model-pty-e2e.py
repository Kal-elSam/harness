#!/usr/bin/env python3
"""Packaged integrated host — no_model check (isolated, no credentials, no network).

DISTINCT from Claude's published-Pi RPC-only cold start:
  this drives the PREBUILT `kairo-ui` binary through a REAL sidecar op loop
  (`runKairoUiRpcStdio` + `classifyPiEngineFromState`) so the product path
  shows Chat blocked: no_model.

REAL: prebuilt binary, stdio loop, classifier (placeholder → no_model).
SIMULATED by default: Pi child is a local fake that returns the same
placeholder model shape the published package emitted. Set
KAIRO_PACKAGED_NO_MODEL_REAL_PI=1 to attempt a real published Pi spawn
(still offline / scrubbed HOME — never user credentials).

Env: KAIRO_UI_BINARY, KAIRO_PTY_EVIDENCE_DIR, KAIRO_PTY_SIZES (default 100x30),
     KAIRO_PACKAGED_NO_MODEL_REAL_PI=1, KAIRO_PACKAGED_NO_MODEL_KEEP=1.
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
SIDECAR = ROOT / "scripts" / "fixtures" / "kairo-ui-packaged-no-model-sidecar.mjs"
NODE = os.environ.get("KAIRO_UI_NODE") or os.environ.get("NODE") or "node"
EVIDENCE_DIR = Path(os.environ.get("KAIRO_PTY_EVIDENCE_DIR", "/tmp/kairo-packaged-no-model"))


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


def scrubbed_env(home: Path, state: Path, cols: int, rows: int) -> dict:
    # Explicitly drop credential / provider env so this check cannot leak keys.
    drop_prefixes = (
        "ANTHROPIC_",
        "OPENAI_",
        "OPENCODE_",
        "CURSOR_",
        "CODEX_",
        "CLAUDE_",
        "AWS_",
        "GOOGLE_",
        "GEMINI_",
        "API_KEY",
        "TOKEN",
    )
    base = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": str(home),
        "HARNESS_HOME": str(home),
        "PI_CODING_AGENT_DIR": str(home / "pi-agent"),
        "LANG": "en_US.UTF-8",
        "TERM": "xterm-256color",
        "COLUMNS": str(cols),
        "LINES": str(rows),
        "KAIRO_UI_BRIDGE": "1",
        "KAIRO_UI_RPC_SCRIPT": str(SIDECAR),
        "KAIRO_UI_NODE": NODE,
        "KAIRO_PACKAGED_NO_MODEL_E2E_DIR": str(state),
    }
    if os.environ.get("KAIRO_PACKAGED_NO_MODEL_REAL_PI") == "1":
        base["KAIRO_PACKAGED_NO_MODEL_REAL_PI"] = "1"
    # Carry only allowlisted vars from the parent (never secrets).
    for key, value in os.environ.items():
        upper = key.upper()
        if any(upper.startswith(p) or p in upper for p in drop_prefixes):
            continue
        if key in ("NODE", "KAIRO_UI_NODE", "KAIRO_UI_BINARY"):
            base.setdefault(key, value)
    return base


def ready_engine(log_lines: list[str]) -> dict | None:
    for line in log_lines:
        if line.startswith("out {") and '"type":"ready"' in line[:40]:
            try:
                return json.loads(line[4:])
            except ValueError:
                continue
    return None


def main() -> int:
    binary = BASE.resolve_binary()
    sizes = BASE.parse_sizes(os.environ.get("KAIRO_PTY_SIZES") or "100x30")
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    failed = 0

    for cols, rows in sizes:
        base = Path(tempfile.mkdtemp(prefix="kairo-packaged-no-model-")).resolve()
        home = base / "home"
        state = base / "state"
        proj = base / "proj"
        for d in (home, state, proj):
            d.mkdir(parents=True, exist_ok=True)
        (home / "pi-agent").mkdir(parents=True, exist_ok=True)
        evidence = EVIDENCE_DIR / f"{cols}x{rows}"
        evidence.mkdir(parents=True, exist_ok=True)
        checks: list[tuple[str, bool, str]] = []

        def check(name: str, ok: bool, detail: str = ""):
            checks.append((name, bool(ok), detail))

        env = scrubbed_env(home, state, cols, rows)
        # Prove isolation: no leftover credential vars.
        leaked = [k for k in env if any(s in k.upper() for s in ("API_KEY", "ANTHROPIC", "OPENAI", "CURSOR_API"))]
        check("env has no credential keys", leaked == [], str(leaked))

        p = Pty(binary, cols, rows, env, proj)
        try:
            log_path = state / "sidecar.log"

            def log_lines() -> list[str]:
                return log_path.read_text(errors="replace").splitlines() if log_path.exists() else []

            ok_ready = p.wait_for(lambda: any('out {"type":"ready"' in l for l in log_lines()), 25.0)
            check("sidecar ready (REAL stdio loop)", ok_ready)
            p.pump(0.8)
            (evidence / "screen.after-ready.txt").write_text(p.text() + "\n", encoding="utf-8")
            (evidence / "flat.after-ready.txt").write_text(flat(p) + "\n", encoding="utf-8")
            shutil.copy2(log_path, evidence / "sidecar.log") if log_path.exists() else None

            ready = ready_engine(log_lines())
            engine = ready.get("engine") if isinstance(ready, dict) else None
            status = engine.get("status") if isinstance(engine, dict) else None
            check(
                "ready.engine.status is no_model (REAL classifier)",
                status == "no_model",
                json.dumps(engine)[:300] if engine else "missing engine",
            )
            check(
                "classifier log recorded placeholder → no_model",
                any(l.startswith("classifier ") and '"no_model"' in l for l in log_lines()),
                str(log_lines()[:5]),
            )

            shown = flat(p)
            check(
                "Rust UI shows Chat blocked: no_model",
                "Chat blocked: no_model" in shown or "no_model" in shown,
                shown[-500:],
            )

            # Empty compose: Enter must not produce a successful provider turn.
            p.send(b"\r")
            p.pump(0.5)
            (evidence / "screen.after-enter.txt").write_text(p.text() + "\n", encoding="utf-8")
            check(
                "Enter produced no successful prompt in sidecar",
                not any('"success":true' in l and '"command":"prompt"' in l for l in log_lines()),
                str([l for l in log_lines() if "prompt" in l.lower()][:8]),
            )
            check(
                "still no connected engine after Enter",
                not any('"status":"connected"' in l and '"type":"ready"' in l for l in log_lines()),
                str(ready_engine(log_lines())),
            )

            p.send(b"q")
            code = p.wait_exit(10.0)
            check("host exits cleanly", code == 0, str(code))
        except Exception as exc:  # noqa: BLE001
            check(f"scenario crashed: {exc}", False, repr(exc))
        finally:
            p.kill()
            if not os.environ.get("KAIRO_PACKAGED_NO_MODEL_KEEP"):
                shutil.rmtree(base, ignore_errors=True)

        print(f"\n== packaged-no-model @{cols}x{rows} ==")
        for name, ok, detail in checks:
            mark = "PASS" if ok else "FAIL"
            print(f"  [{mark}] {name}" + (f" — {detail[:220]}" if detail and not ok else ""))
            if not ok:
                failed += 1

    readme = EVIDENCE_DIR / "README.md"
    readme.write_text(
        "\n".join(
            [
                "# Packaged host — no_model evidence",
                "",
                "Isolated check: prebuilt `kairo-ui` + real sidecar classifier.",
                "No credentials. No network. Temp HOME / HARNESS_HOME / PI_CODING_AGENT_DIR.",
                "",
                "This is **not** Claude's published-Pi RPC-only cold start; it is the",
                "integrated packaged host path. Default Pi child is a local fake that",
                "returns the same placeholder model shape; classifier is real.",
                "",
                "Look at `*/screen.after-ready.txt` for `Chat blocked: no_model`.",
                "",
            ]
        ),
        encoding="utf-8",
    )

    if failed:
        print(f"\nPackaged no_model FAIL: {failed} check(s)", file=sys.stderr)
        return 1
    print(
        "\nPackaged no_model PASS — REAL: prebuilt host + classifier; "
        "Pi child placeholder shape (or REAL_PI if requested)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
