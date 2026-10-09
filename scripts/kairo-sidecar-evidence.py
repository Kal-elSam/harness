"""Read sidecar protocol evidence written by the transparent tee sidecar.

The tee sidecar (scripts/fixtures/kairo-ui-tee-sidecar.mjs) writes every stdout
JSONL record to <EVIDENCE_DIR>/sidecar.jsonl. Harnesses assert on those REAL
records (`ready`, `engine`, ...), never on screen text. A missing record is an
explicit EvidenceTimeout, never an inferred pass.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Callable

SIDECAR_JSONL = "sidecar.jsonl"
SIDECAR_STDERR_LOG = "sidecar.stderr.log"
FAKE_PI_REQUESTS = "fake-pi-requests.jsonl"
READY_TIMEOUT_S = 25.0


class EvidenceTimeout(AssertionError):
    """Expected protocol record never arrived within the explicit timeout."""


def read_records(path: Path) -> tuple[list[dict], int]:
    """Parse JSONL. Returns (records, malformed_count). Missing file => ([], 0)."""
    path = Path(path)
    if not path.is_file():
        return [], 0
    records: list[dict] = []
    malformed = 0
    for line in path.read_text(encoding="utf-8", errors="replace").split("\n"):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except ValueError:
            malformed += 1
            continue
        if isinstance(value, dict):
            records.append(value)
        else:
            malformed += 1
    return records, malformed


def _wait(
    path: Path,
    predicate: Callable[[list[dict]], dict | None],
    what: str,
    timeout_s: float,
    poll_s: float,
    pump: Callable[[float], object] | None,
) -> dict:
    end = time.monotonic() + timeout_s
    while True:
        found = predicate(read_records(path)[0])
        if found is not None:
            return found
        if time.monotonic() >= end:
            break
        if pump is not None:
            pump(poll_s)  # keep the PTY drained while waiting
        else:
            time.sleep(poll_s)
    records, malformed = read_records(path)
    seen = [r.get("type") for r in records]
    raise EvidenceTimeout(
        f"{what} not seen in {path} within {timeout_s:.1f}s "
        f"(records={len(records)}, malformed={malformed}, types={seen[:20]})"
    )


def wait_for_ready(
    path: Path,
    timeout_s: float = READY_TIMEOUT_S,
    poll_s: float = 0.2,
    pump: Callable[[float], object] | None = None,
) -> dict:
    """Wait for the REAL sidecar `ready` record; raise EvidenceTimeout otherwise."""
    return _wait(
        path,
        lambda recs: next((r for r in recs if r.get("type") == "ready"), None),
        "`ready` record",
        timeout_s,
        poll_s,
        pump,
    )


def wait_for_record(
    path: Path,
    predicate: Callable[[dict], bool],
    timeout_s: float = 15.0,
    poll_s: float = 0.2,
    pump: Callable[[float], object] | None = None,
    after: int = 0,
    what: str = "matching record",
) -> dict:
    """Wait for a record (at index >= `after`) satisfying `predicate`."""
    return _wait(
        path,
        lambda recs: next((r for r in recs[after:] if predicate(r)), None),
        what,
        timeout_s,
        poll_s,
        pump,
    )


def requests_of_type(path: Path, request_type: str) -> list[dict]:
    """Requests the fake Pi recorded (fake-pi-requests.jsonl) of one type."""
    return [r for r in read_records(path)[0] if r.get("type") == request_type]
