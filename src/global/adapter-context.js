import { join } from "node:path";
import { harnessHomePaths } from "./paths.js";

export function buildAdapterContext({
  homeDir,
  packageName,
  packageRoot = null,
  components = [],
  dryRun = false,
  timestamp = null
}) {
  const paths = harnessHomePaths(homeDir);

  return {
    homeDir,
    paths,
    packageRoot,
    packageName,
    coreDir: paths.coreDir,
    componentsDir: join(paths.root, "components"),
    components,
    dryRun,
    timestamp
  };
}
