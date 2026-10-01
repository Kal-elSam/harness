#!/usr/bin/env node
/**
 * Packaged-host no_model sidecar (isolated evidence).
 *
 * Default = **SIMULATED Pi** (placeholder child with published package shape).
 * That certifies host+classifier wiring only — never a real-Pi run.
 *
 * REAL when KAIRO_PACKAGED_NO_MODEL_REAL_PI=1:
 *   published @kal-elsam/kairo-pi-coding-agent, `--offline`, temp HOME.
 *   If the published CLI is missing → exit 2 (FAIL). No silent sim fallback.
 *
 * Always REAL: runKairoUiRpcStdio + classifyPiEngineFromState.
 * NEVER: credentials, network, real providers, or user HOME sessions.
 *
 * Env:
 *   KAIRO_PACKAGED_NO_MODEL_E2E_DIR  — required log dir
 *   KAIRO_PACKAGED_NO_MODEL_REAL_PI=1 — require real published Pi (offline)
 *   HOME / HARNESS_HOME / PI_CODING_AGENT_DIR — must be temp isolates
 */
import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { runKairoUiRpcStdio } from "../../src/global/host/kairo-ui-rpc-stdio.js";
import {
  openPiRpcBridge,
  KAIRO_WORKSPACE_SNAPSHOT_SCHEMA,
  classifyPiEngineFromState
} from "../../src/global/host/pi-rpc-bridge.js";

const dir = process.env.KAIRO_PACKAGED_NO_MODEL_E2E_DIR;
if (!dir) throw new Error("KAIRO_PACKAGED_NO_MODEL_E2E_DIR is required");
mkdirSync(dir, { recursive: true });
const logPath = join(dir, "sidecar.log");
const log = (line) => {
  try {
    appendFileSync(logPath, `${line}\n`);
  } catch {
    // evidence only
  }
};

const cwdIdx = process.argv.indexOf("--cwd");
const cwd = cwdIdx >= 0 ? process.argv[cwdIdx + 1] : process.cwd();

/** Exact placeholder shape from published Pi .5 cold start (Claude evidence). */
export const PI_PLACEHOLDER_MODEL = Object.freeze({
  id: "unknown",
  name: "unknown",
  api: "unknown",
  provider: "unknown",
  baseUrl: "",
  reasoning: false,
  input: [],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 0,
  maxTokens: 0
});

const classified = classifyPiEngineFromState({
  model: PI_PLACEHOLDER_MODEL,
  sessionId: "packaged-no-model"
});
log(`classifier ${JSON.stringify(classified)}`);
if (classified.status !== "no_model") {
  throw new Error(`expected placeholder → no_model, got ${classified.status}`);
}

function createPlaceholderChild() {
  const child = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdin.write = (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) {
      let cmd;
      try {
        cmd = JSON.parse(line);
      } catch {
        continue;
      }
      let body = null;
      if (cmd.type === "get_state") {
        body = {
          type: "response",
          command: "get_state",
          success: true,
          data: { sessionId: "packaged-no-model", model: { ...PI_PLACEHOLDER_MODEL } }
        };
      } else if (cmd.type === "set_model") {
        body = {
          type: "response",
          command: "set_model",
          success: false,
          error: "No Architect route in isolated no_model check"
        };
      } else if (cmd.type === "get_messages") {
        body = { type: "response", command: "get_messages", success: true, data: { messages: [] } };
      } else if (cmd.type === "prompt") {
        // Same failure shape Claude saw when prompting against the placeholder.
        body = {
          type: "response",
          command: "prompt",
          success: false,
          error: "No API key found for the selected model."
        };
      }
      if (body) {
        if (cmd.id != null) body.id = cmd.id;
        queueMicrotask(() => child.stdout.emit("data", Buffer.from(`${JSON.stringify(body)}\n`)));
      }
    }
    return true;
  };
  child.stdin.end = () => {};
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => child.emit("exit", 0, null);
  return child;
}

function resolvePublishedPiCli() {
  const here = dirname(fileURLToPath(import.meta.url));
  const cli = join(here, "../../node_modules/@kal-elsam/kairo-pi-coding-agent/dist/cli.js");
  return existsSync(cli) ? cli : null;
}

const wantRealPi = process.env.KAIRO_PACKAGED_NO_MODEL_REAL_PI === "1";
const realCli = wantRealPi ? resolvePublishedPiCli() : null;
if (wantRealPi && !realCli) {
  log("real_pi_unavailable FAIL — no silent fallback to simulation");
  console.error(
    "KAIRO_PACKAGED_NO_MODEL_REAL_PI=1 but published @kal-elsam/kairo-pi-coding-agent CLI was not found under node_modules. Refusing to fall back to the simulated placeholder child."
  );
  process.exit(2);
}
if (wantRealPi) {
  log("mode REAL_PUBLISHED_PI_OFFLINE");
} else {
  log("mode SIMULATED_PI_PLACEHOLDER_CHILD (integration with simulated Pi)");
}

const snapshot = () => ({
  schema: KAIRO_WORKSPACE_SNAPSHOT_SCHEMA,
  project: { label: "packaged-no-model" },
  agents: [],
  team: { state: "not_analyzed", presentation: { state: "idle", rolesVisible: false, reason: null }, rows: [], assignments: [] },
  subscriptions: { state: "ready", segments: [] }
});

const stdin = new PassThrough();
process.stdin.on("data", (chunk) => {
  for (const line of String(chunk).split("\n").filter(Boolean)) log(`in ${line.slice(0, 400)}`);
  stdin.write(chunk);
});
process.stdin.on("end", () => stdin.end());
const stdout = new PassThrough();
stdout.on("data", (chunk) => {
  for (const line of String(chunk).split("\n").filter(Boolean)) log(`out ${line}`);
  process.stdout.write(chunk);
});

await runKairoUiRpcStdio({
  stdin,
  stdout,
  cwd,
  env: process.env,
  resolveProjectRoot: async (c) => c,
  listPiSessionFilesForCwd: () => [],
  loadKairoProviderModels: async () => [],
  loadSnapshot: async () => snapshot(),
  openBridge: async (opts) => {
    if (wantRealPi) {
      return openPiRpcBridge({
        cwd: opts?.cwd ?? cwd,
        loadSnapshot: async () => snapshot(),
        resolveCliPath: () => realCli,
        loadKairoProviderModels: async () => [],
        connectTimeoutMs: 12_000,
        // Published package cold start: RPC + no session + offline (no network).
        extraArgs: ["--offline"]
      });
    }
    // Explicit simulated-Pi path only when REAL_PI is not requested.
    return openPiRpcBridge({
      cwd: opts?.cwd ?? cwd,
      loadSnapshot: async () => snapshot(),
      resolveCliPath: () => "/fake/cli.js",
      loadKairoProviderModels: async () => [],
      spawnImpl: () => createPlaceholderChild(),
      execPath: process.execPath,
      connectTimeoutMs: 500
    });
  }
});
log("sidecar main resolved");
