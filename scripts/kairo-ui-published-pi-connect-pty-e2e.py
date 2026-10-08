#!/usr/bin/env python3
"""Packaged host: published Pi handshake only → engine.status=connected.

Stops after the connected assertion. Does NOT send an ASK/chat prompt.
Does NOT re-run provider OK prompts (those remain separately certified).

Auth gate: KAIRO_PUBLISHED_PI_CONNECT=1
  Refuse (exit 2) without the gate — prepare/ask only until authorized.

Credentials / surfaces required for an authorized run:
  1. Published package `@kal-elsam/kairo-pi-coding-agent` resolvable under
     this repo's node_modules (same as other REAL_PI paths).
  2. Architect route Claude Haiku 4.5 via **claude.ai Pro** login in the
     real user HOME (`~/.claude`). Do NOT set CLAUDE_CONFIG_DIR.
  3. Readable `$HARNESS_HOME/claude-entitlement.json` (or
     `KAIRO_REAL_HARNESS_HOME`) with `claude-haiku-4-5.status == allowed`
     for the seed copy into the temp harness home.
  4. Prebuilt `kairo-ui` binary (`KAIRO_UI_BINARY` or dist host triple).

Pi: published real package behind the tee (`KAIRO_PI_MODE=real`). No silent
sim fallback. Evidence from sidecar.jsonl only for engine status.

PASS: `ready` within 25 s AND `ready.engine.status == connected` with a
model identity. Then quit. No prompt typed.

Limits: certifies published-Pi handshake after seeded approve only — not
ASK, analysis, other providers, tools, cancel, or a second inference turn.
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
SIDECAR = ROOT / "scripts" / "fixtures" / "kairo-ui-tee-sidecar.mjs"
REAL_SIDECAR = ROOT / "src" / "global" / "host" / "kairo-ui-rpc-stdio.js"
SEED = ROOT / "scripts" / "seed-packaged-approved-team.mjs"
NODE = os.environ.get("KAIRO_UI_NODE") or os.environ.get("NODE") or "node"
EVIDENCE_DIR = Path(
    os.environ.get(
        "KAIRO_PTY_EVIDENCE_DIR",
        "/tmp/kairo-acceptance-prep/published-pi-connect",
    )
)
EXPECTED_ARCHITECT = {
    "adapterId": "claude",
    "modelId": "claude-haiku-4-5",
    "candidateKey": "claude::claude-haiku-4-5",
    "displayName": "Claude Haiku 4.5",
}
PUBLISHED_PI_CLI = (
    ROOT / "node_modules" / "@kal-elsam" / "kairo-pi-coding-agent" / "dist" / "cli.js"
)


def _load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


BASE = _load("kairo_pty_base", "kairo-ui-pty-e2e.py")
EV = _load("kairo_sidecar_evidence", "kairo-sidecar-evidence.py")
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
    print(f"Published-Pi connect FAIL: {msg}", file=sys.stderr)
    raise SystemExit(code)


def main() -> int:
    if os.environ.get("KAIRO_PUBLISHED_PI_CONNECT") != "1":
        die(
            "refusing to run without KAIRO_PUBLISHED_PI_CONNECT=1 "
            "(explicit auth — handshake only, no ASK prompt)",
            2,
        )

    binary = BASE.resolve_binary()
    if not SIDECAR.is_file() or not REAL_SIDECAR.is_file():
        die(f"missing tee or real sidecar: {SIDECAR} / {REAL_SIDECAR}")
    if not SEED.is_file():
        die(f"missing seed script: {SEED}")
    if not PUBLISHED_PI_CLI.is_file():
        die(
            f"published Pi CLI missing (no sim fallback): {PUBLISHED_PI_CLI}",
            2,
        )

    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    for stale in (EV.SIDECAR_JSONL, EV.SIDECAR_STDERR_LOG):
        (EVIDENCE_DIR / stale).unlink(missing_ok=True)

    base = Path(tempfile.mkdtemp(prefix="kairo-published-pi-connect-")).resolve()
    harness_home = base / "harness-home"
    pi_home = base / "pi-home"
    proj = base / "proj"
    for d in (harness_home, pi_home, proj):
        d.mkdir(parents=True, exist_ok=True)
    (pi_home / "pi-agent").mkdir(parents=True, exist_ok=True)

    git = subprocess.run(["git", "init", "-q"], cwd=proj, capture_output=True, text=True)
    if git.returncode != 0:
        die(f"git init failed: {git.stderr}")

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
    (EVIDENCE_DIR / "seed-approve.json").write_text(
        json.dumps(seed_json, indent=2) + "\n", encoding="utf-8"
    )

    cols, rows = 100, 30
    real_home = os.path.expanduser("~")
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": real_home,
        "HARNESS_HOME": str(harness_home),
        "PI_CODING_AGENT_DIR": str(pi_home / "pi-agent"),
        "LANG": "en_US.UTF-8",
        "TERM": "xterm-256color",
        "COLUMNS": str(cols),
        "LINES": str(rows),
        "KAIRO_UI_BRIDGE": "1",
        "KAIRO_UI_RPC_SCRIPT": str(SIDECAR),
        "KAIRO_PI_MODE": "real",
        "KAIRO_EVIDENCE_DIR": str(EVIDENCE_DIR),
        "KAIRO_UI_NODE": NODE,
        "USER": os.environ.get("USER", ""),
        "LOGNAME": os.environ.get("LOGNAME", ""),
        "SHELL": os.environ.get("SHELL", "/bin/zsh"),
        "TMPDIR": os.environ.get("TMPDIR", "/tmp"),
    }
    for key, value in os.environ.items():
        if key in ("CLAUDE_CONFIG_DIR", "SSH_AUTH_SOCK"):
            continue
        upper = key.upper()
        if any(
            s in upper
            for s in (
                "OPENAI",
                "ANTHROPIC_API",
                "CURSOR_API",
                "OPENCODE",
                "AWS_",
                "GEMINI",
                "GOOGLE_API",
            )
        ):
            continue
        if key in ("NODE", "KAIRO_UI_NODE", "KAIRO_UI_BINARY"):
            env.setdefault(key, value)

    (EVIDENCE_DIR / "env.redacted.json").write_text(
        json.dumps(
            {
                "HOME": env["HOME"],
                "HARNESS_HOME": env["HARNESS_HOME"],
                "CLAUDE_CONFIG_DIR": "<unset-intentional>",
                "SSH_AUTH_SOCK": "<stripped-intentional>",
                "PI_CODING_AGENT_DIR": env["PI_CODING_AGENT_DIR"],
                "KAIRO_PI_MODE": "real",
                "prompt": None,
                "expectedArchitect": EXPECTED_ARCHITECT,
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
    # Exact Architect identity from seed output (model field) before launch.
    seed_model_id = seed_json.get("model")
    roles = seed_json.get("roles") or []
    check(
        "seed Architect is Claude Haiku 4.5",
        seed_model_id == EXPECTED_ARCHITECT["modelId"] and "Architect" in roles,
        json.dumps({"model": seed_model_id, "roles": roles, "seed": seed_json}, default=str)[:600],
    )
    check("SSH_AUTH_SOCK not forwarded", "SSH_AUTH_SOCK" not in env, str(env.get("SSH_AUTH_SOCK")))
    check("published Pi CLI present (no sim)", PUBLISHED_PI_CLI.is_file(), str(PUBLISHED_PI_CLI))

    p = Pty(binary, cols, rows, env, proj)
    try:
        sidecar_jsonl = EVIDENCE_DIR / EV.SIDECAR_JSONL
        try:
            ready = EV.wait_for_ready(sidecar_jsonl, timeout_s=EV.READY_TIMEOUT_S, pump=p.pump)
        except EV.EvidenceTimeout as exc:
            (EVIDENCE_DIR / "screen.on-ready-timeout.txt").write_text(p.text() + "\n", encoding="utf-8")
            die(f"real `ready` event never arrived: {exc}")

        (EVIDENCE_DIR / "screen.after-ready.txt").write_text(p.text() + "\n", encoding="utf-8")
        (EVIDENCE_DIR / "flat.after-ready.txt").write_text(flat(p) + "\n", encoding="utf-8")

        engine = ready.get("engine") or {}
        model = engine.get("model") if isinstance(engine.get("model"), dict) else {}
        model_id = str(model.get("id") or "")
        model_label = str(
            ready.get("modelLabel") or engine.get("modelLabel") or model.get("name") or ""
        )
        engine_summary = json.dumps(
            {
                "status": engine.get("status"),
                "reason": engine.get("reason"),
                "model": model,
                "modelLabel": model_label,
            }
        )
        check(
            "ready.engine.status == connected (sidecar.jsonl)",
            engine.get("status") == "connected",
            engine_summary,
        )
        check(
            "connected model is Claude Haiku 4.5 (id or label)",
            EXPECTED_ARCHITECT["modelId"] in model_id
            or EXPECTED_ARCHITECT["candidateKey"] in model_id
            or EXPECTED_ARCHITECT["modelId"] in model_label
            or "haiku-4-5" in model_id.lower()
            or "haiku 4.5" in model_label.lower(),
            engine_summary,
        )
        # Handshake only — never type a prompt / never call a provider for OK.
        check("no ASK prompt sent (handshake-only)", True, "prompt skipped by design")

        p.send(b"q")
        code = p.wait_exit(10.0)
        if code is None:
            p.send(b"\x1b")
            p.pump(0.2)
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
        (EVIDENCE_DIR / "temp-base.txt").write_text(str(base) + "\n", encoding="utf-8")
        if not os.environ.get("KAIRO_PUBLISHED_PI_CONNECT_KEEP"):
            shutil.rmtree(base, ignore_errors=True)

    print("\n== published-Pi connect (handshake only) ==")
    failed = 0
    for name, ok, detail in checks:
        mark = "PASS" if ok else "FAIL"
        if not ok:
            failed += 1
        print(f"  [{mark}] {name}" + (f" — {detail[:220]}" if detail and not ok else ""))

    report = {
        "scenario": "published-pi-connect-handshake",
        "pi": "published-real",
        "providerArchitect": "claude",
        "model": "claude-haiku-4-5",
        "auth": "claude.ai Pro (HOME; CLAUDE_CONFIG_DIR unset) + entitlement copy",
        "prompt": None,
        "passRequires": "ready.engine.status connected from sidecar.jsonl (no ASK)",
        "checks": [{"name": n, "ok": o, "detail": d[:500]} for n, o, d in checks],
        "limits": [
            "Handshake only — no ASK / no inference turn",
            "Does not re-certify adapter OK prompts",
            "Seeded approve before launch (not in-host A path)",
        ],
    }
    (EVIDENCE_DIR / "RESULT.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    if failed:
        print(f"\nPublished-Pi connect FAIL: {failed} check(s)", file=sys.stderr)
        return 1
    print("\nPublished-Pi connect PASS — engine.connected (no prompt)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
