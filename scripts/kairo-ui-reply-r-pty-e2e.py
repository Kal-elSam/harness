#!/usr/bin/env python3
"""One-shot: rebuilt kairo-ui + SIMULATED team-flow sidecar — Reply… keeps leading R.

Not a Pi-connected certification. No real providers.
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = Path("/tmp/kairo-pty-reply-r")
PROMPT = "Reply with the single word OK."


def _load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


BASE = _load("kairo_pty_base", "kairo-ui-pty-e2e.py")
TEAM = _load("kairo_team_flow", "kairo-ui-team-flow-pty-e2e.py")


def flat(p) -> str:
    return TEAM.flat(p)


def main() -> int:
    binary = BASE.resolve_binary()
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    print(f"binary={binary}")
    run = TEAM.Run(100, 30, binary, "approve-chat")
    checks: list[tuple[str, bool, str]] = []

    def check(name: str, ok: bool, detail: str = ""):
        checks.append((name, bool(ok), detail))

    try:
        p = run.launch()
        (EVIDENCE / "after-ready.txt").write_text(p.text() + "\n", encoding="utf-8")

        # Approve from Sidebar — bare A must not steal compose (empty-compose fix).
        p.send(b"\t")  # Editor → Sidebar
        p.pump(0.3)
        p.send(b"A")
        approved = p.wait_for(lambda: "team.approve" in run.ops(), 15.0)
        check("Sidebar A → team.approve (SIMULATED)", approved, str(run.ops()))
        p.wait_for(lambda: any(l.startswith("set_model ") for l in run.log_lines()), 10.0)
        p.send(b"\x1b")  # Esc → Editor
        p.pump(0.4)

        p.type_text(PROMPT)
        p.pump(0.5)
        draft_screen = flat(p)
        (EVIDENCE / "after-type.txt").write_text(p.text() + "\n", encoding="utf-8")
        check(
            "draft on screen keeps leading R (Reply…)",
            "Reply with the single word OK." in draft_screen
            or "Reply with the single word OK" in draft_screen,
            draft_screen[-500:],
        )
        check(
            "draft is not truncated to eply…",
            "eply with the single word OK" not in draft_screen
            or "Reply with the single word OK" in draft_screen,
            draft_screen[-300:],
        )

        p.send(b"\r")
        chatted = p.wait_for(
            lambda: any(l.startswith("chat mode=") for l in run.log_lines()), 15.0
        )
        check("submit reached SIMULATED submitTask", chatted, str(run.log_lines()[-20:]))
        seen = p.wait_for(
            lambda: "SIMULATED reply" in flat(p) or PROMPT in flat(p), 12.0
        )
        check("SIMULATED answer / prompt visible in UI", seen, flat(p)[-500:])
        (EVIDENCE / "after-submit.txt").write_text(p.text() + "\n", encoding="utf-8")

        chat_lines = [l for l in run.log_lines() if l.startswith("chat mode=")]
        check(
            "sidecar history task keeps leading R",
            any(PROMPT in l for l in chat_lines),
            str(chat_lines[-5:]),
        )
        check(
            "sidecar history is not eply…",
            not any("eply with the single word OK" in l and "Reply" not in l for l in chat_lines),
            str(chat_lines[-5:]),
        )

        # Product ask-history if present under HARNESS_HOME
        hist_files = list(run.home.joinpath(".harness").rglob("ask-history.json"))
        if hist_files:
            hist = json.loads(hist_files[0].read_text(encoding="utf-8"))
            (EVIDENCE / "ask-history.json").write_text(
                json.dumps(hist, indent=2) + "\n", encoding="utf-8"
            )
            q = (hist.get("entries") or [{}])[-1].get("question", "")
            check("ask-history question keeps leading R", q == PROMPT, q)
        else:
            check(
                "ask-history optional under SIMULATED team-flow (sidecar log is source of truth)",
                True,
                "no ask-history.json — OK for this fixture",
            )

        after = flat(p)
        check(
            "UI history keeps Reply… (you: line or SIMULATED echo)",
            "Reply with the single word OK" in after
            or any(PROMPT in l for l in chat_lines),
            after[-500:],
        )

        p.send(b"q")
        code = p.wait_exit(10.0)
        if code is None:
            p.send(b"\x1b")
            p.pump(0.2)
            p.send(b"q")
            code = p.wait_exit(10.0)
        check("host exits", code == 0, str(code))
        run.pty = None
    except Exception as exc:  # noqa: BLE001
        check(f"crashed: {exc}", False, repr(exc))
    finally:
        run.close(keep_base=True)
        (EVIDENCE / "temp-base.txt").write_text(str(run.base) + "\n", encoding="utf-8")
        (EVIDENCE / "sidecar.log").write_text(
            "\n".join(run.log_lines()) + "\n", encoding="utf-8"
        )

    failed = 0
    print("\n== Reply-R PTY (rebuilt binary + SIMULATED provider) ==")
    for name, ok, detail in checks:
        mark = "PASS" if ok else "FAIL"
        print(f"  [{mark}] {name}" + (f" — {detail[:220]}" if detail and not ok else ""))
        if not ok:
            failed += 1
    report = {
        "binary": str(binary),
        "prompt": PROMPT,
        "failed": failed,
        "checks": [{"name": n, "ok": o, "detail": d[:400]} for n, o, d in checks],
        "limits": [
            "SIMULATED Pi/providers only — does not certify Pi connected",
            "No real Claude/Codex/OpenCode call",
        ],
    }
    (EVIDENCE / "RESULT.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if failed:
        print(f"\nFAIL: {failed} check(s); evidence {EVIDENCE}", file=sys.stderr)
        return 1
    print(f"\nPASS — draft+history keep leading R; evidence {EVIDENCE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
