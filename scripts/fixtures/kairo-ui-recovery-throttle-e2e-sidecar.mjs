#!/usr/bin/env node
/**
 * Sidecar for the D5 recovery-throttle PTY end-to-end
 * (scripts/kairo-ui-recovery-throttle-pty-e2e.py).
 *
 * REAL: the runKairoUiRpcStdio op loop, recoverKairoProjectTeam (the host
 * wrapper), the REAL conversation service, runTeamRecovery, the availability
 * fingerprint, the analysis lock and the on-disk stores (project strategy,
 * availability-recovery record, pending proposal) under a temp HARNESS_HOME.
 * SIMULATED (no provider, login or network is ever touched): the Pi bridge,
 * provider eligibility/catalog (one limited provider, two available), the
 * project profile scan, the sanitized snapshot and the analyst adapter. The
 * fake analyst only counts calls (`analyzer-called` in the log).
 *
 * Seed (KAIRO_RECOVERY_E2E_STATE): an ACTIVE team hit by the limited
 * provider plus a recovery record for the current fingerprint that is
 *   backoff   - one failed attempt, just now (retry-later)
 *   exhausted - the 3rd failed attempt (retries-exhausted)
 *
 * Automatic refresh: creating `<KAIRO_RECOVERY_E2E_DIR>/trigger-auto` makes
 * this process run the SAME host wrapper without the explicit flag, exactly
 * what a Pi session refresh does, and log `auto-result <json>`.
 */
import { appendFileSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { runKairoUiRpcStdio } from "../../src/global/host/kairo-ui-rpc-stdio.js";
import {
  approveKairoRecovery, recoverKairoProjectTeam, rejectKairoRecovery
} from "../../src/global/host/workspace-snapshot.js";
import { createConversationService } from "../../src/global/conversation/service.js";
import { availabilityFingerprint } from "../../src/global/conversation/availability-fingerprint.js";
import { availabilityRecoveryPath, writeAvailabilityRecovery } from "../../src/global/conversation/availability-recovery-store.js";
import { writeProjectStrategy } from "../../src/global/conversation/project-strategy-store.js";
import { scoreAvailableModels } from "../../src/global/intelligence/model-intelligence.js";
import { createCapabilityRegistry } from "../../src/global/intelligence/model-capability-registry.js";
import { harnessHomePaths, resolveHomeDir } from "../../src/global/paths.js";
import { projectKeyForPath } from "../../src/global/next/project-key.js";
import { KAIRO_WORKSPACE_SNAPSHOT_SCHEMA } from "../../src/global/host/pi-rpc-bridge.js";

const dir = process.env.KAIRO_RECOVERY_E2E_DIR;
if (!dir) throw new Error("KAIRO_RECOVERY_E2E_DIR is required");
mkdirSync(dir, { recursive: true });
const seedState = process.env.KAIRO_RECOVERY_E2E_STATE || "backoff";
const cwdIdx = process.argv.indexOf("--cwd");
const cwd = cwdIdx >= 0 ? process.argv[cwdIdx + 1] : process.cwd();
const homeDir = resolveHomeDir(process.env);
const logPath = join(dir, "sidecar.log");
const log = (line) => {
  try { appendFileSync(logPath, `${line}\n`); } catch { /* evidence only */ }
};

// ---- simulated availability: Go is rate-limited, Codex and Claude are fine --
const ELIGIBILITY = {
  codex: { ok: true, reason: null },
  claude: { ok: true, reason: null },
  "opencode-go": { ok: false, reason: "OpenCode Go monthly window is rate-limited (simulated)", limit: { provider: "opencode-go", window: "monthly", remainingPercent: 0 } }
};
const GO_MODEL = { candidateKey: "opencode-go::glm-5-3", adapterId: "opencode-go", modelId: "glm-5-3", displayName: "GLM-5.3", accessMode: "automatic" };
const PROFILE = {
  projectName: "recovery-e2e", stack: ["Node.js"], architecture: { pattern: "modular" },
  quality: { buildCommand: null, testCommand: null, lintCommand: null, typeCheckCommand: null },
  hotspots: [], workflowCapabilities: [], risks: [], fingerprint: "fp-2",
  roleRequirements: [{ role: "Explorer", capabilities: ["reasoning"], reason: "" }]
};
const ANSWER = JSON.stringify({
  architectureTraits: [], complexitySignals: [], criticalAreas: [], contextNeeds: [],
  workflowNeeds: [], recommendedRoleNeeds: [], uncertainties: [], evidenceReferences: []
});
const scoredAll = scoreAvailableModels([
  { adapterId: "codex", models: [{ id: "codex-model" }] },
  { adapterId: "claude", models: [{ id: "claude-model" }] }
], [
  { slug: "codex-model", name: "Codex Model", intelligenceIndex: 90, codingIndex: 40, mathIndex: null },
  { slug: "claude-model", name: "Claude Model", intelligenceIndex: 40, codingIndex: 90, mathIndex: null }
]).map((model) => ({ ...model, accessMode: "automatic" }));

const service = createConversationService({
  homeDir,
  resolveRoot: async (c) => c,
  computeProjectProfile: async () => PROFILE,
  buildSanitizedSnapshot: async () => ({ snapshotRoot: dir, filesCopied: 0, secretsRedacted: 0, copiedFiles: [], excludedPrivatePaths: [], cleanup: async () => {} }),
  createBootstrapAnalyzerAdapter: (adapterId, { modelId } = {}) => ({
    checkEligibility: async () => ({ eligible: true, isolation: "verified" }),
    analyze: async () => {
      log(`analyzer-called ${adapterId}::${modelId}`);
      return { status: "answered", answer: ANSWER };
    }
  })
});
service.snapshot = async () => ({
  modelIntelligence: { scoredAll, eligibility: ELIGIBILITY, registry: createCapabilityRegistry(), providerCapacity: null }
});
const withService = { createConversationService: () => service };

// ---- seed the real stores -------------------------------------------------
await writeProjectStrategy(homeDir, cwd, {
  status: "active", profileFingerprint: "fp-1", approvedAt: "2026-09-01T00:00:00.000Z",
  orchestrator: null, bootstrapAnalyst: null,
  projectTeam: [{ role: "Explorer", model: GO_MODEL, fallback: null, assignmentSource: "recommended" }]
});
await writeAvailabilityRecovery(homeDir, cwd, {
  fingerprint: availabilityFingerprint(ELIGIBILITY).key,
  outcome: "analysis-failed",
  attempts: seedState === "exhausted" ? 3 : 1
});
const { sessionsDir } = harnessHomePaths(homeDir);
writeFileSync(join(dir, "paths.json"), JSON.stringify({
  strategy: join(sessionsDir, projectKeyForPath(cwd), "project-strategy.json"),
  recovery: availabilityRecoveryPath(homeDir, cwd)
}));

// ---- automatic refresh trigger (what a Pi session refresh does) -------------
const triggerPath = join(dir, "trigger-auto");
setInterval(async () => {
  if (!existsSync(triggerPath)) return;
  try { unlinkSync(triggerPath); } catch { return; }
  const result = await recoverKairoProjectTeam({ cwd }, withService);
  log(`auto-result ${JSON.stringify(result)}`);
}, 100).unref();

// ---- fake Pi bridge ----------------------------------------------------------
const model = { id: "codex::m1", provider: "kairo" };
const snapshot = {
  schema: KAIRO_WORKSPACE_SNAPSHOT_SCHEMA,
  project: { label: "recovery-e2e" },
  agents: [],
  team: { state: "stale", rows: [{ role: "Explorer", model: "GLM-5.3", via: "opencode-go", availability: { state: "blocked" } }], assignments: [] },
  subscriptions: { state: "ready", segments: [] }
};
const fakeBridge = {
  engine: { status: "connected", reason: null, sessionId: "pi-e2e", model },
  snapshot,
  onEvent() {},
  sendRaw() {},
  async stop() {},
  async request(cmd) {
    if (cmd.type === "get_state") return { sessionId: "pi-e2e", model };
    if (cmd.type === "get_messages") return { messages: [] };
    return {};
  }
};

const stdin = new PassThrough();
process.stdin.on("data", (chunk) => {
  for (const line of String(chunk).split("\n").filter(Boolean)) log(`in ${line.slice(0, 800)}`);
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
  loadKairoProviderModels: async () => [],
  loadSnapshot: async () => snapshot,
  listPiSessionFilesForCwd: () => [{ path: join(dir, "pi-e2e.jsonl"), sessionId: "pi-e2e", label: "recovery-e2e" }],
  resolveProjectRoot: async (c) => c,
  recoverProjectTeam: (args) => recoverKairoProjectTeam(args, withService),
  approveRecoveryProposal: (args) => approveKairoRecovery(args, withService),
  rejectRecoveryProposal: (args) => rejectKairoRecovery(args, withService)
});
log("sidecar main resolved");
