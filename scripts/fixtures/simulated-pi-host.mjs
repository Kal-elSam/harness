/**
 * Simulated-Pi host wiring (shared by the wrapper sidecar and Node tests).
 *
 * REAL: runKairoUiRpcStdio op loop, openPiRpcBridge (spawn/RPC/timeouts),
 *       resolveArchitectRouteForRpc, loadKairoProviderModels / buildKairoProviderModels,
 *       the persisted project-strategy store under HARNESS_HOME, and the real
 *       conversation service behind `team.approve` (approveProjectStrategy).
 * SIMULATED: the Pi child (fake-pi-child.mjs) and adapter launchability
 *       (injected through the existing `resolveAdapter` seam).
 * NEVER: real providers, real Pi, network, credentials, analyst/model calls.
 *
 * Evidence from this wiring is labeled "simulated Pi": it validates harness +
 * host wiring, not the published Pi or a real machine's Architect launchability.
 */
import { join } from "node:path";
import { createConversationService } from "../../src/global/conversation/service.js";
import {
  PROJECT_STRATEGY_SCHEMA,
  writeProjectStrategy
} from "../../src/global/conversation/project-strategy-store.js";
import { resolveProjectRoot } from "../../src/global/architect/architect-store.js";
import { approveProjectTeam } from "../../src/global/host/project-team-sidecar.js";
import { loadKairoWorkspaceSnapshot } from "../../src/global/host/workspace-snapshot.js";
import { loadKairoProviderModels } from "../../src/global/host/kairo-route-provider.js";
import { openPiRpcBridge } from "../../src/global/host/pi-rpc-bridge.js";
import { createFakePiChild } from "./fake-pi-child.mjs";

export const FAKE_PI_REQUESTS = "fake-pi-requests.jsonl";
export const SIM_ADAPTER_ID = "codex";
export const SIM_MODEL_ID = "sim-architect-1";
/** Pi model id for the Architect route (`<adapter>::<model>`, see kairo-route-provider). */
export const ARCHITECT_MODEL_ID = `${SIM_ADAPTER_ID}::${SIM_MODEL_ID}`;

/**
 * pi:        fake Pi behavior (fake-pi-child.mjs)
 * roles:     roles in the seeded strategy
 * launchable: result of the injected adapter availability
 */
export const SCENARIOS = Object.freeze({
  positive: { pi: "connected", roles: ["Architect", "Explorer"], launchable: true },
  "no-architect-route": { pi: "connected", roles: ["Explorer"], launchable: true },
  "unlaunchable-route": { pi: "connected", roles: ["Architect", "Explorer"], launchable: false },
  "set-model-fails": { pi: "set-model-fail", roles: ["Architect", "Explorer"], launchable: true },
  "placeholder-model": { pi: "placeholder", roles: ["Architect", "Explorer"], launchable: true },
  "silent-get-state": { pi: "silent", roles: ["Architect", "Explorer"], launchable: true },
  "silent-set-model": { pi: "silent-set-model", roles: ["Architect", "Explorer"], launchable: true }
});

function scenarioConfig(name) {
  const cfg = SCENARIOS[name];
  if (!cfg) throw new Error(`Unknown simulated-Pi scenario "${name}"`);
  return cfg;
}

const MODEL = Object.freeze({
  adapterId: SIM_ADAPTER_ID,
  modelId: SIM_MODEL_ID,
  displayName: "Sim Architect 1",
  accessMode: "automatic",
  candidateKey: `${SIM_ADAPTER_ID}::${SIM_MODEL_ID}`
});

/**
 * Persist a strategy under `homeDir` for `cwd`'s project WITHOUT calling the
 * analyst or any model. `status` defaults to `suggested` (approve later).
 * @param {{ homeDir: string, cwd: string, scenario?: string, status?: "suggested"|"active" }} args
 */
export async function seedSuggestedTeam({ homeDir, cwd, scenario = "positive", status = "suggested" }) {
  const cfg = scenarioConfig(scenario);
  const projectRoot = await resolveProjectRoot(cwd);
  const strategy = {
    schema: PROJECT_STRATEGY_SCHEMA,
    status,
    profileFingerprint: "simulated-pi-connect-fixture",
    bootstrapAnalyst: MODEL,
    orchestrator: MODEL,
    projectTeam: cfg.roles.map((role) => ({
      role,
      model: MODEL,
      fallback: null,
      assignmentSource: "recommended",
      assignmentState: "ready",
      reason: "Simulated-Pi fixture (no analysis run)"
    })),
    ...(status === "active" ? { approvedAt: new Date().toISOString() } : {})
  };
  await writeProjectStrategy(homeDir, projectRoot, strategy);
  return { projectRoot, status };
}

const offlineEngram = () => ({ status: "unknown" });

/**
 * Options for `runKairoUiRpcStdio` that inject the fake Pi + launchable seam.
 * @param {object} args
 * @param {string} args.cwd
 * @param {string} args.evidenceDir
 * @param {string} [args.scenario]
 * @param {number} [args.connectTimeoutMs]
 * @param {NodeJS.ProcessEnv} [args.env]
 */
export function buildSimulatedHostOptions({
  cwd,
  evidenceDir,
  scenario = "positive",
  connectTimeoutMs = 1500,
  env = process.env
}) {
  const cfg = scenarioConfig(scenario);
  const requestsPath = join(evidenceDir, FAKE_PI_REQUESTS);
  // Existing seam: adapter.availability({}).launchable gates every route.
  const resolveAdapter = () => ({ availability: () => ({ launchable: cfg.launchable }) });
  const loadModels = (args) => loadKairoProviderModels(args, { resolveAdapter });
  const loadSnapshot = (args) =>
    loadKairoWorkspaceSnapshot(args, { inspectEngramIntegration: offlineEngram });
  return {
    cwd,
    env,
    loadSnapshot,
    loadKairoProviderModels: loadModels,
    // Real service + persistence; provider probes and adapter inspection are
    // disabled so approval never touches a real provider CLI.
    approveProjectTeam: ({ cwd: approveCwd }) =>
      approveProjectTeam({
        cwd: approveCwd,
        createConversationService: () =>
          createConversationService({
            enableProviderProbes: false,
            inspectExecutionAdapters: () => [],
            inspectEngramIntegration: offlineEngram
          })
      }),
    openBridge: async (opts) => {
      const bridgeCwd = opts?.cwd ?? cwd;
      return openPiRpcBridge({
        cwd: bridgeCwd,
        env,
        loadSnapshot: () => loadSnapshot({ cwd: bridgeCwd }),
        loadKairoProviderModels: loadModels,
        resolveCliPath: () => "/fake/pi/cli.js",
        spawnImpl: () => createFakePiChild({ requestsPath, behavior: cfg.pi }),
        execPath: process.execPath,
        connectTimeoutMs
      });
    }
  };
}
