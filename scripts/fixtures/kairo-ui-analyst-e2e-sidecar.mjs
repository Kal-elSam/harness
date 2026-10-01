#!/usr/bin/env node
/**
 * Sidecar for the analyst-picker PTY end-to-end
 * (scripts/kairo-ui-analyst-picker-pty-e2e.py).
 *
 * Runs the REAL `runKairoUiRpcStdio` op loop, the REAL sidecar functions
 * (`preflightProjectTeam`, `verifyProjectTeamAccess`) and the REAL conversation
 * service (snapshot, verification plan, verifyAccess, ranking, curation). Only
 * the edges are simulated:
 *   - Pi is an in-process fake bridge (engine connected, no prompt ever sent).
 *   - Provider catalogs, probes and usage reads are fakes: NO real CLI, login,
 *     account or network is touched. Probes are deliberately slow and two of
 *     them fail, so progress and the error summary can be observed.
 *   - Benchmarks are a verbatim excerpt of the local Artificial Analysis
 *     snapshot (test/fixtures/analyst-aa-excerpt.json).
 *   - `project.analyze` only records the analyst the host sent (no analysis).
 * Env: KAIRO_ANALYST_E2E_DIR (logs), KAIRO_ANALYST_E2E_PROBE_MS (per probe delay,
 *      default 900), HARNESS_HOME (temp home: caches are real files in it).
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import { runKairoUiRpcStdio } from "../../src/global/host/kairo-ui-rpc-stdio.js";
import { createConversationService } from "../../src/global/conversation/service.js";
import {
  preflightProjectTeam as preflightProjectTeamImpl,
  verifyProjectTeamAccess as verifyProjectTeamAccessImpl
} from "../../src/global/host/project-team-sidecar.js";
import { resolveHomeDir } from "../../src/global/paths.js";
import { KAIRO_WORKSPACE_SNAPSHOT_SCHEMA } from "../../src/global/host/pi-rpc-bridge.js";

const here = dirname(fileURLToPath(import.meta.url));
const dir = process.env.KAIRO_ANALYST_E2E_DIR;
if (!dir) throw new Error("KAIRO_ANALYST_E2E_DIR is required");
mkdirSync(dir, { recursive: true });
const cwdIdx = process.argv.indexOf("--cwd");
const cwd = cwdIdx >= 0 ? process.argv[cwdIdx + 1] : process.cwd();
const env = process.env;
const homeDir = resolveHomeDir(env);
const probeMs = Number(env.KAIRO_ANALYST_E2E_PROBE_MS ?? 900);
const logPath = join(dir, "sidecar.log");
const log = (line) => {
  try {
    appendFileSync(logPath, `${line}\n`);
  } catch {
    // evidence only
  }
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const aaModels = JSON.parse(readFileSync(join(here, "../../test/fixtures/analyst-aa-excerpt.json"), "utf8")).models;

// ---- simulated providers ----------------------------------------------------
const CLAUDE_OUTCOMES = {
  "claude-opus-5": { status: "allowed", reason: null },
  "claude-opus-4-8": { status: "allowed", reason: null },
  "claude-sonnet-5": { status: "unverified", reason: "probe timed out after 30000ms (simulated)" },
  "claude-fable-5-1": { status: "denied", reason: "Fable 5.1 requires usage credits (simulated)" }
};
const cursorModels = [
  { id: "gpt-5-6-sol", displayName: "GPT-5.6 Sol" },
  { id: "composer-2.5", displayName: "Composer 2.5" }
];

const service = createConversationService({
  homeDir,
  resolveRoot: async (c) => c,
  enableProviderProbes: true,
  listPlans: async () => [],
  recoverRuns: async () => {},
  inspectExecutionAdapters: () => ["claude", "codex", "cursor", "opencode"].map((id) => ({ id, available: true, launchable: true, reason: null })),
  inspectEngramIntegration: () => ({ status: "configured" }),
  readCodexUsage: async () => null,
  readClaudeUsage: async () => null,
  verifyClaudeSubscriptionAuth: async () => ({ mode: "subscription", subscriptionType: "pro" }),
  readCodexModels: async () => ({ status: "measured", models: [{ id: "gpt-5-6-sol" }, { id: "gpt-5-6-terra" }, { id: "gpt-5-5" }] }),
  readClaudeModels: () => ({ status: "documented", models: Object.keys(CLAUDE_OUTCOMES).map((id) => ({ id })) }),
  readOpenCodeModels: async () => ({ status: "measured", models: [{ id: "kimi-k3" }, { id: "glm-5-3" }, { id: "deepseek-v4-pro" }] }),
  readCursorModels: async () => ({ status: "measured", models: cursorModels }),
  probeClaudeModelEntitlements: async ({ modelIds, onProgress }) => {
    log(`probe claude ${modelIds.join(",")}`);
    const results = [];
    for (let index = 0; index < modelIds.length; index += 1) {
      await sleep(probeMs);
      const modelId = modelIds[index];
      const outcome = CLAUDE_OUTCOMES[modelId] ?? { status: "unverified", reason: "unknown model (simulated)" };
      const result = { modelId, ...outcome, probedAt: new Date().toISOString() };
      results.push(result);
      onProgress?.({ modelId, index, total: modelIds.length, result });
    }
    return results;
  },
  probeCursorPoolAccess: async ({ pool, modelId }) => {
    log(`probe cursor ${pool} via ${modelId}`);
    await sleep(probeMs);
    return pool === "other_models"
      ? { pool, status: "available", reason: null, probedAt: new Date().toISOString() }
      : { pool, status: "unverified", reason: "login required (simulated)", probedAt: new Date().toISOString() };
  },
  readArtificialAnalysisModels: async () => ({ status: "live", source: "e2e excerpt", age: "<1h", models: aaModels }),
  readHuggingFaceLeaderboard: async () => ({ status: "unknown", source: null, fetchedAt: null, age: null, entries: [], error: "not mocked" }),
  listRunRecords: async () => []
});

// ---- fake Pi bridge ----------------------------------------------------------
const model = { id: "codex::m1", provider: "kairo" };
const snapshot = {
  schema: KAIRO_WORKSPACE_SNAPSHOT_SCHEMA,
  project: { label: "analyst-e2e" },
  agents: [],
  team: { state: "not_analyzed", rows: [] },
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

// ---- record log: stdin ops and stdout records ---------------------------------
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
  env,
  openBridge: async () => fakeBridge,
  loadKairoProviderModels: async () => [{ id: "codex::m1", kairoRoute: { role: "Architect", adapterId: "codex", modelId: "m1" } }],
  loadSnapshot: async () => snapshot,
  listPiSessionFilesForCwd: () => [{ path: join(dir, "pi-e2e.jsonl"), sessionId: "pi-e2e", label: "analyst-e2e" }],
  resolveProjectRoot: async (c) => c,
  preflightProjectTeam: (args) => preflightProjectTeamImpl({
    ...args,
    createConversationService: () => service,
    // The local project scan is real in the product; fixed here so the asserted line is deterministic.
    computeProfile: async () => ({ projectName: "analyst-e2e", stack: ["Node.js"], architecture: { pattern: "modular" }, risks: [{ kind: "no-test-command" }], confidence: "medium" })
  }),
  verifyProjectTeamAccess: (args) => verifyProjectTeamAccessImpl({ ...args, createConversationService: () => service }),
  analyzeProjectTeam: async ({ analyst }) => {
    log(`analyze ${JSON.stringify(analyst)}`);
    return { status: "analyst_selection_required", message: "analyst e2e: analysis stubbed, no provider was called" };
  }
});
log("sidecar main resolved");
