import { GLOBAL_AGENT_IDS, detectInstalledAdapters } from "./registry.js";
import { installGlobalHarness, uninstallGlobalHarness, updateGlobalHarness } from "./global-installer.js";
import { resolveHomeDir } from "./paths.js";
import { runGlobalDoctorChecks } from "./global-doctor.js";

export async function runGlobalInstall(options, packageManifest, packageRoot, { update = false } = {}) {
  const homeDir = resolveHomeDir();
  const run = update ? updateGlobalHarness : installGlobalHarness;
  const result = await run({
    packageRoot,
    packageName: packageManifest.name,
    cliVersion: packageManifest.version,
    homeDir,
    agents: options.adapters,
    components: options.components,
    noDefaultComponents: options.noDefaultComponents,
    dryRun: options.dryRun
  });

  const verb = update ? "update" : "install";
  console.log(`Agentic Harness global ${options.dryRun ? `${verb} plan` : `${verb}ed`} (scope: agent-global)`);
  console.log(`State root: ${result.stateRoot}`);
  console.log(`Agents: ${result.agents.join(", ")}`);
  console.log(`Components: ${result.components.join(", ") || "none (core plumbing only)"}`);
  console.log(`Core files: ${result.coreFiles.join(", ") || "none"}`);
  console.log(`Configs created: ${result.configsCreated.length}`);
  console.log(`Configs updated: ${result.configsUpdated.length}`);
  console.log(`Configs unchanged: ${result.configsUnchanged.length}`);
  console.log(`Backups: ${result.backups.length}`);

  if (options.dryRun) {
    console.log("Dry run: nothing was written.");
    return;
  }

  console.log('State tracked in ~/.harness/state.json. Run "harness doctor" to verify.');
}

export async function runGlobalUninstall(options) {
  const homeDir = resolveHomeDir();
  const result = await uninstallGlobalHarness({
    homeDir,
    dryRun: options.dryRun
  });

  console.log(`Agentic Harness global ${options.dryRun ? "uninstall plan" : "uninstalled"} (scope: agent-global)`);
  console.log(`Configs cleaned: ${result.configsCleaned.join(", ") || "none"}`);
  console.log(`Backups: ${result.backups.length}`);
  console.log(`State removed: ${result.stateRemoved ? "yes" : "no state found"}`);
  console.log("Backups under ~/.harness/backups were preserved.");
}

export async function runGlobalDoctor() {
  const homeDir = resolveHomeDir();
  const { checks, ok } = await runGlobalDoctorChecks(homeDir);

  console.log("Agentic Harness doctor (scope: agent-global)");
  console.log(`Home: ${homeDir}`);
  console.log("");

  for (const check of checks) {
    const label = check.status.toUpperCase().padEnd(8);
    const detail = check.detail ? ` — ${check.detail}` : "";
    console.log(`[${label}] ${check.name}${detail}`);
  }

  console.log("");
  console.log(ok ? "Status: OK" : "Status: FAILED (missing managed state or configs)");

  if (!ok) process.exitCode = 1;
}

export function printGlobalDetect() {
  const homeDir = resolveHomeDir();
  const detected = detectInstalledAdapters({ homeDir });

  console.log("Global agents (scope: agent-global)");
  console.log(`Home: ${homeDir}`);
  console.log(`Detected: ${detected.join(", ") || "none"}`);
  console.log(`Supported: ${GLOBAL_AGENT_IDS.join(", ")}`);
}
