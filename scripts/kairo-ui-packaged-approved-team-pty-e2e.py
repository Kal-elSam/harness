#!/usr/bin/env python3
"""Packaged host: approved team → usable Claude provider (single authorized run).

Auth gate: KAIRO_PACKAGED_APPROVED_TEAM=1
Provider: claude-haiku-4-5 via claude.ai Pro login (real HOME / CLAUDE_CONFIG_DIR)
Pi: published real package (no silent sim)
PASS: engine connected AND real OK answer within 60s. Any error = FAIL.

Does not certify analysis, other providers, tools, or cancel.
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
SIDECAR = ROOT / "src" / "global" / "host" / "kairo-ui-rpc-stdio.js"
SEED = ROOT / "scripts" / "seed-packaged-approved-team.mjs"
NODE = os.environ.get("KAIRO_UI_NODE") or os.environ.get("NODE") or "node"
EVIDENCE_DIR = Path(
    os.environ.get("KAIRO_PTY_EVIDENCE_DIR", "/tmp/kairo-acceptance-prep/packaged-approved-team")
)
PROMPT = "Reply with the single word OK."
WALL_S = 60.0


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


def die(msg: str, code: int = 1) -> None:
    print(f"Packaged approved-team FAIL: {msg}", file=sys.stderr)
    raise SystemExit(code)


def main() -> int:
    if os.environ.get("KAIRO_PACKAGED_APPROVED_TEAM") != "1":
        die("refusing to run without KAIRO_PACKAGED_APPROVED_TEAM=1 (explicit auth gate)", 2)

    binary = BASE.resolve_binary()
    if not SIDECAR.is_file():
        die(f"missing real sidecar: {SIDECAR}")
    if not SEED.is_file():
        die(f"missing seed script: {SEED}")

    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    base = Path(tempfile.mkdtemp(prefix="kairo-packaged-approved-team-")).resolve()
    harness_home = base / "harness-home"
    pi_home = base / "pi-home"
    proj = base / "proj"
    for d in (harness_home, pi_home, proj):
        d.mkdir(parents=True, exist_ok=True)
    (pi_home / "pi-agent").mkdir(parents=True, exist_ok=True)

    git = subprocess.run(["git", "init", "-q"], cwd=proj, capture_output=True, text=True)
    if git.returncode != 0:
        die(f"git init failed: {git.stderr}")

    # Seed + real approve (no analysis). Uses temp HARNESS_HOME only.
    seed_env = os.environ.copy()
    seed_env["KAIRO_APPROVED_TEAM_PROJ"] = str(proj)
    seed_env["KAIRO_APPROVED_TEAM_HOME"] = str(harness_home)
    seed_env["HARNESS_HOME"] = str(harness_home)
    seed = subprocess.run(
        [NODE, str(SEED)],
        cwd=str(ROOT),
        env=seed_env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    (EVIDENCE_DIR / "seed-approve.stdout.txt").write_text(seed.stdout or "", encoding="utf-8")
    (EVIDENCE_DIR / "seed-approve.stderr.txt").write_text(seed.stderr or "", encoding="utf-8")
    if seed.returncode != 0:
        die(f"seed/approve failed (exit {seed.returncode}): {seed.stderr or seed.stdout}")

    try:
        seed_json = json.loads((seed.stdout or "").strip().splitlines()[-1])
    except Exception as exc:  # noqa: BLE001
        die(f"seed output not JSON: {exc}: {seed.stdout!r}")
    (EVIDENCE_DIR / "seed-approve.json").write_text(json.dumps(seed_json, indent=2) + "\n", encoding="utf-8")

    cols, rows = 100, 30
    real_home = os.path.expanduser("~")
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": real_home,  # claude.ai Pro login; do NOT set CLAUDE_CONFIG_DIR
        "HARNESS_HOME": str(harness_home),
        "PI_CODING_AGENT_DIR": str(pi_home / "pi-agent"),
        "LANG": "en_US.UTF-8",
        "TERM": "xterm-256color",
        "COLUMNS": str(cols),
        "LINES": str(rows),
        "KAIRO_UI_BRIDGE": "1",
        "KAIRO_UI_RPC_SCRIPT": str(SIDECAR),
        "KAIRO_UI_NODE": NODE,
        "USER": os.environ.get("USER", ""),
        "LOGNAME": os.environ.get("LOGNAME", ""),
        "SHELL": os.environ.get("SHELL", "/bin/zsh"),
        "TMPDIR": os.environ.get("TMPDIR", "/tmp"),
    }
    # Do not scrub Claude auth; drop unrelated cloud keys from the child.
    # Never forward CLAUDE_CONFIG_DIR — an explicit value breaks loggedIn.
    for key, value in os.environ.items():
        if key == "CLAUDE_CONFIG_DIR":
            continue
        upper = key.upper()
        if any(s in upper for s in ("OPENAI", "ANTHROPIC_API", "CURSOR_API", "OPENCODE", "AWS_", "GEMINI", "GOOGLE_API")):
            continue
        if key in ("NODE", "KAIRO_UI_NODE", "KAIRO_UI_BINARY", "SSH_AUTH_SOCK"):
            env.setdefault(key, value)

    (EVIDENCE_DIR / "env.redacted.json").write_text(
        json.dumps(
            {
                "HOME": env["HOME"],
                "HARNESS_HOME": env["HARNESS_HOME"],
                "CLAUDE_CONFIG_DIR": env.get("CLAUDE_CONFIG_DIR", "<unset-intentional>"),
                "PI_CODING_AGENT_DIR": env["PI_CODING_AGENT_DIR"],
                "KAIRO_UI_RPC_SCRIPT": env["KAIRO_UI_RPC_SCRIPT"],
                "has_anthropic_api_key": bool(os.environ.get("ANTHROPIC_API_KEY")),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    checks: list[tuple[str, bool, str]] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        checks.append((name, bool(ok), detail))

    check("seed approve status active", seed_json.get("status") == "active", json.dumps(seed_json)[:400])

    p = Pty(binary, cols, rows, env, proj)
    t0 = time.monotonic()
    try:
        # Wait for ready with connected engine (or fail with whatever status we got).
        def ready_line() -> dict | None:
            # Sidecar writes to stdout; host may not mirror. Parse Pty log if any —
            # the real sidecar does not use our packaged-no-model log file.
            # Capture from screen banners and from a sidecar tee if present.
            return None

        # Pump until UI leaves Chat blocked / no_model strategy message, max ~25s of wall for connect.
        connected_ui = False
        engine_detail = ""
        while time.monotonic() - t0 < 25.0:
            p.pump(0.4)
            shown = flat(p)
            if "Chat blocked" not in shown and "no_model" not in shown.lower():
                # Might still be loading; require positive signal
                pass
            if re.search(r"\bconnected\b", shown, re.I) or (
                "Chat blocked" not in shown and "Pi engine" not in shown and "Message Kairo" in shown
            ):
                # Prefer explicit absence of block after ready chrome exists
                if "Message Kairo" in shown and "Chat blocked" not in shown:
                    connected_ui = True
                    engine_detail = shown[-600:]
                    break
            if "Chat blocked: unavailable" in shown:
                engine_detail = shown[-800:]
                break
            if "Chat blocked: no_model" in shown and "No active strategy" not in shown:
                # Architect missing vs strategy-less — still not connected
                engine_detail = shown[-800:]
                break

        (EVIDENCE_DIR / "screen.after-ready.txt").write_text(p.text() + "\n", encoding="utf-8")
        (EVIDENCE_DIR / "flat.after-ready.txt").write_text(flat(p) + "\n", encoding="utf-8")

        shown_ready = flat(p)
        # Honest connect signal: team present and chat not blocked (ASK no longer
        # requires Pi can_prompt, but product path still needs approved team).
        connected_ok = (
            "Chat blocked" not in shown_ready
            and "No team yet" not in shown_ready
            and "Message Kairo" in shown_ready
        )
        check(
            "engine/team ready (not blocked, team present)",
            connected_ok or connected_ui,
            engine_detail or shown_ready[-800:],
        )

        # Single ASK prompt. Wait for compose before typing (leading char can drop).
        p.pump(1.0)
        p.type_text(PROMPT)
        p.send(b"\r")
        answered = False
        answer_detail = ""
        while time.monotonic() - t0 < WALL_S:
            p.pump(0.5)
            shown = flat(p)
            # Product notice shape: "claude · claude-haiku-4-5: OK"
            if re.search(r"claude\s*[·.]\s*claude-haiku-4-5:\s*OK\b", shown, re.I):
                answered = True
                answer_detail = shown[-800:]
                break
            if re.search(r"\berror\b", shown, re.I) and "claude-haiku-4-5: OK" not in shown:
                answer_detail = shown[-800:]

        (EVIDENCE_DIR / "screen.after-prompt.txt").write_text(p.text() + "\n", encoding="utf-8")
        (EVIDENCE_DIR / "flat.after-prompt.txt").write_text(flat(p) + "\n", encoding="utf-8")

        check("real OK answer observed within 60s", answered, answer_detail or flat(p)[-800:])

        elapsed = time.monotonic() - t0
        (EVIDENCE_DIR / "timing.json").write_text(
            json.dumps({"elapsedSec": round(elapsed, 3), "wallLimitSec": WALL_S}, indent=2) + "\n",
            encoding="utf-8",
        )

        p.send(b"q")
        code = p.wait_exit(10.0)
        check("host exits", code == 0, str(code))
    except Exception as exc:  # noqa: BLE001
        (EVIDENCE_DIR / "exception.txt").write_text(f"{type(exc).__name__}: {exc}\n", encoding="utf-8")
        try:
            (EVIDENCE_DIR / "screen.on-error.txt").write_text(p.text() + "\n", encoding="utf-8")
        except Exception:
            pass
        die(f"exception: {exc}")
    finally:
        try:
            p.close()
        except Exception:
            pass
        # Keep temp tree path for forensics
        (EVIDENCE_DIR / "temp-base.txt").write_text(str(base) + "\n", encoding="utf-8")

    print("\n== packaged approved-team @100x30 ==")
    failed = 0
    for name, ok, detail in checks:
        mark = "PASS" if ok else "FAIL"
        if not ok:
            failed += 1
        print(f"  [{mark}] {name}" + (f" — {detail[:200]}" if detail and not ok else ""))

    report = {
        "scenario": "packaged-approved-team-claude-haiku",
        "pi": "published-real",
        "provider": "claude",
        "model": "claude-haiku-4-5",
        "auth": "claude.ai Pro login (HOME/CLAUDE_CONFIG_DIR)",
        "prompt": PROMPT,
        "passRequires": "connected + real OK answer",
        "checks": [{"name": n, "ok": ok, "detail": d[:500]} for n, ok, d in checks],
        "failed": failed,
        "evidenceDir": str(EVIDENCE_DIR),
    }
    (EVIDENCE_DIR / "RESULT.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    if failed:
        print(f"\nPackaged approved-team FAIL: {failed} check(s)", file=sys.stderr)
        return 1
    print("\nPackaged approved-team PASS — connected + real OK (claude-haiku-4-5)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
