#!/usr/bin/env python3
"""Protocol evidence: Settings Connect with host-bridged interactive CLI (fake).

REAL contract: createProviderConnections + host-bridged interactive runner.
SIMULATED: fake status runner + terminal.session_result (no real provider CLI).
Never inherits sidecar RPC stdio for login.

Scenarios: success / fail (nonzero) / cancel (null code).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which(os.environ.get("KAIRO_UI_NODE") or "node") or "node"
EVIDENCE = Path(
    os.environ.get("KAIRO_PTY_EVIDENCE_DIR")
    or Path(tempfile.gettempdir()) / "kairo-connections-pty"
)

SCRIPT = r"""
import { PassThrough } from "node:stream";
import { runKairoUiRpcStdio } from "./src/global/host/kairo-ui-rpc-stdio.js";
import { createFakeRunner } from "./test/helpers/fake-connection-runner.js";

const scenario = process.env.KAIRO_CONNECTIONS_SCENARIO || "success";
const auth = { code: 1, stdout: JSON.stringify({ loggedIn: false }) };
const statusRunner = createFakeRunner({
  "claude --version": { stdout: "2.1.287\n" },
  "claude auth status --json": auth
});
const out = [];
const stdout = new PassThrough();
stdout.on("data", (c) => {
  for (const line of String(c).split("\n").filter(Boolean)) {
    try { out.push(JSON.parse(line)); } catch {}
  }
});
const stdin = new PassThrough();
const run = runKairoUiRpcStdio({
  stdin, stdout, cwd: process.cwd(),
  env: { KAIRO_SESSION_ID: "aaaaaaaa-0000-4000-8000-000000000001" },
  getSession: async () => ({ id: "aaaaaaaa-0000-4000-8000-000000000001", mode: "ask" }),
  openBridge: async () => ({ request: async () => ({}), stop: async () => {}, sendRaw: () => {}, onEvent: () => {} }),
  loadKairoProviderModels: async () => [],
  loadSnapshot: async () => ({ ok: true }),
  listPiSessionFilesForCwd: () => [],
  resolveProjectRoot: async () => null,
  connectionsStatusRunner: statusRunner,
  buildSettingsSnapshot: async () => ({ ok: true, profile: [], integrations: [], connections: [], catalog: [], setup: { wired: true, label: "x" }, hints: "" })
});
await new Promise((r) => setTimeout(r, 40));
const bootConnect = out.filter((r) => r.type === "connections_connect").length;
stdin.write(JSON.stringify({ op: "connections.status", provider: "claude" }) + "\n");
await new Promise((r) => setTimeout(r, 40));
const before = out.find((r) => r.type === "connections_status");
stdin.write(JSON.stringify({ op: "connections.preview", provider: "claude" }) + "\n");
await new Promise((r) => setTimeout(r, 40));
const preview = out.find((r) => r.type === "connections_preview");
stdin.write(JSON.stringify({
  op: "connections.connect", provider: "claude", fingerprint: preview.previewId, confirm: true
}) + "\n");
await new Promise((r) => setTimeout(r, 50));
const yieldRec = out.find((r) => r.type === "terminal_yield");
const code = scenario === "success" ? 0 : scenario === "fail" ? 1 : null;
if (scenario === "success") {
  auth.code = 0;
  auth.stdout = JSON.stringify({ loggedIn: true, email: "a@example.com", orgId: "o1" });
}
if (yieldRec?.sessionId) {
  stdin.write(JSON.stringify({
    op: "terminal.session_result", sessionId: yieldRec.sessionId, code
  }) + "\n");
  await new Promise((r) => setTimeout(r, 80));
}
stdin.write(JSON.stringify({ op: "connections.status", provider: "claude" }) + "\n");
await new Promise((r) => setTimeout(r, 40));
stdin.write(JSON.stringify({ op: "stop" }) + "\n");
stdin.end();
await run;
const connect = out.filter((r) => r.type === "connections_connect").at(-1);
const after = out.filter((r) => r.type === "connections_status").at(-1);
console.log(JSON.stringify({
  bootConnectCalls: bootConnect,
  beforeAction: before?.inventory?.[0]?.action ?? null,
  yielded: Boolean(yieldRec),
  argv: yieldRec?.argv ?? null,
  restored: out.some((r) => r.type === "terminal_restore"),
  connectOk: connect?.ok ?? null,
  connectOutcome: connect?.outcome ?? null,
  afterAuth: after?.inventory?.[0]?.authentication ?? null,
  afterAction: after?.inventory?.[0]?.action ?? null
}));
"""


def run_scenario(scenario: str) -> dict:
    env = os.environ.copy()
    env["KAIRO_CONNECTIONS_SCENARIO"] = scenario
    proc = subprocess.run(
        [NODE, "--input-type=module", "-e", SCRIPT],
        cwd=str(ROOT),
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"{scenario}: {proc.stderr or proc.stdout}")
    line = [ln for ln in proc.stdout.splitlines() if ln.strip().startswith("{")][-1]
    return json.loads(line)


def main() -> int:
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    checks = []
    results = {}
    for scenario in ("success", "cancel", "fail"):
        data = run_scenario(scenario)
        results[scenario] = data
        checks.append((f"{scenario}: no boot connect", data["bootConnectCalls"] == 0, data))
        checks.append((f"{scenario}: yield with argv", data["yielded"] and data["argv"], data))
        checks.append((f"{scenario}: restore", data["restored"] is True, data))
        checks.append((f"{scenario}: before was connect", data["beforeAction"] == "connect", data))
        if scenario == "success":
            checks.append((f"{scenario}: connected", data["connectOk"] is True and data["connectOutcome"] == "connected", data))
            checks.append((f"{scenario}: inventory authenticated", data["afterAuth"] == "authenticated", data))
        else:
            checks.append((f"{scenario}: not false success", data["connectOk"] is False and data["connectOutcome"] != "connected", data))
    (EVIDENCE / "RESULT.json").write_text(json.dumps({"results": results, "checks": [
        {"name": n, "ok": ok} for n, ok, _ in checks
    ]}, indent=2))
    failed = [c for c in checks if not c[1]]
    for name, ok, detail in checks:
        print(f"{'PASS' if ok else 'FAIL'} {name}")
        if not ok:
            print(f"  {detail}")
    print(f"evidence: {EVIDENCE / 'RESULT.json'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
