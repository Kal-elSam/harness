#!/usr/bin/env node
/**
 * Transparent tee sidecar for PTY evidence.
 *
 * Runs the REAL sidecar entry (`runKairoUiRpcStdio`) and:
 *   - copies every stdout byte, unchanged, to `<KAIRO_EVIDENCE_DIR>/sidecar.jsonl`
 *     (what Ratatui reads is byte-identical; the tee never touches stdout),
 *   - logs stderr separately to `<KAIRO_EVIDENCE_DIR>/sidecar.stderr.log`
 *     with secrets redacted (stderr itself still passes through).
 *
 * Env:
 *   KAIRO_EVIDENCE_DIR      required
 *   KAIRO_PI_MODE           "simulated" (default) | "real"
 *                           real: no injection at all (published Pi, real seams)
 *   KAIRO_SIM_PI_SCENARIO   simulated only; see simulated-pi-host.mjs SCENARIOS
 *   KAIRO_SIM_PI_TIMEOUT_MS simulated only; Pi RPC connect timeout (default 1500)
 *
 * Simulated mode is labeled "simulated Pi": fake child, no provider/network.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { runKairoUiRpcStdio } from "../../src/global/host/kairo-ui-rpc-stdio.js";
import {
  SIDECAR_JSONL,
  SIDECAR_STDERR_LOG,
  createRedactedStderrLog,
  createStdoutTee
} from "./sidecar-evidence.mjs";
import { buildSimulatedHostOptions } from "./simulated-pi-host.mjs";

const dir = process.env.KAIRO_EVIDENCE_DIR;
if (!dir) {
  process.stderr.write("KAIRO_EVIDENCE_DIR is required\n");
  process.exit(2);
}
mkdirSync(dir, { recursive: true });

const stderrLog = createRedactedStderrLog(join(dir, SIDECAR_STDERR_LOG));
const realStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...rest) => {
  stderrLog.write(chunk);
  return realStderrWrite(chunk, ...rest);
};

const cwdIdx = process.argv.indexOf("--cwd");
const cwd = cwdIdx >= 0 ? process.argv[cwdIdx + 1] : process.cwd();
const mode = process.env.KAIRO_PI_MODE || "simulated";

try {
  if (mode !== "simulated" && mode !== "real") {
    throw new Error(`Unknown KAIRO_PI_MODE "${mode}" (expected simulated|real)`);
  }
  const injected =
    mode === "real"
      ? {}
      : buildSimulatedHostOptions({
          cwd,
          evidenceDir: dir,
          scenario: process.env.KAIRO_SIM_PI_SCENARIO || "positive",
          connectTimeoutMs: Number(process.env.KAIRO_SIM_PI_TIMEOUT_MS) || 1500,
          env: process.env
        });
  await runKairoUiRpcStdio({
    stdin: process.stdin,
    stdout: createStdoutTee(process.stdout, join(dir, SIDECAR_JSONL)),
    cwd,
    env: process.env,
    ...injected
  });
} catch (err) {
  process.stderr.write(`${err?.stack ?? err?.message ?? err}\n`);
  process.exitCode = 1;
}
