import { join } from "node:path";
import { harnessHomePaths } from "./paths.js";

export function buildAdapterContext({ homeDir, packageName, coreDir, dryRun = false, timestamp = null }) {
  const paths = harnessHomePaths(homeDir);

  return {
    homeDir,
    paths,
    packageName,
    coreDir: coreDir ?? paths.coreDir,
    dryRun,
    timestamp
  };
}

export function buildManagedBody({ packageName, coreDir }) {
  return [
    "## Harness (managed)",
    "",
    `Managed by \`${packageName}\`. Content inside these markers is refreshed by`,
    "`harness update`. Everything outside the markers is yours and is preserved.",
    "",
    `- Orchestrator contract: ${join(coreDir, "orchestrator.md")}`,
    "- When working inside a repository, its AGENTS.md governs first.",
    "- Run `harness doctor` to check ecosystem health.",
    "- Run `harness uninstall` to remove managed sections safely."
  ].join("\n");
}
