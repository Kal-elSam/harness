import { loadEcosystemUpdates as defaultLoadEcosystemUpdates } from "./observability/ecosystem-updates.js";
import { commandHeader } from "./brand/index.js";
import { resolveHomeDir } from "./paths.js";

/** Read-only ecosystem update check — never applies upgrades. */
export async function runEcosystemUpdatesCheck(
  options = {},
  packageManifest = {},
  { loadEcosystemUpdates = defaultLoadEcosystemUpdates } = {}
) {
  const action = options.updatesAction ?? "check";
  if (action !== "check") {
    throw new Error(`Unknown updates action "${action}". Use: kairo updates check`);
  }

  const report = await loadEcosystemUpdates({
    packageName: packageManifest.name ?? "@kal-elsam/kairo-runtime",
    installedVersion: packageManifest.version ?? "0.0.0",
    homeDir: resolveHomeDir(options.env ?? process.env),
    forceRefresh: options.force === true,
    env: options.env ?? process.env
  });

  if (options.json) {
    console.log(JSON.stringify({ command: "updates", action: "check", ...report }, null, 2));
    return report;
  }

  console.log(commandHeader("updates check — ecosystem (read-only)"));
  console.log(`State: ${report.state}${report.cacheHit ? " · cache" : ""}`);
  if (report.checkedAt) console.log(`Checked: ${report.checkedAt}`);
  for (const id of ["kairo", "hermes", "gentle", "skills"]) {
    const tool = report.tools?.[id] ?? {};
    const flag = tool.updateAvailable ? "UPDATE" : "ok";
    const err = tool.error ? ` · ${tool.error}` : "";
    console.log(`[${flag}] ${id.padEnd(7)} installed: ${tool.installed ?? "—"}  latest: ${tool.latest ?? "—"}${err}`);
  }
  console.log("");
  console.log("No updates were applied. Consent-gated apply lands in a later slice.");
  return report;
}
