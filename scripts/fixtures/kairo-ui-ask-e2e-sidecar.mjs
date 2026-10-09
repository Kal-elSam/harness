#!/usr/bin/env node
/**
 * Sidecar for the ASK PTY end-to-end (scripts/kairo-ui-ask-pty-e2e.py).
 *
 * Runs the REAL `runKairoUiRpcStdio` and the REAL conversation service
 * (`submitTask` -> `askQuestion` -> `askProvider` in quick-ask.js, real
 * process-group kill, real ask-events persistence). Only the edges are faked:
 *   - Pi is an in-process fake bridge (sessions kept in $KAIRO_ASK_E2E_DIR).
 *   - `askProvider`'s `spawn` is redirected to a FAKE provider script
 *     (kairo-ui-ask-e2e-fake-provider.mjs), so no real CLI/model/network.
 *   - ASK routing is pinned to provider "codex" (no probes, no adapters).
 * Env: KAIRO_ASK_E2E_DIR (state + logs), KAIRO_SESSION_ID (Kairo session A),
 *      HARNESS_HOME (temp home for all Kairo state).
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import { runKairoUiRpcStdio } from "../../src/global/host/kairo-ui-rpc-stdio.js";
import { createConversationService } from "../../src/global/conversation/service.js";
import { askProvider } from "../../src/global/intelligence/quick-ask.js";
import { createSession } from "../../src/global/conversation/session-registry.js";
import { recordPiBinding } from "../../src/global/conversation/pi-session-bindings.js";
import { resolveHomeDir } from "../../src/global/paths.js";
import { KAIRO_WORKSPACE_SNAPSHOT_SCHEMA } from "../../src/global/host/pi-rpc-bridge.js";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE_PROVIDER = join(here, "kairo-ui-ask-e2e-fake-provider.mjs");
const dir = process.env.KAIRO_ASK_E2E_DIR;
if (!dir) throw new Error("KAIRO_ASK_E2E_DIR is required");
mkdirSync(dir, { recursive: true });
const cwdIdx = process.argv.indexOf("--cwd");
const cwd = cwdIdx >= 0 ? process.argv[cwdIdx + 1] : process.cwd();
const env = process.env;
const homeDir = resolveHomeDir(env);
const logPath = join(dir, "sidecar.log");
const log = (line) => {
  try {
    appendFileSync(logPath, `${line}\n`);
  } catch {
    // evidence only
  }
};

// ---- fake Pi state (persisted so a relaunch sees the same sessions) -------
const statePath = join(dir, "pi-state.json");
const SESSION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
let state;
if (existsSync(statePath)) {
  state = JSON.parse(readFileSync(statePath, "utf8"));
} else {
  state = {
    sessions: [
      { sessionId: "pi-e2e-1", path: join(dir, "pi-e2e-1.jsonl"), label: "e2e-one", kairoId: SESSION_A },
      { sessionId: "pi-e2e-2", path: join(dir, "pi-e2e-2.jsonl"), label: "e2e-two", kairoId: SESSION_B }
    ],
    active: "pi-e2e-1"
  };
  for (const [i, s] of state.sessions.entries()) {
    await createSession(homeDir, cwd, { title: s.label }, { randomUUID: () => s.kairoId });
    await recordPiBinding(homeDir, cwd, s.sessionId, s.kairoId);
    writeFileSync(s.path, `${JSON.stringify({ type: "session", id: s.sessionId, cwd })}\n`);
    void i;
  }
}
const saveState = () => writeFileSync(statePath, JSON.stringify(state));
saveState();

const model = { id: "codex::m1", provider: "kairo" };
const fakeBridge = {
  engine: { status: "connected", reason: null, sessionId: state.active, model },
  snapshot: {
    schema: KAIRO_WORKSPACE_SNAPSHOT_SCHEMA,
    project: { label: "ask-e2e" },
    agents: [],
    team: { state: "not_analyzed", rows: [] },
    subscriptions: { state: "ready", segments: [] }
  },
  onEvent() {},
  sendRaw() {},
  async stop() {},
  async request(cmd) {
    log(`pi ${cmd.type}`);
    if (cmd.type === "get_state") return { sessionId: state.active, model };
    if (cmd.type === "get_messages") return { messages: [] };
    if (cmd.type === "set_model") return {};
    if (cmd.type === "new_session") {
      const n = state.sessions.length + 1;
      const kairoId = randomUUID();
      const s = { sessionId: `pi-e2e-${n}`, path: join(dir, `pi-e2e-${n}.jsonl`), label: `e2e-${n}`, kairoId };
      await createSession(homeDir, cwd, { title: s.label }, { randomUUID: () => kairoId });
      await recordPiBinding(homeDir, cwd, s.sessionId, kairoId);
      writeFileSync(s.path, `${JSON.stringify({ type: "session", id: s.sessionId, cwd })}\n`);
      state.sessions.push(s);
      state.active = s.sessionId;
      saveState();
      return { cancelled: false };
    }
    if (cmd.type === "switch_session") {
      const s = state.sessions.find((x) => x.path === cmd.sessionPath);
      if (s) {
        state.active = s.sessionId;
        saveState();
      }
      return { cancelled: false };
    }
    return {};
  }
};

// ---- real conversation service; only spawn + routing are pinned ----------
const fakeSpawn = (_command, args, options) =>
  spawn(process.execPath, [FAKE_PROVIDER, `--kairo-ask-e2e-marker=${dir}`, ...args], {
    ...options,
    env: {
      ...options.env,
      KAIRO_ASK_E2E_DIR: dir,
      ...(env.KAIRO_ASK_E2E_TOOL_IDS ? { KAIRO_ASK_E2E_TOOL_IDS: env.KAIRO_ASK_E2E_TOOL_IDS } : {})
    }
  });
const service = createConversationService({
  homeDir,
  resolveRoot: async (c) => c,
  enableProviderProbes: false,
  askProvider: (args) => askProvider({ ...args, spawn: fakeSpawn, killGraceMs: 1500 })
});
service.planAsk = async ({ cwd: c }) => ({
  decision: { decision: "ROUTED", provider: "codex", model: "fake-model", why: "ask-e2e pinned" },
  projectRoot: c
});

// ---- record log: stdin ops and stdout records --------------------------------
const stdin = new PassThrough();
process.stdin.on("data", (chunk) => {
  for (const line of String(chunk).split("\n").filter(Boolean)) log(`in ${line.slice(0, 300)}`);
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
  env,
  openBridge: async () => fakeBridge,
  loadKairoProviderModels: async () => [
    { id: "codex::m1", kairoRoute: { role: "Architect", adapterId: "codex", modelId: "m1" } }
  ],
  loadSnapshot: async () => fakeBridge.snapshot,
  listPiSessionFilesForCwd: () =>
    state.sessions.map(({ path, sessionId, label }) => ({ path, sessionId, label })),
  resolveProjectRoot: async (c) => c,
  submitTask: (args) => service.submitTask(args),
  setMode: (args) => service.setMode(args),
  snapshot: (args) => service.snapshot(args),
  clearTranscript: (args) => service.clearTranscript(args),
  askCancelWaitMs: 5000
});
log("sidecar main resolved");
