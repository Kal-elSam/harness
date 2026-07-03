import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { listBackupSnapshots } from "./backups.js";
import { harnessHomePaths } from "./paths.js";
import { buildAdapterContext } from "./adapter-context.js";
import { componentFileChecks, componentSectionChecks } from "./component-installer.js";
import { resolveComponent } from "./component-registry.js";
import { listAdapters } from "./registry.js";
import { readGlobalState } from "./state.js";

export async function runGlobalDoctorChecks(homeDir) {
  const paths = harnessHomePaths(homeDir);
  const state = await readGlobalState(paths.statePath);
  const installedComponents = (state?.components ?? []).map((entry) => resolveComponent(entry.id));
  const context = buildAdapterContext({
    homeDir,
    packageName: state?.packageName ?? "",
    components: installedComponents
  });
  const checks = [stateCheck(state), ...legacyCoreFileChecks(paths, state), ...componentFileChecks(paths, state)];

  for (const adapter of listAdapters()) {
    const stateEntry = state?.adapters?.find((entry) => entry.id === adapter.id);
    checks.push(await adapter.doctor(context, stateEntry));
  }

  checks.push(...await componentSectionChecks(homeDir, state));
  checks.push(await backupsCheck(paths));

  const hasMissingRequired = checks.some((check) => check.status === "missing");
  return { checks, ok: !hasMissingRequired, state, paths };
}

function stateCheck(state) {
  if (!state) {
    return {
      name: "~/.harness/state.json",
      status: "missing",
      detail: 'Not found. Run "harness install" to configure the local ecosystem.'
    };
  }

  const componentCount = state.components?.length ?? 0;

  return {
    name: "~/.harness/state.json",
    status: "ok",
    detail: `cliVersion=${state.cliVersion ?? "unknown"}, adapters=${state.adapters?.length ?? state.agents?.length ?? 0}, components=${componentCount}`
  };
}

function legacyCoreFileChecks(paths, state) {
  const legacyFiles = Object.keys(state?.coreFiles ?? {}).filter((path) => path.startsWith("core/"));

  return legacyFiles.map((relativePath) => {
    const exists = existsSync(join(paths.root, relativePath));
    return {
      name: `~/.harness/${relativePath}`,
      status: exists ? "ok" : "warning",
      detail: exists ? "legacy core asset" : "Legacy core asset missing. Run harness update."
    };
  });
}

async function backupsCheck(paths) {
  const snapshots = await listBackupSnapshots(paths.backupsDir);

  return {
    name: "~/.harness/backups",
    status: "ok",
    detail: snapshots.length > 0 ? `${snapshots.length} snapshot(s)` : "No snapshots yet."
  };
}
