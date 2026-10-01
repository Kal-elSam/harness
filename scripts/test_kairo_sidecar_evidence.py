#!/usr/bin/env python3
"""Unit tests for scripts/kairo-sidecar-evidence.py (stdlib unittest).

Run: python3 scripts/test_kairo_sidecar_evidence.py
"""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("kairo_sidecar_evidence", ROOT / "scripts" / "kairo-sidecar-evidence.py")
EV = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(EV)


def write(path: Path, *records, raw: str = "") -> None:
    path.write_text("".join(json.dumps(r) + "\n" for r in records) + raw, encoding="utf-8")


class ReadRecordsTest(unittest.TestCase):
    def test_missing_file_is_empty(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(EV.read_records(Path(d) / "nope.jsonl"), ([], 0))

    def test_skips_blank_and_counts_malformed(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "s.jsonl"
            write(p, {"type": "ready"}, raw='\nnot json\n{"type":"x"')
            records, malformed = EV.read_records(p)
            self.assertEqual([r["type"] for r in records], ["ready"])
            self.assertEqual(malformed, 2)


class WaitForReadyTest(unittest.TestCase):
    def test_returns_real_ready_record(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "s.jsonl"
            write(p, {"type": "mode"}, {"type": "ready", "engine": {"status": "no_model"}})
            ready = EV.wait_for_ready(p, timeout_s=1.0)
            self.assertEqual(ready["engine"]["status"], "no_model")

    def test_timeout_is_an_explicit_failure_not_a_screen_proxy(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "s.jsonl"
            write(p, {"type": "mode"})  # protocol traffic but never `ready`
            with self.assertRaises(EV.EvidenceTimeout) as ctx:
                EV.wait_for_ready(p, timeout_s=0.3, poll_s=0.05)
            self.assertIn("ready", str(ctx.exception))

    def test_pump_is_called_while_waiting(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "s.jsonl"
            calls = []
            with self.assertRaises(EV.EvidenceTimeout):
                EV.wait_for_ready(p, timeout_s=0.2, poll_s=0.05, pump=lambda s: calls.append(s))
            self.assertGreaterEqual(len(calls), 2)


class WaitForRecordTest(unittest.TestCase):
    def test_waits_for_matching_record_after_index(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "s.jsonl"
            write(p, {"type": "engine", "engine": {"status": "no_model"}}, {"type": "engine", "engine": {"status": "connected"}})
            rec = EV.wait_for_record(p, lambda r: r.get("type") == "engine" and r["engine"]["status"] == "connected", timeout_s=0.5)
            self.assertEqual(rec["engine"]["status"], "connected")
            with self.assertRaises(EV.EvidenceTimeout):
                EV.wait_for_record(p, lambda r: r.get("type") == "engine", timeout_s=0.2, poll_s=0.05, after=2)


class RequestsTest(unittest.TestCase):
    def test_requests_of_type(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "fake-pi-requests.jsonl"
            write(p, {"seq": 1, "type": "get_state", "params": {}}, {"seq": 2, "type": "set_model", "params": {"provider": "kairo", "modelId": "m"}})
            self.assertEqual([r["seq"] for r in EV.requests_of_type(p, "set_model")], [2])


if __name__ == "__main__":
    unittest.main()
