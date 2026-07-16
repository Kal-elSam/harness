import { resolveHomeDir, harnessHomePaths } from "./paths.js";
import { readGlobalState } from "./state.js";
import { detectInstalledAdapters } from "./registry.js";
import { resolveComponent } from "./component-registry.js";
import { printJson } from "./json-output.js";
import { formatCliCommand } from "./brand/cli.js";
import { requireIntegrationProvider } from "./integrations/provider-registry.js";
import { ensureIntegrationProvidersRegistered } from "./integrations/index.js";
import { ENGRAM_INTEGRATION_STATUS } from "./integrations/engram-evidence.js";

export async function assertComponentInstalled(componentId, { homeDir = resolveHomeDir() } = {}) {
  const state = await readGlobalState(harnessHomePaths(homeDir).statePath);
  const installed = (state?.components ?? []).some((entry) => entry.id === componentId);
  if (!installed) {
    throw new Error(
      `Component "${componentId}" is not installed in Kairo state. Run "${formatCliCommand(`install --components ${componentId}`)}" first.`
    );
  }
  return resolveComponent(componentId);
}

export async function runComponentsConfigure(options) {
  const componentId = options.componentId;
  if (componentId !== "engram-memory") {
    throw new Error(`components configure currently supports engram-memory only (got "${componentId}").`);
  }

  ensureIntegrationProvidersRegistered();
  const homeDir = resolveHomeDir();
  await assertComponentInstalled(componentId, { homeDir });
  const provider = requireIntegrationProvider("engram");
  const detectedAgentIds = detectInstalledAdapters({ homeDir });

  const result = await provider.apply({
    requestedAgentIds: options.adapters,
    detectedAgentIds,
    homeDir,
    dryRun: Boolean(options.dryRun),
    yes: Boolean(options.yes),
    json: Boolean(options.json),
    interactive: null
  });

  if (options.json) {
    printJson(result);
    if (result.blocked || (result.receipt && !result.receipt.ok)) process.exitCode = 1;
    return result;
  }

  printConfigureHuman(result);
  if (result.blocked || (result.receipt && !result.receipt.ok)) process.exitCode = 1;
  return result;
}

export async function runComponentsRollback(options) {
  const componentId = options.componentId;
  if (componentId !== "engram-memory") {
    throw new Error(`components rollback currently supports engram-memory only (got "${componentId}").`);
  }
  if (!options.receiptId) {
    throw new Error(`Missing receipt id. Use: ${formatCliCommand("components rollback engram-memory --receipt <id>")}`);
  }

  ensureIntegrationProvidersRegistered();
  const homeDir = resolveHomeDir();
  await assertComponentInstalled(componentId, { homeDir });
  const provider = requireIntegrationProvider("engram");
  const result = await provider.rollback({
    receiptId: options.receiptId,
    homeDir,
    dryRun: Boolean(options.dryRun),
    yes: Boolean(options.yes),
    json: Boolean(options.json),
    interactive: null
  });

  if (options.json) {
    printJson(result);
    if (!result.ok && !result.cancelled) process.exitCode = 1;
    return result;
  }

  console.log(formatCliCommand("components rollback engram-memory"));
  console.log(`Receipt: ${result.receiptId}`);
  if (result.cancelled) {
    console.log("Cancelled.");
    return result;
  }
  for (const action of result.actions ?? []) {
    console.log(`  ${action.action.padEnd(8)} ${action.path}${action.reason ? ` — ${action.reason}` : ""}`);
  }
  console.log(result.ok ? "Rollback complete." : "Rollback finished with skips/errors.");
  if (!result.ok) process.exitCode = 1;
  return result;
}

export function buildEngramIntegrationChecks(inspection) {
  const checks = [];
  const binary = inspection.binary;
  const binaryStatus = binary.status === ENGRAM_INTEGRATION_STATUS.AVAILABLE
    || binary.status === ENGRAM_INTEGRATION_STATUS.CONFIGURED
    || binary.status === ENGRAM_INTEGRATION_STATUS.UNCONFIGURED
    ? "ok"
    : "warning";

  checks.push({
    name: "engram:binary",
    status: binaryStatus,
    category: "integration",
    componentId: "engram-memory",
    detail: binary.path
      ? `Engram ${binary.version ?? "unknown"} at ${binary.path} (${binary.status}).${binary.guidance ? ` ${binary.guidance}` : ""}`
      : (binary.guidance ?? "Engram binary missing.")
  });

  for (const agent of inspection.agents ?? []) {
    const status = agent.status === ENGRAM_INTEGRATION_STATUS.CONFIGURED
      ? "ok"
      : agent.status === ENGRAM_INTEGRATION_STATUS.CONFLICT
        ? "warning"
        : "warning";
    checks.push({
      name: `engram:agent:${agent.id}`,
      status,
      category: "integration",
      componentId: "engram-memory",
      detail: `${agent.id} → ${agent.slug}: ${agent.status} (config evidence only; not runtime-active).`
    });
  }

  return checks;
}

function printConfigureHuman(result) {
  console.log(formatCliCommand("components configure engram-memory"));
  if (result.binary) {
    console.log(`Binary: ${result.binary.path ?? "missing"} (${result.binary.version ?? "n/a"}, ${result.binary.status})`);
  }
  if (result.guidance) console.log(`Guidance: ${result.guidance}`);
  for (const action of result.actions ?? []) {
    console.log(`  ${action.action.padEnd(8)} ${action.agentId} (${action.slug})`);
  }
  if (result.dryRun) {
    console.log("Dry-run only — no setup executed.");
    return;
  }
  if (result.cancelled) {
    console.log("Cancelled.");
    return;
  }
  if (result.receipt) {
    console.log(`Receipt: ${result.receipt.id}${result.receipt.partial ? " (partial)" : ""}`);
    console.log(`Status: ${result.receipt.status}`);
    if (result.receipt.status === ENGRAM_INTEGRATION_STATUS.RESTART_REQUIRED) {
      console.log("Restart the configured agents to load MCP. Kairo does not claim runtime reload.");
    }
  }
}
