import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveHomeDir, harnessHomePaths } from "./paths.js";
import { readGlobalState, writeGlobalState } from "./state.js";
import { detectInstalledAdapters } from "./registry.js";
import { resolveComponent } from "./component-registry.js";
import { printJson } from "./json-output.js";
import { formatCliCommand } from "./brand/cli.js";
import { requireIntegrationProvider } from "./integrations/provider-registry.js";
import { ensureIntegrationProvidersRegistered } from "./integrations/index.js";
import { ENGRAM_INTEGRATION_STATUS } from "./integrations/engram-evidence.js";
import { SDD_HEALTH } from "./integrations/sdd-evidence.js";
import { recordSddMaterialization } from "./integrations/sdd-state.js";

const DEFAULT_PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const COMPONENT_PROVIDERS = Object.freeze({
  "engram-memory": "engram",
  "sdd-core": "sdd-core"
});

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

function requireConfiguredComponent(componentId) {
  const providerId = COMPONENT_PROVIDERS[componentId];
  if (!providerId) {
    throw new Error(
      `components configure/verify/rollback supports: ${Object.keys(COMPONENT_PROVIDERS).join(", ")} (got "${componentId}").`
    );
  }
  return providerId;
}

export async function runComponentsConfigure(options) {
  const componentId = options.componentId;
  const providerId = requireConfiguredComponent(componentId);
  ensureIntegrationProvidersRegistered();
  const homeDir = resolveHomeDir();
  await assertComponentInstalled(componentId, { homeDir });
  const provider = requireIntegrationProvider(providerId);
  const context = await buildProviderContext(options, { homeDir, componentId });
  const result = await provider.apply(context);

  if (componentId === "sdd-core" && result.receipt?.ok && !result.dryRun && !result.cancelled) {
    await persistSddReceiptState(homeDir, result.receipt);
  }

  if (options.json) {
    printJson(result);
    if (isConfigureFailure(result)) process.exitCode = 1;
    return result;
  }

  if (componentId === "sdd-core") printSddConfigureHuman(result);
  else printEngramConfigureHuman(result);
  if (isConfigureFailure(result)) process.exitCode = 1;
  return result;
}

export async function runComponentsVerify(options) {
  const componentId = options.componentId;
  const providerId = requireConfiguredComponent(componentId);
  ensureIntegrationProvidersRegistered();
  const homeDir = resolveHomeDir();
  await assertComponentInstalled(componentId, { homeDir });
  const provider = requireIntegrationProvider(providerId);
  const context = await buildProviderContext(options, { homeDir, componentId });
  const result = await provider.verify(context);

  if (options.json) {
    printJson(result);
    if (result.ok === false) process.exitCode = 1;
    return result;
  }

  if (componentId === "sdd-core") printSddVerifyHuman(result);
  else printEngramConfigureHuman(result);
  if (result.ok === false) process.exitCode = 1;
  return result;
}

export async function runComponentsRollback(options) {
  const componentId = options.componentId;
  const providerId = requireConfiguredComponent(componentId);
  if (!options.receiptId) {
    throw new Error(
      `Missing receipt id. Use: ${formatCliCommand(`components rollback ${componentId} --receipt <id>`)}`
    );
  }

  ensureIntegrationProvidersRegistered();
  const homeDir = resolveHomeDir();
  await assertComponentInstalled(componentId, { homeDir });
  const provider = requireIntegrationProvider(providerId);
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

  console.log(formatCliCommand(`components rollback ${componentId}`));
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

async function buildProviderContext(options, { homeDir, componentId }) {
  const detectedAgentIds = detectInstalledAdapters({ homeDir });
  const base = {
    requestedAgentIds: options.adapters,
    detectedAgentIds,
    homeDir,
    dryRun: Boolean(options.dryRun),
    yes: Boolean(options.yes),
    json: Boolean(options.json),
    interactive: null
  };
  if (componentId !== "sdd-core") return base;

  const state = await readGlobalState(harnessHomePaths(homeDir).statePath);
  const trackedFiles = Object.fromEntries(
    (state?.sdd?.files ?? []).map((file) => [file.destinationPath, file.hash])
  );
  return {
    ...base,
    packageRoot: options.packageRoot ?? DEFAULT_PACKAGE_ROOT,
    persona: options.persona ?? state?.sdd?.persona ?? "off",
    trackedFiles
  };
}

async function persistSddReceiptState(homeDir, receipt) {
  const paths = harnessHomePaths(homeDir);
  const state = (await readGlobalState(paths.statePath)) ?? {};
  await writeGlobalState(paths.statePath, recordSddMaterialization(state, { receipt }));
}

function isConfigureFailure(result) {
  return Boolean(result.blocked || (result.receipt && !result.receipt.ok));
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

export function buildSddIntegrationChecks(verification) {
  const status = verification.status === SDD_HEALTH.CONFIGURED
    ? "ok"
    : verification.status === SDD_HEALTH.CONFLICT
      ? "warning"
      : "warning";
  const summary = verification.summary ?? {};
  return [{
    name: "sdd-core:skills",
    status,
    category: "integration",
    componentId: "sdd-core",
    detail: `SDD skills ${verification.status}: configured=${summary.configured ?? 0}, missing=${summary.missing ?? 0}, drifted=${summary.drifted ?? 0}, conflict=${summary.conflict ?? 0} (disk presence ≠ runtime active).`
  }];
}

function printEngramConfigureHuman(result) {
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

function printSddConfigureHuman(result) {
  console.log(formatCliCommand("components configure sdd-core"));
  console.log(`Persona: ${result.persona ?? "off"}${result.personaActive ? " (active)" : " (off)"}`);
  const s = result.summary ?? {};
  console.log(`Plan: create=${s.create ?? 0} noop=${s.noop ?? 0} update=${s.update ?? 0} conflict=${s.conflict ?? 0}`);
  for (const action of result.actions ?? []) {
    console.log(`  ${action.action.padEnd(8)} ${action.skillId} → ${action.destinationPath}`);
  }
  if (result.dryRun) return void console.log("Dry-run only — no skills materialized.");
  if (result.cancelled) return void console.log("Cancelled.");
  if (result.blocked) return void console.log(`Blocked: ${result.reason ?? "conflicts present"}`);
  if (result.receipt) {
    console.log(`Receipt: ${result.receipt.id}${result.receipt.partial ? " (partial)" : ""}`);
    if (result.sessionRefreshRequired) {
      console.log("session_refresh_required — restart agents to load skills; Kairo does not claim current sessions already loaded them.");
    }
  }
}

function printSddVerifyHuman(result) {
  console.log(formatCliCommand("components verify sdd-core"));
  const s = result.summary ?? {};
  console.log(`Status: ${result.status}`);
  console.log(`Summary: configured=${s.configured ?? 0} missing=${s.missing ?? 0} drifted=${s.drifted ?? 0} conflict=${s.conflict ?? 0}`);
  for (const finding of result.findings ?? []) {
    console.log(`  ${finding.status.padEnd(10)} ${finding.skillId}${finding.drift ? ` (${finding.drift})` : ""} → ${finding.destinationPath}`);
  }
}
