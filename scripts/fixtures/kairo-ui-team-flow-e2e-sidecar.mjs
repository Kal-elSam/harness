#!/usr/bin/env node
/**
 * Sidecar for Plan 1 P1-T2 PTY flows (scripts/kairo-ui-team-flow-pty-e2e.py).
 *
 * REAL: runKairoUiRpcStdio op loop (host ↔ sidecar NDJSON).
 * SIMULATED: Pi bridge, analyze/approve bodies, recovery proposal, submitTask
 *            chat answer. No real provider CLIs, logins, or network.
 *
 * Modes via KAIRO_TEAM_FLOW_MODE:
 *   approve-chat  — team starts pending_approval; approve then chat
 *   recovery-apply / recovery-reject — team starts stale; R preview then y/x/Esc
 *
 * Drafts: intentionally omit saveDraft/loadDraft overrides so the REAL
 * session-registry store under HARNESS_HOME is exercised (isolated temp HOME).
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { runKairoUiRpcStdio } from "../../src/global/host/kairo-ui-rpc-stdio.js";
import { KAIRO_WORKSPACE_SNAPSHOT_SCHEMA } from "../../src/global/host/pi-rpc-bridge.js";

const dir = process.env.KAIRO_TEAM_FLOW_E2E_DIR;
if (!dir) throw new Error("KAIRO_TEAM_FLOW_E2E_DIR is required");
mkdirSync(dir, { recursive: true });
const mode = process.env.KAIRO_TEAM_FLOW_MODE || "approve-chat";
const cwdIdx = process.argv.indexOf("--cwd");
const cwd = cwdIdx >= 0 ? process.argv[cwdIdx + 1] : process.cwd();
const logPath = join(dir, "sidecar.log");
const log = (line) => {
  try {
    appendFileSync(logPath, `${line}\n`);
  } catch {
    // evidence only
  }
};

const architect = {
  id: "codex::m1",
  kairoRoute: { role: "Architect", adapterId: "codex", modelId: "m1" }
};

let teamState = mode.startsWith("recovery") ? "stale" : "suggested";
let routes = mode.startsWith("recovery") ? [architect] : [];
let presentationState = mode.startsWith("recovery") ? "blocked" : "pending_approval";

const snapshot = () => ({
  schema: KAIRO_WORKSPACE_SNAPSHOT_SCHEMA,
  project: { label: "team-flow-e2e" },
  agents: teamState === "active"
    ? [{ label: "Architect", state: "idle", provider: "codex" }]
    : [],
  team: {
    state: teamState,
    presentation: { state: presentationState, rolesVisible: true, reason: null },
    rows: teamState === "not_analyzed" ? [] : [
      { role: "Architect", model: "Codex m1 (simulated)", via: "codex", availability: { state: "ok" } }
    ],
    assignments: []
  },
  subscriptions: { state: "ready", segments: [] }
});

const model = { id: architect.id, provider: "kairo" };
const fakeBridge = {
  get engine() {
    return {
      status: routes.length ? "connected" : "no_model",
      reason: routes.length ? null : "no Architect route yet",
      sessionId: "pi-team-flow",
      model: routes.length ? model : null
    };
  },
  get snapshot() {
    return snapshot();
  },
  onEvent() {},
  sendRaw() {},
  async stop() {},
  async request(cmd) {
    if (cmd.type === "get_state") {
      return { sessionId: "pi-team-flow", model: routes.length ? model : null };
    }
    if (cmd.type === "set_model") {
      log(`set_model ${cmd.modelId}`);
      model.id = cmd.modelId;
      return { ok: true };
    }
    if (cmd.type === "get_messages") return { messages: [] };
    return {};
  }
};

const stdin = new PassThrough();
process.stdin.on("data", (chunk) => {
  for (const line of String(chunk).split("\n").filter(Boolean)) log(`in ${line.slice(0, 600)}`);
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
  openBridge: async () => fakeBridge,
  loadKairoProviderModels: async () => routes,
  loadSnapshot: async () => snapshot(),
  listPiSessionFilesForCwd: () => [{ path: join(dir, "pi-team-flow.jsonl"), sessionId: "pi-team-flow", label: "team-flow" }],
  resolveProjectRoot: async (c) => c,
  analyzeProjectTeam: async ({ analyst, onProgress }) => {
    log(`analyze ${JSON.stringify(analyst)}`);
    onProgress?.({ stage: "preparing", analyst: "simulated", startedAt: 1, elapsedMs: 0 });
    onProgress?.({ stage: "building_team", analyst: "simulated", startedAt: 1, elapsedMs: 5 });
    teamState = "suggested";
    presentationState = "pending_approval";
    return {
      state: "suggested",
      teamRows: 1,
      roles: ["Architect"],
      analyst: "simulated",
      projectRoot: cwd,
      notice: null,
      readyToApprove: true,
      blockedRoles: []
    };
  },
  approveProjectTeam: async () => {
    log("approve");
    routes = [architect];
    teamState = "active";
    presentationState = "complete";
    return {
      state: "active",
      teamRows: 1,
      roles: ["Architect"],
      analyst: "simulated",
      projectRoot: cwd,
      notice: null
    };
  },
  submitTask: async ({ task, mode: workMode }) => {
    log(`chat mode=${workMode} task=${task}`);
    return {
      kind: "answer",
      provider: "simulated",
      model: "sim-chat",
      answer: `SIMULATED reply: ${task}`
    };
  },
  recoverProjectTeam: async () => {
    log("recovery.preview");
    return {
      outcome: "proposed",
      fingerprint: "fp-team-flow",
      affected: [{
        role: "Architect",
        model: "Go (simulated)",
        reason: "rate-limited (simulated)"
      }],
      proposal: {
        projectTeam: [{
          role: "Architect",
          model: { adapterId: "codex", modelId: "m1", displayName: "Codex m1 (simulated)" }
        }]
      }
    };
  },
  approveRecoveryProposal: async () => {
    log("recovery.apply");
    routes = [architect];
    teamState = "active";
    return { outcome: "approved", fingerprint: "fp-team-flow", strategy: { projectTeam: [] } };
  },
  rejectRecoveryProposal: async () => {
    log("recovery.reject");
    return { outcome: "rejected", fingerprint: "fp-team-flow" };
  }
});
log("sidecar main resolved");
